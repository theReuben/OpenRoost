import { Position, ItemStack } from "@openroost/core";

/** How clearly the bot remembers a container's contents. */
export type MemoryClarity = "exact" | "fading" | "vague" | "forgotten";

/** A single remembered item — may be approximate depending on memory clarity. */
export interface RememberedItem {
  name: string;
  count: number | "some";
}

/** A stored memory of a container's contents at a given position. */
export interface ContainerRecord {
  position: Position;
  blockName: string;
  /** The exact items that were in the container when last checked. */
  items: ItemStack[];
  /** Game tick when the container was last checked. */
  lastCheckedTick: number;
  /** Wall-clock timestamp of last check. */
  lastCheckedTime: number;
}

/** What gets returned when recalling a container — items may be degraded. */
export interface ContainerRecall {
  position: Position;
  blockName: string;
  clarity: MemoryClarity;
  items: RememberedItem[];
  lastCheckedTick: number;
  ticksAgo: number;
}

/**
 * Items considered "notable" that stick in memory longer.
 * A human player remembers where they put their diamonds —
 * not so much which chest has cobblestone.
 */
const NOTABLE_ITEMS = new Set([
  "diamond",
  "diamond_block",
  "diamond_ore",
  "diamond_pickaxe",
  "diamond_sword",
  "diamond_axe",
  "diamond_shovel",
  "diamond_helmet",
  "diamond_chestplate",
  "diamond_leggings",
  "diamond_boots",
  "netherite_ingot",
  "netherite_block",
  "netherite_pickaxe",
  "netherite_sword",
  "netherite_axe",
  "netherite_shovel",
  "netherite_helmet",
  "netherite_chestplate",
  "netherite_leggings",
  "netherite_boots",
  "emerald",
  "emerald_block",
  "gold_ingot",
  "gold_block",
  "iron_ingot",
  "iron_block",
  "enchanted_book",
  "elytra",
  "totem_of_undying",
  "nether_star",
  "beacon",
  "ender_pearl",
  "blaze_rod",
  "golden_apple",
  "enchanted_golden_apple",
  "name_tag",
  "trident",
]);

/**
 * Thresholds in game ticks (20 ticks = 1 second):
 * - < 5 min  (6000 ticks):  exact recall
 * - 5–20 min (6000–24000):  fading — names but approximate counts
 * - 20–60 min (24000–72000): vague — only notable items remembered
 * - > 60 min (72000+):       forgotten — just knows a container exists
 */
const FADING_THRESHOLD = 6_000; // 5 minutes
const VAGUE_THRESHOLD = 24_000; // 20 minutes
const FORGOTTEN_THRESHOLD = 72_000; // 60 minutes

function positionKey(pos: Position): string {
  return `${pos.x},${pos.y},${pos.z}`;
}

export class ContainerMemory {
  private containers = new Map<string, ContainerRecord>();
  private maxContainers = 50;

  /** Record (or update) the contents of a container at a position. */
  record(
    position: Position,
    blockName: string,
    items: ItemStack[],
    currentTick: number
  ): void {
    const key = positionKey(position);
    this.containers.set(key, {
      position,
      blockName,
      items: [...items],
      lastCheckedTick: currentTick,
      lastCheckedTime: Date.now(),
    });

    // Evict oldest entries if over capacity
    if (this.containers.size > this.maxContainers) {
      let oldestKey: string | undefined;
      let oldestTick = Infinity;
      for (const [k, v] of this.containers) {
        if (v.lastCheckedTick < oldestTick) {
          oldestTick = v.lastCheckedTick;
          oldestKey = k;
        }
      }
      if (oldestKey) this.containers.delete(oldestKey);
    }
  }

  /** Get the memory clarity level based on how many ticks have passed. */
  getClarity(ticksAgo: number): MemoryClarity {
    if (ticksAgo < FADING_THRESHOLD) return "exact";
    if (ticksAgo < VAGUE_THRESHOLD) return "fading";
    if (ticksAgo < FORGOTTEN_THRESHOLD) return "vague";
    return "forgotten";
  }

  /** Recall all remembered containers, with memory decay applied. */
  recall(currentTick: number): ContainerRecall[] {
    const results: ContainerRecall[] = [];

    for (const record of this.containers.values()) {
      const ticksAgo = currentTick - record.lastCheckedTick;
      const clarity = this.getClarity(ticksAgo);

      let items: RememberedItem[];
      switch (clarity) {
        case "exact":
          items = record.items.map((i) => ({ name: i.name, count: i.count }));
          break;
        case "fading":
          items = record.items.map((i) => ({ name: i.name, count: "some" as const }));
          break;
        case "vague":
          items = record.items
            .filter((i) => isNotable(i.name))
            .map((i) => ({ name: i.name, count: "some" as const }));
          break;
        case "forgotten":
          items = [];
          break;
      }

      results.push({
        position: record.position,
        blockName: record.blockName,
        clarity,
        items,
        lastCheckedTick: record.lastCheckedTick,
        ticksAgo,
      });
    }

    // Sort by most recently checked first
    return results.sort((a, b) => a.ticksAgo - b.ticksAgo);
  }

  /** Recall a specific container at a position. */
  recallAt(position: Position, currentTick: number): ContainerRecall | null {
    const key = positionKey(position);
    const record = this.containers.get(key);
    if (!record) return null;

    const ticksAgo = currentTick - record.lastCheckedTick;
    const clarity = this.getClarity(ticksAgo);

    let items: RememberedItem[];
    switch (clarity) {
      case "exact":
        items = record.items.map((i) => ({ name: i.name, count: i.count }));
        break;
      case "fading":
        items = record.items.map((i) => ({ name: i.name, count: "some" as const }));
        break;
      case "vague":
        items = record.items
          .filter((i) => isNotable(i.name))
          .map((i) => ({ name: i.name, count: "some" as const }));
        break;
      case "forgotten":
        items = [];
        break;
    }

    return {
      position: record.position,
      blockName: record.blockName,
      clarity,
      items,
      lastCheckedTick: record.lastCheckedTick,
      ticksAgo,
    };
  }

  /** How many containers are remembered. */
  get size(): number {
    return this.containers.size;
  }

  /** Clear all container memory (e.g., on dimension change). */
  clear(): void {
    this.containers.clear();
  }
}

/** Check if an item name is "notable" enough to survive vague memory. */
export function isNotable(itemName: string): boolean {
  if (NOTABLE_ITEMS.has(itemName)) return true;
  // Catch enchanted variants and anything with "diamond" or "netherite"
  if (itemName.includes("diamond") || itemName.includes("netherite")) return true;
  if (itemName.includes("enchanted")) return true;
  return false;
}
