import * as vscode from "vscode";
import { CockpitPanel } from "./panel";
import { ScenarioTreeProvider } from "./tree";
import { ProgressStore } from "./state";

export function activate(context: vscode.ExtensionContext): void {
  const tree = new ScenarioTreeProvider(context);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("agentLensScenarios", tree),

    vscode.commands.registerCommand("agentLens.open", () =>
      CockpitPanel.createOrShow(context),
    ),

    // Internal commands used by tree items to deep-link into content.
    vscode.commands.registerCommand("agentLens.openScenario", (id?: string) =>
      CockpitPanel.createOrShow(context, { scenarioId: id }),
    ),
    vscode.commands.registerCommand("agentLens.openTrace", (id?: string) =>
      CockpitPanel.createOrShow(context, { traceId: id }),
    ),

    vscode.commands.registerCommand("agentLens.importTrace", async () => {
      CockpitPanel.createOrShow(context);
      await CockpitPanel.current?.importTrace();
    }),

    vscode.commands.registerCommand("agentLens.runSweAgent", async () => {
      const repo = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "<path-to-your-repo>";
      const task = await vscode.window.showInputBox({
        prompt: "Describe the task for SWE-agent to attempt on this repository",
        placeHolder: "e.g., Fix the failing test in the auth module",
      });
      if (task === undefined) {
        return;
      }
      const cmd =
        `sweagent run --agent.model.name claude-sonnet-4-5 ` +
        `--env.repo.path "${repo}" ` +
        `--problem_statement.text "${task.replace(/"/g, '\\"')}" ` +
        `--output_dir swe-agent-output`;
      const term = vscode.window.createTerminal("SWE-agent");
      term.show();
      term.sendText(cmd, false); // do not auto-run — let the student review it
      void vscode.window.showInformationMessage(
        "Review the SWE-agent command, run it (requires SWE-agent installed + an API key), then use “AgentLens: Import a Real Agent Run” on the produced .traj file.",
      );
    }),

    vscode.commands.registerCommand("agentLens.resetProgress", async () => {
      const choice = await vscode.window.showWarningMessage(
        "Reset all AgentLens progress? This clears your supervisor profile and scenario history.",
        { modal: true },
        "Reset",
      );
      if (choice === "Reset") {
        await new ProgressStore(context.globalState).reset();
        tree.refresh();
        vscode.window.showInformationMessage("AgentLens: progress reset.");
      }
    }),

    // Keep the sidebar's done-markers in sync when a scenario is completed.
    CockpitPanel.onDidCompleteScenario,
    CockpitPanel.onDidCompleteScenario.event(() => tree.refresh()),
  );
}

export function deactivate(): void {
  /* nothing to clean up beyond context.subscriptions */
}
