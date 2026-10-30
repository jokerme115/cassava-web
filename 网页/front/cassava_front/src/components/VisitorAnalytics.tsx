import React, { useCallback, useEffect, useState } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useTranslation } from 'react-i18next';
import { analyticsApi } from '../services/api';
import { Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';

echarts.use([
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface VisitorLog {
  id: number;
  ip_address: string;
  path: string;
  method: string;
  created_at: string;
  is_guest: boolean;
  username: string;
  user_agent: string;
}

interface IPStats {
  ip_address: string;
  visit_count: number;
  first_seen: string;
  last_seen: string;
  is_guest: boolean;
  username?: string;
}

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
};

const VisitorAnalytics: React.FC = () => {
  const { t } = useTranslation();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  // Table state
  const [logs, setLogs] = useState<VisitorLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 20,
    total: 0
  });

  // IP Stats state
  const [ipStats, setIpStats] = useState<IPStats[]>([]);
  const [ipStatsLoading, setIpStatsLoading] = useState(false);
  const [ipPagination, setIpPagination] = useState({
    current: 1,
    pageSize: 10,
    total: 0
  });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await analyticsApi.getStats(days);
      setData(res);
    } catch (error) {
      console.error("Failed to fetch analytics", error);
    } finally {
      setLoading(false);
    }
  }, [days]);

  const fetchLogs = useCallback(async (page: number, pageSize: number) => {
    try {
      setLogsLoading(true);
      const res = await analyticsApi.getLogs({ 
        days, 
        page, 
        page_size: pageSize 
      });
      setLogs(res.results);
      setPagination({
        current: page,
        pageSize: pageSize,
        total: res.count
      });
    } catch (error) {
      console.error("Failed to fetch logs", error);
    } finally {
      setLogsLoading(false);
    }
  }, [days]);

  const fetchIpStats = useCallback(async (page: number, pageSize: number) => {
    try {
      setIpStatsLoading(true);
      const res = await analyticsApi.getIPStats({
        days,
        page,
        page_size: pageSize
      });
      // Handle both array (if simplified) or paginated result
      const results = Array.isArray(res) ? res : (res.results || []);
      const total = Array.isArray(res) ? res.length : (res.count || 0);
      
      setIpStats(results);
      setIpPagination({
        current: page,
        pageSize: pageSize,
        total: total
      });
    } catch (error) {
      console.error("Failed to fetch IP stats", error);
      setIpStats([]);
    } finally {
      setIpStatsLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void fetchData();
    void fetchLogs(1, 20);
    void fetchIpStats(1, 10);
  }, [fetchData, fetchIpStats, fetchLogs]);

  const handleIpTableChange = (page: number, pageSize: number) => {
    fetchIpStats(page, pageSize);
  };

  const handleTableChange = (page: number, pageSize: number) => {
    fetchLogs(page, pageSize);
  };

  const ipColumns: ColumnsType<IPStats> = [
    {
      title: t('analytics.ip_address'),
      dataIndex: 'ip_address',
      key: 'ip_address',
    },
    {
      title: t('analytics.visit_count'),
      dataIndex: 'visit_count',
      key: 'visit_count',
      sorter: (a, b) => a.visit_count - b.visit_count,
    },
    {
      title: t('analytics.first_seen'),
      dataIndex: 'first_seen',
      key: 'first_seen',
      render: (_text, record) => formatDateTime(
        record.first_seen || (record as any).first_visit_time || (record as any).first_visit || (record as any).created_at
      ),
    },
    {
      title: t('analytics.last_seen'),
      dataIndex: 'last_seen',
      key: 'last_seen',
      render: (_text, record) => formatDateTime(
        record.last_seen || (record as any).last_visit_time || (record as any).last_visit || (record as any).updated_at
      ),
    },
    {
      title: t('analytics.user_type'),
      key: 'user_type',
      render: (_, record) => (
        <span className="flex items-center">
          {record.is_guest && <Tag color="blue">{t('analytics.guest')}</Tag>}
          {!record.is_guest && <Tag color="green">{t('analytics.registered')}</Tag>}
          {record.username && !record.is_guest && <span className="ml-2 text-ink-secondary">({record.username})</span>}
        </span>
      ),
    },
  ];

  const columns: ColumnsType<VisitorLog> = [
    {
      title: t('analytics.time'),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (text) => formatDateTime(text),
    },
    {
      title: t('analytics.user'),
      dataIndex: 'username',
      key: 'username',
      render: (text, record) => (
        <span className="flex items-center">
          {text} 
          {record.is_guest && <Tag className="ml-2" color="blue">{t('analytics.guest')}</Tag>}
          {!record.is_guest && <Tag className="ml-2" color="green">{t('analytics.registered')}</Tag>}
        </span>
      ),
    },
    {
      title: t('analytics.ip_address'),
      dataIndex: 'ip_address',
      key: 'ip_address',
    },
    {
      title: t('analytics.method'),
      dataIndex: 'method',
      key: 'method',
      render: (text) => <Tag color={text === 'GET' ? 'blue' : text === 'POST' ? 'green' : 'orange'}>{text}</Tag>
    },
    {
      title: t('analytics.path'),
      dataIndex: 'path',
      key: 'path',
    },
  ];

  if (loading && !data) return <div className="p-4 flex justify-center items-center h-64">{t('analytics.loading')}</div>;
  if (!data) return <div className="p-4 flex justify-center items-center h-64">{t('analytics.no_data')}</div>;

  const lineOption = {
    title: { text: t('analytics.daily_trend') },
    tooltip: { trigger: 'axis' },
    legend: { data: [t('analytics.total_visits'), t('analytics.unique_visitors'), t('analytics.registered'), t('analytics.guest')], bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '10%', containLabel: true },
    xAxis: { type: 'category', data: data.chart_data.dates },
    yAxis: { type: 'value' },
    series: [
      { name: t('analytics.total_visits'), type: 'line', data: data.chart_data.visits, smooth: true },
      { name: t('analytics.unique_visitors'), type: 'line', data: data.chart_data.uniques, smooth: true },
      { name: t('analytics.registered'), type: 'line', data: data.chart_data.registered, smooth: true, lineStyle: { type: 'dashed' } },
      { name: t('analytics.guest'), type: 'line', data: data.chart_data.guests, smooth: true, lineStyle: { type: 'dashed' } }
    ]
  };

  const pieOption = {
    title: { text: t('analytics.user_distribution'), left: 'center' },
    tooltip: { trigger: 'item' },
    legend: { orient: 'vertical', left: 'left' },
    series: [
      {
        name: t('analytics.user_type'),
        type: 'pie',
        radius: '50%',
        data: data.pie_data.map((item: any) => ({
          ...item,
          name: item.name === 'Guest' ? t('analytics.guest') : t('analytics.registered')
        })),
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: 'rgba(0, 0, 0, 0.5)'
          }
        }
      }
    ]
  };

  return (
    <div className="p-6 space-y-6 card-soft rounded-lg">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-semibold text-ink">{t('analytics.visitor_analytics')}</h2>
        <select 
          value={days} 
          onChange={(e) => setDays(Number(e.target.value))}
          className="border border-hairline-strong rounded-md p-2 bg-white shadow-sm focus:ring-blue-500 focus:border-blue-500"
        >
          <option value={7}>{t('analytics.last_7_days')}</option>
          <option value={30}>{t('analytics.last_30_days')}</option>
          <option value={90}>{t('analytics.last_90_days')}</option>
        </select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="card p-4 rounded-lg shadow-sm border-l-4 border-blue-500">
          <div className="text-sm font-medium text-muted uppercase tracking-wider">{t('analytics.today_visits')}</div>
          <div className="mt-1 text-3xl font-semibold text-ink">{data.summary.today_visits}</div>
        </div>
        <div className="card p-4 rounded-lg shadow-sm border-l-4 border-accent-line">
          <div className="text-sm font-medium text-muted uppercase tracking-wider">{t('analytics.today_unique')}</div>
          <div className="mt-1 text-3xl font-semibold text-ink">{data.summary.today_unique}</div>
        </div>
        <div className="card p-4 rounded-lg shadow-sm border-l-4 border-purple-500">
          <div className="text-sm font-medium text-muted uppercase tracking-wider">{t('analytics.total_visits_period')}</div>
          <div className="mt-1 text-3xl font-semibold text-ink">{data.summary.total_visits_period}</div>
        </div>
        <div className="card p-4 rounded-lg shadow-sm border-l-4 border-orange-500">
          <div className="text-sm font-medium text-muted uppercase tracking-wider">{t('analytics.unique_visitors_period')}</div>
          <div className="mt-1 text-3xl font-semibold text-ink">{data.summary.unique_visitors_period}</div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="card p-4 rounded-lg shadow-sm">
          <ReactEChartsCore echarts={echarts} option={lineOption} style={{ height: '400px' }} />
        </div>
        <div className="card p-4 rounded-lg shadow-sm">
          <ReactEChartsCore echarts={echarts} option={pieOption} style={{ height: '400px' }} />
        </div>
      </div>

      {/* IP Detail Table */}
      <div className="card p-6 rounded-lg shadow-sm mb-6">
        <h3 className="text-lg font-semibold text-ink mb-4">{t('analytics.ip_stats_table')}</h3>
        <Table
          columns={ipColumns}
          dataSource={ipStats}
          rowKey="ip_address"
          loading={ipStatsLoading}
          pagination={{
            current: ipPagination.current,
            pageSize: ipPagination.pageSize,
            total: ipPagination.total,
            onChange: handleIpTableChange,
            showSizeChanger: true,
            showTotal: (total) => t('navigation.audit_logs.total_records', { count: total })
          }}
        />
      </div>

      {/* Access Logs Table */}
      <div className="card p-6 rounded-lg shadow-sm">
        <h3 className="text-lg font-semibold text-ink mb-4">{t('analytics.access_logs')}</h3>
        <Table 
          columns={columns} 
          dataSource={logs} 
          rowKey="id"
          loading={logsLoading}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: pagination.total,
            onChange: handleTableChange,
            showSizeChanger: true,
            showTotal: (total) => t('navigation.audit_logs.total_records', { count: total })
          }}
        />
      </div>
    </div>
  );
};

export default VisitorAnalytics;
