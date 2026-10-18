/**
 * The Ninefold: a synthetic demo world for looking at the workspace without
 * a real one (open the app with `?demo`). It lives in memory and nothing is
 * saved. Seeding goes through the real stores (documents, outline, world
 * facts, timeline), so the rail, stamp and chronology are computed exactly as
 * for a real world. Layers with no data source yet (speakers, time
 * expressions, subtext, entry suggestions, topics) come from the fixtures
 * below. Only `main.tsx` imports this, and only when the flag is set.
 */
import type { ResultAsync } from "neverthrow";
import type { LayerSource } from "~/app/layers";
import { createLayerSource } from "~/app/layers";
import type { LayerMark, SceneLayers } from "~/layers/model";
import { LAYERS } from "~/layers/model";
import { runOutlineCommand } from "~/outline/store";
import { createMemoryStorage } from "~/storage/memory";
import type { JsonValue, StorageAdapter } from "~/storage/types";
import { createTimelineStore } from "~/time/store";
import { sceneEventId } from "~/time/timeline";
import type { KeyValueStore } from "~/workspace/tabs";
import { createWorldStore, directRenameDocument } from "~/world/store";

export const DEMO_WORLD_NAME = "The Ninefold";
export const DEMO_SCENE = "scene-4-2";

const p = (id: string, text: string): JsonValue => ({
  type: "p",
  id,
  children: [{ text }],
});

interface SceneSeed {
  readonly id: string;
  readonly title: string;
  readonly content: JsonValue[];
  /** Year, and day of Frost (the eleventh month) when it matters. */
  readonly when: { year: number; day?: number; label: string };
}

const SCENES: readonly SceneSeed[][] = [
  [
    {
      id: "scene-1-1",
      title: "The Drowned Archive",
      when: { year: 1196, day: 3, label: "Frost 3" },
      content: [
        p(
          "a1",
          "The archive had been underwater for a hundred years, and it still kept its catalogue. Ardelia read the drawer labels by lamplight through a fathom of green water.",
        ),
      ],
    },
  ],
  [
    {
      id: "scene-2-1",
      title: "Ardelia",
      when: { year: 1198, label: "spring" },
      content: [
        p(
          "b1",
          "Nobody in the harbour quarter remembered a time before Ardelia Vane. She kept the tide tables, and the tide, people said, kept her.",
        ),
      ],
    },
  ],
  [
    {
      id: "scene-3-1",
      title: "What the Tide Kept",
      when: { year: 1201, label: "autumn" },
      content: [
        p(
          "c1",
          "At the lowest tide in forty years the sea gave back a bell, a boot, and a door key nobody would admit to owning.",
        ),
      ],
    },
    {
      id: "scene-3-2",
      title: "The Winter Seal",
      when: { year: 902, day: 30, label: "Frost 30 · night" },
      content: [
        p(
          "d1",
          "The iron was still warm from the forge when she laid her hand on it. Behind her, the city was crowning a king.",
        ),
      ],
    },
  ],
  [
    {
      id: "scene-4-1",
      title: "Night Market",
      when: { year: 1203, day: 9, label: "Frost 9 · evening" },
      content: [
        p(
          "e1",
          "Kesh sold lamp oil by the thimble and secrets by the hour, and only one of those was licensed.",
        ),
      ],
    },
    {
      id: DEMO_SCENE,
      title: "The Sealed Door",
      when: { year: 1203, day: 12, label: "Frost 12 · night" },
      content: [
        p(
          "p-lamps",
          "The lamps along the Salt Gate had burned down to their wicks by the time Ardelia reached the sealed door. She set her palm against the iron, and it was colder than the sea had been.",
        ),
        p(
          "p-kesh",
          "“Three hundred years,” said Kesh, behind her. “And it still knows you.”",
        ),
        p(
          "p-ardelia",
          "“It knows what I did,” Ardelia said. The door remembered the hand that had sealed it, and that hand had been hers, in the winter Aldric took the crown. [[ does Kesh already know? ]]",
        ),
        {
          type: "ai_segment",
          id: "seg-tide",
          status: "ready",
          children: [
            p(
              "p-tide",
              "Somewhere below them, the tide turned. She felt it in the iron before she heard it, a long and patient pull, like a breath drawn by something that had been waiting.",
            ),
          ],
        },
        p("p-lifted", "Kesh lifted the lamp"),
      ],
    },
    {
      id: "scene-4-3",
      title: "Aldric's Answer",
      when: { year: 1203, day: 14, label: "Frost 14" },
      content: [
        p(
          "f1",
          "The king's answer came on blue paper, which in Aldric's court meant no, and on a Tuesday, which meant not yet.",
        ),
      ],
    },
  ],
  [
    {
      id: "scene-5-1",
      title: "Undertow",
      when: { year: 1204, label: "year" },
      content: [
        p(
          "g1",
          "Under the harbour, something that had been patient for three centuries stopped being patient.",
        ),
      ],
    },
  ],
];

