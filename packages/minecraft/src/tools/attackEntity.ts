import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, errorResponse, toolResult } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerAttackEntity(server: McpServer, bot: BotManager): void {
  server.registerTool(
    "attack_entity",
    {
      title: "Attack Entity",
      description:
        "Attack a specific entity (mob, animal, or player). Returns a task ID for tracking.",
      inputSchema:
      {
        target: z.string().describe("Entity name or type to attack"),
        weapon: z.string().optional().describe("Weapon to equip before attacking"),
        pursuit: z.boolean().default(true).describe("Whether to chase the target if it moves"),
      },
      annotations: { destructiveHint: true },
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
          return toolResult(wrapped);
        }

        // PvP guard: attacking a human player asks the user for confirmation
        // via MCP elicitation — but only when the client supports it.
        const targetUsername = (entity as any).username as string | undefined;
        const isPlayer = entity.type === "player" || Boolean(targetUsername);
        if (isPlayer && server.server.getClientCapabilities()?.elicitation) {
          try {
            const res = await server.server.elicitInput({
              message: `The bot wants to attack player "${targetUsername ?? target}". Allow PvP?`,
              requestedSchema: {
                type: "object",
                properties: {
                  confirm: {
                    type: "boolean",
                    title: "Attack this player?",
                    description: "Approve the PvP attack",
                  },
                },
                required: ["confirm"],
              },
            });
            if (res.action !== "accept" || res.content?.confirm !== true) {
              const wrapped = errorResponse(
                `PvP attack on "${targetUsername ?? target}" was not approved by the user`,
                bot.events
              );
              return toolResult(wrapped);
            }
          } catch {
            // Elicitation request failed despite the advertised capability —
            // fall through and behave as before (the user asked for this attack).
          }
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
        return toolResult(wrapped);
      } catch (err) {
        const wrapped = errorResponse(
          `Attack failed: ${err instanceof Error ? err.message : String(err)}`,
          bot.events
        );
        return toolResult(wrapped);
      }
    }
  );
}
