import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Brain,
  CheckCircle2,
  ChevronRight,
  Leaf,
  Microscope,
  Server,
  Shield,
  Sparkles
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { systemSettingsApi, systemStatsApi } from '../services/api';

interface HomePageProps {
  onSectionChange: (section: string) => void;
}

const HomePage: React.FC<HomePageProps> = ({ onSectionChange }) => {
  const { t } = useTranslation();
  const [currentSlide, setCurrentSlide] = useState(0);
  const [siteAnnouncement, setSiteAnnouncement] = useState('');
  const [statsValues, setStatsValues] = useState({
    visits: 0,
    accuracy: 98,
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

    const fetchStats = async () => {
      try {
        const stats = await systemStatsApi.get();
        setStatsValues({
          visits: 0,
          accuracy: 98,
          prediction_usage: stats.total_predictions,
          images_predicted: stats.total_images
        });
      } catch (error) {
        console.error('Failed to fetch system stats', error);
      }
    };

    fetchSettings();
    fetchStats();
  }, []);


  const slides = useMemo(
    () => [
      {
        title: t('homepage.hero.title'),
        subtitle: t('homepage.hero.subtitle'),
        description: t('homepage.hero.description'),
        key: 'prediction',
        icon: Brain,
        eyebrow: 'AI Segmentation',
        panelClass: 'from-emerald-500 via-emerald-400 to-sky-400',
        chipClass: 'bg-white/18 text-white',
        action: 'prediction'
      },
      {
        title: t('homepage.hero.title'),
        subtitle: t('homepage.hero.slide_images_subtitle'),
        description: t('homepage.hero.slide_images_desc'),
        key: 'images',
        icon: BarChart3,
        eyebrow: 'Image Archive',
        panelClass: 'from-slate-900 via-slate-800 to-emerald-700',
        chipClass: 'bg-emerald-100/90 text-emerald-900',
        action: 'images'
      },
      {
        title: t('homepage.hero.title'),
        subtitle: t('homepage.hero.slide_results_subtitle'),
        description: t('homepage.hero.slide_results_desc'),
        key: 'results',
        icon: Microscope,
        eyebrow: 'Research Delivery',
        panelClass: 'from-amber-300 via-emerald-300 to-cyan-300',
        chipClass: 'bg-slate-900/80 text-white',
        action: 'results'
      }
    ],
    [t]
  );

  useEffect(() => {
    const interval = window.setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % slides.length);
    }, 5200);

    return () => window.clearInterval(interval);
  }, [slides.length]);

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
    { label: t('homepage.stats.accuracy'), value: animatedNumbers.accuracy, suffix: '%' },
    { label: t('homepage.stats.prediction_usage'), value: animatedNumbers.prediction_usage, suffix: '+' },
    { label: t('homepage.stats.images_predicted'), value: animatedNumbers.images_predicted, suffix: '+' }
  ];

  const strengths = [
    {
      icon: Brain,
      title: t('homepage.features.ai.title'),
      description: t('homepage.features.ai.description')
    },
    {
      icon: BarChart3,
      title: t('homepage.features.analytics.title'),
      description: t('homepage.features.analytics.description')
    },
    {
      icon: Shield,
      title: t('homepage.features.security.title'),
      description: t('homepage.features.security.description')
    },
    {
      icon: Server,
      title: t('homepage.features.system.title'),
      description: t('homepage.features.system.description')
    }
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

  return (
    <div className="bg-[#f5f7f4] text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      {siteAnnouncement && (
        <div className="border-b border-emerald-200/60 bg-emerald-50/80 px-4 py-3 text-center text-sm text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-900/80 dark:text-emerald-100">
          <div className="mx-auto flex max-w-6xl items-center justify-center gap-2">
            <Sparkles className="h-4 w-4" />
            <span>{siteAnnouncement}</span>
          </div>
        </div>
      )}

      <section className="relative overflow-hidden px-4 pb-8 pt-6 sm:px-6 lg:px-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.10),_transparent_26%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.10),_transparent_22%)]" />
        <div className="relative mx-auto grid max-w-[1440px] gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="flex min-h-[calc(100svh-150px)] flex-col justify-between rounded-[40px] bg-slate-900 px-6 py-8 text-white shadow-[0_32px_120px_rgba(15,23,42,0.18)] sm:px-8 sm:py-10 lg:px-10">
            <div>
              <div className="inline-flex items-center gap-3 rounded-full border border-white/12 bg-white/8 px-4 py-2 text-sm text-slate-200 backdrop-blur">
                <Leaf className="h-4 w-4 text-emerald-300" />
                {t('homepage.hero.tagline')}
              </div>

              <h1 className="mt-8 max-w-3xl text-4xl font-semibold leading-[1.05] sm:text-5xl lg:text-6xl">
                {currentHero.title}
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
                {currentHero.subtitle}
              </p>
              <p className="mt-5 max-w-2xl text-sm leading-8 text-slate-400 sm:text-base">
                {currentHero.description}
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <button
                  onClick={() => onSectionChange(currentHero.action)}
                  className="inline-flex h-12 items-center justify-center rounded-full bg-white px-6 text-sm font-medium text-slate-900 transition hover:bg-slate-100"
                >
                  {t('homepage.hero.action')}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </button>
                <button
                  onClick={() => onSectionChange('contact')}
                  className="inline-flex h-12 items-center justify-center rounded-full border border-white/16 bg-white/8 px-6 text-sm font-medium text-white backdrop-blur transition hover:bg-white/14"
                >
                  {t('homepage.hero.demo')}
                </button>
              </div>
            </div>

            <div className="mt-8">
              <div className="grid gap-3 sm:grid-cols-4">
                {stats.map((stat) => (
                  <div key={stat.label} className="rounded-3xl border border-white/10 bg-white/8 px-4 py-5 backdrop-blur">
                    <div className="text-2xl font-semibold text-white">
                      {stat.value}
                      {stat.suffix}
                    </div>
                    <div className="mt-2 text-xs leading-6 text-slate-300">{stat.label}</div>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex gap-2">
                {slides.map((slide, index) => (
                  <button
                    key={slide.key}
                    onClick={() => setCurrentSlide(index)}
                    className={`h-1.5 rounded-full transition-all ${
                      currentSlide === index ? 'w-12 bg-white' : 'w-6 bg-white/30'
                    }`}
                    aria-label={slide.title}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-6">
            <div className="relative min-h-[360px] overflow-hidden rounded-[40px] border border-white/70 bg-white/80 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
              {slides.map((slide, index) => (
                <div
                  key={slide.key}
                  className={`absolute inset-0 transition-all duration-700 ${
                    currentSlide === index
                      ? 'translate-y-0 opacity-100'
                      : 'pointer-events-none translate-y-4 opacity-0'
                  }`}
                >
                  <div className={`h-full w-full bg-gradient-to-br ${slide.panelClass}`}>
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.28),_transparent_26%),radial-gradient(circle_at_bottom_right,_rgba(15,23,42,0.22),_transparent_28%)]" />
                    <div className="absolute inset-0">
                      <div className="absolute -left-8 top-8 h-40 w-40 rounded-full bg-white/12 blur-2xl" />
                      <div className="absolute right-6 top-6 rounded-[28px] border border-white/20 bg-white/12 p-5 backdrop-blur-sm">
                        <slide.icon className="h-10 w-10 text-white" />
                      </div>
                      <div className="absolute bottom-24 left-8 right-8 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-[28px] border border-white/18 bg-white/12 p-4 backdrop-blur-md">
                          <p className="text-xs uppercase tracking-[0.24em] text-white/70">{t('homepage.hero.pipeline_label')}</p>
                          <p className="mt-3 text-lg font-semibold text-white">
                            Upload {'->'} Segment {'->'} Predict
                          </p>
                          <p className="mt-2 text-sm text-white/80">{t('homepage.hero.pipeline_desc')}</p>
                        </div>
                        <div className="rounded-[28px] border border-white/18 bg-slate-950/18 p-4 backdrop-blur-md">
                          <p className="text-xs uppercase tracking-[0.24em] text-white/70">{t('homepage.hero.access_label')}</p>
                          <p className="mt-3 text-lg font-semibold text-white">{t('homepage.hero.storage_label')}</p>
                          <p className="mt-2 text-sm text-white/80">{t('homepage.hero.access_desc')}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/65 via-slate-900/20 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-6 text-white">
                    <span className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] ${slide.chipClass}`}>
                      {slide.eyebrow}
                    </span>
                    <p className="mt-3 text-2xl font-semibold">{slide.subtitle}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              {strengths.map((item) => (
                <div
                  key={item.title}
                  className="rounded-[32px] border border-white/80 bg-white/88 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.05)] dark:border-slate-700/80 dark:bg-slate-800/88 dark:shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 text-xl font-semibold text-slate-900 dark:text-white">{item.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-slate-400">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-[1440px] gap-6 lg:grid-cols-[0.82fr_1.18fr]">
          <div className="rounded-[36px] border border-white/80 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.06)] sm:p-8 dark:border-slate-700/80 dark:bg-slate-800/90 dark:shadow-[0_24px_80px_rgba(0,0,0,0.3)]">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-700 dark:text-emerald-400">
              {t('homepage.advantages.title')}
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
              {t('homepage.advantages.subtitle')}
            </h2>
            <div className="mt-8 space-y-5">
              {[
                t('homepage.advantages.background_desc'),
                t('homepage.advantages.highlights_desc'),
                t('homepage.advantages.performance_desc')
              ].map((text, index) => (
                <div key={index} className="flex items-start gap-3">
                  <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <p className="text-sm leading-7 text-slate-600 dark:text-slate-400">{text}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {researchBlocks.map((block) => (
              <article
                key={block.title}
                className="rounded-[36px] border border-white/80 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.06)] sm:p-8 dark:border-slate-700/80 dark:bg-slate-800/90 dark:shadow-[0_24px_80px_rgba(0,0,0,0.3)]"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white dark:bg-slate-700">
                  <block.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-6 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
                  {block.title}
                </h3>
                <div className="mt-6 space-y-5 text-sm leading-7 text-slate-600 dark:text-slate-400">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-400">
                      {t('homepage.about.labels.leader')}
                    </p>
                    <p className="mt-2">{block.lead}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-400">
                      {t('homepage.about.labels.platform')}
                    </p>
                    <p className="mt-2 whitespace-pre-line">{block.platform}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-400">
                      {t('homepage.about.labels.project')}
                    </p>
                    <p className="mt-2 whitespace-pre-line">{block.details}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 pb-10 pt-2 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-[1440px] rounded-[40px] bg-slate-900 px-6 py-8 text-white shadow-[0_28px_100px_rgba(15,23,42,0.18)] sm:px-8 sm:py-10">
          <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-200">
                {t('homepage.cta.title')}
              </p>
              <h2 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
                {t('homepage.cta.subtitle')}
              </h2>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                onClick={() => onSectionChange('prediction')}
                className="inline-flex h-12 items-center justify-center rounded-full bg-white px-6 text-sm font-medium text-slate-900 transition hover:bg-slate-100"
              >
                {t('homepage.cta.action')}
                <ChevronRight className="ml-2 h-4 w-4" />
              </button>
              <button
                onClick={() => onSectionChange('contact')}
                className="inline-flex h-12 items-center justify-center rounded-full border border-white/16 bg-white/8 px-6 text-sm font-medium text-white transition hover:bg-white/14"
              >
                {t('homepage.cta.contact')}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default HomePage;
