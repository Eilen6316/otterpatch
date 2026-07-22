/**
 * OtterPatch 桌面壳(Electron 主进程)。
 * 生产:加载打包好的 dist/index.html(file://,vite base='./' 保证相对资源可解析)。
 * 开发:OTTERPATCH_DEV=1 时加载 Vite dev server(http://localhost:5173)并开 DevTools。
 * 安全:contextIsolation 开、nodeIntegration 关;外链走系统浏览器。
 */
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');
const {
  MAX_IPC_BODY_BYTES,
  validateCommitInvocation,
  validateCommitResult,
  validateProposeInvocation,
  validateRequestId,
  validateStreamEventEnvelope,
} = require('./ipc-contract.cjs');

const isDev = !!process.env.OTTERPATCH_DEV;
const isPackagedSmoke = process.env.OTTERPATCH_PACKAGED_SMOKE === '1' && process.argv.includes('--ci-smoke-test');
const appDistDir = path.resolve(__dirname, '..', 'dist');
const appIndexUrl = pathToFileURL(path.join(appDistDir, 'index.html')).href;
const serveToken = process.env.OtterPatch_TOKEN || randomBytes(24).toString('base64url');
const reviewToken = process.env.OtterPatch_REVIEW_TOKEN || randomBytes(24).toString('base64url');
const parsedServePort = Number(process.env.OtterPatch_PORT || 4319);
const servePort = Number.isSafeInteger(parsedServePort) && parsedServePort > 0 && parsedServePort <= 65_535 ? parsedServePort : 4319;
const serveEndpoint = `http://127.0.0.1:${servePort}`;
const CHANNELS = Object.freeze({
  propose: 'otterpatch:propose-stream',
  proposeCancel: 'otterpatch:propose-cancel',
  proposeEvent: 'otterpatch:propose-event',
  commit: 'otterpatch:commit-writeback',
});
const activeProposals = new Map();
const MAX_SSE_BUFFER_BYTES = 2 * 1024 * 1024;

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
    u.hash = '';
    u.search = '';
    return u.href === appIndexUrl;
  } catch {
    return false;
  }
}

function assertTrustedSender(event) {
  const senderUrl = event.senderFrame && event.senderFrame.url;
  if (!senderUrl || event.senderFrame !== event.sender.mainFrame || !isAllowedAppNavigation(senderUrl)) {
    throw new Error('untrusted IPC sender');
  }
}

function proposalKey(senderId, requestId) {
  return `${senderId}:${requestId}`;
}

function safeServiceMessage(value, fallback) {
  const message = typeof value === 'string' && value ? value.slice(0, 1_000) : fallback;
  return message.split(serveToken).join('[REDACTED]').split(reviewToken).join('[REDACTED]');
}

async function responseObject(response) {
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_IPC_BODY_BYTES) throw new Error('local service response exceeds IPC limit');
  try {
    const value = text ? JSON.parse(text) : {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('response is not an object');
    return value;
  } catch {
    throw new Error('local service returned invalid JSON');
  }
}

