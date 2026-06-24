import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeRepo } from "@agentsafe/core";
import { collectRepoSignals } from "./collector";
import { disclosureMarkdown } from "./disclosure";
import { CoachPanel } from "./panel";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("agentSafeCoach.analyze", () => analyze(context, false)),
    vscode.commands.registerCommand("agentSafeCoach.exportReport", () => analyze(context, true)),
    vscode.commands.registerCommand("agentSafeCoach.pushSnapshot", () => pushSnapshot()),
  );
}

/**
 * Emit an abstracted snapshot of the current repo's supervision state into
 * `coach-snapshots/` — the student-side "push" that feeds the Coach web app.
 * Computed locally via the same @agentsafe/core analyzers; no source leaves.
 */
async function pushSnapshot(): Promise<void> {
  const repo = await pickRepo();
  if (!repo) {
    return;
  }
  try {
    const report = analyzeRepo(collectRepoSignals(repo));
    // Abstract: keep scores/signals/counts only — never source, paths, or identities.
    const snapshot = {
      schemaVersion: "2.0",
      kind: "live",
      at: new Date().toISOString(),
      scores: report.scores,
      source: { S1: "pending", S2: "pending", S3: "git", S4: "pending", S5: "pending", S6: "git" },
      signals: {
        S3: { ...(report.areas.S3.detail ?? {}), reasoning: report.areas.S3.reasoning },
        S6: { ...(report.areas.S6.detail ?? {}), reasoning: report.areas.S6.reasoning },
      },
      ai: report.aiUsage
        ? { level: report.aiUsage.level, pct: Math.round(report.aiUsage.weightedPct * 1000) / 10, explicit: report.aiUsage.explicitSignals, behavioral: report.aiUsage.topBehavioral }
        : null,
      totals: { commits: report.totalCommits, implFiles: report.implFileCount, testFiles: report.testFileCount, hasCi: report.hasCi },
      drift: { s6MinusS3: report.scores.S6 >= 0 && report.scores.S3 >= 0 ? report.scores.S6 - report.scores.S3 : 0 },
    };
    const dir = path.join(repo, "coach-snapshots");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `snapshot-${snapshot.at.replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
    void vscode.window.showInformationMessage(
      `Agentic-SE Coach: pushed snapshot (S3 ${report.scores.S3}, S6 ${report.scores.S6}) to coach-snapshots/. Commit it to share with your reviewer.`,
    );
  } catch (err) {
    void vscode.window.showErrorMessage(`Agentic-SE Coach: snapshot failed — ${String(err)}`);
  }
}

async function pickRepo(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length === 1) {
    return folders[0].uri.fsPath;
  }
  if (folders && folders.length > 1) {
    const pick = await vscode.window.showWorkspaceFolderPick();
    return pick?.uri.fsPath;
  }
  const uris = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: "Analyze repository",
  });
  return uris?.[0]?.fsPath;
}

async function analyze(context: vscode.ExtensionContext, exportToo: boolean): Promise<void> {
  const repo = await pickRepo();
  if (!repo) {
    return;
  }
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Agentic-SE Coach: analyzing repository…" },
    async () => {
      try {
        const report = analyzeRepo(collectRepoSignals(repo));
        CoachPanel.createOrShow(context, report, repo);
        if (exportToo) {
          const targets = ["supervision-report.json", "AI-DISCLOSURE.md"];
          const existing = targets.filter((t) => fs.existsSync(path.join(repo, t)));
          let go = true;
          if (existing.length) {
            const ok = await vscode.window.showWarningMessage(
              `Overwrite ${existing.join(" and ")} in the repository?`,
              { modal: true },
              "Overwrite",
            );
            go = ok === "Overwrite";
          }
          if (go) {
            fs.writeFileSync(path.join(repo, "supervision-report.json"), JSON.stringify(report, null, 2));
            fs.writeFileSync(path.join(repo, "AI-DISCLOSURE.md"), disclosureMarkdown(report));
            void vscode.window.showInformationMessage(
              "Agentic-SE Coach: wrote supervision-report.json and AI-DISCLOSURE.md to the repo.",
            );
          }
        }
      } catch (err) {
        void vscode.window.showErrorMessage(`Agentic-SE Coach: analysis failed — ${String(err)}`);
      }
    },
  );
}

export function deactivate(): void {
  /* nothing beyond context.subscriptions */
}
