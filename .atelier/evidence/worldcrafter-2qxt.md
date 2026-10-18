---
created_at: "2026-10-18T05:56:39.497629935+00:00"
id: "worldcrafter-2qxt"
evidence_type: "validation"
commit: "9f6c8cc1947757f8070122973df2b7d02588621a"
result: "pass"
captured_at: "2026-10-18T05:56:39.497580653+00:00"
path: "/tmp/wc-validate/s9-boundary-negative.txt"
agent_identity: "validator"
target:
  kind: "issue"
  id: "worldcrafter-bg6v"
  role: "validates"
criteria:
- slug: "S9"
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
title: "S9 pass. StorageAdapter (storage/types.ts) is implemented by memory.ts and indexeddb.ts, and describeStorageContract runs against both (fake-indexeddb for IndexedDB): CRUD, ordering, isolation, snapshots, atomic batch, closed-store errors, all passing. main.tsx opens world storage only through openIndexedDbStorage. Search: grep over app/src for indexedDB/IDB*/idb/dexie outside src/storage hits only tests (fake-indexeddb). Negative control: a planted src/zz-validator-probe.ts using globalThis.indexedDB and IDBRequest made storage-boundary.test.ts fail, naming the file (the file was then deleted). Biome's noRestrictedGlobals catches only the bare global, not globalThis.indexedDB. In the browser, real Chrome IndexedDB persisted a document and its block IDs across a reload. Limits: tabs and backend profiles (base URL, API key, model) go to localStorage through a KeyValueStore, outside the adapter. That is documented as browser config, not world data (data-model-boundaries.md), and it isn't IndexedDB, so it doesn't break the claim as written. Access built from strings (e.g. self['indexed'+'DB']) would get past the search."
updated_at: "2026-10-18T05:56:39.497982032+00:00"
---

S9 pass. StorageAdapter (storage/types.ts) is implemented by memory.ts and indexeddb.ts, and describeStorageContract runs against both (fake-indexeddb for IndexedDB): CRUD, ordering, isolation, snapshots, atomic batch, closed-store errors, all passing. main.tsx opens world storage only through openIndexedDbStorage. Search: grep over app/src for indexedDB/IDB*/idb/dexie outside src/storage hits only tests (fake-indexeddb). Negative control: a planted src/zz-validator-probe.ts using globalThis.indexedDB and IDBRequest made storage-boundary.test.ts fail, naming the file (the file was then deleted). Biome's noRestrictedGlobals catches only the bare global, not globalThis.indexedDB. In the browser, real Chrome IndexedDB persisted a document and its block IDs across a reload. Limits: tabs and backend profiles (base URL, API key, model) go to localStorage through a KeyValueStore, outside the adapter. That is documented as browser config, not world data (data-model-boundaries.md), and it isn't IndexedDB, so it doesn't break the claim as written. Access built from strings (e.g. self['indexed'+'DB']) would get past the search.
