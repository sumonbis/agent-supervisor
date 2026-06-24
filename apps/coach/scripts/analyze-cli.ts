// Headless analyzer — the instructor/batch counterpart to the in-IDE command.
//   node <bundle> /path/to/repo [repoId]
// Prints a SupervisionReport as JSON. Used in tests and for batch grading.
import { analyzeRepo } from "@agentsafe/core";
import { collectRepoSignals } from "../src/collector";

const repo = process.argv[2];
if (!repo) {
  console.error("usage: analyze-cli <repo-path> [repoId]");
  process.exit(2);
}
const report = analyzeRepo(collectRepoSignals(repo, process.argv[3]));
console.log(JSON.stringify(report, null, 2));
