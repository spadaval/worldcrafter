---
name: WorldCrafter
description: Night Edition. The manuscript is the page and the world is its apparatus.
colors:
  ground: "#14120f"
  rail: "#110f0d"
  raised: "#221e18"
  ink: "#e6dfcf"
  ink-2: "#b3aa98"
  ink-3: "#9a917f"
  rule: "#2f2a23"
  rule-strong: "#4a4237"
  ai: "#e34b2f"
  time: "#8da2f0"
  time-band: "rgb(141 162 240 / 0.28)"
  subtext: "#e8b923"
  say-0: "#7cc4b5"
  say-1: "#e7a59b"
  say-2: "#c4a8e0"
  say-3: "#b4c98c"
  say-4: "#d9a67e"
typography:
  display:
    fontFamily: "Old Standard TT, Iowan Old Style, Georgia, serif"
    fontSize: "32px"
    fontWeight: 400
    lineHeight: 1.25
  headline:
    fontFamily: "Old Standard TT, Iowan Old Style, Georgia, serif"
    fontSize: "30px"
    fontWeight: 400
    lineHeight: 1.25
  title:
    fontFamily: "Old Standard TT, Iowan Old Style, Georgia, serif"
    fontSize: "21px"
    fontWeight: 400
    lineHeight: 1.25
  body:
    fontFamily: "Old Standard TT, Iowan Old Style, Georgia, serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: 1.62
  stamp:
    fontFamily: "Old Standard TT, Iowan Old Style, Georgia, serif"
    fontSize: "14px"
    fontWeight: 400
    letterSpacing: "0.06em"
  apparatus:
    fontFamily: "Source Sans 3, Source Sans Pro, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
  gloss:
    fontFamily: "Source Sans 3, Source Sans Pro, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Source Sans 3, Source Sans Pro, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.1em"
  key:
    fontFamily: "Source Sans 3, Source Sans Pro, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1
rounded:
  control: "5px"
  small: "4px"
spacing:
  rail-width: "300px"
  header-height: "56px"
  margin-width: "96px"
  prose-width: "620px"
  gutter-width: "40px"
  gloss-width: "340px"
  rail-inset: "20px"
  paragraph: "20px"
  note-gap: "14px"
components:
  button:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "7px 14px"
    typography: "{typography.apparatus}"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    rounded: "{rounded.control}"
    padding: "7px 14px"
  button-primary-hover:
    backgroundColor: "#f3eee2"
    textColor: "{colors.ground}"
  layer-toggle:
    textColor: "{colors.ink-3}"
    padding: "6px 10px"
  layer-toggle-on:
    backgroundColor: "#2b261f"
    textColor: "{colors.ink}"
  view-switch-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    padding: "6px 8px"
  title-field:
    textColor: "{colors.ink}"
    typography: "{typography.display}"
  ai-segment-plate:
    textColor: "{colors.ink}"
    padding: "12px 16px"
  ai-segment-caption:
    textColor: "{colors.ai}"
    typography: "{typography.label}"
  gloss-note:
    textColor: "{colors.ink-2}"
    typography: "{typography.gloss}"
  scene-row:
    textColor: "{colors.ink-2}"
    height: "32px"
    padding: "0 92px 0 20px"
  notice-error:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    padding: "8px 32px"
---

# Design System: WorldCrafter

## Overview

**Creative North Star: "The Night Edition"**

A late-printed edition of the writer's own manuscript, read by lamplight. The page is a warm near-black ground with bone ink in three steps and hairline rules; the prose sits in a single serif column at book measure, and everything the world knows about it (who speaks, when it is, what is implied, which names are canon) is set around it as apparatus: margin cues to the left, a lettered gloss to the right, marks painted behind the words. The prose is the stage; the apparatus is quiet, small, sans-serif, and attached to the words it is about.

Density is that of an annotated edition, not a dashboard. Chrome is a rail, a masthead and hairlines; there are no panels, no cards around notes, and no chat surface. AI work is always visible and signed but never loud: the one saturated warm colour in the system belongs to AI-made text and nothing else.

Layers are paint, not layout. Every mark is in the DOM all the time; turning a layer on changes only colour, background size and opacity, so the prose never moves (measured 0 px of movement, click to paint within 34 ms in the shipped build). Motion follows the same grammar: marks fade, underlines draw left to right, nothing slides or bounces.

