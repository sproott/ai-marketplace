---
description: Keep each variant self-contained in one definition; shared code stays variant-agnostic
---

# Variant definitions

Code often handles several variants of one kind, such as packages, providers, targets, or formats. Give each variant one self-contained definition. To add a variant, write a new definition and register it in one place.

- Put everything specific to a variant in its definition: its behaviour, configuration, and strategy choices. Put a comment that explains an unusual choice in that definition.
- Shared code must not name variants. Do not branch on a variant's identity (`if (name === 'x')`, ternaries, `switch` on names). Express each difference as data in the definition, such as a tagged strategy value. Shared code interprets that data by matching on the strategy tag.
- Keep one registry of variants. Derive everything else from it, including CLI choices, dispatch, iteration order, and lookups. Where the language permits, make a missing definition a compile error, for example with an exhaustive record or match.
- Put each convention that all variants share, such as a path pattern or naming rule, in one helper. Do not repeat it in each definition.
- Tests derive variant lists and expected behaviour from the registry. When one variant needs its own fixture data, key that data by the variant. Tests that exercise one strategy can name a variant that uses it.
- A variant that fits in one module is one file. A variant that needs several modules is a folder, with `index.ts` (or the language's equivalent) as its entry point.
- Give each module one responsibility. A command runs its steps in order and calls one module per step. Organise folders by role: variant definitions and their registry together, each command with its private helpers, and shared plumbing separately.
