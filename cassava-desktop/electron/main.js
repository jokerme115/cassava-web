const { app, BrowserWindow, ipcMain, dialog, session, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const log = require('electron-log');

// ==================== 窗口状态管理 ====================

function getWindowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

const defaultWindowState = {
  width: 1400,
  height: 900,
  x: undefined,
  y: undefined,
  isMaximized: false
};

function loadWindowState() {
  try {
    const statePath = getWindowStatePath();
    if (fs.existsSync(statePath)) {
      const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      log.info('已加载窗口状态:', data);
      return { ...defaultWindowState, ...data };
    }
  } catch (e) {
    log.warn('加载窗口状态失败:', e.message);
  }
  return defaultWindowState;
}

function saveWindowState(state) {
  try {
    const statePath = getWindowStatePath();
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
    log.info('已保存窗口状态:', state);
  } catch (e) {
    log.warn('保存窗口状态失败:', e.message);
  }
}

function createWindowStateManager() {
  let state = loadWindowState();
  let saveTimeout = null;

  const save = () => {
    if (!mainWindow) return;
    if (!mainWindow.isDestroyed()) {
      const bounds = mainWindow.getBounds();
      state = {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        isMaximized: mainWindow.isMaximized()
      };
      saveWindowState(state);
    }
  };

  const debouncedSave = () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(save, 500);
  };

  return {
    state,
    attach: () => {
      if (!mainWindow) return;
      mainWindow.on('resize', debouncedSave);
      mainWindow.on('move', debouncedSave);
      mainWindow.on('maximize', debouncedSave);
      mainWindow.on('unmaximize', debouncedSave);
    },
    detach: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.removeListener('resize', debouncedSave);
        mainWindow.removeListener('move', debouncedSave);
        mainWindow.removeListener('maximize', debouncedSave);
        mainWindow.removeListener('unmaximize', debouncedSave);
      }
      if (saveTimeout) clearTimeout(saveTimeout);
    }
  };
}

let windowStateManager = null;

// ==================== 版本管理 ====================

function getAppVersion() {
  return app.getVersion();
}

function getVersionInfoPath() {
  return path.join(app.getPath('userData'), 'version-info.json');
}

function loadVersionInfo() {
  try {
    const versionInfoPath = getVersionInfoPath();
    if (fs.existsSync(versionInfoPath)) {
      return JSON.parse(fs.readFileSync(versionInfoPath, 'utf8'));
    }
  } catch (e) {
    log.warn('加载版本信息失败:', e.message);
  }
  return null;
}

function saveVersionInfo(info) {
  try {
    const versionInfoPath = getVersionInfoPath();
    fs.writeFileSync(versionInfoPath, JSON.stringify(info, null, 2), 'utf8');
  } catch (e) {
    log.warn('保存版本信息失败:', e.message);
  }
}

// 检查更新的URL配置（可配置为本地文件服务器或远程URL）
function getUpdateCheckUrl() {
  // 默认使用本地 version.json，可在打包时替换为实际更新服务器
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'version.json');
  }
  // 开发模式使用项目根目录的 version.json
  return path.join(__dirname, '..', '..', 'version.json');
}

async function checkForUpdates() {
  return new Promise((resolve) => {
    const currentVersion = getAppVersion();
    const updateUrl = getUpdateCheckUrl();

    log.info(`检查更新: 当前版本 ${currentVersion}, 检查地址: ${updateUrl}`);

    // 尝试从更新URL读取版本信息
    try {
      if (fs.existsSync(updateUrl)) {
        const updateInfo = JSON.parse(fs.readFileSync(updateUrl, 'utf8'));
        const latestVersion = updateInfo.version;
        const downloadUrl = updateInfo.downloadUrl;
        const releaseNotes = updateInfo.releaseNotes;

        const needsUpdate = compareVersions(latestVersion, currentVersion) > 0;

        const result = {
          currentVersion,
          latestVersion,
          needsUpdate,
          downloadUrl: downloadUrl || null,
          releaseNotes: releaseNotes || '',
          lastChecked: new Date().toISOString()
        };

        saveVersionInfo(result);
        log.info(`更新检查完成: 需要更新=${needsUpdate}, 最新版本=${latestVersion}`);
        resolve(result);
        return;
      }
    } catch (e) {
      log.warn('读取版本信息失败:', e.message);
    }

    // 无法检查更新，返回当前状态
    resolve({
      currentVersion,
      latestVersion: currentVersion,
      needsUpdate: false,
      downloadUrl: null,
      releaseNotes: '',
      lastChecked: new Date().toISOString(),
      error: '无法获取版本信息'
    });
  });
}

function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

// ==================== 应用偏好设置 ====================

function getAppPreferencesPath() {
  return path.join(app.getPath('userData'), 'preferences.json');
}

