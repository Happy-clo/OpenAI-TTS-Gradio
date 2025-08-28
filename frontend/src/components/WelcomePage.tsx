import React, { memo, lazy, Suspense } from 'react';
import { LazyMotion, domAnimation, m, useReducedMotion } from 'framer-motion';
import { useNotification } from './Notification';
import { FaVolumeUp, FaStar, FaUsers, FaRocket } from 'react-icons/fa';

const AuthFormLazy = lazy(() => import('./AuthForm').then(m => ({ default: m.AuthForm })));

// 统一的 viewport 与过渡动画配置，避免重复创建对象
const VIEWPORT_20 = { once: true, amount: 0.2 } as const;
const VIEWPORT_30 = { once: true, amount: 0.3 } as const;
const VIEWPORT_40 = { once: true, amount: 0.4 } as const;

const HEADER_TRANSITION = { duration: 0.6 } as const;
const ICON_INITIAL = { scale: 0.9, opacity: 0 } as const;
const ICON_VISIBLE = { scale: 1, opacity: 1 } as const;
const ICON_ENTER_TRANSITION = { duration: 0.5, delay: 0.2 } as const;
const DESC_ENTER_TRANSITION = { duration: 0.5, delay: 0.4 } as const;
const AUTH_SPRING_TRANSITION = { duration: 0.6, type: 'spring', stiffness: 120 } as const;
const CARD_SPRING_TRANSITION = { duration: 0.5, type: 'spring', stiffness: 200 } as const;
const ITEM_HOVER = { scale: 1.04, y: -2 } as const;

// 降级方案：当用户偏好减少动态时，使用零时长过渡与纯淡入
const NO_TRANSITION = { duration: 0 } as const;
const FADE_VARIANTS = { hidden: { opacity: 0 }, visible: { opacity: 1 } } as const;

// 静态常量与动画配置，避免每次渲染创建新对象
const FEATURES = [
  { title: '高质量语音', desc: '使用 OpenAI 最新的 TTS 技术，生成自然流畅的语音', icon: FaStar },
  { title: '多种声音选择', desc: '提供多种声音选项，满足不同场景需求', icon: FaUsers },
  { title: '简单易用', desc: '直观的界面设计，轻松上手使用', icon: FaRocket }
] as const;

const headerVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 }
};

const textFadeVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 }
};

const listVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.15 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 30, scale: 0.95 },
  visible: { opacity: 1, y: 0, scale: 1 }
};

// 提取并 memo 化 FeatureCard，避免父组件重渲染导致的子项重复渲染
type FeatureIcon = React.ComponentType<{ className?: string }>;
interface FeatureCardProps {
  title: string;
  desc: string;
  Icon: FeatureIcon;
  variants: any;
  transition: any;
  hover: any;
}
const FeatureCard = memo(function FeatureCard({ title, desc, Icon, variants, transition, hover }: FeatureCardProps) {
  return (
    <m.div
      className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-white/20 p-6 hover:shadow-2xl transition-all duration-300"
      variants={variants}
      transition={transition}
      whileHover={hover}
    >
      <div className="flex items-center gap-3 mb-4">
        <Icon className="text-2xl text-blue-600" />
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      </div>
      <p className="text-gray-600">{desc}</p>
    </m.div>
  );
});

