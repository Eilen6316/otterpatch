import type { ChangeSet, Edit, EditOpKind } from './changeset.js';
import type { RiskLevel } from './risk.js';

export const CAPABILITY_MANIFEST_VERSION = 'capabilities-v1';

export type CapabilityScope = 'cell' | 'range' | 'sheet' | 'document' | 'object' | 'field' | 'slide';
export type CapabilityMaturity = 'experimental' | 'preview' | 'verified';
export type CapabilityStage = 'propose' | 'preview' | 'verify' | 'writeback';
export type CapabilityFeatureSupport = 'supported' | 'unsupported';
export type CapabilityFeatureStatus = CapabilityFeatureSupport | 'experimental' | 'incomplete' | 'not-guaranteed';

export interface OperationCapability {
  op: EditOpKind;
  /** Optional host-dialect name when it differs from the core operation kind. */
  proposalName?: string;
  propose: boolean;
  preview: boolean;
  verify: boolean;
  writeback: boolean;
  partialWriteback: boolean;
  maxScope: CapabilityScope;
  risk: RiskLevel;
  backend: readonly string[];
  maturity: CapabilityMaturity;
}

export interface FormatCapabilityManifest {
  version: typeof CAPABILITY_MANIFEST_VERSION;
  format: string;
  aliases: readonly string[];
  operations: readonly OperationCapability[];
  features?: Readonly<Record<string, CapabilityFeatureStatus>>;
}

type CapabilityInput = Omit<OperationCapability, 'propose' | 'preview' | 'verify' | 'writeback' | 'partialWriteback' | 'maturity'>
  & Partial<Pick<OperationCapability, 'proposalName' | 'propose' | 'preview' | 'verify' | 'writeback' | 'partialWriteback' | 'maturity'>>;

const verified = (input: CapabilityInput): OperationCapability => ({
  propose: true,
  preview: true,
  verify: true,
  writeback: true,
  partialWriteback: false,
  maturity: 'verified',
  ...input,
});

const writebackOnly = (input: CapabilityInput): OperationCapability => verified({
  preview: false,
  verify: false,
  maturity: 'preview',
  ...input,
});

const topologyChecked = (input: CapabilityInput): OperationCapability => verified({
  preview: false,
  verify: true,
  maturity: 'preview',
  ...input,
});

const manifests = [
  {
    version: CAPABILITY_MANIFEST_VERSION,
    format: 'excel',
    aliases: ['excel', 'xlsx'],
    operations: [
      verified({ op: 'setValue', maxScope: 'range', risk: 'safe', backend: ['surgical-ooxml'] }),
      verified({ op: 'setFormula', maxScope: 'range', risk: 'safe', backend: ['surgical-ooxml'], maturity: 'preview' }),
      verified({ op: 'setStyle', maxScope: 'range', risk: 'safe', backend: ['surgical-ooxml'], maturity: 'preview' }),
      verified({ op: 'setNumberFormat', maxScope: 'range', risk: 'safe', backend: ['surgical-ooxml'], maturity: 'preview' }),
      verified({ op: 'deleteRange', proposalName: 'clear', maxScope: 'range', risk: 'destructive', backend: ['surgical-ooxml'] }),
    ],
  },
  {
    version: CAPABILITY_MANIFEST_VERSION,
    format: 'word',
    aliases: ['word', 'docx'],
    operations: [
      writebackOnly({ op: 'replaceText', maxScope: 'range', risk: 'safe', backend: ['word-redline'] }),
      writebackOnly({ op: 'setStyle', maxScope: 'document', risk: 'safe', backend: ['word-redline'] }),
      writebackOnly({ op: 'deleteRange', maxScope: 'range', risk: 'destructive', backend: ['word-redline'] }),
      writebackOnly({ op: 'setObjectProps', maxScope: 'object', risk: 'caution', backend: ['word-redline'] }),
      writebackOnly({ op: 'insertTable', maxScope: 'document', risk: 'caution', backend: ['word-redline'] }),
    ],
  },
  {
    version: CAPABILITY_MANIFEST_VERSION,
    format: 'drawio',
    aliases: ['drawio'],
    features: { compressed: 'unsupported' },
    operations: [
      topologyChecked({ op: 'setValue', maxScope: 'object', risk: 'safe', backend: ['drawio-surgical'] }),
      topologyChecked({ op: 'setObjectProps', maxScope: 'object', risk: 'caution', backend: ['drawio-surgical'] }),
      topologyChecked({ op: 'moveObject', maxScope: 'object', risk: 'safe', backend: ['drawio-surgical'] }),
      topologyChecked({ op: 'addObject', maxScope: 'object', risk: 'caution', backend: ['drawio-surgical'] }),
      topologyChecked({ op: 'deleteObject', maxScope: 'object', risk: 'destructive', backend: ['drawio-surgical'] }),
    ],
  },
  {
    version: CAPABILITY_MANIFEST_VERSION,
    format: 'pdf',
    aliases: ['pdf'],
    features: {
      acroFormTextFill: 'experimental',
      semanticVerification: 'incomplete',
      byteLocality: 'not-guaranteed',
    },
    operations: [
      writebackOnly({ op: 'setValue', maxScope: 'field', risk: 'safe', backend: ['pdf-form'], maturity: 'experimental' }),
    ],
  },
  {
    version: CAPABILITY_MANIFEST_VERSION,
    format: 'ppt',
    aliases: ['ppt', 'pptx'],
    operations: [
      writebackOnly({ op: 'replaceText', maxScope: 'slide', risk: 'safe', backend: ['surgical-ooxml'] }),
    ],
  },
] as const satisfies readonly FormatCapabilityManifest[];

