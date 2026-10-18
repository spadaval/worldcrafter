import { Link, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { textBlocks } from "~/editor/layer-plugin";
import { LAYER_LABELS, LAYERS, layersForScene, mentions } from "~/layers/model";
import { createStore } from "~/workspace/store";
import type { CommandError } from "~/workspace/workspace";
import { KIND_DEFINITIONS } from "~/world/kinds";
import { describeCommandError } from "./environment";
import { useEnvironment, useServices, useStore, useWorkspace } from "./hooks";
import { formatStoryTime } from "./manuscript";
import { Rail } from "./rail";
import { entryNames } from "./world";

/** A message for the writer: an error, or a note about what isn't built yet. */
type Message =
  | { readonly kind: "error"; readonly error: CommandError }
  | { readonly kind: "info"; readonly text: string };

/**
 * The workspace frame, to the Night Edition direction
 * (.impeccable/surfaces/writing-workspace.md): a 300px left rail, a 56px
 * header with the tab strip, story-time stamp, layer toggles and generation
 * controls, and the page (prose column plus gloss column).
 */
export function Shell() {
  const [message, setMessage] = useState<Message | null>(null);
  // Narrow screens only: the rail opens over the page.
  const [railOpen, setRailOpen] = useState(false);
  const active = useActiveDocumentId();
  // biome-ignore lint/correctness/useExhaustiveDependencies: opening a document closes the rail
  useEffect(() => setRailOpen(false), [active]);
  const onError = (error: CommandError) => setMessage({ kind: "error", error });
  const info = (text: string) => setMessage({ kind: "info", text });
  return (
    <div className="workspace" data-rail-open={railOpen ? "" : undefined}>
      <Rail active={active} onError={onError} />
      <header className="masthead">
        <button
          type="button"
          className="rail-toggle"
          aria-expanded={railOpen}
          aria-label="Manuscript and world"
          onClick={() => setRailOpen((open) => !open)}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M1 3h12M1 7h12M1 11h7"
              stroke="currentColor"
              strokeWidth="1.25"
            />
          </svg>
        </button>
        <TabStrip active={active} onMessage={setMessage} />
        <StoryTimeStamp active={active} />
        <div className="masthead-controls">
          {active && <LayerToggles documentId={active} />}
          <ContextButton active={active} onInfo={info} />
          <GenerateNext active={active} onInfo={info} />
        </div>
      </header>
      <div className="notices" aria-live="polite">
        <Notices />
        <GenerationNotice />
        {message && (
          <p
            className={
              message.kind === "error" ? "notice notice-error" : "notice"
            }
            role={message.kind === "error" ? "alert" : "status"}
          >
            {message.kind === "error"
              ? describeCommandError(message.error)
              : message.text}{" "}
            <button
              type="button"
              className="notice-dismiss"
              onClick={() => setMessage(null)}
            >
              Dismiss
            </button>
          </p>
        )}
      </div>
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}

const useActiveDocumentId = () =>
  useParams({ strict: false }).documentId ?? null;

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

/** True for the error of a close of `id` that failed with unsaved changes. */
const isFailedClose = (message: Message | null, id: string) =>
  message?.kind === "error" &&
  message.error.kind === "unsaved" &&
  message.error.documentId === id;

function TabStrip({
  active,
  onMessage,
}: {
  active: string | null;
  onMessage: Dispatch<SetStateAction<Message | null>>;
}) {
  const { workspace, manuscript, worldIndex, generation } = useServices();
  const entries = useStore(worldIndex.entries);
  const tabs = useStore(workspace.tabs);
  const documents = useStore(workspace.documents);
  const state = useStore(manuscript.state);
  const navigate = useNavigate();
  // Documents whose last close failed with unsaved changes.
  const failedCloses = useRef(new Set<string>());
  const titleOf = (id: string) =>
    documents.find((document) => document.id === id)?.title ?? "…";
  const sceneOf = (id: string) =>
    state.kind === "ready" ? state.view.scenes.get(id) : undefined;

  const close = async (id: string, retried = false): Promise<void> => {
    // A generation writes into the document until it ends: end it first,
    // keeping what arrived, so closing saves all of it.
    await generation.stop(id);
    if (generation.slip.get()?.documentId === id) generation.closeSlip();
    const closed = await workspace.commands.closeTab(id);
    if (closed.isErr() && closed.error.kind === "still_open") {
      // Saved, but an earlier failed close gave the tab its lease back: its
      // error is stale now, and this close can finish. Reopened by the
      // writer meanwhile: nothing to tell them.
      // Known edge: if the writer reopens the document while this close is
      // saving after a failed one, the retry closes the tab they reopened.
      // Nothing is lost (closing saves first); they reopen it from the rail.
      if (failedCloses.current.delete(id)) {
        onMessage((current) => (isFailedClose(current, id) ? null : current));
        if (!retried) return close(id, true);
      }
      return;
    }
    if (closed.isErr()) {
      if (closed.error.kind === "unsaved") failedCloses.current.add(id);
      onMessage({ kind: "error", error: closed.error });
      return;
    }
    failedCloses.current.delete(id);
    onMessage((current) => (isFailedClose(current, id) ? null : current));
    if (id !== active) return;
    const next = closed.value.active;
    await (next
      ? navigate({ to: "/doc/$documentId", params: { documentId: next } })
      : navigate({ to: "/" }));
  };

  return (
    <nav className="tab-strip" aria-label="Open documents">
      {tabs.open.map((id) => {
        const scene = sceneOf(id);
        const isActive = id === active;
        const kind = entries.get(id)?.kind;
        const crumb = scene
          ? scene.chapterTitle
          : kind
            ? `World › ${KIND_DEFINITIONS[kind].label}`
            : "";
        return (
          <div key={id} className="tab" data-active={isActive}>
            <Link
              to="/doc/$documentId"
              params={{ documentId: id }}
              aria-current={isActive ? "page" : undefined}
            >
              {isActive && crumb && <span className="crumb">{crumb} › </span>}
              <span className="tab-title">
                {scene && isActive ? `${scene.position} ` : ""}
                {titleOf(id)}
              </span>
            </Link>
            <button
              type="button"
              className="tab-close"
              aria-label={`Close ${titleOf(id)}`}
              onClick={() => void close(id)}
            >
              <CloseIcon />
            </button>
          </div>
        );
      })}
    </nav>
  );
}

function StoryTimeStamp({ active }: { active: string | null }) {
  const { manuscript } = useServices();
  const state = useStore(manuscript.state);
  if (!active || state.kind !== "ready") return null;
  const scene = state.view.scenes.get(active);
  if (!scene) return null;
  if (!scene.time) {
    return (
      <p className="stamp stamp-undated">
        <span className="visually-hidden">Story time: </span>Not yet placed in
        time
      </p>
    );
  }
  return (
    <p className="stamp">
      <span className="visually-hidden">Story time: </span>
      {formatStoryTime(scene.time)}
      {scene.time.authority.level === "inferred" && (
        <span className="stamp-inferred">inferred</span>
      )}
    </p>
  );
}

function LayerToggles({ documentId }: { documentId: string }) {
  const { layers } = useServices();
  const state = useStore(layers);
  const on = layersForScene(state.on, state.subtextScenes, documentId);
  return (
    <fieldset className="layer-toggles">
      <legend className="visually-hidden">Layers</legend>
      {LAYERS.map((layer) => (
        <button
          key={layer}
          type="button"
          aria-pressed={on.has(layer)}
          data-layer={layer}
          title={
            layer === "subtext"
              ? "Subtext is turned on for this scene only"
              : undefined
          }
          onClick={() => {
            performance.mark(`layer-toggle:${layer}`);
            layers.toggle(layer, documentId);
          }}
        >
          {LAYER_LABELS[layer]}
        </button>
      ))}
    </fieldset>
  );
}

const NO_STATUS = createStore<unknown>(null);

/**
 * Opens the request for what comes next in the active document, or with
 * no model set up, the model settings. Re-renders with the tabs, so it sees
 * a session once it has loaded.
 */
function useOpenRequest(active: string | null) {
  const { workspace, generation } = useServices();
  const navigate = useNavigate();
  useStore(workspace.tabs);
  const session = active ? workspace.session(active) : undefined;
  const running = useStore(generation.active(active ?? "")) !== null;
  const [preparing, setPreparing] = useState(false);
  const open = async () => {
    if (!active || !session) return;
    if (!generation.profile.get()) {
      await generation.openRequest(active);
      await navigate({ to: "/model" });
      return;
    }
    setPreparing(true);
    await generation.openRequest(active);
    setPreparing(false);
  };
  return {
    open,
    /** Why it can't open now, if it can't. */
    unavailable: !session
      ? "Open a document to generate in it."
      : session.readOnly
        ? "This tab is read-only because WorldCrafter is open in another tab."
        : running
          ? "A generation is running. Stop it or let it finish first."
          : preparing
            ? "Assembling the request…"
            : null,
  };
}

/**
 * The context control: how many world entries this scene names, which is
 * what generation would draw on. Shows or puts away the request slip.
 */
function ContextButton({
  active,
  onInfo,
}: {
  active: string | null;
  onInfo: (text: string) => void;
}) {
  const { workspace, worldIndex, generation } = useServices();
  const entries = useStore(worldIndex.entries);
  const documents = useStore(workspace.documents);
  const slip = useStore(generation.slip);
  const { open, unavailable } = useOpenRequest(active);
  const session = active ? workspace.session(active) : undefined;
  const status = useStore<unknown>(session?.status ?? NO_STATUS);
  const count = useMemo(() => {
    void status;
    if (!session) return 0;
    const names = entryNames(
      entries,
      (id) => documents.find((d) => d.id === id)?.title,
    );
    const found = new Set<string>();
    for (const block of textBlocks(session.editor.children)) {
      for (const mention of mentions(block.text, names)) {
        if (mention.entryId !== active) found.add(mention.entryId);
      }
    }
    return found.size;
  }, [session, status, entries, documents, active]);
  const shown = slip !== null && slip.documentId === active;
  return (
    <button
      type="button"
      className="button"
      aria-expanded={shown}
      aria-disabled={!shown && unavailable ? "true" : undefined}
      title={!shown ? (unavailable ?? undefined) : undefined}
      onClick={() => {
        if (shown) generation.closeSlip();
        else if (unavailable) onInfo(unavailable);
        else void open();
      }}
    >
      Context · {count} {count === 1 ? "card" : "cards"}
    </button>
  );
}

/** Opens the request slip for what comes next; with it open, goes to its Send. */
function GenerateNext({
  active,
  onInfo,
}: {
  active: string | null;
  onInfo: (text: string) => void;
}) {
  const { generation } = useServices();
  const slip = useStore(generation.slip);
  const { open, unavailable } = useOpenRequest(active);
  return (
    <button
      type="button"
      className="button button-primary"
      aria-disabled={unavailable ? "true" : undefined}
      title={unavailable ?? undefined}
      onClick={() => {
        if (unavailable) return onInfo(unavailable);
        if (slip?.documentId === active) {
          // Assembling again would discard edits not yet sent.
          const send = document.querySelector<HTMLElement>(
            ".request-slip .context-viewer-send",
          );
          send?.scrollIntoView?.({ block: "nearest" });
          send?.focus();
          return;
        }
        void open();
      }}
    >
      Generate next
    </button>
  );
}

/** What the last generation command came to, when there is something to say. */
function GenerationNotice() {
  const { generation } = useServices();
  const notice = useStore(generation.notice);
  if (!notice) return null;
  return (
    <p
      className={notice.kind === "error" ? "notice notice-error" : "notice"}
      role={notice.kind === "error" ? "alert" : "status"}
    >
      {notice.text}{" "}
      <button
        type="button"
        className="notice-dismiss"
        onClick={generation.dismissNotice}
      >
        Dismiss
      </button>
    </p>
  );
}

/** Conditions the writer must know about: they affect whether work is kept. */
function Notices() {
  const workspace = useWorkspace();
  const { role, persistence, storage } = useEnvironment();
  const connection = useStore(workspace.connection.status);
  return (
    <>
      {role === "reader" && (
        <p className="notice">
          WorldCrafter is open in another tab, so this tab is read-only. Close
          the other tab and reload to edit here.
        </p>
      )}
      {role === "unguarded" && (
        <p className="notice">
          This browser can't stop two tabs editing at once. Keep WorldCrafter
          open in one tab only, or one tab's changes will overwrite the other's.
        </p>
      )}
      {storage === "indexeddb" && persistence !== "granted" && (
        <p className="notice">
          {persistence === "refused"
            ? "The browser refused persistent storage."
            : "This browser doesn't offer persistent storage."}{" "}
          It may delete this world when the disk is low.
        </p>
      )}
      {connection.kind === "lost" && (
        <p className="notice notice-error" role="alert">
          Storage is unavailable ({connection.error.message}). Your changes are
          kept in this tab and retried; don't close it. Reloading may help once
          other WorldCrafter tabs are closed.
        </p>
      )}
    </>
  );
}
