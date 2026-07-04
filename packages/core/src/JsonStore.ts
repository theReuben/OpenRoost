import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

/**
 * Generic JSON file persistence for game state that should survive restarts.
 *
 * Game packages define their own state shape and a validator that repairs
 * missing/corrupt fields; JsonStore handles the file I/O, defaulting, and
 * auto-save loop. See packages/minecraft's Persistence for a usage example.
 */
export class JsonStore<T extends object> {
  private filePath: string;
  private saveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    filePath: string,
    /** Produces a fresh default state. */
    private makeDefault: () => T,
    /** Repairs a parsed state in place (fill missing fields, drop garbage). */
    private validate: (parsed: T) => T = (p) => p
  ) {
    this.filePath = filePath;
  }

  /** Load state from disk. Returns defaults if the file is missing or corrupt. */
  load(): T {
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      return this.validate(JSON.parse(raw) as T);
    } catch {
      return this.makeDefault();
    }
  }

  /** Save state to disk, stamping `savedAt` if the shape carries one. */
  save(state: T): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(
        this.filePath,
        JSON.stringify(
          { ...state, savedAt: new Date().toISOString() },
          null,
          2
        )
      );
    } catch (err) {
      console.error(
        `[OpenRoost] Failed to save state: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /** Start auto-saving every N milliseconds (default 60s). */
  startAutoSave(saveFn: () => void, intervalMs = 60_000): void {
    this.stopAutoSave();
    this.saveTimer = setInterval(saveFn, intervalMs);
  }

  /** Stop auto-saving. */
  stopAutoSave(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
  }
}
