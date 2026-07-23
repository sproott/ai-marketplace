---
description: Comment sparingly in every language — skip the obvious and the historical, explain only genuinely non-obvious intent.
---

# Comment style

Comment sparingly, in every language. Comment only genuinely non-obvious *intent* —
the thing the code can't say about itself. When nothing is non-obvious, write nothing.
No length cap when explanation is genuinely needed.

## Before writing any comment, cut every clause that does any of these

Cut the offending clause, not the whole comment — keep the non-obvious-intent core if one
survives. Delete the comment only when nothing is left after the cuts.

- **Restates the code.** Re-says what the line, name, or value already makes plain —
  including a doc comment that paraphrases the name and parameter list
  (`/// Gets the user by id.` on `getUserById`). "It's a doc comment" is not an exemption:
  a doc that adds nothing to the signature is omitted, not written.
- **Describes a line it doesn't sit on.** "handled in X", "callers do Y", "redundant with
  Z" — the clause's subject is other code, so nothing forces an update when that code
  changes; it goes stale silently. State the fact on the line it's about, or in project
  docs if no single line owns it.
- **States what's already proven next to it.** The compiler checks it (exhaustive match,
  type constraint) or adjacent code demonstrates it (the property a neighbouring case
  already exercises), or it's a general rule pasted onto a section label where nothing
  enforces it. When the proof lives in the code, the prose only adds drift risk — it
  belongs nowhere.
- **Narrates a rejected path.** Contains "rather than", "instead of", "we stop at … which
  would", "not X but Y", or otherwise explains what the code *doesn't* do. The chosen path
  is in the code; the rejected one belongs in a commit message, not the source.
- **Narrates history.** How it evolved, what was tried before, "previously", "used to",
  "no longer". That lives in git history.
- **Carries a measurement or benchmark.** Sizes, timings, percentages ("~30 MB rather than
  ~110 MB", "2x faster"). Facts about a past run, not intent.
- **Editorializes the choice.** "cleaner", "simpler", "the right way", "better" — justifying
  the decision instead of stating what the code is for.

## What survives

A comment that answers "why would someone reading this line be confused / delete it / get it
wrong?" — the load-bearing constraint, the non-obvious dependency, the reason a plain-looking
step is actually required. In docs, the contract facts the signature can't carry: units,
invariants, preconditions, side effects, raised errors. State it flatly, present tense,
about the code as it is.

