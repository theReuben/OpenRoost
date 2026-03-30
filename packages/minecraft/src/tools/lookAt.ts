import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, errorResponse, BlockInfo, EntityInfo } from "@openroost/core";
import { BotManager } from "../BotManager.js";

const DIRECTION_VECTORS: Record<string, { x: number; y: number; z: number }> = {
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  east: { x: 1, y: 0, z: 0 },
  west: { x: -1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  down: { x: 0, y: -1, z: 0 },
};

// Cosine of 70° — blocks/entities within a 140° cone in front count as "visible"
const VIEW_CONE_COS = Math.cos((70 * Math.PI) / 180);

interface RaycastHit {
  block: string;
  position: { x: number; y: number; z: number };
  distance: number;
}

interface DistanceLayer {
  range: string;
  blocks: Record<string, number>;
  notableBlocks: BlockInfo[];
  entities: EntityInfo[];
}

export function registerLookAt(server: McpServer, bot: BotManager): void {
  server.tool(
    "look_at",
    "Look in a direction or at a position. Returns what's directly ahead (ray-cast), blocks and entities in the view cone grouped by distance, and a natural language summary.",
    {
      target: z
        .union([
          z.object({
            x: z.number(),
            y: z.number(),
            z: z.number(),
          }),
          z.enum(["north", "south", "east", "west", "up", "down"]),
        ])
        .describe("Position {x,y,z} or cardinal direction to look at"),
    },
    async ({ target }) => {
      try {
        const vec3Mod = (await import("vec3")).default;
        const Vec3 = vec3Mod.Vec3 ?? vec3Mod;

        const eyePos = bot.bot.entity.position.offset(0, 1.62, 0); // eye height
        let lookDir: { x: number; y: number; z: number };

        if (typeof target === "string") {
          lookDir = DIRECTION_VECTORS[target];
          const lookPos = new Vec3(
            eyePos.x + lookDir.x * 32,
            eyePos.y + lookDir.y * 32,
            eyePos.z + lookDir.z * 32
          );
          await bot.bot.lookAt(lookPos);
        } else {
          const lookPos = new Vec3(target.x, target.y, target.z);
          await bot.bot.lookAt(lookPos);
          // Compute normalized direction from eye to target
          const dx = target.x - eyePos.x;
          const dy = target.y - eyePos.y;
          const dz = target.z - eyePos.z;
          const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
          lookDir = { x: dx / len, y: dy / len, z: dz / len };
        }

        // 1. Ray-cast: trace from eyes along look direction, find first solid block
        const rayHit = raycast(bot, eyePos, lookDir, Vec3, 32);

        // 2. Scan blocks in the view cone, filtered by direction
        const scanRadius = 16;
        const allBlocks = getBlocksInCone(bot, eyePos, lookDir, scanRadius);

        // 3. Filter entities in the view cone
        const allEntities = getEntitiesInCone(bot, eyePos, lookDir, 24);

        // 4. Group into distance layers for structured output
        const layers = buildDistanceLayers(allBlocks, allEntities);

        // 5. Build natural language description
        const dirLabel = typeof target === "string"
          ? target
          : `(${target.x}, ${target.y}, ${target.z})`;
        const description = buildDescription(dirLabel, rayHit, layers);

        const wrapped = wrapResponse(
          {
            lookingAt: rayHit,
            layers,
            visibleBlocks: summarizeBlockCounts(allBlocks),
            visibleEntities: allEntities,
            description,
          },
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      } catch (err) {
        const wrapped = errorResponse(
          `Look failed: ${err instanceof Error ? err.message : String(err)}`,
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      }
    }
  );
}

/**
 * Ray-cast from origin along direction, returning the first non-air block hit.
 */
function raycast(
  bot: BotManager,
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  Vec3: any,
  maxDist: number
): RaycastHit | null {
  const step = 0.5;
  for (let d = 1; d <= maxDist; d += step) {
    const px = origin.x + dir.x * d;
    const py = origin.y + dir.y * d;
    const pz = origin.z + dir.z * d;
    try {
      const block = bot.bot.blockAt(new Vec3(px, py, pz));
      if (block && block.name !== "air" && block.name !== "cave_air" && block.name !== "void_air") {
        return {
          block: block.name,
          position: { x: Math.floor(px), y: Math.floor(py), z: Math.floor(pz) },
          distance: Math.round(d * 10) / 10,
        };
      }
    } catch {
      // Out of loaded chunks
      break;
    }
  }
  return null;
}

/**
 * Return all non-air blocks within `radius` that fall inside the view cone.
 */
function getBlocksInCone(
  bot: BotManager,
  eye: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  radius: number
): (BlockInfo & { distance: number })[] {
  const results: (BlockInfo & { distance: number })[] = [];
  const center = bot.bot.entity.position;

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > radius || dist < 1) continue;

        // Check if this offset is within the view cone
        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;
        const dot = nx * dir.x + ny * dir.y + nz * dir.z;
        if (dot < VIEW_CONE_COS) continue;

        try {
          const pos = center.offset(dx, dy, dz);
          const block = bot.bot.blockAt(pos);
          if (block && block.name !== "air" && block.name !== "cave_air") {
            results.push({
              name: block.name,
              position: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) },
              distance: Math.round(dist * 10) / 10,
            });
          }
        } catch {
          // Skip unloaded chunks
        }
      }
    }
  }

  return results.sort((a, b) => a.distance - b.distance);
}

/**
 * Return entities within the view cone.
 */
