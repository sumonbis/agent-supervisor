import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildCalibrationProfile, computeCalibration, importAgentTrace, withVerdicts } from "@agentsafe/core";
import type { DecisionRecord, Trace } from "@agentsafe/core";
import { loadScenarios, loadTraces } from "./scenarios";
import { ProgressStore } from "./state";

interface InboundMessage {
  type: "ready" | "completeScenario" | "reset" | "importTrace" | "loadSample";
  scenarioId?: string;
  records?: DecisionRecord[];
}

/** Parse a .traj/.json (single object) or .jsonl (one step per line). */
function parseTraceFile(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const steps = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    return steps; // array → treated as a SWE-agent trajectory
  }
}

/** A deep-link target when opening the trainer. */
export interface OpenTarget {
  scenarioId?: string;
  traceId?: string;
}

/** The single webview that hosts the whole AgentLens experience. */
export class CockpitPanel {
  public static current: CockpitPanel | undefined;
  private static readonly viewType = "agentLens.cockpit";

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly extensionPath: string;
  private readonly store: ProgressStore;
  /** Fired after the student completes a scenario, so the tree can refresh. */
  public static readonly onDidCompleteScenario = new vscode.EventEmitter<string>();
  private readonly disposables: vscode.Disposable[] = [];
  private pendingScenarioId?: string;
  private pendingTraceId?: string;

  public static createOrShow(
    context: vscode.ExtensionContext,
    target?: OpenTarget,
  ): void {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    if (CockpitPanel.current) {
      CockpitPanel.current.panel.reveal(column);
      if (target?.scenarioId) {
        CockpitPanel.current.openScenario(target.scenarioId);
      }
      if (target?.traceId) {
        CockpitPanel.current.openTrace(target.traceId);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      CockpitPanel.viewType,
      "AgentLens",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
      },
    );

    CockpitPanel.current = new CockpitPanel(panel, context, target);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    target?: OpenTarget,
  ) {
    this.panel = panel;
    this.extensionUri = context.extensionUri;
    this.extensionPath = context.extensionPath;
    this.store = new ProgressStore(context.globalState);
    this.pendingScenarioId = target?.scenarioId;
    this.pendingTraceId = target?.traceId;

    this.panel.iconPath = vscode.Uri.joinPath(
      this.extensionUri,
      "media",
      "activitybar.svg",
    );
    this.panel.webview.html = this.getHtml(this.panel.webview);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: InboundMessage) => void this.onMessage(msg),
      null,
      this.disposables,
    );
  }

  private openScenario(id: string): void {
    void this.panel.webview.postMessage({ type: "openScenario", id });
  }

  private openTrace(id: string): void {
    void this.panel.webview.postMessage({ type: "openTrace", id });
  }

  /** Show a trace object directly in the explorer (verdicts resolved by oracles). */
  private showTrace(trace: Trace): void {
    void this.panel.webview.postMessage({ type: "openTraceObject", trace: withVerdicts(trace) });
  }

  /** Pick a SWE-agent .traj/.json/.jsonl produced from a real repo and explore it. */
  public async importTrace(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: "Import agent run",
      filters: { "Agent traces": ["traj", "json", "jsonl"], "All files": ["*"] },
    });
    if (!uris || !uris[0]) {
      return;
    }
    try {
      const text = fs.readFileSync(uris[0].fsPath, "utf8");
      const trace = importAgentTrace(parseTraceFile(text), { id: path.basename(uris[0].fsPath) });
      this.showTrace(trace);
    } catch (err) {
      void vscode.window.showErrorMessage(`AgentLens: could not import trace — ${String(err)}`);
    }
  }

  /** Load the bundled sample SWE-agent run (for demos / first-time users). */
  public loadSampleRun(): void {
    try {
      const p = path.join(this.extensionPath, "samples", "swe-agent-sample.json");
      const trace = importAgentTrace(JSON.parse(fs.readFileSync(p, "utf8")), { id: "sample-swe-run" });
      this.showTrace(trace);
    } catch (err) {
      void vscode.window.showErrorMessage(`AgentLens: could not load sample run — ${String(err)}`);
    }
  }

  private async onMessage(msg: InboundMessage): Promise<void> {
    switch (msg.type) {
      case "ready": {
        void this.panel.webview.postMessage({
          type: "init",
          scenarios: loadScenarios(this.extensionPath),
          traces: loadTraces(this.extensionPath).map((t) => withVerdicts(t)),
          profile: buildCalibrationProfile(this.store.getRecords(), this.store.getCompleted()),
          openScenarioId: this.pendingScenarioId ?? null,
          openTraceId: this.pendingTraceId ?? null,
        });
        this.pendingScenarioId = undefined;
        this.pendingTraceId = undefined;
        break;
      }
      case "importTrace": {
        await this.importTrace();
        break;
      }
      case "loadSample": {
        this.loadSampleRun();
        break;
      }
      case "completeScenario": {
        if (!msg.scenarioId) {
          return;
        }
        const records = msg.records ?? [];
        await this.store.recordScenario(msg.scenarioId, records);
        void this.panel.webview.postMessage({
          type: "scenarioComplete",
          scenarioId: msg.scenarioId,
          calibration: computeCalibration(records),
          profile: buildCalibrationProfile(this.store.getRecords(), this.store.getCompleted()),
        });
        CockpitPanel.onDidCompleteScenario.fire(msg.scenarioId);
        break;
      }
      case "reset": {
        await this.store.reset();
        void this.panel.webview.postMessage({
          type: "profile",
          profile: buildCalibrationProfile([], []),
        });
        break;
      }
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const asset = (file: string) =>
      webview.asWebviewUri(
        vscode.Uri.joinPath(this.extensionUri, "media", file),
      );
    const cssUri = asset("cockpit.css");
    const jsUri = asset("cockpit.js");
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${cssUri}" rel="stylesheet" />
  <title>AgentLens</title>
</head>
<body>
  <div id="app" class="app"></div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }

  public dispose(): void {
    CockpitPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}

function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
