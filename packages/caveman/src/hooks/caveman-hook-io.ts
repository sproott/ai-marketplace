import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { copilotContext } from '../../../_shared/hook-io/hook-io.ts';

let raw = '';
let payload: unknown;
try {
  raw = readFileSync(0, 'utf8');
  payload = JSON.parse(raw);
} catch {}

const envelope = payload !== null && typeof payload === 'object' ? payload as Record<string, unknown> : {};
// A snake_case session ID means the payload already fits the vendored hook.
const copilot = 'sessionId' in envelope && !('session_id' in envelope);
const [, bundle, script] = process.argv;
if (!bundle || !script) process.exit(copilot ? 0 : 1);

// Vendored caveman hooks consume Claude's wire format.
const input = copilot
  ? JSON.stringify({
      session_id: envelope.sessionId,
      transcript_path: envelope.transcriptPath,
      cwd: envelope.cwd,
      source: envelope.source,
      prompt: envelope.prompt,
    })
  : raw;

// Bun inlines __dirname to the source directory when bundling.
const child = spawnSync(process.execPath, [join(dirname(bundle), script)], { input, encoding: 'utf8' });

if (copilot) {
  let text = (child.stdout ?? '').trim();
  try {
    const response = JSON.parse(text);
    const context: unknown = response.hookSpecificOutput?.additionalContext ?? response.reason;
    text = typeof context === 'string' ? context : '';
  } catch {}

  if (text) process.stdout.write(JSON.stringify(copilotContext(null, text)));
} else {
  process.stdout.write(child.stdout ?? '');
  process.stderr.write(child.stderr ?? '');
  process.exitCode = child.status ?? 0;
}
