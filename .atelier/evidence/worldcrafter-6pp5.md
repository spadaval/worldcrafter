---
created_at: "2026-10-18T05:57:03.734067226+00:00"
id: "worldcrafter-6pp5"
evidence_type: "test"
commit: "9f6c8cc1947757f8070122973df2b7d02588621a"
result: "pass"
captured_at: "2026-10-18T05:56:44.532935370+00:00"
command: "bun run check"
exit_status: "0"
agent_identity: "validator"
target:
  kind: "issue"
  id: "worldcrafter-bg6v"
  role: "validates"
relationships:
  blocks: []
  children: []
  attachments:
  - kind: "issue"
    id: "worldcrafter-bg6v"
    role: "validates"
  relates: []
schema: "atelier.evidence"
schema_version: 2
status: "recorded"
title: "Fresh full check of app/: tsc, biome and bun test (545 tests, 0 fail, none skipped)"
updated_at: "2026-10-18T05:57:03.734436746+00:00"
---

## Summary

Fresh full check of app/: tsc, biome and bun test (545 tests, 0 fail, none skipped)

## Command

```console
bun run check
```

Exit status: 0

## Stdout

Bytes: 73
Truncated: no

```text
Checked 121 files in 88ms. No fixes applied.
bun test v1.4.3 (c6da4a4d3)
```

## Stderr

Bytes: 124
Truncated: no

```text
$ tsc --noEmit && biome check && bun test

 545 pass
 0 fail
 163449 expect() calls
Ran 545 tests across 34 files. [14.38s]
```

