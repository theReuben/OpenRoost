import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, errorResponse } from "@openroost/core";
import { BotManager } from "../BotManager.js";

const HOSTILE_MOBS = [
  // Overworld common
  "zombie",
  "skeleton",
  "creeper",
  "spider",
  "cave_spider",
  "enderman",
  "witch",
  "phantom",
  "slime",
  // Zombie variants
  "zombie_villager",
  "drowned",
  "husk",
  // Skeleton variants
  "stray",
  "bogged",
  // Small hostiles
  "silverfish",
  "endermite",
  // Nether
  "blaze",
  "ghast",
  "magma_cube",
  "wither_skeleton",
  "hoglin",
  "piglin_brute",
  // Raid mobs
  "pillager",
  "vindicator",
  "evoker",
  "ravager",
  "vex",
  // Aquatic
  "guardian",
  "elder_guardian",
  // End
  "shulker",
  // Deep dark & 1.21+
  "warden",
  "breeze",
];

export function registerDefend(server: McpServer, bot: BotManager): void {
  server.tool(
    "defend",
    "Enter defensive mode — auto-attack hostile mobs within range. Returns a task ID for tracking.",
    {
      radius: z.number().default(8).describe("Detection radius for hostile mobs"),
      fleeHealthThreshold: z
        .number()
        .default(4)
        .describe("Health level at which to flee instead of fight"),
    },
    async ({ radius, fleeHealthThreshold }) => {
      try {
        let intervalId: ReturnType<typeof setInterval> | null = null;

        const taskId = bot.tasks.create(
          `Defend (radius=${radius}, flee at ${fleeHealthThreshold} HP)`,
          () => {
            if (intervalId !== null) {
              clearInterval(intervalId);
              intervalId = null;
            }
          }
        );

        intervalId = setInterval(() => {
          try {
            // Check if health is too low — flee
            if (bot.bot.health <= fleeHealthThreshold) {
              if (intervalId !== null) {
                clearInterval(intervalId);
                intervalId = null;
              }

              // Try to flee by moving away from nearest hostile
              const nearestHostile = findNearestHostile(bot, radius);
              if (nearestHostile) {
                const botPos = bot.bot.entity.position;
                const dx = botPos.x - nearestHostile.position.x;
                const dz = botPos.z - nearestHostile.position.z;
                const dist = Math.sqrt(dx * dx + dz * dz) || 1;
                const fleeX = botPos.x + (dx / dist) * 16;
                const fleeZ = botPos.z + (dz / dist) * 16;

                const goal = new bot.Goals.GoalNear(fleeX, botPos.y, fleeZ, 2);
                const movements = bot.getMovements();
                movements.allowSprinting = true;
                bot.bot.pathfinder.setMovements(movements);
                bot.bot.pathfinder.setGoal(goal, false);
              }

              bot.tasks.complete(taskId, { reason: "fled_low_health", health: bot.bot.health });
              return;
            }

            // Find and attack nearest hostile mob
            const hostile = findNearestHostile(bot, radius);
            if (hostile) {
              const dist = hostile.position.distanceTo(bot.bot.entity.position);
              if (dist <= 4) {
                bot.bot.attack(hostile);
              } else {
                const goal = new bot.Goals.GoalNear(
                  hostile.position.x,
                  hostile.position.y,
                  hostile.position.z,
                  3
                );
                bot.bot.pathfinder.setGoal(goal, true);
              }
            }
          } catch {
            // Ignore individual scan errors to keep the loop running
          }
        }, 500);

        const observation = bot.getObservation();
        const wrapped = wrapResponse(
          { success: true, taskId, observation },
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      } catch (err) {
        const wrapped = errorResponse(
          `Defend failed: ${err instanceof Error ? err.message : String(err)}`,
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      }
    }
  );
}

function findNearestHostile(bot: BotManager, radius: number) {
  let nearest: any = null;
  let nearestDist = Infinity;

  for (const entity of Object.values(bot.bot.entities)) {
    if (entity === bot.bot.entity) continue;
    if (!entity.name || !HOSTILE_MOBS.includes(entity.name.toLowerCase())) continue;

    const dist = entity.position.distanceTo(bot.bot.entity.position);
    if (dist <= radius && dist < nearestDist) {
      nearest = entity;
      nearestDist = dist;
    }
  }

  return nearest;
}
