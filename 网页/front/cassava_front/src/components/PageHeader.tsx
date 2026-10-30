import React from 'react';

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  leading?: React.ReactNode;
  className?: string;
};

/**
 * 全站统一页头骨架：标题 + 可选副标题 + 右侧操作区。
 * 所有业务页的顶层标题都应走这里，避免有些页把标题放在卡片外、有些放在卡片内。
 */
export default function PageHeader({ title, subtitle, actions, leading, className }: PageHeaderProps) {
  return (
    <div className={`flex flex-wrap items-start justify-between gap-3 ${className ?? ''}`}>
      <div className="flex min-w-0 items-center gap-3">
        {leading}
        <div className="min-w-0">
          <h2 className="page-title truncate">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
