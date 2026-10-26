/** Offline fixtures reconstructed from byte-verified upstream snapshot, not a fake upstream Git repo. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync, unzipSync } from 'fflate';
import { readImportedRelease, setImportedSkillState, skillChecksum } from '@otterpatch/skills';
import { docRevFromSha256 } from '@otterpatch/core';
import { sha256Bytes } from '@otterpatch/runtime';
export const skillId = 'anthropic/internal-comms';
export const tasks = JSON.parse(readFileSync(new URL('./fixtures/internal-comms/tasks.json', import.meta.url), 'utf8'));
const base = new URL('../third-party/anthropic-internal-comms/', import.meta.url);
export function officialRegistry(registry, enabled = true) {
  const config = JSON.parse(readFileSync(new URL('import-approval.template.json', base), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('upstream-lock.json', base), 'utf8'));
  const read = (path) => {
    const text = readFileSync(new URL(path, base), 'utf8');
    if (skillChecksum(text) !== lock.files[path]) throw new Error(`upstream fixture checksum mismatch: ${path}`);
    return text;
  };
  const source = config.sources[0]; const approval = source.skills[0];
  approval.approvedBy = 'automated regression fixture; not a human approval';
  const payload = { version: 1, repository: source.repository, revision: source.revision, approval,
    markdown: read('SKILL.md'), licenseText: read('LICENSE.txt'),
    references: approval.references.map(({ path }) => ({ path, content: read(path) })),
  };
  const serialized = JSON.stringify(payload); const release = skillChecksum(serialized).slice(7);
  mkdirSync(join(registry, 'releases'), { recursive: true });
  writeFileSync(join(registry, 'releases', `${release}.json`), serialized, { mode: 0o600 });
  const imported = readImportedRelease(registry, release);
  setImportedSkillState(registry, imported.id, release, enabled);
  return imported;
}
const enc = (text) => new TextEncoder().encode(text);
const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function docx(task) {
  return zipSync({
    '[Content_Types].xml': enc('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'),
    '_rels/.rels': enc('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': enc(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${task.paragraphs.map((text) => `<w:p><w:r><w:t xml:space="preserve">${escape(text)}</w:t></w:r></w:p>`).join('')}<w:sectPr/></w:body></w:document>`),
    'word/styles.xml': enc('<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'),
    'docProps/audit.xml': enc('<audit>unrelated part must remain byte-identical</audit>'),
  });
}
export function request(task, bytes) {
  return { hostId: task.id, documentId: task.id, userId: 'synthetic-evaluation', format: 'word', intent: task.intent,
    baseRev: docRevFromSha256(sha256Bytes(bytes)), sourceFileSha256: sha256Bytes(bytes), anchors: [],
    context: task.paragraphs.join('\n'), doc: { blocks: task.paragraphs.map((text) => ({ style: 'Normal', text })) } };
}
export function acceptedText(bytes) {
  let xml = new TextDecoder().decode(unzipSync(bytes)['word/document.xml']);
  xml = xml.replace(/<w:del\b[\s\S]*?<\/w:del>/g, '');
  return [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join('');
}
export function quality(task, text, kind) {
  const normalized = (s) => s.replace(/[，,。；;：:\s]/g, '');
  const factsPreserved = (task.facts ?? []).every((fact) => normalized(text).includes(normalized(fact)));
  const numbersBefore = task.paragraphs.join('').match(/\d+(?:\.\d+)?/g) ?? [];
  const numbersAfter = text.match(/\d+(?:\.\d+)?/g) ?? [];
  const noInventedNumbers = numbersAfter.every((number) => numbersBefore.includes(number));
  const protectedText = task.paragraphs.filter((p) => p.startsWith('保护区域')).every((p) => normalized(text).includes(normalized(p)));
  const expectedKind = task.expected ? kind !== 'changeset' : kind === 'changeset';
  return { factsPreserved, noInventedNumbers, protectedText, expectedKind,
    ruleScore: Number(factsPreserved) + Number(noInventedNumbers) + Number(protectedText) + Number(expectedKind) };
}
