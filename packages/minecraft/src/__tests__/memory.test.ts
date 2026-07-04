import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventManager, GameMemory } from "@openroost/core";
import { registerSaveWaypoint } from "../tools/saveWaypoint.js";
import { registerListWaypoints } from "../tools/listWaypoints.js";
import { registerWriteJournal, registerReadJournal } from "../tools/journal.js";
import { registerWaitForEvents } from "../tools/waitForEvents.js";
import { registerGoTo } from "../tools/goTo.js";

type ToolHandler = (args: any) => Promise<any>;

function createMockServer() {
  const handlers = new Map<string, ToolHandler>();
  return {
    registerTool: vi.fn((name: string, _config: any, handler: ToolHandler) => {
      handlers.set(name, handler);
    }),
    getHandler(name: string): ToolHandler {
      const h = handlers.get(name);
      if (!h) throw new Error(`No handler registered for ${name}`);
      return h;
    },
  };
}

function parseResult(response: any) {
  return JSON.parse(response.content[0].text).result;
}

describe("GameMemory", () => {
  let mem: GameMemory;

  beforeEach(() => {
    mem = new GameMemory();
  });

  it("upserts waypoints by name, preserving note and createdAt", () => {
    const first = mem.setWaypoint("home", { x: 0, y: 64, z: 0 }, "main base");
    const updated = mem.setWaypoint("home", { x: 5, y: 64, z: 5 });
    expect(updated.position.x).toBe(5);
    expect(updated.note).toBe("main base");
    expect(updated.createdAt).toBe(first.createdAt);
    expect(mem.waypointCount).toBe(1);
  });

  it("removes waypoints", () => {
    mem.setWaypoint("temp", { x: 1, y: 2, z: 3 });
    expect(mem.removeWaypoint("temp")).toBe(true);
    expect(mem.removeWaypoint("temp")).toBe(false);
  });

  it("caps journal entries, keeping the newest", () => {
    for (let i = 0; i < 205; i++) mem.addJournal(`entry ${i}`);
    expect(mem.journalLength).toBe(200);
    const recent = mem.recentJournal(1);
    expect(recent[0].text).toBe("entry 204");
  });

  it("filters journal by tag", () => {
    mem.addJournal("built walls", ["project"]);
    mem.addJournal("found diamonds", ["loot"]);
    const project = mem.recentJournal(10, "project");
    expect(project).toHaveLength(1);
    expect(project[0].text).toBe("built walls");
  });

  it("round-trips through export/import and drops malformed entries", () => {
    mem.setWaypoint("home", { x: 0, y: 64, z: 0 }, "base");
    mem.addJournal("note one");
    const other = new GameMemory();
    other.importMemory({
      ...mem.exportMemory(),
      waypoints: [...mem.exportMemory().waypoints, { name: 42 } as any, null as any],
      journal: [...mem.exportMemory().journal, { nope: true } as any],
    });
    expect(other.waypointCount).toBe(1);
    expect(other.journalLength).toBe(1);
  });
});

