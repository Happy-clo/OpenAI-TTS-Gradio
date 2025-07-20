import dotenv from 'dotenv';
import path from 'path';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// 设置默认值
export const env = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  PORT: process.env.PORT || '3000',
  // Passkey 相关配置
  RP_ID: process.env.RP_ID || 'tts.hapx.one',
  RP_ORIGIN: process.env.RP_ORIGIN || 'https://tts.hapx.one',
  USER_STORAGE_MODE: process.env.USER_STORAGE_MODE || 'file',
};

export const MYSQL_HOST = process.env.MYSQL_HOST || 'localhost';
export const MYSQL_PORT = process.env.MYSQL_PORT ? parseInt(process.env.MYSQL_PORT, 10) : 3306;
export const MYSQL_USER = process.env.MYSQL_USER || 'root';
export const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || '';
export const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'happy_tts'; 
// Cloudflare Turnstile 配置
export const CLOUDFLARE_TURNSTILE_SECRET_KEY = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY || '';
export const CLOUDFLARE_TURNSTILE_SITE_KEY = process.env.CLOUDFLARE_TURNSTILE_SITE_KEY || '';