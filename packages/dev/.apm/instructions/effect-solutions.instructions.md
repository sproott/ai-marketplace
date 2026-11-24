---
description: Effect v4 reference and verification for marketplace CLI changes
---

# Effect CLI

Before changing Effect code, run `effect-solutions list` and read the relevant topics with `effect-solutions show <topic>`. Match examples to the installed stable Effect v4 APIs. If a guide and the installed types differ, check `node_modules/effect` and the shared v4 source at `~/.local/share/effect-solutions/effect`.

Keep text transforms pure and put filesystem, subprocess, and network operations at Effect boundaries. Use `effect/cli` for command parsing and `@effect/vitest` for Effect tests. Run `bun run typecheck`, `bun run lint`, and `just test` before handing off CLI changes.