async function localJson(pathname, body, includeReviewToken = false) {
  const response = await fetch(serveEndpoint + pathname, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OtterPatch-Token': serveToken,
      ...(includeReviewToken ? { 'X-OtterPatch-Review-Token': reviewToken } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await responseObject(response);
  if (!response.ok) throw new Error(safeServiceMessage(data.error, `local service request failed (${response.status})`));
  return data;
}

function sendProposalEvent(sender, envelope) {
  if (sender.isDestroyed()) throw new Error('renderer was closed');
  sender.send(CHANNELS.proposeEvent, validateStreamEventEnvelope(envelope));
}

async function forwardProposalStream(event, invocation) {
  assertTrustedSender(event);
  const validated = validateProposeInvocation(invocation);
  const key = proposalKey(event.sender.id, validated.requestId);
  if (activeProposals.has(key)) throw new Error('proposal request id is already active');
  const controller = new AbortController();
  let eventCount = 0;
  activeProposals.set(key, { controller, senderId: event.sender.id });
  try {
    const response = await fetch(serveEndpoint + '/propose-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-OtterPatch-Token': serveToken },
      body: validated.body,
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      const data = await responseObject(response);
      throw new Error(safeServiceMessage(data.error, `proposal request failed (${response.status})`));
    }
    sendProposalEvent(event.sender, { requestId: validated.requestId, kind: 'open' });
    eventCount += 1;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (Buffer.byteLength(buffer, 'utf8') > MAX_SSE_BUFFER_BYTES) throw new Error('local service stream frame exceeds IPC limit');
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';
        for (const frame of frames) {
          const line = frame.split('\n').find((candidate) => candidate.startsWith('data: '));
          if (!line) continue;
          let streamEvent;
          try {
            streamEvent = JSON.parse(line.slice(6));
          } catch {
            throw new Error('local service returned malformed stream data');
          }
          sendProposalEvent(event.sender, { requestId: validated.requestId, kind: 'event', event: streamEvent });
          eventCount += 1;
        }
      }
    } finally {
      if (controller.signal.aborted) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    return { ok: true, eventCount };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('proposal request cancelled');
    throw new Error(safeServiceMessage(error instanceof Error ? error.message : String(error), 'proposal request failed'));
  } finally {
    activeProposals.delete(key);
  }
}

async function reviewAndCommit(event, invocation) {
  assertTrustedSender(event);
  const input = validateCommitInvocation(invocation);
  const reviewed = await localJson('/review', {
    fileBase64: input.fileBase64,
    changeSet: input.changeSet,
    proposal: input.proposal,
    acceptedEditIds: input.acceptedEditIds,
    reviewerSessionId: `desktop-main:${randomUUID()}`,
  }, true);
  if (!reviewed.proposal || !reviewed.reviewReceipt) throw new Error('local service did not issue a review receipt');
  const result = await localJson('/commit', {
    format: input.format,
    fileBase64: input.fileBase64,
    changeSet: input.changeSet,
    proposal: reviewed.proposal,
    reviewReceipt: reviewed.reviewReceipt,
  });
  return validateCommitResult(result);
}

function abortProposalsForSender(senderId) {
  for (const active of activeProposals.values()) {
    if (active.senderId === senderId) active.controller.abort();
  }
}

ipcMain.handle(CHANNELS.propose, forwardProposalStream);
ipcMain.on(CHANNELS.proposeCancel, (event, requestId) => {
  try {
    assertTrustedSender(event);
    const id = validateRequestId(requestId);
    activeProposals.get(proposalKey(event.sender.id, id))?.controller.abort();
  } catch {
    // Invalid cancellation messages have no authority and are ignored.
  }
});
ipcMain.handle(CHANNELS.commit, reviewAndCommit);

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
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        OtterPatch_PORT: String(servePort),
        OtterPatch_TOKEN: serveToken,
        OtterPatch_REVIEW_TOKEN: reviewToken,
      },
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
    show: !isPackagedSmoke,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const senderId = win.webContents.id;
  win.webContents.once('destroyed', () => abortProposalsForSender(senderId));

  if (isPackagedSmoke) {
    let settled = false;
    const finish = (code, message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const stream = code === 0 ? process.stdout : process.stderr;
      stream.write(`${message}\n`);
      if (code === 0) app.quit();
      else app.exit(code);
    };
    const timeout = setTimeout(() => finish(1, 'OTTERPATCH_PACKAGED_SMOKE_TIMEOUT'), 30_000);
    win.webContents.once('did-finish-load', () => {
      const loadedUrl = win.webContents.getURL();
      if (!app.isPackaged || !isAllowedAppNavigation(loadedUrl)) {
        finish(1, `OTTERPATCH_PACKAGED_SMOKE_INVALID_URL ${loadedUrl}`);
        return;
      }
      finish(0, 'OTTERPATCH_PACKAGED_SMOKE_OK');
    });
    win.webContents.once('did-fail-load', (_event, code, description, url) => {
      finish(1, `OTTERPATCH_PACKAGED_SMOKE_LOAD_FAILED ${code} ${description} ${url}`);
    });
  }

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
  if (!isPackagedSmoke) startServe();
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
  if (!isPackagedSmoke && BrowserWindow.getAllWindows().length === 0) createWindow();
});
