import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Monitor,
  Cpu,
  HardDrive,
  Leaf,
  Moon,
  Sun,
  Info,
  Activity,
  Database,
  Clock
} from 'lucide-react';

interface SystemInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
  python: string;
  pytorch: string;
  cuda_available: boolean;
  database_path: string;
  data_dir: string;
  uptime: number;
}

interface AboutPageProps {
  onSectionChange: (section: string) => void;
}

const AboutPage: React.FC<AboutPageProps> = ({ onSectionChange }) => {
  const { t } = useTranslation();
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSystemInfo = async () => {
      try {
        const response = await fetch('/api/system/info/');
        if (response.ok) {
          const data = await response.json();
          setSystemInfo(data);
        }
      } catch (error) {
        console.error('Failed to fetch system info', error);
      } finally {
        setLoading(false);
      }
    };

    fetchSystemInfo();
  }, []);

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const version = '1.2.0';

  const features = [
    {
      icon: Leaf,
      title: t('about.features.detection.title'),
      description: t('about.features.detection.desc')
    },
    {
      icon: Activity,
      title: t('about.features.efficiency.title'),
      description: t('about.features.efficiency.desc')
    },
    {
      icon: Database,
      title: t('about.features.offline.title'),
      description: t('about.features.offline.desc')
    },
    {
      icon: Monitor,
      title: t('about.features.crossplatform.title'),
      description: t('about.features.crossplatform.desc')
    }
  ];

  const techStack = [
    { label: 'Electron', value: systemInfo?.electron || '...' },
    { label: 'Chrome', value: systemInfo?.chrome || '...' },
    { label: 'Node.js', value: systemInfo?.node || '...' },
    { label: 'Python', value: systemInfo?.python || '...' },
    { label: 'PyTorch', value: systemInfo?.pytorch || '...' },
    { label: 'CUDA', value: systemInfo?.cuda_available ? t('about.cudaSupported') : t('about.cudaUnsupported') }
  ];

  return (
    <div className="min-h-screen bg-[#f5f7f4] px-4 py-8 dark:bg-slate-900 dark:text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1440px]">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">
            {t('about.title')}
          </h1>
          <p className="mt-2 text-slate-600 dark:text-slate-400">
            {t('about.description', '木薯采后腐烂面积智能预测系统')}
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <div className="rounded-[32px] border border-white/80 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.06)] dark:border-slate-700/80 dark:bg-slate-800/90 dark:shadow-[0_24px_80px_rgba(0,0,0,0.3)]">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
                  <Info className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                    {t('about.systemTitle')}
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    v{version}
                  </p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-7 text-slate-600 dark:text-slate-400">
                {t('about.developedBy')}
              </p>
            </div>

            <div className="rounded-[32px] border border-white/80 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.06)] dark:border-slate-700/80 dark:bg-slate-800/90 dark:shadow-[0_24px_80px_rgba(0,0,0,0.3)]">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                {t('about.techArchitecture')}
              </h3>
              <div className="mt-4 space-y-3">
                {techStack.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-700/50"
                  >
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      {item.label}
                    </span>
                    <span className="text-sm font-medium text-slate-900 dark:text-white">
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[32px] border border-white/80 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.06)] dark:border-slate-700/80 dark:bg-slate-800/90 dark:shadow-[0_24px_80px_rgba(0,0,0,0.3)]">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                {t('about.systemInfo')}
              </h3>
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-700/50">
                  <div className="flex items-center gap-2">
                    <Monitor className="h-4 w-4 text-slate-500" />
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      {t('about.platform')}
                    </span>
                  </div>
                  <span className="text-sm font-medium text-slate-900 dark:text-white">
                    {systemInfo?.platform || 'Windows'} ({systemInfo?.arch || 'x64'})
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-700/50">
                  <div className="flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-slate-500" />
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      {t('about.dataDir')}
                    </span>
                  </div>
                  <span className="truncate max-w-[200px] text-sm font-medium text-slate-900 dark:text-white">
                    {systemInfo?.data_dir || '...'}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-700/50">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-slate-500" />
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      {t('about.database')}
                    </span>
                  </div>
                  <span className="truncate max-w-[200px] text-sm font-medium text-slate-900 dark:text-white">
                    {systemInfo?.database_path || '...'}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-700/50">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-slate-500" />
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      {t('about.uptime')}
                    </span>
                  </div>
                  <span className="text-sm font-medium text-slate-900 dark:text-white">
                    {systemInfo ? formatUptime(systemInfo.uptime) : '...'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-[32px] border border-white/80 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.06)] dark:border-slate-700/80 dark:bg-slate-800/90 dark:shadow-[0_24px_80px_rgba(0,0,0,0.3)]">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                {t('about.coreFeatures')}
              </h3>
              <div className="mt-4 space-y-4">
                {features.map((feature) => {
                  const Icon = feature.icon;
                  return (
                    <div key={feature.title} className="flex gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-medium text-slate-900 dark:text-white">
                          {feature.title}
                        </p>
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                          {feature.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-[32px] border border-white/80 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.06)] dark:border-slate-700/80 dark:bg-slate-800/90 dark:shadow-[0_24px_80px_rgba(0,0,0,0.3)]">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                {t('about.acknowledgments')}
              </h3>
              <p className="mt-4 text-sm leading-7 text-slate-600 dark:text-slate-400">
                {t('about.basedOnOpenSource')}
              </p>
              <ul className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-400">
                <li>• React + TypeScript + Tailwind CSS</li>
                <li>• Electron</li>
                <li>• Django + Django REST Framework</li>
                <li>• PyTorch + torchvision</li>
                <li>• OpenCV</li>
              </ul>
            </div>

            <div className="rounded-[32px] border border-white/80 bg-gradient-to-br from-emerald-500 to-cyan-500 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)]">
              <h3 className="text-lg font-semibold text-white">
                {t('about.contactTitle')}
              </h3>
              <p className="mt-2 text-sm leading-7 text-white/90">
                {t('about.contactSchool')}
                <br />
                {t('about.contactTeam')}
                <br />
                {t('contact.locations.hainnu.email')}
              </p>
              <button
                onClick={() => onSectionChange('contact')}
                className="mt-4 inline-flex h-10 items-center justify-center rounded-xl bg-white px-4 text-sm font-medium text-emerald-700 transition hover:bg-white/90"
              >
                {t('about.viewMoreContact')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AboutPage;