/** Shared host entry point. Importing the package itself still performs no I/O. */
import { defaultLibrary } from './catalog.js';
import { loadSkillDirectory } from './directory.js';
import { loadImportedSkills } from './importer.js';
import type { SkillLibrary } from './library.js';

export function initializeSkillLibrary(options: { directory?: string; registry?: string } = {}): {
  library: SkillLibrary; errors: Array<{ file: string; reason: string }>;
} {
  const library = defaultLibrary();
  const errors: Array<{ file: string; reason: string }> = [];
  const imported = options.registry ? loadImportedSkills(options.registry) : undefined;
  const reservedIds = new Set(imported?.reservedIds ?? []);
  // Approved locks win over same-ID loose files; built-ins already occupy their
  // immutable namespace. Rejected collisions remain observable to operators.
  for (const result of [imported,
    options.directory ? loadSkillDirectory(options.directory) : undefined]) {
    if (!result) continue;
    errors.push(...result.errors);
    for (const card of result.cards) {
      if (result !== imported && reservedIds.has(`${card.namespace}/${card.name}`)) {
        errors.push({ file: card.source ?? card.name, reason: 'skill conflict: registry-reserved ID cannot fall back to a loose file' });
        continue;
      }
      try { library.add(card); }
      catch (error) { errors.push({ file: card.source ?? `${card.namespace}/${card.name}`, reason: error instanceof Error ? error.message : String(error) }); }
    }
  }
  return { library, errors };
}

export function skillLibraryFromEnv(env: Record<string, string | undefined> = process.env): SkillLibrary {
  const result = initializeSkillLibrary({ directory: env.OtterPatch_SKILLS_DIR?.trim(), registry: env.OtterPatch_SKILL_REGISTRY?.trim() });
  // Surface invalid files to host operators; never promote them or silently load fallbacks.
  for (const error of result.errors) process.stderr.write(`[otterpatch skills] ${error.file}: ${error.reason}\n`);
  return result.library;
}
