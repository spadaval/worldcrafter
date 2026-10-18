# Story Time

Status: proposal (2026-10-17). Settles the story-position decision (`worldcrafter-3ajq`). Prior art comes from Campfire, World Anvil and Aeon Timeline (see the bottom of this doc).

## Principles

1. **World-first.** The world's timeline is the truth. The manuscript is one view into it, presented in its own order.
2. **Time is local.** Relativity, alternate dimensions, stasis fields and time travel mean there isn't always one clock that applies to everyone. A global calendar is still the default reference, but it is a reference frame, not the definition of time.
3. **The AI does the bookkeeping.** We don't shrink the model to keep it cheap to maintain by hand. If a structure is useful but tedious (scene breakdowns, date conversions, ordering constraints), the AI keeps it up to date and the writer corrects it.

## Model

### Events and happens-before

- An **event** is anything that happens: a scene, a battle, a birth, the founding of a city. Every **scene is an event** by default. Backstory events don't need a scene.
- Events are ordered by **happens-before** constraints: `before`, `after`, `during`, `simultaneous`, optionally with a duration ("three days after"). This is a partial order. Two events with no path between them are *unordered*, and the model treats their relative order as unknown.
- Happens-before is the one ordering that holds whatever the clock: it is the order of cause and effect. It still works when clocks disagree (relativity, dimensions, stasis), which is why it's the core rather than dates.

### Frames and clocks

- A **frame** is a clock that some part of the world keeps:
  - the **world frame** (the global calendar, which every world has)
  - optional frames for a dimension, a ship, a pocket realm, or one person's own time
- An event can have a **position** in one or more frames. A position is an interval with a precision, such as "spring of 1203", "day 40 aboard", or "sometime before the war". Nothing has to be dated.
- Frames are related by **correspondences**:
  - **Sync points:** "the ship's return happens in world year 1243 and ship day 3,650."
  - **Rates:** "between these events, one day in the Fae realm is a year outside."
  - **Pauses:** "Ardelia's clock stops between being sealed and being freed."
- An **entity can follow a frame.** Ages and elapsed time are computed in the entity's own time, so a character in stasis doesn't age while the world goes on without them.
- A **calendar** is a display format over a frame (eras, months, moons). It isn't a separate model. Converting between calendars and frames is bookkeeping, done by code where a rule exists and by the AI where it doesn't, and the result is stored with its derivation so it can be inspected.

- **Positions** (decided 2026-10-17, from the build): a position is an interval `[start, end)` in one frame, with `end = start` for an exact moment, and an optional precision label used only for display. Positions are turned into ordering constraints against their frame's clock, so positions and constraints form one order, and a conflict between them is a contradiction. An event with a position in two frames is a sync point. "Sometime before the war" stays a constraint, not a position.

### Two orders

