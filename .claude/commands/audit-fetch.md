---
description: Fetch and render a forensic audit log report for a given audit log ID
---

Fetch forensic audit log details for the given ID.

Usage: `audit-fetch <logId>`

Run this command to investigate a specific audit log entry with full forensic context:
- HTTP request/response envelope (redacted)
- DB queries executed during the request
- Build log tail
- Error stack trace
- Known resolutions (if any)
- Sibling events within ±5 minutes

## Steps

1. Run: `cd /home/nitin-sharma/ralph-studio/backend && npx tsx scripts/audit-fetch.ts $ARGUMENTS`
2. The script will output a markdown report. Read the report carefully.
3. Focus on:
   - The **Error Details** section for the root cause
   - The **Known Resolution** section (if present) — this means the issue is already understood
   - The **Sibling Events** section — related failures in the same time window
   - The **Log Tail** section — last bytes of the build log
   - The **DB Queries** section — what database operations were happening

If the auth token is missing, set `RALPH_TOKEN=<jwt>` or create `~/.ralph-token`.
