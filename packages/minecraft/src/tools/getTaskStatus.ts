import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerGetTaskStatus(server: McpServer, bot: BotManager): void {
  server.tool(
    "get_task_status",
    "Check the status of an async task (pathfinding, combat, smelting, etc.)",
    {
      taskId: z.string().describe("Task ID from a previous action"),
    },
    async ({ taskId }) => {
      const task = bot.tasks.get(taskId);
      if (!task) {
        const wrapped = wrapResponse(
          { error: `No task found with ID: ${taskId}` },
          bot.events
        );
        return {
          content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
        };
      }

      const wrapped = wrapResponse(
        {
          status: task.status,
          description: task.description,
          result: task.result,
          progress: task.progress,
        },
        bot.events
      );
      return {
        content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
      };
    }
  );
}
