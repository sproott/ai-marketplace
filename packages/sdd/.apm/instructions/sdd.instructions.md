---
description: Where spec-driven-development artifacts live and how they relate.
---

# SDD Artifacts

Before reading or writing any SDD artifact, resolve where it lives for this repo:

1. **Declared** — if the repo's instructions state where specs/plans go, use that.
2. **Detectable** — else adopt an existing home (`docs/specs/`, `rfcs/`, `design/`…).
3. **Default** — else use the layout below.

If you resolve by 2 or 3, **record the convention** in the project's instructions so later runs read it instead of re-deriving. The resolved location always wins over the default.

## Default layout

```
docs/
  specs/<capability>/spec.md    → durable source of truth (specify)
  tasks/<work-slug>/
    plan.md                     → transient plan (planning-and-task-breakdown)
    todo.md                     → transient checklist (planning-and-task-breakdown)
```

`spec.md` is durable, keyed by capability. `plan.md`/`todo.md` are transient, keyed by the change — which may create, modify, or touch several specs, so plan-to-spec isn't 1:1. `<capability>` and `<work-slug>` need not match.

`plan.md` declares which specs it touches in its header:

```markdown
# Plan: <work-slug>

Specs touched:

- modifies: docs/specs/auth/spec.md
- creates: docs/specs/sso/spec.md
```

## Rules

- Update `spec.md` in place — don't fork copies. Multiple work-units can be in flight at once.
- `spec.md` describes current state, not history. When behavior changes, **replace** the outdated description — never append "no longer / previously / used to." History lives in git diffs and ADRs. Past-tense allowed only for a live constraint that stops a rejected path being retried (state the reason).
- Plan/todo are transient scaffolding — delete them once the work is done (at reconciliation). Only `spec.md` is durable.

The pipeline that produces these artifacts — its four phases, the gates between them, and how to run it — is the `spec-driven-development` skill. This file only says where the artifacts live.
