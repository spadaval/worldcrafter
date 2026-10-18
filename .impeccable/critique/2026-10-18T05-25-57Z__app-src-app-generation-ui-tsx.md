---
target: generation in the writing workspace
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/home/supadava/projects/worldcrafter-wt-2tz9/app/src/app/generation-ui.tsx"
target_fingerprint: "sha256:5849752180d5595bc10a2b523d84db5c785498ab75f309aec9e6b6a9bd6f08be"
target_path: /home/supadava/projects/worldcrafter-wt-2tz9/app/src/app/generation-ui.tsx
timestamp: 2026-10-18T05-25-57Z
slug: app-src-app-generation-ui-tsx
---
Method: dual-agent (A: design review sub-agent · B: detector sub-agent)

Target: generation in the writing workspace (request slip, plate controls, model settings), round 1 screenshots /tmp/wc-shots/r1.

Heuristics (A): 1 Visibility 3 · 2 Match 3 · 3 Control 3 · 4 Consistency 3 · 5 Error prevention 2 · 6 Recognition 3 · 7 Flexibility 2 · 8 Minimalist 2 · 9 Recovery 3 · 10 Help 3 = 27/40 (Acceptable, upper).

Specificity: authored for the product; the plate and caption actions extend the system; vermilion stays on AI text; the slip is apparatus-only.

Deterministic scan (B): 0 findings on the 8 changed TSX files, styles.css and three rendered URLs; overlay skipped (no injectable browser).

Priority issues and disposition:
- [P1] Slip opened fully expanded (three boxed textareas, ~1050px), burying Send and the prose. FIXED: each part folds to a line with its size (details), opened on demand.
- [P1] Opening the slip lost the writer's place; focus on an off-screen Send. FIXED: compact slip; Send focused only when visible, else the slip.
- [P2] Request could go stale silently. FIXED: "The text has changed since this request was put together" with "Put it together again" (same block).
- [P2] Renaming the profile breaks Regenerate. FIXED (mitigated): rename explained on Save, second Save renames; hint reworded.
- [P2] Completion silent for screen readers; focus lost on auto-close. FIXED: visually hidden status announcement; focus returns to the text.
- [P3] Masthead Context/Generate next on /model. FIXED: hidden off documents.
- B a11y: settings hints not linked. FIXED (aria-describedby). Disabled caption actions gave no reason. FIXED (title).

Accepted / deferred: no keyboard shortcuts for generate/send/stop/accept; no card pin/exclude in the slip (pins are hard-coded empty); writer's [[ notes ]] are sent in the story window (builder behaviour); vermilion pulse to 55% and hairline field borders are system rules in DESIGN.md.