const ENTRIES = [
  {
    id: "entry-ardelia",
    title: "Ardelia Vane",
    kind: "person" as const,
    aliases: ["Ardelia"],
    content: [
      p(
        "h1",
        "Keeper of the tide tables in the harbour quarter. She sealed the Salt Gate in the winter of 902 and has not aged since.",
      ),
    ],
  },
  {
    id: "entry-aldric",
    title: "Aldric II",
    kind: "person" as const,
    aliases: ["Aldric"],
    content: [p("i1", "King of the Ninefold, crowned in the winter of 903.")],
  },
  {
    id: "entry-salt-gate",
    title: "The Salt Gate",
    kind: "place" as const,
    aliases: [],
    content: [
      p("j1", "The sea gate of the old city, sealed in 902. It does not open."),
    ],
  },
];

const FROST = 10; // months before Frost, of twelve thirty-day months

function position({ year, day, label }: SceneSeed["when"]) {
  if (day === undefined) {
    return { start: year, end: year + 1, precision: label };
  }
  const start = year + (FROST * 30 + day - 1) / 360;
  return { start, end: start + 1 / 360, precision: label };
}

/** The fixture layers of 4.2 The Sealed Door. */
function sealedDoorLayers(): SceneLayers {
  const speech = (
    id: string,
    blockId: string,
    quote: string,
    speaker: string,
  ) =>
    ({
      id,
      anchor: { blockId, quote },
      style: { kind: "speech", speaker },
    }) satisfies LayerMark;
  return {
    speakers: [
      { id: "kesh", name: "Kesh", cue: "Kesh", entryId: null },
      {
        id: "ardelia",
        name: "Ardelia Vane",
        cue: "Ardelia",
        entryId: "entry-ardelia",
      },
    ],
    cues: new Map([
      ["p-kesh", "kesh"],
      ["p-ardelia", "ardelia"],
    ]),
    marks: [
      speech("s1", "p-kesh", "“Three hundred years,”", "kesh"),
      speech("s2", "p-kesh", "“And it still knows you.”", "kesh"),
      speech("s3", "p-ardelia", "“It knows what I did,”", "ardelia"),
      {
        id: "m-a",
        anchor: { blockId: "p-kesh", quote: "Three hundred years" },
        style: { kind: "time" },
        noteId: "n-years",
      },
      {
        id: "m-kesh",
        anchor: { blockId: "p-kesh", quote: "Kesh" },
        style: { kind: "suggestion" },
        noteId: "n-kesh",
      },
      {
        id: "m-b",
        anchor: { blockId: "p-kesh", quote: "And it still knows you." },
        style: { kind: "subtext" },
        noteId: "n-implication",
      },
      {
        id: "m-c",
        anchor: {
          blockId: "p-ardelia",
          quote:
            "The door remembered the hand that had sealed it, and that hand had been hers",
        },
        style: { kind: "subtext" },
        noteId: "n-reveal",
      },
      {
        id: "m-d",
        anchor: {
          blockId: "p-ardelia",
          quote: "in the winter Aldric took the crown",
        },
        style: { kind: "time" },
        noteId: "n-coronation",
      },
      {
        id: "m-e",
        anchor: {
          blockId: "p-tide",
          quote: "like a breath drawn by something that had been waiting",
        },
        style: { kind: "subtext" },
        noteId: "n-undertow",
      },
    ],
    notes: [
      {
        id: "n-years",
        layer: "time",
        heading: "Time",
        authority: "inferred",
        body: [
          { text: "Three hundred years from the seal (winter 902) is " },
          { text: "301", strong: true },
          { text: "." },
        ],
        actions: [
          { id: "keep", label: "Keep as spoken", resolves: "confirm" },
          {
            id: "topic",
            label: "Open topic",
            resolves: "none",
            unavailable: "Talk pages aren't in this build yet.",
          },
        ],
      },
      {
        id: "n-kesh",
        layer: "world",
        heading: "New entry",
        authority: "suggested",
        body: [
          { text: "Kesh", strong: true },
          { text: " speaks here but isn't in the world yet." },
        ],
        actions: [
          {
            id: "add",
            label: "Add as a person",
            resolves: "none",
            unavailable: "Adding entries from a note isn't in this build yet.",
          },
          { id: "not", label: "Not an entry", resolves: "dismiss" },
        ],
      },
      {
        id: "n-implication",
        layer: "subtext",
        heading: "Implication",
        authority: "inferred",
        body: [
          { text: "Kesh knows Ardelia sealed the door.", strong: true },
          { text: " Nothing earlier tells him." },
        ],
        actions: [
          { id: "confirm", label: "Confirm", resolves: "confirm" },
          { id: "not", label: "Not implied", resolves: "dismiss" },
        ],
      },
      {
        id: "n-reveal",
        layer: "subtext",
        heading: "Reveal",
        authority: "first in reading order",
        body: [
          { text: "Ardelia sealed the Salt Gate. " },
          { text: "Still withheld:", strong: true },
          { text: " she is Aldric's sister." },
        ],
        actions: [
          { id: "confirm", label: "Confirm", resolves: "confirm" },
          { id: "not", label: "Not a reveal", resolves: "dismiss" },
        ],
      },
      {
        id: "n-coronation",
        layer: "time",
        heading: "Event",
        authority: "linked",
        body: [
          { text: "Coronation of Aldric II · winter 903. " },
          { text: "This places the seal in 902.", strong: true },
        ],
        actions: [],
      },
      {
        id: "n-undertow",
        layer: "subtext",
        heading: "Foreshadows",
        authority: "AI segment",
        body: [
          { text: "The Undertow wakes · " },
          { text: "pays off in 5.1", strong: true },
        ],
        actions: [
          { id: "keep", label: "Keep", resolves: "confirm" },
          { id: "not", label: "Not intended", resolves: "dismiss" },
        ],
      },
    ],
  };
}