const defaultPreferences = {
  useCpuOnly: false,
  gpuEnabled: true,
  customShortcuts: {
    newPrediction: 'ctrl+n',
    openImages: 'ctrl+o',
    openSettings: 'ctrl+,',
    toggleDarkMode: 'ctrl+d',
    showHelp: 'ctrl+/',
    goHome: 'ctrl+h',
    cancel: 'escape',
  },
};

function loadAppPreferences() {
  try {
    const prefPath = getAppPreferencesPath();
    if (fs.existsSync(prefPath)) {
      const data = JSON.parse(fs.readFileSync(prefPath, 'utf8'));
      log.info('已加载应用偏好设置:', data);
      return { ...defaultPreferences, ...data };
    }
  } catch (e) {
    log.warn('加载应用偏好设置失败:', e.message);
  }
  return defaultPreferences;
}

function saveAppPreferences(prefs) {
  try {
    const prefPath = getAppPreferencesPath();
    fs.writeFileSync(prefPath, JSON.stringify(prefs, null, 2), 'utf8');
    log.info('已保存应用偏好设置:', prefs);
  } catch (e) {
    log.warn('保存应用偏好设置失败:', e.message);
  }
}

// 强制桌面版走纯本地离线模式，尽量关闭 Chromium 自带后台联网行为。
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('metrics-recording-only');
app.commandLine.appendSwitch('no-pings');
app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication,CertificateTransparencyComponentUpdater,OptimizationHints,MediaRouter,UserAgentClientHint,InterestFeedContentSuggestions,Translate');

// ==================== 命令行参数：安装器专用 ====================
// --quit-if-running: NSIS 安装/卸载前关闭自身，避免文件被锁
if (process.argv.includes('--quit-if-running')) {
  log.info('收到 --quit-if-running 请求，退出应用');
  app.quit();
  process.exit(0);
}
// --uninstall: NSIS 卸载时触发（可选做清理）
if (process.argv.includes('--uninstall')) {
  log.info('收到 --uninstall 请求，清理应用数据...');
  // 可在此做 AppData 清理确认对话框
}

// 配置日志
log.transports.console.level = 'debug';
log.transports.file.resolvePathFn = () => path.join(app.getPath('userData'), 'logs', 'main.log');
log.info('应用启动中...');

// 全局变量
let mainWindow = null;
let tray = null;
let backendProcess = null;
let frontendServer = null;
let frontendPort = 51734;
let backendPort = 39333;  // 默认值，会在init时检查并更新
const isDevMode = process.argv.includes('--dev');
const forcePythonBackend = process.argv.includes('--python-backend') || process.env.DESKTOP_FORCE_PYTHON === '1';
const forceBackendExe = process.env.DESKTOP_FORCE_BACKEND_EXE === '1';

function resolveFirstExistingPath(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function getHealthFilePath() {
  return path.join(app.getPath('userData'), 'backend-health.json');
}

function getAdminCredPath() {
  return path.join(app.getPath('userData'), 'admin_cred.json');
}

function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch (e) {
    log.warn(`创建目录失败: ${dirPath}`);
  }
}

function getRuntimeDataPaths() {
  const dataRoot = path.join(app.getPath('userData'), 'runtime-data');
  return {
    dataRoot,
    mediaRoot: path.join(dataRoot, 'media'),
    staticRoot: path.join(dataRoot, 'static'),
    logsRoot: path.join(app.getPath('userData'), 'logs'),
    dbPath: path.join(app.getPath('userData'), 'db.sqlite3'),
  };
}

function ensureRuntimeDirectories() {
  const runtime = getRuntimeDataPaths();
  ensureDir(runtime.dataRoot);
  ensureDir(runtime.mediaRoot);
  ensureDir(runtime.staticRoot);
  ensureDir(runtime.logsRoot);
}

function loadOrCreateAdminCredential() {
  const credPath = getAdminCredPath();
  if (fs.existsSync(credPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      if (parsed && parsed.username && parsed.password) {
        return parsed;
      }
    } catch (e) {
      log.warn(`读取管理员凭据失败，将重新生成: ${credPath}`);
    }
  }

  const cred = {
    username: 'admin',
    password: crypto.randomBytes(16).toString('hex'),
    email: 'admin@localhost',
    generated: new Date().toISOString(),
  };
  fs.writeFileSync(credPath, JSON.stringify(cred, null, 2), 'utf8');
  log.info(`已生成管理员凭据文件: ${credPath}`);
  return cred;
}

function resetHealthFile() {
  const healthFile = getHealthFilePath();
  try {
    if (fs.existsSync(healthFile)) {
      fs.unlinkSync(healthFile);
    }
  } catch (e) {
    log.warn(`无法清理health文件: ${healthFile}`);
  }
}

function waitForHealthFile(timeoutMs = 25000) {
  const healthFile = getHealthFilePath();
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      try {
        if (fs.existsSync(healthFile)) {
          clearInterval(timer);
          resolve(true);
          return;
        }
      } catch (e) {
        // ignore transient fs errors
      }

      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`后端健康文件超时未生成: ${healthFile}`));
      }
    }, 300);
  });
}

