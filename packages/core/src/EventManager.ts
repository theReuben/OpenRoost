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
  private urgentWaiters: Array<() => void> = [];

  push(event: GameEvent, priority?: EventPriority): void {
    const p = priority ?? DEFAULT_PRIORITIES[event.type] ?? "normal";
    this.queue.push({ event, priority: p });

    // Evict oldest low-priority events if queue grows too large
    if (this.queue.length > this.maxQueueSize) {
      this.queue.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
      this.queue = this.queue.slice(0, this.maxQueueSize);
    }

    // Wake anyone blocked in waitForUrgent()
    if (p === "critical" || p === "high") {
      const waiters = this.urgentWaiters;
      this.urgentWaiters = [];
      for (const wake of waiters) wake();
    }
  }

  /**
   * Long-poll for urgent events: resolves as soon as a critical/high event
   * is pushed (or immediately if one is already queued), or with `false`
   * when the timeout elapses. Events themselves are NOT drained here —
   * the caller's response path drains them via wrapResponse as usual.
   */
  waitForUrgent(timeoutMs: number): Promise<boolean> {
    const hasUrgent = () =>
      this.queue.some(
        (q) => q.priority === "critical" || q.priority === "high"
      );
    if (hasUrgent()) return Promise.resolve(true);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.urgentWaiters = this.urgentWaiters.filter((w) => w !== wake);
        resolve(false);
      }, timeoutMs);
      const wake = () => {
        clearTimeout(timer);
        resolve(true);
      };
      this.urgentWaiters.push(wake);
    });
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
   * Only removes returned events from the queue — urgent events that
   * haven't been drained via wrapResponse are preserved.
   */
  getSince(sinceTick: number): GameEvent[] {
    const matching = this.queue.filter((q) => q.event.tick >= sinceTick);
    const events = matching
      .map((q) => q.event)
      .sort((a, b) => a.tick - b.tick);

    // Remove only the events we're returning; keep events that didn't match
    const matchingSet = new Set(matching);
    this.queue = this.queue.filter((q) => !matchingSet.has(q));

    this.lastDrainTick = events.length > 0 ? events[events.length - 1].tick + 1 : sinceTick;
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
