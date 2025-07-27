import express from 'express';
import fs from 'fs';
import path from 'path';
import { UserStorage } from '../utils/userStorage';
import crypto from 'crypto';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import logger from '../utils/logger';
import { connectMongo, mongoose } from '../services/mongoService';
import { authenticateToken } from '../middleware/authenticateToken';
import { config } from '../config/config';

const router = express.Router();
const DATA_DIR = path.join(process.cwd(), 'data');
const SHARELOGS_DIR = path.join(DATA_DIR, 'sharelogs');
const logDir = path.join(DATA_DIR, 'logs');

// 确保必要的目录都存在
const ensureDirectories = async () => {
  for (const dir of [DATA_DIR, SHARELOGS_DIR, logDir]) {
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }
  }
};

// 初始化目录
ensureDirectories().catch(console.error);

// 配置multer用于多文件类型上传
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25600 * 2 }, // 50KB以内
});

// 简单速率限制（每IP每分钟最多10次上传/查询）
const logLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: '请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 工具：校验管理员密码
async function checkAdminPassword(password: string) {
  const users = await UserStorage.getAllUsers();
  const admin = users.find(u => u.role === 'admin');
  return admin && admin.password === password;
}

// AES-256加密函数
function encryptData(data: any, key: string): { data: string, iv: string } {
  console.log('🔐 [LogShare] 开始加密数据...');
  console.log('    数据类型:', typeof data);
  console.log('    数据长度:', JSON.stringify(data).length);
  
  const jsonString = JSON.stringify(data);
  const iv = crypto.randomBytes(16);
  const keyHash = crypto.createHash('sha256').update(key).digest();
  const cipher = crypto.createCipheriv('aes-256-cbc', keyHash, iv);
  
  let encrypted = cipher.update(jsonString, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  console.log('🔐 [LogShare] 加密完成');
  console.log('    IV长度:', iv.length);
  console.log('    加密数据长度:', encrypted.length);
  
  return {
    data: encrypted,
    iv: iv.toString('hex')
  };
}

// 每次上传都会生成唯一 fileId，文件名为 `${fileId}${ext}`，所有上传结果均保留在 data/sharelogs/ 目录下，支持多次上传和历史回查。
// 上传日志/文件（支持多种类型）
router.post('/sharelog', logLimiter, upload.single('file'), async (req, res) => {
  const ip = req.ip;
  const adminPassword = req.body.adminPassword;
  const fileName = req.file?.originalname;
  try {
    // 检查目录存在和写权限
    try {
      await fs.promises.mkdir(SHARELOGS_DIR, { recursive: true });
      await fs.promises.access(SHARELOGS_DIR, fs.constants.W_OK);
    } catch (dirErr) {
      logger.error(`[logshare] 目录不可写: ${SHARELOGS_DIR}`, dirErr);
      return res.status(500).json({ error: '服务器日志目录不可写，请联系管理员' });
    }
    if (!req.file || !adminPassword) {
      logger.warn(`上传 | IP:${ip} | 文件:${fileName} | 结果:失败 | 原因:缺少参数 | req.file=${!!req.file} req.body=${JSON.stringify(req.body)}`);
      return res.status(400).json({ error: '缺少参数' });
    }
    if (req.file.size > 25600) {
      logger.warn(`上传 | IP:${ip} | 文件:${fileName} | 结果:失败 | 原因:文件过大 | size=${req.file.size}`);
      return res.status(400).json({ error: '文件内容过大' });
    }
    if (!(await checkAdminPassword(adminPassword))) {
      logger.warn(`上传 | IP:${ip} | 文件:${fileName} | 结果:失败 | 原因:管理员密码错误`);
      return res.status(403).json({ error: '管理员密码错误' });
    }
    // 生成随机文件名，保留原扩展名
    const ext = path.extname(req.file.originalname) || '.txt';
    const fileId = crypto.randomBytes(8).toString('hex');
    // 文本类型只存MongoDB
    if ([".txt", ".log", ".json", ".md"].includes(ext)) {
      const LogShareSchema = new mongoose.Schema({
        fileId: { type: String, required: true, unique: true },
        ext: String,
        content: String,
        fileName: String,
        createdAt: { type: Date, default: Date.now }
      }, { collection: 'logshare_files' });
      const LogShareModel = mongoose.models.LogShareFile || mongoose.model('LogShareFile', LogShareSchema);
      let content = '';
      try {
        content = req.file.buffer.toString('utf-8');
      } catch (e) {
        content = '';
      }
      await LogShareModel.create({ fileId, ext, content, fileName, createdAt: new Date() });
      logger.info(`[logshare] 已存入MongoDB: fileId=${fileId}, ext=${ext}, fileName=${fileName}, contentPreview=${content.slice(0, 100)}`);
    } else {
      // 非文本类型仍写本地
      const filePath = path.join(SHARELOGS_DIR, `${fileId}${ext}`);
      logger.info(`[logshare] 上传写入文件: filePath=${filePath}, ext=${ext}, fileName=${fileName}, size=${req.file.size}`);
      try {
        await fs.promises.writeFile(filePath, req.file.buffer);
      } catch (writeErr) {
        logger.error(`[logshare] 写入文件失败: ${filePath}`, writeErr);
        return res.status(500).json({ error: '服务器写入日志文件失败，请联系管理员' });
      }
    }
    // 构造前端访问链接
    const baseUrl = 'https://tts.hapx.one';
    const link = `${baseUrl}/logshare?id=${fileId}`;
    logger.info(`上传 | IP:${ip} | 文件:${fileName} | 结果:成功 | ID:${fileId}`);
    return res.json({ id: fileId, link, ext });
  } catch (e: any) {
    logger.error(`[logshare] 上传异常 | IP:${ip} | 文件:${fileName} | 错误:${e?.message ?? e}`, e);
    return res.status(500).json({ error: '日志上传失败' });
  }
});

// 获取所有日志列表（GET，需要管理员权限）
router.get('/sharelog/all', logLimiter, authenticateToken, async (req, res) => {
  const ip = req.ip;
  
  try {
    // 检查管理员权限
    // @ts-ignore
    if (!req.user || req.user.role !== 'admin') {
      logger.warn(`获取日志列表 | IP:${ip} | 结果:失败 | 原因:非管理员用户`);
      return res.status(403).json({ error: '需要管理员权限' });
    }

    // 获取MongoDB中的文本类型日志
    const LogShareSchema = new mongoose.Schema({
      fileId: { type: String, required: true, unique: true },
      ext: String,
      content: String,
      fileName: String,
      createdAt: { type: Date, default: Date.now }
    }, { collection: 'logshare_files' });
    const LogShareModel = mongoose.models.LogShareFile || mongoose.model('LogShareFile', LogShareSchema);
    
    const mongoLogs = await LogShareModel.find({}, { fileId: 1, ext: 1, createdAt: 1, content: 1 }).sort({ createdAt: -1 });
    
    // 获取本地文件系统中的非文本类型日志
    const localFiles = await fs.promises.readdir(SHARELOGS_DIR);
    const localLogs = localFiles
      .filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ![".txt", ".log", ".json", ".md"].includes(ext);
      })
      .map(file => {
        const fileId = path.basename(file, path.extname(file));
        const ext = path.extname(file);
        const filePath = path.join(SHARELOGS_DIR, file);
        const stats = fs.statSync(filePath);
        return {
          id: fileId,
          ext: ext,
          uploadTime: stats.mtime.toISOString(),
          size: stats.size
        };
      })
      .sort((a, b) => new Date(b.uploadTime).getTime() - new Date(a.uploadTime).getTime());

    // 合并MongoDB和本地文件
    const allLogs = [
      ...mongoLogs.map(log => ({
        id: log.fileId,
        ext: log.ext,
        uploadTime: log.createdAt.toISOString(),
        size: log.content ? log.content.length : 0
      })),
      ...localLogs
    ];

    // 使用管理员token加密数据
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (token) {
      const encrypted = encryptData({ logs: allLogs }, token);
      logger.info(`获取日志列表 | IP:${ip} | 结果:成功 | 数量:${allLogs.length} | 已加密`);
      return res.json({
        data: encrypted.data,
        iv: encrypted.iv
      });
    } else {
      logger.info(`获取日志列表 | IP:${ip} | 结果:成功 | 数量:${allLogs.length} | 未加密`);
      return res.json({ logs: allLogs });
    }
  } catch (e: any) {
    logger.error(`获取日志列表 | IP:${ip} | 结果:异常 | 错误:${e?.message}`, e);
    return res.status(500).json({ error: '获取日志列表失败' });
  }
});

