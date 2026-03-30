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
import { registerFollowPlayer } from "./followPlayer.js";
import { registerWhisper } from "./whisper.js";
import { registerGetPlayerInfo } from "./getPlayerInfo.js";
import { registerInteractBlock } from "./interactBlock.js";
import { registerTransferItems } from "./transferItems.js";
import { registerSmeltItem } from "./smeltItem.js";
import { registerCancelTask } from "./cancelTask.js";
import { registerStopMovement } from "./stopMovement.js";
import { registerLookAt } from "./lookAt.js";
import { registerGetDeathHistory } from "./getDeathHistory.js";
import { registerRecallContainers } from "./recallContainers.js";
import { registerGetSounds } from "./getSounds.js";
import { registerGetTimeWeather } from "./getTimeWeather.js";
import { registerSleep } from "./sleep.js";

/**
 * Register all MCP tools on the server.
 */
export function registerAllTools(server: McpServer, bot: BotManager): void {
  // Phase 1 — Perception & basic actions
  registerGetObservation(server, bot);
  registerCheckInventory(server, bot);
  registerGoTo(server, bot);
  registerMineBlock(server, bot);
  registerSendChat(server, bot);
  registerGetEvents(server, bot);
  registerGetTaskStatus(server, bot);

  // Phase 2 — Crafting & building
  registerScanArea(server, bot);
  registerGetRecipe(server, bot);
  registerCraftItem(server, bot);
  registerPlaceBlock(server, bot);
  registerLookAt(server, bot);

  // Phase 3 — Combat
  registerAttackEntity(server, bot);
  registerDefend(server, bot);
  registerEquipArmor(server, bot);
  registerUseItem(server, bot);

  // Phase 4 — Multiplayer
  registerFollowPlayer(server, bot);
  registerWhisper(server, bot);
  registerGetPlayerInfo(server, bot);

  // Phase 5 — Storage & smelting
  registerInteractBlock(server, bot);
  registerTransferItems(server, bot);
  registerSmeltItem(server, bot);

  // Phase 6 — Task management, memory & awareness
  registerCancelTask(server, bot);
  registerStopMovement(server, bot);
  registerGetDeathHistory(server, bot);
  registerRecallContainers(server, bot);
  registerGetSounds(server, bot);
  registerGetTimeWeather(server, bot);
  registerSleep(server, bot);
}