export interface DemoWorld {
  readonly storage: StorageAdapter;
  readonly tabStore: KeyValueStore;
  readonly layerSource: LayerSource;
}

export function memoryKeyValue(
  initial: Record<string, string> = {},
): KeyValueStore {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

/**
 * Seeds the demo world. With `allLayers`, every layer starts on (Subtext
 * opted into 4.2), for looking at the full apparatus.
 */
export async function seedDemoWorld(
  worldId: string,
  options: { allLayers: boolean },
): Promise<DemoWorld> {
  const storage = createMemoryStorage();
  const now = 1_760_000_000_000;
  const unwrap = async <T, E>(result: ResultAsync<T, E>, what: string) => {
    const settled = await result;
    if (settled.isErr()) {
      throw new Error(
        `Seeding ${what} failed: ${JSON.stringify(settled.error)}`,
      );
    }
    return settled.value;
  };

  const documents = [
    ...SCENES.flat().map((scene) => ({
      id: scene.id,
      title: scene.title,
      content: scene.content,
    })),
    ...ENTRIES,
  ];
  for (const [i, document] of documents.entries()) {
    await unwrap(
      storage.documents.save({
        id: document.id,
        title: document.title,
        content: document.content,
        updatedAt: now - i * 60_000,
      }),
      `document ${document.id}`,
    );
  }

  const roman = ["I", "II", "III", "IV", "V"];
  await unwrap(
    runOutlineCommand(storage, {
      type: "addBook",
      bookId: "book-1",
      title: "Book One",
    }),
    "book",
  );
  for (const [c, chapter] of SCENES.entries()) {
    const chapterId = `chapter-${c + 1}`;
    await unwrap(
      runOutlineCommand(storage, {
        type: "addChapter",
        bookId: "book-1",
        chapterId,
        title: `Chapter ${roman[c]}`,
      }),
      chapterId,
    );
    for (const scene of chapter) {
      await unwrap(
        runOutlineCommand(storage, {
          type: "addScene",
          documentId: scene.id,
          chapterId,
        }),
        scene.id,
      );
    }
  }

  const world = createWorldStore(storage, {
    renameDocument: directRenameDocument(storage),
  });
  for (const entry of ENTRIES) {
    await unwrap(
      world.execute({
        name: "attachEntry",
        payload: {
          documentId: entry.id,
          kind: entry.kind,
          aliases: entry.aliases,
        },
      }),
      entry.id,
    );
  }

  const timeline = createTimelineStore(storage, world);
  const run = (command: Parameters<typeof timeline.execute>[0]) =>
    unwrap(timeline.execute(command), command.type);
  await run({
    type: "addEvent",
    id: "seal",
    label: "The sealing of the Salt Gate",
  });
  await run({
    type: "addEvent",
    id: "coronation",
    label: "Coronation of Aldric II",
  });
  await run({
    type: "setPosition",
    event: "seal",
    frame: "world",
    position: { start: 902, end: 903, precision: "winter" },
  });
  await run({
    type: "setPosition",
    event: "coronation",
    frame: "world",
    position: { start: 903, end: 904, precision: "winter" },
  });
  // The flashback is placed explicitly, so the main line resumes after it.
  await run({
    type: "placeScene",
    scene: "scene-3-2",
    placement: [{ relation: "during", event: "seal" }],
  });
  for (const scene of SCENES.flat()) {
    await run({
      type: "setPosition",
      event: sceneEventId(scene.id),
      frame: "world",
      position: position(scene.when),
    });
  }

  await unwrap(
    storage.annotations.save({
      id: "seg-tide",
      documentId: DEMO_SCENE,
      kind: "ai_provenance",
      data: { model: "llama-3.3-70b", requestId: "demo-request" },
      updatedAt: now,
    }),
    "provenance",
  );

  const tabStore = memoryKeyValue({
    [`worldcrafter:${worldId}:tabs`]: JSON.stringify({
      open: [DEMO_SCENE, "entry-ardelia"],
      active: DEMO_SCENE,
    }),
    ...(options.allLayers
      ? {
          [`worldcrafter:${worldId}:layers`]: JSON.stringify({
            on: LAYERS.filter((layer) => layer !== "subtext"),
            subtextScenes: [DEMO_SCENE],
          }),
        }
      : {}),
  });

  return {
    storage,
    tabStore,
    layerSource: createLayerSource(
      new Map([[DEMO_SCENE, sealedDoorLayers()]]),
      [
        {
          id: "t1",
          title: "Does Kesh already know?",
          about: "4.2 The Sealed Door",
        },
        {
          id: "t2",
          title: "Ardelia's age at the sealing",
          about: "Ardelia Vane",
        },
        { id: "t3", title: "Where the Undertow sleeps", about: "The world" },
      ],
    ),
  };
}
