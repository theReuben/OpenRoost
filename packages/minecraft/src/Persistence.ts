import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { Position } from "@openroost/core";
import type { DeathRecord } from "./BotManager.js";

/** Shape of the persisted state file. */
export interface PersistedState {
  /** Container memory entries (raw records before decay is applied). */
  containers: Array<{
    position: Position;
    blockName: string;
    items: Array<{ name: string; count: number; slot: number }>;
    lastCheckedTick: number;
    lastCheckedTime: number;
  }>;

  /** Death history, most recent first. */
  deaths: DeathRecord[];

  /** Last sleep tick (-1 = never). */
  lastSleepTick: number;

  /** Saved at timestamp. */
  savedAt: string;
}

const DEFAULT_STATE: PersistedState = {
  containers: [],
  deaths: [],
  lastSleepTick: -1,
  savedAt: new Date().toISOString(),
};

/**
 * Simple JSON file persistence for bot state that should survive restarts.
 * Saves to a configurable path (default: ./openroost-state.json).
 */
export class Persistence {
  private filePath: string;
  private saveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(filePath?: string) {
    this.filePath = filePath ?? "./openroost-state.json";
  }

  /** Load state from disk. Returns defaults if file doesn't exist or is corrupt. */
  load(): PersistedState {
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as PersistedState;
      // Basic validation
      if (!Array.isArray(parsed.containers)) parsed.containers = [];
      if (!Array.isArray(parsed.deaths)) parsed.deaths = [];
      if (typeof parsed.lastSleepTick !== "number") parsed.lastSleepTick = -1;
      return parsed;
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  /** Save state to disk. */
  save(state: PersistedState): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(
        this.filePath,
        JSON.stringify({ ...state, savedAt: new Date().toISOString() }, null, 2)
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
