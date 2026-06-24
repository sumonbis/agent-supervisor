// Regenerates the standalone browser preview: inlines scenarios + traces and
// copies the current webview assets. Run: npm run preview:build
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function loadDir(dir) {
  const d = path.join(root, dir);
  const idx = JSON.parse(fs.readFileSync(path.join(d, "index.json"), "utf8"));
  return idx.map((e) => JSON.parse(fs.readFileSync(path.join(d, e.file), "utf8")));
}

const scenarios = loadDir("scenarios");
const traces = loadDir("traces");
fs.writeFileSync(
  path.join(here, "data.js"),
  `window.__SCENARIOS__ = ${JSON.stringify(scenarios)};\nwindow.__TRACES__ = ${JSON.stringify(traces)};\n`,
);
fs.copyFileSync(path.join(root, "media", "cockpit.css"), path.join(here, "cockpit.css"));
fs.copyFileSync(path.join(root, "media", "cockpit.js"), path.join(here, "cockpit.js"));
console.log(`preview built: ${scenarios.length} scenarios, ${traces.length} traces.`);
