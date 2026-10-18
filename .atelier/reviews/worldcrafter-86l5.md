---
schema: atelier.review
schema_version: 1
id: worldcrafter-86l5
title: 'Duplicate exported type names across slices: Provenance in app/src/world/facts.ts:24 (model: string, requestId, sourceBlockId) and app/src/generate/provenance.ts:41 (model: string | null, versioned, etc.); JsonValue defined identically in app/src/llm/types.ts:1 and app/src/storage/types.ts:8. Not a bug today: the facts Provenance is not written by any code yet, and the two JsonValue types are structurally identical. Recommend NO ACTION now; reconcile the inferred-fact provenance with generate/provenance.ts (or rename one) when discovery/bookkeeping first writes inferred facts.'
target: worldcrafter-mqrq
identity: integration-reviewer
commit: 2a7a71e983c53b8f3837d972cb1932cc254efd20
created_at: 2026-10-18T06:47:10.394734614Z
event:
  event: finding
  recommendation: no_action
---

Duplicate exported type names across slices: Provenance in app/src/world/facts.ts:24 (model: string, requestId, sourceBlockId) and app/src/generate/provenance.ts:41 (model: string | null, versioned, etc.); JsonValue defined identically in app/src/llm/types.ts:1 and app/src/storage/types.ts:8. Not a bug today: the facts Provenance is not written by any code yet, and the two JsonValue types are structurally identical. Recommend NO ACTION now; reconcile the inferred-fact provenance with generate/provenance.ts (or rename one) when discovery/bookkeeping first writes inferred facts.