// ==================== 端口管理 ====================

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '127.0.0.1');
  });
}

async function initPorts() {
  if (!await isPortAvailable(backendPort)) {
    for (let p = backendPort + 1; p < backendPort + 20; p++) {
      if (await isPortAvailable(p)) { backendPort = p; break; }
    }
  }
  if (!await isPortAvailable(frontendPort)) {
    for (let p = frontendPort + 1; p < frontendPort + 20; p++) {
      if (await isPortAvailable(p)) { frontendPort = p; break; }
    }
  }
  log.info(`前端端口: ${frontendPort}`);
  log.info(`后端端口: ${backendPort}`);
}

// ==================== 资源路径 ====================

function getResourcePath(relativePath) {
  if (app.isPackaged) {
    // 打包模式：资源在 process.resourcesPath（安装目录）
    return path.join(process.resourcesPath, relativePath);
  }
  // 开发模式
  return path.join(__dirname, '..', relativePath);
}

// ==================== Backend.exe 管理 ====================

/**
 * 获取 backend.exe 路径
 * - 打包模式: {resourcesPath}/backend/backend.exe
 * - 开发模式: dist_bin/backend.exe（先检查）或 fallback 到 python manage.py
 */
function getBackendExePath() {
  if (app.isPackaged) {
    const exePath = path.join(process.resourcesPath, 'backend', 'backend.exe');
    return exePath;
  }
  // 开发模式：优先用 Nuitka 打包产物
  return resolveFirstExistingPath([
    path.join(__dirname, '..', 'dist_bin', 'backend.exe'),
    path.join(__dirname, '..', '..', 'dist_bin', 'backend.exe'),
  ]);
}

/**
 * 判断是否使用 backend.exe（打包模式必须用，dev 模式可选）
 */
function shouldUseBackendExe() {
  if (forcePythonBackend) {
    return false;
  }
  // 开发模式默认走 Python 后端，避免误用旧的 dist_bin/backend.exe。
  if (isDevMode && !app.isPackaged && !forceBackendExe) {
    return false;
  }
  return Boolean(getBackendExePath());
}

// ==================== 开发模式：Python 管理 ====================

function getDevPythonCommand() {
  const configuredPath = process.env.DESKTOP_PYTHON_PATH || process.env.PYTHON_PATH;
  if (configuredPath && fs.existsSync(configuredPath)) {
    return { command: configuredPath, args: [], source: 'env' };
  }

  const preferredPython = process.platform === 'win32'
    ? 'C:\\Users\\Administrator\\.conda\\envs\\hetao\\python.exe'
    : '/home/user/anaconda3/envs/hetao/bin/python3';
  if (fs.existsSync(preferredPython)) {
    return { command: preferredPython, args: [], source: 'preferred env' };
  }

  if (process.platform === 'win32') {
    try {
      const pythonCandidates = execSync('where.exe python', { encoding: 'utf8' })
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
      const pythonPath = resolveFirstExistingPath(pythonCandidates);
      if (pythonPath) {
        return { command: pythonPath, args: [], source: 'where python' };
      }
    } catch (e) {
      log.warn('where python 未找到可用解释器');
    }

    try {
      execSync('where.exe py', { stdio: 'ignore' });
      return { command: 'py', args: ['-3'], source: 'py launcher' };
    } catch (e) {
      log.warn('py launcher 不可用');
    }
  }

  for (const command of ['python3', 'python']) {
    try {
      execSync(`${command} --version`, { stdio: 'ignore' });
      return { command, args: [], source: command };
    } catch (e) {
      // continue
    }
  }

  return null;
}

function getBackendDir() {
  return getResourcePath('backend');
}

function getManagePy() {
  return path.join(getBackendDir(), 'manage.py');
}

function spawnWithPython(pythonCmd, args, options) {
  if (!pythonCmd) {
    throw new Error('未找到可用的 Python 解释器。可通过 DESKTOP_PYTHON_PATH 指定 python.exe。');
  }
  return spawn(pythonCmd.command, [...pythonCmd.args, ...args], options);
}

