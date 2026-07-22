/**
 * Adapter registry — routes by format to a HostAdapter, avoiding hardcoded `new UniverAdapter`.
 * New formats (Excel/Word/PPT/drawio/…) only need to register one AdapterRegistration.
 * With multiple candidates, sorted by priority descending (markitdown-style priority).
 */
import type { HostAdapter } from './adapter.js';
import type { FormatCapabilityManifest } from './capabilities.js';

export interface AdapterRegistration {
  format: string; // 'excel' | 'word' | 'ppt' | 'drawio' | (string & {})
  aliases?: readonly string[];
  engines?: string[]; // engine hints: 'univer' | 'prosemirror' | 'drawio' …
  priority?: number; // higher wins among multiple candidates (default 0)
  manifest?: FormatCapabilityManifest;
  create(hostId: string): HostAdapter;
}

export class AdapterRegistry {
  private readonly regs: AdapterRegistration[] = [];

  register(reg: AdapterRegistration): void {
    const format = normalizeFormat(reg.format);
    const aliases = [...new Set((reg.aliases ?? []).map(normalizeFormat).filter((alias) => alias !== format))];
    this.regs.push({ ...reg, format, aliases });
    this.regs.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  /** Resolve a registration by format (highest-priority match). Returns undefined if none. */
  resolve(format: string): AdapterRegistration | undefined {
    const normalized = normalizeFormat(format);
    return this.regs.find((registration) => registration.format === normalized || registration.aliases?.includes(normalized));
  }

  /** Create an adapter instance directly. Throws if no match. */
  create(format: string, hostId: string): HostAdapter {
    const r = this.resolve(format);
    if (!r) throw new Error(`AdapterRegistry: no adapter registered for format "${format}"`);
    return r.create(hostId);
  }

  formats(): string[] {
    return [...new Set(this.regs.flatMap((registration) => [registration.format, ...(registration.aliases ?? [])]))];
  }

  manifests(): readonly FormatCapabilityManifest[] {
    const manifests = new Map<string, FormatCapabilityManifest>();
    for (const format of this.formats()) {
      const manifest = this.resolve(format)?.manifest;
      if (manifest && !manifests.has(manifest.format)) manifests.set(manifest.format, manifest);
    }
    return [...manifests.values()];
  }
}

function normalizeFormat(value: string): string {
  const format = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,47}$/.test(format)) throw new Error('AdapterRegistry: invalid format identifier');
  return format;
}
