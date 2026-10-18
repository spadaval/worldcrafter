import { useParams } from "@tanstack/react-router";
import { Plate } from "platejs/react";
import { useEffect, useState } from "react";
import type { DocumentSession, SaveStatus } from "~/workspace/document-session";
import type { CommandError } from "~/workspace/workspace";
import { describeCommandError, describeSaveStatus } from "./environment";
import { Sheet } from "./gloss";
import { useServices, useStore, useWorkspace } from "./hooks";

export function HomePage() {
  const workspace = useWorkspace();
  return (
    <div className="page-empty">
      <p>
        {workspace.readOnly
          ? "Pick a scene or document from the rail to read it."
          : "Pick a scene or document from the rail, or start a new document."}
      </p>
    </div>
  );
}

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "open"; readonly session: DocumentSession }
  | { readonly kind: "error"; readonly error: CommandError };

/** Opens the document in the URL as the active tab. */
export function DocumentPage() {
  const { documentId } = useParams({ from: "/doc/$documentId" });
  const workspace = useWorkspace();
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });

  useEffect(() => {
    let current = true;
    setLoaded({ kind: "loading" });
    void workspace.commands.openDocument(documentId).then((result) => {
      if (!current) return;
      setLoaded(
        result.isOk()
          ? { kind: "open", session: result.value }
          : { kind: "error", error: result.error },
      );
    });
    return () => {
      current = false;
    };
  }, [workspace, documentId]);

  if (loaded.kind === "loading") return null;
  if (loaded.kind === "error") {
    return (
      <div className="page-empty" role="alert">
        <p>{describeCommandError(loaded.error)}</p>
      </div>
    );
  }
  return <DocumentView key={documentId} session={loaded.session} />;
}

function DocumentView({ session }: { session: DocumentSession }) {
  const { manuscript } = useServices();
  const state = useStore(manuscript.state);
  const scene =
    state.kind === "ready"
      ? state.view.scenes.get(session.documentId)
      : undefined;
  return (
    <Plate editor={session.editor} readOnly={session.readOnly}>
      <Sheet
        session={session}
        head={
          <div className="document-head">
            <div className="head-margin">
              {scene && (
                <span className="scene-number" aria-hidden="true">
                  {scene.position}
                </span>
              )}
              <SaveStatusLine session={session} />
            </div>
            <TitleField session={session} />
            <SaveProblem session={session} />
          </div>
        }
      />
    </Plate>
  );
}

/** Commits the title on Enter or when focus leaves. */
function TitleField({ session }: { session: DocumentSession }) {
  const workspace = useWorkspace();
  const title = useStore(session.title);
  const [draft, setDraft] = useState(title);
  useEffect(() => setDraft(title), [title]);
  const commit = () => {
    if (draft !== title) {
      void workspace.commands.renameDocument(session.documentId, draft);
    }
  };
  return (
    <input
      className="title-field"
      aria-label="Title"
      value={draft}
      readOnly={session.readOnly}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

const isProblem = (status: SaveStatus) =>
  status.kind === "invalid" || status.kind === "failed";

/** The short status, in the margin beside the title. */
function SaveStatusLine({ session }: { session: DocumentSession }) {
  const status = useStore(session.status);
  return (
    <output
      className={
        isProblem(status) ? "save-status save-status-problem" : "save-status"
      }
    >
      {isProblem(status) ? "Not saved" : describeSaveStatus(status)}
    </output>
  );
}

/** What went wrong and what happens next, under the title, when a save fails. */
function SaveProblem({ session }: { session: DocumentSession }) {
  const status = useStore(session.status);
  if (!isProblem(status)) return null;
  return (
    <p className="save-problem" role="alert">
      {describeSaveStatus(status)}
    </p>
  );
}
