---
created_at: "2026-10-18T05:56:39.488019730+00:00"
id: "worldcrafter-sx94"
evidence_type: "validation"
commit: "9f6c8cc1947757f8070122973df2b7d02588621a"
result: "pass"
captured_at: "2026-10-18T05:56:39.487971761+00:00"
path: "/tmp/wc-validate/browser-cors.txt"
agent_identity: "validator"
target:
  kind: "issue"
  id: "worldcrafter-bg6v"
  role: "validates"
criteria:
- slug: "S4"
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
title: "S4 pass at the command level, with one limit for the writer (pins). generate.test.ts runs against a Bun stub OpenAI-compatible server (memory and fake-IndexedDB storage): the window plus the mentioned entity's card, the stored request revised by an edit, the stub receiving exactly the edited body, output in an ai_segment that holds only the output grammar, provenance (requestId, model, sampler, text, logprobs) in the annotations sidecar keyed by segment ID, regenerate sending the same request and archiving the old output, accept leaving plain blocks plus a snapshot. Independent probe (/tmp/wc-validate/probes/s4-pins.test.ts): pins:['tower'] for an entry the window never mentions gave cards [tower pinned, mara mentioned]; the pinned card was in the stored request and in the body the stub received; regenerate and accept worked after closing and reopening fake IndexedDB. Browser (built app over file://, real IndexedDB, a local Bun stub that sends CORS headers): Generate next showed the request slip, Send streamed into an AI segment, Regenerate replaced it, Accept left plain paragraphs, and all of it survived a reload. Demo: an edited user message was sent, and the segment's REQUEST view showed the edit and 'Edited from request <id>'. Limits: the workspace hardcodes pins: [] (app/generation.ts:255) and has no pin UI, so a writer can't pin anything; pins are shown only through the command API. Real llama.cpp and OpenRouter were not tested."
updated_at: "2026-10-18T05:56:39.488579144+00:00"
---

S4 pass at the command level, with one limit for the writer (pins). generate.test.ts runs against a Bun stub OpenAI-compatible server (memory and fake-IndexedDB storage): the window plus the mentioned entity's card, the stored request revised by an edit, the stub receiving exactly the edited body, output in an ai_segment that holds only the output grammar, provenance (requestId, model, sampler, text, logprobs) in the annotations sidecar keyed by segment ID, regenerate sending the same request and archiving the old output, accept leaving plain blocks plus a snapshot. Independent probe (/tmp/wc-validate/probes/s4-pins.test.ts): pins:['tower'] for an entry the window never mentions gave cards [tower pinned, mara mentioned]; the pinned card was in the stored request and in the body the stub received; regenerate and accept worked after closing and reopening fake IndexedDB. Browser (built app over file://, real IndexedDB, a local Bun stub that sends CORS headers): Generate next showed the request slip, Send streamed into an AI segment, Regenerate replaced it, Accept left plain paragraphs, and all of it survived a reload. Demo: an edited user message was sent, and the segment's REQUEST view showed the edit and 'Edited from request <id>'. Limits: the workspace hardcodes pins: [] (app/generation.ts:255) and has no pin UI, so a writer can't pin anything; pins are shown only through the command API. Real llama.cpp and OpenRouter were not tested.
