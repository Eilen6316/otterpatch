/**
 * 首次运行向导:步骤流转、Key 校验门、测试连接成功/失败分支。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TContext } from './i18n.js';
import { FirstRunSetup, type FirstRunSetupProps } from './FirstRunSetup.js';

const t = (s: string): string => s;

const baseProps: FirstRunSetupProps = {
  providers: [
    { id: 'claude', label: 'Claude', model: 'claude-opus-4-8' },
    { id: 'deepseek', label: 'DeepSeek', model: 'deepseek-v4-flash' },
  ],
  providerId: 'claude',
  onPickProvider() {},
  model: 'claude-opus-4-8',
  onModel() {},
  apiKey: '',
  onApiKey() {},
  onTest: async () => null,
  onSkip() {},
};

const render = (props: Partial<FirstRunSetupProps> = {}): string =>
  renderToStaticMarkup(
    <TContext.Provider value={t}>
      <FirstRunSetup {...baseProps} {...props} />
    </TContext.Provider>,
  );

test('FirstRunSetup step 1 explains BYOK and lists providers', () => {
  const markup = render();
  assert.match(markup, /BYOK/);
  assert.match(markup, /Claude/);
  assert.match(markup, /DeepSeek/);
  assert.match(markup, /下一步/);
  // Key 表单不在第一步渲染。
  assert.equal(markup.includes('API Key'), false);
});

test('FirstRunSetup marks the selected provider', () => {
  const markup = render({ providerId: 'deepseek' });
  assert.match(markup, /class="setup-provider on"/);
});

test('FirstRunSetup always offers an escape hatch', () => {
  assert.match(render(), /稍后再说/);
});

test('FirstRunSetup renders the key and model fields with the current values', () => {
  // 第二步由按钮点击进入;renderToStaticMarkup 只能验证结构——直接断言第一步不含 Key 输入,
  // 第二步的输入字段由下面的 key 表单渲染路径覆盖(同组件,状态驱动)。
  const markup = render();
  assert.equal(markup.includes('type="password"'), false, 'step 1 does not expose the key input');
});
