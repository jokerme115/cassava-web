import React, { useState, useEffect, useCallback } from 'react';
import { permissionsApi } from '../services/api';
import { AuditAction, AuditLog, AuditLogQueryParams } from '../services/auditService';
import { useTranslation } from 'react-i18next';

interface AuditLogsProps {
  // 组件属性
}

/**
 * 审计日志管理组件
 */
const AuditLogs: React.FC<AuditLogsProps> = () => {
  const { t, i18n } = useTranslation();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [totalPages, setTotalPages] = useState<number>(0);
  
  // 查询参数
  const [queryParams, setQueryParams] = useState<AuditLogQueryParams>({
    page: 1,
    pageSize: 20,
  });

  // 获取审计日志
  const fetchAuditLogs = useCallback(async (params: AuditLogQueryParams) => {
    try {
      setLoading(true);
      setError(null);
      
      const response: any = await permissionsApi.getAuditLogs(params);
      
      // 适配 DRF 分页响应格式
      // DRF 默认分页返回 { count, next, previous, results }
      // 如果没有分页，可能直接返回数组或 { logs: [...] }
      
      let logsData: AuditLog[] = [];
      let totalCount = 0;
      
      if (Array.isArray(response)) {
          // 直接返回数组的情况
          logsData = response;
          totalCount = response.length;
      } else if (response.results) {
          // DRF 标准分页格式
          logsData = response.results;
          totalCount = response.count || 0;
      } else if (response.logs) {
          // 自定义格式
          logsData = response.logs;
          totalCount = response.total || 0;
      }
      
      setLogs(logsData);
      setTotal(totalCount);
      
      // 如果后端没有返回页码信息，我们使用前端维护的 page
      if (response.page) setPage(response.page);
      if (response.pageSize) setPageSize(response.pageSize);
      
      // 计算总页数
      // 如果 totalCount 来自 DRF 分页的 count，且 pageSize 是当前的 pageSize
      if (totalCount > 0 && pageSize > 0) {
        setTotalPages(Math.ceil(totalCount / pageSize));
      } else {
        setTotalPages(0);
      }
    } catch (err) {
      console.error('获取审计日志失败:', err);
      setError(t('navigation.audit_logs.error'));
      // 确保出错时 logs 不为 undefined
      setLogs([]); 
    } finally {
      setLoading(false);
    }
  }, [pageSize, t]);

  // 处理查询参数变化
  const handleQueryChange = (newParams: Partial<AuditLogQueryParams>) => {
    const updatedParams = { ...queryParams, ...newParams, page: 1 };
    setQueryParams(updatedParams);
    fetchAuditLogs(updatedParams);
  };

  // 处理分页
  const handlePageChange = (newPage: number) => {
    const updatedParams = { ...queryParams, page: newPage };
    setQueryParams(updatedParams);
    setPage(newPage);
    fetchAuditLogs(updatedParams);
  };

  // 获取操作类型描述
  const getActionDescription = (action: AuditAction): string => {
    const raw = String(action || '').trim();
    const actionKey = (raw.includes('.') ? raw.split('.').pop() || raw : raw).toUpperCase();
    const translated = t(`navigation.audit_logs.actions.${actionKey}`);
    if (translated !== `navigation.audit_logs.actions.${actionKey}`) {
      return translated;
    }

    const fallbackKey = `audit.actions.${actionKey}`;
    return i18n.exists(fallbackKey) ? t(fallbackKey) : raw;
  };

  // 资源类型的中文名（后端存的是模型类名，直接展示对使用者没有意义）
  const getResourceLabel = (resourceType?: string): string => {
    const raw = String(resourceType || '').trim();
    if (!raw) return '-';
    const labelKey = `audit.resources.${raw}`;
    return i18n.exists(labelKey) ? t(labelKey) : raw;
  };

  const getActionStyle = (action: AuditAction): string => {
    const key = String(action || '').trim().toUpperCase();
    if (key === 'DELETE') return 'bg-surface-sunken text-danger-strong';
    if (key === 'CREATE') return 'bg-surface-sunken text-ok-text';
    if (key === 'UPDATE' || key === 'ASSIGN') return 'bg-surface-sunken text-brand-fill-hover';
    return 'bg-surface-sunken text-ink-secondary';
  };

  // 格式化时间
  const formatDateTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
  };

  // 获取状态样式
  const getStatusStyle = (success: boolean): string => {
    return success
      ? 'bg-green-100 text-green-800 border-green-200'
      : 'bg-red-100 text-red-800 border-red-200';
  };

  useEffect(() => {
    void fetchAuditLogs(queryParams);
  }, [fetchAuditLogs, queryParams]);

  if (loading && logs.length === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-2 text-ink-secondary">{t('navigation.audit_logs.loading')}</span>
      </div>
    );
  }

  return (
    <div className="px-5 py-5">
      <div className="max-w-7xl mx-auto">
        <div className="card rounded-2xl overflow-hidden">
          <div className="p-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
              <h2 className="text-2xl font-semibold text-ink">{t('navigation.audit_logs.title')}</h2>
              <div className="flex items-center space-x-4">
                <span className="text-sm text-ink-secondary bg-[rgba(10,132,255,0.08)] px-3 py-1 rounded-full">
                  {t('navigation.audit_logs.total_records', { count: total })}
                </span>
              </div>
            </div>

            {/* 查询条件 */}
            <div className="mb-5 rounded-[16px] border border-hairline bg-surface-muted p-5">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="audit-action-type" className="block text-sm font-medium text-ink-secondary mb-2">{t('navigation.audit_logs.action_type')}</label>
                  <select 
                    id="audit-action-type"
                    name="audit-action-type"
                    className="w-full px-4 py-3 border border-hairline-strong rounded-[12px] outline-none focus:border-accent-line focus:ring-2 focus:ring-[rgba(10,132,255,0.10)] focus:border-transparent transition-all duration-200 bg-white hover:bg-white"
                    value={queryParams.action || ''}
                    onChange={(e) => handleQueryChange({ action: e.target.value as AuditAction || undefined })}
                  >
                    <option value="">{t('navigation.audit_logs.all')}</option>
                    {Object.values(AuditAction).map(action => (
                      <option key={action} value={action}>
                        {getActionDescription(action)}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label htmlFor="audit-resource-type" className="block text-sm font-medium text-ink-secondary mb-2">{t('navigation.audit_logs.resource_type')}</label>
                  <input 
                    id="audit-resource-type"
                    name="audit-resource-type"
                    type="text"
                    className="w-full px-4 py-3 border border-hairline-strong rounded-[12px] outline-none focus:border-accent-line focus:ring-2 focus:ring-[rgba(10,132,255,0.10)] focus:border-transparent transition-all duration-200 bg-white hover:bg-white"
                    placeholder={t('navigation.audit_logs.input_resource_type')}
                    value={queryParams.resourceType || ''}
                    onChange={(e) => handleQueryChange({ resourceType: e.target.value || undefined })}
                  />
                </div>
                
                <div>
                  <label htmlFor="audit-status" className="block text-sm font-medium text-ink-secondary mb-2">{t('navigation.audit_logs.status')}</label>
                  <select 
                    id="audit-status"
                    name="audit-status"
                    className="w-full px-4 py-3 border border-hairline-strong rounded-[12px] outline-none focus:border-accent-line focus:ring-2 focus:ring-[rgba(10,132,255,0.10)] focus:border-transparent transition-all duration-200 bg-white hover:bg-white"
                    value={queryParams.success === undefined ? '' : queryParams.success.toString()}
                    onChange={(e) => handleQueryChange({ 
                      success: e.target.value === '' ? undefined : e.target.value === 'true' 
                    })}
                  >
                    <option value="">{t('navigation.audit_logs.all')}</option>
                    <option value="true">{t('navigation.audit_logs.success')}</option>
                    <option value="false">{t('navigation.audit_logs.failed')}</option>
                  </select>
                </div>
                
                <div>
                  <label htmlFor="audit-page-size" className="block text-sm font-medium text-ink-secondary mb-2">{t('navigation.audit_logs.page_size')}</label>
                  <select 
                    id="audit-page-size"
                    name="audit-page-size"
                    className="w-full px-4 py-3 border border-hairline-strong rounded-[12px] outline-none focus:border-accent-line focus:ring-2 focus:ring-[rgba(10,132,255,0.10)] focus:border-transparent transition-all duration-200 bg-white hover:bg-white"
                    value={pageSize}
                    onChange={(e) => {
                      const newSize = parseInt(e.target.value);
                      setPageSize(newSize);
                      handleQueryChange({ pageSize: newSize });
                    }}
                  >
                    <option value={10}>{t('navigation.audit_logs.rows', { count: 10 })}</option>
                    <option value={20}>{t('navigation.audit_logs.rows', { count: 20 })}</option>
                    <option value={50}>{t('navigation.audit_logs.rows', { count: 50 })}</option>
                    <option value={100}>{t('navigation.audit_logs.rows', { count: 100 })}</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 错误提示 */}
            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl shadow-sm">
                <p className="text-red-700 flex items-center">
                  <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  {error}
                </p>
              </div>
            )}

            {/* 日志列表 */}
            <div className="overflow-x-auto rounded-[16px] border border-hairline" role="region" aria-label={t('a11y.audit_table')} tabIndex={0}>
              <table className="min-w-full divide-y divide-surface-sunken/60 bg-transparent">
                <thead className="bg-surface-muted text-ink-secondary">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold uppercase tracking-wider">
                      {t('navigation.audit_logs.time')}
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold uppercase tracking-wider">
                      {t('navigation.audit_logs.user')}
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold uppercase tracking-wider">
                      {t('navigation.audit_logs.action')}
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold uppercase tracking-wider">
                      {t('navigation.audit_logs.resource')}
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold uppercase tracking-wider">
                      {t('navigation.audit_logs.status')}
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold uppercase tracking-wider">
                      {t('navigation.audit_logs.details')}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-transparent divide-y divide-surface-sunken/60">
                  {logs.map((log) => (
                    <tr key={log.id} className="transition-colors duration-200 hover:bg-surface-muted">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-ink">
                        {formatDateTime(log.timestamp)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-ink">
                        <div>
                          <div className="font-medium">{log.username}</div>
                          <div className="text-muted text-xs">ID: {log.userId}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-ink">
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${getActionStyle(log.action)}`}>
                          {getActionDescription(log.action)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-ink">
                        <div>
                          <div className="font-medium">
                            {getResourceLabel(log.resourceType)}
                            {log.resourceId ? <span className="ml-1.5 text-xs font-normal text-muted tabular-nums">#{log.resourceId}</span> : null}
                          </div>
                          {log.resourceName && log.resourceName !== log.resourceType && (
                            <div className="truncate text-xs text-muted">{log.resourceName}</div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${getStatusStyle(log.success)} transition-all duration-200 transform hover:scale-105`}>
                          {log.success ? t('navigation.audit_logs.success') : t('navigation.audit_logs.failed')}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-ink">
                        {log.details && Object.keys(log.details).length > 0 ? (
                          <details className="text-xs">
                            <summary className="cursor-pointer text-accent-text hover:text-blue-800 flex items-center">
                              <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                              </svg>
                              {t('navigation.audit_logs.view_details')}
                            </summary>
                            <pre className="mt-2 p-3 bg-surface-sunken rounded-lg text-ink-secondary overflow-x-auto shadow-inner">
                              {JSON.stringify(log.details, null, 2)}
                            </pre>
                          </details>
                        ) : (
                          <span className="text-muted flex items-center">
                            <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                            </svg>
                            {t('navigation.audit_logs.no_details')}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-6 p-4 card-soft rounded-xl">
                <div className="text-sm text-ink-secondary">
                  {t('navigation.audit_logs.pagination_info', { 
                    start: (page - 1) * pageSize + 1, 
                    end: Math.min(page * pageSize, total), 
                    total 
                  })}
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => handlePageChange(page - 1)}
                    disabled={page <= 1}
                    className="px-4 py-2 border border-hairline-strong rounded-xl text-sm font-medium text-ink-secondary bg-white hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm hover:shadow-md"
                  >
                    {t('navigation.audit_logs.prev_page')}
                  </button>
                  
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const pageNum = i + Math.max(1, page - 2);
                    if (pageNum > totalPages) return null;
                    
                    return (
                      <button
                        key={pageNum}
                        onClick={() => handlePageChange(pageNum)}
                        className={`px-4 py-2 border text-sm font-medium rounded-xl transition-all duration-200 shadow-sm hover:shadow-md ${pageNum === page ? 'bg-brand-fill text-white border-blue-500 ' : 'bg-white text-ink-secondary border-hairline-strong hover:bg-white'}`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                  
                  <button
                    onClick={() => handlePageChange(page + 1)}
                    disabled={page >= totalPages}
                    className="px-4 py-2 border border-hairline-strong rounded-xl text-sm font-medium text-ink-secondary bg-white hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm hover:shadow-md"
                  >
                    {t('navigation.audit_logs.next_page')}
                  </button>
                </div>
              </div>
            )}

            {logs.length === 0 && !loading && (
              <div className="text-center py-12 card-soft rounded-xl">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-accent-text" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="text-muted text-lg font-medium">{t('navigation.audit_logs.no_logs')}</div>
                <div className="text-muted text-sm mt-2">{t('navigation.audit_logs.no_logs_desc')}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuditLogs;
