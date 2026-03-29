import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, errorResponse } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerCancelTask(server: McpServer, bot: BotManager): void {
  server.tool(
    "cancel_task",
    "Cancel a running async task (pathfinding, combat, smelting, etc.).",
    {
      taskId: z.string().describe("Task ID to cancel"),
    },
    async ({ taskId }) => {
      const cancelled = bot.tasks.cancel(taskId);
      if (!cancelled) {
        const task = bot.tasks.get(taskId);
        if (!task) {
          const wrapped = errorResponse(`No task found with ID: ${taskId}`, bot.events);
          return {
            content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
          };
        }
        const wrapped = errorResponse(
          `Task ${taskId} is not running (status: ${task.status})`,
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      }

      const observation = bot.getObservation();
      const wrapped = wrapResponse(
        { success: true, cancelled: taskId, observation },
        bot.events
      );
      return {
        content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
      };
    }
  );
}
