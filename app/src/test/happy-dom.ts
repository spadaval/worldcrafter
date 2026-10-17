import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Plate's clipboard and HTML paste paths read `window` and `DOMParser`, so
// tests run against a DOM shim. The shim would also replace the network
// globals with its own CORS-enforcing versions, so Bun's are kept for the
// tests that talk to a local stub server.
const native = {
  fetch: globalThis.fetch,
  Request: globalThis.Request,
  Response: globalThis.Response,
  Headers: globalThis.Headers,
  AbortController: globalThis.AbortController,
  AbortSignal: globalThis.AbortSignal,
  ReadableStream: globalThis.ReadableStream,
  TextDecoder: globalThis.TextDecoder,
  TextEncoder: globalThis.TextEncoder,
};

GlobalRegistrator.register();
Object.assign(globalThis, native);
