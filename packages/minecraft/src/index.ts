import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BotManager } from "./BotManager.js";
import { registerAllTools } from "./tools/index.js";

const MC_HOST = process.env.MC_HOST ?? "localhost";
const MC_PORT = parseInt(process.env.MC_PORT ?? "25565", 10);
const MC_USERNAME = process.env.MC_USERNAME ?? "ClaudeBot";
const MC_VERSION = process.env.MC_VERSION;

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

  // Register all Phase 1 tools
  registerAllTools(server, bot);

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

  // Start MCP transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[OpenRoost] MCP server running on stdio");

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.error("[OpenRoost] Shutting down...");
    bot.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[OpenRoost] Fatal error:", err);
  process.exit(1);
});
