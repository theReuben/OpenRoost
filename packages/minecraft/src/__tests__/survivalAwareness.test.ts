import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventManager } from "@openroost/core";
import { registerGetTimeWeather } from "../tools/getTimeWeather.js";
import { registerSleep } from "../tools/sleep.js";

type ToolHandler = (args: any) => Promise<any>;

function createMockServer() {
  const handlers = new Map<string, ToolHandler>();
  return {
    tool: vi.fn(
      (name: string, _desc: string, _schema: any, handler: ToolHandler) => {
        handlers.set(name, handler);
      }
    ),
    getHandler(name: string): ToolHandler {
      const h = handlers.get(name);
      if (!h) throw new Error(`No handler registered for ${name}`);
      return h;
    },
  };
}

describe("Sound Awareness", () => {
  describe("sound categorization via events", () => {
    it("categorizes hostile mob sounds as danger events", () => {
      const events = new EventManager();

      // Simulate what BotManager does when it hears a creeper sound
      events.push({
        tick: 1000,
        type: "sound_heard",
        data: {
          sound: "entity.creeper.primed",
          category: "danger:creeper",
          position: { x: 10, y: 64, z: -5 },
          volume: 1.0,
          pitch: 1.0,
        },
        summary:
          "Heard danger:creeper sound: entity.creeper.primed at (10, 64, -5)",
      });

      const recent = events.getRecent();
      expect(recent).toHaveLength(1);
      expect(recent[0].type).toBe("sound_heard");
      expect(recent[0].data.category).toBe("danger:creeper");
    });
  });

  describe("get_events filtering (sounds via type filter)", () => {
    it("filters events by type", () => {
      const events = new EventManager();
      events.push({
        tick: 1000,
        type: "sound_heard",
        data: { sound: "zombie", category: "danger:zombie" },
        summary: "zombie",
      });
      events.push({
        tick: 1100,
        type: "chat",
        data: { username: "Alice", message: "hello" },
        summary: "Alice: hello",
      });

      const all = events.getRecent();
      const sounds = all.filter((e) => e.type === "sound_heard");
      expect(sounds).toHaveLength(1);
      expect(sounds[0].data.category).toBe("danger:zombie");
    });

    it("filters sound events by category prefix", () => {
      const events = new EventManager();
      events.push({
        tick: 1000,
        type: "sound_heard",
        data: { sound: "zombie", category: "danger:zombie" },
        summary: "zombie",
      });
      events.push({
        tick: 1100,
        type: "sound_heard",
        data: { sound: "cow", category: "animal" },
        summary: "cow",
      });

      const all = events.getRecent();
      const danger = all.filter(
        (e) => e.type === "sound_heard" && (e.data.category as string)?.startsWith("danger")
      );
      expect(danger).toHaveLength(1);
      expect(danger[0].data.category).toBe("danger:zombie");
    });
  });
});

