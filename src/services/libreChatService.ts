import axios from 'axios';
import { JSDOM } from 'jsdom';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import logger from '../utils/logger';
import { mongoose } from '../services/mongoService';

// 基础输入清理：限制长度并移除可疑字符
function sanitizeId(input?: string): string {
  if (!input || typeof input !== 'string') return '';
  // 仅保留常见安全字符，限制长度，防止注入与异常索引
  return input.replace(/[^A-Za-z0-9_\-:@.]/g, '').slice(0, 128);
}

// 安全构建正则：对模式进行转义
function escapeRegex(input?: string): string {
  if (!input || typeof input !== 'string') return '';
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 清洗助手文本中的 <think> 思考内容与可视化标记
function sanitizeAssistantText(text: string): string {
  if (!text) return text;
  try {
    return text
      // 移除完整的 <think ...>...</think> 段落（允许属性，跨行）
      .replace(/<think\b[^>]*>[\s\S]*?<\/?think>/gi, '')
      // 兜底：去掉可能残留的起止标签（含空白）
      .replace(/<\/?\s*think\b[^>]*>/gi, '')
      // 去除常见的可视化标记行
      .replace(/^\s*(已深度思考|深度思考|Deep\s*Thinking)\b.*$/gmi, '')
      // 折叠多余空行
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } catch {
    return text;
  }
}

// 识别“询问模型身份/名称/版本”等问题（中英文常见写法），用于强制保持沉默
function isModelIdentityQuery(text: string): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  const patterns: RegExp[] = [
    /你是(什么|啥)模型/u,
    /你(用|使用)的?(是)?(什么|啥)模型/u,
    /你(在)?(用|使用)什么(大)?模型/u,
    /模型(名|名称|版本)/u,
    /你是哪(个|個)模型/u,
    /你基于什么模型/u,
    /what\s+model\s+are\s+you/,
    /which\s+model\s+are\s+you/,
    /what\s+model\s+do\s+you\s+run/,
    /which\s+llm/,
    /what\s+llm/,
    /model\s+name/,
  ];
  return patterns.some(r => r.test(t));
}

// MongoDB 图片记录 Schema（历史图片记录，保留原有定义）
const ImageRecordSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  imageUrl: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
}, { collection: 'librechat_images' });
const ImageRecordModel = mongoose.models.LibreChatImage || mongoose.model('LibreChatImage', ImageRecordSchema);

// MongoDB 最新记录 Schema（单例文档，用于 getLatestRecord 持久化）
const LatestRecordSchema = new mongoose.Schema({
  _id: { type: String, default: 'latest' },
  updateTime: { type: String, required: true },
  updateTimeShanghai: { type: String },
  imageUrl: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'librechat_latest' });
const LatestRecordModel = mongoose.models.LibreChatLatest || mongoose.model('LibreChatLatest', LatestRecordSchema);

// MongoDB 聊天历史 Schema
const ChatHistorySchema = new mongoose.Schema({
  userId: { type: String, required: true },
  messages: { type: Array, required: true },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'librechat_histories' });
// 索引：按用户与更新时间查询
ChatHistorySchema.index({ userId: 1 });
ChatHistorySchema.index({ updatedAt: -1 });
const ChatHistoryModel: any = mongoose.models.LibreChatHistory || mongoose.model('LibreChatHistory', ChatHistorySchema);

interface ImageRecord {
  updateTime: string;
  // 上海时间（UTC+8），用于本地化显示，可选以兼容历史数据
  updateTimeShanghai?: string;
  imageUrl: string;
}

interface ChatMessage {
  id: string;
  message: string;
  role?: 'user' | 'assistant';
  timestamp: string;
  token: string;
  userId?: string; // 可选：当登录用户ID可用时写入
}

interface ChatHistory {
  messages: ChatMessage[];
  total: number;
}

interface PaginationOptions {
  page: number;
  limit: number;
}

