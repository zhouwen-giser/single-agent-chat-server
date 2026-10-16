import { build } from "esbuild";
import { mkdir, cp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const outdir = "dist/apps/analysis-web/public";
await mkdir(outdir, { recursive: true });
const result = await build({
  entryPoints: ["apps/analysis-web/src/main.ts"],
  outfile: outdir + "/app.js",
  platform: "browser",
  format: "esm",
  target: ["es2022"],
  bundle: true,
  metafile: true,
  minify: true,
  alias: { "node:crypto": resolve("apps/analysis-web/src/browser-crypto.ts") },
  inject: [resolve("apps/analysis-web/src/browser-buffer.ts")],
  write: false,
});
for (const input of Object.keys(result.metafile.inputs)) {
  if (
    input.startsWith("apps/server/") ||
    /test-fixtures|test-support|node:|dependencies\/wsgs/u.test(input)
  )
    throw Error("BROWSER_BUNDLE_BOUNDARY_VIOLATION");
}
for (const output of result.outputFiles)
  await writeFile(output.path, output.contents);
for (const file of ["index.html", "style.css"])
  await cp("apps/analysis-web/public/" + file, outdir + "/" + file);
await writeFile(
  outdir + "/bundle-manifest.json",
  JSON.stringify(
    {
      entry: "apps/analysis-web/src/main.ts",
      sha256: createHash("sha256")
        .update(result.outputFiles[0].contents)
        .digest("hex"),
      inputs: Object.keys(result.metafile.inputs).sort(),
      nodeBuiltins: [],
    },
    null,
    2,
  ) + "\n",
);
process.stdout.write(
  "Browser reference client built with isolated browser hash alias.\n",
);
