/**
 * OtterPatch 桌面壳(Electron 主进程)。
 * 生产:加载打包好的 dist/index.html(file://,vite base='./' 保证相对资源可解析)。
 * 开发:OtterPatch_DEV=1 时加载 Vite dev server(http://localhost:5173)并开 DevTools。
 * 安全:contextIsolation 开、nodeIntegration 关;外链走系统浏览器。
 */
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

const isDev = !!process.env.OtterPatch_DEV;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    title: 'OtterPatch — safe-commit layer',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    void win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
