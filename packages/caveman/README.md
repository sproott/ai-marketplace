# caveman

Local APM package for [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) — ultra-compressed
caveman-style agent responses, 65% fewer output tokens with full technical accuracy preserved.

This package is **generated**, not authored by hand. `.apm/` is produced by
`bun run cli build caveman` (repo root) from the vendored, untouched submodule at
`vendor/caveman`. Only `apm.yml` and this README are fixed, hand-authored sources — everything
under `.apm/` is rewritten on every regenerate.

Run `bun install --frozen-lockfile` at the repository root before building. To update
to the upstream release, run `bun run cli update caveman`.

See the upstream repo for caveman's actual product documentation, install instructions, and
behavior reference.
