// 腾讯云云函数入口文件
// 将 Express 应用转换为云函数格式

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const OSS = require('./oss-config');

const app = express();
const PORT = 9000;

// 设置静态文件目录
app.use(express.static('public', {
  maxAge: '1h',
  setHeaders: (res, path) => {
    if (path.endsWith('.mp4') || path.endsWith('.webm')) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  }
}));

// 视频文件服务
app.use('/videos', express.static(path.join(__dirname, 'public', 'videos'), {
  maxAge: '1h',
  setHeaders: (res, path) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }
}));

app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

app.use(express.urlencoded({ extended: true }));

// 配置multer上传中间件（云函数兼容）
const storage = multer.memoryStorage(); // 使用内存存储，避免文件系统限制
const upload = multer({ storage: storage });

// 创建必要的目录（云函数环境）
if (!fs.existsSync('/tmp')) {
  // 云函数使用/tmp目录作为临时存储
}

// 主页路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 获取视频列表API
app.get('/api/videos', (req, res) => {
  const videosDir = path.join(__dirname, 'public', 'videos');
  
  try {
    if (!fs.existsSync(videosDir)) {
      return res.json({ success: true, videos: [] });
    }

    const files = fs.readdirSync(videosDir);
    const videoFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.mp4', '.webm', '.ogg', '.mov', '.avi'].includes(ext);
    }).map(file => {
      const filePath = path.join(videosDir, file);
      return {
        name: file,
        path: `/videos/${file}`,
        size: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0,
        duration: 0 // 云函数环境简化处理
      };
    });
    
    res.json({ success: true, videos: videoFiles });
  } catch (error) {
    res.json({ success: false, videos: [] });
  }
});

// 视频上传API（云函数适配版）
app.post('/api/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.json({ success: false, message: '请选择视频文件' });
    }

    // 云函数环境：将文件保存到/tmp目录
    const fileName = Date.now() + '-' + req.file.originalname;
    const filePath = path.join('/tmp', fileName);
    
    fs.writeFileSync(filePath, req.file.buffer);
    
    // 如果是OSS配置有效，上传到OSS
    if (OSS) {
      try {
        const result = await OSS.put(`videos/${fileName}`, fs.createReadStream(filePath));
        fs.unlinkSync(filePath); // 删除临时文件
        res.json({ 
          success: true, 
          message: '视频上传成功',
          path: result.url,
          name: fileName
        });
      } catch (ossError) {
        console.error('OSS上传失败:', ossError);
        // 使用临时文件路径
        res.json({ 
          success: true, 
          message: '视频上传成功（临时存储）',
          path: `/tmp/${fileName}`,
          name: fileName
        });
      }
    } else {
      res.json({ 
        success: true, 
        message: '视频上传成功（临时存储）',
        path: `/tmp/${fileName}`,
        name: fileName
      });
    }
  } catch (error) {
    console.error('上传失败:', error);
    res.json({ success: false, message: '上传失败' });
  }
});

// 云函数入口
exports.main_handler = async (event, context) => {
  return new Promise((resolve, reject) => {
    // 将API网关事件转换为HTTP请求
    const { method, path, headers, body, queryString } = event;
    
    const req = {
      method: method,
      url: path,
      headers: headers || {},
      body: body,
      query: queryString || {}
    };
    
    const res = {
      statusCode: 200,
      headers: {},
      body: '',
      setHeader: function(key, value) {
        this.headers[key] = value;
      },
      send: function(data) {
        this.body = data;
        resolve({
          statusCode: this.statusCode,
          headers: this.headers,
          body: this.body
        });
      },
      json: function(data) {
        this.setHeader('Content-Type', 'application/json');
        this.send(JSON.stringify(data));
      }
    };
    
    // 处理请求
    if (req.method === 'GET' && req.url === '/') {
      // 返回HTML页面
      const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
      res.send(html);
    } else if (req.method === 'GET' && req.url === '/api/videos') {
      // 处理视频列表请求
      app.handle(req, res, () => {});
    } else if (req.method === 'POST' && req.url === '/api/upload') {
      // 处理上传请求
      app.handle(req, res, () => {});
    } else {
      // 静态文件服务
      try {
        const filePath = path.join(__dirname, 'public', req.url);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath);
          res.send(content);
        } else {
          res.statusCode = 404;
          res.send('Not Found');
        }
      } catch (error) {
        res.statusCode = 500;
        res.send('Server Error');
      }
    }
  });
};

// 本地开发时仍然支持直接运行
if (require.main === module) {
  app.listen(PORT, () => {
    console.log('🎬 视频站服务器启动成功！（云函数兼容版）');
    console.log(`📺 访问地址: http://localhost:${PORT}`);
  });
}

module.exports = app;