// 构建后端环境变量
function buildBackendEnv() {
  const adminCred = loadOrCreateAdminCredential();
  const runtime = getRuntimeDataPaths();
  return {
    ...process.env,
    DESKTOP_MODE: '1',
    DESKTOP_OFFLINE_MODE: '1',
    DJANGO_PORT: backendPort.toString(),
    FRONTEND_PORT: frontendPort.toString(),
    USE_LOCAL_STORAGE: '1',
    ELECTRON_PACKAGED: app.isPackaged ? '1' : '0',
    NO_ALBUMENTATIONS_UPDATE: '1',
    HF_HUB_OFFLINE: '1',
    HF_HUB_DISABLE_TELEMETRY: '1',
    TRANSFORMERS_OFFLINE: '1',
    DISABLE_TELEMETRY: '1',
    DO_NOT_TRACK: '1',
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
    http_proxy: '',
    https_proxy: '',
    // GPU/CPU mode: 允许后端自动检测CUDA，设为1可强制使用CPU
    USE_CPU_ONLY: appPreferences.useCpuOnly ? '1' : '0',
    // RESOURCE_PATH 仅用于只读资源（模型等）；运行期数据写入 userData。
    RESOURCE_PATH: app.isPackaged ? process.resourcesPath : getResourcePath('resources'),
    APP_PATH: app.getAppPath(),
    BACKEND_HEALTH_FILE: getHealthFilePath(),
    DESKTOP_DATA_DIR: runtime.dataRoot,
    DESKTOP_MEDIA_ROOT: runtime.mediaRoot,
    DESKTOP_STATIC_ROOT: runtime.staticRoot,
    DESKTOP_DB_PATH: runtime.dbPath,
    DESKTOP_ADMIN_USERNAME: adminCred.username,
    DESKTOP_ADMIN_PASSWORD: adminCred.password,
    DESKTOP_ADMIN_EMAIL: adminCred.email || 'admin@localhost',
    DESKTOP_ADMIN_CRED_FILE: getAdminCredPath(),
  };
}

function isLocalAllowedUrl(rawUrl) {
  if (!rawUrl) return true;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'file:') return true;
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) return true;
    return ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
  } catch (error) {
    return true;
  }
}

function installOfflineGuards() {
  const filter = { urls: ['*://*/*'] };

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    log.warn(`已拒绝权限请求: ${permission}`);
    callback(false);
  });

  session.defaultSession.webRequest.onBeforeRequest(filter, (details, callback) => {
    if (isLocalAllowedUrl(details.url)) {
      callback({});
      return;
    }
    log.warn(`已拦截外部请求: ${details.method} ${details.url}`);
    callback({ cancel: true });
  });

  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    if (isLocalAllowedUrl(details.url)) {
      callback({ requestHeaders: details.requestHeaders });
      return;
    }
    callback({ cancel: true });
  });
}

// ==================== 后端进程启动 ====================

