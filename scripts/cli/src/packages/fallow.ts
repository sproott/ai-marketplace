import { Array, Console, Effect, FileSystem, Option, Path, Record, Result, Schema, String as Str, pipe } from 'effect';
import { isSeq, parseDocument, Scalar, stringify, YAMLParseError, YAMLSeq } from 'yaml';
import { run } from '../shared/process.ts';
import { copyFile } from '../shared/files.ts';
import { reportFailures } from '../shared/command-failure.ts';
import { defineBuilder, packageDir } from '../package-model/define.ts';
import { ReleaseSource } from '../package-model/release-source.ts';

const FallowBuildReason = Schema.TaggedUnion({
  MissingFallowSection: { file: Schema.String },
  MissingTaskMapHeading: { file: Schema.String },
  UnexpectedTaskMapDirectionCount: {
    file: Schema.String,
    count: Schema.Int,
  },
  MissingSetupHooksBlock: { file: Schema.String },
  UnexpectedMcpServerCount: {
    file: Schema.String,
    count: Schema.Int,
  },
  InvalidManifestYaml: {
    file: Schema.String,
    parseError: Schema.instanceOf(YAMLParseError),
  },
  ManifestYamlParseFailed: {
    file: Schema.String,
    failure: Schema.Unknown,
  },
  InvalidManifestMcpSequence: {
    file: Schema.String,
    found: Schema.Literals(['missing', 'non-sequence']),
  },
  MissingManifestMcpRange: { file: Schema.String },
  ManifestMcpSerializationFailed: {
    file: Schema.String,
    failure: Schema.Unknown,
  },
  UnreadableManifestYaml: {
    file: Schema.String,
    failure: Schema.Unknown,
  },
  InvalidManifestVersion: {
    file: Schema.String,
    schemaError: Schema.instanceOf(Schema.SchemaError),
  },
  HookDescriptorEncodingFailed: {
    file: Schema.String,
    schemaError: Schema.instanceOf(Schema.SchemaError),
  },
  TaskMapDescriptionEncodingFailed: {
    file: Schema.String,
    schemaError: Schema.instanceOf(Schema.SchemaError),
  },
  InvalidMcpServerDefinitions: {
    file: Schema.String,
    schemaError: Schema.instanceOf(Schema.SchemaError),
  },
  MissingCliReferenceSections: { file: Schema.String },
});

class FallowBuildError extends Schema.TaggedError<FallowBuildError, { readonly brand: unique symbol }>()('FallowBuildError', { reason: FallowBuildReason }) {
  format(): string {
    const { reason } = this;
    const detail = FallowBuildReason.match(reason, {
      MissingFallowSection: () => `expected a "## Fallow" section; found none`,
      MissingTaskMapHeading: () => `expected a "## Fallow task map" heading; found none`,
      UnexpectedTaskMapDirectionCount: ({ count }) => `expected exactly one task map direction; found ${count}`,
      MissingSetupHooksBlock: () => `expected a complete fallow:setup-hooks marked block; found none`,
      UnexpectedMcpServerCount: ({ count }) => `expected exactly one MCP server; found ${count}`,
      InvalidManifestYaml: ({ parseError }) => `expected valid YAML; ${parseError.message}`,
      ManifestYamlParseFailed: ({ failure }) => `expected valid YAML; ${String(failure)}`,
      InvalidManifestMcpSequence: ({ found }) => `expected a dependencies.mcp sequence; found ${found === 'missing' ? 'no value' : 'a non-sequence'}`,
      MissingManifestMcpRange: () => `expected a source range for the dependencies.mcp sequence; found none`,
      ManifestMcpSerializationFailed: ({ failure }) => `expected a serializable dependencies.mcp sequence; ${String(failure)}`,
      UnreadableManifestYaml: ({ failure }) => `expected YAML values that can be read; ${String(failure)}`,
      InvalidManifestVersion: ({ schemaError }) => `expected a nonempty version string; ${schemaError.message}`,
      HookDescriptorEncodingFailed: ({ schemaError }) => `expected a JSON hook descriptor; ${schemaError.message}`,
      TaskMapDescriptionEncodingFailed: ({ schemaError }) => `expected a JSON-quoted description; ${schemaError.message}`,
      InvalidMcpServerDefinitions: ({ schemaError }) => `expected MCP server definitions with string type and command and optional string args; ${schemaError.message}`,
      MissingCliReferenceSections: () => `expected at least one "## " section besides the table of contents; found none`,
    });

    return `fallow: ${reason.file}: ${detail}`;
  }
}

