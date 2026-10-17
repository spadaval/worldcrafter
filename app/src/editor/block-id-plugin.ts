import {
  type Descendant,
  ElementApi,
  NodeApi,
  NodeIdPlugin,
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
 * - Loading fills in every missing ID and never changes an existing one.
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
  .overrideEditor(({ editor, getOptions, tf: { apply, insertData } }) => {
    let insertingData = 0;

    const idKey = () => getOptions().idKey ?? "id";
    const idInUse = (id: unknown) =>
      editor.api.some({ at: [], match: { [idKey()]: id } });

    /**
     * Decide which IDs an inserted subtree keeps. Dropped IDs are minted fresh
     * by the stock plugin. `_id` is the stock plugin's own carry-over marker
     * from `insertNodes`; this function replaces that logic, so it is removed.
     */
    const prepareInsertedNode = (root: Descendant): Descendant => {
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
          !idInUse(id);
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
          if (operation.type === "insert_node") {
            apply({ ...operation, node: prepareInsertedNode(operation.node) });
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
