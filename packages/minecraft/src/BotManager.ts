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