const INSTRUCTION_DESCRIPTION =
  'Standing rule for fallow: the task-command map (which fallow command to run before a given edit/commit/PR action) and the local pre-commit/pre-push audit gate.';

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Json, { space: 2 }));
const encodeString = Schema.encodeEffect(Schema.fromJsonString(Schema.String));

function extractSection(agentsMd: string): Result.Result<string, FallowBuildError> {
  const start = Str.indexOf('\n## Fallow\n')(agentsMd);

  if (Option.isNone(start)) {
    return Result.fail(FallowBuildError.make({ reason: FallowBuildReason.cases.MissingFallowSection.make({ file: 'AGENTS.md' }) }));
  }

  const searchStart = start.value + 1;
  const nextHeading = pipe(agentsMd, Str.slice(searchStart), Str.indexOf('\n## '));
  const end = Option.isSome(nextHeading) ? searchStart + nextHeading.value : agentsMd.length;

  return Result.succeed(pipe(agentsMd, Str.slice(start.value, end), Str.trim));
}

// The generated Fallow section owns the task table; the setup-hooks block owns the gate prose.
export function stripDuplicateTaskMap(setupHooksBlock: string): Result.Result<string, FallowBuildError> {
  const heading = Str.indexOf('\n## Fallow task map\n')(setupHooksBlock);

  if (Option.isNone(heading)) {
    return Result.fail(FallowBuildError.make({ reason: FallowBuildReason.cases.MissingTaskMapHeading.make({ file: 'AGENTS.md' }) }));
  }

  const endMarker = '<!-- fallow:setup-hooks:end -->';
  const kept = pipe(setupHooksBlock, Str.slice(0, heading.value), Str.trimEnd);
  const count = Str.split(kept, 'the task map below').length - 1;

  if (count !== 1) {
    return Result.fail(FallowBuildError.make({ reason: FallowBuildReason.cases.UnexpectedTaskMapDirectionCount.make({ file: 'AGENTS.md', count }) }));
  }

  return Result.succeed(`${Str.replace('the task map below', 'the task map above')(kept)}\n\n${endMarker}`);
}

function extractSetupHooksBlock(agentsMd: string): Result.Result<string, FallowBuildError> {
  const match = /<!-- fallow:setup-hooks:start -->[\s\S]*?<!-- fallow:setup-hooks:end -->/.exec(agentsMd);

  if (match === null) {
    return Result.fail(FallowBuildError.make({ reason: FallowBuildReason.cases.MissingSetupHooksBlock.make({ file: 'AGENTS.md' }) }));
  }

  return stripDuplicateTaskMap(Str.trim(match[0]));
}

export interface CliSection {
  heading: string;
  anchor: string;
  file: string;
  body: string;
}

/** GitHub's heading-anchor slug: lowercase, punctuation dropped, spaces to hyphens. */
export function githubAnchor(heading: string): string {
  return pipe(heading, Str.toLowerCase, Str.replace(/[^\w\s-]/g, ''), Str.trim, Str.replace(/\s+/g, '-'));
}

/** `` `dead-code`: Dead Code Analysis `` -> `dead-code`; prose headings fall back to the anchor. */
function partFileName(heading: string, anchor: string): string {
  const command = /^`([a-z0-9-]+)`\s*:/i.exec(heading);
  return `${command !== null ? command[1] : anchor}.md`;
}

export function splitTopLevelSections(markdown: string): { preamble: string; sections: CliSection[] } {
  const lines = Str.split(markdown, '\n');
  const sections: CliSection[] = [];
  const preamble: string[] = [];
  let current: { heading: string; body: string[] } | null = null;
  let fenced = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const heading = fenced ? undefined : /^## (.+)$/.exec(line)?.[1];

    if (heading !== undefined) {
      if (current !== null) sections.push(finishSection(current));
      current = { heading: Str.trim(heading), body: [] };
      continue;
    }

    (current !== null ? current.body : preamble).push(line);
  }

  if (current !== null) sections.push(finishSection(current));

  return { preamble: pipe(preamble, Array.join('\n'), Str.trim), sections };
}