async function startBackend() {
  return new Promise(async (resolve, reject) => {
    log.info('启动Django后端...');
    resetHealthFile();

    const backendExe = getBackendExePath();
    const useExe = shouldUseBackendExe() && backendExe;
    const env = buildBackendEnv();

    if (useExe) {
      // ---- 模式A: backend.exe（打包模式 / 或已编译）----
      log.info(`后端可执行文件: ${backendExe}`);

      if (!fs.existsSync(backendExe)) {
        reject(new Error(`backend.exe not found: ${backendExe}\n请先运行 python scripts/pack-backend.py 打包后端。`));
        return;
      }

      // backend.exe 会根据环境变量 DJANGO_PORT 自行启动 runserver
      backendProcess = spawn(backendExe, [], {
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let started = false;
      let startupOutput = '';
      waitForHealthFile().then(() => {
        if (!started) {
          started = true;
          log.info(`Backend健康检查通过: http://127.0.0.1:${backendPort}`);
          resolve();
        }
      }).catch((err) => {
        if (!started) {
          log.warn(err.message);
        }
      });

      backendProcess.stdout.on('data', (data) => {
        const output = data.toString();
        startupOutput += output;
        log.info('[Backend]', output.trim());
        if (!started && (output.includes('Starting development server') || output.includes('Running on'))) {
          started = true;
          log.info(`Backend启动成功: http://127.0.0.1:${backendPort}`);
          resolve();
        }
      });

      backendProcess.stderr.on('data', (data) => {
        log.warn('[Backend Error]', data.toString().trim());
      });

      backendProcess.on('error', (err) => {
        log.error('Backend进程错误:', err);
        reject(err);
      });

      backendProcess.on('exit', (code) => {
        log.warn(`Backend进程退出，代码: ${code}`);
        if (!started) reject(new Error(`Backend启动失败:\n${startupOutput}`));
      });

      setTimeout(() => { if (!started) log.warn('Backend启动超时'); }, 20000);

    } else {
      // ---- 模式B: Python manage.py（开发模式，无 backend.exe）----
      const pythonCmd = getDevPythonCommand();
      const managePy = getManagePy();
      log.info(`Python: ${pythonCmd ? `${pythonCmd.command} (${pythonCmd.source})` : 'NOT FOUND'}`);
      log.info(`manage.py: ${managePy}`);

      if (!fs.existsSync(managePy)) {
        reject(new Error(`manage.py not found: ${managePy}`));
        return;
      }

      if (!pythonCmd) {
        reject(new Error('未找到可用的 Python 解释器，请安装 Python 3 或设置 DESKTOP_PYTHON_PATH。'));
        return;
      }

      backendProcess = spawnWithPython(pythonCmd, [managePy, 'runserver', `127.0.0.1:${backendPort}`, '--noreload'], {
        cwd: getBackendDir(),
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let started = false;
      let startupOutput = '';
      waitForHealthFile().then(() => {
        if (!started) {
          started = true;
          log.info(`Django健康检查通过: http://127.0.0.1:${backendPort}`);
          resolve();
        }
      }).catch((err) => {
        if (!started) {
          log.warn(err.message);
        }
      });

      backendProcess.stdout.on('data', (data) => {
        const output = data.toString();
        startupOutput += output;
        log.info('[Django]', output.trim());
        if (!started && output.includes('Starting development server')) {
          started = true;
          log.info(`Django后端启动成功: http://127.0.0.1:${backendPort}`);
          resolve();
        }
      });

      backendProcess.stderr.on('data', (data) => {
        log.warn('[Django Error]', data.toString().trim());
      });

      backendProcess.on('error', (err) => {
        log.error('Django进程错误:', err);
        reject(err);
      });

      backendProcess.on('exit', (code) => {
        log.warn(`Django进程退出，代码: ${code}`);
        if (!started) reject(new Error(`Django启动失败:\n${startupOutput}`));
      });

      setTimeout(() => { if (!started) log.warn('Django启动超时'); }, 20000);
    }
  });
}

function stopBackend() {
  if (backendProcess) {
    log.info('关闭后端...');
    try {
      if (process.platform === 'win32') {
        // 先尝试正常终止主进程（不强制终止子进程）
        try {
          execSync(`taskkill /PID ${backendProcess.pid} /T`, { stdio: 'ignore', timeout: 5000 });
        } catch (e) {
          // 如果超时或失败，强制终止
          log.warn('后端进程未响应正常终止，强制关闭');
          execSync(`taskkill /PID ${backendProcess.pid} /T /F`, { stdio: 'ignore' });
        }
      } else {
        backendProcess.kill('SIGTERM');
      }
    } catch (e) { /* ignore if already dead */ }
    backendProcess = null;
  }
}

// ==================== 数据库迁移（开发模式 Python 专用）====================
// backend.exe 内部自己处理 migrate；仅开发模式需要 Electron 代理

async function runMigrate() {
  if (shouldUseBackendExe()) {
    // backend.exe 自己做 migrate，不需要 Electron 干预
    log.info('Backend.exe 内置 migrate，跳过');
    return;
  }

  return new Promise((resolve, reject) => {
    const pythonCmd = getDevPythonCommand();
    const managePy = getManagePy();
    const env = buildBackendEnv();

    if (!pythonCmd) {
      reject(new Error('未找到可用的 Python 解释器，请安装 Python 3 或设置 DESKTOP_PYTHON_PATH。'));
      return;
    }

    const p = spawnWithPython(pythonCmd, [managePy, 'migrate', '--noinput'], {
      cwd: getBackendDir(),
      env,
      stdio: 'pipe'
    });

    let output = '';
    p.stdout.on('data', (d) => output += d.toString());
    p.stderr.on('data', (d) => output += d.toString());
    p.on('close', (code) => {
      if (code === 0) { log.info('数据库迁移完成'); resolve(); }
      else { log.error(`迁移失败: ${output}`); reject(new Error('数据库迁移失败')); }
    });
    p.on('error', reject);
  });
}

// ==================== 管理员初始化（仅开发模式）====================
// 打包后 backend.exe 自己处理 admin 创建

async function initAdminDev() {
  if (shouldUseBackendExe()) {
    log.info('Backend.exe 内置 admin 初始化，跳过');
    return;
  }

  const adminCred = loadOrCreateAdminCredential();
  const adminUsername = adminCred.username;
  const adminPassword = adminCred.password;
  const adminEmail = adminCred.email || 'admin@localhost';

  return new Promise((resolve, reject) => {
    const pythonCmd = getDevPythonCommand();
    const managePy = getManagePy();
    const env = buildBackendEnv();
    const script = `
from predict.models import User
if not User.objects.filter(username='${adminUsername}').exists():
    User.objects.create_superuser(username='${adminUsername}', password='${adminPassword}', email='${adminEmail}')
    print('ADMIN_CREATED')
else:
    print('ADMIN_EXISTS')
`;
    if (!pythonCmd) {
      reject(new Error('未找到可用的 Python 解释器，请安装 Python 3 或设置 DESKTOP_PYTHON_PATH。'));
      return;
    }

    const p = spawnWithPython(pythonCmd, [managePy, 'shell', '-c', script], {
      cwd: getBackendDir(), env, stdio: 'pipe'
    });
    let output = '';
    p.stdout.on('data', (d) => output += d.toString());
    p.stderr.on('data', (d) => output += d.toString());
    p.on('close', (code) => {
      if (code === 0 && output.includes('ADMIN_CREATED')) {
        log.info('管理员账号已创建');
        resolve();
      } else if (output.includes('ADMIN_EXISTS')) {
        log.info('管理员账号已存在');
        resolve();
      } else {
        log.error(`Admin初始化失败: ${output}`);
        reject(new Error(`Admin初始化失败`));
      }
    });
    p.on('error', reject);
  });
}

// ==================== 环境检测 ====================

function getDiagnosticReport() {
  // P1-1: 启动预检诊断报告
  const lines = ['[诊断] 启动预检报告:'];
  const backendExe = getBackendExePath();
  const useExe = shouldUseBackendExe();
  const pythonCmd = getDevPythonCommand();

  // 启动模式
  lines.push(`  启动模式: ${useExe ? 'backend.exe (打包/已编译)' : 'Python manage.py (开发模式)'}`);
  lines.push(`  打包环境: ${app.isPackaged ? '是' : '否 (开发模式)'}`);

  // 后端 exe 路径
  if (useExe) {
    lines.push(`  backend.exe: ${backendExe || '(未找到)'}`);
    if (!backendExe || !fs.existsSync(backendExe)) {
      lines.push(`  ⚠️ backend.exe 不存在，请运行: python scripts/pack-backend.py`);
    }
  } else {
    // Python 信息
    lines.push(`  Python: ${pythonCmd ? `${pythonCmd.command} (${pythonCmd.source})` : '(未找到)'}`);
    if (pythonCmd) {
      try {
        const verCmd = pythonCmd.args.length > 0
          ? `${pythonCmd.command} ${pythonCmd.args.join(' ')} --version`
          : `"${pythonCmd.command}" --version`;
        const verOut = execSync(verCmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
        lines.push(`  Python版本: ${verOut}`);
      } catch (e) {
        lines.push(`  ⚠️ 无法获取Python版本`);
      }
    }
  }

  // 关键环境变量
  const envVars = ['DESKTOP_OFFLINE_MODE', 'HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE', 'DISABLE_TELEMETRY'];
  for (const v of envVars) {
    lines.push(`  ${v}=${process.env[v] || '(未设置)'}`);
  }

  // 端口
  lines.push(`  前端端口: ${frontendPort}`);
  lines.push(`  后端端口: ${backendPort}`);
  lines.push(`  userData: ${app.getPath('userData')}`);

  return lines.join('\n');
}

async function checkEnvironment() {
  const issues = [];

  // 输出预检诊断报告
  log.info(getDiagnosticReport());

  // 检测 backend.exe 或 Python
  const backendExe = getBackendExePath();
  const useExe = shouldUseBackendExe();

  if (useExe) {
    if (!backendExe || !fs.existsSync(backendExe)) {
      issues.push(`Backend内核未找到: ${backendExe}\n请运行 python scripts/pack-backend.py`);
    }
  } else {
    // 开发模式：检测 Python + torch/cv2
    const pythonCmd = getDevPythonCommand();
    try {
      if (!pythonCmd) {
        throw new Error('python-not-found');
      }
      const versionCommand = pythonCmd.args.length > 0
        ? `${pythonCmd.command} ${pythonCmd.args.join(' ')} --version`
        : `"${pythonCmd.command}" --version`;
      execSync(versionCommand, { stdio: 'ignore' });
    } catch (e) {
      issues.push('Python未安装');
      return issues;
    }

    const criticalDeps = ['torch', 'cv2', 'numpy', 'PIL'];
    for (const dep of criticalDeps) {
      try {
        const importCommand = dep === 'cv2'
          ? 'import cv2; print(cv2.__version__)'
          : dep === 'PIL'
            ? 'from PIL import Image; print(Image.__version__)'
            : `import ${dep}; print(${dep}.__version__)`;
        const dependencyCommand = pythonCmd.args.length > 0
          ? `${pythonCmd.command} ${pythonCmd.args.join(' ')} -c "${importCommand}"`
          : `"${pythonCmd.command}" -c "${importCommand}"`;
        execSync(dependencyCommand, { encoding: 'utf8', stdio: 'ignore' });
      } catch (e) {
        issues.push(`推理依赖未安装: ${dep}`);
      }
    }
  }

  return issues;
}

// ==================== 前端静态文件服务器 ====================

function startFrontendServer() {
  return new Promise((resolve, reject) => {
    const frontendPath = getResourcePath('resources/frontend');
    const allowedOrigin = `http://127.0.0.1:${frontendPort}`;

    frontendServer = http.createServer((req, res) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': allowedOrigin,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
          'Access-Control-Max-Age': '86400',
        });
        res.end();
        return;
      }

      if (req.url.startsWith('/api/') || req.url.startsWith('/media/')) {
        const proxyReq = http.request({
          hostname: '127.0.0.1', port: backendPort, path: req.url,
          method: req.method,
          headers: { ...req.headers, 'host': `127.0.0.1:${backendPort}`, 'Origin': allowedOrigin }
        }, (proxyRes) => {
          res.writeHead(proxyRes.statusCode, { ...proxyRes.headers, 'Access-Control-Allow-Origin': allowedOrigin });
          proxyRes.pipe(res, { end: true });
        });
        proxyReq.on('error', (e) => {
          log.error(`代理错误: ${e.message}`);
          if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Backend unavailable' })); }
        });
        req.pipe(proxyReq, { end: true });
        return;
      }

      let filePath = path.join(frontendPath, req.url === '/' ? 'index.html' : req.url);
      if (req.url.includes('@vite') || req.url.includes('hot')) { res.writeHead(404); res.end(); return; }

      const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2' };
      const contentType = contentTypes[path.extname(filePath)] || 'application/octet-stream';

      fs.readFile(filePath, (err, content) => {
        if (err) {
          if (err.code === 'ENOENT') {
            fs.readFile(path.join(frontendPath, 'index.html'), (err2, content2) => {
              if (err2) { res.writeHead(404); res.end('Not Found'); }
              else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(content2); }
            });
          } else { log.error(`文件读取错误: ${err.code}`); res.writeHead(500); res.end('Server Error'); }
        } else { res.writeHead(200, { 'Content-Type': contentType }); res.end(content); }
      });
    });

    frontendServer.on('error', reject);
    frontendServer.listen(frontendPort, '127.0.0.1', () => {
      log.info(`前端服务器启动: http://127.0.0.1:${frontendPort}`);
      resolve();
    });
  });
}

