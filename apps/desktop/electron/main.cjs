/**
 * OtterPatch 桌面壳(Electron 主进程)。
 * 生产:加载打包好的 dist/index.html(file://,vite base='./' 保证相对资源可解析)。
 * 开发:OTTERPATCH_DEV=1 时加载 Vite dev server(http://localhost:5173)并开 DevTools。
 * 安全:contextIsolation 开、nodeIntegration 关;外链走系统浏览器。
 */
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');

const isDev = !!process.env.OTTERPATCH_DEV;
const appDistDir = path.resolve(__dirname, '..', 'dist');
const serveToken = process.env.OtterPatch_TOKEN || randomBytes(24).toString('base64url');
const reviewToken = process.env.OtterPatch_REVIEW_TOKEN || randomBytes(24).toString('base64url');
process.env.OtterPatch_TOKEN = serveToken;
process.env.OtterPatch_REVIEW_TOKEN = reviewToken;

function isSafeExternalUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(u.hostname));
  } catch {
    return false;
  }
}

function isAllowedAppNavigation(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (isDev) return u.origin === 'http://localhost:5173';
    return u.protocol === 'file:';
  } catch {
    return false;
  }
}

// 自动启动本机 Agent 服务(otterpatch-serve),让非技术用户开箱即用、无需手动跑命令。
let serveProc = null;
function startServe() {
  try {
    const candidates = [
      path.join(__dirname, '..', '..', 'mcp-server', 'dist', 'serve.js'), // 开发(monorepo)
      path.join(process.resourcesPath || '', 'serve', 'serve.js'), // 打包(extraResources)
    ];
    const servePath = candidates.find((p) => p && fs.existsSync(p));
    if (!servePath) return;
    serveProc = spawn(process.execPath, [servePath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', OtterPatch_TOKEN: serveToken, OtterPatch_REVIEW_TOKEN: reviewToken },
      stdio: 'ignore',
      windowsHide: true,
    });
    serveProc.on('error', () => {
      serveProc = null;
    });
  } catch {
    /* 服务可选;失败时 UI 会提示手动启动 */
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    title: 'OtterPatch — safe-commit layer',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    void win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  win.webContents.on('will-navigate', (event, url) => {
    if (isAllowedAppNavigation(url)) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  startServe();
  createWindow();
});

app.on('will-quit', () => {
  if (serveProc) {
    try {
      serveProc.kill();
    } catch {
      /* ignore */
    }
    serveProc = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