class LibreChatService {
  private static instance: LibreChatService;
  private latestRecord: ImageRecord | null = null;
  private readonly DATA_DIR = join(process.cwd(), 'data');
  private readonly DATA_FILE = join(this.DATA_DIR, 'lc_data.json');
  private readonly CHAT_HISTORY_FILE = join(this.DATA_DIR, 'chat_history.json');
  private isRunning: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;
  private chatHistory: ChatMessage[] = [];

  private constructor() {
    this.initializeService();
  }

  public static getInstance(): LibreChatService {
    if (!LibreChatService.instance) {
      LibreChatService.instance = new LibreChatService();
    }
    return LibreChatService.instance;
  }

  private async initializeService() {
    try {
      if (mongoose.connection.readyState === 1) {
        // MongoDB: 加载最新记录（优先从单例集合获取）
        const latestDoc = await LatestRecordModel.findById('latest').lean();
        if (latestDoc) {
          const d: any = latestDoc;
          this.latestRecord = {
            updateTime: d.updateTime,
            updateTimeShanghai: d.updateTimeShanghai,
            imageUrl: d.imageUrl,
          };
          logger.info('从 MongoDB 加载最新的 LibreChat 记录 (librechat_latest)');
        } else {
          // 回退：尝试从历史图片集合中读取最近一条（仅保留 imageUrl）
          const latest = await ImageRecordModel.findOne().sort({ createdAt: -1 }).lean();
          this.latestRecord = latest ? { updateTime: new Date().toISOString(), imageUrl: (latest as any).imageUrl } : null;
          if (this.latestRecord) {
            logger.info('从 MongoDB 加载回退的 LibreChat 图片记录 (librechat_images)');
          }
        }
        // 加载聊天历史
        const history = await ChatHistoryModel.findOne().sort({ updatedAt: -1 }).lean();
        const h: any = history;
        this.chatHistory = h && Array.isArray(h.messages) ? h.messages : [];
        logger.info('Loaded chat history from MongoDB');
        if (!this.isRunning && process.env.NODE_ENV !== 'test') {
          this.startPeriodicCheck();
        }
        return;
      }
    } catch (error) {
      logger.error('从 MongoDB 加载 LibreChat 数据失败，降级为本地文件:', error);
    }
    // 本地文件兜底
    try {
      if (!existsSync(this.DATA_DIR)) {
        await mkdir(this.DATA_DIR, { recursive: true });
        logger.info('创建 LibreChat 服务的数据目录');
      }
      if (existsSync(this.DATA_FILE)) {
        const data = await readFile(this.DATA_FILE, 'utf-8');
        this.latestRecord = JSON.parse(data);
        logger.info('加载之前的 LibreChat 镜像记录');
      }
      if (existsSync(this.CHAT_HISTORY_FILE)) {
        const data = await readFile(this.CHAT_HISTORY_FILE, 'utf-8');
        this.chatHistory = JSON.parse(data);
        logger.info('加载聊天历史');
      }
      if (!this.isRunning && process.env.NODE_ENV !== 'test') {
        this.startPeriodicCheck();
      }
    } catch (error) {
      logger.error('Error initializing LibreChat service:', error);
    }
  }

  private async saveRecord(record: ImageRecord) {
    try {
      await writeFile(this.DATA_FILE, JSON.stringify(record, null, 2));
      this.latestRecord = record;
      logger.info(`已保存新的 LibreChat 镜像记录: ${record.imageUrl}`);
      // 同步保存到 MongoDB（单例 upsert）
      if (mongoose.connection.readyState === 1) {
        await LatestRecordModel.findByIdAndUpdate(
          'latest',
          { ...record, updatedAt: new Date() },
          { upsert: true, setDefaultsOnInsert: true }
        );
        logger.info('已将最新的 LibreChat 记录写入/更新到 MongoDB');
      }
    } catch (error) {
      logger.error('保存 LibreChat 记录时出错:', error);
    }
  }

