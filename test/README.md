# test/ — OtterPatch e2e

Playwright 端到端测试。共用 `harness.mjs`(静态伺服 `apps/desktop/dist` + 启动浏览器),取代以往散在仓库根目录的临时 `_*.mjs` 脚本。

前置:先构建被测产物
```bash
npm run build -w apps/desktop          # ui-smoke 需要
npm run build -w apps/mcp-server        # excel-agent 需要(serve)
```

## ui-smoke.mjs — 无需 Agent / Key
渲染、选区上抛、drawio 拖放等纯 UI 检查(可入 CI)。
```bash
node test/ui-smoke.mjs
```

## excel-agent.mjs — 真实大模型(BYOK)
验证 提问→回答、操作→diff、全局上下文。需要本机服务 + 自带 Key(密钥走环境变量,不入库)。
```bash
node apps/mcp-server/dist/serve.js &                 # 起本机 Agent 服务(:4319)
OTTERPATCH_TEST_KEY=sk-xxx \
OTTERPATCH_TEST_PROVIDER=deepseek \
OTTERPATCH_TEST_MODEL=deepseek-v4-flash \
  node test/excel-agent.mjs
```
未设 Key 或服务未起时自动跳过(退出码 0)。

> 规约:**所有测试脚本写在本目录**,不要再往仓库根目录丢 `_*.mjs`(那是 .gitignore 的临时区)。
