import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { speakerTints } from "~/layers/model";
import type { CommandError } from "~/workspace/workspace";
import { KIND_DEFINITIONS } from "~/world/kinds";
import { useServices, useStore } from "./hooks";
import type { ManuscriptBook, SceneRow } from "./manuscript";

type RailView = "manuscript" | "world" | "topics";

const VIEWS: { id: RailView; label: string }[] = [
  { id: "manuscript", label: "Manuscript" },
  { id: "world", label: "World" },
  { id: "topics", label: "Topics" },
];

/** Rows of the reading-order list, and of the chronology spark beside it. */
const ROW = 32;

export function Rail({
  active,
  onError,
}: {
  active: string | null;
  onError: (error: CommandError) => void;
}) {
  const { environment, layerSource } = useServices();
  const [view, setView] = useState<RailView>("manuscript");
  const topics = layerSource.topics;
  return (
    <nav className="rail" aria-label="Manuscript and world">
      <div className="rail-brand">
        <span className="wordmark">WorldCrafter</span>
        {environment.worldName && (
          <span className="world-name">{environment.worldName}</span>
        )}
      </div>
      <div className="rail-views" role="tablist" aria-label="Rail">
        {VIEWS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`rail-tab-${id}`}
            aria-selected={view === id}
            aria-controls="rail-panel"
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className="rail-panel"
        id="rail-panel"
        role="tabpanel"
        aria-labelledby={`rail-tab-${view}`}
      >
        {view === "manuscript" && (
          <ManuscriptPanel active={active} onError={onError} />
        )}
        {view === "world" && <WorldPanel active={active} />}
        {view === "topics" && <TopicsPanel />}
      </div>
      <footer className="rail-foot">
        <p>
          {topics.length === 0 ? (
            "No open topics in the world inbox"
          ) : (
            <>
              <b>
                {topics.length} open {topics.length === 1 ? "topic" : "topics"}
              </b>{" "}
              in the world inbox
            </>
          )}
        </p>
        {environment.storage === "memory" && (
          <p className="rail-demo">
            Synthetic demo world, held in memory. Nothing is saved.
          </p>
        )}
      </footer>
    </nav>
  );
}

