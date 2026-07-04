import { Position } from "./types.js";

/** A named location the agent wants to find again. */
export interface Waypoint {
  name: string;
  position: Position;
  /** What's here / why it matters, e.g. "main base, chests + furnaces". */
  note: string;
  createdAt: string;
  updatedAt: string;
}

/** A dated free-form note about the session's projects and state. */
export interface JournalEntry {
  text: string;
  tags: string[];
  timestamp: string;
}

const MAX_WAYPOINTS = 100;
const MAX_JOURNAL = 200;

/**
 * Episodic memory: where things are (waypoints) and what's going on
 * (journal). Complements SkillLibrary — skills remember *strategies*,
 * GameMemory remembers *this world*: base location, current project,
 * teammate preferences. Game-agnostic for any game with coordinates;
 * the journal is useful even without them.
 */
export class GameMemory {
  private waypoints = new Map<string, Waypoint>();
  private journal: JournalEntry[] = [];

  // ── Waypoints ──

  /** Create or update a named waypoint. Returns the stored waypoint. */
  setWaypoint(name: string, position: Position, note = ""): Waypoint {
    const now = new Date().toISOString();
    const existing = this.waypoints.get(name);
    const wp: Waypoint = {
      name,
      position,
      note: note || existing?.note || "",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.waypoints.set(name, wp);

    // Evict the oldest-updated waypoint when over capacity.
    if (this.waypoints.size > MAX_WAYPOINTS) {
      const oldest = [...this.waypoints.values()].sort((a, b) =>
        a.updatedAt.localeCompare(b.updatedAt)
      )[0];
      this.waypoints.delete(oldest.name);
    }
    return wp;
  }

  getWaypoint(name: string): Waypoint | undefined {
    return this.waypoints.get(name);
  }

  removeWaypoint(name: string): boolean {
    return this.waypoints.delete(name);
  }

  /** All waypoints, most recently updated first. */
  listWaypoints(): Waypoint[] {
    return [...this.waypoints.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
  }

  get waypointCount(): number {
    return this.waypoints.size;
  }

  // ── Journal ──

  /** Append a journal entry. Oldest entries are evicted past capacity. */
  addJournal(text: string, tags: string[] = []): JournalEntry {
    const entry: JournalEntry = {
      text,
      tags,
      timestamp: new Date().toISOString(),
    };
    this.journal.push(entry);
    if (this.journal.length > MAX_JOURNAL) {
      this.journal = this.journal.slice(-MAX_JOURNAL);
    }
    return entry;
  }

  /** Recent journal entries (newest last), optionally filtered by tag. */
  recentJournal(limit = 20, tag?: string): JournalEntry[] {
    const source = tag
      ? this.journal.filter((e) => e.tags.includes(tag))
      : this.journal;
    return source.slice(-limit);
  }

  get journalLength(): number {
    return this.journal.length;
  }

  // ── Persistence ──

  exportMemory(): { waypoints: Waypoint[]; journal: JournalEntry[] } {
    return { waypoints: [...this.waypoints.values()], journal: [...this.journal] };
  }

  importMemory(data: { waypoints?: Waypoint[]; journal?: JournalEntry[] }): void {
    this.waypoints.clear();
    for (const wp of data.waypoints ?? []) {
      if (wp && typeof wp.name === "string" && wp.position) {
        this.waypoints.set(wp.name, { ...wp, note: wp.note ?? "" });
      }
    }
    this.journal = (data.journal ?? []).filter(
      (e) => e && typeof e.text === "string"
    );
  }
}
