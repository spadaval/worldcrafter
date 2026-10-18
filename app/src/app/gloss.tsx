import {
  PlateContent,
  useEditorRef,
  useEditorSelector,
  useEditorVersion,
  useRedecorate,
} from "platejs/react";
import {
  type CSSProperties,
  memo,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { SegmentModelsContext } from "~/editor/elements";
import { assignKeys, LayerPlugin, type NoteKey } from "~/editor/layer-plugin";
import {
  type GlossNote,
  LAYER_LABELS,
  type LayerId,
  layersForScene,
  type NoteAction,
  stackNotes,
} from "~/layers/model";
import type { DocumentSession } from "~/workspace/document-session";
import { useServices, useStore } from "./hooks";
import type { NoteResolution } from "./layers";
import { entryNames } from "./world";

/** Space between stacked notes in the gloss column. */
const NOTE_GAP = 14;

const sameKeys = (
  a: ReadonlyMap<string, NoteKey>,
  b: ReadonlyMap<string, NoteKey>,
) =>
  a.size === b.size &&
  [...a].every(([id, key]) => {
    const other = b.get(id);
    return other?.letter === key.letter && other.layer === key.layer;
  });

/**
 * The page of a document: the head, the prose column with its margin cues,
 * and the gloss column of lettered notes beside it.
 *
 * Layer toggles reach the prose only as `data-layer-*` attributes on this
 * element; the prose itself is memoised and never re-renders for a toggle.
 */
export function Sheet({
  session,
  head,
}: {
  session: DocumentSession;
  head: ReactNode;
}) {
  const { layers, layerSource, worldIndex, workspace, manuscript } =
    useServices();
  const editor = useEditorRef();
  const state = useStore(layers);
  const resolutions = useStore(layerSource.resolutions);
  const entries = useStore(worldIndex.entries);
  const documents = useStore(workspace.documents);
  const documentId = session.documentId;
  const on = layersForScene(state.on, state.subtextScenes, documentId);
  const sceneLayers = layerSource.scene(documentId);

  const names = useMemo(
    () =>
      entryNames(entries, (id) => documents.find((d) => d.id === id)?.title)
        // A document doesn't mention itself.
        .filter((name) => name.entryId !== documentId),
    [entries, documents, documentId],
  );
  const dismissed = useMemo(
    () =>
      new Set(
        [...resolutions]
          .filter(([, resolution]) => resolution === "dismissed")
          .map(([id]) => id),
      ),
    [resolutions],
  );
  const keys = useEditorSelector(
    (current) => assignKeys(current.children, sceneLayers),
    [sceneLayers],
    { equalityFn: sameKeys },
  );

  const redecorate = useRedecorate();
  useLayoutEffect(() => {
    editor.setOptions(LayerPlugin, {
      layers: sceneLayers,
      names,
      keys,
      dismissed,
    });
    redecorate();
  }, [editor, redecorate, sceneLayers, names, keys, dismissed]);

  const [models, setModels] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    let current = true;
    void manuscript.segmentModels(documentId).then((result) => {
      if (current && result.isOk()) setModels(result.value);
    });
    return () => {
      current = false;
    };
  }, [manuscript, documentId]);

  const sheetRef = useRef<HTMLDivElement>(null);
  const layerAttributes = Object.fromEntries(
    [...on].map((layer) => [`data-layer-${layer}`, ""]),
  );
  return (
    <SegmentModelsContext value={models}>
      <div className="sheet" ref={sheetRef} {...layerAttributes}>
        <div className="sheet-head">{head}</div>
        <Prose readOnly={session.readOnly} />
        <Gloss
          sheetRef={sheetRef}
          notes={sceneLayers.notes}
          marked={
            sceneLayers.notes.length > 0 ||
            sceneLayers.marks.length > 0 ||
            sceneLayers.speakers.length > 0
          }
          keys={keys}
          on={on}
          resolutions={resolutions}
          onResolve={layerSource.resolve}
        />
      </div>
    </SegmentModelsContext>
  );
}

const Prose = memo(function Prose({ readOnly }: { readOnly: boolean }) {
  return (
    <PlateContent
      className="prose"
      aria-label="Document text"
      readOnly={readOnly}
      placeholder="Begin…"
    />
  );
});

