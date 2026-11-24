export function replaceAnchored(body: string, anchor: RegExp, replacement: string, label: string): string {
  const matches = [...body.matchAll(new RegExp(anchor.source, anchor.flags.includes('g') ? anchor.flags : anchor.flags + 'g'))];
  if (matches.length !== 1) {
    throw new Error(`Upstream guidance anchor changed: ${label} (found ${matches.length})`);
  }

  return body.replace(anchor, replacement);
}

export function adaptGuidance(file: string, body: string): string {
  if (file === 'SKILL.md') {
    body = replaceAnchored(body, /^\*\*Pin \/ Unpin:\*\*[^\n]*\n\n/m, '', 'pin route');
    body = replaceAnchored(body, /\*\*Hooks:\*\*[^\n]*/, '**Hooks:** For detector settings and ignores, read [reference/hooks.md](reference/hooks.md). APM installs the hook manifests.', 'hooks route');
  }

  if (file === 'reference/doctor.md') {
    body = replaceAnchored(body, /- \*\*Tool version\.\*\*[^\n]*/, '- **Tool version.** For `UPDATE_AVAILABLE`, run `apm update` to refresh package dependencies, then `apm install` to deploy them.', 'doctor update');
    body = replaceAnchored(body, /- \*\*`auto`\*\*[^\n]*/, '- **`auto`** carries no decision for project-document migrations. If the report contains no hook-manifest findings, run `<skill-base-dir>/scripts/impeccable doctor --fix` once, then report the changes. If hook findings are present, restore APM wiring with `apm install` and apply only the reported project-document migrations directly.', 'doctor auto repair');
  }

  if (file === 'reference/hooks.md') {
    body = replaceAnchored(body, /Supported harnesses:[\s\S]*?(?=## Triage findings)/, 'APM installs the hook manifests. Run `apm install` to restore wiring; reload the harness afterward. Configure detector behavior with the settings above. For ignores, run `<skill-base-dir>/scripts/impeccable hooks ignore-rule|ignore-file|ignore-value` with the arguments below.\n\n', 'native hook administration');
    body = replaceAnchored(body, /Per-developer overrides, including the install consent decision \(`hook\.consent`\) the CLI records, live/, 'Per-developer overrides live', 'native consent guidance');
    body = replaceAnchored(body, / \(in the Copilot cloud agent too, once `\.github\/hooks\/impeccable\.json` is committed\)/, '', 'native cloud manifest path');
    body = replaceAnchored(body, /- The hook is bundled[^\n]*\n/, '', 'native hook locations');
    body = replaceAnchored(body, / \(A Cursor project still[^\n]*?\)/, '', 'legacy hook migration');
  }

  if (file === 'reference/live.md' || file === 'reference/generate.md') {
    const anchor = file === 'reference/live.md' ? /## Prerequisites\n\n/ : /## Step 1: Parse the request\n\n/;
    body = replaceAnchored(body, anchor, '$&Set `IMPECCABLE_LIVE_COPY_AGENT=chat` for every live launcher command. Auto mode can start a local coding agent with approval and sandbox bypass; enable that fallback only with explicit user approval.\n\n', `${file} live policy`);
  }

  return body;
}