function ManuscriptPanel({
  active,
  onError,
}: {
  active: string | null;
  onError: (error: CommandError) => void;
}) {
  const { manuscript, workspace, worldIndex } = useServices();
  const state = useStore(manuscript.state);
  const documents = useStore(workspace.documents);
  const entries = useStore(worldIndex.entries);
  const navigate = useNavigate();
  const titleOf = (id: string) =>
    documents.find((document) => document.id === id)?.title ?? "Untitled";

  const create = async () => {
    const created = await workspace.commands.createDocument();
    if (created.isErr()) return onError(created.error);
    await navigate({
      to: "/doc/$documentId",
      params: { documentId: created.value.documentId },
    });
  };

  const view = state.kind === "ready" ? state.view : null;
  const loose = documents.filter(
    (document) => !view?.scenes.has(document.id) && !entries.has(document.id),
  );
  return (
    <>
      {state.kind === "error" && (
        <p className="rail-empty" role="alert">
          {state.message}
        </p>
      )}
      {view?.books.map((book) => (
        <BookSection
          key={book.id}
          book={book}
          active={active}
          titleOf={titleOf}
        />
      ))}
      {active && view?.scenes.has(active) && <SpeakersPanel scene={active} />}
      <section className="rail-section" aria-labelledby="rail-drafts">
        <div className="rail-label">
          <h2 id="rail-drafts">
            {view && view.books.length > 0
              ? "Not in the manuscript"
              : "Documents"}
          </h2>
          <button
            type="button"
            className="rail-action"
            onClick={create}
            disabled={workspace.readOnly}
          >
            New document
          </button>
        </div>
        {loose.length === 0 ? (
          documents.length === 0 && (
            <p className="rail-empty">No documents yet.</p>
          )
        ) : (
          <ul className="document-list">
            {loose.map((document) => (
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
      </section>
    </>
  );
}

function BookSection({
  book,
  active,
  titleOf,
}: {
  book: ManuscriptBook;
  active: string | null;
  titleOf: (id: string) => string;
}) {
  const labelId = `rail-book-${book.id}`;
  return (
    <section className="rail-section" aria-labelledby={labelId}>
      <div className="rail-label">
        <h2 id={labelId}>{book.title} · reading order</h2>
        <span aria-hidden="true">Time</span>
      </div>
      <div className="reading-order">
        <ol className="scene-list">
          {book.scenes.map((scene) => (
            <li key={scene.documentId}>
              <Link
                to="/doc/$documentId"
                params={{ documentId: scene.documentId }}
                aria-current={scene.documentId === active ? "page" : undefined}
                className="scene-row"
              >
                <span className="scene-position">{scene.position}</span>
                <span className="scene-title">{titleOf(scene.documentId)}</span>
                {scene.flashback && scene.time && (
                  <span className="scene-year">
                    <span className="visually-hidden">, flashback to </span>
                    {Math.floor(scene.time.start)}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ol>
        <ChronologySpark scenes={book.scenes} active={active} />
      </div>
      <SparkAxis scenes={book.scenes} />
    </section>
  );
}

function range(scenes: readonly SceneRow[]) {
  const placed = scenes.flatMap((scene) => (scene.time ? [scene.time] : []));
  if (placed.length === 0) return null;
  return {
    min: Math.min(...placed.map((time) => time.start)),
    max: Math.max(...placed.map((time) => time.start)),
  };
}

const SPARK_WIDTH = 64;
const SPARK_INSET = 6;

/**
 * Where each scene lies in world time, beside the scenes in reading order:
 * one row per scene, world time left to right. A flashback reads as a jump
 * to the left. Scenes the timeline doesn't place break the line.
 */
function ChronologySpark({
  scenes,
  active,
}: {
  scenes: readonly SceneRow[];
  active: string | null;
}) {
  const span = range(scenes);
  if (span === null) return null;
  const width = SPARK_WIDTH - SPARK_INSET * 2;
  const x = (start: number) =>
    span.max === span.min
      ? SPARK_WIDTH / 2
      : SPARK_INSET + ((start - span.min) / (span.max - span.min)) * width;
  const height = scenes.length * ROW;
  const runs: string[][] = [[]];
  scenes.forEach((scene, i) => {
    if (!scene.time) {
      runs.push([]);
      return;
    }
    runs.at(-1)?.push(`${x(scene.time.start)},${i * ROW + ROW / 2}`);
  });
  return (
    <svg
      className="spark"
      width={SPARK_WIDTH}
      height={height}
      viewBox={`0 0 ${SPARK_WIDTH} ${height}`}
      role="img"
      aria-label="Chronology: where each scene falls in world time, in reading order"
    >
      <line
        className="spark-rule"
        x1={SPARK_INSET}
        x2={SPARK_INSET}
        y1={2}
        y2={height - 2}
      />
      <line
        className="spark-rule"
        x1={SPARK_WIDTH - SPARK_INSET}
        x2={SPARK_WIDTH - SPARK_INSET}
        y1={2}
        y2={height - 2}
      />
      {runs
        .filter((run) => run.length > 1)
        .map((run) => (
          <polyline
            key={run.join(" ")}
            className="spark-line"
            points={run.join(" ")}
          />
        ))}
      {scenes.map((scene, i) =>
        scene.time ? (
          <circle
            key={scene.documentId}
            className={
              scene.documentId === active
                ? "spark-point spark-current"
                : scene.flashback
                  ? "spark-point spark-flashback"
                  : "spark-point"
            }
            cx={x(scene.time.start)}
            cy={i * ROW + ROW / 2}
            r={scene.documentId === active ? 4.5 : scene.flashback ? 3.5 : 2.5}
          />
        ) : null,
      )}
    </svg>
  );
}

function SparkAxis({ scenes }: { scenes: readonly SceneRow[] }) {
  const span = range(scenes);
  if (span === null) return null;
  const [from, to] = [Math.floor(span.min), Math.floor(span.max)];
  return (
    <div className="spark-axis" aria-hidden="true">
      <span>{from}</span>
      {to !== from && <span>{to}</span>}
    </div>
  );
}

function SpeakersPanel({ scene }: { scene: string }) {
  const { layerSource, workspace } = useServices();
  const documents = useStore(workspace.documents);
  const { speakers } = layerSource.scene(scene);
  const tints = speakerTints(speakers);
  return (
    <section
      className="rail-section rail-speakers"
      aria-labelledby="rail-speakers"
    >
      <div className="rail-label">
        <h2 id="rail-speakers">Speaking in this scene</h2>
      </div>
      {speakers.length === 0 ? (
        <p className="rail-empty">No speakers marked yet.</p>
      ) : (
        <ul className="speaker-list">
          {speakers.map((speaker) => {
            const swatch = (
              <span
                className="speaker-swatch"
                data-say={tints.get(speaker.id)}
              />
            );
            const entry = speaker.entryId;
            return (
              <li key={speaker.id}>
                {entry && documents.some((d) => d.id === entry) ? (
                  <Link to="/doc/$documentId" params={{ documentId: entry }}>
                    {swatch}
                    {speaker.name}
                  </Link>
                ) : (
                  <span>
                    {swatch}
                    {speaker.name}
                    <span className="speaker-new"> · not in the world yet</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function WorldPanel({ active }: { active: string | null }) {
  const { worldIndex, workspace } = useServices();
  const entries = useStore(worldIndex.entries);
  const documents = useStore(workspace.documents);
  const listed = documents.filter(
    (document) =>
      entries.get(document.id)?.kind !== undefined &&
      entries.get(document.id)?.kind !== "scene",
  );
  if (listed.length === 0) {
    return <p className="rail-empty rail-section">No world entries yet.</p>;
  }
  const kinds = [...new Set(listed.map((d) => entries.get(d.id)?.kind))];
  return (
    <>
      {kinds.map((kind) =>
        kind === undefined ? null : (
          <section
            key={kind}
            className="rail-section"
            aria-labelledby={`rail-kind-${kind}`}
          >
            <div className="rail-label">
              <h2 id={`rail-kind-${kind}`}>{KIND_DEFINITIONS[kind].label}</h2>
            </div>
            <ul className="document-list">
              {listed
                .filter((d) => entries.get(d.id)?.kind === kind)
                .sort((a, b) => a.title.localeCompare(b.title))
                .map((document) => (
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
          </section>
        ),
      )}
    </>
  );
}

function TopicsPanel() {
  const { layerSource } = useServices();
  const topics = layerSource.topics;
  if (topics.length === 0) {
    return <p className="rail-empty rail-section">No open topics.</p>;
  }
  return (
    <section className="rail-section" aria-labelledby="rail-topics">
      <div className="rail-label">
        <h2 id="rail-topics">Open topics</h2>
      </div>
      <ul className="topic-list">
        {topics.map((topic) => (
          <li key={topic.id}>
            <span className="topic-title">{topic.title}</span>
            <span className="topic-about">{topic.about}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
