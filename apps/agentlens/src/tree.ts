import * as vscode from "vscode";
import { loadScenarios, loadTraces } from "./scenarios";
import { ProgressStore } from "./state";
import { traceRiskCounts } from "@agentsafe/core";
import type { Scenario, Trace } from "@agentsafe/core";

type Node = GroupItem | ScenarioItem | TraceItem;

/** Sidebar with two groups: guided scenarios and the Trace Explorer. */
export class ScenarioTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly store: ProgressStore;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.store = new ProgressStore(context.globalState);
  }

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: Node): vscode.TreeItem {
    return element;
  }

  getChildren(element?: Node): Node[] {
    if (!element) {
      return [
        new GroupItem("Calibration scenarios", "scenarios", "mortar-board"),
        new GroupItem("Trace Explorer", "traces", "search"),
      ];
    }
    if (element instanceof GroupItem && element.kind === "scenarios") {
      const completed = new Set(this.store.getCompleted());
      return loadScenarios(this.context.extensionPath).map(
        (s) => new ScenarioItem(s, completed.has(s.id)),
      );
    }
    if (element instanceof GroupItem && element.kind === "traces") {
      return loadTraces(this.context.extensionPath).map((t) => new TraceItem(t));
    }
    return [];
  }
}

class GroupItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly kind: "scenarios" | "traces",
    icon: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = `group:${kind}`;
  }
}

class ScenarioItem extends vscode.TreeItem {
  constructor(scenario: Scenario, done: boolean) {
    super(scenario.title, vscode.TreeItemCollapsibleState.None);
    this.description = done ? `${scenario.difficulty} · ✓` : scenario.difficulty;
    this.tooltip = new vscode.MarkdownString(
      `**${scenario.title}**\n\n${scenario.tagline}\n\n_${scenario.domain} · ~${scenario.estMinutes} min · focus: ${scenario.focus.join(", ")}_`,
    );
    this.iconPath = new vscode.ThemeIcon(done ? "pass-filled" : "circle-large-outline");
    this.command = {
      command: "agentLens.openScenario",
      title: "Open scenario",
      arguments: [scenario.id],
    };
  }
}

class TraceItem extends vscode.TreeItem {
  constructor(trace: Trace) {
    super(trace.title, vscode.TreeItemCollapsibleState.None);
    const risk = traceRiskCounts(trace);
    const tag =
      trace.audience === "general" ? "non-CS" : trace.audience === "cs" ? "CS" : "all";
    this.description = `${tag} · ${trace.events.length} steps`;
    this.tooltip = new vscode.MarkdownString(
      `**${trace.title}**\n\n${trace.tagline ?? ""}\n\n_${trace.domain} · ${risk.danger} danger / ${risk.caution} caution / ${risk.safe} safe_`,
    );
    this.iconPath = new vscode.ThemeIcon(
      risk.danger > 0 ? "eye" : "eye-watch",
      risk.danger > 0 ? new vscode.ThemeColor("charts.red") : undefined,
    );
    this.command = {
      command: "agentLens.openTrace",
      title: "Explore trace",
      arguments: [trace.id],
    };
  }
}
