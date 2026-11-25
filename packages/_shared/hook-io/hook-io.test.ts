import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { block, context, deny, detectHost, emit, failure, parse } from './hook-io.ts';

const event = 'PostToolUse';
const patch = [
  '*** Begin Patch', '*** Update File: a.fs', '*** Move to: b.fs', '@@', ' let a = 1', '-old', '+new',
  '*** Delete File: c.fs', '*** Add File: d.fs', '+added', '*** End Patch',
].join('\n');

const replacement = { path: 'a.fs', old_text: 'x', new_text: 'y' };

describe('wire format', () => {
  it.each([{ toolName: 'edit' }, { toolArgs: '{}' }, { sessionId: 'cli' }])(
    'should detect Copilot CLI when camelCase markers accompany snake_case metadata', (marker) => {
      const payload = { ...marker, session_id: 'mixed', timestamp: 1 };

      const host = detectHost(payload);

      expect(host, 'Copilot CLI marker takes precedence over Claude-shaped metadata').toBe('copilot');
    },
  );
});

describe('hook input', () => {
  it.each([
    { name: 'Claude edits a file', payload: { tool_name: 'Edit', tool_input: { file_path: 'a.fs', old_string: 'x', new_string: 'y' } }, host: 'claude', changes: [replacement] },
    { name: 'Claude writes a whole file', payload: { tool_name: 'Write', tool_input: { file_path: 'a.fs', content: 'y' } }, host: 'claude', changes: [{ ...replacement, old_text: null }] },
    { name: 'Copilot CLI sends JSON string arguments', payload: { toolName: 'edit', toolArgs: '{"path":"a.fs","old_str":"x","new_str":"y"}' }, host: 'copilot', changes: [replacement] },
    { name: 'Copilot CLI sends malformed arguments', payload: { toolName: 'edit', toolArgs: '{not json' }, host: 'copilot', changes: [] },
    { name: 'VS Code inserts code', payload: { timestamp: 't', tool_name: 'insert_edit_into_file', tool_input: { filePath: 'a.fs', code: 'y' } }, host: 'vscode', changes: [{ ...replacement, old_text: '' }] },
    { name: 'VS Code edits multiple files', payload: { timestamp: 't', tool_name: 'multi_replace_string_in_file', tool_input: { replacements: [{ filePath: 'a.fs', oldString: 'x', newString: 'y' }, { filePath: 'b.fs', oldString: 'x', newString: 'y' }] } }, host: 'vscode', changes: [replacement, { ...replacement, path: 'b.fs' }] },
  ])('should normalize file changes when $name', ({ payload, host, changes }) => {
    const hook = parse(payload, event);

    expect(hook, 'source host and file changes are preserved').toMatchObject({ host, changes });
  });

  it.each([{ toolName: 'apply_patch', toolArgs: patch }, { timestamp: 1, tool_name: 'apply_patch', tool_input: { input: patch } }])(
    'should preserve both sides of surviving files when parsing a patch', (payload) => {
      const hook = parse(payload, event);

      expect(hook.changes, 'patch includes a moved-to file and an added file but no deleted file').toEqual([
        { path: 'b.fs', old_text: 'let a = 1\nold', new_text: 'let a = 1\nnew' },
        { path: 'd.fs', old_text: null, new_text: 'added' },
      ]);
    },
  );

  it('should keep valid envelope fields when another field has the wrong type', () => {
    const payload = { tool_name: 'Write', toolName: 123, session_id: 123, tool_input: { file_path: 'a.fs' } };

    const hook = parse(payload, event);

    expect(hook, 'wrong-typed fields do not replace the valid tool name or change the host').toMatchObject({
      host: 'claude', tool: 'write', session_id: null,
    });
  });

  it('should keep the change when a text argument has the wrong type', () => {
    const payload = { tool_name: 'Write', tool_input: { file_path: 'a.fs', content: 123 } };

    const hook = parse(payload, event);

    expect(hook.changes, 'valid path survives while wrong-typed content is ignored').toEqual([
      { path: 'a.fs', old_text: null, new_text: null },
    ]);
  });

  it('should normalize the edit when a harness adds unknown fields', () => {
    const payload = { tool_name: 'Write', extra: true, tool_input: { file_path: 'a.fs', content: 'x', extra: true } };

    const hook = parse(payload, event);

    expect(hook.changes, 'unknown metadata does not interfere with a valid edit').toEqual([
      { path: 'a.fs', old_text: null, new_text: 'x' },
    ]);
  });

  it('should decode the command when Copilot CLI sends JSON string arguments', () => {
    const payload = { toolName: 'bash', toolArgs: '{"command":"ls"}' };

    const hook = parse(payload, event);

    expect(hook.command, 'command comes from the decoded toolArgs').toBe('ls');
  });
});

