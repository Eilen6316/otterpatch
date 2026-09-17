/**
 * 首次运行模型配置向导 —— 新手接入的最后一公里。
 *
 * 设计文档 §10 把"新手不会自配 key"标为采用的生死线。API Key 按安全设计只驻留内存
 * (不落盘),所以每次新会话都是"首次运行"——本向导是唯一会用自然语言解释"需要什么、
 * 去哪拿、怎么验证"的地方。流程:选 Provider → 填 Key(可改模型名)→ 测试连接 → 完成。
 * 测试连接走真实的 /propose-stream 最小调用(意图"连接测试",模型只会回答、不会改文档),
 * 错误按 Provider 错误类型映射为友好文案。老手可跳过,照旧在 Composer 设置里配置。
 */
import { useReducer } from 'react';
import { useT } from './i18n.js';
import { canRunConnectionTest, initialSetupState, reduceSetup } from './first-run-setup-state.js';

export interface FirstRunProvider {
  id: string;
  label: string;
  model: string;
}

export interface FirstRunSetupProps {
  providers: FirstRunProvider[];
  providerId: string;
  onPickProvider: (id: string) => void;
  model: string;
  onModel: (model: string) => void;
  apiKey: string;
  onApiKey: (key: string) => void;
  /** 跑一次真实连接测试;返回 null 表示成功,否则返回可直接展示的错误文案。 */
  onTest: (providerId: string, model: string, apiKey: string) => Promise<string | null>;
  onSkip: () => void;
}


export function FirstRunSetup({
  providers,
  providerId,
  onPickProvider,
  model,
  onModel,
  apiKey,
  onApiKey,
  onTest,
  onSkip,
}: FirstRunSetupProps): JSX.Element {
  const t = useT();
  const [state, dispatch] = useReducer(reduceSetup, initialSetupState);
  const { step, error } = state;

  const runTest = async (): Promise<void> => {
    dispatch({ type: 'test-start' });
    const message = await onTest(providerId, model, apiKey.trim());
    dispatch(message ? { type: 'test-fail', message } : { type: 'test-ok' });
  };

  return (
    <div className="setup-overlay" role="dialog" aria-modal="true" aria-label={t('模型配置向导')}>
      <section className="setup-card">
        <header className="setup-head">
          <h2>{t('模型配置向导')}</h2>
          <button type="button" className="setup-skip" onMouseDown={(event) => { event.preventDefault(); onSkip(); }}>{t('稍后再说')}</button>
        </header>

        {step === 'provider' && (
          <div className="setup-body">
            <p className="setup-lead">{t('OtterPatch 用你自己的模型 Key(BYOK),Key 只存在当前会话内存,绝不上传、绝不落盘。')}</p>
            <div className="setup-providers">
              {providers.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  className={'setup-provider' + (provider.id === providerId ? ' on' : '')}
                  onMouseDown={(event) => { event.preventDefault(); onPickProvider(provider.id); }}
                  aria-pressed={provider.id === providerId}
                >
                  <span className="setup-provider-label">{t(provider.label)}</span>
                  <span className="setup-provider-model">{provider.model}</span>
                </button>
              ))}
            </div>
            <div className="setup-acts">
              <button type="button" className="btn solid" onMouseDown={(event) => { event.preventDefault(); dispatch({ type: 'next' }); }}>{t('下一步')}</button>
            </div>
          </div>
        )}

        {(step === 'key' || step === 'testing') && (
          <div className="setup-body">
            <p className="setup-lead">{t('在所选 Provider 的控制台创建 API Key,粘贴到下面。Key 只发给本机服务和你选的 Provider。')}</p>
            <label className="setup-field">
              <span>{t('API Key')}</span>
              <input
                type="password"
                value={apiKey}
                autoFocus
                placeholder="sk-…"
                onChange={(event) => onApiKey(event.target.value)}
              />
            </label>
            <label className="setup-field">
              <span>{t('模型')}</span>
              <input value={model} onChange={(event) => onModel(event.target.value)} />
            </label>
            {error && <p className="setup-error">{error}</p>}
            <div className="setup-acts">
              <button type="button" className="btn ghost" onMouseDown={(event) => { event.preventDefault(); dispatch({ type: 'back' }); }} disabled={step === 'testing'}>{t('上一步')}</button>
              <button
                type="button"
                className="btn solid"
                disabled={!canRunConnectionTest(state, apiKey)}
                onMouseDown={(event) => { event.preventDefault(); void runTest(); }}
              >
                {step === 'testing' ? t('正在测试连接…') : t('测试连接')}
              </button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="setup-body">
            <p className="setup-done">✓ {t('连接成功,可以开始圈选区域、说出你想怎么改了。')}</p>
            <div className="setup-acts">
              <button type="button" className="btn solid" onMouseDown={(event) => { event.preventDefault(); onSkip(); }}>{t('开始使用')}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
