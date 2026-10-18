---
created_at: "2026-10-18T05:56:39.478212899+00:00"
id: "worldcrafter-s30i"
evidence_type: "validation"
commit: "9f6c8cc1947757f8070122973df2b7d02588621a"
result: "pass"
captured_at: "2026-10-18T05:56:39.478165059+00:00"
path: "/tmp/wc-validate/s2-probe-output.txt"
agent_identity: "validator"
target:
  kind: "issue"
  id: "worldcrafter-bg6v"
  role: "validates"
criteria:
- slug: "S2"
  result: "pass"
criteria_mission: "worldcrafter-3otd"
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
title: "S2 pass. Repo tests (block-id.test.ts, document-editor.test.ts, document-session.test.ts) cover load/repair, split at start/mid/end/empty, merge by Backspace/Delete, paste of fragments/HTML/plain text/cross-document/cut, undo/redo, and save+reload through fake-indexeddb, all passing. Independent probe (/tmp/wc-validate/probes/s2-random.test.ts): 60 seeds x 40 random steps on the full createDocumentEditor plugin set (split, Backspace merge, Delete merge, copy-paste of a fragment, HTML paste with planted ids and h4/table, undo, redo, typing), then save to fake IndexedDB, close, reopen through openDocumentSession. After every step every block had a valid ID, no ID repeated, canonicalize+validateDocument passed, a split kept the ID on the upper block, a paste or a merge into a non-empty block kept every existing ID, and reload kept every ID: 0 violations. The probe's only ID losses were the documented ones: an empty block that is pasted into or merged away loses its ID, and a cut-then-paste gets a fresh ID (data-model-boundaries.md, decided 2026-10-17). In the browser (real Chrome IndexedDB over file://), typed blocks kept data-block-id across a page reload. Limits: paste is driven with synthetic DataTransfer (slate-react's DOM copy path isn't exercised headless); drag-to-move wasn't tested."
updated_at: "2026-10-18T05:56:39.478567360+00:00"
---

S2 pass. Repo tests (block-id.test.ts, document-editor.test.ts, document-session.test.ts) cover load/repair, split at start/mid/end/empty, merge by Backspace/Delete, paste of fragments/HTML/plain text/cross-document/cut, undo/redo, and save+reload through fake-indexeddb, all passing. Independent probe (/tmp/wc-validate/probes/s2-random.test.ts): 60 seeds x 40 random steps on the full createDocumentEditor plugin set (split, Backspace merge, Delete merge, copy-paste of a fragment, HTML paste with planted ids and h4/table, undo, redo, typing), then save to fake IndexedDB, close, reopen through openDocumentSession. After every step every block had a valid ID, no ID repeated, canonicalize+validateDocument passed, a split kept the ID on the upper block, a paste or a merge into a non-empty block kept every existing ID, and reload kept every ID: 0 violations. The probe's only ID losses were the documented ones: an empty block that is pasted into or merged away loses its ID, and a cut-then-paste gets a fresh ID (data-model-boundaries.md, decided 2026-10-17). In the browser (real Chrome IndexedDB over file://), typed blocks kept data-block-id across a page reload. Limits: paste is driven with synthetic DataTransfer (slate-react's DOM copy path isn't exercised headless); drag-to-move wasn't tested.
