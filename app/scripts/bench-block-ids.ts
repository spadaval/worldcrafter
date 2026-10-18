/**
 * Times select-all, delete and undo on a ~3000-block document, with stock
 * NodeIdPlugin and with BlockIdPlugin. Run: `bun scripts/bench-block-ids.ts`.
 */
import "../src/test/happy-dom";
import { NodeIdPlugin, type Value } from "platejs";
import { createPlateEditor } from "platejs/react";
import { BlockIdPlugin } from "../src/editor/block-id-plugin";

const BLOCKS = 3000;
const value = (): Value =>
  Array.from({ length: BLOCKS }, (_, i) => ({
    type: "p",
    id: `b${i}`,
    children: [{ text: `Paragraph ${i} with some ordinary prose in it.` }],
  }));

function run(label: string, editor: ReturnType<typeof createPlateEditor>) {
  const time = (name: string, action: () => void) => {
    const start = performance.now();
    editor.tf.withNewBatch(action);
    console.log(
      `${label} ${name}: ${(performance.now() - start).toFixed(0)} ms`,
    );
  };
  time("select-all + delete", () => {
    editor.tf.select([]);
    editor.tf.deleteFragment();
  });
  time("undo", () => editor.tf.undo());
  time("redo", () => editor.tf.redo());
  if (editor.children.length !== 1) throw new Error("redo did not delete");
}

run(
  "stock",
  createPlateEditor({
    plugins: [NodeIdPlugin.configure({ options: { reuseId: true } })],
    value: value(),
  }),
);
run(
  "BlockIdPlugin",
  createPlateEditor({ plugins: [BlockIdPlugin], value: value() }),
);