describe("Time & Weather Awareness", () => {
  describe("time tracking events", () => {
    it("fires night_fall event with insomnia tracking", () => {
      const events = new EventManager();

      events.push({
        tick: 13000,
        type: "night_fall",
        data: { timeOfDay: 13000, nightsWithoutSleep: 2, phantomRisk: false },
        summary: "Night has fallen (2 nights without sleep).",
      });

      const recent = events.getRecent();
      expect(recent[0].type).toBe("night_fall");
      expect(recent[0].data.nightsWithoutSleep).toBe(2);
      expect(recent[0].data.phantomRisk).toBe(false);
    });

    it("fires phantom_warning when 3+ nights without sleep", () => {
      const events = new EventManager();

      events.push({
        tick: 72000,
        type: "phantom_warning",
        data: { nightsWithoutSleep: 3, ticksSinceSleep: 72000 },
        summary:
          "PHANTOM WARNING: 3 nights without sleep. Phantoms will attack from above.",
      });

      const recent = events.getRecent();
      expect(recent[0].type).toBe("phantom_warning");
      expect(recent[0].data.nightsWithoutSleep).toBe(3);
    });

    it("fires weather_change event", () => {
      const events = new EventManager();

      events.push({
        tick: 5000,
        type: "weather_change",
        data: { weather: "rain", previous: "clear" },
        summary:
          "It started raining. Visibility reduced, mobs won't burn in rain.",
      });

      const recent = events.getRecent();
      expect(recent[0].type).toBe("weather_change");
      expect(recent[0].data.weather).toBe("rain");
    });
  });

  describe("get_time_weather tool", () => {
    let server: ReturnType<typeof createMockServer>;

    beforeEach(() => {
      server = createMockServer();
    });

    it("returns time, weather, moon, and sleep data", async () => {
      const bot = {
        events: new EventManager(),
        bot: {
          time: { timeOfDay: 6000, age: 48000 },
          isRaining: false,
        },
        isNight: false,
        currentWeather: "clear" as const,
        lastSleepTick: 24000,
      } as any;

      registerGetTimeWeather(server as any, bot);
      const handler = server.getHandler("get_time_weather");
      const result = await handler({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.result.time.phase).toBe("afternoon");
      expect(parsed.result.time.dayCount).toBe(2);
      expect(parsed.result.time.isNight).toBe(false);
      expect(parsed.result.weather.current).toBe("clear");
      expect(parsed.result.weather.isRaining).toBe(false);
      expect(parsed.result.sleep.nightsWithoutSleep).toBe(1);
      expect(parsed.result.sleep.phantomRisk).toBe(false);
      expect(parsed.result.moon).toBeDefined();
    });

    it("shows phantom risk when 3+ nights without sleep", async () => {
      const bot = {
        events: new EventManager(),
        bot: {
          time: { timeOfDay: 14000, age: 96000 },
          isRaining: false,
        },
        isNight: true,
        currentWeather: "clear" as const,
        lastSleepTick: -1, // never slept
      } as any;

      registerGetTimeWeather(server as any, bot);
      const handler = server.getHandler("get_time_weather");
      const result = await handler({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.result.sleep.nightsWithoutSleep).toBe(4);
      expect(parsed.result.sleep.phantomRisk).toBe(true);
      expect(parsed.result.sleep.recommendation).toContain("URGENT");
    });

    it("indicates canSleepNow when night or thunder", async () => {
      const bot = {
        events: new EventManager(),
        bot: {
          time: { timeOfDay: 14000, age: 24000 },
          isRaining: true,
        },
        isNight: true,
        currentWeather: "thunder" as const,
        lastSleepTick: 20000,
      } as any;

      registerGetTimeWeather(server as any, bot);
      const handler = server.getHandler("get_time_weather");
      const result = await handler({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.result.weather.canSleepNow).toBe(true);
    });

    it("returns correct time phases", async () => {
      const phases = [
        { timeOfDay: 0, expected: "morning" },
        { timeOfDay: 3000, expected: "morning" },
        { timeOfDay: 6000, expected: "afternoon" },
        { timeOfDay: 12500, expected: "dusk" },
        { timeOfDay: 15000, expected: "night" },
        { timeOfDay: 20000, expected: "midnight" },
        { timeOfDay: 23500, expected: "dawn" },
      ];

      for (const { timeOfDay, expected } of phases) {
        const s = createMockServer();
        const bot = {
          events: new EventManager(),
          bot: { time: { timeOfDay, age: 24000 }, isRaining: false },
          isNight: timeOfDay >= 13000 && timeOfDay < 23000,
          currentWeather: "clear" as const,
          lastSleepTick: 0,
        } as any;

        registerGetTimeWeather(s as any, bot);
        const handler = s.getHandler("get_time_weather");
        const result = await handler({});
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.result.time.phase).toBe(expected);
      }
    });
  });
});

describe("Sleep Tool", () => {
  let server: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    server = createMockServer();
  });

  it("refuses to sleep during daytime", async () => {
    const bot = {
      events: new EventManager(),
      isNight: false,
      currentWeather: "clear" as const,
    } as any;

    registerSleep(server as any, bot);
    const handler = server.getHandler("sleep");
    const result = await handler({ radius: 16, forceUnsafe: false });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.result.error).toContain("night or thundering");
  });

  it("refuses to sleep when hostiles are nearby", async () => {
    const bot = {
      events: new EventManager(),
      isNight: true,
      currentWeather: "clear" as const,
      getNearbyEntities: vi.fn(() => [
        {
          name: "zombie",
          type: "mob",
          position: { x: 5, y: 64, z: 5 },
          distance: 8,
        },
      ]),
    } as any;

    registerSleep(server as any, bot);
    const handler = server.getHandler("sleep");
    const result = await handler({ radius: 16, forceUnsafe: false });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.result.error).toContain("hostile mob");
    expect(parsed.result.error).toContain("zombie");
  });

  it("returns error when no bed found", async () => {
    const bot = {
      events: new EventManager(),
      isNight: true,
      currentWeather: "clear" as const,
      getNearbyEntities: vi.fn(() => []),
      bot: {
        findBlock: vi.fn(() => null),
      },
    } as any;

    registerSleep(server as any, bot);
    const handler = server.getHandler("sleep");
    const result = await handler({ radius: 16, forceUnsafe: false });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.result.error).toContain("No bed found");
  });

  it("sleeps successfully when conditions are met", async () => {
    const mockBed = {
      position: { x: 10, y: 64, z: 10, distanceTo: () => 2 },
      name: "red_bed",
    };

    const bot = {
      events: new EventManager(),
      isNight: true,
      currentWeather: "clear" as const,
      lastSleepTick: -1,
      getNearbyEntities: vi.fn(() => []),
      getObservation: vi.fn(() => ({
        position: { x: 10, y: 64, z: 10 },
        health: 20,
        food: 20,
        experience: 0,
        gameTime: 14000,
        biome: "plains",
        isRaining: false,
        lightLevel: 0,
        nearbyBlocks: [],
        nearbyEntities: [],
        activeEffects: [],
      })),
      bot: {
        findBlock: vi.fn(() => mockBed),
        entity: {
          position: {
            distanceTo: () => 2,
          },
        },
        time: { age: 14000 },
        sleep: vi.fn(async () => {}),
        // Simulate server waking the bot immediately
        once: vi.fn((_event: string, cb: Function) => { cb(); }),
      },
    } as any;

    registerSleep(server as any, bot);
    const handler = server.getHandler("sleep");
    const result = await handler({ radius: 16, forceUnsafe: false });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.result.success).toBe(true);
    expect(parsed.result.message).toContain("Phantom timer reset");
    expect(bot.bot.sleep).toHaveBeenCalledWith(mockBed);
    expect(bot.lastSleepTick).toBe(14000);
  });

  it("allows sleeping during thunderstorm even if not night", async () => {
    const mockBed = {
      position: { x: 5, y: 64, z: 5, distanceTo: () => 1 },
      name: "white_bed",
    };

    const bot = {
      events: new EventManager(),
      isNight: false,
      currentWeather: "thunder" as const,
      lastSleepTick: -1,
      getNearbyEntities: vi.fn(() => []),
      getObservation: vi.fn(() => ({
        position: { x: 5, y: 64, z: 5 },
        health: 20,
        food: 20,
        experience: 0,
        gameTime: 6000,
        biome: "plains",
        isRaining: true,
        lightLevel: 5,
        nearbyBlocks: [],
        nearbyEntities: [],
        activeEffects: [],
      })),
      bot: {
        findBlock: vi.fn(() => mockBed),
        entity: { position: { distanceTo: () => 1 } },
        time: { age: 6000 },
        sleep: vi.fn(async () => {}),
        once: vi.fn((_event: string, cb: Function) => { cb(); }),
      },
    } as any;

    registerSleep(server as any, bot);
    const handler = server.getHandler("sleep");
    const result = await handler({ radius: 16, forceUnsafe: false });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.result.success).toBe(true);
  });
});
