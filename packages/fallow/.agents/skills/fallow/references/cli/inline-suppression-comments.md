# Inline Suppression Comments

| Comment | Effect |
|---------|--------|
| `// fallow-ignore-next-line` | Suppress any issue on the next line |
| `// fallow-ignore-next-line unused-export` | Suppress specific issue type |
| `// fallow-ignore-file` | Suppress all issues in a file |
| `// fallow-ignore-file unused-export` | Suppress specific issue type file-wide |

### Valid Issue Type Tokens

`unused-file`, `unused-export`, `unused-type`, `unused-dependency`, `unused-dev-dependency`, `unused-enum-member`, `unused-class-member`, `unused-store-member`, `unresolved-import`, `unlisted-dependency`, `duplicate-export`, `circular-dependency`, `re-export-cycle`, `boundary-violation`, `policy-violation`, `unused-optional-dependency`, `type-only-dependency`, `test-only-dependency`, `code-duplication`
