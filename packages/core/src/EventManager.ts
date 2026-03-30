import { GameEvent, GameEventType } from "./types.js";

export type EventPriority = "critical" | "high" | "normal" | "low";

const PRIORITY_ORDER: Record<EventPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

const DEFAULT_PRIORITIES: Partial<Record<GameEventType, EventPriority>> = {
  death: "critical",
  respawn: "critical",
  phantom_warning: "critical",
  damage_taken: "high",
  chat: "high",
  task_failed: "high",
  weather_change: "normal",
  night_fall: "normal",
  player_joined: "normal",
  player_left: "normal",
  mob_spotted: "normal",
  damage_dealt: "normal",
  task_complete: "normal",
  sunrise: "low",
  sunset: "low",
  item_picked_up: "low",
  sound_heard: "low",
};

interface QueuedEvent {
  event: GameEvent;
  priority: EventPriority;
}

/**
 * Priority event queue with piggybacking support.
 *
 * Events accumulate between tool calls. When `drainUrgent()` is called
 * (inside `wrapResponse`), high-priority events are returned so they can
 * be prepended to the tool response the LLM sees.
 */
export class EventManager {
  private queue: QueuedEvent[] = [];
  private lastDrainTick = 0;
  private maxQueueSize = 200;

  push(event: GameEvent, priority?: EventPriority): void {
    const p = priority ?? DEFAULT_PRIORITIES[event.type] ?? "normal";
    this.queue.push({ event, priority: p });

    // Evict oldest low-priority events if queue grows too large
    if (this.queue.length > this.maxQueueSize) {
      this.queue.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
      this.queue = this.queue.slice(0, this.maxQueueSize);
    }
  }

  /**
   * Drain urgent (critical + high) events to piggyback on the next tool response.
   */
  drainUrgent(): GameEvent[] {
    const urgent = this.queue
      .filter((q) => q.priority === "critical" || q.priority === "high")
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
      .map((q) => q.event);

    // Remove drained events from queue
    this.queue = this.queue.filter(
      (q) => q.priority !== "critical" && q.priority !== "high"
    );
    return urgent;
  }

  /**
   * Get all events since a given tick (for the get_events tool).
   */
  getSince(sinceTick: number): GameEvent[] {
    const events = this.queue
      .map((q) => q.event)
      .filter((e) => e.tick >= sinceTick)
      .sort((a, b) => a.tick - b.tick);
    this.lastDrainTick = events.length > 0 ? events[events.length - 1].tick + 1 : sinceTick;
    // Clear the queue after full drain
    this.queue = [];
    return events;
  }

  /**
   * Get all events since the last drain (convenience for get_events with no arg).
   */
  getRecent(): GameEvent[] {
    return this.getSince(this.lastDrainTick);
  }

  get length(): number {
    return this.queue.length;
  }
}
