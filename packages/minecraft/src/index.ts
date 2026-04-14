import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BotManager } from "./BotManager.js";
import { registerAllTools } from "./tools/index.js";
import { registerResources, wireResourceNotifications } from "./resources.js";
import { registerPrompts } from "./prompts.js";
import { createHudServer } from "./viewer.js";

const MC_HOST = process.env.MC_HOST ?? "127.0.0.1";
const MC_PORT = parseInt(process.env.MC_PORT ?? "25565", 10);
const MC_USERNAME = process.env.MC_USERNAME ?? "ClaudeBot";
const MC_VERSION = process.env.MC_VERSION;
const MC_VIEWER_PORT = process.env.MC_VIEWER_PORT
  ? parseInt(process.env.MC_VIEWER_PORT, 10)
  : undefined;

/**
 * The bot instance that currently owns the running viewer, if any.
 * prismarine-viewer attaches a `close()` function to `bot.viewer` rather than
 * returning the HTTP server, so we keep a reference to the bot to call it.
 */
let viewerBotRef: { viewer?: { close: () => void } } | undefined;

/** The HUD overlay server wrapping the prismarine-viewer iframe. */
let hudServerRef: { close: () => void } | undefined;

/**
 * Start prismarine-viewer on an internal port and wrap it with a streaming-
 * style HUD overlay served on the public port.
 *
 * prismarine-viewer → internalPort (iframe, not exposed)
 * HUD server        → publicPort   (what the user opens in their browser)
 */
function startViewer(bot: BotManager, publicPort: number): void {
  const internalPort = publicPort + 1;

  // Tear down previous viewer + HUD
  if (hudServerRef) {
    try { hudServerRef.close(); } catch { /* ignore */ }
    hudServerRef = undefined;
  }
  if (viewerBotRef?.viewer?.close) {
    try { viewerBotRef.viewer.close(); } catch { /* ignore */ }
  }
  viewerBotRef = undefined;

  try {
    // prismarine-viewer is a CommonJS module with no bundled type declarations.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const prismarineViewer = require("prismarine-viewer") as {
      mineflayer: (bot: unknown, opts: { port: number; firstPerson: boolean }) => void;
    };

    // prismarine-viewer logs a startup banner to stdout, which corrupts the
    // MCP JSON-RPC protocol (also on stdout).  Temporarily suppress stdout
    // during initialization and restore it immediately after.
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (() => true) as typeof process.stdout.write;
    try {
      prismarineViewer.mineflayer(bot.bot, { port: internalPort, firstPerson: true });
    } finally {
      process.stdout.write = origWrite;
    }

    // Store the bot ref so we can call bot.viewer.close() next time
    viewerBotRef = bot.bot as { viewer?: { close: () => void } };
    console.error(`[OpenRoost] 3D viewer on internal port ${internalPort}`);

    // Start the HUD overlay on the public port
    hudServerRef = createHudServer(bot, publicPort, internalPort);
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

  // Wire resource notifications and (re)start viewer after every successful connect
  function setupAfterConnect(): void {
    wireResourceNotifications(server, bot);
    if (MC_VIEWER_PORT !== undefined) {
      startViewer(bot, MC_VIEWER_PORT);
    }
  }

  // Re-wire on every subsequent reconnect
  bot.onReconnect = setupAfterConnect;

  // Connect to Minecraft — failure is non-fatal; the reconnect loop keeps
  // retrying in the background so the MCP server stays alive and usable.
  console.error(`[OpenRoost] Connecting to ${MC_HOST}:${MC_PORT} as ${MC_USERNAME}...`);
  try {
    await bot.connect();
    console.error("[OpenRoost] Connected to Minecraft server!");
    setupAfterConnect();
  } catch (err) {
    console.error(
      `[OpenRoost] Failed to connect: ${err instanceof Error ? err.message : String(err)}`
    );
    console.error("[OpenRoost] Retrying in the background — MCP server is still available.");
  }

  // Start auto-saving state every 60 seconds
  bot.startAutoSave();

  // Start MCP transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[OpenRoost] MCP server running on stdio");

  // Graceful shutdown helper — called from all exit paths
  const shutdown = (reason: string) => {
    console.error(`[OpenRoost] Shutting down (${reason})...`);
    bot.disableAutoReconnect(); // Don't reconnect on intentional shutdown
    bot.stopAutoSave(); // Final save + stop timer
    bot.disconnect();
    process.exit(0);
  };

  // Use the transport's own close callback rather than process.stdin.on("close").
  // StdioServerTransport manages stdin internally (pause/resume/end), so listening
  // to stdin directly fires spuriously and races with the MCP protocol.
  transport.onclose = () => shutdown("MCP client disconnected");

  // Handle Ctrl-C (SIGINT) and process-manager termination (SIGTERM)
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[OpenRoost] Fatal error:", err);
  process.exit(1);
});

// Route uncaught exceptions and unhandled promise rejections to stderr so
// that stdout stays clean (JSON-RPC only).  Without these handlers Node.js
// prints to stderr by default since v15, but registering them explicitly
// prevents any runtime from inadvertently writing to stdout and also lets
// us add a consistent "[OpenRoost]" prefix for easier log filtering.
process.on("uncaughtException", (err) => {
  console.error("[OpenRoost] Uncaught exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[OpenRoost] Unhandled promise rejection:", reason);
  process.exit(1);
});
