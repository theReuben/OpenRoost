import mineflayer, { Bot } from "mineflayer";
import { pathfinder, Movements, goals } from "mineflayer-pathfinder";
import {
  EventManager,
  TaskManager,
  ObservationSnapshot,
  BlockInfo,
  EntityInfo,
  ItemStack,
  GameEvent,
  Position,
} from "@openroost/core";
import { ContainerMemory } from "./ContainerMemory.js";

export interface BotConfig {
  host: string;
  port: number;
  username: string;
  version?: string;
}

/**
 * Wraps a Mineflayer bot instance with OpenRoost infrastructure:
 * event manager, task manager, and convenience methods for
 * building observation snapshots.
 */
export interface DeathRecord {
  position: Position;
  timestamp: number;
  gameTime: number;
  message?: string;
}

/** Mineflayer sound categories by numeric ID */
const SOUND_CATEGORIES: Record<number, string> = {
  0: "master",
  1: "music",
  2: "record",
  3: "weather",
  4: "block",
  5: "hostile",
  6: "neutral",
  7: "player",
  8: "ambient",
  9: "voice",
};

/** Categorize a named sound effect into something meaningful for the bot. */
function categorizeSoundEffect(soundName: string): string | null {
  // Hostile mob sounds - always important
  if (soundName.includes("creeper") || soundName.includes("hiss")) return "danger:creeper";
  if (soundName.includes("skeleton")) return "danger:skeleton";
  if (soundName.includes("zombie")) return "danger:zombie";
  if (soundName.includes("spider")) return "danger:spider";
  if (soundName.includes("enderman")) return "danger:enderman";
  if (soundName.includes("phantom")) return "danger:phantom";
  if (soundName.includes("wither")) return "danger:wither";
  if (soundName.includes("blaze")) return "danger:blaze";
  if (soundName.includes("ghast")) return "danger:ghast";

  // Explosions
  if (soundName.includes("explode") || soundName.includes("explosion")) return "danger:explosion";
  if (soundName.includes("tnt")) return "danger:tnt";

  // Environmental warnings
  if (soundName.includes("lava")) return "warning:lava";
  if (soundName.includes("fire")) return "warning:fire";

  // Player activity
  if (soundName.includes("footstep") || soundName.includes("step")) return "activity:footsteps";
  if (soundName.includes("mining") || soundName.includes("break") || soundName.includes("dig")) return "activity:mining";
  if (soundName.includes("bow") || soundName.includes("shoot")) return "activity:ranged";
  if (soundName.includes("anvil")) return "activity:anvil";

  // Neutral/animal sounds
  if (soundName.includes("cow") || soundName.includes("pig") || soundName.includes("sheep") || soundName.includes("chicken")) return "animal";

  // Weather
  if (soundName.includes("thunder") || soundName.includes("lightning")) return "weather:thunder";
  if (soundName.includes("rain")) return "weather:rain";

  // Door / chest interactions
  if (soundName.includes("door") || soundName.includes("chest") || soundName.includes("open") || soundName.includes("close")) return "interaction";

  // Filter out ambient noise / very common sounds that would flood events
  if (soundName.includes("ambient") || soundName.includes("water") || soundName.includes("swim")) return null;
  if (soundName.includes("click") || soundName.includes("pop")) return null;

  // Unknown but potentially relevant
  return null;
}

export class BotManager {
  bot!: Bot;
  events: EventManager;
  tasks: TaskManager;
  private config: BotConfig;
  private connected = false;

  /** History of death locations, most recent first. */
  deathHistory: DeathRecord[] = [];
  /** Maximum number of deaths to remember. */
  private maxDeathHistory = 10;

  /** Memory of container contents with decay over time. */
  containerMemory = new ContainerMemory();

  /** Tick when the bot last slept in a bed. -1 means never slept. */
  lastSleepTick = -1;
  /** Whether it is currently nighttime. */
  isNight = false;
  /** Current weather state. */
  currentWeather: "clear" | "rain" | "thunder" = "clear";

