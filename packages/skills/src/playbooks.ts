/**
 * Domain playbook catalog. SKILL.md remains the source of truth, while the build-time generator
 * produces a static manifest so importing this package never performs filesystem I/O.
 * L0 = frontmatter (goes into the system-prompt skill list); L1 = body (fetched on demand via
 * the load_skill tool once the model matches a skill).
 */
import { parseBuiltinSkillMd, type SkillCard } from './parse.js';
import { PLAYBOOK_MARKDOWN } from './playbooks.generated.js';

export const PLAYBOOK_SKILLS: readonly SkillCard[] = Object.freeze(
  Object.entries(PLAYBOOK_MARKDOWN).map(([name, markdown]) =>
    parseBuiltinSkillMd(markdown, `otterpatch/playbooks/${name}@generated`)),
);
