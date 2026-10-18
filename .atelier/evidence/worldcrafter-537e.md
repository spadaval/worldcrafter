---
created_at: "2026-10-18T06:42:29.375025234+00:00"
id: "worldcrafter-537e"
evidence_type: "test"
commit: "287a5dcaa546f2586cd30532c0f59aa51f3346a0"
result: "pass"
captured_at: "2026-10-18T06:42:10.614471926+00:00"
command: "bash -c 'cd /home/supadava/projects/worldcrafter/app && bun run check'"
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
title: "bash -c 'cd /home/supadava/projects/worldcrafter/app && bun run check'"
updated_at: "2026-10-18T06:42:29.375265192+00:00"
---

## Summary

bash -c 'cd /home/supadava/projects/worldcrafter/app && bun run check'

## Command

```console
bash -c 'cd /home/supadava/projects/worldcrafter/app && bun run check'
```

Exit status: 0

## Stdout

Bytes: 74
Truncated: no

```text
Checked 122 files in 115ms. No fixes applied.
bun test v1.4.3 (c6da4a4d3)
```

## Stderr

Bytes: 124
Truncated: no

```text
$ tsc --noEmit && biome check && bun test

 562 pass
 0 fail
 172510 expect() calls
Ran 562 tests across 35 files. [13.97s]
```

