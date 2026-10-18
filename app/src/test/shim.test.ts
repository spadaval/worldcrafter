import { expect, test } from "bun:test";

// The happy-dom preload must put the runtime's network and stream globals
// back; its replacements enforce CORS and break pipeThrough.
// Listed here independently of the preload, so dropping one there fails.
const EXPECTED_NATIVE = [
  "fetch",
  "Request",
  "Response",
  "Headers",
  "AbortController",
  "AbortSignal",
  "TransformStream",
  "WritableStream",
  "Blob",
  "File",
  "FormData",
  "URL",
  "DOMException",
  "WebSocket",
] as const;

test("every restored global is the runtime's own", () => {
  for (const key of EXPECTED_NATIVE) {
    const value: unknown = globalThis[key];
    const fn = value as { name: string };
    // happy-dom installs some replacements (e.g. fetch) as bound functions,
    // which also print as native code, so check the name too.
    expect({
      key,
      native: Function.prototype.toString.call(value).includes("[native code]"),
      bound: fn.name.startsWith("bound "),
    }).toEqual({ key, native: true, bound: false });
  }
});

test("pipeThrough works under the DOM shim", async () => {
  const stream = new ReadableStream<string>({
    start(controller) {
      controller.enqueue("a");
      controller.close();
    },
  }).pipeThrough(
    new TransformStream<string, string>({
      transform(chunk, controller) {
        controller.enqueue(`${chunk}!`);
      },
    }),
  );
  const reader = stream.getReader();
  const out: string[] = [];
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    out.push(r.value);
  }
  expect(out).toEqual(["a!"]);
});
