---
description: Reject upstream changes that invalidate a package builder's transformations
applyTo: "{scripts/cli/src/packages,scripts/cli/tests}/**/*.ts"
---

# Upstream builder contracts

Validate the assumptions each transformation relies on before writing its output. Accept changes to unrelated fields and to content the builder copies unchanged.

- For structured input, check the required keys, value types, and number of entries the transform expects. If it needs one MCP server, reject zero or multiple servers. If it replaces a nonempty YAML description, accept any scalar style that decodes to a nonempty string; the original wording is irrelevant.
- For text rewrites, check the expected wording and match count. If a launcher line must occur once, reject both a missing match and a duplicate. Do not skip a required rewrite, guess a replacement, or silently use the first match.
- On mismatch, return a tagged error with typed fields for the file, failed assumption, and observed value or count. Group reasons by source. Give each source one `.format()` that matches its reason tag and names the builder. Match error tags at the command handler boundary; call `.format()` there, once.
- Test the builder’s response to upstream changes with minimal fixtures. Break each required assumption and assert the error tag and relevant fields. Assert message text only in tests of `.format()` or CLI error rendering. Cover missing and duplicate matches for a unique text anchor. For copied content, vary the fixture and assert that the builder preserves the bytes.
- Do not assert the current contents, wording, or file counts of a vendored checkout in CLI tests. Use `just build` and check for generated package drift to verify the pinned upstream inputs end to end.
