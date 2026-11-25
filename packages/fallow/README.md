# fallow

Local APM package for [fallow](https://www.npmjs.com/package/fallow) — codebase
intelligence for TypeScript/JavaScript (dead code, duplication, architecture boundaries,
PR-risk audit).

This package is **generated**, not authored by hand. `.apm/` is produced by
`bun run cli build fallow` (repo root) from a throwaway scratch dir created by
running `bunx fallow@<pinned-version> agent install` — fallow ships no static "agent
primitives" tree of its own, it writes one on demand. See
`docs/specs/fallow/spec.md` for the full mapping and rationale. Only `apm.yml` and
this README are fixed, hand-authored sources — everything under `.apm/` (and the
`dependencies.mcp` field in `apm.yml`) is rewritten on every regenerate.

From the repository root, install dependencies with `bun install --frozen-lockfile`.

| Task | Command |
| --- | --- |
| Generate package | `bun run cli build fallow` |
| Generate and validate with APM | `bun run cli build fallow --validate` |
| Deploy | `apm install` |
| Update to the upstream release | `bun run cli update fallow` |

See the upstream package for fallow's actual product documentation, install instructions,
and behavior reference.
