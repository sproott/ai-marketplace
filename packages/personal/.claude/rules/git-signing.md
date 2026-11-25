# Git & SSH signing

The user's git signing SSH key lives in KeePass and is only usable while that database is
unlocked. It is not always open.

So any git operation that signs — `git commit`, `git tag -s`, resigning rebases, amends —
can fail with a signing error (e.g. `error: gpg failed to sign the data`,
`Load key ... agent refused operation`) simply because KeePass is closed.

When that happens:

- **Do not** retry blindly, disable signing (`--no-gpg-sign`, `commit.gpgsign=false`),
  switch keys, or otherwise work around it.
- **Tell the user** signing failed and KeePass likely needs unlocking.
- Wait, then rerun the same command unchanged.

The failure is environmental — not a problem with the commit, config, or key.
