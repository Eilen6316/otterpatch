/**
 * Composer — the agent input area: selection chip, intent textarea, attach button,
 * BYOK model panel and send. Extracted from App.tsx (decomposition phase 2); all state
 * stays in App, this component is render + callbacks. The selection chip is passed in
 * as a ReactNode so the composer stays format-agnostic.
 */
import type { MutableRefObject, ReactNode } from 'react';
import { useT } from './i18n.js';
import { IconPlus, IconChevron, IconSend, IconHelp, IconX } from './icons.js';

export interface ComposerProvider { id: string; label: string; model: string }

export interface BrowserLocalCredentials {
  serveToken: string;
  reviewToken: string;
  onServeToken(v: string): void;
  onReviewToken(v: string): void;
}

export interface ComposerProps {
  cfgOpen: boolean;
  onToggleCfg(): void;
  providers: ComposerProvider[];
  providerId: string;
  providerLabel: string;
  defaultModel: string;
  onPickProvider(id: string): void;
  model: string;
  onModel(v: string): void;
  apiKey: string;
  onApiKey(v: string): void;
  server: string;
  onServer(v: string): void;
  localCredentials?: BrowserLocalCredentials;
  selChip: ReactNode;
  intent: string;
  onIntent(v: string): void;
  placeholder: string;
  busy: boolean;
  onSend(): void;
  onCancel(): void;
  fileRef: MutableRefObject<HTMLInputElement | null>;
  fileName: string;
  onFile(f: File | undefined): void;
}

export function Composer(p: ComposerProps): ReactNode {
  const t = useT();
  return (
    <div className="composer">
      {p.cfgOpen && (
        <div className="modelcfg">
          <h4>{t('模型')} · BYOK</h4>
          <div className="prov">
            {p.providers.map((m) => (
              <button key={m.id} className={'pchip' + (m.id === p.providerId ? ' on' : '')} onClick={() => p.onPickProvider(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
          <label>{t('模型')}</label>
          <input value={p.model} onChange={(e) => p.onModel(e.target.value)} placeholder={p.defaultModel} />
          <label>API Key(BYOK)</label>
          <input data-role="provider-api-key" type="password" value={p.apiKey} onChange={(e) => p.onApiKey(e.target.value)} placeholder="sk-..." autoComplete="off" />
          <label>{t('本机服务地址(默认即可,一般无需修改)')}</label>
          <input className="dim" value={p.server} onChange={(e) => p.onServer(e.target.value)} placeholder="http://localhost:4319" />
          {p.localCredentials && (
            <div className="local-auth">
              <h5>{t('浏览器开发连接')}</h5>
              <label htmlFor="local-service-token">{t('本机服务令牌')}</label>
              <input
                id="local-service-token"
                data-role="local-service-token"
                type="password"
                value={p.localCredentials.serveToken}
                onChange={(e) => p.localCredentials?.onServeToken(e.target.value.trim())}
                placeholder="X-OtterPatch-Token"
                autoComplete="off"
                spellCheck={false}
              />
              <label htmlFor="local-review-token">{t('审阅令牌')}</label>
              <input
                id="local-review-token"
                data-role="local-review-token"
                type="password"
                value={p.localCredentials.reviewToken}
                onChange={(e) => p.localCredentials?.onReviewToken(e.target.value.trim())}
                placeholder="X-OtterPatch-Review-Token"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}
          <div className="note">
            <IconHelp size={13} /> {t('API Key 仅发送给本机服务和所选模型提供方;本机令牌仅发送给本机服务。')}
          </div>
        </div>
      )}
      <div className="box">
        <div className="selchip">
          <span className="dot" /> {p.selChip}
        </div>
        <textarea
          value={p.intent}
          onChange={(e) => p.onIntent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!p.busy) p.onSend();
            }
          }}
          placeholder={p.placeholder}
          rows={1}
        />
        <div className="row">
          <input
            ref={p.fileRef}
            type="file"
            accept=".xlsx,.docx,.drawio"
            data-role="attach"
            style={{ display: 'none' }}
            onChange={(e) => p.onFile(e.target.files?.[0] ?? undefined)}
          />
          <button className={'iconbtn plus' + (p.fileName ? ' on' : '')} title={p.fileName || t('附件')} onClick={() => p.fileRef.current?.click()}><IconPlus size={16} /></button>
          <span className="grow" />
          <button className={'model' + (p.cfgOpen ? ' on' : '')} onClick={p.onToggleCfg}>
            {p.providerLabel} <IconChevron size={13} />
          </button>
          <button
            className={'send' + (p.busy ? ' cancel' : '')}
            title={t(p.busy ? '取消本轮请求' : '发送')}
            aria-label={t(p.busy ? '取消本轮请求' : '发送')}
            onClick={p.busy ? p.onCancel : p.onSend}
          >
            {p.busy ? <IconX size={16} /> : <IconSend size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
