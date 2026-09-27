#!/usr/bin/env node
// Harness I/O for the vendored caveman hooks, which read and answer only Claude Code's
// schema. Usage: node ./caveman-hook-io.js <hook script in this dir>
//
//   Claude Code, VS Code Copilot Chat, Copilot CLI PascalCase: passed through untouched.
//   Copilot CLI camelCase (`sessionId`): payload reshaped into Claude's snake_case keys on
//   the way in; plain-text or `hookSpecificOutput` context comes back out as top-level
//   `additionalContext`.
//
// Always exits 0 on the Copilot path: a hook error must never block a session or prompt.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch (e) {}
let payload = null;
try { payload = JSON.parse(raw); } catch (e) {}

const copilot = payload !== null && typeof payload === 'object'
  && 'sessionId' in payload && !('session_id' in payload);

const input = copilot
  ? JSON.stringify({
      session_id: payload.sessionId,
      transcript_path: payload.transcriptPath,
      cwd: payload.cwd,
      source: payload.source,
      prompt: payload.prompt,
    })
  : raw;

const child = spawnSync(process.execPath, [path.join(__dirname, process.argv[2])], {
  input,
  encoding: 'utf8',
});

if (!copilot) {
  process.stdout.write(child.stdout || '');
  process.stderr.write(child.stderr || '');
  process.exit(child.status ?? 0);
}

let context = (child.stdout || '').trim();
try {
  const response = JSON.parse(context);
  context = response.hookSpecificOutput?.additionalContext ?? response.reason ?? '';
} catch (e) {}
if (context) process.stdout.write(JSON.stringify({ additionalContext: context }));
process.exit(0);
