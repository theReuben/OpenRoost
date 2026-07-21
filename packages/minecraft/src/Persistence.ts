import { JsonStore, Position } from "@openroost/core";
import type { Skill, Waypoint, JournalEntry } from "@openroost/core";
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

  /** Learned skills (Voyager-style skill library). */
  skills: Skill[];

  /** Named locations (episodic memory). */
  waypoints: Waypoint[];

  /** Session journal (episodic memory). */
  journal: JournalEntry[];

  /** Saved at timestamp. */
  savedAt: string;
}

function defaultState(): PersistedState {
  return {
    containers: [],
    deaths: [],
    lastSleepTick: -1,
    skills: [],
    waypoints: [],
    journal: [],
    savedAt: new Date().toISOString(),
  };
}

function validateState(parsed: PersistedState): PersistedState {
  if (!Array.isArray(parsed.containers)) parsed.containers = [];
  if (!Array.isArray(parsed.deaths)) parsed.deaths = [];
  if (typeof parsed.lastSleepTick !== "number") parsed.lastSleepTick = -1;
  if (!Array.isArray(parsed.skills)) parsed.skills = [];
  if (!Array.isArray(parsed.waypoints)) parsed.waypoints = [];
  if (!Array.isArray(parsed.journal)) parsed.journal = [];
  return parsed;
}

/**
 * Minecraft-specific persistence: a typed JsonStore for bot state that
 * should survive restarts (default path: ./openroost-state.json).
 */
export class Persistence extends JsonStore<PersistedState> {
  constructor(filePath?: string) {
    super(filePath ?? "./openroost-state.json", defaultState, validateState);
  }
}
