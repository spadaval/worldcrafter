# Story Model

Status: accepted direction (2026-10-29, decision worldcrafter-ok5a). Not yet reflected in the strategy, PRODUCT.md or the success criteria.

## Identity

WorldCrafter is a tool for building stories from the frame out. The world and the plot are the structure, and the AI inspects them while they're still exposed. Prose is the finish: written by hand, drafted by AI, or both, and anchored to the structure rather than compiled from it. This is a tool for crafted stories, not a text generator.

It is about stories, not manuscripts. A story that never reaches the page is still a story, and work on its structure is still progress.

## Leverage

A story is easiest to make satisfying at the structural level. One change to a drive, a question or a world constraint reaches every scene it touches. The same change made in prose has to be found and repeated by hand, and is usually missed somewhere.

A story in the writer's head is high-dimensional: threads, drives, the world and the telling all evolve together. A page is linear. Writing it down too early flattens the story into one order, and after that it stops evolving. That flattening is the main reason stories never leave the head.

So the app keeps the story in its high-dimensional form for as long as possible, and makes flattening cheap, late and repeatable:

- **Change things at the highest level where they apply**, and let the change flow down. Editing prose to fix structure is the expensive path.
- **The outline is not a document.** A list or a document is already linear. The structure is a graph, and lists, grids and outlines are views of it.
- **Prose is anchored, not compiled.** Each passage hangs off the scene or beat it tells. When a beat changes, the passage is flagged as stale, and the writer decides whether to rewrite it by hand, redraft it with the AI, or keep it.

The words still matter a great deal: the same structure told differently is a different story. The difference is reach. A structural choice affects every scene it touches, while a sentence mostly matters inside its own scene. That's why prose can hang off the structure without being an afterthought.

## Construction

A building takes months of framing, wiring and plumbing that look ugly, then becomes beautiful in a few days of drywall and flooring. The finishing sets how it feels, but it can't save a flawed structure.

- **Inspect before the drywall.** The AI's most valuable work is checking the structure while it's still visible: stale promises, drives that never collide, world constraints the plot breaks, reveals that come too early. Reviewing finished prose is reviewing the drywall.
- **Finishing is fast, and that's where generation goes.** Voice, the choice of finetune and sampler control matter most here.
- **Finishing talks back.** Unlike a building, drafting a scene can show that the structure is wrong. The tool isn't a one-way pipeline. A scene that contradicts its beat asks: update the beat, or rewrite the scene?

## Arrangement

The model is film editing, not a compiler. Footage is shot against a script, but the film is made in the edit.

- **The structure is the script**: who wants what, what happens, what the reader is waiting for.
- **The prose is the footage**: passages attached to scenes or beats, hand-written or drafted.
- **The arrangement is the edit**: which scenes go in which chapters, and in what order. It belongs to the telling layer and is held separately from the prose.

Moving a scene to another chapter, or reordering passages within a scene, changes the arrangement, and the prose travels with it. Chapters are packaging over scenes, not containers that own text. The manuscript is a view assembled from the arrangement, never a stored document. This amends decision worldcrafter-9zj1, which already made the manuscript outline a layer that references scene documents: scenes and entries stay documents, but a scene is a structural unit first, and its prose is a set of passages anchored to its beats (decision worldcrafter-ok5a).

