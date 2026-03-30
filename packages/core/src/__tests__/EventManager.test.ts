import { describe, it, expect, beforeEach } from "vitest";
import { EventManager } from "../EventManager.js";
import { GameEvent } from "../types.js";

function makeEvent(tick: number, type: GameEvent["type"] = "chat", summary = "test"): GameEvent {
  return { tick, type, data: {}, summary };
}

describe("EventManager", () => {
  let em: EventManager;

  beforeEach(() => {
    em = new EventManager();
  });

  describe("push", () => {
    it("adds events to the queue", () => {
      em.push(makeEvent(1));
      expect(em.length).toBe(1);
    });

    it("accepts an explicit priority", () => {
      em.push(makeEvent(1, "chat"), "low");
      // Should NOT appear in drainUrgent since we overrode to low
      const urgent = em.drainUrgent();
      expect(urgent).toHaveLength(0);
      expect(em.length).toBe(1); // still in queue as low
    });

    it("uses default priority for known event types", () => {
      em.push(makeEvent(1, "death")); // critical by default
      const urgent = em.drainUrgent();
      expect(urgent).toHaveLength(1);
      expect(urgent[0].type).toBe("death");
    });
  });

  describe("drainUrgent", () => {
    it("returns critical and high priority events", () => {
      em.push(makeEvent(1, "death"));        // critical
      em.push(makeEvent(2, "chat"));          // high
      em.push(makeEvent(3, "sunrise"));       // low
      em.push(makeEvent(4, "player_joined")); // normal

      const urgent = em.drainUrgent();
      expect(urgent).toHaveLength(2);
      // critical comes before high
      expect(urgent[0].type).toBe("death");
      expect(urgent[1].type).toBe("chat");
    });

    it("removes drained events from queue", () => {
      em.push(makeEvent(1, "death"));
      em.push(makeEvent(2, "sunrise"));
      em.drainUrgent();
      expect(em.length).toBe(1); // only sunrise remains
    });

    it("returns empty array when no urgent events", () => {
      em.push(makeEvent(1, "sunrise"));
      expect(em.drainUrgent()).toHaveLength(0);
    });
  });

  describe("getSince", () => {
    it("returns events with tick >= sinceTick", () => {
      em.push(makeEvent(5));
      em.push(makeEvent(10));
      em.push(makeEvent(15));

      const events = em.getSince(10);
      expect(events).toHaveLength(2);
      expect(events[0].tick).toBe(10);
      expect(events[1].tick).toBe(15);
    });

    it("clears the queue after draining", () => {
      em.push(makeEvent(1));
      em.getSince(0);
      expect(em.length).toBe(0);
    });

    it("returns events sorted by tick", () => {
      em.push(makeEvent(15));
      em.push(makeEvent(5));
      em.push(makeEvent(10));

      const events = em.getSince(0);
      expect(events.map((e) => e.tick)).toEqual([5, 10, 15]);
    });
  });

  describe("getRecent", () => {
    it("returns events since last drain", () => {
      em.push(makeEvent(1));
      em.push(makeEvent(5));
      em.getSince(0); // drains all, sets lastDrainTick to 6

      em.push(makeEvent(7));
      em.push(makeEvent(10));

      const recent = em.getRecent();
      expect(recent).toHaveLength(2);
    });

    it("returns all events when no previous drain", () => {
      em.push(makeEvent(1));
      em.push(makeEvent(2));
      const recent = em.getRecent();
      expect(recent).toHaveLength(2);
    });
  });

  describe("queue overflow / eviction", () => {
    it("evicts low-priority events when queue exceeds max size", () => {
      for (let i = 0; i < 201; i++) {
        em.push(makeEvent(i, "sunrise")); // low priority
      }
      expect(em.length).toBeLessThanOrEqual(200);
    });

    it("keeps high-priority events during eviction", () => {
      for (let i = 0; i < 199; i++) {
        em.push(makeEvent(i, "sunrise")); // low priority
      }
      em.push(makeEvent(200, "death")); // critical
      em.push(makeEvent(201, "sunrise")); // low - triggers overflow

      const urgent = em.drainUrgent();
      expect(urgent).toHaveLength(1);
      expect(urgent[0].type).toBe("death");
    });
  });
});
