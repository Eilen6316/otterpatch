/**
 * Composer — the agent input area: selection chip, intent textarea, attach button,
 * BYOK model panel and send. Extracted from App.tsx (decomposition phase 2); all state
 * stays in App, this component is render + callbacks. The selection chip is passed in
 * as a ReactNode so the composer stays format-agnostic.
 */
import type { MutableRefObject, ReactNode } from 'react';
import { useT } from './i18n.js';
import { IconPlus, IconChevron, IconSend, IconHelp } from './icons.js';

export interface ComposerProvider { id: string; label: string; model: string }

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
  selChip: ReactNode;
  intent: string;
  onIntent(v: string): void;
  placeholder: string;
  busy: boolean;
  onSend(): void;
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
          <input type="password" value={p.apiKey} onChange={(e) => p.onApiKey(e.target.value)} placeholder="sk-..." />
          <label>{t('本机服务地址(默认即可,一般无需修改)')}</label>
          <input className="dim" value={p.server} onChange={(e) => p.onServer(e.target.value)} placeholder="http://localhost:4319" />
          <div className="note">
            <IconHelp size={13} /> {t('密钥只存在你的浏览器本地,绝不上传服务器;桌面版会自动启动本机服务。')}
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
            accept=".xlsx,.docx,.pdf,.drawio"
            data-role="attach"
            style={{ display: 'none' }}
            onChange={(e) => p.onFile(e.target.files?.[0] ?? undefined)}
          />
          <button className={'iconbtn plus' + (p.fileName ? ' on' : '')} title={p.fileName || t('附件')} onClick={() => p.fileRef.current?.click()}><IconPlus size={16} /></button>
          <span className="grow" />
          <button className={'model' + (p.cfgOpen ? ' on' : '')} onClick={p.onToggleCfg}>
            {p.providerLabel} <IconChevron size={13} />
          </button>
          <button className="send" title={t('发送')} onClick={p.onSend} disabled={p.busy}><IconSend size={16} /></button>
        </div>
      </div>
    </div>
  );
}
