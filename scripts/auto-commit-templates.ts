#!/usr/bin/env bun
// Auto-commit template changes hourly (BCP for Rumi's memory files)
// Runs via launchd — commits only if there are actual changes

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Effect } from 'effect';

import { DeployLoggerLive, fail, info, ok } from '../src/DeployLogger.js';
import { TemplateCommitError } from '../src/errors.js';

const TEMPLATE_PATHS = [
  'groups/main/SOUL.md',
  'groups/main/IDENTITY.md',
  'groups/main/USER.md',
  'groups/main/TOOLS.md',
  'groups/main/HEARTBEAT.md',
  'groups/main/BOOT.md',
  'groups/main/CLAUDE.md',
  'groups/main/VOICE_PROMPT.md',
  'groups/main/THREAT_MODEL.json',
  'groups/global/CLAUDE.md',
] as const;

const git = (args: string): string =>
  execSync(`git ${args}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

const checkForChanges = (paths: readonly string[]): Effect.Effect<string[], TemplateCommitError> =>
  Effect.try({
    try: () =>
      paths.filter((f) => {
        if (!existsSync(f)) return false;
        try {
          git(`diff --quiet -- ${f}`);
          try {
            git(`ls-files --error-unmatch ${f}`);
            return false; // tracked and unchanged
          } catch {
            return true; // untracked
          }
        } catch {
          return true; // diff --quiet failed → file has changes
        }
      }),
    catch: (e) =>
      new TemplateCommitError({
        stage: 'check',
        message: `Failed to check for changes: ${e}`,
        cause: e,
      }),
  });

const stageFiles = (paths: string[]): Effect.Effect<void, TemplateCommitError> =>
  Effect.try({
    try: () => {
      for (const f of paths) {
        git(`add ${f}`);
      }
    },
    catch: (e) =>
      new TemplateCommitError({
        stage: 'stage',
        message: `Failed to stage files: ${e}`,
        cause: e,
      }),
  });

const commitSnapshot = (): Effect.Effect<void, TemplateCommitError> =>
  Effect.try({
    try: () => {
      const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
      git(`commit -m "auto: template snapshot ${timestamp}" --no-verify`);
    },
    catch: (e) =>
      new TemplateCommitError({
        stage: 'commit',
        message: `Failed to commit: ${e}`,
        cause: e,
      }),
  });

const main = Effect.gen(function* () {
  const changed = yield* checkForChanges(TEMPLATE_PATHS);

  if (changed.length === 0) {
    yield* info('No template changes to commit');
    return;
  }

  yield* info(`Found ${changed.length} changed template(s): ${changed.join(', ')}`);

  yield* stageFiles(changed);
  yield* commitSnapshot();

  yield* ok('Template snapshot committed');
}).pipe(
  Effect.catchAll((e) =>
    fail(`${e._tag}: [${e.stage}] ${e.message}`),
  ),
  Effect.provide(DeployLoggerLive('template-backup')),
  Effect.scoped,
);

Effect.runPromise(main);
