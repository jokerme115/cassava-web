import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Brain,
  ChevronRight,
  Globe2,
  Leaf,
  Microscope,
  Shield,
  Sparkles
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { analyticsApi, systemSettingsApi } from '../services/api';

interface HomePageProps {
  onSectionChange: (section: string) => void;
}

/**
 * 首页布局口径（企业版）：
 * - 垂直节奏统一为 16px（gap-4），区块内留白 20–24px，避免大块空白；
 * - 所有卡片等高：网格用 auto-rows-fr + 卡片 h-full flex flex-col，正文 line-clamp 兜底，
 *   内容长短不再把卡片撑成高低不齐；
 * - 字号固定阶梯：标题 40/24/18，正文 14，辅助 12/11，不再混用 56px 营销字号。
 */
const HomePage: React.FC<HomePageProps> = ({ onSectionChange }) => {
  const { t } = useTranslation();
  const [currentSlide, setCurrentSlide] = useState(0);
  const [siteAnnouncement, setSiteAnnouncement] = useState('');
  const [statsValues, setStatsValues] = useState({
    visits: 0,
    accuracy: 90,
    prediction_usage: 0,
    images_predicted: 0
  });
  const [animatedNumbers, setAnimatedNumbers] = useState({
    visits: 0,
    accuracy: 0,
    prediction_usage: 0,
    images_predicted: 0
  });

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const settings = await systemSettingsApi.getPublic();
        if (settings.site_announcement) {
          setSiteAnnouncement(settings.site_announcement);
        }
      } catch (error) {
        console.error('Failed to fetch public settings', error);
      }
    };

    fetchSettings();
  }, []);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const data = await analyticsApi.getPublicStats();
        setStatsValues((prev) => ({
          ...prev,
          prediction_usage: data.prediction_usage_count,
          images_predicted: data.images_predicted_count,
          visits: data.visit_count
        }));
      } catch (error) {
        console.error('Failed to fetch public stats', error);
      }
    };

    fetchStats();
  }, []);

  const slides = useMemo(
    () => [
      {
        title: t('homepage.hero.title'),
        subtitle: t('homepage.hero.subtitle'),
        description: '',
        key: 'prediction',
        image: '/cases/ppd-example.png',
        imageWebp: '',
        imageWebpSm: '',
        imageAlt: '木薯横截面智能分割示意',
        icon: Brain,
        action: 'prediction'
      },
      {
        title: t('homepage.hero.title'),
        subtitle: '科研样本、图像与分析流程集中管理',
        description: '围绕上传、预测、结果归档建立清晰链路，先浏览公共内容，再按需进入登录操作。',
        key: 'images',
        image: '/banners/archive.png',
        imageWebp: '/banners/archive.webp',
        imageWebpSm: '/banners/archive-sm.webp',
        imageAlt: '木薯科研样本图像管理示意',
        icon: BarChart3,
        action: 'images'
      },
      {
        title: t('homepage.hero.title'),
        subtitle: '联合实验室成果沉淀为可用平台',
        description: '把木薯采后腐烂量化研究转化为可视化、可回溯、可协作的检测界面。',
        key: 'results',
        image: '/banners/research.png',
        imageWebp: '/banners/research.webp',
        imageWebpSm: '/banners/research-sm.webp',
        imageAlt: '木薯样本采集与实验室分析场景示意',
        icon: Microscope,
        action: 'results'
      }
    ],
    [t]
  );

  useEffect(() => {
    const timers: number[] = [];

    Object.entries(statsValues).forEach(([key, value]) => {
      let current = 0;
      const increment = Math.max(1, value / 40);
      const timer = window.setInterval(() => {
        current += increment;
        if (current >= value) {
          current = value;
          window.clearInterval(timer);
        }

        setAnimatedNumbers((prev) => ({
          ...prev,
          [key]: Math.floor(current)
        }));
      }, 35);

      timers.push(timer);
    });

    return () => {
      timers.forEach((timer) => window.clearInterval(timer));
    };
  }, [statsValues]);

  const stats = [
    { label: t('homepage.stats.visits'), value: animatedNumbers.visits, suffix: '+' },
    { label: t('homepage.stats.prediction_usage'), value: animatedNumbers.prediction_usage, suffix: '+' },
    { label: t('homepage.stats.images_predicted'), value: animatedNumbers.images_predicted, suffix: '+' }
  ];

  const strengths = [
    { icon: Brain, title: '资料归档', value: '原图与拍摄信息', tags: ['文件夹', 'ZIP / 7Z / RAR'], mark: '01' },
    { icon: BarChart3, title: '批量分析', value: '模型队列', tags: ['批量预测', '后台处理'], mark: '02' },
    { icon: Shield, title: '人工复检', value: '逐像素校正', tags: ['双层掩码', '修订留存'], mark: '03' },
    { icon: Globe2, title: '成果导出', value: '图像与数值', tags: ['轮廓成图', 'CSV / Excel / ZIP'], mark: '04' },
  ];

  const researchBlocks = [
    {
      icon: Leaf,
      title: t('homepage.about.team.title'),
      lead: t('homepage.about.team.leader'),
      platform: t('homepage.about.team.platform'),
      details: t('homepage.about.team.project')
    },
    {
      icon: Microscope,
      title: t('homepage.about.research.title'),
      lead: t('homepage.about.research.leader'),
      platform: t('homepage.about.research.platform'),
      details: `${t('homepage.about.research.project')}\n${t('homepage.about.research.papers')}\n${t('homepage.about.research.patents')}`
    }
  ];

  const currentHero = slides[currentSlide];
  const cardClass = 'rounded-[20px] border border-hairline bg-white shadow-[0_6px_24px_rgba(28,56,39,0.035)]';

  return (
    <div className="research-home text-ink">
      {siteAnnouncement && (
        <div className="border-b border-hairline bg-white px-4 py-2.5 text-center text-xs text-ink-secondary">
          <div className="mx-auto flex max-w-[1440px] items-center justify-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-accent-text" />
            <span>{siteAnnouncement}</span>
          </div>
        </div>
      )}

      <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-8 px-4 py-6 sm:px-8 lg:px-10 lg:py-10">
        {/* Hero：左信息卡 / 右图 + 四特性卡，两列等高 */}
        <section className="grid gap-6 lg:grid-cols-[1.02fr_0.98fr] lg:items-stretch">
          <div className={`research-hero-copy flex h-full flex-col p-5 sm:p-6 ${cardClass}`}>
            <div>
              <div className="inline-flex items-center gap-2 rounded-pill border border-hairline bg-surface-muted px-3 py-1.5 text-xs font-medium text-ink-secondary">
                <Leaf className="h-3.5 w-3.5 text-accent-text" />
                {t('homepage.hero.tagline')}
              </div>

              <h1 className="research-hero-title mt-7 max-w-2xl text-ink">
                看见木薯的变化，<br />量化每一处 PPD。
              </h1>
              <p className="mt-3 text-base leading-7 text-ink-secondary">{currentHero.subtitle}</p>


              <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
                <button
                  onClick={() => onSectionChange('prediction')}
                  className="inline-flex h-10 items-center justify-center rounded-md bg-brand-fill px-4 text-sm font-semibold text-white transition hover:bg-brand-fill-hover"
                >
                  {t('homepage.hero.action')}
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </button>
                <button
                  onClick={() => onSectionChange('contact')}
                  className="inline-flex h-10 items-center justify-center rounded-md border border-hairline-strong bg-white px-4 text-sm font-medium text-ink-secondary transition hover:bg-surface-muted"
                >
                  了解团队
                </button>
              </div>
            </div>

            <div className="mt-5">
              <div className="grid grid-cols-3 gap-2.5">
                {stats.map((stat) => (
                  <div
                    key={stat.label}
                    className="flex min-h-[72px] flex-col justify-center rounded-md border border-hairline bg-surface-muted px-3 py-2"
                  >
                    <div className="text-lg font-semibold leading-tight tabular-nums text-ink">{stat.value}{stat.suffix}</div>
                    <div className="mt-0.5 truncate text-xs leading-4 text-muted">{stat.label}</div>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex gap-1.5">
                {slides.map((slide, index) => (
                  <button
                    key={slide.key}
                    onClick={() => setCurrentSlide(index)}
                    className={`h-1 rounded-full transition-all ${
                      currentSlide === index ? 'w-8 bg-brand-fill' : 'w-4 bg-hairline-strong'
                    }`}
                    aria-label={slide.title}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="research-hero-image relative h-[300px] overflow-hidden border border-hairline bg-surface-muted sm:h-[380px] lg:h-auto">
              {slides.map((slide, index) => (
                <div
                  key={slide.key}
                  className={`absolute inset-0 transition-all duration-700 ${
                    currentSlide === index
                      ? 'translate-y-0 opacity-100'
                      : 'pointer-events-none translate-y-4 opacity-0'
                  }`}
                >
                  <picture>
                    {slide.imageWebp && <source
                      type="image/webp"
                      srcSet={`${slide.imageWebpSm} 900w, ${slide.imageWebp} 1586w`}
                      sizes="(min-width: 1024px) 46vw, 100vw"
                    />}
                    <img
                      src={slide.image}
                      alt={slide.imageAlt}
                      className="absolute inset-0 h-full w-full object-cover"
                      style={{ objectPosition: 'center top' }}
                      loading={index === 0 ? 'eager' : 'lazy'}
                      decoding="async"
                      {...(index === 0 ? { fetchpriority: 'high' } : {})}
                    />
                  </picture>
                </div>
              ))}
            </div>

        </section>

        <section className="grid gap-6 py-5 sm:grid-cols-2 lg:grid-cols-4" aria-label="分析流程">
          {[
            ['01', '资料有序归档', '图片、文件夹或压缩包直接导入，保留拍摄信息与目录层级。'],
            ['02', '模型辅助量化', '选择可追溯的模型，逐切面查看主体、病斑与 PPD 面积比例。'],
            ['03', '人工认真复检', '放大检查、精细修改，原预测和每次人工修订分别保留。'],
            ['04', '按需导出成图', '轮廓、填色与版式自由调整，成图和数值表采用同一版本。'],
          ].map(([number, title]) => <article key={number} className="research-step"><span className="research-step-number">{number}</span><h2 className="mt-4 text-lg font-semibold">{title}</h2></article>)}
        </section>
        <section className="overflow-hidden rounded-[24px] border border-hairline bg-white">
          <div className="flex flex-wrap items-end justify-between gap-3 p-6 sm:p-8"><div><p className="text-xs tracking-[.2em] text-accent-text">FROM IMAGE TO MEASUREMENT</p><h2 className="mt-3 text-2xl font-semibold">切面上的细微变化，也能清楚呈现</h2><p className="mt-3 text-sm text-muted">PPD 结果示例</p></div><button onClick={() => onSectionChange('prediction')} className="text-sm font-semibold text-accent-text">开始分析 →</button></div>
          <img src="/cases/ppd-example.png" alt="三个真实木薯切面的轮廓和PPD预测值示例" loading="lazy" decoding="async" className="h-auto w-full" />
        </section>

        <section aria-label="平台功能" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {strengths.map(item => <article key={item.title} className="home-capability relative overflow-hidden rounded-[20px] border border-hairline bg-white p-5 sm:p-6">
            <div className="flex items-center justify-between"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-muted text-brand-fill"><item.icon className="h-5 w-5" /></span><span className="font-sans text-sm text-muted/60">{item.mark}</span></div>
            <p className="mt-5 text-xs font-medium tracking-widest text-muted">{item.title}</p>
            <h2 className="mt-2 text-xl font-semibold tracking-normal text-ink">{item.value}</h2>
            <div className="mt-5 flex flex-wrap gap-x-3 gap-y-2 border-t border-hairline pt-4 text-xs text-ink-secondary">{item.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
          </article>)}
        </section>

        <section aria-label="联合研究团队">
          <div className="mb-5 flex items-center justify-between"><h2 className="text-2xl font-semibold">联合研究团队</h2><button onClick={() => onSectionChange('contact')} className="inline-flex items-center gap-2 text-sm font-medium text-accent-text">了解团队<ArrowRight className="h-4 w-4" /></button></div>
          <div className="grid gap-5 lg:grid-cols-2">
            {researchBlocks.map((block, index) => <article key={block.title} className="grid overflow-hidden rounded-[22px] border border-hairline bg-white sm:grid-cols-[132px_minmax(0,1fr)]">
              <div className="relative flex min-h-[150px] items-center justify-center overflow-hidden bg-surface-muted">
                {index === 0 ? <img src="/cases/cassava-lab.jpg" alt="木薯切面实验照片" loading="lazy" className="h-full w-full object-cover" /> : <img src="/assets/logo-128.webp" alt="联合研究标识" loading="lazy" className="h-20 w-20 object-contain" />}
              </div>
              <div className="flex flex-col p-5 sm:p-6"><p className="text-xs font-medium tracking-wider text-accent-text">{index === 0 ? '中国热带农业科学院' : '海南师范大学'}</p><h3 className="mt-3 text-lg font-semibold leading-relaxed text-ink">{block.title}</h3><div className="mt-5 flex flex-wrap gap-2">{(index === 0 ? ['种质资源', '品种选育', '田间研究'] : ['计算机视觉', '人工智能', '科研协作']).map(tag => <span key={tag} className="rounded-md bg-surface-muted px-2 py-1 text-xs text-ink-secondary">{tag}</span>)}</div></div>
            </article>)}
          </div>
        </section>

        {/* CTA */}
        <section className="rounded-xl bg-brand-fill px-5 py-5 text-white sm:px-6 sm:py-6">
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/80">
                {t('homepage.cta.title')}
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-normal">
                从一批图片开始。
              </h2>
            </div>

            <div className="flex flex-col gap-2.5 sm:flex-row">
              <button
                onClick={() => onSectionChange('prediction')}
                className="inline-flex h-10 items-center justify-center rounded-md bg-white px-4 text-sm font-semibold text-brand-fill transition hover:bg-white/90"
              >
                {t('homepage.cta.action')}
                <ChevronRight className="ml-1.5 h-4 w-4" />
              </button>
              <button
                onClick={() => onSectionChange('contact')}
                className="inline-flex h-10 items-center justify-center rounded-md border border-white/30 px-4 text-sm font-medium text-white transition hover:bg-white/10"
              >
                {t('homepage.cta.contact')}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default HomePage;
