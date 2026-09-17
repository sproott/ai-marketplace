---
description: "Standing rule for rtk (Rust Token Killer): meta-commands, install verification, how the PreToolUse hook rewrites commands on each supported agent, and what a shim-not-on-PATH denial means."
---

# RTK - Rust Token Killer

**Usage**: Token-optimized CLI proxy (cuts up to 90% of bash output)

## Meta Commands (always use rtk directly)

```bash
rtk gain              # Show token savings analytics
rtk gain --history    # Show command usage history with savings
rtk discover          # Analyze Claude Code history for missed opportunities
rtk proxy <cmd>       # Execute raw command without filtering (for debugging)
```

## Installation Verification

```bash
rtk --version         # Should show: rtk X.Y.Z
rtk gain              # Should work (not "command not found")
which rtk             # Verify correct binary
```

⚠️ **Name collision**: If `rtk gain` fails, you may have reachingforthejack/rtk (Rust Type Kit) installed instead.

## Hook-Based Usage

All other commands are automatically rewritten by the Claude Code hook.
Example: `git status` → `rtk git status` (transparent, 0 tokens overhead)

Refer to CLAUDE.md for full command reference.


## Rewriting Per Agent

Claude Code, VS Code Copilot Chat, and GitHub Copilot CLI all get the rewrite transparently:
the `PreToolUse` hook hands back the `rtk`-prefixed command and the agent runs that one.
GitHub Copilot inside JetBrains IDEs honors nothing but a denial, so there the hook denies and
names the command in the reason — re-run it exactly as the reason states.

## Shim Activation

The rtk PATH shim (`~/.rtk/shim/rtk`) is (re)installed automatically every session via a
`SessionStart` hook, but it only takes effect once `~/.rtk/shim` is on `$PATH` — which
needs a shell rc edit the installer does not make. Until then, a `PreToolUse` gate **denies
every Bash command** with an `RTK shim not on PATH` reason.

**If Bash is denied for that reason, stop and get the user to activate the shim before
anything else.** Tell them to add this line to their shell profile (`~/.bashrc` / `~/.zshrc`)
and open a new shell:

```bash
export PATH="$HOME/.rtk/shim:$PATH"
```
