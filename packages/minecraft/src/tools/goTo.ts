import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, errorResponse, toolResult } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerGoTo(server: McpServer, bot: BotManager): void {
  server.registerTool(
    "go_to",
    {
      title: "Go To",
      description:
        "Navigate to a target position using pathfinding. Give either coordinates or " +
        "a saved waypoint name. Returns a task ID for tracking.",
      inputSchema:
      {
        x: z.number().optional().describe("Target X coordinate"),
        y: z.number().optional().describe("Target Y coordinate"),
        z: z.number().optional().describe("Target Z coordinate"),
        waypoint: z
          .string()
          .optional()
          .describe('Saved waypoint name to navigate to (e.g. "home")'),
        sprint: z.boolean().default(true).describe("Whether to sprint"),
        range: z.number().default(1).describe("Acceptable distance from target"),
      },
      annotations: { destructiveHint: false },
    },
    async ({ x, y, z: zCoord, waypoint, sprint, range }) => {
      try {
        if (waypoint !== undefined) {
          const wp = bot.memory.getWaypoint(waypoint);
          if (!wp) {
            const known = bot.memory
              .listWaypoints()
              .map((w) => w.name)
              .join(", ");
            return toolResult(
              errorResponse(
                `Unknown waypoint "${waypoint}". Known waypoints: ${known || "(none)"}`,
                bot.events
              )
            );
          }
          x = wp.position.x;
          y = wp.position.y;
          zCoord = wp.position.z;
        }
        if (x === undefined || y === undefined || zCoord === undefined) {
          return toolResult(
            errorResponse(
              "Provide either x/y/z coordinates or a waypoint name",
              bot.events
            )
          );
        }
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
          bot.bot.removeListener("path_update", onPathUpdate);
          clearTimeout(safetyTimeout);
        };

        const onGoalReached = () => {
          // Guard: only complete if this task is still running, so a stale
          // listener from a previous go_to call can't complete a newer task.
          const task = bot.tasks.get(taskId);
          if (task?.status === "running") {
            bot.tasks.complete(taskId, { reached: true });
          }
          cleanup();
        };

        const onPathStopped = () => {
          const task = bot.tasks.get(taskId);
          if (task?.status === "running") {
            bot.tasks.fail(taskId, "Pathfinding stopped — target may be blocked or unreachable");
          }
          cleanup();
        };

        // Fail fast when the pathfinder determines there is no path at all,
        // rather than waiting for path_stop which can lag behind.
        const onPathUpdate = (result: any) => {
          if (result?.status === "noPath") {
            const task = bot.tasks.get(taskId);
            if (task?.status === "running") {
              bot.tasks.fail(taskId, "No path found to destination — target may be unreachable");
            }
            cleanup();
          }
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

        // Use dynamic pathfinding (true) so the bot starts moving immediately
        // and recomputes the path as new chunks load. Non-dynamic (false) tries
        // to compute the full path up-front, which fails when the destination
        // is in unloaded chunks.
        bot.bot.pathfinder.setGoal(goal, true);

        bot.bot.on("goal_reached", onGoalReached);
        bot.bot.on("path_stop", onPathStopped);
        bot.bot.on("path_update", onPathUpdate);

        const observation = bot.getObservation();
        const wrapped = wrapResponse(
          { success: true, taskId, observation },
          bot.events
        );
        return toolResult(wrapped);
      } catch (err) {
        const wrapped = errorResponse(
          `Navigation failed: ${err instanceof Error ? err.message : String(err)}`,
          bot.events
        );
        return toolResult(wrapped);
      }
    }
  );
}
