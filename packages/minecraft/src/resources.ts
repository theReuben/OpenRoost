import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BotManager } from "./BotManager.js";

/**
 * Register all MCP resources on the server and wire up live update
 * notifications so subscribed clients get pushed changes automatically.
 */
export function registerResources(server: McpServer, bot: BotManager): void {
  // ── minecraft://status ──
  server.resource(
    "Bot Status",
    "minecraft://status",
    { description: "Bot connection status, game mode, and difficulty" },
    async () => ({
      contents: [
        {
          uri: "minecraft://status",
          mimeType: "application/json",
          text: JSON.stringify(getStatus(bot), null, 2),
        },
      ],
    })
  );

  // ── minecraft://inventory ──
  server.resource(
    "Inventory",
    "minecraft://inventory",
    { description: "Current inventory contents, armor, and held item (subscribable)" },
    async () => ({
      contents: [
        {
          uri: "minecraft://inventory",
          mimeType: "application/json",
          text: JSON.stringify(getInventory(bot), null, 2),
        },
      ],
    })
  );

  // ── minecraft://position ──
  server.resource(
    "Position",
    "minecraft://position",
    { description: "Current coordinates and facing direction" },
    async () => ({
      contents: [
        {
          uri: "minecraft://position",
          mimeType: "application/json",
          text: JSON.stringify(getPosition(bot), null, 2),
        },
      ],
    })
  );

  // ── minecraft://nearby-players ──
  server.resource(
    "Nearby Players",
    "minecraft://nearby-players",
    { description: "List of online players with positions" },
    async () => ({
      contents: [
        {
          uri: "minecraft://nearby-players",
          mimeType: "application/json",
          text: JSON.stringify(getNearbyPlayers(bot), null, 2),
        },
      ],
    })
  );

  // ── minecraft://time-weather ──
  server.resource(
    "Time & Weather",
    "minecraft://time-weather",
    { description: "Current time of day, weather, moon phase, and sleep/phantom status (subscribable)" },
    async () => ({
      contents: [
        {
          uri: "minecraft://time-weather",
          mimeType: "application/json",
          text: JSON.stringify(getTimeWeather(bot), null, 2),
        },
      ],
    })
  );

  // ── minecraft://events ──
  server.resource(
    "Recent Events",
    "minecraft://events",
    { description: "Recent game events (damage, chat, deaths, etc.)" },
    async () => ({
      contents: [
        {
          uri: "minecraft://events",
          mimeType: "application/json",
          text: JSON.stringify({ events: bot.events.getRecent() }, null, 2),
        },
      ],
    })
  );
}

/**
 * Wire up Mineflayer bot events to send MCP resource update notifications.
 * Call this AFTER the bot has connected and the MCP transport is running.
 */
export function wireResourceNotifications(server: McpServer, bot: BotManager): void {
  const srv = server.server;

  // Inventory changes
  bot.bot.inventory.on("updateSlot" as any, () => {
    srv.sendResourceUpdated({ uri: "minecraft://inventory" }).catch(() => {});
  });

  // Position changes (throttled to avoid flooding — every 2 seconds)
  let lastPositionNotify = 0;
  bot.bot.on("move", () => {
    const now = Date.now();
    if (now - lastPositionNotify > 2000) {
      lastPositionNotify = now;
      srv.sendResourceUpdated({ uri: "minecraft://position" }).catch(() => {});
    }
  });

  // Player join/leave
  bot.bot.on("playerJoined", () => {
    srv.sendResourceUpdated({ uri: "minecraft://nearby-players" }).catch(() => {});
  });
  bot.bot.on("playerLeft", () => {
    srv.sendResourceUpdated({ uri: "minecraft://nearby-players" }).catch(() => {});
  });

  // Health/status changes
  bot.bot.on("health", () => {
    srv.sendResourceUpdated({ uri: "minecraft://status" }).catch(() => {});
  });

  // Chat and other events trigger the events resource
  bot.bot.on("chat", () => {
    srv.sendResourceUpdated({ uri: "minecraft://events" }).catch(() => {});
  });
  bot.bot.on("entityHurt", (entity) => {
    if (entity === bot.bot.entity) {
      srv.sendResourceUpdated({ uri: "minecraft://events" }).catch(() => {});
    }
  });
  bot.bot.on("death", () => {
    srv.sendResourceUpdated({ uri: "minecraft://status" }).catch(() => {});
    srv.sendResourceUpdated({ uri: "minecraft://events" }).catch(() => {});
  });

  // Time changes (throttled — every 10 seconds)
  let lastTimeNotify = 0;
  bot.bot.on("time", () => {
    const now = Date.now();
    if (now - lastTimeNotify > 10000) {
      lastTimeNotify = now;
      srv.sendResourceUpdated({ uri: "minecraft://time-weather" }).catch(() => {});
    }
  });

  // Weather changes
  bot.bot.on("rain", () => {
    srv.sendResourceUpdated({ uri: "minecraft://time-weather" }).catch(() => {});
  });
  bot.bot.on("weatherUpdate" as any, () => {
    srv.sendResourceUpdated({ uri: "minecraft://time-weather" }).catch(() => {});
  });
}

