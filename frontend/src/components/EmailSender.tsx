import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'react-toastify';
import MarkdownPreview from './MarkdownPreview'; // Added MarkdownPreview import
import DOMPurify from 'dompurify';
import { useNotification } from './Notification';

export interface EmailSenderProps {
  to: string;
  subject: string;
  content: string;
  code: string;
  setTo: (v: string) => void;
  setSubject: (v: string) => void;
  setContent: (v: string) => void;
  setCode: (v: string) => void;
  loading: boolean;
  success: string;
  error: string;
  handleSend: () => void;
  isOutEmail?: boolean;
}

interface EmailForm {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text?: string;
}

interface ServiceStatus {
  available: boolean;
  error?: string;
}

interface EmailQuota {
  used: number;
  total: number;
  resetAt: string; // ISO 时间
}

const EmailSender: React.FC<EmailSenderProps> = (props) => {
  const [form, setForm] = useState<EmailForm>({
    from: `noreply@${import.meta.env.VITE_RESEND_DOMAIN || 'hapxs.com'}`,
    to: [''],
    subject: '',
    html: '<h1>Hello World</h1><p>这是一封测试邮件。</p>',
    text: ''
  });
  const [loading, setLoading] = useState(false);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [emailMode, setEmailMode] = useState<'html' | 'simple' | 'markdown'>('html');
  const [simpleContent, setSimpleContent] = useState('');
  const [markdownContent, setMarkdownContent] = useState('');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const htmlEditorRef = useRef<HTMLTextAreaElement>(null);
  const { setNotification } = useNotification();
  const [quota, setQuota] = useState<EmailQuota>({ used: 0, total: 100, resetAt: '' });
  const [senderDomains, setSenderDomains] = useState<string[]>([]);

  // 获取API基础URL
  const getApiBaseUrl = () => {
    if (import.meta.env.DEV) return '';
    if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
    return 'https://api.hapxs.com';
  };

  const api = axios.create({
    baseURL: getApiBaseUrl(),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem('token')}`
    }
  });

  // 获取发件人域名（自动适配后端环境变量）
  const getResendDomain = () => {
    return import.meta.env.VITE_RESEND_DOMAIN || 'hapxs.com';
  };
  const resendDomain = getResendDomain();

  // 获取发件人域名
  useEffect(() => {
    (async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await axios.get('/api/email/domains', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.data.domains) setSenderDomains(res.data.domains);
      } catch {}
    })();
  }, []);

  // 查询配额
  const fetchQuota = async (domain?: string) => {
    try {
      const response = await api.get('/api/email/quota' + (domain ? `?domain=${domain}` : ''));
      setQuota({
        used: response.data.used,
        total: response.data.quotaTotal || response.data.total,
        resetAt: response.data.resetAt
      });
    } catch {}
  };

  // 监听发件人域名变化自动刷新配额
  useEffect(() => {
    const domain = form.from.split('@')[1] || senderDomains[0] || '';
    if (domain) fetchQuota(domain);
    // eslint-disable-next-line
  }, [form.from, senderDomains.length]);

  useEffect(() => {
    checkServiceStatus();
    fetchQuota();
  }, []);

  const checkServiceStatus = async () => {
    try {
      const response = await api.get('/api/email/status');
      setServiceStatus(response.data);
    } catch (error) {
      console.error('检查邮件服务状态失败:', error);
      setServiceStatus({ available: false, error: '无法连接邮件服务' });
    }
  };

  const validateEmails = async (emails: string[]) => {
    try {
      const response = await api.post('/api/email/validate', { emails });
      return response.data;
    } catch (error) {
      console.error('邮箱验证失败:', error);
      return { valid: [], invalid: emails };
    }
  };

  const handleToChange = (index: number, value: string) => {
    const newTo = [...form.to];
    newTo[index] = value;
    setForm({ ...form, to: newTo });
  };

  const addRecipient = () => {
    if (form.to.length < 10) {
      setForm({ ...form, to: [...form.to, ''] });
    }
  };

  const removeRecipient = (index: number) => {
    if (form.to.length > 1) {
      const newTo = form.to.filter((_, i) => i !== index);
      setForm({ ...form, to: newTo });
    }
  };

  const validateForm = async (): Promise<boolean> => {
    const errors: string[] = [];

    // 验证发件人
    if (!form.from.trim()) {
      errors.push('请填写发件人邮箱');
    }

    // 验证收件人
    const validRecipients = form.to.filter(email => email.trim());
    if (validRecipients.length === 0) {
      errors.push('请至少填写一个收件人邮箱');
    }

    // 验证主题
    if (!form.subject.trim()) {
      errors.push('请填写邮件主题');
    }

    // 验证内容
    if (emailMode === 'html' && !form.html.trim()) {
      errors.push('请填写邮件内容');
    } else if (emailMode === 'simple' && !simpleContent.trim()) {
      errors.push('请填写邮件内容');
    } else if (emailMode === 'markdown' && !markdownContent.trim()) {
      errors.push('请填写邮件内容');
    }

    setValidationErrors(errors);

    if (errors.length > 0) {
      return false;
    }

    // 验证邮箱格式
    const allEmails = [...validRecipients]; // 发件人邮箱固定为hapxs.com，无需验证
    const validation = await validateEmails(allEmails);
    
    if (validation.invalid.length > 0) {
      setValidationErrors([`以下邮箱格式无效: ${validation.invalid.join(', ')}`]);
      return false;
    }

    return true;
  };

  const handleSendEmail = async () => {
    if (!(await validateForm())) {
      return;
    }

    setLoading(true);
    try {
      const validRecipients = form.to.filter(email => email.trim());
      
      if (emailMode === 'html') {
        const response = await api.post('/api/email/send', {
          from: form.from,
          to: validRecipients,
          subject: form.subject,
          html: form.html,
          text: form.text
        });

        if (response.data.success) {
          setNotification({ message: '邮件发送成功！', type: 'success' });
          // 重置表单
          setForm({
            from: `noreply@${resendDomain}`,
            to: [''],
            subject: '',
            html: '<h1>Hello World</h1><p>这是一封测试邮件。</p>',
            text: ''
          });
          setSimpleContent('');
        }
      } else if (emailMode === 'simple') {
        const response = await api.post('/api/email/send-simple', {
          from: form.from,
          to: validRecipients,
          subject: form.subject,
          content: simpleContent
        });

        if (response.data.success) {
          setNotification({ message: '邮件发送成功！', type: 'success' });
          // 重置表单
          setForm({
            from: `noreply@${resendDomain}`,
            to: [''],
            subject: '',
            html: '<h1>Hello World</h1><p>这是一封测试邮件。</p>',
            text: ''
          });
          setSimpleContent('');
        }
      } else if (emailMode === 'markdown') {
        const response = await api.post('/api/email/send-markdown', {
          from: form.from,
          to: validRecipients,
          subject: form.subject,
          markdown: markdownContent
        });
        if (response.data.success) {
          setNotification({ message: '邮件发送成功！', type: 'success' });
          setForm({
            from: `noreply@${resendDomain}`,
            to: [''],
            subject: '',
            html: '<h1>Hello World</h1><p>这是一封测试邮件。</p>',
            text: ''
          });
          setSimpleContent('');
          setMarkdownContent('');
        }
      }
    } catch (error: any) {
      console.error('邮件发送失败:', error);
      const errorMessage = error.response?.data?.error || error.message || '邮件发送失败';
      setNotification({ message: errorMessage, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handlePreview = () => {
    setShowPreview(!showPreview);
  };

  const insertHtmlTemplate = (template: string) => {
    if (htmlEditorRef.current) {
      const textarea = htmlEditorRef.current;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = textarea.value;
      const before = text.substring(0, start);
      const after = text.substring(end);
      
      setForm({
        ...form,
        html: before + template + after
      });
      
      // 设置光标位置
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + template.length, start + template.length);
      }, 0);
    }
  };

  const htmlTemplates = [
    { name: '现代卡片', code: `<div style="max-width:420px;margin:0 auto;background:#fff;border-radius:1.2rem;box-shadow:0 4px 24px rgba(80,80,180,0.08);padding:2.2rem 2rem 1.5rem 2rem;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;text-align:center;">
  <div style="font-size:2rem;font-weight:700;color:#6366f1;margin-bottom:1.2rem;">您的验证码</div>
  <div style="font-size:2.4rem;letter-spacing:0.4rem;font-family:monospace;background:#f3f4f6;padding:1rem 0;border-radius:0.8rem;color:#111;font-weight:600;box-shadow:0 2px 8px rgba(99,102,241,0.08);margin-bottom:1.2rem;">12345678</div>
  <div style="color:#555;font-size:1.1rem;margin-bottom:1.2rem;">请在页面输入上方验证码完成验证。验证码有效期10分钟，请勿泄露。</div>
  <a href="https://tts.hapxs.com" style="display:inline-block;margin-top:1.2rem;padding:0.7rem 2.2rem;background:linear-gradient(90deg,#6366f1,#8b5cf6);color:#fff;border-radius:2rem;text-decoration:none;font-weight:600;box-shadow:0 2px 8px rgba(99,102,241,0.12);transition:background 0.2s;">访问 Happy TTS</a>
  <div style="margin-top:2rem;font-size:0.95rem;color:#aaa;">如非本人操作请忽略本邮件</div>
</div>` },
    { name: '标题', code: '<h1>标题</h1>' },
    { name: '段落', code: '<p>段落内容</p>' },
    { name: '粗体', code: '<strong>粗体文本</strong>' },
    { name: '斜体', code: '<em>斜体文本</em>' },
    { name: '链接', code: '<a href="https://example.com">链接文本</a>' },
    { name: '图片', code: '<img src="https://example.com/image.jpg" alt="图片描述" />' },
    { name: '列表', code: '<ul><li>列表项1</li><li>列表项2</li></ul>' },
    { name: '表格', code: '<table border="1"><tr><td>单元格1</td><td>单元格2</td></tr></table>' }
  ];

  // 默认内容美化
  useEffect(() => {
    if (!form.html || form.html === '<h1>Hello World</h1><p>这是一封测试邮件。</p>') {
      setForm(f => ({ ...f, html: htmlTemplates[0].code }));
    }
    // eslint-disable-next-line
  }, []);

  return (
    <motion.div 
      className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      {/* 邮件配额进度条 */}
      <div className="max-w-2xl mx-auto px-4 pt-6">
        <div className="mb-4">
          <div className="flex justify-between items-center mb-1">
            <span className="text-sm text-gray-700 font-medium">今日邮件配额</span>
            <span className="text-xs text-gray-500">{quota.used} / {quota.total} 封 &nbsp;|&nbsp; {quota.resetAt ? `重置时间：${new Date(quota.resetAt).toLocaleString('zh-CN')}` : ''}</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className="bg-gradient-to-r from-indigo-500 to-purple-500 h-3 rounded-full transition-all duration-300"
              style={{ width: `${Math.min(100, (quota.used / quota.total) * 100)}%` }}
            ></div>
          </div>
        </div>
      </div>
      {/* 顶部导航栏 */}
      <motion.div 
        className="bg-white shadow-sm border-b border-gray-100"
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.1 }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <motion.div 
              className="flex items-center space-x-4"
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <Link 
                to="/"
                className="flex items-center space-x-2 text-gray-600 hover:text-indigo-600 transition-colors duration-200"
              >
                <motion.svg 
                  className="w-5 h-5" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                  whileHover={{ scale: 1.1, rotate: -5 }}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </motion.svg>
                <span className="font-medium">返回主页</span>
              </Link>
            </motion.div>

            <motion.div
              className="flex items-center space-x-2"
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.3 }}
            >
              <motion.svg 
                className="w-6 h-6 text-indigo-600" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
                animate={{ rotate: [0, 5, -5, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </motion.svg>
              <h1 className="text-xl font-bold text-gray-900">邮件发送</h1>
            </motion.div>
          </div>
        </div>
      </motion.div>

      {/* 主要内容 */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="grid grid-cols-1 lg:grid-cols-3 gap-8"
        >
          {/* 左侧表单 */}
          <div className="lg:col-span-2">
            <motion.div 
              className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.5 }}
            >
              {/* 表单头部 */}
              <div className="bg-gradient-to-r from-indigo-500 to-purple-600 px-6 py-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold text-white">发送邮件</h2>
                  <div className="flex items-center space-x-2">
                    <motion.button
                      onClick={() => setEmailMode('simple')}
                      className={`px-3 py-1 rounded-lg text-sm font-medium transition-all duration-200 ${
                        emailMode === 'simple' 
                          ? 'bg-white text-indigo-600 shadow-md' 
                          : 'text-white/80 hover:text-white hover:bg-white/10'
                      }`}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      简单模式
                    </motion.button>
                    <motion.button
                      onClick={() => setEmailMode('html')}
                      className={`px-3 py-1 rounded-lg text-sm font-medium transition-all duration-200 ${
                        emailMode === 'html' 
                          ? 'bg-white text-indigo-600 shadow-md' 
                          : 'text-white/80 hover:text-white hover:bg-white/10'
                      }`}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      HTML模式
                    </motion.button>
                    <motion.button
                      onClick={() => setEmailMode('markdown')}
                      className={`px-3 py-1 rounded-lg text-sm font-medium transition-all duration-200 ${
                        emailMode === 'markdown' 
                          ? 'bg-white text-indigo-600 shadow-md' 
                          : 'text-white/80 hover:text-white hover:bg-white/10'
                      }`}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      Markdown模式
                    </motion.button>
                  </div>
                </div>
              </div>

              {/* 表单内容 */}
              <div className="p-6 space-y-6">
                {/* 服务状态 */}
                {serviceStatus && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`p-3 rounded-lg border ${
                      serviceStatus.available 
                        ? 'bg-green-50 border-green-200 text-green-800' 
                        : 'bg-red-50 border-red-200 text-red-800'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <motion.svg 
                        className={`w-5 h-5 ${serviceStatus.available ? 'text-green-500' : 'text-red-500'}`}
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                        animate={{ scale: [1, 1.1, 1] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      >
                        {serviceStatus.available ? (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        )}
                      </motion.svg>
                      <span className="font-medium">
                        {serviceStatus.available ? '邮件服务正常' : '邮件服务异常'}
                      </span>
                    </div>
                    {serviceStatus.error && (
                      <p className="text-sm mt-1">{serviceStatus.error}</p>
                    )}
                  </motion.div>
                )}

                {/* 验证错误 */}
                <AnimatePresence>
                  {validationErrors.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="bg-red-50 border border-red-200 rounded-lg p-4"
                    >
                      <div className="flex items-center space-x-2 mb-2">
                        <motion.svg 
                          className="w-5 h-5 text-red-500" 
                          fill="none" 
                          stroke="currentColor" 
                          viewBox="0 0 24 24"
                          animate={{ rotate: [0, 10, -10, 0] }}
                          transition={{ duration: 0.5 }}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </motion.svg>
                        <span className="font-medium text-red-800">验证错误</span>
                      </div>
                      <ul className="text-sm text-red-700 space-y-1">
                        {validationErrors.map((error, index) => (
                          <li key={index}>• {error}</li>
                        ))}
                      </ul>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* 发件人 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    发件人邮箱 *
                  </label>
                  <div className="flex items-center">
                    <div className="flex-1 flex">
                      <input
                        type="text"
                        value={form.from.split('@')[0]}
                        onChange={(e) => {
                          const username = e.target.value;
                          setForm({ ...form, from: `${username}@${form.from.split('@')[1] || senderDomains[0] || ''}` });
                        }}
                        className="flex-1 px-4 py-3 border border-gray-300 rounded-l-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all duration-200 rounded-r-none"
                        placeholder="noreply"
                      />
                      {senderDomains.length === 1 && (
                        <span className="inline-flex items-center px-3 py-3 border border-l-0 border-gray-300 bg-gray-50 text-gray-600 text-base rounded-r-lg select-none">@{senderDomains[0]}</span>
                      )}
                      {senderDomains.length > 1 && (
                        <select
                          value={form.from.split('@')[1] || senderDomains[0] || ''}
                          onChange={e => {
                            setForm({ ...form, from: `${form.from.split('@')[0]}@${e.target.value}` });
                          }}
                          className="px-2 py-2 border border-l-0 border-gray-300 rounded-r-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all duration-200 bg-white"
                        >
                          {senderDomains.map(domain => (
                            <option key={domain} value={domain}>@{domain}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                </div>

                {/* 收件人 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    收件人邮箱 * (最多10个)
                  </label>
                  <div className="space-y-2">
                    {form.to.map((email, index) => (
                      <div key={index} className="flex items-center space-x-2">
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => handleToChange(index, e.target.value)}
                          className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all duration-200"
                          placeholder={`收件人${index + 1}@example.com`}
                        />
                        {form.to.length > 1 && (
                          <motion.button
                            onClick={() => removeRecipient(index)}
                            className="p-3 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-all duration-200"
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </motion.button>
                        )}
                      </div>
                    ))}
                    {form.to.length < 10 && (
                      <motion.button
                        onClick={addRecipient}
                        className="w-full py-2 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg border-2 border-dashed border-indigo-300 transition-all duration-200"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <div className="flex items-center justify-center space-x-2">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                          </svg>
                          <span>添加收件人</span>
                        </div>
                      </motion.button>
                    )}
                  </div>
                </div>

                {/* 邮件主题 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    邮件主题 *
                  </label>
                  <input
                    type="text"
                    value={form.subject}
                    onChange={(e) => setForm({ ...form, subject: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all duration-200"
                    placeholder="请输入邮件主题"
                  />
                </div>

                {/* 邮件内容 */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">
                      邮件内容 *
                    </label>
                    {emailMode === 'html' && (
                      <motion.button
                        onClick={handlePreview}
                        className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                      >
                        {showPreview ? '隐藏预览' : '预览'}
                      </motion.button>
                    )}
                  </div>

                  {emailMode === 'html' ? (
                    <div className="space-y-4">
                      {/* HTML模板工具栏 */}
                      <div className="flex flex-wrap gap-2">
                        {htmlTemplates.map((template) => (
                          <motion.button
                            key={template.name}
                            onClick={() => insertHtmlTemplate(template.code)}
                            className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-all duration-200"
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                          >
                            {template.name}
                          </motion.button>
                        ))}
                      </div>

                      {/* HTML编辑器 */}
                      <textarea
                        ref={htmlEditorRef}
                        value={form.html}
                        onChange={(e) => setForm({ ...form, html: e.target.value })}
                        className="w-full h-64 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all duration-200 font-mono text-sm"
                        placeholder="请输入HTML格式的邮件内容"
                      />

                      {/* 预览 */}
                      <AnimatePresence>
                        {showPreview && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="border border-gray-300 rounded-lg p-4 bg-gray-50"
                          >
                            <h4 className="text-sm font-medium text-gray-700 mb-2">预览效果：</h4>
                            <div 
                              className="prose prose-sm max-w-none"
                              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(form.html) }}
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ) : emailMode === 'simple' ? (
                    <textarea
                      value={simpleContent}
                      onChange={(e) => setSimpleContent(e.target.value)}
                      className="w-full h-64 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all duration-200"
                      placeholder="请输入邮件内容"
                    />
                  ) : (
                    <div className="space-y-4">
                      <textarea
                        value={markdownContent}
                        onChange={(e) => setMarkdownContent(e.target.value)}
                        className="w-full h-64 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all duration-200 font-mono text-sm"
                        placeholder="请输入Markdown格式的邮件内容"
                      />
                      <div className="border border-gray-300 rounded-lg p-4 bg-gray-50">
                        <h4 className="text-sm font-medium text-gray-700 mb-2">预览效果：</h4>
                        <MarkdownPreview markdown={markdownContent} />
                      </div>
                    </div>
                  )}
                </div>

                {/* 发送按钮 */}
                <motion.button
                  onClick={handleSendEmail}
                  disabled={loading || !serviceStatus?.available}
                  className={`w-full py-4 px-6 rounded-lg font-semibold text-white transition-all duration-200 ${
                    loading || !serviceStatus?.available
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-lg hover:shadow-xl'
                  }`}
                  whileHover={!loading && serviceStatus?.available ? { scale: 1.02 } : {}}
                  whileTap={!loading && serviceStatus?.available ? { scale: 0.98 } : {}}
                >
                  {loading ? (
                    <div className="flex items-center justify-center space-x-2">
                      <motion.div
                        className="w-5 h-5 border-2 border-white border-t-transparent rounded-full"
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      />
                      <span>发送中...</span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center space-x-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                      <span>发送邮件</span>
                    </div>
                  )}
                </motion.button>
              </div>
            </motion.div>
          </div>

          {/* 右侧帮助面板 */}
          <div className="lg:col-span-1">
            <motion.div 
              className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.6 }}
            >
              {/* 面板头部 */}
              <div className="bg-gradient-to-r from-green-500 to-teal-600 px-6 py-4">
                <h3 className="text-lg font-bold text-white">使用帮助</h3>
              </div>

              {/* 面板内容 */}
              <div className="p-6 space-y-6">
                {/* 功能说明 */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">功能说明</h4>
                  <div className="space-y-2 text-sm text-gray-600">
                    <div className="flex items-start space-x-2">
                      <div className="w-2 h-2 bg-indigo-500 rounded-full mt-2 flex-shrink-0"></div>
                      <p>支持HTML、简单文本和Markdown三种邮件格式</p>
                    </div>
                    <div className="flex items-start space-x-2">
                      <div className="w-2 h-2 bg-indigo-500 rounded-full mt-2 flex-shrink-0"></div>
                      <p>最多可同时发送给10个收件人</p>
                    </div>
                    <div className="flex items-start space-x-2">
                      <div className="w-2 h-2 bg-indigo-500 rounded-full mt-2 flex-shrink-0"></div>
                      <p>自动验证邮箱格式</p>
                    </div>
                    <div className="flex items-start space-x-2">
                      <div className="w-2 h-2 bg-indigo-500 rounded-full mt-2 flex-shrink-0"></div>
                      <p>实时预览邮件效果</p>
                    </div>
                  </div>
                </div>

                {/* 使用提示 */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">使用提示</h4>
                  <div className="space-y-2 text-sm text-gray-600">
                    <div className="flex items-start space-x-2">
                      <div className="w-2 h-2 bg-green-500 rounded-full mt-2 flex-shrink-0"></div>
                      <p>发件人邮箱固定为 @{resendDomain} 域名</p>
                    </div>
                    <div className="flex items-start space-x-2">
                      <div className="w-2 h-2 bg-green-500 rounded-full mt-2 flex-shrink-0"></div>
                      <p>HTML模式下可使用模板快速插入标签</p>
                    </div>
                    <div className="flex items-start space-x-2">
                      <div className="w-2 h-2 bg-green-500 rounded-full mt-2 flex-shrink-0"></div>
                      <p>发送前建议先预览邮件效果</p>
                    </div>
                    <div className="flex items-start space-x-2">
                      <div className="w-2 h-2 bg-green-500 rounded-full mt-2 flex-shrink-0"></div>
                      <p>每分钟最多发送5封邮件</p>
                    </div>
                  </div>
                </div>

                {/* 安全提醒 */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">安全提醒</h4>
                  <div className="space-y-2 text-sm text-gray-600">
                    <div className="flex items-start space-x-2">
                      <div className="w-2 h-2 bg-yellow-500 rounded-full mt-2 flex-shrink-0"></div>
                      <p>请勿发送垃圾邮件或恶意内容</p>
                    </div>
                    <div className="flex items-start space-x-2">
                      <div className="w-2 h-2 bg-yellow-500 rounded-full mt-2 flex-shrink-0"></div>
                      <p>注意保护收件人隐私</p>
                    </div>
                    <div className="flex items-start space-x-2">
                      <div className="w-2 h-2 bg-yellow-500 rounded-full mt-2 flex-shrink-0"></div>
                      <p>仅管理员可使用此功能</p>
                    </div>
                  </div>
                </div>

                {/* 服务状态 */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">服务状态</h4>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">邮件服务</span>
                      <div className="flex items-center space-x-2">
                        <div className={`w-2 h-2 rounded-full ${serviceStatus?.available ? 'bg-green-500' : 'bg-red-500'}`}></div>
                        <span className="text-sm font-medium">
                          {serviceStatus?.available ? '正常' : '异常'}
                        </span>
                      </div>
                    </div>
                    <motion.button
                      onClick={checkServiceStatus}
                      className="w-full py-2 text-sm text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition-all duration-200"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      刷新状态
                    </motion.button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
};

export default EmailSender; 