import { TaskInfo, TaskStatus } from "./types.js";

let taskCounter = 0;

/**
 * Tracks async long-running tasks (pathfinding, smelting, combat, etc.).
 *
 * Each task gets a unique ID. Tools that start async work return the ID
 * so the LLM can poll with get_task_status or cancel with cancel_task.
 */
export class TaskManager {
  private tasks = new Map<string, TaskInfo>();
  private cancelCallbacks = new Map<string, () => void>();

  create(description: string, onCancel?: () => void): string {
    const id = `task_${++taskCounter}_${Date.now()}`;
    this.tasks.set(id, {
      id,
      status: "running",
      description,
      createdAt: Date.now(),
    });
    if (onCancel) {
      this.cancelCallbacks.set(id, onCancel);
    }
    return id;
  }

  updateProgress(id: string, progress: string): void {
    const task = this.tasks.get(id);
    if (task && task.status === "running") {
      task.progress = progress;
    }
  }

  complete(id: string, result?: unknown): void {
    const task = this.tasks.get(id);
    if (task && task.status === "running") {
      task.status = "complete";
      task.result = result;
      this.cancelCallbacks.delete(id);
    }
  }

  fail(id: string, error: string): void {
    const task = this.tasks.get(id);
    if (task && task.status === "running") {
      task.status = "failed";
      task.result = { error };
      this.cancelCallbacks.delete(id);
    }
  }

  cancel(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.status !== "running") return false;

    const cb = this.cancelCallbacks.get(id);
    if (cb) cb();

    task.status = "failed";
    task.result = { error: "Cancelled by user" };
    this.cancelCallbacks.delete(id);
    return true;
  }

  get(id: string): TaskInfo | undefined {
    return this.tasks.get(id);
  }

  getRunning(): TaskInfo[] {
    return [...this.tasks.values()].filter((t) => t.status === "running");
  }

  /** Clean up completed/failed tasks older than maxAge ms (default 5 min). */
  prune(maxAge = 5 * 60 * 1000): void {
    const now = Date.now();
    for (const [id, task] of this.tasks) {
      if (task.status !== "running" && now - task.createdAt > maxAge) {
        this.tasks.delete(id);
      }
    }
  }
}
