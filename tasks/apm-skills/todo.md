# Todo: APM Skills Package

## Phase 1: Scaffold
- [x] Task 1: `packages/apm/apm.yml` + `.gitignore`

## Phase 2: Author skills (parallel — independent files)
- [x] Task 2: `apm-author-primitive/SKILL.md`
- [x] Task 3: `apm-package-init/SKILL.md`
- [x] Task 4: `apm-author-marketplace/SKILL.md`
- [x] Task 5: `apm-install-deps/SKILL.md`
- [x] Task 6: `apm-audit-security/SKILL.md`
- [x] Task 7: `apm.instructions.md` (global-instructions routing rule)

### Checkpoint: review all 6 files before wiring
- [x] Compile-vs-install distinction corrected across all skills (compile = instructions
      only; install = deploys skills + resolves deps)
- [x] Skill descriptions trimmed ~15% (260–340 chars; all triggers preserved)

## Phase 3: Wire + verify
- [x] Task 8: add `packages/apm` to root `apm.yml` — marketplace entry added;
      `./packages/apm` was already in devDependencies. Tag pattern: **lockstep**
      (inherits `build.tagPattern: v{version}`, mirrors `sdd`) per user.
- [x] Task 9: `apm compile --validate` (package) clean; root `apm install` deploys 5 skills
      → `.claude/skills/apm-*` + instruction → `.claude/rules/apm.md` &
      `.github/instructions/`; lockfile gained `_local/apm` entry (deployed_files + hashes)

### Checkpoint: done, ready for commit
