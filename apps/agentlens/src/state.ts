import * as vscode from "vscode";
import type { DecisionRecord } from "@agentsafe/core";

const KEY = "agentLens.progress.v1";

interface StoredProgress {
  records: DecisionRecord[];
  completed: string[];
}

/** Thin, typed wrapper over a VS Code Memento for the student's progress. */
export class ProgressStore {
  constructor(private readonly memento: vscode.Memento) {}

  private read(): StoredProgress {
    return this.memento.get<StoredProgress>(KEY, { records: [], completed: [] });
  }

  getRecords(): DecisionRecord[] {
    return this.read().records;
  }

  getCompleted(): string[] {
    return this.read().completed;
  }

  /**
   * Save the decisions for one scenario. Replays replace the prior attempt for
   * that scenario, so a student's best/most-recent run is what counts (no
   * double counting across replays).
   */
  async recordScenario(scenarioId: string, records: DecisionRecord[]): Promise<void> {
    const cur = this.read();
    const others = cur.records.filter((r) => r.scenarioId !== scenarioId);
    const completed = cur.completed.includes(scenarioId)
      ? cur.completed
      : [...cur.completed, scenarioId];
    await this.memento.update(KEY, {
      records: [...others, ...records],
      completed,
    });
  }

  async reset(): Promise<void> {
    await this.memento.update(KEY, { records: [], completed: [] });
  }
}
