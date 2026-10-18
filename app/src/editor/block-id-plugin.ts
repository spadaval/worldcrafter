import {
  type Descendant,
  ElementApi,
  NodeApi,
  NodeIdPlugin,
  type Path,
  type SlateEditor,
  type TElement,
  TextApi,
} from "platejs";

/**
 * Stable block IDs. Replaces Plate's core `nodeId` plugin (same key and
 * options), so `editor.getOptions(NodeIdPlugin)` keeps working.
 *
 * Rules, on top of stock NodeIdPlugin:
 * - Only block elements carry an ID. Text leaves and inline elements never do.
 * - Split: the ID stays with the block's leading content. Enter mid-block or at
 *   the end keeps the ID on the upper block; Enter at the very start of a
 *   non-empty block keeps it on the content (now the lower block) and gives the
 *   new empty block above a fresh ID.
 * - Undo/redo restore the IDs a block had before (`reuseId`), as long as the ID
 *   is not in use elsewhere in the document.
 * - Anything arriving through `insertData` (clipboard paste, drop) gets fresh
 *   IDs, even if the source block no longer exists or came from another
 *   document.
 * - Any other inserted block keeps its ID unless that ID is already in the
 *   document (or repeated within the inserted subtree), in which case it gets
 *   a fresh one.
 * - Loading fills in every missing ID. An ID repeated in the loaded value is
 *   kept by its first block in document order; later repeats get fresh IDs.
 *   Unique IDs are never changed.
 *
 * Uniqueness checks use an index of the document's IDs, rebuilt at most once
 * per operation and kept up to date across consecutive inserts, so undoing a
 * large delete stays linear in the document size.
 */
export const BlockIdPlugin = NodeIdPlugin.configure({
  options: { normalizeInitialValue: true, reuseId: true },
})
  .extend(({ editor }) => ({
    options: {
      // Stock only skips inline elements during normalize, not on insert.
      filter: ([node]) =>
        !ElementApi.isElement(node) || editor.api.isBlock(node),
    },
  }))
  .extend({
    normalizeInitialValue: ({ editor, getOptions, tf }) => {
      const key = getOptions().idKey ?? "id";
      const seen = new Set<unknown>();
      const repeats: Path[] = [];
      const visit = (node: Descendant, path: Path) => {
        if (!ElementApi.isElement(node)) return;
        const id = node[key];
        if (id !== undefined) {
          if (seen.has(id)) repeats.push(path);
          seen.add(id);
        }
        node.children.forEach((child, i) => {
          visit(child, [...path, i]);
        });
      };
      editor.children.forEach((node, i) => {
        visit(node, [i]);
      });
      editor.tf.withoutSaving(() => {
        for (const at of repeats) editor.tf.unsetNodes(key, { at });
      });
      // The stock normalisation fills every missing ID, including these.
      tf.nodeId.normalize();
    },
  })
  .overrideEditor(({ editor, getOptions, tf: { apply, insertData } }) => {
    let insertingData = 0;

    const idKey = () => getOptions().idKey ?? "id";

    /**
     * The IDs in `children`. Slate replaces `editor.children` on every change,
     * so a stale index is detected by reference.
     */
    let index: { children: unknown; ids: Set<unknown> } | null = null;
    /** Counts operations reaching this plugin, to detect nested ones. */
    let operationCount = 0;

    const usedIds = (): Set<unknown> => {
      if (index?.children !== editor.children) {
        const ids = new Set<unknown>();
        for (const node of editor.children) collectIds(node, idKey(), ids);
        index = { children: editor.children, ids };
      }
      return index.ids;
    };

    /**
     * Decide which IDs an inserted subtree keeps. Dropped IDs are minted fresh
     * by the stock plugin. `_id` is the stock plugin's own carry-over marker
     * from `insertNodes`; this function replaces that logic, so it is removed.
     */
    const prepareInsertedNode = (
      root: Descendant,
      used: Set<unknown>,
    ): Descendant => {
      const key = idKey();
      const seen = new Set<unknown>();
      const visit = (node: Descendant): Descendant => {
        if (!ElementApi.isElement(node)) return node;
        const id = node[key];
        const keep =
          insertingData === 0 &&
          editor.api.isBlock(node) &&
          id !== undefined &&
          !seen.has(id) &&
          !used.has(id);
        if (keep) seen.add(id);
        const element: TElement = {
          ...node,
          children: node.children.map(visit),
        };
        delete element._id;
        if (!keep) delete element[key];
        return element;
      };
      return visit(root);
    };

    return {
      transforms: {
        apply(operation) {
          const count = ++operationCount;
          if (operation.type === "insert_node") {
            const used = usedIds();
            apply({
              ...operation,
              node: prepareInsertedNode(operation.node, used),
            });
            // Normalising inside `apply` can run further operations; then the
            // index is dropped and rebuilt on next use instead of patched.
            const inserted = NodeApi.get<Descendant>(editor, operation.path);
            if (count === operationCount && index?.ids === used && inserted) {
              collectIds(inserted, idKey(), used);
              index = { children: editor.children, ids: used };
            } else {
              index = null;
            }
            return;
          }

          if (operation.type === "split_node") {
            const key = idKey();
            const node = NodeApi.get(editor, operation.path);
            const id = operation.properties[key];
            const { idCreator } = getOptions();
            // `properties` carrying the node's own ID means a fresh split
            // (Slate copies the props). On redo, or undo of a merge, it carries
            // the lower block's earlier ID instead, which `reuseId` restores.
            if (
              node &&
              ElementApi.isElement(node) &&
              editor.api.isBlock(node) &&
              id !== undefined &&
              id === node[key] &&
              idCreator &&
              isSplitAtStart(editor, node.children, operation.position)
            ) {
              apply({
                type: "set_node",
                path: operation.path,
                properties: { [key]: id },
                newProperties: { [key]: idCreator() },
              });
              apply(operation);
              return;
            }
          }

          apply(operation);
        },

        insertData(dataTransfer) {
          insertingData++;
          try {
            insertData(dataTransfer);
          } finally {
            insertingData--;
          }
        },
      },
    };
  });

function collectIds(node: Descendant, key: string, ids: Set<unknown>): void {
  if (!ElementApi.isElement(node)) return;
  const id = node[key];
  if (id !== undefined) ids.add(id);
  for (const child of node.children) collectIds(child, key, ids);
}

/** True when nothing precedes the split point and something follows it. */
const isSplitAtStart = (
  editor: SlateEditor,
  children: Descendant[],
  position: number,
) =>
  children.slice(0, position).every((child) => isEmptyNode(editor, child)) &&
  !children.slice(position).every((child) => isEmptyNode(editor, child));

const isEmptyNode = (editor: SlateEditor, node: Descendant): boolean =>
  TextApi.isText(node)
    ? node.text === ""
    : !editor.api.isVoid(node) &&
      node.children.every((child) => isEmptyNode(editor, child));
