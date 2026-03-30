import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, errorResponse } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerFollowPlayer(server: McpServer, bot: BotManager): void {
  server.tool(
    "follow_player",
    "Follow a specific player, maintaining distance. Returns a task ID (continuous until cancelled).",
    {
      playerName: z.string().describe("Player to follow"),
      distance: z.number().default(3).describe("Distance to maintain from the player"),
    },
    async ({ playerName, distance }) => {
      try {
        const player = bot.bot.players[playerName];
        if (!player?.entity) {
          const wrapped = errorResponse(
            `Player "${playerName}" not found or not visible`,
            bot.events
          );
          return {
            content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
          };
        }

        let intervalId: ReturnType<typeof setInterval> | null = null;

        const taskId = bot.tasks.create(`Follow ${playerName}`, () => {
          if (intervalId !== null) {
            clearInterval(intervalId);
            intervalId = null;
          }
          bot.bot.pathfinder.setGoal(null as any);
        });

        intervalId = setInterval(() => {
          try {
            const p = bot.bot.players[playerName];
            if (!p?.entity) {
              bot.tasks.complete(taskId, { reason: "player_left", playerName });
              if (intervalId !== null) {
                clearInterval(intervalId);
                intervalId = null;
              }
              return;
            }

            const dist = p.entity.position.distanceTo(bot.bot.entity.position);
            if (dist > distance + 1) {
              const goal = new bot.Goals.GoalNear(
                p.entity.position.x,
                p.entity.position.y,
                p.entity.position.z,
                distance
              );
              const movements = bot.getMovements();
              movements.allowSprinting = dist > distance + 5;
              bot.bot.pathfinder.setMovements(movements);
              bot.bot.pathfinder.setGoal(goal, true);
            }
          } catch {
            // Ignore individual tick errors
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
          `Follow failed: ${err instanceof Error ? err.message : String(err)}`,
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      }
    }
  );
}
