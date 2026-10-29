---
created_at: "2026-10-29T22:22:09.827789464+00:00"
id: "worldcrafter-4t98"
issue_type: "task"
labels:
- "storage"
priority: "P1"
relationships:
  blocks: []
  children: []
  attachments: []
  relates:
  - kind: "issue"
    id: "worldcrafter-3otd"
    type: "advances"
schema: "atelier.issue"
schema_version: 2
status: "todo"
title: "Sync-ready storage: tombstones for deletes"
updated_at: "2026-10-29T22:22:09.827789464+00:00"
---

## Goal

Make every synced collection ready for a later sync backend (S9, decision worldcrafter-gcox): deleting a record leaves a tombstone instead of removing it, so another device can learn of the delete. New story collections (worldcrafter-z9qs) are built on this, so it comes first.

## Done when

- The storage contract test (`app/src/storage/contract.ts`), run against both the memory and IndexedDB adapters, shows for every keyed collection: `delete` leaves a tombstone with `deletedAt`; `load` of a tombstoned key fails with `not_found`; `list` omits tombstones; `save` after a delete brings the record back.
- A contract test asserts every stored record type has a string `id` (or key) and an `updatedAt`, except the documented exemptions below.
- `bun run check` passes in `app/`. Evidence recorded against S9.

## Scope

- `app/src/storage/` (types, memory and IndexedDB adapters, contract tests), plus an IndexedDB version upgrade that keeps existing data.
- A way to list tombstones (with `deletedAt`) for a future sync adapter. No sync code.
- Exempt, and documented as device-local in `types.ts`: snapshots (auto-increment IDs, append-only local history) and stored requests (immutable, `createdAt` only).
- Callers keep their current behaviour: nothing outside `storage/` should need to change.

## Context

- `StorageAdapter`, `Collection<T>` and record types: `app/src/storage/types.ts`.
- S9 in `docs/strategies/rebuild.md`; it was proven before the sync-ready wording was added, so it needs fresh evidence.
