const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const OSS = require('./oss-config');

const app = express();
const PORT = process.env.PORT || 3000;

// 设置静态文件目录（腾讯云优化）
app.use(express.static('public', {
  maxAge: '1h',
  setHeaders: (res, path) => {
    if (path.endsWith('.mp4') || path.endsWith('.webm')) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  }
}));

// 视频文件服务（腾讯云兼容）
app.use('/videos', express.static(path.join(__dirname, 'public', 'videos'), {
  maxAge: '1h',
  setHeaders: (res, path) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }
}));
app.get('/favicon.ico', (req, res) => {
    console.log('[favicon] 静默处理favicon请求');
    res.status(204).end();
});
app.use(express.urlencoded({ extended: true }));

// 配置multer上传中间件
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// 创建必要的目录
if (!fs.existsSync('public')) fs.mkdirSync('public');
if (!fs.existsSync('public/videos')) fs.mkdirSync('public/videos');
if (!fs.existsSync('public/uploads')) fs.mkdirSync('public/uploads');

// 主页路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 获取视频列表API
app.get('/api/videos', (req, res) => {
    const videosDir = path.join(__dirname, 'public', 'videos');
    
    try {
        // 确保视频目录存在
        if (!fs.existsSync(videosDir)) {
            fs.mkdirSync(videosDir, { recursive: true });
            return res.json({ success: true, videos: [] });
        }

        const files = fs.readdirSync(videosDir);
        const videoFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.mp4', '.webm', '.ogg', '.mov', '.avi'].includes(ext);
        }).map(file => {
            const filePath = path.join(videosDir, file);
            let duration = 0;
            
            // 获取视频时长（需要ffmpeg）
            try {
                const { execSync } = require('child_process');
                const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
                duration = parseFloat(execSync(cmd).toString()) || 0;
            } catch (e) {
                console.warn(`无法获取视频时长: ${e.message}`);
            }

            return {
                name: file,
                path: `/videos/${file}`, // 返回完整路径
                size: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0,
                duration: duration
            };
        });
        
        res.json({
            success: true,
            videos: videoFiles,
            count: videoFiles.length
        });
    } catch (error) {
        res.json({ success: false, videos: [] });
    }
});

// 视频上传API
app.post('/api/upload', upload.single('video'), async (req, res) => {
    try {
        if (!req.file) {
            return res.json({ success: false, message: '请选择视频文件' });
        }

        const filePath = req.file.path;
        const fileName = req.file.filename;
        
        // 如果是OSS配置有效，上传到OSS
        if (OSS) {
            try {
                const result = await OSS.put(`videos/${fileName}`, fs.createReadStream(filePath));
                // 删除本地临时文件
                fs.unlinkSync(filePath);
                res.json({ 
                    success: true, 
                    message: '视频上传成功',
                    path: result.url,
                    name: fileName
                });
            } catch (ossError) {
                console.error('OSS上传失败:', ossError);
                // OSS失败时使用本地存储
                const targetPath = path.join(__dirname, 'public', 'videos', fileName);
                fs.renameSync(filePath, targetPath);
                res.json({ 
                    success: true, 
                    message: '视频上传成功（本地存储）',
                    path: `/videos/${fileName}`,
                    name: fileName
                });
            }
        } else {
            // 直接使用本地存储
            const targetPath = path.join(__dirname, 'public', 'videos', fileName);
            fs.renameSync(filePath, targetPath);
            res.json({ 
                success: true, 
                message: '视频上传成功（本地存储）',
                path: `/videos/${fileName}`,
                name: fileName
            });
        }
    } catch (error) {
        console.error('上传失败:', error);
        res.json({ success: false, message: '上传失败' });
    }
});

// 启动服务器（腾讯云兼容）
app.listen(PORT, '0.0.0.0', () => {
    console.log('🎬 视频站服务器启动成功！');
    console.log(`📺 运行端口: ${PORT}`);
    console.log('🌐 环境:', process.env.NODE_ENV || 'development');
    console.log('💡 将视频文件放入 public/videos/ 目录即可播放');
    
    // 腾讯云环境检测
    if (process.env.TCB_ENV) {
        console.log('✅ 运行在腾讯云云开发环境');
    } else if (process.env.PORT) {
        console.log('🌩️ 运行在云平台环境');
    } else {
        console.log('💻 运行在本地开发环境');
    }
});

module.exports = app;