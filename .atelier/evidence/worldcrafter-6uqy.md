---
created_at: "2026-10-18T05:56:11.711422484+00:00"
id: "worldcrafter-6uqy"
evidence_type: "validation"
commit: "9f6c8cc1947757f8070122973df2b7d02588621a"
result: "pass"
captured_at: "2026-10-18T05:56:11.711353395+00:00"
path: "/tmp/wc-validate/probes/s1-fuzz.test.ts"
agent_identity: "validator"
target:
  kind: "issue"
  id: "worldcrafter-bg6v"
  role: "validates"
criteria:
- slug: "S1"
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
title: "S1 pass. bun run check: 545 pass/0 fail, no skip/todo/only (/tmp/wc-validate/check.txt). The schema allows p (and disc/decimal list items), h1-h3, blockquote, hr, links, the 4 marks, ai_segment (both statuses) and placeholder, and markdown.test.ts has a fixture with every one of them that round-trips exactly, plus 500 seeded random trees. Independent probe: 5000 trees from other seeds plus 3000 mutated with a wider alphabet ({#id}, ':::', NUL/ESC, VT/FF, NBSP, BOM, lone surrogates, emoji, newline+#/-/>/---): parse(export(t)) deep-equals t for all 8000, 0 failures. Re-parse path: parseMarkdown has no non-test caller at all (there is no import feature yet), and the only text-to-tree path at runtime is parseGeneratedText/GeneratedTextStream in generate/generator.ts, which builds AI-segment content, as the strategy allows. Limits: exportMarkdown also has no app caller, so export is shown only at library level; the call-path search is a grep of src, not a runtime trace."
updated_at: "2026-10-18T05:56:11.712507018+00:00"
---

S1 pass. bun run check: 545 pass/0 fail, no skip/todo/only (/tmp/wc-validate/check.txt). The schema allows p (and disc/decimal list items), h1-h3, blockquote, hr, links, the 4 marks, ai_segment (both statuses) and placeholder, and markdown.test.ts has a fixture with every one of them that round-trips exactly, plus 500 seeded random trees. Independent probe: 5000 trees from other seeds plus 3000 mutated with a wider alphabet ({#id}, ':::', NUL/ESC, VT/FF, NBSP, BOM, lone surrogates, emoji, newline+#/-/>/---): parse(export(t)) deep-equals t for all 8000, 0 failures. Re-parse path: parseMarkdown has no non-test caller at all (there is no import feature yet), and the only text-to-tree path at runtime is parseGeneratedText/GeneratedTextStream in generate/generator.ts, which builds AI-segment content, as the strategy allows. Limits: exportMarkdown also has no app caller, so export is shown only at library level; the call-path search is a grep of src, not a runtime trace.
