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
  const { t } = useTranslation();
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

    const isChinese = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh');
    const genericActionLabels: Record<string, string> = isChinese
      ? {
          CREATE: '创建',
          UPDATE: '更新',
          DELETE: '删除',
          ASSIGN: '分配',
          LOGIN: '登录',
          LOGOUT: '登出',
        }
      : {
          CREATE: 'Create',
          UPDATE: 'Update',
          DELETE: 'Delete',
          ASSIGN: 'Assign',
          LOGIN: 'Login',
          LOGOUT: 'Logout',
        };

    return genericActionLabels[actionKey] ?? raw;
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
        <span className="ml-2 text-gray-600">{t('navigation.audit_logs.loading')}</span>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gradient-to-br from-gray-50 to-gray-100 min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="glass-panel rounded-2xl overflow-hidden">
          <div className="p-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
              <h2 className="text-2xl font-bold text-gray-900">{t('navigation.audit_logs.title')}</h2>
              <div className="flex items-center space-x-4">
                <span className="text-sm text-gray-600 bg-blue-50 px-3 py-1 rounded-full">
                  {t('navigation.audit_logs.total_records', { count: total })}
                </span>
              </div>
            </div>

            {/* 查询条件 */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-xl mb-6 shadow-sm border border-blue-100">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="audit-action-type" className="block text-sm font-medium text-gray-700 mb-2">{t('navigation.audit_logs.action_type')}</label>
                  <select 
                    id="audit-action-type"
                    name="audit-action-type"
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-white hover:bg-gray-50"
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
                  <label htmlFor="audit-resource-type" className="block text-sm font-medium text-gray-700 mb-2">{t('navigation.audit_logs.resource_type')}</label>
                  <input 
                    id="audit-resource-type"
                    name="audit-resource-type"
                    type="text"
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-white hover:bg-gray-50"
                    placeholder={t('navigation.audit_logs.input_resource_type')}
                    value={queryParams.resourceType || ''}
                    onChange={(e) => handleQueryChange({ resourceType: e.target.value || undefined })}
                  />
                </div>
                
                <div>
                  <label htmlFor="audit-status" className="block text-sm font-medium text-gray-700 mb-2">{t('navigation.audit_logs.status')}</label>
                  <select 
                    id="audit-status"
                    name="audit-status"
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-white hover:bg-gray-50"
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
                  <label htmlFor="audit-page-size" className="block text-sm font-medium text-gray-700 mb-2">{t('navigation.audit_logs.page_size')}</label>
                  <select 
                    id="audit-page-size"
                    name="audit-page-size"
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-white hover:bg-gray-50"
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
            <div className="overflow-x-auto rounded-xl shadow-sm border border-gray-200">
              <table className="min-w-full divide-y divide-slate-200/60 bg-transparent">
                <thead className="bg-gradient-to-r from-blue-500 to-indigo-500 text-white">
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
                <tbody className="bg-transparent divide-y divide-slate-200/60">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50 transition-colors duration-200">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatDateTime(log.timestamp)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div>
                          <div className="font-medium">{log.username}</div>
                          <div className="text-gray-500 text-xs">ID: {log.userId}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <span className="bg-purple-50 text-purple-700 px-2 py-1 rounded-full text-xs font-medium">
                          {getActionDescription(log.action)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div>
                          <div className="font-medium">{log.resourceType}</div>
                          {log.resourceName && (
                            <div className="text-gray-500 text-xs">{log.resourceName}</div>
                          )}
                          {log.resourceId && (
                            <div className="text-gray-500 text-xs">ID: {log.resourceId}</div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${getStatusStyle(log.success)} transition-all duration-200 transform hover:scale-105`}>
                          {log.success ? t('navigation.audit_logs.success') : t('navigation.audit_logs.failed')}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {log.details && Object.keys(log.details).length > 0 ? (
                          <details className="text-xs">
                            <summary className="cursor-pointer text-blue-600 hover:text-blue-800 flex items-center">
                              <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                              </svg>
                              {t('navigation.audit_logs.view_details')}
                            </summary>
                            <pre className="mt-2 p-3 bg-gray-100 rounded-lg text-gray-700 overflow-x-auto shadow-inner">
                              {JSON.stringify(log.details, null, 2)}
                            </pre>
                          </details>
                        ) : (
                          <span className="text-gray-400 flex items-center">
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
              <div className="flex items-center justify-between mt-6 p-4 bg-gray-50 rounded-xl">
                <div className="text-sm text-gray-700">
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
                    className="px-4 py-2 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm hover:shadow-md"
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
                        className={`px-4 py-2 border text-sm font-medium rounded-xl transition-all duration-200 shadow-sm hover:shadow-md ${pageNum === page ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white border-blue-500 hover:from-blue-600 hover:to-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'}`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                  
                  <button
                    onClick={() => handlePageChange(page + 1)}
                    disabled={page >= totalPages}
                    className="px-4 py-2 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm hover:shadow-md"
                  >
                    {t('navigation.audit_logs.next_page')}
                  </button>
                </div>
              </div>
            )}

            {logs.length === 0 && !loading && (
              <div className="text-center py-12 bg-gray-50 rounded-xl">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="text-gray-400 text-lg font-medium">{t('navigation.audit_logs.no_logs')}</div>
                <div className="text-gray-500 text-sm mt-2">{t('navigation.audit_logs.no_logs_desc')}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuditLogs;
