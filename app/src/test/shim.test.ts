import { expect, test } from "bun:test";

// The happy-dom preload must leave the runtime's stream and URL globals in
// place; its replacements break pipeThrough and URL subclassing.
test("native stream and URL globals survive the DOM shim", async () => {
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
  expect(new URL("http://x/y").pathname).toBe("/y");
});
