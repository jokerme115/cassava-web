/**
 * 前端 API 门面。
 *
 * 域实现都在 ./rest/ 下（client / normalizers / resources / predictions /
 * tasks / auth / analytics / permissions），这里只做转导出，保持
 * `import { imagesApi } from '../services/api'` 这类既有调用点不变。
 */
export { default, API_BASE_URL, API_ORIGIN, resolveFileUrl } from './rest/client';
export type { ListResult, PaginatedResponse } from './rest/client';
export { imagesApi, foldersApi, segmentationsApi } from './rest/resources';
export { predictionsApi } from './rest/predictions';
export { tasksApi } from './rest/tasks';
export { authApi, statusApi, systemSettingsApi } from './rest/auth';
export { analyticsApi } from './rest/analytics';
export { permissionsApi, sharesApi, guestResourcesApi } from './rest/permissions';
