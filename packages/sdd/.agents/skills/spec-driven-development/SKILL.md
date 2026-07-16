---
name: spec-driven-development
description: The end-to-end spec-driven-development pipeline — takes a feature from spec to reconciled code through four gated phases, each run in its own fresh context. Use when starting a project, feature, or significant change and you want the full spec → plan → implement → reconcile flow, or when you need to understand how the SDD phases fit together and how to run them.
---

# Spec-Driven Development

## Overview

Build significant changes through four gated phases. Each phase is its own skill, run in its **own fresh context**, handing off to the next through a durable artifact on disk. The artifact — not the conversation history — carries the state, so each phase's context stays small and focused instead of accumulating the whole project in one window.

This skill is the map. It doesn't do the work; each phase does. Start with `specify` and follow the handoffs. Where the artifacts physically live is resolved by the SDD instruction (declared → detectable → default `docs/`).

## When to Use

- Starting a new project or feature, or making a significant / multi-file change
- Requirements are ambiguous and need to be pinned down before code
- You want the full gated flow, or just need to see how the phases connect

**When NOT to use:** Single-file fixes, typos, or changes whose scope is already obvious and self-contained. Run the change directly.

## The Pipeline

```
SPECIFY ─────→ PLAN ────────→ IMPLEMENT ───────→ RECONCILE
 specify     planning-and-   incremental-        spec-
             task-breakdown  implementation      reconciliation
                             (+ test-driven-
                              development)
    │             │               │                  │
    ▼             ▼               ▼                  ▼
 spec.md      plan.md +        code +            spec.md updated,
              todo.md          touched specs     tasks/ deleted
```

- **SPECIFY** — `specify` → writes `spec.md`. What we're building, why, and how we'll know it's done. A dialogue: surface assumptions, ask until requirements are concrete.
- **PLAN** — `planning-and-task-breakdown` → writes `plan.md` + `todo.md`. Dependency-ordered vertical slices. Planning and task-listing are one phase producing two files, not two gates.
- **IMPLEMENT** — `incremental-implementation` (with `test-driven-development`; `context-engineering` governs what to load) → writes code and touches specs. Reads `plan.md`/`todo.md` from disk; loads spec sections and source selectively.
- **RECONCILE** — `spec-reconciliation` → folds divergences back into every touched `spec.md`, then deletes `tasks/<work-slug>/`.

## Fresh Context Is a Manual Boundary

The core discipline of this pipeline is that each phase runs in a fresh context. Two things about how that actually works:

**An agent cannot reset its own context.** "Start the next phase fresh" is not something the running agent does to itself — it happens at a session boundary *you* create. In practice that boundary is a `/clear` or a new session.

**That boundary is the review gate.** A human reviews between phases, and advancing to the next phase is the approval. So the `/clear` lands exactly where you already stop to review the artifact — it costs one action at a point you were halting at anyway. The loop per phase:

1. Run the phase. It writes its artifact (`spec.md`, or `plan.md`/`todo.md`).
2. Review the artifact. Advancing is your approval.
3. `/clear` or open a new session.
4. Run the next phase. It reads the artifact from disk — it does **not** need the previous phase's conversation.

**Do not run all four phases in one unbroken session.** Nothing clears the context mid-session, so it accumulates the entire project and you lose the whole benefit — the reason the pipeline is split into phases at all.

**Subagents don't shortcut this.** A subagent gets a fresh context but runs headless — it can't ask you questions interactively, it only returns a final result to its parent. SPECIFY and PLAN are dialogues, so they can't be delegated to a mute subagent without gutting their purpose. Drive the phases yourself, across sessions.

## Flow Rules

- A work-unit may touch **more than one spec**. `plan.md` lists them in its `Specs touched:` header; RECONCILE folds into **every** listed spec, not just one.
- The spec is the living source of truth. Update it in place as decisions change during a phase; the final fold-back of everything that diverged is RECONCILE, not an ad-hoc edit.
- Plan and todo are scaffolding. They exist only between PLAN and RECONCILE, and RECONCILE deletes them. Nothing of lasting value should live only in them — it belongs in the spec.
- If the repo keeps ADRs, link the relevant ADR from the spec instead of restating rationale; don't invent an ADR convention where none exists.

## Red Flags

- Running SPECIFY → PLAN → IMPLEMENT in one session without ever clearing context
- Delegating SPECIFY or PLAN to a subagent, then wondering why assumptions weren't surfaced
- A phase reaching back into the previous phase's conversation instead of reading its artifact from disk
- Reconciling only one spec when `plan.md` lists several
- Treating `plan.md`/`todo.md` as durable — they are deleted at reconciliation

## Verification

Before considering the pipeline correctly run:

- [ ] Each phase ran in its own context, entered by reading its input artifact from disk
- [ ] A human reviewed each artifact at its gate before the next phase started
- [ ] Every spec listed in `plan.md`'s header was reconciled
- [ ] `tasks/<work-slug>/` was deleted once the spec(s) captured the outcome