- **Chronology:** happens-before, plus positions in frames.
- **Narrative order:** the manuscript outline (book > chapter > scene). The outline is required, because narrative order comes from it.
- By default a scene is placed **after the main line**, so a linear story costs nothing. The main line is the latest scene that continues the story: an unplaced scene follows it and becomes the new main line. Flashbacks, time skips and parallel POVs override the default, and the AI proposes the override from cues in the prose ("years earlier…"). Decided by Sumeet (2026-10-17):
  - A placed scene (a flashback, a parallel scene) doesn't move the main line, so the scene after a flashback returns to the present.
  - A placed scene that is known to come after the main line (a time skip) becomes the new main line. So can any placed scene marked as *continuing* the main line, which covers a flashback that runs over several scenes.
  - A placed first scene, such as a flash-forward prologue, doesn't start the main line.
  - Where the default is a guess (the scene right after a placed scene that doesn't continue), it stands but is surfaced as a hint for the bookkeeping pass to confirm. A scene with nothing to follow is unordered, and its facts are reported as uncertain.

### Facts change at events

- A **fact change** is anchored to an event: "from the coronation, Aldric is king." The anchor is an event ID, never a stored number.
- **Holds at scene S:** a fact holds at a scene if its change happens before that scene, and no later change to the same fact also happens before it. When the ordering is unknown, the fact is passed to the model as uncertain, not guessed.
- **Changes during a long event** (decided by Sumeet, 2026-10-17): when a change is anchored to an event that lasts a while ("the border moved during the war"), the fact doesn't hold before the event starts, holds after it ends, and is uncertain during it. A scene's own changes don't hold at that scene; facts are read as the scene opens.
- **Revealed at:** the first scene in narrative order that shows the fact. Discovery records this from the source paragraph.
- **Arc:** an entity's sequence of fact changes ("Ardelia's arc"). It's a view, not a separate thing that's stored.

### What generation sees

For the scene being written, context includes:

- facts that **hold** at its event
- facts **revealed** before its position in narrative order, which can be stated openly
- facts that hold but **haven't been revealed** yet, marked "known to the author, not yet revealed to the reader"

This makes a new kind of check possible: "this scene reveals X before chapter 20."

## Bookkeeping by AI

This is the theatrical-production *script breakdown*, kept up to date automatically:

- **Scene breakdown:** split chapters into scenes and annotate each one with POV, characters present, setting, props, events and fact changes.
- **Time placement:** turn prose cues ("the next morning", "a decade before the fall") into happens-before constraints and positions.
- **Conversions and arithmetic:** dates across calendars and frames, ages in an entity's own time, durations.
- **Consistency:** report constraint contradictions ("A is both before and after B"). These open a talk-page topic.

Rules that keep this trustworthy without making the writer review everything:

- **Two authority levels:** *asserted* (written or confirmed by the writer) and *inferred* (from the AI, with provenance: model, request and source block).
- **Inferred bookkeeping is applied automatically** and marked visibly. It doesn't go through a review queue. The writer corrects it where they see it.
- **A correction pins the value.** It becomes asserted, and reruns never overwrite asserted data.
- **Inferred data goes stale when its source changes.** It's recomputed when the source block's content hash changes.
- **Escalate only what matters:** conflicts with asserted data, low confidence, and changes to canon facts. Those become proposals on the relevant talk page. Everything else stays silent.

This splits the old rule that nothing is written until accepted. **Bookkeeping** (breakdowns, placement, conversions) is applied automatically as inferred data. **Canon** (new entries, fact changes, relations) is still proposed for acceptance.

## Out of scope for now

- calendar editors and timeline visualisations beyond a simple list or graph
- storylines (named POV or subplot lanes). Add them if filtering by arc isn't enough.
- branching or alternate timelines as separate worlds. Frames cover dimensions, but "what if" branches are a different feature.

## Open questions

- How eagerly bookkeeping should run on slow local models. Probably once per scene when the writer leaves it, cached by content hash.
- Whether the writer marks a scene "not happening in story time" (dreams, visions) or the AI infers it.

## Prior art

- **Aeon Timeline:** separate chronological and narrative orders over the same events, and undated events can still be ordered. It is the closest model, but it's maintained by hand and has a reputation for being heavy.
- **Campfire:** dates are mandatory (reviewers dislike this). Its **Arcs** graph how a character changes over time, built from linked timeline events. Users create one event per scene by hand.
- **World Anvil:** custom calendars and eras. Ages are computed from a single Year 0, and parallel calendars were declined. Manuscripts aren't linked to time.
- **Novelcrafter:** progressions are anchored to manuscript position (story-first).
- Sources:
  - https://www.aeontimeline.com/whats-new/introducing-aeon-timeline-3
  - https://reedsy.com/blog/guide/book-writing-software/campfire-write-review/
  - https://isobellynx.com/blog/writing-tips/campfire-writing-app-what-can-you-do-with-the-free-modules/
  - https://www.worldanvil.com/community/voting/suggestion/0da6fc5e-f2d8-46ef-8995-1ae449e967f8/view
