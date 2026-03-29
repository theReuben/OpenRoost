import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BotManager } from "../BotManager.js";
import { registerGetObservation } from "./getObservation.js";
import { registerCheckInventory } from "./checkInventory.js";
import { registerGoTo } from "./goTo.js";
import { registerMineBlock } from "./mineBlock.js";
import { registerSendChat } from "./sendChat.js";
import { registerGetEvents } from "./getEvents.js";
import { registerGetTaskStatus } from "./getTaskStatus.js";

/**
 * Register all Phase 1 MCP tools on the server.
 */
export function registerAllTools(server: McpServer, bot: BotManager): void {
  registerGetObservation(server, bot);
  registerCheckInventory(server, bot);
  registerGoTo(server, bot);
  registerMineBlock(server, bot);
  registerSendChat(server, bot);
  registerGetEvents(server, bot);
  registerGetTaskStatus(server, bot);
}
