import api from './client';

// === Analytics API ===
export const analyticsApi = {
  getStats: (days: number = 30): Promise<any> => api.get('/analytics/stats/', { params: { days } }).then(res => res.data),
  getLogs: (params: any): Promise<any> => api.get('/analytics/logs/', { params }).then(res => res.data),
  getPublicStats: (): Promise<{prediction_usage_count: number, images_predicted_count: number, visit_count: number}> => 
    api.get('/analytics/public-stats/').then(res => res.data),
  getIPStats: (params: any): Promise<any> => api.get('/analytics/ip-stats/', { params }).then(res => res.data),
};
