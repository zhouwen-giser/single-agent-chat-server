import { cp } from "node:fs/promises";

// TypeScript does not emit these frozen JavaScript modules or their schemas.
// Preserve their exact bytes at the relative path used by compiled imports.
await cp(
  new URL("../dependencies/wsgs-world-analysis-v1/public/", import.meta.url),
  new URL(
    "../dist/dependencies/wsgs-world-analysis-v1/public/",
    import.meta.url,
  ),
  { recursive: true },
);
