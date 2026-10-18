/**
 * Measures the signature interaction in headless Chrome: each layer toggle in
 * the demo scene, timed from click to the first painted frame, with every
 * prose block and line box compared before and after (any movement is
 * reflow). Run `bun run build` first, then `bun scripts/measure-layers.ts`.
 * Exits non-zero if a toggle takes 200 ms or more, or moves the prose.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = 9333;
const page = fileURLToPath(new URL("../dist/index.html", import.meta.url));
const url = `file://${page}?demo&measure#/`;

const chrome = spawn(
  "google-chrome",
  [
    "--headless=new",
    "--disable-gpu",
    "--allow-file-access-from-files",
    "--window-size=1440,900",
    `--remote-debugging-port=${PORT}`,
    "--user-data-dir=/tmp/worldcrafter-measure",
    url,
  ],
  { stdio: "ignore" },
);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Target {
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

async function pageTarget(): Promise<Target> {
  for (let i = 0; i < 100; i++) {
    try {
      const targets = (await (
        await fetch(`http://127.0.0.1:${PORT}/json`)
      ).json()) as Target[];
      const found = targets.find(
        (t) => t.type === "page" && t.url.includes("index.html"),
      );
      if (found) return found;
    } catch {
      // Chrome is still starting.
    }
    await sleep(100);
  }
  throw new Error("Chrome did not open the page");
}

function evaluate(socket: WebSocket, id: number, expression: string) {
  return new Promise<unknown>((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: { result?: { value?: unknown }; exceptionDetails?: unknown };
      };
      if (message.id !== id) return;
      socket.removeEventListener("message", onMessage);
      if (message.result?.exceptionDetails) {
        reject(new Error(JSON.stringify(message.result.exceptionDetails)));
      } else resolve(message.result?.result?.value);
    };
    socket.addEventListener("message", onMessage);
    socket.send(
      JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    );
  });
}

let exitCode = 1;
try {
  const target = await pageTarget();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve));
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    ready = (await evaluate(socket, i + 1, "!!window.__layerMeasure")) === true;
    if (!ready) await sleep(100);
  }
  const results = (await evaluate(socket, 1000, "window.__layerMeasure")) as {
    layer: string;
    turnedOn: boolean;
    msToPaint: number;
    maxShiftPx: number;
    notesShown: number;
    lineBoxes: number;
  }[];
  console.table(results);
  const slowest = Math.max(...results.map((r) => r.msToPaint));
  const moved = Math.max(...results.map((r) => r.maxShiftPx));
  console.log(
    `toggles: ${results.length}, slowest click-to-paint: ${slowest} ms, largest prose movement: ${moved} px`,
  );
  exitCode = slowest < 200 && moved === 0 ? 0 : 1;
  socket.close();
} finally {
  chrome.kill();
}
process.exit(exitCode);
