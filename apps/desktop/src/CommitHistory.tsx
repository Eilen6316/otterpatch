/**
 * 提交记录面板 —— 消费持久审计留痕(merged PR 记录),Git 式历史。
 *
 * 数据只经 electron-bridge 的窄 IPC 通道读取(主进程读 JSONL,renderer 不碰文件系统);
 * 浏览器开发无桥无账本时显示空态提示。记录按时间倒序,每条显示意图/审阅方式/验证结果/
 * 源→输出哈希,可展开看细节。
 */
import { useState } from 'react';
import { useT } from './i18n.js';
import type { DesktopAuditRecord } from './electron-bridge.js';

export interface CommitHistoryProps {
  records: DesktopAuditRecord[];
  /** 账本目录未配置 / 无桥时为 false,用于区分"还没提交"与"没开留痕"。 */
  available: boolean;
}

const shortHash = (hash: string | undefined): string => (hash ? hash.slice(0, 10) + '…' : '—');

const formatTime = (ts: string): string => {
  const parsed = new Date(ts);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : ts;
};

export function CommitHistory({ records, available }: CommitHistoryProps): JSX.Element | null {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const ordered = [...records].sort((left, right) => right.ts.localeCompare(left.ts));

  if (!records.length && !available) return null;

  return (
    <section className="commit-history" aria-label={t('提交记录')}>
      <button
        type="button"
        className="commit-history-toggle"
        onMouseDown={(event) => { event.preventDefault(); setOpen((current) => !current); }}
        aria-expanded={open}
      >
        <span className="commit-history-caret">{open ? '▾' : '▸'}</span>
        {t('提交记录')}
        <span className="commit-history-count">{records.length}</span>
      </button>
      <div className={'commit-history-body' + (open ? '' : ' hidden')}>
          {!records.length ? (
            <p className="commit-history-empty">{t('暂无提交记录。配置 OtterPatch_AUDIT_DIR 后,每次审阅通过的提交都会留痕。')}</p>
          ) : (
            <ol className="commit-history-list">
              {ordered.map((record, index) => {
                const key = `${record.ts}-${record.changeSetId}-${index}`;
                const failed = record.verification.failedEdits.length;
                const detail = expanded === key;
                return (
                  <li key={key} className={'commit-history-item' + (record.ok ? ' ok' : ' bad')}>
                    <button
                      type="button"
                      className="commit-history-row"
                      onMouseDown={(event) => { event.preventDefault(); setExpanded(detail ? null : key); }}
                      aria-expanded={detail}
                    >
                      <span className="commit-history-intent">{record.intent}</span>
                      <span className="commit-history-meta">
                        {formatTime(record.ts)} · {record.format} · {record.editCount} {t('处改动')}
                        {' · '}{record.verification.verifiedEdits.length} {t('处验证通过')}
                        {failed > 0 && <span className="commit-history-bad"> · {failed} {t('处未通过验证')}</span>}
                        {record.verification.unverifiableEdits.length > 0 && <span> · {record.verification.unverifiableEdits.length} {t('处不可验证')}</span>}
                      </span>
                    </button>
                    {detail && (
                      <dl className="commit-history-detail">
                        <dt>{t('审阅方式')}</dt>
                        <dd>{record.reviewKind === 'receipt' ? t('已审阅') : t('未审阅(显式例外)')}</dd>
                        <dt>{t('审阅会话')}</dt>
                        <dd>{record.reviewerSessionId ?? '—'}</dd>
                        <dt>{t('后端')}</dt>
                        <dd>{record.backendId}</dd>
                        <dt>{t('源哈希')}</dt>
                        <dd title={record.sourceSha256}>{shortHash(record.sourceSha256)}</dd>
                        <dt>{t('输出哈希')}</dt>
                        <dd title={record.outputSha256}>{shortHash(record.outputSha256)}</dd>
                        <dt>touched</dt>
                        <dd>{record.touchedParts.join(', ')}</dd>
                        {record.verification.failedEdits.length > 0 && (
                          <>
                            <dt>{t('处未通过验证')}</dt>
                            <dd>{record.verification.failedEdits.map((failure) => `${failure.editId}: ${failure.reason}`).join('; ')}</dd>
                          </>
                        )}
                      </dl>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
    </section>
  );
}