describe('hook responses', () => {
  it.each([{ tool_name: 'Edit' }, { timestamp: 't', tool_name: 'create_file' }])(
    'should nest context when the payload is Claude-shaped', (payload) => {
      const hook = parse(payload, event);

      const response = context(hook, 'finding');

      expect(response, 'context sits under hookSpecificOutput').toEqual({
        hookSpecificOutput: { hookEventName: event, additionalContext: 'finding' },
      });
    },
  );

  it('should include the finding when blocking in Claude Code', () => {
    const hook = parse({ tool_name: 'Edit' }, event);

    const response = block(hook, 'finding');

    expect(response, 'Claude receives both a block decision and context').toEqual({
      decision: 'block', reason: 'finding', hookSpecificOutput: { hookEventName: event, additionalContext: 'finding' },
    });
  });

  it('should append a finding when Copilot CLI cannot block', () => {
    const hook = parse({ toolName: 'apply_patch', toolResult: { resultType: 'success', textResultForLlm: 'Done.' } }, event);

    const response = block(hook, 'finding');

    expect(response, 'Copilot receives context and an amended tool result').toEqual({
      additionalContext: 'finding', modifiedResult: { resultType: 'success', textResultForLlm: 'Done.\n\nfinding' },
    });
  });

  it.each([
    { name: 'Claude Code', payload: { tool_name: 'Write' }, output: { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'reason' } } },
    { name: 'Copilot CLI', payload: { toolName: 'apply_patch' }, output: { permissionDecision: 'deny', permissionDecisionReason: 'reason' } },
  ])('should use the native denial shape when responding to $name', ({ payload, output }) => {
    const hook = parse(payload, 'PreToolUse');

    const response = deny(hook, 'reason');

    expect(response, 'host receives a denial in its native shape').toEqual(output);
  });
});

describe('emit', () => {
  function captured(): string[] {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => (writes.push(String(chunk)), true));
    onTestFinished(() => spy.mockRestore());
    return writes;
  }

  it('should add warnings as a user-facing systemMessage when a response is emitted', () => {
    const writes = captured();
    const hook = parse({ tool_name: 'Edit' }, event);

    emit(context(hook, 'finding'), ['a', 'b']);

    expect(writes.map((line) => JSON.parse(line)), 'warnings join into systemMessage beside the response').toEqual([{
      hookSpecificOutput: { hookEventName: event, additionalContext: 'finding' }, systemMessage: 'a\nb',
    }]);
  });

  it('should emit only the systemMessage when warnings come without a response', () => {
    const writes = captured();

    emit(null, [failure('demo', new Error('boom'))]);

    expect(writes.map((line) => JSON.parse(line)), 'a lone warning reaches the user').toEqual([{ systemMessage: 'demo hook failed: boom' }]);
  });

  it('should write nothing when there is neither a response nor a warning', () => {
    const writes = captured();

    emit(null);

    expect(writes, 'an empty emit stays silent').toEqual([]);
  });
});
