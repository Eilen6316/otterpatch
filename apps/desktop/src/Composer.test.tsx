import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Composer, type ComposerProps } from './Composer.js';

const baseProps: ComposerProps = {
  cfgOpen: true,
  onToggleCfg() {},
  providers: [{ id: 'openai', label: 'OpenAI', model: 'gpt-test' }],
  providerId: 'openai',
  providerLabel: 'OpenAI',
  defaultModel: 'gpt-test',
  onPickProvider() {},
  model: 'gpt-test',
  onModel() {},
  apiKey: '',
  onApiKey() {},
  server: 'http://localhost:4319',
  onServer() {},
  selChip: 'Selection',
  intent: '',
  onIntent() {},
  placeholder: 'Instruction',
  busy: false,
  onSend() {},
  onCancel() {},
  fileRef: { current: null },
  fileName: '',
  onFile() {},
};

test('Composer exposes local service credentials only when browser development enables them', () => {
  const browserMarkup = renderToStaticMarkup(<Composer
    {...baseProps}
    localCredentials={{
      serveToken: '',
      reviewToken: '',
      onServeToken() {},
      onReviewToken() {},
    }}
  />);
  assert.match(browserMarkup, /data-role="provider-api-key"/);
  assert.match(browserMarkup, /data-role="local-service-token"/);
  assert.match(browserMarkup, /data-role="local-review-token"/);

  const electronMarkup = renderToStaticMarkup(<Composer {...baseProps} />);
  assert.doesNotMatch(electronMarkup, /data-role="local-service-token"/);
  assert.doesNotMatch(electronMarkup, /data-role="local-review-token"/);
});
