import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, errorResponse } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerGoTo(server: McpServer, bot: BotManager): void {
  server.tool(
    "go_to",
    "Navigate to a target position using pathfinding. Returns a task ID for tracking.",
    {
      x: z.number().describe("Target X coordinate"),
      y: z.number().describe("Target Y coordinate"),
      z: z.number().describe("Target Z coordinate"),
      sprint: z.boolean().default(true).describe("Whether to sprint"),
      range: z.number().default(1).describe("Acceptable distance from target"),
    },
    async ({ x, y, z: zCoord, sprint, range }) => {
      try {
        const movements = bot.getMovements();
        movements.allowSprinting = sprint;
        bot.bot.pathfinder.setMovements(movements);

        const goal = new bot.Goals.GoalNear(x, y, zCoord, range);

        let cleaned = false;
        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          bot.bot.removeListener("goal_reached", onGoalReached);
          bot.bot.removeListener("path_stop", onPathStopped);
          clearTimeout(safetyTimeout);
        };

        const onGoalReached = () => {
          bot.tasks.complete(taskId, { reached: true });
          cleanup();
        };
        const onPathStopped = () => {
          bot.tasks.fail(taskId, "Pathfinding stopped or blocked");
          cleanup();
        };

        // Safety timeout: clean up listeners after 5 minutes
        const safetyTimeout = setTimeout(() => {
          const task = bot.tasks.get(taskId);
          if (task?.status === "running") {
            bot.tasks.fail(taskId, "Navigation timed out after 5 minutes");
          }
          cleanup();
        }, 5 * 60 * 1000);

        const taskId = bot.tasks.create(`Navigate to ${x}, ${y}, ${zCoord}`, () => {
          bot.bot.pathfinder.setGoal(null as any);
          cleanup();
        });

        bot.bot.pathfinder.setGoal(goal, false);

        bot.bot.on("goal_reached", onGoalReached);
        bot.bot.on("path_stop", onPathStopped);

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
          `Navigation failed: ${err instanceof Error ? err.message : String(err)}`,
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      }
    }
  );
}
