---
description: Global instructions for SDD file structure.
---

# SDD File Structure

Spec-driven development artifacts live at fixed repo-root paths so every SDD skill agrees on where to read/write.

```
specs/
  <feature-slug>/
    spec.md            → Objective, tech stack, commands, structure, style,
                         testing strategy, boundaries, success criteria (spec-driven-development)
tasks/
  <feature-slug>/
    plan.md            → Implementation plan for this feature (planning-and-task-breakdown)
    todo.md            → Checklist-style task list for this feature (planning-and-task-breakdown)
```

## Rules

- `<feature-slug>` matches between `specs/<feature-slug>/` and `tasks/<feature-slug>/` for the same feature.
- Multiple features can be in flight at once — one `tasks/<feature-slug>/` dir per active feature, so parallel work on a single branch doesn't collide. Folding several adjacent changes into one commit/feature is fine — just use one shared `<feature-slug>` for them instead of splitting per change.
- When a feature ships, archive rather than delete: leave `tasks/<feature-slug>/` in place (or remove it once `specs/<feature-slug>/spec.md` fully captures the outcome) — don't repurpose a finished feature's task dir for unrelated new work.
- `specs/<feature-slug>/spec.md` is the living source of truth for that feature; update it in place as decisions change, don't fork copies.
- Create `tasks/<feature-slug>/` at repo root if it doesn't exist yet — skills expect this exact path shape, not a flat `tasks/plan.md`, and not nested under `.apm/` or `docs/`.

Note: `references/definition-of-done.md` and `references/testing-patterns.md` cited by some skills are skill-bundled assets, not part of this project-structure convention — they ship alongside their citing skill (see `.apm/skills/*/references/`).