const byAlias = new Map<string, FormatCapabilityManifest>();
for (const manifest of manifests) {
  for (const alias of manifest.aliases) byAlias.set(alias, manifest);
}

const EXCEL_STYLE_KEYS = new Set(['bold', 'italic', 'color', 'bgColor', 'align']);
const WORD_CHARACTER_STYLE_KEYS = new Set(['bold', 'italic', 'underline', 'font', 'size', 'color']);
const WORD_PARAGRAPH_STYLE_KEYS = new Set(['align', 'lineSpacing', 'bgColor', 'block']);
const WORD_LOCAL_STYLE_KEYS = new Set([...WORD_CHARACTER_STYLE_KEYS, ...WORD_PARAGRAPH_STYLE_KEYS]);
const WORD_PAGE_STYLE_KEYS = new Set(['columns', 'margin', 'orient']);

export function capabilityManifests(): readonly FormatCapabilityManifest[] {
  return manifests;
}

export function capabilityManifestFor(format: string): FormatCapabilityManifest | undefined {
  return byAlias.get(format.toLowerCase());
}

export function operationCapabilitiesFor(format: string): readonly OperationCapability[] {
  return capabilityManifestFor(format)?.operations ?? [];
}

export function formatFeatureSupport(format: string, feature: string): CapabilityFeatureStatus | undefined {
  return capabilityManifestFor(format)?.features?.[feature];
}

export function proposalOperationNamesFor(format: string): string[] {
  return operationCapabilitiesFor(format)
    .filter((capability) => capability.propose)
    .map((capability) => capability.proposalName ?? capability.op);
}

export function writebackOperationKindsFor(format: string): EditOpKind[] {
  return operationCapabilitiesFor(format)
    .filter((capability) => capability.writeback)
    .map((capability) => capability.op);
}

export function supportsFormatOperation(format: string, op: EditOpKind, stage: CapabilityStage): boolean {
  const capability = operationCapabilitiesFor(format).find((candidate) => candidate.op === op);
  return capability?.[stage] === true;
}

/** Built-in formats fail closed at the same capability gate before review and before writeback. */
export function assertFormatCapabilities(format: string, changeSet: ChangeSet, stage: CapabilityStage): void {
  const manifest = capabilityManifestFor(format);
  // Extension backends registered by an embedding host retain their own canHandle/supports contract.
  if (!manifest) return;
  for (const edit of changeSet.edits) {
    if (!supportsFormatOperation(format, edit.op.kind, stage)) {
      throw new Error(`${format} capability manifest does not allow ${stage} for op ${edit.op.kind}`);
    }
    assertFormatSpecificPayload(manifest.format, changeSet, edit);
  }
}

function assertFormatSpecificPayload(format: string, changeSet: ChangeSet, edit: Edit): void {
  const anchor = changeSet.anchors[edit.target];
  if (format === 'excel') {
    if (anchor?.portable.kind !== 'grid') throw new Error(`excel capability requires a grid anchor for edit ${edit.id}`);
    if (edit.op.kind === 'setStyle') {
      if (edit.op.scope !== 'selection') throw new Error('excel setStyle requires selection scope');
      assertOnlyKeys(edit.op.style, EXCEL_STYLE_KEYS, 'excel setStyle');
    }
    return;
  }
  if (format !== 'word') return;
  if (anchor?.portable.kind !== 'flow') throw new Error(`word capability requires a flow anchor for edit ${edit.id}`);
  if (edit.op.kind !== 'setStyle') return;

  const keys = Object.keys(edit.op.style);
  if (!keys.length) throw new Error('word setStyle requires at least one supported style field');
  const pageKeys = keys.filter((key) => WORD_PAGE_STYLE_KEYS.has(key));
  const localKeys = keys.filter((key) => WORD_LOCAL_STYLE_KEYS.has(key));
  const characterKeys = keys.filter((key) => WORD_CHARACTER_STYLE_KEYS.has(key));
  const paragraphKeys = keys.filter((key) => WORD_PARAGRAPH_STYLE_KEYS.has(key));
  const unknown = keys.filter((key) => !WORD_PAGE_STYLE_KEYS.has(key) && !WORD_LOCAL_STYLE_KEYS.has(key));
  if (unknown.length) throw new Error('word setStyle contains unsupported fields: ' + unknown.join(', '));
  if (pageKeys.length && localKeys.length) throw new Error('word page and local style fields must be separate edits');

  const hasLocation = anchor.portable.quote.text.length > 0 || anchor.portable.path[0] !== undefined;
  if (pageKeys.length && edit.op.scope !== 'document' && edit.op.scope !== 'section') {
    throw new Error('word page styling requires section or document scope');
  }
  if (pageKeys.length && edit.op.scope === 'section') {
    throw new Error('word section-scoped page styling is not supported by the current backend');
  }
  if (localKeys.length && edit.op.scope !== 'selection' && edit.op.scope !== 'paragraph') {
    throw new Error('word local styling requires selection or paragraph scope');
  }
  if (paragraphKeys.length && edit.op.scope !== 'paragraph') {
    throw new Error('word paragraph styling requires paragraph scope');
  }
  if (characterKeys.length && !anchor.portable.quote.text) {
    throw new Error('word character styling requires a non-empty quote');
  }
  if (localKeys.length && !hasLocation) {
    throw new Error('word document-wide character or paragraph styling is not supported; target a quote or paragraph');
  }
  if (pageKeys.length && hasLocation) {
    throw new Error('word page styling must use an empty document-level anchor');
  }
}

function assertOnlyKeys(value: object, allowed: ReadonlySet<string>, label: string): void {
  const keys = Object.keys(value);
  if (!keys.length) throw new Error(`${label} requires at least one supported style field`);
  const unknown = keys.filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`${label} contains unsupported fields: ${unknown.join(', ')}`);
}
