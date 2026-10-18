---
created_at: "2026-10-18T06:42:37.410420645+00:00"
id: "worldcrafter-wu90"
evidence_type: "validation"
commit: "287a5dcaa546f2586cd30532c0f59aa51f3346a0"
result: "pass"
captured_at: "2026-10-18T06:42:37.410350464+00:00"
path: "/tmp/wc-validate/s10b/report.json"
agent_identity: "validator"
target:
  kind: "issue"
  id: "worldcrafter-bg6v"
  role: "validates"
criteria:
- slug: "S10"
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
title: "S10 pass at HEAD 287a5dc (supersedes the 4ep5 fail). Fresh bun run check: 562 pass/0 fail (receipt worldcrafter-537e); story.test.ts and s10-frames.test.ts cover a flashback, a paused frame and dilation through the stores. Re-ran 4ep5's probe (/tmp/wc-validate/probes/s10-frames.test.ts): rate-10 Fae and rate-0.1 voyage now give queen at s3 and princess at s1, not uncertain; stasis age 5. Own probes (/tmp/wc-validate/s10b/s10b-fixture.test.ts, s10b-edges.test.ts; report.json, edges.json), 18-scene fixture with 2 placed flashbacks, a default scene after a flashback (gets its hint), a stasis frame (born 1070, sealed 1100, freed 1200), changes during the pause (1140) and after it on her own clock (her year 32 = 1202, 30.5 = 1200.5), a scene inside the pause at 1150 and one dated only at her year 30, rate-10 Fae, a rate-0.1 voyage correspondence and the usual rate after it, a frame-level rate of 0.1, an unknown-rate frame, and an unordered omen. Every holds/absent result matched the hand-computed truth on both sides of each boundary (e.g. 1302 page / 1303 knight; 1419 loyal / 1421 mutineer; 1440.5 deckhand / 1441.5 bosun; 1201 no skill / 1203 swordswoman). Revealed/unrevealed split by narrative order was right, including a flashback that sees later reveals in revealedBefore but its own earlier value as unrevealed, and a scene's own reveal not counting. The omen, the unknown-rate vision and the pause-dated dream stayed uncertain. Ages: 29/30/31/80 years on her clock vs 180 world; Fae envoy 30; sailor 2.1 and 5.5. A contradicting constraint was rejected. Limits: exactly on a boundary, the documented 1e-9 rounding margin leaves a few results uncertain where the true answer is fixed (a flashback placed only 'before sealed' gets mood uncertain from a dream at her year 30 = [1100,1200]; a scene dated only at her year 30 gets title uncertain against freed at 1200). These are conservative, not wrong. Only the engine and store APIs were checked, not the UI or generation prompt."
updated_at: "2026-10-18T06:42:37.410958107+00:00"
---

S10 pass at HEAD 287a5dc (supersedes the 4ep5 fail). Fresh bun run check: 562 pass/0 fail (receipt worldcrafter-537e); story.test.ts and s10-frames.test.ts cover a flashback, a paused frame and dilation through the stores. Re-ran 4ep5's probe (/tmp/wc-validate/probes/s10-frames.test.ts): rate-10 Fae and rate-0.1 voyage now give queen at s3 and princess at s1, not uncertain; stasis age 5. Own probes (/tmp/wc-validate/s10b/s10b-fixture.test.ts, s10b-edges.test.ts; report.json, edges.json), 18-scene fixture with 2 placed flashbacks, a default scene after a flashback (gets its hint), a stasis frame (born 1070, sealed 1100, freed 1200), changes during the pause (1140) and after it on her own clock (her year 32 = 1202, 30.5 = 1200.5), a scene inside the pause at 1150 and one dated only at her year 30, rate-10 Fae, a rate-0.1 voyage correspondence and the usual rate after it, a frame-level rate of 0.1, an unknown-rate frame, and an unordered omen. Every holds/absent result matched the hand-computed truth on both sides of each boundary (e.g. 1302 page / 1303 knight; 1419 loyal / 1421 mutineer; 1440.5 deckhand / 1441.5 bosun; 1201 no skill / 1203 swordswoman). Revealed/unrevealed split by narrative order was right, including a flashback that sees later reveals in revealedBefore but its own earlier value as unrevealed, and a scene's own reveal not counting. The omen, the unknown-rate vision and the pause-dated dream stayed uncertain. Ages: 29/30/31/80 years on her clock vs 180 world; Fae envoy 30; sailor 2.1 and 5.5. A contradicting constraint was rejected. Limits: exactly on a boundary, the documented 1e-9 rounding margin leaves a few results uncertain where the true answer is fixed (a flashback placed only 'before sealed' gets mood uncertain from a dream at her year 30 = [1100,1200]; a scene dated only at her year 30 gets title uncertain against freed at 1200). These are conservative, not wrong. Only the engine and store APIs were checked, not the UI or generation prompt.
