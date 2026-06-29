/**
 * 可复用的 e2e harness:静态伺服 apps/desktop/dist + 启动 Playwright。
 * 取代散落在仓库根目录的临时 _*.mjs 脚本。
 *   const { page, errors, teardown } = await openApp();
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const EXT = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

/** 启动一个伺服 dist 的静态服务器(端口随机)。返回 { url, close }。 */
export async function serveDist(root = 'apps/desktop/dist') {
  const abs = path.resolve(root);
  const srv = http.createServer(async (req, res) => {
    try {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p === '/') p = '/index.html';
      const d = await readFile(path.join(abs, p));
      res.setHeader('Content-Type', EXT[path.extname(p)] || 'application/octet-stream');
      res.end(d);
    } catch {
      res.statusCode = 404;
      res.end('404');
    }
  });
  await new Promise((r) => srv.listen(0, r));
  return { url: `http://localhost:${srv.address().port}`, close: () => srv.close() };
}

/** 打开已构建的应用。storage:预置 localStorage(用于配置 Agent)。 */
export async function openApp({ storage } = {}) {
  const { url, close } = await serveDist();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1480, height: 860 }, deviceScaleFactor: 1.5 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 160));
  });
  if (storage) {
    await page.addInitScript((kv) => {
      for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
    }, storage);
  }
  await page.goto(url + '/index.html', { waitUntil: 'networkidle' });
  return {
    page,
    browser,
    errors,
    teardown: async () => {
      await browser.close();
      close();
    },
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 极简断言收集器。 */
export function createReporter() {
  let pass = 0;
  let fail = 0;
  return {
    ok(name, cond, extra = '') {
      if (cond) {
        pass++;
        console.log('  ✓', name, extra);
      } else {
        fail++;
        console.log('  ✗', name, extra);
      }
    },
    done() {
      console.log(`\n${pass} passed, ${fail} failed`);
      return fail;
    },
  };
}
