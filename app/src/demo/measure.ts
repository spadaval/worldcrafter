/**
 * Times the signature interaction in a real browser: toggling a layer draws
 * its marks and notes in place, under 200 ms, with no reflow of the prose.
 * Loaded only with `?demo&measure`; `scripts/measure-layers.ts` drives it in
 * headless Chrome and reads `window.__layerMeasure`.
 *
 * For each toggle it records the time from the click to the first frame
 * painted after it (two animation frames: the commit, then the paint), and
 * compares the box of every prose block and the line boxes of every text
 * leaf before and after. Any difference is reflow.
 */
import type { LayerId } from "~/layers/model";

export interface ToggleMeasure {
  readonly layer: LayerId;
  readonly turnedOn: boolean;
  /** Click to the first painted frame after it, in milliseconds. */
  readonly msToPaint: number;
  /** Largest movement of any block box or text line box, in pixels. */
  readonly maxShiftPx: number;
  readonly blocks: number;
  readonly lineBoxes: number;
  readonly notesShown: number;
}

declare global {
  interface Window {
    __layerMeasure?: Promise<ToggleMeasure[]>;
  }
}

const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function until(test: () => boolean, timeoutMs = 10_000) {
  const started = performance.now();
  while (!test()) {
    if (performance.now() - started > timeoutMs) {
      throw new Error("the demo scene did not render");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function geometry(prose: Element): number[] {
  const numbers: number[] = [];
  for (const block of prose.querySelectorAll('[data-slate-node="element"]')) {
    const box = block.getBoundingClientRect();
    numbers.push(box.left, box.top, box.width, box.height);
  }
  for (const leaf of prose.querySelectorAll("[data-slate-leaf]")) {
    for (const box of leaf.getClientRects()) {
      numbers.push(box.left, box.top, box.width, box.height);
    }
  }
  return numbers;
}

export async function measureLayerToggles(
  doc: Document,
): Promise<ToggleMeasure[]> {
  const run = async () => {
    await until(() => doc.querySelector(".prose [data-anchor]") !== null);
    await doc.fonts.ready;
    await frame();
    await frame();
    const prose = doc.querySelector(".prose");
    if (!prose) throw new Error("no prose");
    const results: ToggleMeasure[] = [];
    // On one by one, then off in the same order.
    const order: LayerId[] = ["world", "subtext", "time", "notes", "speakers"];
    for (const pass of [0, 1]) {
      for (const layer of order) {
        const button = doc.querySelector<HTMLButtonElement>(
          `.layer-toggles [data-layer="${layer}"]`,
        );
        if (!button) throw new Error(`no ${layer} toggle`);
        const wasOn = button.getAttribute("aria-pressed") === "true";
        if (pass === 0 ? wasOn : !wasOn) continue;
        const before = geometry(prose);
        const clicked = performance.now();
        button.click();
        await frame();
        await frame();
        const painted = performance.now();
        const after = geometry(prose);
        const maxShiftPx =
          before.length === after.length
            ? Math.max(
                0,
                ...before.map((value, i) => Math.abs(value - (after[i] ?? 0))),
              )
            : Number.POSITIVE_INFINITY;
        results.push({
          layer,
          turnedOn: !wasOn,
          msToPaint: Math.round((painted - clicked) * 10) / 10,
          maxShiftPx,
          blocks: prose.querySelectorAll('[data-slate-node="element"]').length,
          lineBoxes: after.length / 4,
          notesShown: doc.querySelectorAll('.gloss-note[data-visible="true"]')
            .length,
        });
        // Let the draw finish before the next toggle.
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    return results;
  };
  window.__layerMeasure = run();
  return window.__layerMeasure;
}
