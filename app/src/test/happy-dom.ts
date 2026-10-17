import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Plate's clipboard and HTML paste paths read `window` and `DOMParser`, so
// tests run against a DOM shim.
GlobalRegistrator.register();
