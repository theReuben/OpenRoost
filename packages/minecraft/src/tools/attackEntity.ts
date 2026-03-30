import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, errorResponse } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerAttackEntity(server: McpServer, bot: BotManager): void {
  server.tool(
    "attack_entity",
    "Attack a specific entity (mob, animal, or player). Returns a task ID for tracking.",
    {
      target: z.string().describe("Entity name or type to attack"),
      weapon: z.string().optional().describe("Weapon to equip before attacking"),
      pursuit: z.boolean().default(true).describe("Whether to chase the target if it moves"),
    },
    async ({ target, weapon, pursuit }) => {
      try {
        // Find the nearest matching entity
        const entity = Object.values(bot.bot.entities).find((e) => {
          if (e === bot.bot.entity) return false;
          return (
            e.name?.toLowerCase() === target.toLowerCase() ||
            e.type?.toLowerCase() === target.toLowerCase() ||
            (e as any).username?.toLowerCase() === target.toLowerCase()
          );
        });

        if (!entity) {
          const wrapped = errorResponse(
            `No entity matching "${target}" found nearby`,
            bot.events
          );
          return {
            content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
          };
        }

        // Equip weapon if specified
        if (weapon) {
          const weaponItem = bot.bot.inventory.items().find(
            (item) => item.name.toLowerCase() === weapon.toLowerCase()
          );
          if (weaponItem) {
            await bot.bot.equip(weaponItem, "hand");
          }
        }

        const taskId = bot.tasks.create(`Attack ${target}`, () => {
          cancelled = true;
          bot.bot.pathfinder.setGoal(null as any);
        });

        let cancelled = false;

        // Run attack logic asynchronously
        (async () => {
          try {
            while (!cancelled && entity.isValid) {
              const dist = entity.position.distanceTo(bot.bot.entity.position);

              if (dist > 4 && pursuit) {
                const goal = new bot.Goals.GoalNear(
                  entity.position.x,
                  entity.position.y,
                  entity.position.z,
                  3
                );
                bot.bot.pathfinder.setGoal(goal, true);
              }

              if (dist <= 4) {
                bot.bot.attack(entity);
              }

              await new Promise((r) => setTimeout(r, 500));
            }

            if (!cancelled) {
              bot.tasks.complete(taskId, { defeated: true, target });
            }
          } catch (err) {
            if (!cancelled) {
              bot.tasks.fail(
                taskId,
                `Attack failed: ${err instanceof Error ? err.message : String(err)}`
              );
            }
          }
        })();

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
          `Attack failed: ${err instanceof Error ? err.message : String(err)}`,
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      }
    }
  );
}
