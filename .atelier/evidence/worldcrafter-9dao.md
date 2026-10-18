---
created_at: "2026-10-18T05:56:39.515041388+00:00"
id: "worldcrafter-9dao"
evidence_type: "validation"
commit: "9f6c8cc1947757f8070122973df2b7d02588621a"
result: "blocked"
captured_at: "2026-10-18T05:56:39.514998568+00:00"
path: "/tmp/wc-validate/browser-nocors.txt"
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
title: "CORS check against real llama.cpp and OpenRouter from the browser: blocked. No llama.cpp server runs on this machine and there's no OpenRouter key. Stand-in done without secrets: the built app over file:// in headless Chrome sends Origin: file:// and a preflight OPTIONS (content-type). Against a local stub with no CORS headers, Chrome blocked it (PreflightMissingAllowOriginHeader), and the app said 'Generation failed: Request to http://localhost:18432/v1/chat/completions failed: Failed to fetch. Is the server running, and does it accept requests from this page (CORS)?'. Against a stub sending Access-Control-Allow-Origin: * and answering the preflight, generation streamed. Not shown: whether real llama.cpp's and OpenRouter's CORS responses accept a file:// or hosted origin."
updated_at: "2026-10-18T05:56:39.515317503+00:00"
---

CORS check against real llama.cpp and OpenRouter from the browser: blocked. No llama.cpp server runs on this machine and there's no OpenRouter key. Stand-in done without secrets: the built app over file:// in headless Chrome sends Origin: file:// and a preflight OPTIONS (content-type). Against a local stub with no CORS headers, Chrome blocked it (PreflightMissingAllowOriginHeader), and the app said 'Generation failed: Request to http://localhost:18432/v1/chat/completions failed: Failed to fetch. Is the server running, and does it accept requests from this page (CORS)?'. Against a stub sending Access-Control-Allow-Origin: * and answering the preflight, generation streamed. Not shown: whether real llama.cpp's and OpenRouter's CORS responses accept a file:// or hosted origin.
