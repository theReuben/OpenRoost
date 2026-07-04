#!/usr/bin/env node
/**
 * Scaffold a new OpenRoost game package.
 *
 * Usage: node scripts/create-game.mjs <game-name>
 * Example: node scripts/create-game.mjs factorio
 *
 * Generates packages/<game-name>/ with a working MCP server skeleton wired
 * to core's EventManager, TaskManager, SkillLibrary, and JsonStore. Fill in
 * GameManager.connect() and add tools under src/tools/.
 */
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const name = process.argv[2];
if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error("Usage: node scripts/create-game.mjs <game-name>");
  console.error("Game name must be lowercase kebab-case, e.g. 'factorio'");
  process.exit(1);
}

const root = join(process.cwd(), "packages", name);
if (existsSync(root)) {
  console.error(`packages/${name} already exists — aborting`);
  process.exit(1);
}

const className =
  name.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase()) + "Manager";

const files = {
  "package.json": `{
  "name": "@openroost/${name}",
  "version": "0.1.0",
  "private": true,
  "description": "${name} MCP server for OpenRoost",
  "main": "build/index.js",
  "types": "build/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node build/index.js"
  },
  "dependencies": {
    "@openroost/core": "*",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^4.3.0"
  },
  "devDependencies": {
    "typescript": "^5.3.3"
  }
}
`,

  "tsconfig.json": `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "build",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "references": [
    { "path": "../core" }
  ]
}
`,

  [`src/${className}.ts`]: `import {
  EventManager,
  TaskManager,
  SkillLibrary,
  JsonStore,
} from "@openroost/core";
import type { Skill } from "@openroost/core";

export interface GameConfig {
  host: string;
  port: number;
}

/** State that survives restarts. Extend with game-specific memory. */
export interface PersistedState {
  skills: Skill[];
  savedAt: string;
}

/**
 * Wraps the game connection with OpenRoost infrastructure: events,
 * async tasks, learned skills, and persistence.
 */
export class ${className} {
  config: GameConfig;
  events = new EventManager();
  tasks = new TaskManager();
  skills = new SkillLibrary();
  persistence: JsonStore<PersistedState>;
  isConnected = false;

  constructor(config: GameConfig) {
    this.config = config;
    this.persistence = new JsonStore<PersistedState>(
      process.env.OPENROOST_STATE_FILE ?? "./openroost-${name}-state.json",
      () => ({ skills: [], savedAt: new Date().toISOString() }),
      (parsed) => {
        if (!Array.isArray(parsed.skills)) parsed.skills = [];
        return parsed;
      }
    );
  }

  async connect(): Promise<void> {
    // TODO: connect to the game here. Emit events via this.events.push(...)
    // for anything the agent should react to (chat, damage, state changes).
    this.isConnected = true;
  }

  disconnect(): void {
    this.isConnected = false;
  }

  restoreState(): void {
    const state = this.persistence.load();
    this.skills.importSkills(state.skills);
  }

  saveState(): void {
    this.persistence.save({
      skills: this.skills.exportSkills(),
      savedAt: new Date().toISOString(),
    });
  }

  startAutoSave(): void {
    this.persistence.startAutoSave(() => {
      this.saveState();
      this.tasks.prune();
    });
  }

  stopAutoSave(): void {
    this.persistence.stopAutoSave();
    this.saveState();
  }
}
`,

  "src/tools/index.ts": `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ${className} } from "../${className}.js";
import { registerGetStatus } from "./getStatus.js";
import { registerSaveSkill } from "./saveSkill.js";
import { registerRecallSkills } from "./recallSkills.js";

export function registerAllTools(server: McpServer, game: ${className}): void {
  registerGetStatus(server, game);
  registerSaveSkill(server, game);
  registerRecallSkills(server, game);
  // Add game-specific tools here. Conventions (see packages/minecraft):
  // - perception tools are readOnlyHint: true
  // - long-running actions create tasks and return a taskId
  // - every response goes through wrapResponse + toolResult
}
`,

  "src/tools/getStatus.ts": `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, toolResult } from "@openroost/core";
import { ${className} } from "../${className}.js";

export function registerGetStatus(server: McpServer, game: ${className}): void {
  server.registerTool(
    "get_status",
    {
      title: "Get Status",
      description: "Current connection and game state",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const wrapped = wrapResponse(
        { connected: game.isConnected },
        game.events
      );
      return toolResult(wrapped);
    }
  );
}
`,

  "src/tools/saveSkill.ts": `import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, toolResult } from "@openroost/core";
import { ${className} } from "../${className}.js";

export function registerSaveSkill(server: McpServer, game: ${className}): void {
  server.registerTool(
    "save_skill",
    {
      title: "Save Skill",
      description:
        "Record a strategy that worked (or failed) in the persistent skill library.",
      inputSchema: {
        name: z.string().describe("Short kebab-case identifier"),
        description: z.string().optional(),
        strategy: z.string().optional(),
        tags: z.array(z.string()).optional(),
        outcome: z.enum(["success", "failure"]).optional(),
        note: z.string().optional(),
      },
      annotations: { destructiveHint: false },
    },
    async (input) => {
      const skill = game.skills.save(input);
      const wrapped = wrapResponse(
        { success: true, skill, librarySize: game.skills.size },
        game.events
      );
      return toolResult(wrapped);
    }
  );
}
`,

  "src/tools/recallSkills.ts": `import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { wrapResponse, toolResult } from "@openroost/core";
import { ${className} } from "../${className}.js";

export function registerRecallSkills(server: McpServer, game: ${className}): void {
  server.registerTool(
    "recall_skills",
    {
      title: "Recall Skills",
      description:
        "Search the persistent skill library for strategies relevant to a task.",
      inputSchema: {
        query: z.string().optional().describe("Task description to match"),
        limit: z.number().default(5),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit }) => {
      const result = query
        ? {
            matches: game.skills.recall(query, limit).map((s) => ({
              score: Math.round(s.score * 10) / 10,
              ...s.skill,
            })),
          }
        : { skills: game.skills.list().slice(0, limit) };
      const wrapped = wrapResponse(
        { success: true, librarySize: game.skills.size, ...result },
        game.events
      );
      return toolResult(wrapped);
    }
  );
}
`,

  "src/index.ts": `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ${className} } from "./${className}.js";
import { registerAllTools } from "./tools/index.js";

const HOST = process.env.GAME_HOST ?? "127.0.0.1";
const PORT = parseInt(process.env.GAME_PORT ?? "0", 10);

async function main(): Promise<void> {
  const server = new McpServer({
    name: "openroost-${name}",
    version: "0.1.0",
  });

  const game = new ${className}({ host: HOST, port: PORT });

  registerAllTools(server, game);
  game.restoreState();

  // IMPORTANT: stdout carries MCP JSON-RPC — log to stderr only.
  console.error(\`[OpenRoost] Connecting to \${HOST}:\${PORT}...\`);
  try {
    await game.connect();
    console.error("[OpenRoost] Connected!");
  } catch (err) {
    console.error(
      \`[OpenRoost] Failed to connect: \${err instanceof Error ? err.message : String(err)}\`
    );
  }

  game.startAutoSave();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[OpenRoost] MCP server running on stdio");

  const shutdown = (reason: string) => {
    console.error(\`[OpenRoost] Shutting down (\${reason})...\`);
    game.stopAutoSave();
    game.disconnect();
    process.exit(0);
  };

  transport.onclose = () => shutdown("MCP client disconnected");
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[OpenRoost] Fatal error:", err);
  process.exit(1);
});
`,
};

for (const [rel, content] of Object.entries(files)) {
  const path = join(root, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
  console.log(`created packages/${name}/${rel}`);
}

console.log(`
Done! Next steps:
  1. npm install
  2. Implement ${className}.connect() in packages/${name}/src/${className}.ts
  3. Add tools under packages/${name}/src/tools/ (see packages/minecraft for patterns)
  4. npm run build && node packages/${name}/build/index.js
  5. See docs/ADDING_A_GAME.md for the full guide
`);
