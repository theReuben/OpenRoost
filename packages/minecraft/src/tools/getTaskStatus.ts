import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, toolResult } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerGetTaskStatus(server: McpServer, bot: BotManager): void {
  server.registerTool(
    "get_task_status",
    {
      title: "Get Task Status",
      description:
        "Check the status of an async task (pathfinding, combat, smelting, etc.)",
      inputSchema:
      {
        taskId: z.string().describe("Task ID from a previous action"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ taskId }) => {
      const task = bot.tasks.get(taskId);
      if (!task) {
        const wrapped = wrapResponse(
          { error: `No task found with ID: ${taskId}` },
          bot.events
        );
        return toolResult(wrapped);
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
      return toolResult(wrapped);
    }
  );
}