function finishSection(raw: { heading: string; body: string[] }): CliSection {
  const anchor = githubAnchor(raw.heading);
  return {
    heading: raw.heading,
    anchor,
    file: partFileName(raw.heading, anchor),
    body: pipe(raw.body, Array.join('\n'), Str.trim),
  };
}

/**
 * Rewrites `cli-reference.md#anchor` and bare `#anchor` links onto the split parts.
 * `prefix` is the path of the `cli/` directory relative to the file being rewritten;
 * `bareAnchors` additionally remaps same-document `](#anchor)` links, which only the
 * part files themselves carry.
 */
export function remapCliLinks(
  text: string,
  sections: CliSection[],
  prefix: string,
  bareAnchors = false,
): string {
  const byAnchor = new Map(Array.map(sections, (s) => [s.anchor, s.file]));
  // oxlint-disable-next-line effecttsgo/prefer-effect-string -- Effect String.replace does not accept a match callback.
  let out = text.replace(/([\w./-]*cli-reference\.md)#([a-z0-9-]+)/g, (whole, _path, anchor) => {
    const file = byAnchor.get(anchor);

    return file !== undefined && file !== '' ? `${prefix}${file}` : whole;
  });

  if (bareAnchors) {
    // oxlint-disable-next-line effecttsgo/prefer-effect-string -- Effect String.replace does not accept a match callback.
    out = out.replace(/\]\(#([a-z0-9-]+)\)/g, (whole, anchor) => {
      const file = byAnchor.get(anchor);

      return file !== undefined && file !== '' ? `](${prefix}${file})` : whole;
    });
  }

  return out;
}

export function buildIndex(preamble: string, sections: CliSection[]): string {
  const commands = Array.filter(sections, (s) => Str.startsWith('`')(s.heading));
  const topics = Array.filter(sections, (s) => !Str.startsWith('`')(s.heading));
  const row = (s: CliSection) => `- [${s.heading}](cli/${s.file})`;
  const parts = [preamble, '## Commands', pipe(commands, Array.map(row), Array.join('\n'))];

  if (topics.length > 0) parts.push('## Reference', pipe(topics, Array.map(row), Array.join('\n')));

  return `${Array.join(parts, '\n\n')}\n`;
}

const McpJson = Schema.Struct({
  mcpServers: Schema.Record(Schema.String, Schema.Struct({
    type: Schema.String,
    command: Schema.String,
    args: Schema.String.pipe(Schema.Array, Schema.optional),
  })),
});

interface McpEntry {
  name: string;
  registry: boolean;
  transport: string;
  command: string;
  args?: readonly string[];
}

export function deriveMcpEntry(mcpJson: typeof McpJson.Type): Result.Result<McpEntry, FallowBuildError> {
  const entries = Record.toEntries(mcpJson.mcpServers);
  const [first] = entries;

  if (entries.length !== 1 || first === undefined) {
    return Result.fail(FallowBuildError.make({ reason: FallowBuildReason.cases.UnexpectedMcpServerCount.make({ file: '.mcp.json', count: entries.length }) }));
  }

  const [name, server] = first;

  return Result.succeed({
    name,
    registry: false,
    transport: server.type,
    command: server.command,
    ...(server.args !== undefined && server.args.length > 0 ? { args: server.args } : {}),
  });
}

const parseManifest = Effect.fnUntraced(function* (manifest: string, manifestPath: string) {
  const document = yield* Effect.try({
    try: () => parseDocument(manifest),
    catch: (cause) => FallowBuildError.make({ reason: FallowBuildReason.cases.ManifestYamlParseFailed.make({ file: manifestPath, failure: cause }) }),
  });
  const [error] = document.errors;

  if (error !== undefined) return yield* FallowBuildError.make({ reason: FallowBuildReason.cases.InvalidManifestYaml.make({ file: manifestPath, parseError: error }) });

  return document;
});