**Key Characteristics:**
- Warm near-black ground, bone ink in three steps, 1px hairline rules for all structure.
- Old Standard TT for the writer's words and the page's stamps; Source Sans 3 for every piece of apparatus.
- Vermilion reserved for the double-ruled AI segment plate.
- Each layer hue does one job: speaker tints, time blue, subtext gold.
- Gloss notes are lettered keys on gutter ticks, never cards.
- Paint-only layers: colour, background size and opacity; never box geometry.
- Fade 140 ms, draw 150 ms, one expo-out ease; reduced motion zeroes both.

## Colors

A dark, warm, low-chroma ground and ink, with four saturated hues each bound to exactly one meaning.

### Primary
- **Bone Ink** (`ink`): the writer's prose, document titles, the active scene and tab, the primary button's fill and the selected view switch. The brightest neutral and the only one used as a fill for action.

### Secondary
- **Night-Edition Vermilion** (`ai`): AI-made text only. It draws the double ruling of the AI segment plate and colours its caption. Nowhere else.

### Tertiary
- **Almanac Blue** (`time`): story time. The chronology spark in the rail, scene years, the "inferred" mark on the story-time stamp, the time key letters and time note heads, and the Time toggle's underline. Its translucent form (`time-band`) is the lower-half highlight behind time expressions.
- **Subtext Gold** (`subtext`): implication and reveal. The dotted underline beneath implied passages, subtext keys and note heads, and the Subtext toggle's underline.
- **Speaker Tints** (`say-0` Sea Glass, `say-1` Rose Clay, `say-2` Lilac Ash, `say-3` Lichen, `say-4` Tawny): one per speaker, assigned per scene in order of first speech, only to speakers present. A tint always travels with its speaker's name: the caps cue in the margin, the swatch in the rail's speaker list, and the spoken words when Speakers is on. `say-4` is also the fallback for a fifth and later speaker.

### Neutral
- **Lamp-Black Ground** (`ground`): the page and masthead.
- **Rail Black** (`rail`): the left rail, one step darker than the page so the page reads as lit.
- **Raised Umber** (`raised`): the only filled surface: error notices, the save-problem block, the hovered tab-close.
- **Second Ink** (`ink-2`): apparatus text, inactive rail rows, gloss bodies, the stamp, quotations.
- **Third Ink** (`ink-3`): labels, scene numbers, dimmed controls, placeholders, the World hairline and the writer's own notes. Still legible on the ground (about 6:1).
- **Hairline** (`rule`): every structural border: rail edge, masthead base, tab separators, control outlines, gloss divider.
- **Strong Hairline** (`rule-strong`): hover border on controls, the gutter ticks, blockquote rule, scrollbar thumb.

### Named Rules
**The Vermilion Signature Rule.** Vermilion marks AI-made text and only AI-made text: the plate's two rules and its caption. If a surface is not an AI segment, it carries no vermilion, not even as an accent or an error.

**The One Job Rule.** Each layer hue means one thing everywhere it appears. Blue is always story time, gold is always subtext, a speaker tint is always that speaker in that scene. A new feature that needs colour takes a neutral, not a layer hue.

**The Paired Tint Rule.** A speaker tint never appears alone: it is always paired with the speaker's name, in the margin cue or the rail swatch row, so colour is never the only carrier of who is speaking.

## Typography

**Display Font:** Old Standard TT (with Iowan Old Style, Georgia, serif), self-hosted at 400, 400 italic and 700.
**Body Font:** Old Standard TT for prose; Source Sans 3 (with Source Sans Pro, system-ui) for apparatus, self-hosted at 400, 400 italic, 500 and 600.

**Character:** A nineteenth-century book face for the writer's words against a clear humanist sans for the edition's apparatus. The serif belongs to the text; the sans belongs to everything said about the text.

### Hierarchy
- **Display** (Old Standard 400, 32px, 1.25; 27px at 860px and below): the document title field at the head of the sheet.
- **Headline** (Old Standard 400, 30 / 25 / 21px for h1 / h2 / h3, 1.25, 1.4em above, 0.5em below): headings inside the prose. Headings stay at regular weight; size alone ranks them.
- **Body** (Old Standard 400, 19px, 1.62, 620px measure; 18px at 860px and below): manuscript prose. Paragraphs are separated by 20px of space, not indents.
- **Stamp** (Old Standard 400, 14px, 0.06em, uppercase): the story-time stamp in the masthead ("FROST 12, 1203 · NIGHT"). The wordmark is the one 700 serif setting (16px).
- **Apparatus** (Source Sans 3 400–500, 13–14px): rail rows, tabs, controls, notices.
- **Gloss** (Source Sans 3 400, 13.5px, 1.45): note bodies; emphasised phrases lift to `ink`, not to bold.
- **Label** (Source Sans 3 600, 12px, 0.1–0.12em, uppercase): rail section headings, margin cues, gloss note heads, the AI caption. Labels name the thing beside them; they are always functional.
- **Key** (Source Sans 3 600, 11px, 1): the lowered letter after a noted phrase, set out of flow.
- **Numerals** use tabular figures wherever they align (scene positions, years, scene number).

