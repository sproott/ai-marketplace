---
description: Comment sparingly in every language — skip the obvious and the historical, explain only genuinely non-obvious intent.
---

# Comment style

Comment sparingly, in every language. Two failure modes to avoid:

- **Restating the code.** If a comment just re-says what the line, name, or value already
  makes plain, delete it.
- **Narrating history.** How the solution evolved, what was tried before, why one approach
  won over another — that lives in git history and commit messages, not the source.

Comment only genuinely non-obvious intent. When something does need explaining, say as much
as it takes — no arbitrary length cap. When nothing is non-obvious, write nothing.
