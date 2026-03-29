import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BotManager } from "../BotManager.js";
import { registerGetObservation } from "./getObservation.js";
import { registerCheckInventory } from "./checkInventory.js";
import { registerGoTo } from "./goTo.js";
import { registerMineBlock } from "./mineBlock.js";
import { registerSendChat } from "./sendChat.js";
import { registerGetEvents } from "./getEvents.js";
import { registerGetTaskStatus } from "./getTaskStatus.js";
import { registerScanArea } from "./scanArea.js";
import { registerGetRecipe } from "./getRecipe.js";
import { registerCraftItem } from "./craftItem.js";
import { registerPlaceBlock } from "./placeBlock.js";
import { registerAttackEntity } from "./attackEntity.js";
import { registerDefend } from "./defend.js";
import { registerEquipArmor } from "./equipArmor.js";
import { registerUseItem } from "./useItem.js";

/**
 * Register all MCP tools on the server.
 */
export function registerAllTools(server: McpServer, bot: BotManager): void {
  // Phase 1
  registerGetObservation(server, bot);
  registerCheckInventory(server, bot);
  registerGoTo(server, bot);
  registerMineBlock(server, bot);
  registerSendChat(server, bot);
  registerGetEvents(server, bot);
  registerGetTaskStatus(server, bot);

  // Phase 2
  registerScanArea(server, bot);
  registerGetRecipe(server, bot);
  registerCraftItem(server, bot);
  registerPlaceBlock(server, bot);

  // Phase 3
  registerAttackEntity(server, bot);
  registerDefend(server, bot);
  registerEquipArmor(server, bot);
  registerUseItem(server, bot);
}
