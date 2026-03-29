import { describe, it, expect, beforeEach, vi } from "vitest";
import { TaskManager } from "../TaskManager.js";

describe("TaskManager", () => {
  let tm: TaskManager;

  beforeEach(() => {
    tm = new TaskManager();
  });

  describe("create", () => {
    it("returns a unique task ID", () => {
      const id1 = tm.create("task one");
      const id2 = tm.create("task two");
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^task_/);
    });

    it("creates a task with running status", () => {
      const id = tm.create("test task");
      const task = tm.get(id);
      expect(task).toBeDefined();
      expect(task!.status).toBe("running");
      expect(task!.description).toBe("test task");
    });
  });

  describe("complete", () => {
    it("sets status to complete with a result", () => {
      const id = tm.create("mining");
      tm.complete(id, { blocks: 5 });
      const task = tm.get(id);
      expect(task!.status).toBe("complete");
      expect(task!.result).toEqual({ blocks: 5 });
    });

    it("does nothing for unknown task id", () => {
      tm.complete("nonexistent");
    });
  });

  describe("fail", () => {
    it("sets status to failed with error", () => {
      const id = tm.create("pathfinding");
      tm.fail(id, "Path blocked");
      const task = tm.get(id);
      expect(task!.status).toBe("failed");
      expect(task!.result).toEqual({ error: "Path blocked" });
    });
  });

  describe("cancel", () => {
    it("cancels a running task and invokes callback", () => {
      const onCancel = vi.fn();
      const id = tm.create("navigation", onCancel);
      const result = tm.cancel(id);
      expect(result).toBe(true);
      expect(onCancel).toHaveBeenCalledOnce();
      expect(tm.get(id)!.status).toBe("failed");
      expect(tm.get(id)!.result).toEqual({ error: "Cancelled by user" });
    });

    it("returns false for non-running task", () => {
      const id = tm.create("done task");
      tm.complete(id);
      expect(tm.cancel(id)).toBe(false);
    });

    it("returns false for unknown task", () => {
      expect(tm.cancel("nonexistent")).toBe(false);
    });
  });

  describe("getRunning", () => {
    it("returns only running tasks", () => {
      const id1 = tm.create("running task");
      const id2 = tm.create("another running");
      const id3 = tm.create("will complete");
      tm.complete(id3);

      const running = tm.getRunning();
      expect(running).toHaveLength(2);
      expect(running.map((t) => t.id)).toContain(id1);
      expect(running.map((t) => t.id)).toContain(id2);
    });

    it("returns empty array when no tasks running", () => {
      expect(tm.getRunning()).toHaveLength(0);
    });
  });

  describe("prune", () => {
    it("removes completed/failed tasks older than maxAge", () => {
      const id = tm.create("old task");
      tm.complete(id);
      const task = tm.get(id)!;
      (task as any).createdAt = Date.now() - 10 * 60 * 1000;

      tm.prune(5 * 60 * 1000);
      expect(tm.get(id)).toBeUndefined();
    });

    it("keeps running tasks regardless of age", () => {
      const id = tm.create("running task");
      const task = tm.get(id)!;
      (task as any).createdAt = Date.now() - 10 * 60 * 1000;

      tm.prune(5 * 60 * 1000);
      expect(tm.get(id)).toBeDefined();
    });

    it("keeps recent completed tasks", () => {
      const id = tm.create("recent task");
      tm.complete(id);

      tm.prune(5 * 60 * 1000);
      expect(tm.get(id)).toBeDefined();
    });
  });
});
