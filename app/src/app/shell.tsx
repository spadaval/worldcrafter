import { Link, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import type { CommandError } from "~/workspace/workspace";
import { describeCommandError } from "./environment";
import { useEnvironment, useStore, useWorkspace } from "./hooks";

/**
 * The workspace frame, laid out for the Night Edition design
 * (.impeccable/surfaces/writing-workspace.md): a 300px left rail, a 56px
 * header with the tab strip, and the page (prose column plus gloss column).
 */
export function Shell() {
  const [error, setError] = useState<CommandError | null>(null);
  return (
    <div className="workspace">
      <Rail onError={setError} />
      <header className="masthead">
        <TabStrip onError={setError} />
      </header>
      <div className="notices" aria-live="polite">
        <Notices />
        {error && (
          <p className="notice notice-error" role="alert">
            {describeCommandError(error)}{" "}
            <button type="button" onClick={() => setError(null)}>
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

function Rail({ onError }: { onError: (error: CommandError) => void }) {
  const workspace = useWorkspace();
  const documents = useStore(workspace.documents);
  const navigate = useNavigate();
  const active = useActiveDocumentId();
  const create = async () => {
    const created = await workspace.commands.createDocument();
    if (created.isErr()) return onError(created.error);
    await navigate({
      to: "/doc/$documentId",
      params: { documentId: created.value.documentId },
    });
  };
  return (
    <nav className="rail" aria-label="Documents">
      <div className="rail-head">
        <span className="wordmark">WorldCrafter</span>
        <button
          type="button"
          onClick={create}
          disabled={workspace.readOnly}
          className="quiet-button"
        >
          New document
        </button>
      </div>
      {documents.length === 0 ? (
        <p className="rail-empty">No documents yet.</p>
      ) : (
        <ul className="document-list">
          {documents.map((document) => (
            <li key={document.id}>
              <Link
                to="/doc/$documentId"
                params={{ documentId: document.id }}
                aria-current={document.id === active ? "page" : undefined}
              >
                {document.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

function TabStrip({ onError }: { onError: (error: CommandError) => void }) {
  const workspace = useWorkspace();
  const tabs = useStore(workspace.tabs);
  const documents = useStore(workspace.documents);
  const navigate = useNavigate();
  const active = useActiveDocumentId();
  const titleOf = (id: string) =>
    documents.find((document) => document.id === id)?.title ?? "…";

  const close = async (id: string) => {
    const closed = await workspace.commands.closeTab(id);
    // Saved, but reopened meanwhile: nothing to tell the writer.
    if (closed.isErr() && closed.error.kind === "still_open") return;
    if (closed.isErr()) return onError(closed.error);
    if (id !== active) return;
    const next = closed.value.active;
    await (next
      ? navigate({ to: "/doc/$documentId", params: { documentId: next } })
      : navigate({ to: "/" }));
  };

  return (
    <nav className="tab-strip" aria-label="Open documents">
      {tabs.open.map((id) => (
        <div key={id} className="tab" data-active={id === active}>
          <Link
            to="/doc/$documentId"
            params={{ documentId: id }}
            aria-current={id === active ? "page" : undefined}
          >
            {titleOf(id)}
          </Link>
          <button
            type="button"
            className="tab-close"
            aria-label={`Close ${titleOf(id)}`}
            onClick={() => close(id)}
          >
            ×
          </button>
        </div>
      ))}
    </nav>
  );
}

/** Conditions the writer must know about: they affect whether work is kept. */
function Notices() {
  const workspace = useWorkspace();
  const { role, persistence } = useEnvironment();
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
      {persistence !== "granted" && (
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