// ── Data builders ──

function getStatus(bot: BotManager) {
  if (!bot.isConnected) {
    return { connected: false };
  }

  const b = bot.bot;
  return {
    connected: true,
    username: b.username,
    health: b.health,
    food: b.food,
    gameMode: (b as any).game?.gameMode ?? "unknown",
    difficulty: (b as any).game?.difficulty ?? "unknown",
    dimension: (b as any).game?.dimension ?? "unknown",
    serverBrand: (b as any).game?.serverBrand ?? "unknown",
  };
}

function getInventory(bot: BotManager) {
  const items = bot.getInventoryItems();

  const armorSlots = [5, 6, 7, 8];
  const armor = armorSlots
    .map((slot) => bot.bot.inventory.slots[slot])
    .filter(Boolean)
    .map((item: any) => ({ name: item.name, count: item.count, slot: item.slot }));

  const held = bot.bot.heldItem;

  return {
    items,
    armor,
    heldItem: held ? { name: held.name, count: held.count, slot: held.slot } : null,
    emptySlots: bot.bot.inventory.emptySlotCount(),
  };
}

function getPosition(bot: BotManager) {
  const pos = bot.bot.entity.position;
  const yaw = bot.bot.entity.yaw;
  const pitch = bot.bot.entity.pitch;

  // Convert yaw to cardinal direction
  const directions = ["south", "west", "north", "east"];
  const idx = Math.round(((yaw * 180) / Math.PI + 360) % 360 / 90) % 4;

  return {
    x: Math.floor(pos.x),
    y: Math.floor(pos.y),
    z: Math.floor(pos.z),
    exactX: Math.round(pos.x * 100) / 100,
    exactY: Math.round(pos.y * 100) / 100,
    exactZ: Math.round(pos.z * 100) / 100,
    yaw: Math.round((yaw * 180) / Math.PI),
    pitch: Math.round((pitch * 180) / Math.PI),
    facing: directions[idx] ?? "unknown",
  };
}

function getTimeWeather(bot: BotManager) {
  if (!bot.isConnected) {
    return { connected: false };
  }

  const time = bot.bot.time;
  const timeOfDay = time.timeOfDay;
  const dayCount = Math.floor(time.age / 24000);

  const phases = ["morning", "afternoon", "dusk", "night", "midnight", "dawn"];
  let phase = "unknown";
  if (timeOfDay >= 0 && timeOfDay < 6000) phase = "morning";
  else if (timeOfDay >= 6000 && timeOfDay < 12000) phase = "afternoon";
  else if (timeOfDay >= 12000 && timeOfDay < 13000) phase = "dusk";
  else if (timeOfDay >= 13000 && timeOfDay < 18000) phase = "night";
  else if (timeOfDay >= 18000 && timeOfDay < 23000) phase = "midnight";
  else phase = "dawn";

  const ticksSinceSleep = bot.lastSleepTick >= 0
    ? (time.age - bot.lastSleepTick)
    : time.age;

  return {
    timeOfDay,
    phase,
    dayCount,
    isNight: bot.isNight,
    weather: bot.currentWeather,
    isRaining: bot.bot.isRaining,
    nightsWithoutSleep: Math.floor(ticksSinceSleep / 24000),
    phantomRisk: Math.floor(ticksSinceSleep / 24000) >= 3,
  };
}

function getNearbyPlayers(bot: BotManager) {
  const players = Object.values(bot.bot.players)
    .filter((p) => p.username !== bot.bot.username)
    .map((p) => {
      const result: Record<string, unknown> = {
        username: p.username,
        ping: p.ping,
      };

      if (p.entity) {
        result.position = {
          x: Math.floor(p.entity.position.x),
          y: Math.floor(p.entity.position.y),
          z: Math.floor(p.entity.position.z),
        };
        result.distance = Math.round(
          p.entity.position.distanceTo(bot.bot.entity.position) * 10
        ) / 10;
      } else {
        result.position = null;
        result.distance = null;
      }

      return result;
    });

  return { players, count: players.length };
}