  constructor(config: BotConfig) {
    this.config = config;
    this.events = new EventManager();
    this.tasks = new TaskManager();
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.bot = mineflayer.createBot({
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        version: this.config.version,
        hideErrors: false,
      });

      this.bot.loadPlugin(pathfinder);

      this.bot.once("spawn", () => {
        this.connected = true;
        this.setupEventListeners();
        resolve();
      });

      this.bot.once("error", (err) => {
        if (!this.connected) reject(err);
      });

      this.bot.once("end", () => {
        this.connected = false;
      });
    });
  }

  get isConnected(): boolean {
    return this.connected;
  }

  private setupEventListeners(): void {
    const bot = this.bot;

    bot.on("chat", (username, message) => {
      if (username === bot.username) return;
      this.pushEvent("chat", { username, message }, `${username}: ${message}`);
    });

    bot.on("health", () => {
      if (bot.health <= 5) {
        this.pushEvent(
          "damage_taken",
          { health: bot.health, food: bot.food },
          `Low health warning: ${bot.health}/20`
        );
      }
    });

    bot.on("death", () => {
      // Record death position before respawning
      const pos = bot.entity.position;
      const deathPos: Position = {
        x: Math.floor(pos.x),
        y: Math.floor(pos.y),
        z: Math.floor(pos.z),
      };
      const deathRecord: DeathRecord = {
        position: deathPos,
        timestamp: Date.now(),
        gameTime: bot.time?.age ?? 0,
      };
      this.deathHistory.unshift(deathRecord);
      if (this.deathHistory.length > this.maxDeathHistory) {
        this.deathHistory.pop();
      }

      this.pushEvent(
        "death",
        {
          deathPosition: deathPos,
          deathCount: this.deathHistory.length,
        },
        `Bot died at (${deathPos.x}, ${deathPos.y}, ${deathPos.z}). Items were dropped there. Auto-respawning...`
      );

      // Cancel all running tasks — they're invalid after death
      for (const task of this.tasks.getRunning()) {
        this.tasks.fail(task.id, "Cancelled: bot died");
      }

      // Auto-respawn after a brief delay
      setTimeout(() => {
        try {
          (bot as any).respawn?.();
        } catch {
          // Some server versions handle respawn differently
        }
      }, 1000);
    });

    bot.on("spawn", () => {
      // Only fire respawn event if we have death history (i.e., not the initial spawn)
      if (this.deathHistory.length > 0) {
        const lastDeath = this.deathHistory[0];
        const currentPos = bot.entity.position;
        this.pushEvent(
          "respawn",
          {
            spawnPosition: {
              x: Math.floor(currentPos.x),
              y: Math.floor(currentPos.y),
              z: Math.floor(currentPos.z),
            },
            lastDeathPosition: lastDeath.position,
          },
          `Respawned at (${Math.floor(currentPos.x)}, ${Math.floor(currentPos.y)}, ${Math.floor(currentPos.z)}). Dropped items are at (${lastDeath.position.x}, ${lastDeath.position.y}, ${lastDeath.position.z}).`
        );
      }
    });

    bot.on("playerJoined", (player) => {
      this.pushEvent(
        "player_joined",
        { username: player.username },
        `${player.username} joined the game`
      );
    });

    bot.on("playerLeft", (player) => {
      this.pushEvent(
        "player_left",
        { username: player.username },
        `${player.username} left the game`
      );
    });

    bot.on("entityHurt", (entity) => {
      if (entity === bot.entity) {
        this.pushEvent(
          "damage_taken",
          { health: bot.health },
          `Took damage, health: ${bot.health}/20`
        );
      }
    });

    // Sound awareness
    bot.on("soundEffectHeard" as any, (soundName: string, position: any, volume: number, pitch: number) => {
      const category = categorizeSoundEffect(soundName);
      if (category) {
        const pos = position ? {
          x: Math.floor(position.x),
          y: Math.floor(position.y),
          z: Math.floor(position.z),
        } : undefined;
        this.pushEvent(
          "sound_heard",
          { sound: soundName, category, position: pos, volume, pitch },
          `Heard ${category} sound: ${soundName}${pos ? ` at (${pos.x}, ${pos.y}, ${pos.z})` : ""}`
        );
      }
    });

    bot.on("hardcodedSoundEffectHeard" as any, (soundId: number, soundCategory: number, position: any, volume: number, pitch: number) => {
      const pos = position ? {
        x: Math.floor(position.x),
        y: Math.floor(position.y),
        z: Math.floor(position.z),
      } : undefined;
      const category = SOUND_CATEGORIES[soundCategory] ?? "unknown";
      this.pushEvent(
        "sound_heard",
        { soundId, category, position: pos, volume, pitch },
        `Heard ${category} sound (id: ${soundId})${pos ? ` at (${pos.x}, ${pos.y}, ${pos.z})` : ""}`
      );
    });

    // Time of day tracking
    bot.on("time", () => {
      const timeOfDay = bot.time.timeOfDay;
      const wasNight = this.isNight;

      // Night is 13000-23000 ticks in the day cycle
      this.isNight = timeOfDay >= 13000 && timeOfDay < 23000;

      if (!wasNight && this.isNight) {
        // Check insomnia - phantoms spawn after 72000 ticks (3 days) without sleep
        const ticksSinceSleep = this.lastSleepTick >= 0
          ? (bot.time.age - this.lastSleepTick)
          : bot.time.age;
        const nightsWithoutSleep = Math.floor(ticksSinceSleep / 24000);

        this.pushEvent(
          "night_fall",
          {
            timeOfDay,
            nightsWithoutSleep,
            phantomRisk: nightsWithoutSleep >= 3,
          },
          nightsWithoutSleep >= 3
            ? `Night has fallen. WARNING: ${nightsWithoutSleep} nights without sleep — phantoms will spawn! Find a bed.`
            : `Night has fallen (${nightsWithoutSleep} night${nightsWithoutSleep !== 1 ? "s" : ""} without sleep).`
        );

        if (nightsWithoutSleep >= 3) {
          this.pushEvent(
            "phantom_warning",
            { nightsWithoutSleep, ticksSinceSleep },
            `PHANTOM WARNING: ${nightsWithoutSleep} nights without sleep. Phantoms will attack from above. Sleep in a bed urgently!`
          );
        }
      } else if (wasNight && !this.isNight) {
        this.pushEvent(
          "sunrise",
          { timeOfDay },
          "The sun has risen. Hostile mobs will burn in sunlight."
        );
      }
    });

    // Weather tracking
    bot.on("rain", () => {
      const wasWeather = this.currentWeather;
      this.currentWeather = bot.isRaining ? "rain" : "clear";
      if (wasWeather !== this.currentWeather) {
        this.pushEvent(
          "weather_change",
          { weather: this.currentWeather, previous: wasWeather },
          this.currentWeather === "rain"
            ? "It started raining. Visibility reduced, mobs won't burn in rain."
            : "The rain has stopped."
        );
      }
    });

    bot.on("weatherUpdate" as any, () => {
      const wasWeather = this.currentWeather;
      if ((bot as any).thunderState > 0) {
        this.currentWeather = "thunder";
      } else if (bot.isRaining) {
        this.currentWeather = "rain";
      } else {
        this.currentWeather = "clear";
      }
      if (wasWeather !== this.currentWeather) {
        this.pushEvent(
          "weather_change",
          { weather: this.currentWeather, previous: wasWeather },
          this.currentWeather === "thunder"
            ? "A thunderstorm has begun! Lightning can strike. You can sleep during thunderstorms."
            : this.currentWeather === "rain"
              ? "Thunder has subsided, still raining."
              : "The weather has cleared."
        );
      }
    });

    // Track sleeping
    bot.on("sleep" as any, () => {
      this.lastSleepTick = bot.time.age;
    });
  }

  private pushEvent(
    type: GameEvent["type"],
    data: Record<string, unknown>,
    summary: string
  ): void {
    this.events.push({
      tick: this.bot.time?.age ?? 0,
      type,
      data,
      summary,
    });
  }

  /** Build a full observation snapshot of current state. */
  getObservation(): ObservationSnapshot {
    const bot = this.bot;
    const pos = bot.entity.position;

    return {
      position: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) },
      health: bot.health,
      food: bot.food,
      experience: bot.experience?.points ?? 0,
      gameTime: bot.time?.age ?? 0,
      biome: this.getBiome(),
      isRaining: bot.isRaining,
      lightLevel: this.getLightLevel(),
      nearbyBlocks: this.getNearbyBlocks(4),
      nearbyEntities: this.getNearbyEntities(16),
      activeEffects: this.getActiveEffects_(),
    };
  }

  private getBiome(): string {
    try {
      const pos = this.bot.entity.position;
      const block = this.bot.blockAt(pos);
      return block?.biome?.name ?? "unknown";
    } catch {
      return "unknown";
    }
  }

  private getLightLevel(): number {
    try {
      const pos = this.bot.entity.position;
      const block = this.bot.blockAt(pos);
      return block?.light ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Check if a block has at least one face exposed to air/transparent block
   * (i.e., visible to a player without x-ray). A block fully surrounded by
   * solid opaque blocks would not be visible.
   */
  isBlockExposed(x: number, y: number, z: number): boolean {
    const offsets = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    const center = this.bot.entity.position;
    for (const [ox, oy, oz] of offsets) {
      try {
        const neighbor = this.bot.blockAt(
          center.offset(x - center.x + ox, y - center.y + oy, z - center.z + oz)
        );
        if (
          !neighbor ||
          neighbor.name === "air" ||
          neighbor.name === "cave_air" ||
          neighbor.name === "void_air" ||
          neighbor.transparent
        ) {
          return true;
        }
      } catch {
        return true; // unloaded chunk = treat as exposed
      }
    }
    return false;
  }

  getNearbyBlocks(radius: number): BlockInfo[] {
    const bot = this.bot;
    const center = bot.entity.position;
    const blocks: BlockInfo[] = [];

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const pos = center.offset(dx, dy, dz);
          const block = bot.blockAt(pos);
          if (block && block.name !== "air" && block.name !== "cave_air") {
            // Only include blocks a player could actually see
            const bx = Math.floor(pos.x);
            const by = Math.floor(pos.y);
            const bz = Math.floor(pos.z);
            if (this.isBlockExposed(bx, by, bz)) {
              blocks.push({ name: block.name, position: { x: bx, y: by, z: bz } });
            }
          }
        }
      }
    }
    return blocks;
  }

  getNearbyEntities(radius: number): EntityInfo[] {
    const bot = this.bot;
    const entities: EntityInfo[] = [];

    for (const entity of Object.values(bot.entities)) {
      if (entity === bot.entity) continue;
      const dist = entity.position.distanceTo(bot.entity.position);
      if (dist > radius) continue;

      let type: EntityInfo["type"] = "mob";
      if (entity.type === "player") type = "player";
      else if (entity.type === "object") type = "item";
      else if (
        entity.name &&
        ["cow", "pig", "sheep", "chicken", "horse", "donkey", "mule", "rabbit", "wolf", "cat", "fox", "bee"].includes(entity.name)
      ) {
        type = "animal";
      }

      // Health is only visible to a player within close range (~6 blocks)
      const canSeeHealth = dist <= 6;

      entities.push({
        name: entity.name ?? entity.type ?? "unknown",
        type,
        position: {
          x: Math.floor(entity.position.x),
          y: Math.floor(entity.position.y),
          z: Math.floor(entity.position.z),
        },
        health: canSeeHealth ? ((entity as any).health ?? undefined) : undefined,
        distance: Math.round(dist * 10) / 10,
      });
    }

    return entities.sort((a, b) => a.distance - b.distance);
  }

  getInventoryItems(): ItemStack[] {
    return this.bot.inventory.items().map((item) => ({
      name: item.name,
      count: item.count,
      slot: item.slot,
    }));
  }

  private getActiveEffects_(): string[] {
    try {
      const effects = (this.bot as any).entity?.effects;
      if (!effects) return [];
      return Object.values(effects).map((e: any) => e.effectId?.toString() ?? "unknown");
    } catch {
      return [];
    }
  }

  getMovements(): Movements {
    return new Movements(this.bot);
  }

  get Goals() {
    return goals;
  }

  disconnect(): void {
    if (this.connected) {
      this.bot.quit();
      this.connected = false;
    }
  }
}
