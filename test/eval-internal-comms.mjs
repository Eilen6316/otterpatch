/** Explicit opt-in real-provider A/B. Mock engineering lives in a different test command. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createModelClient, PROVIDERS } from '@otterpatch/agent';
import { assertChangeSet } from '@otterpatch/core';
import { defaultLibrary, initializeSkillLibrary } from '@otterpatch/skills';
import { OtterPatchRuntime } from '@otterpatch/runtime';
import { officialRegistry, tasks, request, docx, acceptedText, quality, skillId } from './internal-comms-fixture.mjs';

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
const provider = process.env.OtterPatch_PROVIDER || 'claude';
const key = process.env.OtterPatch_API_KEY || (provider === 'claude' ? process.env.ANTHROPIC_API_KEY : provider === 'openai' ? process.env.OPENAI_API_KEY : undefined);
const out = resolve(arg('out') || '.work/internal-comms-real-ab.json');
const save = (report) => { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(report, (_name, value) => typeof value === 'string' && key ? value.replaceAll(key, '[redacted]') : value, 2), { mode: 0o600 }); };
if (!process.argv.includes('--real') || !key) {
  const report = { status: 'SKIPPED — no real model evaluation', reason: !key ? 'no BYOK API key' : '--real opt-in required',
    provider, plannedTasksPerGroup: tasks.length, groups: { A: { executed: 0, metrics: null }, B: { executed: 0, metrics: null } },
    humanReview: 'NOT PERFORMED', tokens: null, costUSD: null };
  save(report); console.log(report.status); console.log(JSON.stringify({ reason: report.reason, plannedTasksPerGroup: tasks.length, report: out }));
  process.exit(0);
}
const modelName = process.env.OtterPatch_MODEL || PROVIDERS[provider]?.defaultModel;
if (!modelName) throw new Error('unknown BYOK provider/model');
const sanitize = (error) => String(error instanceof Error ? error.message : error).replaceAll(key, '[redacted]').slice(0, 1000);
const root = mkdtempSync(join(tmpdir(), 'internal-real-ab-'));
const report = { status: 'RUNNING', provider, model: modelName, tasksPerGroup: tasks.length,
  parameters: { maxTokens: 8192, temperature: 'provider default (same in A/B)', seed: 'not exposed by existing provider interface', timeoutMs: 90000, repetitions: 1 },
  reviewer: 'automated conservative acceptance rules on synthetic fixtures; NOT an actual human review',
  scoring: '0..4: stated facts, no new numbers, protected region, correct response kind. Task completion additionally requires verified text change for edit tasks. This is not a full semantic or stylistic quality score.',
  usage: 'provider-reported non-streaming tokens; cost not exposed by standard provider responses and is null (no invented price)',
  rows: [], groups: {}, humanReview: 'NOT PERFORMED', costUSD: null };
try {
  const imported = officialRegistry(root);
  report.upstream = imported.card.provenance; report.releaseChecksum = imported.card.checksum;
  const enabled = initializeSkillLibrary({ registry: root }).library;
  const run = async (task, group) => {
    const bytes = docx(task); const observed = { catalogHit: false, bodyLoads: 0, referencePaths: new Set(), referenceAttempts: 0,
      referenceSuccesses: 0, proposalAttempts: 0, invalidProposals: 0, outsideScopeAttempts: 0, outOfSchemaAttempts: 0, toolOverreachAttempts: 0,
      usageCalls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
    const underlying = createModelClient(provider, { apiKey: key, model: modelName, maxTokens: 8192, timeoutMs: 90000 });
    const wrapper = {
      identity: underlying.identity,
      proposeChangeSet: underlying.proposeChangeSet.bind(underlying),
      respond: async (req, dialect, opts) => underlying.respond(req, { ...dialect, buildChangeSet: (r, raw) => {
        observed.proposalAttempts++;
        const allowedFields = Object.keys(dialect.parameters.properties?.edits?.items?.properties ?? {});
        if (Array.isArray(raw?.edits) && raw.edits.some((edit) => Object.keys(edit ?? {}).some((key) => !allowedFields.includes(key)))) observed.outOfSchemaAttempts++;
        try {
          const cs = dialect.buildChangeSet(r, raw);
          if (cs.edits.some((edit) => !['replaceText', 'setStyle'].includes(edit.op.kind))) observed.outsideScopeAttempts++;
          return cs;
        } catch (error) { observed.invalidProposals++; throw error; }
      } }, { ...opts, signal: AbortSignal.timeout(120_000), onUsage: (usage) => {
        observed.usageCalls++; observed.inputTokens += usage.inputTokens; observed.outputTokens += usage.outputTokens; observed.cachedInputTokens += usage.cachedInputTokens;
      }, extraTools: { defs: opts.extraTools.defs, exec: (name, args) => {
        const result = opts.extraTools.exec(name, args);
        let parsed; try { parsed = JSON.parse(result); } catch { /* ordinary read tools return null */ }
        if (name === 'find_skills' && parsed?.skills?.some((skill) => skill.id === skillId)) observed.catalogHit = true;
        if (name === 'load_skill' && parsed?.id === skillId && parsed?.kind === 'skill_instructions') observed.bodyLoads++;
        if (name === 'load_skill_reference') {
          observed.referenceAttempts++;
          if (parsed?.id === skillId && parsed?.kind === 'skill_reference') { observed.referenceSuccesses++; observed.referencePaths.add(parsed.path); }
        }
        if (!['find_skills','load_skill','load_skill_reference','read_blocks','find_text','get_outline','get_style_usage'].includes(name)) observed.toolOverreachAttempts++;
        return result;
      } } }),
    };
    const runtime = new OtterPatchRuntime({ skills: group === 'B' ? enabled : defaultLibrary() });
    const row = { id: task.id, scenario: task.scenario, group, status: 'RUNNING', changeSetValid: null, reviewPassed: null, writebackPassed: null, taskCompleted: false, costUSD: null };
    const start = Date.now();
    try {
      const response = await runtime.respond(request(task, bytes), wrapper);
      row.kind = response.kind; row.status = 'COMPLETED';
      row.responseText = response.kind === 'answer' ? response.text : response.kind === 'clarify' ? JSON.stringify(response.questions) : response.changeSet.meta.planSummary;
      let text = task.paragraphs.join('');
      if (response.kind === 'changeset') {
        const cs = response.changeSet; assertChangeSet(cs); row.changeSetValid = true;
        row.actualModel = cs.origin.by === 'agent' ? cs.origin.provenance.model : null;
        row.loadedSkillProvenance = cs.origin.by === 'agent' ? cs.origin.provenance.skillVersions.filter((skill) => skill.id === skillId) : [];
        // Rule-based synthetic reviewer: do not claim this is actual human assessment.
        let candidate = task.paragraphs.join('\n'); const accepted = [];
        if (!task.expected) for (const edit of cs.edits) {
          const anchor = cs.anchors[edit.target]?.portable;
          const quote = anchor?.kind === 'flow' ? anchor.quote?.text : undefined;
          if (!quote || candidate.split(quote).length !== 2 || task.paragraphs.some((p) => p.startsWith('保护区域') && p.includes(quote))) continue;
          if (edit.op.kind !== 'replaceText') continue;
          const proposed = candidate.replace(quote, edit.op.text);
          const checks = quality(task, proposed, response.kind);
          if (checks.factsPreserved && checks.noInventedNumbers && checks.protectedText) { accepted.push(edit.id); candidate = proposed; }
        }
        row.proposedEditCount = cs.edits.length; row.acceptedEditCount = accepted.length;
        if (accepted.length) {
          const proposal = runtime.createProposal(cs, 'word');
          const reviewed = runtime.reviewProposal(proposal, cs, accepted, bytes, 'rule-reviewer-synthetic-not-human');
          row.reviewPassed = true;
          const result = await runtime.commit({ format: 'word', bytes, changeSet: cs, ...reviewed });
          row.writebackPassed = result.ok && result.fidelity.verification.packageValid && !result.fidelity.verification.semantic.failedEdits.length;
          row.verification = result.fidelity.verification;
          if (row.writebackPassed) text = acceptedText(result.bytes);
        } else row.reviewPassed = false;
      }
      row.rules = quality(task, text, response.kind);
      if (task.expected) {
        const content = row.responseText || '';
        row.rules.expectedKind = response.kind !== 'changeset' && (task.expected === 'clarify'
          ? response.kind === 'clarify' || /确认|澄清|冲突|矛盾|未提供|需要|clarif|uncertain|missing/i.test(content)
          : /不能|不支持|无法|拒绝|cannot|unsupported|not support/i.test(content));
        row.rules.ruleScore = Number(row.rules.factsPreserved) + Number(row.rules.noInventedNumbers) + Number(row.rules.protectedText) + Number(row.rules.expectedKind);
        row.taskCompleted = row.rules.expectedKind;
      } else row.taskCompleted = Boolean(row.writebackPassed && row.rules.ruleScore === 4 && text !== task.paragraphs.join(''));
      row.outputText = text;
    } catch (error) { row.status = 'FAILED'; if (observed.proposalAttempts) row.changeSetValid = false; row.error = sanitize(error); }
    row.observed = { ...observed, referencePaths: [...observed.referencePaths], inputTokens: observed.usageCalls ? observed.inputTokens : null,
      outputTokens: observed.usageCalls ? observed.outputTokens : null, cachedInputTokens: observed.usageCalls ? observed.cachedInputTokens : null };
    row.elapsedMs = Date.now() - start; report.rows.push(row); save(report);
    console.log(JSON.stringify({ id: task.id, group, status: row.status, completed: row.taskCompleted }));
  };
  for (let i = 0; i < tasks.length; i++) for (const group of i % 2 ? ['B', 'A'] : ['A', 'B']) await run(tasks[i], group);
  for (const group of ['A', 'B']) {
    const rows = report.rows.filter((row) => row.group === group);
    const rate = (field) => { const eligible = rows.filter((row) => row[field] !== null && row[field] !== undefined); return { passed: eligible.filter((row) => row[field]).length, total: eligible.length }; };
    report.groups[group] = { executed: rows.length, ruleTaskCompletion: rate('taskCompleted'), changeSetValidity: rate('changeSetValid'),
      ruleReview: rate('reviewPassed'), writeback: rate('writebackPassed'), catalogHit: rows.filter((row) => row.observed.catalogHit).length,
      bodyLoad: rows.filter((row) => row.observed.bodyLoads).length,
      referenceLoad: { successes: rows.reduce((n, row) => n + row.observed.referenceSuccesses, 0), attempts: rows.reduce((n, row) => n + row.observed.referenceAttempts, 0) },
      factFidelity: { passed: rows.filter((row) => row.rules?.factsPreserved && row.rules?.noInventedNumbers).length, evaluated: rows.filter((row) => row.rules).length },
      overreach: rows.reduce((n, row) => n + row.observed.outsideScopeAttempts + row.observed.toolOverreachAttempts + row.observed.outOfSchemaAttempts + row.observed.referenceAttempts - row.observed.referenceSuccesses, 0),
      invalidProposalAttempts: rows.reduce((n, row) => n + row.observed.invalidProposals, 0),
      averageSafetyRuleScore: rows.filter((row) => row.rules).length ? rows.reduce((n, row) => n + (row.rules?.ruleScore ?? 0), 0) / rows.filter((row) => row.rules).length : null,
      tokens: rows.some((row) => row.observed.usageCalls) ? { input: rows.reduce((n, row) => n + (row.observed.inputTokens ?? 0), 0), output: rows.reduce((n, row) => n + (row.observed.outputTokens ?? 0), 0), cachedInput: rows.reduce((n, row) => n + (row.observed.cachedInputTokens ?? 0), 0) } : null,
      costUSD: null };
  }
  report.status = report.rows.some((row) => row.status === 'FAILED') ? 'COMPLETED_WITH_FAILURES' : 'COMPLETED';
  report.conclusion = 'Assess actual per-task outputs and metrics; no automatic claim that B is better. Safety rubric does not measure full writing quality.';
  save(report); console.log(JSON.stringify({ status: report.status, groups: report.groups, report: out }, null, 2));
  if (report.status !== 'COMPLETED') process.exitCode = 1;
} catch (error) { report.status = 'FAILED'; report.error = sanitize(error); save(report); process.stderr.write(`${report.error}\n`); process.exitCode = 1; }
finally { rmSync(root, { recursive: true, force: true }); }