interface Layout {
  readonly tops: ReadonlyMap<string, number>;
  readonly height: number;
}

const EMPTY_LAYOUT: Layout = { tops: new Map(), height: 0 };

/**
 * Lettered notes beside the words they are about, each on a leader line from
 * its key. Every keyed note is rendered and measured; the visible ones are
 * stacked so none overlaps the one above, and hidden ones wait at their own
 * line so they fade in where they belong.
 */
function Gloss({
  sheetRef,
  notes,
  marked,
  keys,
  on,
  resolutions,
  onResolve,
}: {
  sheetRef: React.RefObject<HTMLDivElement | null>;
  notes: readonly GlossNote[];
  /** Whether the bookkeeping has marked this document at all. */
  marked: boolean;
  keys: ReadonlyMap<string, NoteKey>;
  on: ReadonlySet<LayerId>;
  resolutions: ReadonlyMap<string, NoteResolution>;
  onResolve: (noteId: string, resolution: NoteResolution) => void;
}) {
  const glossRef = useRef<HTMLDivElement>(null);
  const noteRefs = useRef(new Map<string, HTMLElement>());
  const [layout, setLayout] = useState<Layout>(EMPTY_LAYOUT);
  const version = useEditorVersion();

  const keyed = notes
    .filter(
      (note) => keys.has(note.id) && resolutions.get(note.id) !== "dismissed",
    )
    .sort((a, b) =>
      (keys.get(a.id)?.letter ?? "").localeCompare(
        keys.get(b.id)?.letter ?? "",
        "en",
        {
          numeric: true,
        },
      ),
    );
  const visible = new Set(
    keyed.filter((note) => on.has(note.layer)).map((note) => note.id),
  );
  const visibleKey = [...visible].join(" ");
  const keyedKey = keyed.map((note) => note.id).join(" ");

  const measure = useRef(() => {});
  measure.current = () => {
    const gloss = glossRef.current;
    const sheet = sheetRef.current;
    if (!gloss || !sheet) return;
    const base = gloss.getBoundingClientRect().top;
    const anchors = new Map<string, number>();
    const placements = [];
    for (const note of keyed) {
      const anchor = sheet.querySelector(
        `[data-anchor="${CSS.escape(note.id)}"]`,
      );
      const element = noteRefs.current.get(note.id);
      if (!anchor || !element) continue;
      const rects = anchor.getClientRects();
      const line = rects[rects.length - 1] ?? anchor.getBoundingClientRect();
      const top = Math.round(line.top - base);
      anchors.set(note.id, top);
      if (visible.has(note.id)) {
        placements.push({
          id: note.id,
          anchorTop: top,
          height: element.offsetHeight,
        });
      }
    }
    const tops = new Map(anchors);
    for (const [id, top] of stackNotes(placements, NOTE_GAP)) tops.set(id, top);
    let height = 0;
    for (const [id, top] of tops) {
      if (!visible.has(id)) continue;
      height = Math.max(
        height,
        top + (noteRefs.current.get(id)?.offsetHeight ?? 0),
      );
    }
    setLayout((previous) =>
      sameLayout(previous, { tops, height }) ? previous : { tops, height },
    );
  };

  // Layer toggles and note changes: place before paint, so a note appears
  // where it belongs in the same frame as its marks.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these keys are what changes the layout
  useLayoutEffect(() => measure.current(), [visibleKey, keyedKey]);

  // Edits move words; measure once they've laid out.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the editor version is the trigger
  useEffect(() => {
    const frame = requestAnimationFrame(() => measure.current());
    return () => cancelAnimationFrame(frame);
  }, [version]);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const observer = new ResizeObserver(() => measure.current());
    observer.observe(sheet);
    void document.fonts?.ready.then(() => measure.current());
    return () => observer.disconnect();
  }, [sheetRef]);

  const shown = [...visible].filter((id) => layout.tops.has(id)).length;
  const hint = marked
    ? glossHint(on, shown)
    : "No notes in this document yet. Notes attach to the words they're about.";
  return (
    <aside
      className="gloss-column"
      aria-label="Notes"
      ref={glossRef}
      style={{ "--gloss-height": `${layout.height}px` } as CSSProperties}
    >
      <svg
        className="leaders"
        aria-hidden="true"
        height={Math.max(layout.height, 1)}
      >
        {keyed.map((note) => {
          const top = layout.tops.get(note.id);
          if (top === undefined) return null;
          return (
            <line
              key={note.id}
              className="leader"
              data-visible={visible.has(note.id)}
              pathLength={1}
              x1={8}
              x2={34}
              y1={top + 9.5}
              y2={top + 9.5}
            />
          );
        })}
      </svg>
      {hint && <p className="gloss-hint">{hint}</p>}
      {keyed.map((note) => {
        const key = keys.get(note.id);
        const isVisible = visible.has(note.id);
        return (
          <Note
            key={note.id}
            note={note}
            letter={key?.letter ?? ""}
            visible={isVisible && layout.tops.has(note.id)}
            top={layout.tops.get(note.id)}
            resolution={resolutions.get(note.id)}
            onResolve={onResolve}
            ref={(element) => {
              if (element) noteRefs.current.set(note.id, element);
              else noteRefs.current.delete(note.id);
            }}
          />
        );
      })}
    </aside>
  );
}

