import { useParams } from "@tanstack/react-router";
import { Plate, PlateContent } from "platejs/react";
import { useEffect, useState } from "react";
import type { DocumentSession } from "~/workspace/document-session";
import type { CommandError } from "~/workspace/workspace";
import { describeCommandError, describeSaveStatus } from "./environment";
import { useStore, useWorkspace } from "./hooks";

export function HomePage() {
  const workspace = useWorkspace();
  return (
    <div className="page-empty">
      <p>
        {workspace.readOnly
          ? "Pick a document from the list to read it."
          : "Pick a document from the list, or create a new one."}
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
  return (
    <div className="document">
      <div className="prose-column">
        <div className="document-head">
          <TitleField session={session} />
          <SaveStatusLine session={session} />
        </div>
        <Plate editor={session.editor} readOnly={session.readOnly}>
          <PlateContent
            className="prose"
            aria-label="Document text"
            readOnly={session.readOnly}
            placeholder="Begin…"
          />
        </Plate>
      </div>
      {/* Gloss notes, context and AI review arrive in later increments. */}
      <aside className="gloss-column" aria-label="Notes" />
    </div>
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

function SaveStatusLine({ session }: { session: DocumentSession }) {
  const status = useStore(session.status);
  const problem = status.kind === "invalid" || status.kind === "failed";
  return (
    <p
      className={problem ? "save-status save-status-problem" : "save-status"}
      role={problem ? "alert" : "status"}
    >
      {describeSaveStatus(status)}
    </p>
  );
}
