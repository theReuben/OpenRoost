import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse } from "@openroost/core";
import { BotManager } from "../BotManager.js";

export function registerSendChat(server: McpServer, bot: BotManager): void {
  server.tool(
    "send_chat",
    "Send a message in game chat",
    {
      message: z.string().describe("Message to send"),
    },
    async ({ message }) => {
      bot.bot.chat(message);
      const observation = bot.getObservation();
      const wrapped = wrapResponse(
        { success: true, observation },
        bot.events
      );
      return {
        content: [{ type: "text", text: JSON.stringify(wrapped, null, 2) }],
      };
    }
  );
}