### Named Rules
**The Two Voices Rule.** The writer's words and the edition's stamps are serif; everything the app says is sans. Never set apparatus in Old Standard or prose in Source Sans; the writer's inline `[[ notes ]]` are the deliberate crossover, always italic sans at 15px, because they are the writer talking to themselves.

**The Fixed Weight Rule.** Weight, size and style never depend on a layer. World entities are always 700 and notes always italic apparatus whether or not their layer is on, because changing them would reflow the line.

## Layout

A four-column sheet inside a rail-and-masthead frame. The workspace grid is the 300px rail beside a column of 56px masthead, a notice row and the scrolling page. The sheet's columns are the left margin (96px) for cues and the scene number, the prose column (up to 620px), a gutter (40px) for ticks, and the gloss column (340px). The sheet pads 52px above and 160px below so the last line can be written mid-screen. Rail content insets 20px; the current scene carries a 3px ink bar at the rail's left edge.

Margin cues and the scene number hang right-aligned in the left margin, 22px clear of the prose. Gloss notes are positioned absolutely beside the line they annotate, stacked with a 14px gap when they collide.

Responsive behaviour, from the build:
- **≤1380px:** margin narrows to 80px, gutter to 32px, gloss to 220–300px; the masthead evens its padding.
- **≤1180px:** the rail leaves the grid and becomes an overlay drawer (up to 86vw), opened from a 32px toggle in the masthead; it fades in, it does not slide.
- **≤860px:** one column. The masthead wraps (tabs, then the stamp on its own line, then toggles and actions). Margin cues move into the gap above their paragraph (paragraph spacing grows to 26px to hold them), the scene number hides, the save status follows the title, and gloss notes follow the prose as a keyed list under a hairline, showing only the layers that are on.

### Named Rules
**The Paint-Only Rule.** A layer may change colour, background size and opacity. It may never change a box: no width, padding, margin, border, font weight, display or position. Any new layer rule is tested by toggling it and measuring zero prose movement.

## Elevation & Depth

Flat by construction. Depth comes from tonal steps (rail one step below the page, raised umber for the few filled blocks) and 1px hairlines, never from shadows. The single shadow in the system belongs to the rail when it overlays the page on narrow screens, where it must separate a floating drawer from live prose.

### Shadow Vocabulary
- **Drawer** (`box-shadow: 12px 0 32px rgb(0 0 0 / 0.45)`): the open rail drawer at 1180px and below. Nothing else casts a shadow.

### Named Rules
**The Hairline Rule.** Structure is drawn, not lifted: borders are 1px in `rule`, strengthening to `rule-strong` on hover. The pressed-toggle underline is an inset 2px line, not elevation.

## Shapes

Square paper, softened controls. The page, plate, notices and blocks have square corners; interactive controls (buttons, the view switch, the layer toggle strip, the rail toggle) round to a gentle 5px, and the small tab-close square to 4px. Speaker swatches are the only circles (8px). The AI plate's form is its own: a 1px border plus a 1px outline offset 3px, a double rule like a printer's frame.

## Components