function sameLayout(a: Layout, b: Layout) {
  const same = (
    x: ReadonlyMap<string, number>,
    y: ReadonlyMap<string, number>,
  ) => x.size === y.size && [...x].every(([id, value]) => y.get(id) === value);
  return a.height === b.height && same(a.tops, b.tops);
}

function glossHint(on: ReadonlySet<LayerId>, shown: number): ReactNode {
  if (shown > 0) return null;
  const noteLayers = (["world", "subtext", "time"] as const).filter((layer) =>
    on.has(layer),
  );
  if (noteLayers.length > 0) {
    return `Nothing to note on ${noteLayers.map((layer) => LAYER_LABELS[layer]).join(", ")} in this scene.`;
  }
  if (on.size === 0) {
    return "All layers are off. Turn one on to see it marked around the text.";
  }
  return (
    <>
      <b>{[...on].map((layer) => LAYER_LABELS[layer]).join(" and ")}</b>{" "}
      {on.size === 1 ? "layer" : "layers"} on. Turn on more layers to see the
      world, subtext and time marked around the text. Notes attach to the words
      they're about.
    </>
  );
}

function Note({
  note,
  letter,
  visible,
  top,
  resolution,
  onResolve,
  ref,
}: {
  note: GlossNote;
  letter: string;
  visible: boolean;
  top: number | undefined;
  resolution: NoteResolution | undefined;
  onResolve: (noteId: string, resolution: NoteResolution) => void;
  ref: (element: HTMLElement | null) => void;
}) {
  const confirmed = resolution === "confirmed";
  const act = (action: NoteAction) => {
    if (action.unavailable || action.resolves === "none") return;
    onResolve(
      note.id,
      action.resolves === "confirm" ? "confirmed" : "dismissed",
    );
  };
  return (
    <article
      ref={ref}
      className="gloss-note"
      data-layer={note.layer}
      data-visible={visible}
      aria-hidden={!visible}
      aria-label={`Note ${letter}: ${note.heading}`}
      style={top === undefined ? undefined : { top }}
    >
      <header className="gloss-head">
        <span className="gloss-key">{letter}</span>
        <span aria-hidden="true"> · </span>
        <span>{note.heading}</span>
        <em className="gloss-authority">
          {confirmed ? "confirmed" : note.authority}
        </em>
      </header>
      <p className="gloss-body">
        {note.body.map((run, i) =>
          run.strong ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: runs are static text
            <span key={i} className="gloss-strong">
              {run.text}
            </span>
          ) : (
            run.text
          ),
        )}
      </p>
      {!confirmed && note.actions.length > 0 && (
        <div className="gloss-actions">
          {note.actions.map((action) => (
            <button
              key={action.id}
              type="button"
              tabIndex={visible ? undefined : -1}
              aria-disabled={action.unavailable ? "true" : undefined}
              title={action.unavailable}
              onClick={() => act(action)}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}
