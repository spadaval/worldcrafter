---
created_at: "2026-10-18T05:56:39.506629690+00:00"
id: "worldcrafter-4ep5"
evidence_type: "validation"
commit: "9f6c8cc1947757f8070122973df2b7d02588621a"
result: "fail"
captured_at: "2026-10-18T05:56:39.506574637+00:00"
path: "/tmp/wc-validate/s10-probe-output.txt"
agent_identity: "validator"
target:
  kind: "issue"
  id: "worldcrafter-bg6v"
  role: "validates"
criteria:
- slug: "S10"
  result: "fail"
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
title: "S10 fail on the time-dilation case; the flashback and paused cases pass. story.test.ts (memory and fake IndexedDB) gives holds/revealed/unrevealed/uncertain for a linear story, a flashback placed before s1 (sees prince, not king; the scene after it resumes the main line with a hint), an unrevealed secret, unordered and during-war uncertainty, and a contradiction that is rejected. Its paused-frame test checks only elapsed age, not which facts hold. Independent probe (/tmp/wc-validate/probes/s10-frames.test.ts). Paused frame (an entity following a frame with a rate-0 correspondence, a fact change at 'freed', a reveal at s3): holds and revealed are right at s1, s2 and s3, and age across the pause is 0. Dilation, first failure: frame fae (rate 10), sync point portal at world 1200 = fae 0, a fact change at an event positioned only at fae 5. At scene s3 (world 1255) the app reports 'queen.title uncertain: princess | queen' when the change is determinably before s3 (world 1200.5). Same with a correspondence rate 0.1 (launch world 1200 = ship 0, return world 1240, mutiny at ship 2): s3 is uncertain. Cause: defect in this change, a known gap. Rates are used only for elapsed time and don't order events (follow-up worldcrafter-itgc). To reproduce: cd app && bun test /tmp/wc-validate/probes/s10-frames.test.ts. Expected queen.title=queen at s3; actual uncertain. Limits: tested at the command level; no UI check of S10."
updated_at: "2026-10-18T05:56:39.506957802+00:00"
---

S10 fail on the time-dilation case; the flashback and paused cases pass. story.test.ts (memory and fake IndexedDB) gives holds/revealed/unrevealed/uncertain for a linear story, a flashback placed before s1 (sees prince, not king; the scene after it resumes the main line with a hint), an unrevealed secret, unordered and during-war uncertainty, and a contradiction that is rejected. Its paused-frame test checks only elapsed age, not which facts hold. Independent probe (/tmp/wc-validate/probes/s10-frames.test.ts). Paused frame (an entity following a frame with a rate-0 correspondence, a fact change at 'freed', a reveal at s3): holds and revealed are right at s1, s2 and s3, and age across the pause is 0. Dilation, first failure: frame fae (rate 10), sync point portal at world 1200 = fae 0, a fact change at an event positioned only at fae 5. At scene s3 (world 1255) the app reports 'queen.title uncertain: princess | queen' when the change is determinably before s3 (world 1200.5). Same with a correspondence rate 0.1 (launch world 1200 = ship 0, return world 1240, mutiny at ship 2): s3 is uncertain. Cause: defect in this change, a known gap. Rates are used only for elapsed time and don't order events (follow-up worldcrafter-itgc). To reproduce: cd app && bun test /tmp/wc-validate/probes/s10-frames.test.ts. Expected queen.title=queen at s3; actual uncertain. Limits: tested at the command level; no UI check of S10.