Prose has seams. It refers outward ("later that night", a pronoun whose antecedent was two scenes back, a character acting on something the reader hasn't learned). After a move, the app flags:

- **reveal-order breaks**, using the "revealed" model in `story-time.md`
- **seam passages**: the openings and closings that tie a scene to its neighbours

## Layers

The story is worked through four layers, each from coarse to fine (snowflake-style: premise, arcs, chapters, scenes, beats, prose).

| Layer | What it holds | Narratology |
|---|---|---|
| World | places, peoples, systems, history (macro and micro, after Jemisin) | |
| Story | actors, drives, events, and how they collide | fabula |
| Telling | point of view, narrative order, reveals, what's hidden, parallels | syuzhet |
| Prose | voice: rhythm, sentence length, diction | |

The world exists before the story to some degree, but only as deep as the story needs (Sanderson's third law: expand what you have before adding something new). World and story shape each other both ways. A story need asks the world a question ("this scene needs a place where X is possible"). A world fact constrains the story ("that can't happen there, because…"). Constraints matter more than decoration (Sanderson's second law: limitations are more interesting than powers).

The unreliable narrator is out of scope. What the telling states is true in the world. Characters can still believe false things; that is character knowledge, not narration.

## Primitives

These are what the tools reason about.

- **Actors**: characters and organisations.
- **Drives**: an actor's want or intention, what's at stake, and what it will do about it. Drives oppose, ally or compete. They are the engine: *why* things happen.
- **Questions**: what the reader is waiting for. A question opens at a scene, makes progress, and is answered (Sanderson's promise, progress and payoff). Every MICE thread reduces to one: will she get out, who did it, will he become whole, will order be restored. Questions are about reader knowledge, so they belong to the telling layer and use the "revealed" model in `story-time.md`.
- **Events**: what happens, placed in story time.
- **Scenes**: units of the telling, where drives collide and questions move.
- **World facts**: as in `story-time.md`, changing at events.

## Lenses

These are what the writer thinks in. They are named, writer-owned groupings over the primitives. The AI can propose them and fill in membership as inferred data, and the writer's corrections win.

- **Threads**: usually anchored on one or more questions, pulling in the actors and drives that push on them and the scenes and events they pass through. A thread can also be a motif or a parallel that has no question. Tools don't need to understand threads, so a thread that fits no pattern breaks nothing. Threads are the rows of the weave grid (scenes × threads).
- **Arcs**: one actor's drives and state traced across scenes.

## Tools this enables

- **Question ledger**: questions open too long without progress, and promises with no planned payoff.
- **Collision map**: actors with no opposition, drives that never meet on the page, actors who want the same thing and never share a scene.
- **Scene check**: each scene should move at least one question or put at least one drive under pressure.
- **Playing an actor**: "given what X wants and knows at this point, what would X do?", using drives and the story-time knowledge model.
- **Staleness**: prose anchored to beats that have since changed.
- **Seam check**: reveal-order breaks and stale transitions after scenes or passages move.
- **Weave grid**: threads across scenes, with convergence visible where several questions close together.

## Effect on the current plan

If adopted, this changes the strategy's success criteria, which needs the human:

- The main surface becomes the structure (zoomable outline and weave grid), not the manuscript. PRODUCT.md's principle "The prose is the stage" would change.
- The first worthwhile slice becomes world plus story at a coarse level of detail, with prose generation later. S1–S4 are about the editor and prose generation today.
- Story time, entity recognition, AI segments, provenance and stable IDs all keep their place. Prose is one layer among four, not the centre.

## Open questions

- How are drives and questions represented in the world-fact schema? Are they entries, facts on entries, or their own store?
- How far down does the structure go before prose: beats inside scenes, or scenes only?
- Is a scene part of the telling (syuzhet) only, or also a grouping of events (fabula)?

## Sources

- Brandon Sanderson, 2025 writing lectures: [plot](https://www.brandonsanderson.com/blogs/blog/brandon-sandersons-2025-guide-to-plot-lecture-2) and [structure](https://brandonsanderson.com/blogs/blog/brandon-sandersons-2025-overview-of-story-structure-lecture-3); [Sanderson's Third Law](https://brandonsanderson.com/sandersons-third-law-of-magic/).
- Mary Robinette Kowal, MICE quotient: [Writing Excuses](https://writingexcuses.com/?p=16418).
- N.K. Jemisin, macro and micro worldbuilding: [Cornell Daily Sun](https://cornellsun.com/2023/10/12/n-k-jemisin-gives-bartels-world-affairs-lecture-speaks-on-building-a-better-world/).
- Ursula K. Le Guin, *Steering the Craft* (point of view, sentence length, crowding and leaping).
