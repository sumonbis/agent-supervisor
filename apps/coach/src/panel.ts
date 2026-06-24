import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import type { SupervisionReport } from "@agentsafe/core";
import { disclosureMarkdown } from "./disclosure";

interface InboundMessage {
  type: "ready" | "export";
}

/** Webview showing a repository's SupervisionReport. */
export class CoachPanel {
  public static current: CoachPanel | undefined;
  private static readonly viewType = "agentSafeCoach.dashboard";

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly disposables: vscode.Disposable[] = [];
  private report: SupervisionReport;
  private repoPath: string;

  public static createOrShow(
    context: vscode.ExtensionContext,
    report: SupervisionReport,
    repoPath: string,
  ): void {
    const column = vscode.ViewColumn.Active;
    if (CoachPanel.current) {
      CoachPanel.current.update(report, repoPath);
      CoachPanel.current.panel.reveal(column);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      CoachPanel.viewType,
      "Agentic-SE Coach",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
      },
    );
    CoachPanel.current = new CoachPanel(panel, context, report, repoPath);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    report: SupervisionReport,
    repoPath: string,
  ) {
    this.panel = panel;
    this.extensionUri = context.extensionUri;
    this.report = report;
    this.repoPath = repoPath;
    this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, "media", "activitybar.svg");
    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (m: InboundMessage) => void this.onMessage(m),
      null,
      this.disposables,
    );
  }

  private update(report: SupervisionReport, repoPath: string): void {
    this.report = report;
    this.repoPath = repoPath;
    void this.panel.webview.postMessage({ type: "report", report });
  }

  private async onMessage(msg: InboundMessage): Promise<void> {
    if (msg.type === "ready") {
      void this.panel.webview.postMessage({ type: "report", report: this.report });
    } else if (msg.type === "export") {
      try {
        const targets = ["supervision-report.json", "AI-DISCLOSURE.md"];
        const existing = targets.filter((t) => fs.existsSync(path.join(this.repoPath, t)));
        if (existing.length) {
          const ok = await vscode.window.showWarningMessage(
            `Overwrite ${existing.join(" and ")} in the repository?`,
            { modal: true },
            "Overwrite",
          );
          if (ok !== "Overwrite") {
            return;
          }
        }
        fs.writeFileSync(
          path.join(this.repoPath, "supervision-report.json"),
          JSON.stringify(this.report, null, 2),
        );
        const disclosurePath = path.join(this.repoPath, "AI-DISCLOSURE.md");
        fs.writeFileSync(disclosurePath, disclosureMarkdown(this.report));
        const doc = await vscode.workspace.openTextDocument(disclosurePath);
        await vscode.window.showTextDocument(doc, { preview: false });
        void vscode.window.showInformationMessage(
          "Agentic-SE Coach: wrote supervision-report.json and AI-DISCLOSURE.md.",
        );
      } catch (err) {
        void vscode.window.showErrorMessage(`Agentic-SE Coach: export failed — ${String(err)}`);
      }
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const asset = (f: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", f));
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
  <link href="${asset("dashboard.css")}" rel="stylesheet" />
  <title>Agentic-SE Coach</title>
</head>
<body>
  <div id="app" class="app"></div>
  <script nonce="${nonce}" src="${asset("dashboard.js")}"></script>
</body>
</html>`;
  }

  public dispose(): void {
    CoachPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
