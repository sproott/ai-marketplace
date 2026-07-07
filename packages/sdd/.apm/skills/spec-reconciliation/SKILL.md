---
name: spec-reconciliation
description: Reconciles the spec with what was actually built, then closes out the feature. Use when implementation is complete and verified, before opening a PR or archiving — folds divergences from plan/todo/memory back into spec.md, then removes the tasks dir. Use as the closing phase of spec-driven development.
---

# Spec Reconciliation

## Overview

Implementation always diverges from the spec. Decisions get made mid-build, scope shifts, an approach in the plan turns out wrong. By the time a change is done, each spec it touched describes what you *intended* to build and the code describes what you *actually* built. This skill closes that gap: fold every divergence back into the affected spec(s) so they become an accurate record, then delete the now-spent planning artifacts.

A work-unit may touch more than one spec (see the `Specs touched:` header in `plan.md`). Reconcile **every** listed spec, not just one.

The spec is the living source of truth. A stale spec is worse than useless — it lies with authority. Reconciliation is the step that keeps the promise that the spec stays true.

## When to Use

- All tasks in `tasks/<work-slug>/todo.md` are complete and verified
- The change is about to be committed, opened as a PR, or archived
- You're closing out a change and want its spec(s) to reflect reality, not intent

**When NOT to use:** Mid-implementation (update the spec in place per `spec-driven-development`'s "Keeping the Spec Alive" instead — reconciliation is a one-time closing step, not a running edit). Also skip for trivial changes that never had a `tasks/<work-slug>/` dir.

## Where This Sits

This is **Phase 5** of the gated workflow, after implementation:

```
SPECIFY ──→ PLAN ──→ TASKS ──→ IMPLEMENT ──→ RECONCILE
   │          │        │          │             │
   ▼          ▼        ▼          ▼             ▼
 Human      Human    Human      Human         Human
 reviews    reviews  reviews    reviews       reviews
```

Like every other phase, it is human-gated: you present the reconciliation, the human approves, and only then do you rewrite the spec and delete the task dir. Deletion is irreversible — the review beat is cheap insurance.

## The Reconciliation Process

### Step 1: Gather the Divergence Sources

Read every record of what actually happened, in this order:

1. `tasks/<work-slug>/plan.md` — read its `Specs touched:` header first (it lists every spec to reconcile), then the architecture decisions and rationale; note any marked as changed or abandoned
2. `tasks/<work-slug>/todo.md` — completed tasks; note any that were added, dropped, or reshaped mid-flight
3. **Session memory / notes** — decisions captured outside the files (e.g. persistent memory, PR discussion, commit messages) that never made it into plan or todo
4. **The code itself** — the ground truth. Where the implementation contradicts all of the above, the code wins

### Step 2: Diff Intent Against Reality

Compare each of the spec's core areas against what was built. Produce an explicit divergence list — do not silently rewrite:

```
DIVERGENCES FROM spec.md:

1. Tech Stack — spec says JWT auth; implemented session cookies (plan.md decision #3).
2. Project Structure — added src/workers/ (not in spec); background jobs live here.
3. Testing Strategy — spec targets 90% coverage; settled on 80% for the UI layer (todo task 7 note).
4. Success Criteria — "export to CSV" was cut from scope; PDF export added instead.
5. Boundaries — no change.

→ Fold these into spec.md? Correct anything before I apply.
```

Categorize each divergence: **fold in** (a real, kept decision → update the spec), **drop** (a plan idea that was abandoned and left no trace in the code → no spec change needed), or **flag** (an unintended divergence that may be a bug, not a decision → surface to the human, don't paper over it).

### Step 3: Present for Approval (Gate)

Show the divergence list and wait. The human confirms which changes are real decisions worth recording versus accidents worth fixing. Do not proceed to Step 4 without approval.

### Step 4: Fold Into the Spec

Update each touched `spec.md` **in place** (don't fork a copy):

- Rewrite each affected section to describe what was built, not what was planned
- Move resolved items out of **Open Questions**; delete the ones that no longer apply
- Update **Success Criteria** to match what actually ships — mark cut criteria as cut, add new ones
- Keep the spec's structure and the six core areas intact; you're updating content, not reformatting

The result should read as if it were written *after* the feature, describing the shipped system accurately.

### Step 5: Close Out the Task Dir

Once the spec fully captures the outcome and the human has approved:

- Delete `tasks/<work-slug>/` (both `plan.md` and `todo.md` and the dir itself)
- The spec(s) now carry everything of lasting value; the plan and todo were scaffolding
- If any divergence was **flagged** as a possible bug rather than a decision, do NOT delete — leave the task dir and hand the open item back to the human first

Deletion is the signal that the feature is closed and the spec is authoritative.

## Reconciliation Report Template

Present this before applying anything:

```markdown
## Reconciliation: [Feature Name]

### Kept decisions (fold into spec)
- [Section]: [spec said X → built Y, because Z]

### Abandoned (no spec change)
- [Plan idea that left no trace in code]

### Flagged (possible unintended divergence — needs a call)
- [Code diverges from spec but no decision recorded — bug or intent?]

### Spec sections to rewrite
- [ ] Tech Stack
- [ ] Project Structure
- [ ] Testing Strategy
- [ ] Success Criteria
- [ ] Boundaries / Open Questions

### On approval
- [ ] Apply edits to each touched spec.md
- [ ] Delete tasks/<work-slug>/
```

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The spec is close enough" | "Close enough" is how specs rot. The next person trusts it literally. |
| "I'll remember why we changed it" | You won't, and the next agent can't. The rationale belongs in the spec. |
| "Just delete the tasks, skip the spec update" | Then you've destroyed the record of what happened and left the spec lying. Reconcile first. |
| "There were no divergences" | Rare. Re-check tech stack, scope cuts, and success criteria — those drift most silently. |
| "Keep the plan around just in case" | The plan is scaffolding. Anything worth keeping goes in the spec; the rest is clutter that gets repurposed and causes confusion. |

## Red Flags

- Deleting `tasks/<work-slug>/` without updating the spec(s) first
- Rewriting the spec without showing the human the divergence list
- Silently "fixing" a code-vs-spec mismatch that might be an actual bug
- The reconciled spec still describes an approach the code doesn't use
- Reconciling before the feature is actually verified as done

## Verification

Before considering the feature closed, confirm:

- [ ] All divergence sources (plan, todo, memory, code) were read
- [ ] The divergence list was presented and the human approved it
- [ ] Every touched spec.md describes the shipped system, not the intended one
- [ ] Open Questions and Success Criteria reflect final reality
- [ ] Any flagged (possible-bug) divergences were resolved, not buried
- [ ] `tasks/<work-slug>/` is deleted (only after the spec(s) are authoritative)

## See Also

`spec-driven-development` — this skill closes the loop that skill opens; its "Keeping the Spec Alive" section covers in-flight updates, this covers the final reconciliation.
