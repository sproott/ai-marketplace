# Comment style

Comment sparingly, in every language. Comment only genuinely non-obvious *intent* —
the thing the code can't say about itself. When nothing is non-obvious, write nothing.
No length cap when explanation is genuinely needed.

## Before writing any comment, cut every clause that does any of these

Cut the offending clause, not the whole comment — keep the non-obvious-intent core if one
survives. Delete the comment only when nothing is left after the cuts.

- **Restates the code.** Re-says what the line, name, or value already makes plain.
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
step is actually required. State it flatly, present tense, about the code as it is.

