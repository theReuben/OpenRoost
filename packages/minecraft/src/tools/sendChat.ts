import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, toolResult } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerSendChat(server: McpServer, bot: BotManager): void {
  server.registerTool(
    "send_chat",
    {
      title: "Send Chat",
      description:
        "Send a message in game chat",
      inputSchema:
      {
        message: z.string().describe("Message to send"),
      },
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    async ({ message }) => {
      bot.bot.chat(message);
      const observation = bot.getObservation();
      const wrapped = wrapResponse(
        { success: true, observation },
        bot.events
      );
      return toolResult(wrapped);
    }
  );
}
