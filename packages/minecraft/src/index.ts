import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BotManager } from "./BotManager.js";
import { registerAllTools } from "./tools/index.js";
import { registerResources, wireResourceNotifications } from "./resources.js";
import { registerPrompts } from "./prompts.js";

const MC_HOST = process.env.MC_HOST ?? "localhost";
const MC_PORT = parseInt(process.env.MC_PORT ?? "25565", 10);
const MC_USERNAME = process.env.MC_USERNAME ?? "ClaudeBot";
const MC_VERSION = process.env.MC_VERSION;
const MC_VIEWER_PORT = process.env.MC_VIEWER_PORT
  ? parseInt(process.env.MC_VIEWER_PORT, 10)
  : undefined;

/** Handle to the running viewer HTTP server (if any), so we can close it on reconnect. */
let viewerServer: { close: (cb?: () => void) => void } | undefined;

/**
 * Start prismarine-viewer for the given bot instance on the specified port.
 * If a viewer server is already running, close it first so the new bot session
 * gets fresh event listeners and a clean WebSocket connection.
 */
function startViewer(botInstance: unknown, port: number): void {
  if (viewerServer) {
    try {
      viewerServer.close();
    } catch {
      // ignore errors from closing the old server
    }
    viewerServer = undefined;
  }

  try {
    // prismarine-viewer is a CommonJS module with no type declarations.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const prismarineViewer = require("prismarine-viewer") as {
      mineflayer: (
        bot: unknown,
        opts: { port: number; firstPerson: boolean }
      ) => { close: (cb?: () => void) => void } | undefined;
    };
    const srv = prismarineViewer.mineflayer(botInstance, {
      port,
      firstPerson: true,
    });
    if (srv && typeof srv.close === "function") {
      viewerServer = srv;
    }
    console.error(
      `[OpenRoost] Bot viewer running at http://localhost:${port}`
    );
  } catch (err) {
    console.error(
      `[OpenRoost] Failed to start viewer: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

async function main(): Promise<void> {
  const server = new McpServer({
    name: "openroost-minecraft",
    version: "0.1.0",
  });

  const bot = new BotManager({
    host: MC_HOST,
    port: MC_PORT,
    username: MC_USERNAME,
    version: MC_VERSION,
  });

  // Register all tools, resources, and prompts
  registerAllTools(server, bot);
  registerResources(server, bot);
  registerPrompts(server);

  // Restore persisted state (container memory, deaths, sleep timer)
  bot.restoreState();

  // Connect to Minecraft
  console.error(`[OpenRoost] Connecting to ${MC_HOST}:${MC_PORT} as ${MC_USERNAME}...`);
  try {
    await bot.connect();
    console.error("[OpenRoost] Connected to Minecraft server!");
  } catch (err) {
    console.error(
      `[OpenRoost] Failed to connect: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  }

  // Wire up resource update notifications now that bot is connected
  wireResourceNotifications(server, bot);

  // Start the visual viewer if MC_VIEWER_PORT is set
  if (MC_VIEWER_PORT !== undefined) {
    startViewer(bot.bot, MC_VIEWER_PORT);
  }

  // Re-wire resource notifications and restart viewer on reconnect
  bot.onReconnect = () => {
    wireResourceNotifications(server, bot);
    if (MC_VIEWER_PORT !== undefined) {
      startViewer(bot.bot, MC_VIEWER_PORT);
    }
  };

  // Start auto-saving state every 60 seconds
  bot.startAutoSave();

  // Start MCP transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[OpenRoost] MCP server running on stdio");

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.error("[OpenRoost] Shutting down...");
    bot.disableAutoReconnect(); // Don't reconnect on intentional shutdown
    bot.stopAutoSave(); // Final save + stop timer
    bot.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[OpenRoost] Fatal error:", err);
  process.exit(1);
});
