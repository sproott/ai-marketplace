import { Array, Effect, FileSystem, Option, Path, Record, Schema, String, type PlatformError } from 'effect';
import { adaptGuidance, ImpeccableBuildError, ImpeccableBuildReason, replaceAnchored, upstreamSkill } from './guidance.ts';
import { run } from '../../shared/process.ts';
import { bundleHook } from '../../shared/build-hook-bundle.ts';
import { copyFile } from '../../shared/files.ts';
import { reportFailures } from '../../shared/command-failure.ts';
import { defineBuilder, packageDir, vendorDir } from '../../package-model/define.ts';
import { ReleaseSource } from '../../package-model/release-source.ts';

const packageFile = 'package.json';
const claudeSettings = 'dist/claude-code/.claude/settings.json';
const copilotSettings = 'dist/github/.github/hooks/impeccable.json';

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Json, { space: 2 }));

const metadata = Schema.fromJsonString(Schema.Struct({
  version: Schema.String,
  author: Schema.optionalKey(Schema.Json),
  license: Schema.optionalKey(Schema.String),
}));

const claudeHandler = Schema.Struct({
  type: Schema.Literal('command'),
  command: Schema.NonEmptyString,
  timeout: Schema.optionalKey(Schema.Finite),
  statusMessage: Schema.optionalKey(Schema.String),
});
const claudeGroup = Schema.Struct({
  matcher: Schema.optionalKey(Schema.String),
  hooks: Schema.Array(claudeHandler),
});
const claudeHookConfig = Schema.fromJsonString(Schema.Struct({
  hooks: Schema.StructWithRest(Schema.Struct({
    SessionStart: Schema.NonEmptyArray(Schema.Struct({
      ...claudeGroup.fields,
      hooks: Schema.NonEmptyArray(claudeHandler),
    })),
  }), [Schema.Record(Schema.String, Schema.Array(claudeGroup))]),
}));

const copilotHookConfig = Schema.fromJsonString(Schema.Struct({
  hooks: Schema.Record(Schema.String, Schema.Array(Schema.Struct({
    type: Schema.Literal('command'),
    bash: Schema.NonEmptyString,
    matcher: Schema.optionalKey(Schema.String),
    timeoutSec: Schema.optionalKey(Schema.Finite),
    statusMessage: Schema.optionalKey(Schema.String),
  }))),
}));

type HookGroups = Readonly<Record<string, readonly typeof claudeGroup.Type[]>>;

function normalizeCopilotHooks(config: typeof copilotHookConfig.Type.hooks): HookGroups {
  return Record.fromEntries(Array.map(Record.toEntries(config), ([key, handlers]) => [
    String.capitalize(key),
    Array.map(handlers, ({ type, bash, matcher, timeoutSec, statusMessage }) => ({
      ...(matcher === undefined ? {} : { matcher }),
      hooks: [{
        type,
        command: bash,
        ...(timeoutSec === undefined ? {} : { timeout: timeoutSec }),
        ...(statusMessage === undefined ? {} : { statusMessage }),
      }],
    })),
  ] as const));
}

function normalizeMarkdown(fs: FileSystem.FileSystem, path: Path.Path, dir: string): Effect.Effect<void, PlatformError.PlatformError> {
  return Effect.gen(function* () {
    for (const entry of yield* fs.readDirectoryEntries(dir)) {
      const file = path.join(dir, entry.name);
      if (entry.type === 'Directory') {
        yield* normalizeMarkdown(fs, path, file);
      } else if (String.endsWith('.md')(entry.name)) {
        const body = yield* fs.readFileString(file);
        yield* fs.writeFileString(file, String.replaceAll('.github/skills/impeccable/', '<skill-base-dir>/')(
          String.replaceAll('.claude/skills/impeccable/', '<skill-base-dir>/')(body),
        ));
      }
    }
  });
}

