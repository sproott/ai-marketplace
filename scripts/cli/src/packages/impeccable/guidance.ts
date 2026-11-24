import { Effect, PlatformError, Schema, String } from 'effect';

export const upstreamSkill = 'dist/claude-code/.claude/skills/impeccable';

export const ImpeccableBuildReason = Schema.TaggedUnion({
  UnreadableUpstreamInput: {
    file: Schema.String,
    cause: Schema.instanceOf(PlatformError.PlatformError),
  },
  InvalidPackageMetadata: {
    file: Schema.String,
    cause: Schema.instanceOf(Schema.SchemaError),
  },
  InvalidCopilotHookManifest: {
    file: Schema.String,
    cause: Schema.instanceOf(Schema.SchemaError),
  },
  InvalidClaudeHookManifest: {
    file: Schema.String,
    cause: Schema.instanceOf(Schema.SchemaError),
  },
  MissingLauncherVerb: {
    file: Schema.String,
    event: Schema.String,
    command: Schema.String,
  },
  UnexpectedAnchorCount: {
    file: Schema.String,
    anchor: Schema.String,
    count: Schema.Int,
  },
});

export class ImpeccableBuildError extends Schema.TaggedError<ImpeccableBuildError, { readonly brand: unique symbol }>()('ImpeccableBuildError', {
  reason: ImpeccableBuildReason,
}) {
  format(): string {
    const { reason } = this;
    const source = `impeccable: ${reason.file}`;

    return ImpeccableBuildReason.match(reason, {
      UnreadableUpstreamInput: ({ cause }) =>
        `${source}: could not read upstream input; ${cause.message}`,
      InvalidPackageMetadata: ({ cause }) =>
        `${source}: expected package metadata with a string version, optional JSON author, and optional string license; ${cause.message}`,
      InvalidCopilotHookManifest: ({ cause }) =>
        `${source}: expected Copilot hook lists with nonempty Bash command handlers; ${cause.message}`,
      InvalidClaudeHookManifest: ({ cause }) =>
        `${source}: expected SessionStart groups with nonempty command handlers for Copilot; ${cause.message}`,
      MissingLauncherVerb: ({ event, command }) =>
        `${source}: expected ${event} hook command to end with a launcher verb; found ${command}`,
      UnexpectedAnchorCount: ({ anchor, count }) =>
        `${source}: expected exactly one ${anchor} anchor (found ${count})`,
    });
  }
}

function requireOneAnchor(body: string, anchor: string | RegExp, file: string, assumption: string): Effect.Effect<void, ImpeccableBuildError> {
  const count = typeof anchor === 'string'
    ? String.split(anchor)(body).length - 1
    : [...String.matchAll(new RegExp(anchor.source, anchor.global ? anchor.flags : anchor.flags + 'g'))(body)].length;

  return count === 1
    ? Effect.void
    : Effect.fail(ImpeccableBuildError.make({
      reason: ImpeccableBuildReason.cases.UnexpectedAnchorCount.make({ file: `${upstreamSkill}/${file}`, anchor: assumption, count }),
    }));
}

export const replaceAnchored = (body: string, anchor: string | RegExp, replacement: string, file: string, assumption: string) =>
  requireOneAnchor(body, anchor, file, assumption).pipe(
    Effect.map(() => String.replace(anchor, replacement)(body)),
  );

export const adaptGuidance = Effect.fnUntraced(function* (file: string, upstream: string) {
  let body = upstream;
  const replace = (anchor: RegExp, replacement: string, assumption: string) =>
    replaceAnchored(body, anchor, replacement, file, assumption);

  if (file === 'SKILL.md') {
    body = yield* replace(/^\*\*Pin \/ Unpin:\*\*[^\n]*\n\n/m, '', 'pin route');
    body = yield* replace(/\*\*Hooks:\*\*[^\n]*/, '**Hooks:** For detector settings and ignores, read [reference/hooks.md](reference/hooks.md). APM installs the hook manifests.', 'hooks route');
  }

  if (file === 'reference/doctor.md') {
    body = yield* replace(/- \*\*Tool version\.\*\*[^\n]*/, '- **Tool version.** For `UPDATE_AVAILABLE`, run `apm update` to refresh package dependencies, then `apm install` to deploy them.', 'doctor update');
    body = yield* replace(/- \*\*`auto`\*\*[^\n]*/, '- **`auto`** carries no decision for project-document migrations. If the report contains no hook-manifest findings, run `<skill-base-dir>/scripts/impeccable doctor --fix` once, then report the changes. If hook findings are present, restore APM wiring with `apm install` and apply only the reported project-document migrations directly.', 'doctor auto repair');
  }

  if (file === 'reference/hooks.md') {
    yield* requireOneAnchor(body, 'Supported harnesses:', file, 'supported harnesses');
    yield* requireOneAnchor(body, '## Triage findings', file, 'triage findings');

    body = yield* replace(/Supported harnesses:[\s\S]*?(?=## Triage findings)/, 'APM installs the hook manifests. Run `apm install` to restore wiring; reload the harness afterward. Configure detector behavior with the settings above. For ignores, run `<skill-base-dir>/scripts/impeccable hooks ignore-rule|ignore-file|ignore-value` with the arguments below.\n\n', 'native hook administration');
    body = yield* replace(/Per-developer overrides, including the install consent decision \(`hook\.consent`\) the CLI records, live/, 'Per-developer overrides live', 'native consent guidance');
    body = yield* replace(/ \(in the Copilot cloud agent too, once `\.github\/hooks\/impeccable\.json` is committed\)/, '', 'native cloud manifest path');
    body = yield* replace(/- The hook is bundled[^\n]*\n/, '', 'native hook locations');
    body = yield* replace(/ \(A Cursor project still[^\n]*?\)/, '', 'legacy hook migration');
  }

  if (file === 'reference/live.md' || file === 'reference/generate.md') {
    const anchor = file === 'reference/live.md' ? /## Prerequisites\n\n/ : /## Step 1: Parse the request\n\n/;
    body = yield* replace(anchor, '$&Set `IMPECCABLE_LIVE_COPY_AGENT=chat` for every live launcher command. Auto mode can start a local coding agent with approval and sandbox bypass; enable that fallback only with explicit user approval.\n\n', 'live policy');
  }

  return body;
});
