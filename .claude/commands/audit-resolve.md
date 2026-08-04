---
description: Record or update a known resolution for a recurring audit log error fingerprint
---

Record a known fix for a recurring error so it surfaces automatically in future forensic reports.

Usage:
  `audit-resolve <fingerprint> --root-cause "..." --fix "..." [--pr-link "..."] [--commit "..."]`
  `audit-resolve <fingerprint> --deactivate`

## Steps

1. First identify the fingerprint using `/audit-fetch <logId>` — it's shown in the Error Details section.
2. Run: `cd /home/nitin-sharma/ralph-studio/backend && npx tsx scripts/audit-resolve.ts $ARGUMENTS`
3. After recording, the next occurrence of this fingerprint will show the resolution in the forensic briefing.

## When to use

- After debugging a recurring error and finding its root cause
- After merging a fix PR — record the commit SHA so the briefing links to the fix
- To deactivate a stale resolution: `audit-resolve <fingerprint> --deactivate`