describe("memory tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let bot: any;

  beforeEach(() => {
    server = createMockServer();
    bot = {
      memory: new GameMemory(),
      events: new EventManager(),
      isConnected: true,
      bot: { entity: { position: { x: 10.7, y: 64.2, z: -20.3 } } },
    };
    registerSaveWaypoint(server as any, bot);
    registerListWaypoints(server as any, bot);
    registerWriteJournal(server as any, bot);
    registerReadJournal(server as any, bot);
  });

  it("save_waypoint defaults to the bot's current position", async () => {
    const result = await server.getHandler("save_waypoint")({
      name: "home",
      note: "main base",
      remove: false,
    });
    const parsed = parseResult(result);
    expect(parsed.success).toBe(true);
    expect(parsed.waypoint.position).toEqual({ x: 10, y: 64, z: -21 });
  });

  it("save_waypoint accepts explicit coordinates and remove", async () => {
    await server.getHandler("save_waypoint")({
      name: "mine",
      x: 100,
      y: 12,
      z: 100,
      remove: false,
    });
    expect(bot.memory.getWaypoint("mine").position.y).toBe(12);

    const removed = await server.getHandler("save_waypoint")({
      name: "mine",
      remove: true,
    });
    expect(parseResult(removed).removed).toBe("mine");
    expect(bot.memory.waypointCount).toBe(0);
  });

  it("save_waypoint errors when disconnected with no coordinates", async () => {
    bot.isConnected = false;
    const result = await server.getHandler("save_waypoint")({
      name: "home",
      remove: false,
    });
    expect(parseResult(result).success).toBe(false);
  });

  it("list_waypoints sorts by distance from the bot", async () => {
    bot.memory.setWaypoint("far", { x: 1000, y: 64, z: 1000 });
    bot.memory.setWaypoint("near", { x: 12, y: 64, z: -20 });
    const result = await server.getHandler("list_waypoints")({});
    const parsed = parseResult(result);
    expect(parsed.count).toBe(2);
    expect(parsed.waypoints[0].name).toBe("near");
    expect(parsed.waypoints[0].distance).toBeLessThan(5);
  });

  it("journal write/read round-trip with tag filter", async () => {
    await server.getHandler("write_journal")({
      text: "castle walls done",
      tags: ["project"],
    });
    await server.getHandler("write_journal")({ text: "misc note" });
    const result = await server.getHandler("read_journal")({
      limit: 10,
      tag: "project",
    });
    const parsed = parseResult(result);
    expect(parsed.count).toBe(1);
    expect(parsed.entries[0].text).toBe("castle walls done");
  });
});

describe("go_to waypoint support", () => {
  it("errors helpfully for unknown waypoints and missing args", async () => {
    const server = createMockServer();
    const bot: any = {
      memory: new GameMemory(),
      events: new EventManager(),
      getMovements: () => ({ allowSprinting: true }),
    };
    bot.memory.setWaypoint("home", { x: 0, y: 64, z: 0 });
    registerGoTo(server as any, bot);
    const handler = server.getHandler("go_to");

    const unknown = parseResult(
      await handler({ waypoint: "nowhere", sprint: true, range: 1 })
    );
    expect(unknown.success).toBe(false);
    expect(unknown.error).toContain("home");

    const missing = parseResult(await handler({ sprint: true, range: 1 }));
    expect(missing.success).toBe(false);
    expect(missing.error).toContain("waypoint");
  });
});

describe("wait_for_events", () => {
  it("returns immediately when an urgent event is already queued", async () => {
    const server = createMockServer();
    const events = new EventManager();
    events.push({ tick: 1, type: "chat", data: {}, summary: "hi" });
    registerWaitForEvents(server as any, { events } as any);

    const start = Date.now();
    const result = await server.getHandler("wait_for_events")({
      timeoutSeconds: 5,
    });
    expect(Date.now() - start).toBeLessThan(500);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.result.interrupted).toBe(true);
    expect(payload.urgentEvents).toHaveLength(1);
  });

  it("wakes up when an urgent event arrives mid-wait", async () => {
    const server = createMockServer();
    const events = new EventManager();
    registerWaitForEvents(server as any, { events } as any);

    const pending = server.getHandler("wait_for_events")({ timeoutSeconds: 10 });
    setTimeout(
      () => events.push({ tick: 5, type: "damage_taken", data: {}, summary: "ouch" }),
      50
    );
    const start = Date.now();
    const result = await pending;
    expect(Date.now() - start).toBeLessThan(5000);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.result.interrupted).toBe(true);
    expect(payload.urgentEvents[0].type).toBe("damage_taken");
  });

  it("times out empty-handed when nothing urgent happens", async () => {
    const server = createMockServer();
    const events = new EventManager();
    registerWaitForEvents(server as any, { events } as any);

    // Low-priority events must NOT interrupt the wait
    events.push({ tick: 1, type: "sunrise", data: {}, summary: "sun" });
    const result = await server.getHandler("wait_for_events")({
      timeoutSeconds: 1,
    });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.result.interrupted).toBe(false);
    expect(payload.urgentEvents).toBeUndefined();
  });
});