function stopFrontendServer() {
  if (frontendServer) { frontendServer.close(); frontendServer = null; }
}

// ==================== 窗口 ====================

function createWindow() {
  log.info('创建主窗口...');

  windowStateManager = createWindowStateManager();
  const windowState = windowStateManager.state;

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 1200, minHeight: 700,
    title: '木薯图像分割',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
    show: false, backgroundColor: '#f0f2f5'
  });

  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.loadURL(`http://127.0.0.1:${frontendPort}`);
  mainWindow.once('ready-to-show', () => { log.info('窗口准备就绪'); mainWindow.show(); });

  // 关闭窗口时隐藏到托盘而不是退出
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
    // 真正退出时保存窗口状态
    if (windowStateManager) {
      windowStateManager.detach();
      windowStateManager = null;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  windowStateManager.attach();

  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools();
}

// ==================== 系统托盘 ====================

function getTrayIconPath() {
  // 尝试使用资源目录中的图标
  const resourceIcon = path.join(__dirname, '..', 'resources', 'icons', 'tray.png');
  if (fs.existsSync(resourceIcon)) {
    return resourceIcon;
  }
  // 回退到内建的空白图标
  return null;
}

function createTray() {
  const iconPath = getTrayIconPath();

  // 创建一个简单的 16x16 图标（如果找不到图标文件）
  let trayIcon;
  if (iconPath && fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath);
  } else {
    // 创建一个简单的绿色图标作为默认
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon.isEmpty() ? nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAEKSURBVDiNpZM9SgNBGIbfb3YvhEAhYqEUKGnjJVgIYmNj4w/Y+gN2/gJrG8FKsBQEKxEEC0G0EbRQKBLi7lh4bdnZXbvJJoX+gIXdzJv3vpl5a1YopVBKEUWRsdaOtdYKIYQQQgghxBgjf/6P8Tj8P4iilQqFwt6uMcbMzMwszczMLG1tbS1NTU0da+3YWntorR1ba8daa8daf2it/TJNs2utbWutbVtrx9baMWOM0DTNRkrpRkrpRkrpRkrpRkopp5RSCq01Wmu01mit0VprpZT8lVL6qZT8pZT+KKV/Sin9Vkr/VEr/Uin9U0r/VEr/VEr/VEr/VEr/VEr/VEr/VEr/VEpfS6X0tVRKP0ul9LVUSl9LpfS1VCgUCoVCoVAoFAqFQqFQ+P8+P4H/APn+7l8aTvk1AAAAAElFTkSuQmCC') : trayIcon);

  tray.setToolTip('木薯图像分割');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: '隐藏到托盘',
      click: () => {
        if (mainWindow) {
          mainWindow.hide();
        }
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  log.info('系统托盘已创建');
}

// 显示系统通知
function showNotification(title, body) {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: title,
      body: body,
      silent: false
    });
    notification.show();
  }
}