  private async saveChatHistory() {
    try {
      await writeFile(this.CHAT_HISTORY_FILE, JSON.stringify(this.chatHistory, null, 2));
    } catch (error) {
      logger.error('保存聊天历史时出错:', error);
    }
  }

  /**
   * 将指定 token 的消息写入 MongoDB（upsert）。
   * 仅在 MongoDB 已连接时执行。
   */
  private async upsertTokenHistory(keyId: string, messages: ChatMessage[]) {
    if (mongoose.connection.readyState !== 1) return;
    try {
      const safeKey = sanitizeId(keyId);
      await (mongoose.models.LibreChatHistory as any).findOneAndUpdate(
        { userId: safeKey },
        { $set: { messages, updatedAt: new Date() } },
        { upsert: true, setDefaultsOnInsert: true }
      );
    } catch (err) {
      logger.error('写入 MongoDB 聊天历史失败:', err);
    }
  }

  private async fetchAndRecord() {
    try {
      const url = 'https://github.com/danny-avila/LibreChat/pkgs/container/librechat-dev';
      const response = await axios.get(url);

      // 使用 JSDOM 解析 HTML
      const dom = new JSDOM(response.data);
      const document = dom.window.document;

      // 查找 Docker 命令
      const clipboardCopy = document.querySelector('clipboard-copy');
      if (clipboardCopy) {
        const dockerCommand = clipboardCopy.getAttribute('value') || '';
        const filteredCommand = dockerCommand.replace('docker pull ', '');
        // 生成时间：UTC 和 上海时间（UTC+8）
        const now = new Date();
        const fmt = new Intl.DateTimeFormat('zh-CN', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });
        const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
        const shanghai = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;

        // 创建新记录
        const newRecord: ImageRecord = {
          updateTime: now.toISOString(),
          updateTimeShanghai: shanghai,
          imageUrl: filteredCommand
        };

        // 保存记录
        await this.saveRecord(newRecord);
      }
    } catch (error) {
      logger.error('获取 LibreChat 镜像数据时出错:', error);
    }
  }

  private startPeriodicCheck() {
    this.isRunning = true;
    this.fetchAndRecord(); // 立即执行一次

    // 每小时检查一次
    this.intervalId = setInterval(() => {
      this.fetchAndRecord();
    }, 3600000); // 3600000 ms = 1 hour
  }

  public getLatestRecord(): ImageRecord | null {
    // 访问时确保持久化（若 MongoDB 已连接）
    if (this.latestRecord && mongoose.connection.readyState === 1) {
      LatestRecordModel.findByIdAndUpdate(
        'latest',
        { ...this.latestRecord, updatedAt: new Date() },
        { upsert: true, setDefaultsOnInsert: true }
      ).catch(err => {
        logger.error('更新或插入最新记录失败:', err);
      });
    }
    return this.latestRecord;
  }

  /**
   * 发送聊天消息
   */
  public async sendMessage(token: string, message: string, userId?: string): Promise<string> {
    // 先将用户消息写入历史
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      message,
      role: 'user',
      timestamp: new Date().toISOString(),
      token,
      userId
    };
    this.chatHistory.push(userMsg);
    await this.saveChatHistory();
    // 同步写入 MongoDB（用户消息）
    const keyId = userId || token;
    const currentUserMessages = this.chatHistory.filter(m => userId ? m.userId === userId : m.token === token);
    await this.upsertTokenHistory(keyId, currentUserMessages);

    // 若用户询问“你是什么模型”等同类问题，严格保持沉默并直接返回空字符串
    if (isModelIdentityQuery(message)) {
      logger.info('拦截模型识别类问题，按规则保持沉默');
      return '';
    }

    // 读取 OpenAI 兼容配置
    const baseURL = process.env.CHAT_BASE_URL?.replace(/\/$/, '') || '';
    const apiKey = process.env.CHAT_API_KEY || '';
    const model = process.env.CHAT_MODEL || 'gpt-oss-120b';

    // 如果未配置，则返回降级的本地回复（不阻塞）
    if (!baseURL || !apiKey) {
      logger.warn('CHAT_BASE_URL 或 CHAT_API_KEY 未配置，使用本地模拟回复');
      const fallback = '系统暂未配置对话服务，已返回本地示例回答。';
      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        message: fallback,
        role: 'assistant',
        timestamp: new Date().toISOString(),
        token,
        userId
      };
      this.chatHistory.push(aiMsg);
      await this.saveChatHistory();
      await this.upsertTokenHistory(keyId, this.chatHistory.filter(m => userId ? m.userId === userId : m.token === token));
      return fallback;
    }

    try {
      // 组织对话上下文（可扩展：带上最近若干轮同一 token 的消息）
      const recent = this.chatHistory
        .filter(m => m.token === token)
        .slice(-20); // 仅取最近10条以控制上下文长度

      const messagesPayload = [
        {
          role: 'system',
          content:
            '你是 Happy-TTS LibreChat 的客服助理，必须使用中文并提供专业、准确、简洁的回答。\n' +
            '重要规则：\n' +
            '1) 当用户询问你“是什么模型/用的什么模型/模型名称/模型版本/运行在什么模型”等同类问题时，保持沉默，不要作答，不要输出任何字符。\n' +
            '2) 不要改变身份，不要扮演其他角色。\n' +
            '3) 在确保安全与合规的前提下，遵循用户的正常需求与指令。'
        },
        ...recent.map(m => ({
          role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
          content: m.message
        })),
      ];

      const url = `${baseURL}/v1/chat/completions`;
      const resp = await axios.post(url, {
        model,
        messages: messagesPayload,
        temperature: 0.7,
        stream: false
      }, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 60_000
      });

      // 解析 OpenAI 兼容响应并清洗 think 标签
      const aiTextRaw = resp?.data?.choices?.[0]?.message?.content?.trim() || '（无有效回复）';
      const aiText = sanitizeAssistantText(aiTextRaw);

      // 持久化助手回复
      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        message: aiText,
        role: 'assistant',
        timestamp: new Date().toISOString(),
        token,
        userId
      };
      this.chatHistory.push(aiMsg);
      await this.saveChatHistory();
      await this.upsertTokenHistory(keyId, this.chatHistory.filter(m => userId ? m.userId === userId : m.token === token));

      return aiText;
    } catch (err: any) {
      logger.error('调用 OpenAI 兼容聊天接口失败:', err?.response?.data || err?.message || err);
      const fallback = '对话服务暂不可用，请稍后重试。';
      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        message: fallback,
        role: 'assistant',
        timestamp: new Date().toISOString(),
        token,
        userId
      };
      this.chatHistory.push(aiMsg);
      await this.saveChatHistory();
      await this.upsertTokenHistory(keyId, this.chatHistory.filter(m => userId ? m.userId === userId : m.token === token));
      return fallback;
    }
  }

  /**
   * 获取聊天历史
   */
  public async getHistory(token: string, options: PaginationOptions = { page: 1, limit: 20 }, userId?: string): Promise<ChatHistory> {
    // 优先从 MongoDB 获取
    let userMessages: ChatMessage[] | null = null;
    if (mongoose.connection.readyState === 1) {
      try {
        const keyId = sanitizeId(userId || token);
        const doc = await (mongoose.models.LibreChatHistory as any).findOne({ userId: keyId }).lean();
        if (doc && Array.isArray(doc.messages)) userMessages = doc.messages as ChatMessage[];
      } catch (err) {
        logger.error('从 MongoDB 获取聊天历史失败，回退到内存/文件:', err);
      }
    }
    if (!userMessages) {
      const safeUserId = sanitizeId(userId);
      const safeToken = sanitizeId(token);
      userMessages = this.chatHistory.filter(msg => safeUserId ? msg.userId === safeUserId : msg.token === safeToken);
    }
    const total = userMessages.length;

    const startIndex = (options.page - 1) * options.limit;
    const endIndex = startIndex + options.limit;
    const messages = userMessages.slice(startIndex, endIndex);

    return {
      messages,
      total
    };
  }

  /**
   * 清除聊天历史
   */
  public async clearHistory(token: string, userId?: string): Promise<void> {
    const safeUserId = sanitizeId(userId);
    const safeToken = sanitizeId(token);
    this.chatHistory = this.chatHistory.filter(msg => safeUserId ? msg.userId !== safeUserId : msg.token !== safeToken);
    await this.saveChatHistory();
    // MongoDB 中删除该 token 文档
    if (mongoose.connection.readyState === 1) {
      try {
        const keyId = sanitizeId(userId || token);
        await (mongoose.models.LibreChatHistory as any).deleteOne({ userId: keyId });
      } catch (err) {
        logger.error('删除 MongoDB 聊天历史失败:', err);
      }
    }
  }

  /**
   * 按消息ID删除（仅删除属于该 token 的消息）
   */
  public async deleteMessage(token: string, id: string, userId?: string): Promise<{ removed: number }> {
    const before = this.chatHistory.length;
    const safeUserId = sanitizeId(userId);
    const safeToken = sanitizeId(token);
    this.chatHistory = this.chatHistory.filter(m => !((safeUserId ? m.userId === safeUserId : m.token === safeToken) && m.id === id));
    const removed = before - this.chatHistory.length;
    if (removed > 0) {
      await this.saveChatHistory();
      const keyId = sanitizeId(userId || token);
      await this.upsertTokenHistory(keyId, this.chatHistory.filter(m => safeUserId ? m.userId === safeUserId : m.token === safeToken));
    }
    return { removed };
  }

  /**
   * 批量按消息ID删除（仅删除属于该 token 的消息）
   */
  public async deleteMessages(token: string, ids: string[], userId?: string): Promise<{ removed: number }> {
    const idSet = new Set(ids || []);
    const before = this.chatHistory.length;
    this.chatHistory = this.chatHistory.filter(m => !((userId ? m.userId === userId : m.token === token) && idSet.has(m.id)));
    const removed = before - this.chatHistory.length;
    if (removed > 0) {
      await this.saveChatHistory();
      const keyId = userId || token;
      await this.upsertTokenHistory(keyId, this.chatHistory.filter(m => userId ? m.userId === userId : m.token === token));
    }
    return { removed };
  }

  /**
   * 修改单条消息内容（仅允许修改属于该 token 的消息）
   */
  public async updateMessage(token: string, id: string, content: string, userId?: string): Promise<{ updated: number }> {
    let updated = 0;
    this.chatHistory = this.chatHistory.map(m => {
      if ((userId ? m.userId === userId : m.token === token) && m.id === id) {
        updated = 1;
        return { ...m, message: content };
      }
      return m;
    });
    if (updated) {
      await this.saveChatHistory();
      const keyId = userId || token;
      await this.upsertTokenHistory(keyId, this.chatHistory.filter(m => userId ? m.userId === userId : m.token === token));
    }
    return { updated };
  }

  // 仅管理员使用：列出所有用户最新概览（分页）
  public async adminListUsers(keyword = '', page = 1, limit = 20): Promise<{ users: any[]; total: number }> {
    if (mongoose.connection.readyState !== 1) return { users: [], total: 0 };
    const kw = escapeRegex(keyword.trim()).slice(0, 128);
    const q: any = kw ? { userId: new RegExp(kw, 'i') } : {};
    const total = await (mongoose.models.LibreChatHistory as any).countDocuments(q);
    const docs = await (mongoose.models.LibreChatHistory as any)
      .find(q, { userId: 1, messages: 1, updatedAt: 1 })
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
    const users = (docs || []).map((d: any) => {
      const msgs: ChatMessage[] = Array.isArray(d.messages) ? d.messages : [];
      const totalMsgs = msgs.length;
      const times = msgs.map(m => m.timestamp).filter(Boolean).sort();
      const firstTs = times[0] || null;
      const lastTs = times[times.length - 1] || null;
      return { userId: d.userId, total: totalMsgs, updatedAt: d.updatedAt, firstTs, lastTs };
    });
    return { users, total };
  }

  // 仅管理员使用：获取指定用户的历史（分页）
  public async adminGetUserHistory(userId: string, page = 1, limit = 20): Promise<ChatHistory> {
    if (mongoose.connection.readyState !== 1) return { messages: [], total: 0 };
    const safeUserId = sanitizeId(userId);
    const doc = await (mongoose.models.LibreChatHistory as any).findOne({ userId: safeUserId }).lean();
    const all: ChatMessage[] = doc?.messages || [];
    const total = all.length;
    const start = (page - 1) * limit;
    const end = start + limit;
    return { messages: all.slice(start, end), total };
  }

  // 仅管理员使用：删除指定用户全部历史（Mongo 不可用时回退到内存存储）
  public async adminDeleteUser(userId: string): Promise<{ deleted: number }> {
    const safeUserId = sanitizeId(userId);
    let deleted = 0;

    // 优先尝试 MongoDB
    try {
      if (mongoose.connection.readyState === 1) {
        const ret = await (mongoose.models.LibreChatHistory as any).deleteMany({ userId: safeUserId });
        deleted = (ret?.deletedCount || 0) as number;
      }
    } catch (e) {
      console.warn('[LibreChat] adminDeleteUser mongo delete failed, fallback to memory', e);
    }

    // 同步内存/文件（按 userId 清理）
    const before = this.chatHistory.length;
    this.chatHistory = this.chatHistory.filter(m => m.userId !== safeUserId);
    if (this.chatHistory.length !== before) {
      await this.saveChatHistory();
      // 如果 Mongo 未删到文档，则至少按内存处理记作 1
      if (deleted === 0) deleted = 1;
    }

    return { deleted };
  }

  // 仅管理员使用：批量删除多个用户全部历史
  public async adminBatchDeleteUsers(userIds: string[]): Promise<{ deleted: number; details: { userId: string; deleted: number }[] }> {
    const safeUserIds = userIds.map(id => sanitizeId(id));
    const details: { userId: string; deleted: number }[] = [];
    let totalDeleted = 0;

    // 优先尝试 MongoDB 删除
    if (mongoose.connection.readyState === 1) {
      for (const userId of safeUserIds) {
        try {
          const ret = await (mongoose.models.LibreChatHistory as any).deleteMany({ userId });
          const deletedCount = (ret?.deletedCount || 0) as number;
          details.push({ userId, deleted: deletedCount });
          totalDeleted += deletedCount;
        } catch (error) {
          console.error('删除用户失败', { userId, error });
          details.push({ userId, deleted: 0 });
        }
      }
    }

    // 同步内存/文件（按 userId 清理）
    const beforeLen = this.chatHistory.length;
    this.chatHistory = this.chatHistory.filter(m => m.userId !== undefined && !safeUserIds.includes(m.userId));
    const afterLen = this.chatHistory.length;
    if (afterLen !== beforeLen) {
      await this.saveChatHistory();
      const memoryDeleted = beforeLen - afterLen;
      // 如果 Mongo 没有删到，使用内存删除数量兜底
      if (totalDeleted < memoryDeleted) totalDeleted = memoryDeleted;
      for (const uid of safeUserIds) {
        if (!details.find(d => d.userId === uid)) {
          details.push({ userId: uid, deleted: 1 });
        }
      }
    }

    return { deleted: totalDeleted, details };
  }

  // 仅管理员使用：删除所有用户历史（危险操作，优先 drop 集合，失败则 deleteMany）
  public async adminDeleteAllUsers(): Promise<{ deletedCount: number }> {
    try {
      const startedAt = Date.now();
      const mongoConnected = mongoose.connection.readyState === 1;
      logger.info('开始删除所有用户聊天历史', { mongoConnected });

      let deletedCount = 0;
      let dbTotalBefore: number | null = null;
      let dbRemaining: number | null = null;

      if (mongoConnected) {
        try {
          dbTotalBefore = await (mongoose.models.LibreChatHistory as any).countDocuments({});
          logger.info('数据库记录总数（删除前）', { total: dbTotalBefore });

          const result = await (mongoose.models.LibreChatHistory as any).deleteMany({});
          deletedCount = typeof result?.deletedCount === 'number' ? result.deletedCount : 0;

          dbRemaining = await (mongoose.models.LibreChatHistory as any).countDocuments({});
          logger.info('数据库删除结果', { deletedCount, remaining: dbRemaining });
        } catch (dbErr) {
          logger.error('数据库删除过程中发生错误', dbErr);
        }
      } else {
        logger.warn('MongoDB 未连接，跳过数据库删除');
      }

      const memoryBefore = this.chatHistory.length;
      logger.info('内存记录数（删除前）', { memoryBefore });
      if (memoryBefore > 0) {
        this.chatHistory = [];
        await this.saveChatHistory();
        const memoryAfter = this.chatHistory.length;
        logger.info('内存与本地缓存已清空', { memoryAfter });
      } else {
        logger.info('内存无记录，无需清空');
      }

      const durationMs = Date.now() - startedAt;
      logger.info('删除所有用户聊天历史完成', {
        durationMs,
        deletedCount,
        mongoConnected,
        dbTotalBefore,
        dbRemaining
      });

      return { deletedCount };
    } catch (error) {
      logger.error('删除所有聊天历史失败:', error);
      throw error;
    }
  }

  public async adminDeleteAllUsersAction(payload: { confirm?: boolean }): Promise<{ statusCode: number; body: any }> {
    if (!payload?.confirm) {
      logger.warn('拒绝执行删除所有用户历史：缺少确认标志');
      return { statusCode: 400, body: { error: '请确认删除所有用户历史' } };
    }
    const { deletedCount } = await this.adminDeleteAllUsers();
    const body = {
      message: `已删除所有用户历史，共 ${deletedCount} 个用户`,
      deletedCount
    };
    return { statusCode: 200, body };
  }

  /**
   * 导出指定 token 的全部历史为纯文本
   */
  public async exportHistoryText(token: string, userId?: string): Promise<{ content: string; count: number }> {
    // 优先从 MongoDB 读取
    let userMessages: ChatMessage[] = [];
    if (mongoose.connection.readyState === 1) {
      const keyId = sanitizeId(userId || token);
      const doc = await (mongoose.models.LibreChatHistory as any).findOne({ userId: keyId }).lean();
      if (doc && Array.isArray(doc.messages)) userMessages = doc.messages as ChatMessage[];
    }
    if (userMessages.length === 0) {
      const safeUserId = sanitizeId(userId);
      const safeToken = sanitizeId(token);
      userMessages = this.chatHistory.filter(msg => safeUserId ? msg.userId === safeUserId : msg.token === safeToken);
    }
    const count = userMessages.length;
    const now = new Date();
    const header = `LibreChat 历史导出\n导出时间：${now.toLocaleString()}\nToken：${token}\n总条数：${count}\n\n`;
    const lines = userMessages.map((m, idx) => {
      // 历史中未保存角色信息，保留通用格式
      const ts = m.timestamp ? ` @ ${m.timestamp}` : '';
      const content = sanitizeAssistantText(m.message || '');
      return `#${idx + 1}${ts}\n${content}\n`;
    });
    return { content: header + lines.join('\n'), count };
  }

  // 清理方法，用于测试环境
  public cleanup() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
  }
}

export const libreChatService = LibreChatService.getInstance(); 