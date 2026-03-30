/**
 * Tests for two reconnect bugs fixed in BotManager:
 *
 * Bug 1 – Concurrent reconnect chains:
 *   minecraft-protocol's `onFatalError` emits `error` then synchronously
 *   calls `endSocket()`, which emits `end` on the same tick.  Without the
 *   `reconnectInProgress` guard this caused a second `attemptReconnect()`
 *   chain to start alongside the first, doubling the attempt counter and
 *   logging spurious "Reconnect failed" messages.
 *
 * Bug 2 – Unhandled errors after spawn:
 *   `once("error")` is removed after firing once.  Any subsequent bot error
 *   (packet parsing, pathfinding, etc.) had no listener, so Node.js threw an
 *   uncaught EventEmitter exception and crashed the process.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";

// vi.mock calls are hoisted before imports by Vitest, so these run first.
vi.mock("mineflayer", () => ({
  default: { createBot: vi.fn() },
}));

vi.mock("mineflayer-pathfinder", () => ({
  pathfinder: {},
  Movements: class {},
  goals: {},
}));

// Silence disk I/O — we're not testing persistence here
vi.mock("../Persistence.js", () => ({
  Persistence: class {
    load() {
      return { containers: [], deaths: [], lastSleepTick: -1, savedAt: "" };
    }
    save() {}
    startAutoSave() {}
    stopAutoSave() {}
  },
}));

import mineflayer from "mineflayer";
import { BotManager } from "../BotManager.js";

const createBotMock = mineflayer.createBot as ReturnType<typeof vi.fn>;

/** Build a minimal fake bot that satisfies BotManager's event-handler setup. */
function makeFakeBot() {
  const bot = new EventEmitter() as any;
  bot.loadPlugin = vi.fn();
  bot.entity = { position: { x: 0, y: 64, z: 0 }, pitch: 0, yaw: 0 };
  bot.health = 20;
  bot.food = 20;
  bot.inventory = { items: () => [] };
  bot.time = { age: 0, timeOfDay: 0 };
  bot.isRaining = false;
  bot.version = "1.20.1";
  bot.username = "TestBot";
  bot.entities = {};
  bot.experience = { points: 0 };
  return bot;
}

/**
 * Simulate the exact sequence minecraft-protocol's `onFatalError` produces:
 * `error` emitted first, then `end` on the same synchronous tick.
 */
function simulateFatalSocketError(bot: any, message = "ECONNREFUSED") {
  bot.emit("error", new Error(message));
  bot.emit("end", "socketClosed");
}

// Shorthand to flush the microtask queue without advancing wall-clock time.
const flushMicrotasks = () => vi.advanceTimersByTimeAsync(0);