### Buttons
Plain and printed.
- **Shape:** gentle corners (5px), 1px `rule` border, no fill, 13.5px Source Sans 500, 7px 14px.
- **Primary:** bone-ink fill with ground-coloured 600 text ("Generate next"); one per masthead, at the right.
- **Hover / Focus:** secondary buttons strengthen their border to `rule-strong`; primary brightens to a paler bone (#f3eee2). Focus everywhere is a 1px `ink-2` outline offset 2px (inset 3px on segmented controls).
- **Text actions:** rail and notice actions are bare `ink-2` text that underline on hover (3px offset).

### Layer Toggles
A segmented strip, the layer legend itself.
- **Style:** 5px-rounded strip, 1px `rule` outline and dividers, 13px Source Sans 500 in `ink-3`.
- **On:** a slightly raised umber fill (#2b261f), `ink` text and an inset 2px underline in the layer's own hue (Speakers in `say-0`, Time in `time`, Subtext in `subtext`, World and Notes in `ink-3`). Default state is Speakers only.

### View Switch
The rail's Manuscript / World / Topics switch: same strip form; the selected view inverts to bone fill with ground text.

### Navigation
- **Rail:** section labels, then rows of 32px in `ink-2` that brighten to `ink` on hover; the current scene is `ink` with a 3px left bar. Scene rows carry a tabular position number and, where dated, the year in `time`. Beside the reading order, the chronology spark plots story time as a 1.5px blue line with blue points and an ink point for the current scene.
- **Tabs:** an open-document strip in the masthead, separated by 18px hairlines; the active tab is 600 `ink` and carries its crumb in `ink-2`; inactive tabs shrink first. Close buttons fade in on hover or focus.
- **Mobile:** the rail becomes a fading drawer; the crumb drops.

### Margin Cue
Fountain-style speaker cue: 12px Source Sans 600, 0.1em, uppercase, right-aligned in the left margin in the speaker's tint. Always in the DOM; it fades in with the Speakers layer.

### Layer Marks
Painted behind the words as three background layers sized by width, so they draw left to right:
- **World:** a 1px `ink-3` hairline under known entities (always 700); suggested names get a 3px-dash `ink-2` hairline.
- **Time:** a `time-band` wash over the lower 42% of the line.
- **Subtext:** a 2px dotted gold rule (1.5px dots).
- **Notes:** the writer's `[[ notes ]]` gain a faint bone wash and lift from `ink-3` to `ink-2`.
- **Speakers:** spoken words take the speaker's tint.

### Gloss Note (signature)
A lettered key, not a card. The noted phrase ends in a raised 11px key letter in its layer's hue; beside it in the gloss column, a 26px `rule-strong` tick in the gutter leads to the note. The note is a head (letter · kind, 12px uppercase label in the layer hue) with its authority right-aligned in `ink-3` ("inferred", "suggested", "linked"), a 13.5px body in `ink-2` with key facts lifted to `ink`, and one-click text actions in `ink` ("Confirm", "Not implied") that underline on hover. Unavailable actions dim to `ink-3`. Notes and ticks appear only when their layer is on: the note fades, the tick draws.

### AI Segment Plate (signature)
AI-made prose inside a double-ruled vermilion frame (1px border, 1px outline offset 3px), padded 12px 16px. Its caption is a 12px vermilion uppercase label ("AI segment · model") with Regenerate and Accept at the right; while generating, the caption breathes between full and 55% opacity over 1.6s. The prose inside keeps the body setting; only the frame says who wrote it.

### Notices
Full-width rows under the masthead, 8px 32px, `ink-2` on the ground with a hairline base; errors take the raised umber fill and `ink` text.

### Motion
Two durations and one ease: fade 140 ms for opacity (marks, cues, keys, notes, close buttons, the drawer), draw 150 ms for background size and tick stroke, both on `cubic-bezier(0.16, 1, 0.3, 1)`. Nothing moves position. Under `prefers-reduced-motion` both durations are zero and the generating pulse stops.

## Do's and Don'ts

### Do:
- **Do** keep every layer mark in the DOM and switch it with `data-layer-*` attributes on the sheet, changing only colour, background size and opacity.
- **Do** reserve vermilion (#e34b2f) for the AI segment plate and its caption.
- **Do** give each layer hue exactly one meaning, and pair every speaker tint with the speaker's name.
- **Do** set the writer's prose in Old Standard TT at 19px / 1.62 on a 620px measure, and all apparatus in Source Sans 3.
- **Do** attach notes to their words with a key letter and a gutter tick, and resolve them with one-click text actions.
- **Do** fade opacity in 140 ms and draw underlines and ticks left to right in 150 ms on `cubic-bezier(0.16, 1, 0.3, 1)`, and zero both under reduced motion.
- **Do** draw structure with 1px hairlines (`rule`, `rule-strong`) and tonal steps.

### Don't:
- **Don't** let a layer change weight, size, padding, border, display or position; it reflows the prose.
- **Don't** put gloss notes in cards, boxes or filled panels; they are keyed text in the margin.
- **Don't** slide, bounce or translate anything, including the narrow-screen rail drawer.
- **Don't** use vermilion for errors, emphasis or brand; errors use raised umber with bone ink.
- **Don't** reuse a layer hue for an unrelated meaning.
- **Don't** add shadows beyond the overlay rail drawer.