// IPC 通知处理
ipcMain.handle('show-notification', (event, { title, body }) => {
  showNotification(title, body);
  return { ok: true };
});

// ==================== IPC ====================

ipcMain.handle('get-backend-url', () => `http://127.0.0.1:${backendPort}`);
ipcMain.handle('get-frontend-url', () => `http://127.0.0.1:${frontendPort}`);
ipcMain.handle('check-issues', () => checkEnvironment());
ipcMain.handle('get-launch-mode', () => shouldUseBackendExe() ? 'backend-exe' : 'python-dev');

// 应用偏好设置
let appPreferences = loadAppPreferences();

ipcMain.handle('get-preferences', () => {
  return appPreferences;
});

// 自动更新相关
ipcMain.handle('get-app-version', () => {
  return {
    version: getAppVersion(),
    name: app.getName(),
    isPackaged: app.isPackaged
  };
});

ipcMain.handle('check-for-updates', async () => {
  return await checkForUpdates();
});

ipcMain.handle('get-version-info', () => {
  return loadVersionInfo();
});

ipcMain.handle('download-update', async (event, downloadUrl) => {
  if (!downloadUrl) {
    return { success: false, error: '无下载链接' };
  }

  try {
    const { dialog } = require('electron');
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '下载更新',
      message: `即将下载新版本更新包。\n\n下载完成后您需要手动安装更新。`,
      buttons: ['取消', '确定下载'],
      defaultId: 1
    });

    if (result.response === 0) {
      return { success: false, message: '已取消下载' };
    }

    // 打开默认浏览器下载
    const { shell } = require('electron');
    shell.openExternal(downloadUrl);

    return { success: true, message: '已打开下载页面' };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('set-preferences', (event, newPrefs) => {
  appPreferences = { ...appPreferences, ...newPrefs };
  saveAppPreferences(appPreferences);
  return appPreferences;
});

ipcMain.handle('rebuild-index', async () => {
  // 重建外部引用图片索引：检测所有 external 模式的图片文件是否仍有效
  try {
    const { dialog } = require('electron');
    const result = await dialog.showMessageDialog(mainWindow, {
      type: 'info',
      title: '重建图片索引',
      message: '即将扫描所有外部引用图片，检测文件是否有效。这可能需要一些时间。',
      buttons: ['取消', '开始扫描'],
      defaultId: 0,
      cancelId: 0,
    });
    if (result.response === 0) {
      return { ok: true, message: '已取消' };
    }
    // 调用后端 API 重建索引
    const http = require('http');
    const backendUrl = `http://127.0.0.1:${backendPort}`;
    const postData = JSON.stringify({ action: 'rebuild_index' });
    const req = http.request({
      hostname: '127.0.0.1',
      port: backendPort,
      path: '/api/system/rebuild-index/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          dialog.showMessageDialog(mainWindow, {
            type: 'info',
            title: '重建完成',
            message: `扫描完成。有效: ${parsed.valid || 0}, 失效: ${parsed.missing || 0}, 无效图片已标记。`,
            buttons: ['确定'],
          });
        } catch {
          dialog.showMessageDialog(mainWindow, {
            type: 'error',
            title: '重建失败',
            message: '后端返回数据解析失败',
            buttons: ['确定'],
          });
        }
      });
    });
    req.on('error', () => {
      dialog.showMessageDialog(mainWindow, {
        type: 'error',
        title: '重建失败',
        message: '无法连接后端服务',
        buttons: ['确定'],
      });
    });
    req.write(postData);
    req.end();
    return { ok: true, message: '正在扫描...' };
  } catch (error) {
    return { ok: false, message: String(error) };
  }
});