export const rewriteManifest = Effect.fnUntraced(function* (manifest: string, manifestPath: string, entry: McpEntry) {
  const document = yield* parseManifest(manifest, manifestPath);
  const mcp = document.getIn(['dependencies', 'mcp'], true);

  if (!isSeq(mcp)) {
    return yield* FallowBuildError.make({ reason: FallowBuildReason.cases.InvalidManifestMcpSequence.make({ file: manifestPath, found: mcp === undefined ? 'missing' : 'non-sequence' }) });
  }

  if (mcp.range == null) {
    return yield* FallowBuildError.make({ reason: FallowBuildReason.cases.MissingManifestMcpRange.make({ file: manifestPath }) });
  }

  const { args, ...fields } = entry;
  const flowArgs = new YAMLSeq();
  flowArgs.flow = true;
  flowArgs.items = Array.map(args ?? [], (arg) => {
    const scalar = new Scalar(arg);
    scalar.type = 'QUOTE_DOUBLE';

    return scalar;
  });

  const rendered = yield* Effect.try({
    try: () => Str.trimEnd(stringify([args !== undefined ? { ...fields, args: flowArgs } : fields], {
      collectionStyle: mcp.flow === true ? 'flow' : 'any',
      flowCollectionPadding: false,
      doubleQuotedAsJSON: true,
      lineWidth: 0,
    })),
    catch: (cause) => FallowBuildError.make({ reason: FallowBuildReason.cases.ManifestMcpSerializationFailed.make({ file: manifestPath, failure: cause }) }),
  });

  const [start, end] = mcp.range;
  const original = Str.slice(start, end)(manifest);
  const newline = Str.includes('\r\n')(original) ? '\r\n' : '\n';
  const lastLineBreak = pipe(manifest, Str.slice(0, start), Str.lastIndexOf('\n'), Option.getOrElse(() => -1));
  const indent = mcp.flow === true ? '' : Str.repeat(start - lastLineBreak - 1)(' ');
  const replacement = Str.replaceAll('\n', newline + indent)(rendered) + (Str.endsWith('\n')(original) ? newline : '');
  const rewritten = Str.slice(0, start)(manifest) + replacement + Str.slice(end)(manifest);

  yield* parseManifest(rewritten, manifestPath);

  return rewritten;
});

const splitCliReference = Effect.fn('splitCliReference')(function* (skillDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const referencePath = path.join(skillDir, 'references', 'cli-reference.md');
  const reference = yield* fs.readFileString(referencePath);

  const { preamble, sections: all } = splitTopLevelSections(reference);
  const sections = Array.filter(all, (section) => section.anchor !== 'table-of-contents');

  if (sections.length === 0) {
    return yield* FallowBuildError.make({ reason: FallowBuildReason.cases.MissingCliReferenceSections.make({ file: referencePath }) });
  }

  const partsDir = path.join(skillDir, 'references', 'cli');
  yield* fs.makeDirectory(partsDir, { recursive: true });
  for (const section of sections) {
    const body = remapCliLinks(`# ${section.heading}\n\n${section.body}\n`, sections, '', true);
    yield* fs.writeFileString(path.join(partsDir, section.file), body);
  }

  yield* fs.writeFileString(referencePath, buildIndex(preamble, sections));

  for (const rel of ['references/gotchas.md', 'references/patterns.md', 'references/mcp.md', 'SKILL.md']) {
    const full = path.join(skillDir, rel);
    if (!(yield* fs.exists(full))) continue;
    const prefix = rel === 'SKILL.md' ? 'references/cli/' : 'cli/';
    const source = yield* fs.readFileString(full);
    yield* fs.writeFileString(full, remapCliLinks(source, sections, prefix));
  }
});

