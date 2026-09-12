# fallow

Local APM package for [fallow](https://www.npmjs.com/package/fallow) — codebase
intelligence for TypeScript/JavaScript (dead code, duplication, architecture boundaries,
PR-risk audit).

This package is **generated**, not authored by hand. `.apm/` is produced by
`bun scripts/build-fallow-package.ts` (repo root) from a throwaway scratch dir created by
running `bunx fallow@<pinned-version> agent install` — fallow ships no static "agent
primitives" tree of its own, it writes one on demand. See
`docs/specs/fallow-package/spec.md` for the full mapping and rationale. Only `apm.yml` and
this README are fixed, hand-authored sources — everything under `.apm/` (and the
`dependencies.mcp` field in `apm.yml`) is rewritten on every regenerate.

Commands:

```
Generate package:   bun scripts/build-fallow-package.ts
Validate package:   bun scripts/build-fallow-package.ts --validate
Install (deploy):   apm install                            # from repo root
Bump fallow:        bump `version:` in packages/fallow/apm.yml by hand to the target
                      release, then: bun scripts/build-fallow-package.ts
                      && git add packages/fallow
                    # the generator reads the pin FROM apm.yml — there is no second
                    # hardcoded version to keep in sync
```

See the upstream package for fallow's actual product documentation, install instructions,
and behavior reference.
