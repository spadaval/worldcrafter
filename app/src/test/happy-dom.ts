import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Plate's clipboard and HTML paste paths read `window` and `DOMParser`, so
// tests run against a DOM shim. The shim also replaces the runtime's network,
// stream and event globals with its own versions (its fetch enforces CORS, its
// TransformStream is a Node stream), so Bun's are put back for the tests that
// talk to a local stub server. One exception to watch: happy-dom's DOM code
// type-checks File (e.g. DataTransfer.items.add) and reads form fields via its
// own FormData, so a test that needs those must build them from happy-dom's
// classes rather than the globals. The native AbortSignal is not an instance
// of happy-dom's EventTarget; code here only reads `aborted` or passes the
// signal to fetch.
const NATIVE_KEYS = [
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

const native = Object.fromEntries(
  NATIVE_KEYS.map((key) => [key, globalThis[key]]),
);

GlobalRegistrator.register();
Object.assign(globalThis, native);