function WelcomePageComponent(): React.ReactElement {
  const { setNotification } = useNotification();
  const prefersReducedMotion = useReducedMotion();

  // 智能降级：根据用户系统偏好减少动画强度，并通过 useMemo 稳定对象引用
  const effectiveHeaderVariants = React.useMemo(() => (
    prefersReducedMotion ? FADE_VARIANTS : headerVariants
  ), [prefersReducedMotion]);
  const effectiveItemVariants = React.useMemo(() => (
    prefersReducedMotion ? FADE_VARIANTS : itemVariants
  ), [prefersReducedMotion]);
  const effectiveHeaderTransition = React.useMemo(() => (
    prefersReducedMotion ? NO_TRANSITION : HEADER_TRANSITION
  ), [prefersReducedMotion]);
  const effectiveAuthTransition = React.useMemo(() => (
    prefersReducedMotion ? NO_TRANSITION : AUTH_SPRING_TRANSITION
  ), [prefersReducedMotion]);
  const effectiveCardTransition = React.useMemo(() => (
    prefersReducedMotion ? NO_TRANSITION : CARD_SPRING_TRANSITION
  ), [prefersReducedMotion]);
  const effectiveIconInitial = React.useMemo(() => (
    prefersReducedMotion ? undefined : ICON_INITIAL
  ), [prefersReducedMotion]);
  const effectiveIconVisible = React.useMemo(() => (
    prefersReducedMotion ? undefined : ICON_VISIBLE
  ), [prefersReducedMotion]);
  const effectiveIconEnterTransition = React.useMemo(() => (
    prefersReducedMotion ? NO_TRANSITION : ICON_ENTER_TRANSITION
  ), [prefersReducedMotion]);
  const effectiveDescEnterTransition = React.useMemo(() => (
    prefersReducedMotion ? NO_TRANSITION : DESC_ENTER_TRANSITION
  ), [prefersReducedMotion]);
  const effectiveItemHover = React.useMemo(() => (
    prefersReducedMotion ? undefined : ITEM_HOVER
  ), [prefersReducedMotion]);

  // 空闲时间预取：在浏览器空闲时预加载 AuthForm，提升首次交互体验
  React.useEffect(() => {
    const win: any = typeof window !== 'undefined' ? window : undefined;
    const schedule = win && win.requestIdleCallback ? win.requestIdleCallback : (cb: () => void) => setTimeout(cb, 300);
    const cancel = win && win.cancelIdleCallback ? win.cancelIdleCallback : (id: any) => clearTimeout(id);
    const id = schedule(() => { import('./AuthForm'); });
    return () => cancel(id);
  }, []);

  return (
    <LazyMotion features={domAnimation}>
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 py-8 rounded-3xl">
        <div className="max-w-7xl mx-auto px-4 space-y-8">
          {/* 统一的标题头部 */}
          <m.div
            className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-white/20 overflow-hidden"
            initial="hidden"
            whileInView="visible"
            viewport={VIEWPORT_30}
            variants={effectiveHeaderVariants}
            transition={effectiveHeaderTransition}
          >
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6">
              <div className="text-center">
                <m.div
                  className="flex items-center justify-center gap-3 mb-4"
                  initial={effectiveIconInitial}
                  whileInView={effectiveIconVisible}
                  viewport={VIEWPORT_40}
                  transition={effectiveIconEnterTransition}
                >
                  <FaVolumeUp className="text-4xl" />
                  <h1 className="text-4xl font-bold">欢迎使用 Happy TTS</h1>
                </m.div>
                <m.p
                  className="text-blue-100 text-lg"
                  variants={textFadeVariants}
                  initial="hidden"
                  whileInView="visible"
                  viewport={VIEWPORT_40}
                  transition={effectiveDescEnterTransition}
                >
                  使用最新的语音合成技术，生成自然流畅的语音
                </m.p>
              </div>
            </div>

            {/* 登录表单区域 */}
            <div className="p-6">
              <m.div
                className="max-w-md mx-auto"
                variants={effectiveItemVariants}
                initial="hidden"
                whileInView="visible"
                viewport={VIEWPORT_30}
                transition={effectiveAuthTransition}
              >
                <Suspense fallback={<div className="h-20 flex items-center justify-center text-gray-500">加载中...</div>}>
                  <AuthFormLazy setNotification={setNotification} />
                </Suspense>
              </m.div>
            </div>
          </m.div>

          {/* 功能特色卡片 */}
          <m.div
            initial="hidden"
            whileInView="visible"
            viewport={VIEWPORT_20}
            variants={listVariants}
            className="grid grid-cols-1 md:grid-cols-3 gap-6"
          >
            {FEATURES.map((item) => (
              <FeatureCard
                key={item.title}
                title={item.title}
                desc={item.desc}
                Icon={item.icon as FeatureIcon}
                variants={effectiveItemVariants}
                transition={effectiveCardTransition}
                hover={effectiveItemHover}
              />
            ))}
          </m.div>
        </div>
      </div>
    </LazyMotion>
  );
}

export const WelcomePage = memo(WelcomePageComponent);