function getEntitiesInCone(
  bot: BotManager,
  eye: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  radius: number
): (EntityInfo & { direction: string })[] {
  const entities: (EntityInfo & { direction: string })[] = [];

  for (const entity of Object.values(bot.bot.entities)) {
    if (entity === bot.bot.entity) continue;
    const dx = entity.position.x - eye.x;
    const dy = entity.position.y - eye.y;
    const dz = entity.position.z - eye.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > radius || dist < 0.5) continue;

    // Check view cone
    const nx = dx / dist;
    const ny = dy / dist;
    const nz = dz / dist;
    const dot = nx * dir.x + ny * dir.y + nz * dir.z;
    if (dot < VIEW_CONE_COS) continue;

    let type: EntityInfo["type"] = "mob";
    if (entity.type === "player") type = "player";
    else if (entity.type === "object") type = "item";
    else if (
      entity.name &&
      ["cow", "pig", "sheep", "chicken", "horse", "donkey", "mule", "rabbit", "wolf", "cat", "fox", "bee"].includes(entity.name)
    ) {
      type = "animal";
    }

    // Relative direction label
    const relDir = dot > 0.95 ? "directly ahead" : dot > 0.7 ? "ahead" : "to the side";

    entities.push({
      name: entity.name ?? entity.type ?? "unknown",
      type,
      position: {
        x: Math.floor(entity.position.x),
        y: Math.floor(entity.position.y),
        z: Math.floor(entity.position.z),
      },
      health: (entity as any).health ?? undefined,
      distance: Math.round(dist * 10) / 10,
      direction: relDir,
    });
  }

  return entities.sort((a, b) => a.distance - b.distance);
}

/**
 * Group blocks and entities into near / mid / far layers.
 */
function buildDistanceLayers(
  blocks: (BlockInfo & { distance: number })[],
  entities: (EntityInfo & { direction: string })[]
): DistanceLayer[] {
  const RANGES: [string, number, number][] = [
    ["near (0-4 blocks)", 0, 4],
    ["mid (4-8 blocks)", 4, 8],
    ["far (8-16 blocks)", 8, 16],
  ];

  // Notable block types worth calling out individually
  const NOTABLE = new Set([
    "diamond_ore", "deepslate_diamond_ore", "iron_ore", "deepslate_iron_ore",
    "gold_ore", "deepslate_gold_ore", "coal_ore", "deepslate_coal_ore",
    "copper_ore", "deepslate_copper_ore", "lapis_ore", "deepslate_lapis_ore",
    "redstone_ore", "deepslate_redstone_ore", "emerald_ore", "deepslate_emerald_ore",
    "ancient_debris", "spawner", "chest", "crafting_table", "furnace",
    "blast_furnace", "smoker", "enchanting_table", "anvil", "brewing_stand",
    "lava", "water", "tnt", "obsidian", "crying_obsidian",
    "end_portal_frame", "nether_portal", "beacon",
  ]);

  return RANGES.map(([range, min, max]) => {
    const layerBlocks = blocks.filter((b) => b.distance >= min && b.distance < max);
    const layerEntities = entities.filter((e) => e.distance >= min && e.distance < max);

    // Count block types
    const counts: Record<string, number> = {};
    for (const b of layerBlocks) {
      counts[b.name] = (counts[b.name] ?? 0) + 1;
    }

    // Pick out notable blocks with their positions
    const notable = layerBlocks.filter((b) => NOTABLE.has(b.name));

    return {
      range,
      blocks: counts,
      notableBlocks: notable.map((b) => ({ name: b.name, position: b.position })),
      entities: layerEntities,
    };
  });
}

/**
 * Summarize block counts across all distances.
 */
function summarizeBlockCounts(blocks: (BlockInfo & { distance: number })[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const b of blocks) {
    counts[b.name] = (counts[b.name] ?? 0) + 1;
  }
  // Sort by count descending, keep top 15
  return Object.fromEntries(
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
  );
}

/**
 * Build a concise natural-language description of what's visible.
 */
function buildDescription(
  dirLabel: string,
  rayHit: RaycastHit | null,
  layers: DistanceLayer[]
): string {
  const parts: string[] = [];

  parts.push(`Looking ${dirLabel}.`);

  // What's directly ahead
  if (rayHit) {
    parts.push(`Directly ahead: ${rayHit.block} at ${rayHit.distance}m.`);
  } else {
    parts.push("Directly ahead: clear view, no blocks within 32m.");
  }

  // Summarize each layer
  for (const layer of layers) {
    const blockTypes = Object.keys(layer.blocks);
    if (blockTypes.length === 0 && layer.entities.length === 0) continue;

    const layerParts: string[] = [];

    if (blockTypes.length > 0) {
      const top = Object.entries(layer.blocks)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => `${name}(${count})`)
        .join(", ");
      layerParts.push(top);
    }

    if (layer.notableBlocks.length > 0) {
      const notable = layer.notableBlocks
        .map((b) => `${b.name} at (${b.position.x}, ${b.position.y}, ${b.position.z})`)
        .join("; ");
      layerParts.push(`notable: ${notable}`);
    }

    if (layer.entities.length > 0) {
      const ents = layer.entities
        .map((e) => `${e.name} ${e.distance}m ${(e as any).direction}`)
        .join(", ");
      layerParts.push(`entities: ${ents}`);
    }

    parts.push(`${layer.range}: ${layerParts.join(" | ")}.`);
  }

  return parts.join(" ");
}