// 选择本地图片（多选）
ipcMain.handle('select-local-images', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'tiff', 'tif'] }],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

// 选择本地文件夹
ipcMain.handle('select-local-folder', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// ==================== 应用生命周期 ====================

app.whenReady().then(async () => {
  log.info('Electron应用就绪');
  installOfflineGuards();
  ensureRuntimeDirectories();

  await initPorts();

  // 环境检测
  const issues = await checkEnvironment();
  if (issues.length > 0) {
    dialog.showMessageBox({ type: 'warning', title: '环境警告', message: `发现以下问题:\n${issues.join('\n')}\n\n部分功能可能无法正常使用。` });
  }

  // 开发模式：数据库迁移 + 管理员初始化
  if (!shouldUseBackendExe()) {
    try {
      await runMigrate();
      await initAdminDev();
    } catch (e) {
      log.error('初始化失败:', e);
      dialog.showMessageBox({ type: 'error', title: '初始化错误', message: `初始化失败:\n${e.message}` });
    }
  }

  // 启动后端
  try {
    await startBackend();
  } catch (e) {
    log.error('后端启动失败:', e);
    dialog.showMessageBox({ type: 'error', title: '后端启动错误', message: `后端启动失败:\n${e.message}` });
    app.quit();
    return;
  }

  // 启动前端
  try {
    await startFrontendServer();
  } catch (e) {
    log.error('前端服务器启动失败:', e);
    app.quit();
    return;
  }

  createWindow();
  createTray();

  // 启动后检查更新（仅在打包模式下提示）
  if (app.isPackaged) {
    setTimeout(async () => {
      const updateInfo = await checkForUpdates();
      if (updateInfo.needsUpdate) {
        showNotification('发现新版本', `版本 ${updateInfo.latestVersion} 已发布。点击查看更新。`);
      }
    }, 5000);
  }
});

// 最小化到托盘而不是关闭
app.on('window-all-closed', (e) => {
  // 阻止默认退出行为，由托盘菜单控制退出
  if (!app.isQuitting) {
    e.preventDefault();
  }
});

app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('before-quit', () => { app.isQuitting = true; stopFrontendServer(); stopBackend(); });

process.on('uncaughtException', (error) => { log.error('Uncaught Exception:', error); });
process.on('unhandledRejection', (reason) => { log.error('Unhandled Rejection:', reason); });