function rewriteHooks(target: 'claude' | 'copilot', config: HookGroups) {
  return Effect.forEach(Record.toEntries(config), ([event, groups]) => Effect.gen(function* () {
    const rewritten = yield* Effect.forEach(groups, group => Effect.gen(function* () {
      const hooks = yield* Effect.forEach(group.hooks, handler => Effect.gen(function* () {
        const command = Option.getOrUndefined(String.match(/" ([a-z][a-z-]*)$/)(handler.command))?.[1];

        if (command === undefined) {
          const file = target === 'claude' || event === 'SessionStart' ? claudeSettings : copilotSettings;

          return yield* ImpeccableBuildError.make({
            reason: ImpeccableBuildReason.cases.MissingLauncherVerb.make({ file, event, command: handler.command }),
          });
        }

        return {
          type: handler.type,
          command: `sh ./skills/impeccable/scripts/impeccable ${command} ${target} ${event}`,
          ...(handler.timeout === undefined ? {} : { timeout: handler.timeout }),
          ...((handler.statusMessage ?? '') !== '' ? { statusMessage: handler.statusMessage } : {}),
        };
      }), { concurrency: 1 });

      return {
        ...((group.matcher ?? '') !== '' ? { matcher: group.matcher } : {}),
        hooks,
      };
    }), { concurrency: 1 });

    return [event, rewritten] as const;
  }), { concurrency: 1 }).pipe(Effect.map(Record.fromEntries));
}

export const buildImpeccable = Effect.fn('buildImpeccable')(function* (repo: string, out?: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const vendor = path.join(repo, vendorDir('impeccable'));
  const umbrella = out === undefined ? path.resolve(repo, packageDir('impeccable')) : path.join(path.resolve(repo, out), 'impeccable');
  const description = 'Design skills, native agents, and design-check hooks for Claude Code and GitHub Copilot.';

  const readInput = (root: string, file: string) => fs.readFileString(path.join(root, file)).pipe(
    Effect.mapError(cause => ImpeccableBuildError.make({
      reason: ImpeccableBuildReason.cases.UnreadableUpstreamInput.make({ file, cause }),
    })),
  );

  const packageBody = yield* readInput(vendor, packageFile);
  const pkg = yield* Schema.decodeEffect(metadata)(packageBody).pipe(
    Effect.mapError(cause => ImpeccableBuildError.make({
      reason: ImpeccableBuildReason.cases.InvalidPackageMetadata.make({ file: packageFile, cause }),
    })),
  );

  yield* readInput(vendor, 'bun.lock');
  const scratch = yield* fs.makeTempDirectoryScoped();
  const claude = path.join(scratch, 'dist/claude-code/.claude');
  const copilot = path.join(scratch, 'dist/github/.github');

  for (const name of yield* fs.readDirectory(vendor)) {
    if (['.git', 'node_modules', 'dist', 'build'].includes(name)) continue;

    yield* fs.copy(path.join(vendor, name), path.join(scratch, name));
  }

  yield* run('bun', ['install', '--frozen-lockfile', '--ignore-scripts', '--no-optional'], scratch);
  yield* run('bun', ['scripts/build.js', '--skip-root-sync'], scratch);

  const claudeSettingsBody = yield* readInput(scratch, claudeSettings);
  const { hooks: claudeHooks } = yield* Schema.decodeEffect(claudeHookConfig)(claudeSettingsBody).pipe(
    Effect.mapError(cause => ImpeccableBuildError.make({
      reason: ImpeccableBuildReason.cases.InvalidClaudeHookManifest.make({ file: claudeSettings, cause }),
    })),
  );

  const copilotSettingsBody = yield* readInput(scratch, copilotSettings);
  const { hooks: copilotHooks } = yield* Schema.decodeEffect(copilotHookConfig)(copilotSettingsBody).pipe(
    Effect.mapError(cause => ImpeccableBuildError.make({
      reason: ImpeccableBuildReason.cases.InvalidCopilotHookManifest.make({ file: copilotSettings, cause }),
    })),
  );

  const hooks = {
    claude: yield* rewriteHooks('claude', claudeHooks),
    copilot: yield* rewriteHooks('copilot', {
      ...normalizeCopilotHooks(copilotHooks),
      SessionStart: Array.map(claudeHooks.SessionStart, ({ hooks }) => ({ hooks })),
    }),
  };

  for (const target of ['', 'claude', 'copilot'] as const) {
    const packageDir = path.join(umbrella, target);
    const apm = path.join(packageDir, '.apm');
    const dependencies = target !== '' ? [] : [
      { path: './claude', alias: 'impeccable-claude' },
      { path: './copilot', alias: 'impeccable-copilot' },
    ];

    yield* fs.remove(apm, { recursive: true, force: true });
    yield* fs.makeDirectory(packageDir, { recursive: true });

    const manifest = yield* encodeJson({
      name: target !== '' ? `impeccable-${target}` : 'impeccable',
      version: pkg.version,
      description,
      ...(pkg.author === undefined ? {} : { author: pkg.author }),
      ...(pkg.license === undefined ? {} : { license: pkg.license }),
      type: 'hybrid',
      targets: target !== '' ? [target] : ['claude', 'copilot'],
      dependencies: { apm: dependencies, mcp: [] },
    }).pipe(Effect.orDie);

    yield* fs.writeFileString(path.join(packageDir, 'apm.yml'), manifest + '\n');

    for (const file of ['LICENSE', 'NOTICE.md']) {
      yield* copyFile(path.join(vendor, file), path.join(packageDir, file));
    }

    if (target === '') {
      const skillDir = path.join(apm, 'skills/impeccable');

      yield* fs.makeDirectory(path.dirname(skillDir), { recursive: true });
      yield* fs.copy(path.join(scratch, upstreamSkill), skillDir);
      yield* normalizeMarkdown(fs, path, skillDir);

      // APM owns updates; suppress the engine's native-installer recommendations.
      for (const [file, marker, setting, assumption] of [
        ['scripts/impeccable', '#!/bin/sh\n', 'export IMPECCABLE_NO_UPDATE_CHECK=1\n', 'POSIX shebang'],
        ['scripts/impeccable.cmd', 'setlocal\r\n', 'set "IMPECCABLE_NO_UPDATE_CHECK=1"\r\n', 'Windows setlocal'],
      ] as const) {
        const targetFile = path.join(skillDir, file);
        const launcher = yield* fs.readFileString(targetFile);
        const patched = yield* replaceAnchored(launcher, marker, marker + setting, file, assumption);

        yield* fs.writeFileString(targetFile, patched);
      }

      for (const file of ['SKILL.md', 'reference/doctor.md', 'reference/hooks.md', 'reference/live.md', 'reference/generate.md']) {
        const targetFile = path.join(skillDir, file);
        const body = yield* fs.readFileString(targetFile);
        const adapted = yield* adaptGuidance(file, body);

        yield* fs.writeFileString(targetFile, adapted);
      }
      continue;
    }

    const native = target === 'claude' ? claude : copilot;
    const agents = path.join(native, 'agents');

    for (const file of yield* fs.readDirectory(agents)) {
      const name = String.replace(/(?:\.agent)?\.md$/, '.agent.md')(file);
      yield* copyFile(path.join(agents, file), path.join(apm, 'agents', name));
    }

    yield* normalizeMarkdown(fs, path, path.join(apm, 'agents'));
    yield* bundleHook(path.join(repo, 'packages/impeccable/src/hooks/hook.ts'), path.join(apm, 'hooks/hook.cjs'));
    yield* copyFile(path.join(repo, 'packages/impeccable/src/hooks/launcher.sh'), path.join(apm, 'hooks/skills/impeccable/scripts/impeccable'));

    const descriptor = yield* encodeJson(hooks[target]).pipe(Effect.orDie);

    yield* fs.writeFileString(path.join(apm, 'hooks/impeccable.json'), descriptor + '\n');
  }
}, Effect.scoped);

export const impeccable = defineBuilder(
  'impeccable',
  out => buildImpeccable(process.cwd(), out),
  reportFailures('ImpeccableBuildError', 'SubprocessExited', 'CommandOperationFailed', 'CommandFailure'),
  { release: ReleaseSource.cases.SubmoduleManifest.make({ tagPrefix: 'skill-v' }), parent: true },
);
