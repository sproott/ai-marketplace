# `hooks`: Managed Hook Status And Installation

```bash
fallow hooks status --format json
fallow hooks install --target git
fallow hooks install --target agent
fallow hooks uninstall --target git
fallow hooks uninstall --target agent
```

`hooks status` is read-only and reports `git`, `claude`, and `codex` surfaces. Each surface includes `installed`, `managed_block_present`, `user_edited`, and `path`; generated agent scripts also include `script_version` and `min_version_floor`. Use it before mutating setup so agents can distinguish fallow-managed artifacts from user-owned hooks or partial managed blocks.

---
