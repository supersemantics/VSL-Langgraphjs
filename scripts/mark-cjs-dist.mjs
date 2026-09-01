// Writes dist/cjs/package.json = { "type": "commonjs" } -- same technique
// as vsl-core-ts, see that package's copy of this script for the full
// rationale. The root package.json sets "type": "module"; this nested
// package.json overrides that for everything under dist/cjs/ so Node
// interprets those files as CommonJS without renaming any of them.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
writeFileSync(join(root, "dist", "cjs", "package.json"), JSON.stringify({ type: "commonjs" }, null, 2) + "\n");
console.log("Wrote dist/cjs/package.json");
