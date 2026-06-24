import * as fs from "node:fs";
import * as path from "node:path";
import { parseScenario, parseTrace } from "@agentsafe/core";
import type { Scenario, Trace } from "@agentsafe/core";

interface IndexEntry {
  id: string;
  file: string;
}

function loadIndexed<T>(
  extensionPath: string,
  dirName: string,
  parse: (raw: unknown) => T,
): T[] {
  const dir = path.join(extensionPath, dirName);
  let index: IndexEntry[];
  try {
    index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
  } catch (err) {
    console.error(`AgentLens: cannot read ${dirName}/index.json: ${String(err)}`);
    return [];
  }
  const out: T[] = [];
  for (const entry of index) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, entry.file), "utf8"));
      out.push(parse(raw));
    } catch (err) {
      console.error(`AgentLens: skipping ${dirName}/${entry.file}: ${String(err)}`);
    }
  }
  return out;
}

/** Guided calibration scenarios. */
export function loadScenarios(extensionPath: string): Scenario[] {
  return loadIndexed(extensionPath, "scenarios", parseScenario);
}

/** Sample agent traces for the Trace Explorer. */
export function loadTraces(extensionPath: string): Trace[] {
  return loadIndexed(extensionPath, "traces", parseTrace);
}