export const fallow = defineBuilder(
  'fallow',
  Effect.fn('buildFallow')(function* (out: string | undefined, validate: boolean) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const root = process.cwd();
    const destination = path.resolve(root, out ?? packageDir('fallow'));
    const manifestPath = path.join(destination, 'apm.yml');
    const apm = path.join(destination, '.apm');

    const manifest = yield* fs.readFileString(manifestPath);
    const document = yield* parseManifest(manifest, manifestPath);
    const parsed = yield* Effect.try({
      try: () => document.toJS(),
      catch: (cause) => FallowBuildError.make({ reason: FallowBuildReason.cases.UnreadableManifestYaml.make({ file: manifestPath, failure: cause }) }),
    });
    const { version } = yield* Schema.decodeUnknownEffect(Schema.Struct({ version: Schema.NonEmptyString }))(parsed).pipe(
      Effect.mapError((cause) => FallowBuildError.make({ reason: FallowBuildReason.cases.InvalidManifestVersion.make({ file: manifestPath, schemaError: cause }) })),
    );

    yield* Effect.scoped(Effect.gen(function* () {
      const scratch = yield* fs.makeTempDirectoryScoped();

      yield* run('bunx', [`fallow@${version}`, 'agent', 'install', '--root', scratch, '--harness', 'claude', '--approve']);

      yield* Console.log(`Scratch output (${scratch}):`);
      for (const rel of yield* fs.readDirectory(scratch, { recursive: true })) yield* Console.log(`  ${rel}`);

      yield* fs.remove(apm, { recursive: true, force: true });

      const skillDir = path.join(apm, 'skills', 'fallow');
      yield* fs.makeDirectory(path.dirname(skillDir), { recursive: true });
      yield* run('cp', ['-r', path.join(scratch, '.claude', 'skills', 'fallow'), skillDir]);
      yield* splitCliReference(skillDir);

      const hooks = path.join(apm, 'hooks');
      yield* copyFile(path.join(scratch, '.claude', 'hooks', 'fallow-gate.sh'), path.join(hooks, 'fallow-gate.sh'));
      yield* copyFile(path.join(root, 'scripts/assets/fallow', 'fallow-gate-io.sh'), path.join(hooks, 'fallow-gate-io.sh'));

      const descriptor = {
        PreToolUse: [{ matcher: 'Bash|bash', hooks: [{ type: 'command', command: './fallow-gate-io.sh' }] }],
      };
      const hookPath = path.join(hooks, 'fallow-gate.json');

      const hookJson = yield* encodeJson(descriptor).pipe(
        Effect.mapError((cause) => FallowBuildError.make({ reason: FallowBuildReason.cases.HookDescriptorEncodingFailed.make({ file: hookPath, schemaError: cause }) })),
      );

      yield* fs.writeFileString(hookPath, `${hookJson}\n`);

      const agents = yield* fs.readFileString(path.join(scratch, 'AGENTS.md'));
      const section = yield* Effect.fromResult(extractSection(agents));
      const setupHooks = yield* Effect.fromResult(extractSetupHooksBlock(agents));
      const body = `${section}\n\n${setupHooks}\n`;

      const instructions = path.join(apm, 'instructions');
      yield* fs.makeDirectory(instructions, { recursive: true });
      const instructionPath = path.join(instructions, 'fallow-task-map.instructions.md');

      const description = yield* encodeString(INSTRUCTION_DESCRIPTION).pipe(
        Effect.mapError((cause) => FallowBuildError.make({ reason: FallowBuildReason.cases.TaskMapDescriptionEncodingFailed.make({ file: instructionPath, schemaError: cause }) })),
      );

      yield* fs.writeFileString(instructionPath, `---\ndescription: ${description}\n---\n\n${body}`);

      const mcpJson = yield* fs.readFileString(path.join(scratch, '.mcp.json'));
      const servers = yield* Schema.decodeEffect(Schema.fromJsonString(McpJson))(mcpJson).pipe(
        Effect.mapError((cause) => FallowBuildError.make({ reason: FallowBuildReason.cases.InvalidMcpServerDefinitions.make({ file: '.mcp.json', schemaError: cause }) })),
      );
      const entry = yield* Effect.fromResult(deriveMcpEntry(servers));
      const rewritten = yield* rewriteManifest(manifest, manifestPath, entry);

      yield* fs.writeFileString(manifestPath, rewritten);
    }));

    if (validate) yield* run('apm', ['compile', '--validate'], destination);
  }),
  reportFailures('FallowBuildError', 'SubprocessExited', 'CommandOperationFailed'),
  { release: ReleaseSource.cases.NpmLatest.make({ npmPackage: 'fallow' }), validate: true },
);
