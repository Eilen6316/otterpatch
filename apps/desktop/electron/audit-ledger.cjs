'use strict';

/**
 * Read-only projection of the commit audit ledger (packages/runtime audit.ts, JSONL).
 *
 * The renderer shows a Git-like commit history, but only the main process may touch the
 * filesystem. This module mirrors FileAuditLedger.read semantics in plain CJS so it works
 * both from source and inside the packaged app (no ESM import needed):
 *  · one JSONL per document (URL-encoded file name), sorted by ts;
 *  · a torn last line (crash mid-append) is skipped, never fatal;
 *  · documentId optional — omit to read every document's history.
 */
const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const MAX_LINE_BYTES = 256 * 1024;

function readLedgerFile(file) {
  if (!existsSync(file)) return [];
  const records = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim() || line.length > MAX_LINE_BYTES) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) records.push(parsed);
    } catch {
      // Torn line from an interrupted append: skip it; earlier records are intact.
    }
  }
  return records;
}

function ledgerFileFor(directory, documentId) {
  return join(directory, `${encodeURIComponent(documentId)}.jsonl`);
}

/** All commit records for one document (or all documents), oldest first. */
function readAuditLedger(directory, documentId) {
  if (!directory || typeof directory !== 'string') return [];
  if (documentId !== undefined && documentId !== null) {
    if (typeof documentId !== 'string' || !documentId.trim()) return [];
    return sortByTs(readLedgerFile(ledgerFileFor(directory, documentId)));
  }
  let names;
  try {
    names = readdirSync(directory);
  } catch {
    return [];
  }
  const records = [];
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    records.push(...readLedgerFile(join(directory, name)));
  }
  return sortByTs(records);
}

function sortByTs(records) {
  return records.sort((left, right) => String(left.ts ?? '').localeCompare(String(right.ts ?? '')));
}

module.exports = { readAuditLedger };