// 查询日志/文件内容（POST，密码在body）
router.post('/sharelog/:id', logLimiter, async (req, res) => {
  const ip = req.ip;
  const { adminPassword } = req.body;
  const { id } = req.params;
  try {
    if (!adminPassword) {
      logger.warn(`查询 | IP:${ip} | 文件ID:${id} | 结果:失败 | 原因:缺少管理员密码`);
      return res.status(400).json({ error: '缺少管理员密码' });
    }
    if (!(await checkAdminPassword(adminPassword))) {
      logger.warn(`查询 | IP:${ip} | 文件ID:${id} | 结果:失败 | 原因:管理员密码错误`);
      return res.status(403).json({ error: '管理员密码错误' });
    }
    // 只查MongoDB文本类型
    const LogShareSchema = new mongoose.Schema({
      fileId: { type: String, required: true, unique: true },
      ext: String,
      content: String,
      fileName: String,
      createdAt: { type: Date, default: Date.now }
    }, { collection: 'logshare_files' });
    const LogShareModel = mongoose.models.LogShareFile || mongoose.model('LogShareFile', LogShareSchema);
    const doc = await LogShareModel.findOne({ fileId: id });
    if (doc && [".txt", ".log", ".json", ".md"].includes(doc.ext)) {
      logger.info(`[logshare] MongoDB命中: fileId=${id}, ext=${doc.ext}, fileName=${doc.fileName}`);
      const result = { content: doc.content, ext: doc.ext };
      
      // 使用管理员密码加密数据
      const encrypted = encryptData(result, adminPassword);
      logger.info(`查询 | IP:${ip} | 文件ID:${id} | 结果:成功 | 类型:文本 | 已加密`);
      return res.json({
        data: encrypted.data,
        iv: encrypted.iv
      });
    }
    // 非文本类型查本地
    const files = await fs.promises.readdir(SHARELOGS_DIR);
    const fileName = files.find(f => f.startsWith(id));
    logger.info(`[调试] 查询文件: id=${id}, files=${JSON.stringify(files)}, fileName=${fileName}`);
    if (!fileName) {
      logger.warn(`查询 | IP:${ip} | 文件ID:${id} | 结果:失败 | 原因:日志不存在`);
      return res.status(404).json({ error: '日志不存在' });
    }
    const filePath = path.join(SHARELOGS_DIR, fileName);
    const ext = path.extname(fileName).toLowerCase() || '.txt';
    logger.info(`[调试] 查询文件路径: filePath=${filePath}, ext=${ext}`);
    // 只处理二进制
    const content = await fs.promises.readFile(filePath);
    logger.info(`[调试] 读取二进制内容长度: ${content.length}`);
    
    const result = { content: content.toString('base64'), ext, encoding: 'base64' };
    // 使用管理员密码加密数据
    const encrypted = encryptData(result, adminPassword);
    logger.info(`查询 | IP:${ip} | 文件ID:${id} | 文件:${fileName} | 结果:成功 | 类型:二进制 | 已加密`);
    return res.json({
      data: encrypted.data,
      iv: encrypted.iv
    });
  } catch (e: any) {
    logger.error(`查询 | IP:${ip} | 文件ID:${id} | 结果:异常 | 错误:${e?.message}`);
    return res.status(500).json({ error: '日志查询失败' });
  }
});

export default router; 