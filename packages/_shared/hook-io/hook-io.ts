import { readFileSync } from 'node:fs';
import { array, fallback, nullish, object, optional, safeParse, string, unknown, type InferOutput } from 'valibot';

export const Host = { CLAUDE: 'claude', VSCODE: 'vscode', COPILOT: 'copilot' } as const;
type Host = (typeof Host)[keyof typeof Host];

export const CREATE_TOOLS = new Set(['write', 'create', 'apply_patch', 'str_replace_editor', 'create_file']);
export const WRITE_TOOLS = new Set([
  ...CREATE_TOOLS, 'edit', 'replace_string_in_file', 'multi_replace_string_in_file', 'insert_edit_into_file',
]);

export type FileChange = { readonly path: string } & (
  | { readonly old_text: null; readonly new_text: string | null }
  | { readonly old_text: string; readonly new_text: string }
);

type CommonInput = Readonly<{
  event: string;
  tool: string;
  changes: readonly FileChange[];
  command: string | null;
  prompt: string | null;
  session_id: string | null;
}>;

type ClaudeShapedHost = Exclude<Host, typeof Host.COPILOT>;
export type HookInput = CommonInput & (
  | { readonly host: ClaudeShapedHost; readonly tool_result: null }
  | { readonly host: typeof Host.COPILOT; readonly tool_result: string | null }
);

type HookSpecific<T> = { hookSpecificOutput: T & { hookEventName: string } };
type ClaudeContext = HookSpecific<{ additionalContext: string }>;
type CopilotContext = {
  additionalContext: string;
  modifiedResult?: { resultType: 'success'; textResultForLlm: string };
};
type BlockResponse = (ClaudeContext & { decision: 'block'; reason: string }) | CopilotContext;
type Denial = { permissionDecision: 'deny'; permissionDecisionReason: string };
type HookResponse = ClaudeContext | CopilotContext | BlockResponse | Denial | HookSpecific<Denial>;

const text = fallback(nullish(string()), undefined);
const opaque = optional(unknown());
const Envelope = object({
  tool_name: text,
  toolName: text,
  hook_event_name: text,
  session_id: text,
  sessionId: text,
  prompt: text,
  timestamp: opaque,
  tool_input: opaque,
  toolArgs: opaque,
  toolResult: opaque,
});

const Args = object({
  command: text,
  input: text,
  replacements: fallback(nullish(array(unknown())), undefined),
  file_path: text,
  filePath: text,
  path: text,
  file: text,
  new_string: text,
  newString: text,
  new_str: text,
  newStr: text,
  code: text,
  old_string: text,
  oldString: text,
  old_str: text,
  oldStr: text,
  content: text,
  file_text: text,
  fileText: text,
  text,
});
type Args = InferOutput<typeof Args>;

const Result = object({ resultType: text, textResultForLlm: text });

function decodeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseArgs(value: unknown): Args | undefined {
  if (typeof value === 'string' && value.trimStart().startsWith('*** Begin Patch')) return { input: value };

  const parsed = safeParse(Args, decodeJson(value));
  return parsed.success ? parsed.output : undefined;
}

function patchChanges(patch: string): FileChange[] {
  const output: FileChange[] = [];
  let operation = '';
  let path = '';
  let added: string[] = [];
  let removed: string[] = [];

  function flush(): void {
    if (path && (operation === 'Add File' || operation === 'Update File')) {
      output.push({ path, new_text: added.join('\n'), old_text: operation === 'Update File' ? removed.join('\n') : null });
    }
  }

  for (const line of patch.split(/\r?\n/)) {
    const header = /^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$/.exec(line);
    if (header) {
      if (header[1] !== 'Move to') {
        flush();
        operation = header[1] ?? '';
        added = [];
        removed = [];
      }

      path = header[2]?.trim() ?? '';
    } else if (!line.startsWith('*** ') && !line.startsWith('@@')) {
      if (line.startsWith('+') || line.startsWith(' ')) added.push(line.slice(1));
      if (line.startsWith('-') || line.startsWith(' ')) removed.push(line.slice(1));
    }
  }

  flush();
  return output;
}

function changes(args: Args | undefined): FileChange[] {
  if (!args) return [];
  if (args.input?.trimStart().startsWith('*** Begin Patch')) return patchChanges(args.input);
  if (args.replacements) return args.replacements.flatMap((value) => changes(parseArgs(value)));

  const path = args.file_path ?? args.filePath ?? args.path ?? args.file;
  if (!path) return [];

  const next = args.new_string ?? args.newString ?? args.new_str ?? args.newStr ?? args.code;
  if (next != null) {
    return [{ path, new_text: next, old_text: args.old_string ?? args.oldString ?? args.old_str ?? args.oldStr ?? '' }];
  }

  return [{ path, new_text: args.content ?? args.file_text ?? args.fileText ?? args.text ?? null, old_text: null }];
}

export function detectHost(payload: object): Host {
  if (('toolName' in payload && payload.toolName !== undefined) ||
      ('toolArgs' in payload && payload.toolArgs !== undefined) ||
      ('sessionId' in payload && payload.sessionId !== undefined)) return Host.COPILOT;

  return 'timestamp' in payload ? Host.VSCODE : Host.CLAUDE;
}

export function parse(value: unknown, event: string): HookInput {
  const parsed = safeParse(Envelope, decodeJson(value));
  const payload: InferOutput<typeof Envelope> = parsed.success ? parsed.output : {};
  const host = detectHost(payload);
  const args = parseArgs(payload.tool_input ?? payload.toolArgs);

  const common: CommonInput = {
    event: payload.hook_event_name || event,
    tool: (payload.tool_name || payload.toolName || '').toLowerCase(),
    changes: changes(args),
    command: args?.command ?? null,
    prompt: payload.prompt ?? null,
    session_id: payload.session_id || payload.sessionId || null,
  };

  if (host !== Host.COPILOT) return { ...common, host, tool_result: null };

  const result = safeParse(Result, decodeJson(payload.toolResult));
  const tool_result = result.success && result.output.resultType === 'success' ? (result.output.textResultForLlm ?? null) : null;

  return { ...common, host, tool_result };
}

export function read(event: string): HookInput {
  return parse(readFileSync(0, 'utf8'), event);
}

export function claudeContext(event: string, text: string): ClaudeContext {
  return { hookSpecificOutput: { hookEventName: event, additionalContext: text } };
}

export function copilotContext(result: string | null, text: string): CopilotContext {
  if (result !== null) {
    return {
      additionalContext: text,
      modifiedResult: { resultType: 'success', textResultForLlm: `${result}\n\n${text}` },
    };
  }

  return { additionalContext: text };
}

export function context(hook: HookInput, text: string): ClaudeContext | CopilotContext {
  return hook.host === Host.COPILOT ? copilotContext(hook.tool_result, text) : claudeContext(hook.event, text);
}

export function block(hook: HookInput, text: string): BlockResponse {
  if (hook.host === Host.COPILOT) return copilotContext(hook.tool_result, text);

  return { decision: 'block', reason: text, ...claudeContext(hook.event, text) };
}

export function deny(hook: HookInput, reason: string): Denial | HookSpecific<Denial> {
  const decision: Denial = { permissionDecision: 'deny', permissionDecisionReason: reason };

  return hook.host === Host.COPILOT ? decision : { hookSpecificOutput: { hookEventName: hook.event, ...decision } };
}

export function emit(response: HookResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}