describe("BotManager reconnect robustness", () => {
  let manager: BotManager;

  beforeEach(() => {
    vi.useFakeTimers();
    createBotMock.mockReset();
    manager = new BotManager({ host: "localhost", port: 25565, username: "TestBot" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Bug 1: reconnectInProgress guard prevents concurrent reconnect chains
  // ---------------------------------------------------------------------------

  describe("reconnectInProgress guard (bug 1)", () => {
    it("does not log 'Reconnect failed' when error and end fire on the same tick", async () => {
      const bot1 = makeFakeBot();
      const bot2 = makeFakeBot();
      const bot3 = makeFakeBot();
      createBotMock
        .mockReturnValueOnce(bot1)
        .mockReturnValueOnce(bot2)
        .mockReturnValueOnce(bot3);

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Initial successful connection
      const connect1 = manager.connect();
      bot1.emit("spawn");
      await connect1;

      // Disconnect → reconnect chain starts
      bot1.emit("end", "socketClosed");

      // Advance past the first reconnect delay (2 s)
      await vi.advanceTimersByTimeAsync(2500);

      // Bot2 fails — error and end fire together, exactly as minecraft-protocol does
      simulateFatalSocketError(bot2);
      await flushMicrotasks();

      // "Reconnect failed" must NOT appear: the reconnect loop owns the retry,
      // the end-handler's guard prevents a second chain from logging a false failure.
      const failedLogs = consoleSpy.mock.calls
        .map((args) => String(args[0]))
        .filter((msg) => msg.includes("Reconnect failed"));

      expect(failedLogs).toHaveLength(0);
      consoleSpy.mockRestore();
    });

    it("continues retrying within the same loop after a pre-spawn failure", async () => {
      const bot1 = makeFakeBot();
      const bot2 = makeFakeBot(); // will fail
      const bot3 = makeFakeBot(); // will succeed
      createBotMock
        .mockReturnValueOnce(bot1)
        .mockReturnValueOnce(bot2)
        .mockReturnValueOnce(bot3);

      const onReconnect = vi.fn();
      manager.onReconnect = onReconnect;

      // Connect bot1
      const connect1 = manager.connect();
      bot1.emit("spawn");
      await connect1;

      // Bot1 disconnects
      bot1.emit("end", "socketClosed");

      // Attempt 1 — delay 2 s
      await vi.advanceTimersByTimeAsync(2500);

      // Bot2 fails: error + end on same tick
      simulateFatalSocketError(bot2);
      await flushMicrotasks();

      // Attempt 2 — delay 4 s (reconnect loop continues internally)
      await vi.advanceTimersByTimeAsync(4500);

      // Bot3 spawns → reconnect succeeds
      bot3.emit("spawn");
      await flushMicrotasks();

      expect(manager.isConnected).toBe(true);
      expect(onReconnect).toHaveBeenCalledOnce();
    });

    it("the reconnect loop — not the end handler — owns subsequent attempt increments", async () => {
      const bot1 = makeFakeBot();
      const bot2 = makeFakeBot();
      const bot3 = makeFakeBot();
      createBotMock
        .mockReturnValueOnce(bot1)
        .mockReturnValueOnce(bot2)
        .mockReturnValueOnce(bot3);

      // Connect bot1
      const connect1 = manager.connect();
      bot1.emit("spawn");
      await connect1;

      // Disconnect
      bot1.emit("end", "socketClosed");

      // Attempt 1 delay
      await vi.advanceTimersByTimeAsync(2500);

      // Bot2 fails with simultaneous error + end
      simulateFatalSocketError(bot2);
      await flushMicrotasks();

      // After one real failure, the loop has advanced to attempt 2 and is
      // waiting on its delay — counter should be exactly 2, not higher (which
      // would happen if the end handler also started a separate chain that
      // incremented the counter a second time before the loop could).
      expect((manager as any).reconnectAttempt).toBe(2);
      // And only one chain should be in progress
      expect((manager as any).reconnectInProgress).toBe(true);
    });

    it("resets reconnectAttempt to 0 after a successful reconnect", async () => {
      const bot1 = makeFakeBot();
      const bot2 = makeFakeBot();
      createBotMock.mockReturnValueOnce(bot1).mockReturnValueOnce(bot2);

      const connect1 = manager.connect();
      bot1.emit("spawn");
      await connect1;

      bot1.emit("end", "socketClosed");
      await vi.advanceTimersByTimeAsync(2500);

      bot2.emit("spawn");
      await flushMicrotasks();

      expect((manager as any).reconnectAttempt).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Bug 2: permanent error handler prevents crash on post-spawn errors
  // ---------------------------------------------------------------------------

  describe("permanent error handler (bug 2)", () => {
    it("does not throw when an error is emitted after spawn", async () => {
      const bot = makeFakeBot();
      createBotMock.mockReturnValue(bot);

      const connectPromise = manager.connect();
      bot.emit("spawn");
      await connectPromise;

      // Without the permanent handler this would throw an uncaught EventEmitter
      // error, crashing the process.
      expect(() => {
        bot.emit("error", new Error("some packet error"));
      }).not.toThrow();
    });

    it("logs the error to console.error instead of crashing", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const bot = makeFakeBot();
      createBotMock.mockReturnValue(bot);

      const connectPromise = manager.connect();
      bot.emit("spawn");
      await connectPromise;

      bot.emit("error", new Error("packet decode failed"));

      const errorMessages = consoleSpy.mock.calls.map((args) => String(args[0]));
      expect(errorMessages.some((msg) => msg.includes("Bot error"))).toBe(true);
      consoleSpy.mockRestore();
    });

    it("handles multiple sequential errors without throwing", async () => {
      const bot = makeFakeBot();
      createBotMock.mockReturnValue(bot);

      const connectPromise = manager.connect();
      bot.emit("spawn");
      await connectPromise;

      // The once("error") handler would be gone after the first error without
      // the permanent handler — the second and third would throw.
      expect(() => {
        bot.emit("error", new Error("error 1"));
        bot.emit("error", new Error("error 2"));
        bot.emit("error", new Error("error 3"));
      }).not.toThrow();
    });
  });
});
