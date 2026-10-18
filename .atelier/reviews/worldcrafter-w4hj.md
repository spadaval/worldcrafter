---
schema: atelier.review
schema_version: 1
id: worldcrafter-w4hj
title: 'AGENTS.md Architecture section (State: @legendapp/state; Tech Stack: Tanstack Start + trpc; Editor: /src/components/editor) contradicts app/: no Legend State (dropped per docs/strategies/rebuild.md last_changed 2026-10-17), Vite + TanStack Router browser-only, editor in app/src/editor. The ''rebuild docs win'' disclaimer and the new app/ line mitigate it, but an agent working in app/ could still reach for Legend State. Also the app/ line names install/check but not ''bun run build''. Recommend DEFER to worldcrafter-2x5z (retire the old app), rewriting AGENTS.md for app/ then; sooner if agents start misreading it.'
target: worldcrafter-mqrq
identity: integration-reviewer
commit: 2a7a71e983c53b8f3837d972cb1932cc254efd20
created_at: 2026-10-18T06:47:10.367738843Z
event:
  event: finding
  recommendation: defer
---

AGENTS.md Architecture section (State: @legendapp/state; Tech Stack: Tanstack Start + trpc; Editor: /src/components/editor) contradicts app/: no Legend State (dropped per docs/strategies/rebuild.md last_changed 2026-10-17), Vite + TanStack Router browser-only, editor in app/src/editor. The 'rebuild docs win' disclaimer and the new app/ line mitigate it, but an agent working in app/ could still reach for Legend State. Also the app/ line names install/check but not 'bun run build'. Recommend DEFER to worldcrafter-2x5z (retire the old app), rewriting AGENTS.md for app/ then; sooner if agents start misreading it.
