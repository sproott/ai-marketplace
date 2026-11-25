# rtk

Local APM package for [rtk-ai/rtk](https://github.com/rtk-ai/rtk) — a Rust CLI proxy that cuts
LLM token consumption 60-90% on common dev commands (git, cargo, npm, docker, kubectl, etc.).

This package is **generated**, not authored by hand. `.apm/` is produced by
`bun run cli build rtk` (repo root) from the vendored, untouched submodule at
`vendor/rtk`, plus the shell sources authored in this repo under `packages/rtk/src/hooks/` that replace
upstream's hardcoded-absolute-path hook with a PATH-resolving wrapper and add the shim
installer, shim gate, and extra rewrites — see `docs/specs/rtk/spec.md` for why. Only `apm.yml` and this
README are fixed, hand-authored sources — everything under `.apm/` is rewritten on every
regenerate.

From the repository root, install dependencies with `bun install --frozen-lockfile`.

| Task | Command |
| --- | --- |
| Generate package | `bun run cli build rtk` |
| Generate and validate with APM | `bun run cli build rtk --validate` |
| Deploy | `apm install` |
| Update to the upstream release | `bun run cli update rtk` |

See the upstream repo for rtk's actual product documentation, install instructions, and
behavior reference.
