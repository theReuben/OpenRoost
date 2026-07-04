# OpenRoost

MCP servers enabling Claude to play videogames as a cooperative AI player. Starting with Minecraft Java Edition, with a game-agnostic core designed for expansion.

## Prerequisites

- **Node.js** 18+ (LTS recommended)
- **Minecraft Java Edition server** — any of:
  - Vanilla server ([download](https://www.minecraft.net/en-us/download/server))
  - [Paper](https://papermc.io/) or [Spigot](https://www.spigotmc.org/)
  - A Minecraft hosting provider
- Server version **1.8.8 – 1.21.11** (Mineflayer compatibility)

## Architecture

```
packages/
├── core/        → @openroost/core — shared EventManager, TaskManager, base types
└── minecraft/   → @openroost/minecraft — Mineflayer bot + 30 MCP tools
```

## Getting Started

### 1. Clone and build

```bash
git clone https://github.com/theReuben/OpenRoost.git
cd OpenRoost
npm install
npm run build
```

### 2. Set up a Minecraft server

If you don't already have one running, here's the quickest way:

```bash
# Download the vanilla server jar (example for 1.21.x)
mkdir mc-server && cd mc-server
# Download server.jar from https://www.minecraft.net/en-us/download/server
java -jar server.jar --nogui
# Accept the EULA: edit eula.txt, set eula=true
# Restart: java -jar server.jar --nogui
```

**Important `server.properties` settings:**

```properties
# Allow the bot to connect without a paid Minecraft account
online-mode=false

# Optional: set to creative for testing
gamemode=creative
```

After changing `server.properties`, restart the server.

### 3. Connect the bot

```bash
# Default: 127.0.0.1:25565 as "ClaudeBot"
npm start -w packages/minecraft

# Custom settings via environment variables
MC_HOST=192.168.1.50 MC_PORT=25565 MC_USERNAME=MyBot MC_VERSION=1.21.4 npm start -w packages/minecraft
```

### 4. Configure Claude

#### Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "minecraft": {
      "command": "node",
      "args": ["/absolute/path/to/OpenRoost/packages/minecraft/build/index.js"],
      "env": {
        "MC_HOST": "127.0.0.1",
        "MC_PORT": "25565",
        "MC_USERNAME": "ClaudeBot"
      }
    }
  }
}
```

#### Claude Code

Add to your `.mcp.json` in the project root or `~/.claude/mcp.json` globally:

```json
{
  "mcpServers": {
    "minecraft": {
      "command": "node",
      "args": ["/absolute/path/to/OpenRoost/packages/minecraft/build/index.js"],
      "env": {
        "MC_HOST": "127.0.0.1",
        "MC_PORT": "25565",
        "MC_USERNAME": "ClaudeBot"
      }
    }
  }
}
```

### 5. Play

Once connected, Claude has access to 30 tools. Open a conversation and try:

> "Look around and tell me what you see."
> "Follow me and help me mine some iron."
> "Build a small shelter before nightfall."

Claude will call `get_observation` to orient itself, use `go_to` and `mine_block` to gather resources, `craft_item` to make tools, and `send_chat` to communicate in-game.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MC_HOST` | `127.0.0.1` | Minecraft server hostname or IP |
| `MC_PORT` | `25565` | Minecraft server port |
| `MC_USERNAME` | `ClaudeBot` | Bot's in-game username |
| `MC_VERSION` | auto-detect | Force a specific Minecraft version (e.g. `1.21.4`) |

## Development

```bash
# Build everything
npm run build

# Build individual packages
npm run build:core
npm run build:minecraft

# Run tests (176 tests across core + minecraft)
npm test

# Watch mode for development
npm run dev:minecraft

# Clean build artifacts
npm run clean
```

## Tools

### Layer 1 — Perception & Awareness
| Tool | Description |
|------|-------------|
| `get_observation` | Snapshot of position, health, nearby blocks/entities |
| `check_inventory` | Full inventory, armor, held item |
| `look_at` | Look in a direction/position, describe what's visible |
| `scan_area` | Scan larger area for specific block types |
| `get_recipe` | Look up crafting recipes via minecraft-data |
| `get_events` | Retrieve recent events (damage, chat, deaths, sounds) |
| `get_time_weather` | Time of day, weather, moon phase, phantom risk |

### Layer 2 — Movement & Navigation
| Tool | Description |
|------|-------------|
| `go_to` | Pathfind to coordinates (async, returns task ID) |
| `follow_player` | Follow a player maintaining distance (continuous) |
| `stop_movement` | Cancel active movement/following |

### Layer 3 — World Interaction
| Tool | Description |
|------|-------------|
| `mine_block` | Break a block, auto-selects best tool |
| `place_block` | Place a block with face direction |
| `use_item` | Eat food, throw items, activate with target |
| `interact_block` | Open chests, press buttons, use furnaces |

### Layer 4 — Crafting & Processing
| Tool | Description |
|------|-------------|
| `craft_item` | Craft with inventory or crafting table |
| `smelt_item` | Async furnace smelting with fuel |
| `transfer_items` | Deposit/withdraw from containers |

### Layer 5 — Combat
| Tool | Description |
|------|-------------|
| `attack_entity` | Attack mob/animal/player with pursuit |
| `defend` | Auto-attack hostiles, flee at low health |
| `equip_armor` | Equip best armor by tier |

### Layer 6 — Communication
| Tool | Description |
|------|-------------|
| `send_chat` | Send a chat message |
| `whisper` | Private message via /msg |
| `get_player_info` | Online status, position, ping |

### Layer 7 — Task Management & Memory
| Tool | Description |
|------|-------------|
| `get_task_status` | Poll async task progress |
| `cancel_task` | Cancel any running async task |
| `get_death_history` | Recent death locations for item recovery |
| `recall_containers` | Remember contents of chests opened before (decays over time) |
| `sleep` | Sleep in a nearby bed to skip night and reset the phantom timer |

### Layer 8 — Learning (Voyager-style skill library)
| Tool | Description |
|------|-------------|
| `save_skill` | Record a strategy that worked (or failed) with tags and outcome |
| `recall_skills` | Retrieve relevant learned strategies before starting a task |

Skills persist across sessions in `openroost-state.json`. Each save records a
success/failure outcome, so strategies that keep working rank above ones that
don't — the bot genuinely gets better the more you play with it.

## Troubleshooting

### "ECONNREFUSED" or "connect ECONNREFUSED"
The bot can't reach the Minecraft server. Check that:
- The server is running and finished loading
- `MC_HOST` and `MC_PORT` match your server
- No firewall is blocking the port

### "Invalid session" or authentication errors
Set `online-mode=false` in your `server.properties` and restart the server. The bot connects in offline/cracked mode since it doesn't have a Minecraft account.

### "Version mismatch" or the bot connects but immediately disconnects
Set the `MC_VERSION` environment variable to match your server's exact version (e.g. `MC_VERSION=1.21.4`). Run `/version` on the server console to check.

### Bot connects but doesn't respond to tools
Make sure you built after installing: `npm run build`. The MCP server runs the compiled JavaScript from `build/`, not the TypeScript source.

### Bot gets stuck pathfinding
Use `stop_movement` to cancel navigation, or `cancel_task` with the task ID. Complex terrain (water, lava, cliffs) can cause pathfinding issues.

## Design Principles

- **Event piggybacking** — urgent events (damage, chat, death) ride on every tool response so Claude reacts without polling
- **Observation snapshots** — every action returns updated world state
- **Async task model** — long actions return task IDs, not blocking calls
- **Right-sized granularity** — tools are intentional actions ("mine this block"), not input events ("press left click") or high-level goals ("build a house")
- **Game-agnostic core** — EventManager, TaskManager, SkillLibrary, and JsonStore are generic; adding a new game means adding a new package, not modifying core
- **Learning across sessions** — the skill library persists strategies with outcomes, so the agent improves the more it plays
- **Structured output everywhere** — every tool emits MCP structuredContent alongside text, so typed clients skip JSON re-parsing

## Adding a New Game

```bash
node scripts/create-game.mjs <game-name>   # e.g. factorio
npm install && npm run build
```

The scaffolder generates a compiling, bootable MCP server wired to core's
event, task, skill, and persistence systems — including working
`save_skill`/`recall_skills` tools, so the agent learns your game from day
one. Then implement the game connection and add perception/action tools.

See **[docs/ADDING_A_GAME.md](docs/ADDING_A_GAME.md)** for the full guide
(integration routes for Luanti, Factorio, Terraria, Stardew Valley, Screeps,
and the conventions that keep game packages consistent), and
`packages/minecraft/` as the reference implementation.

## Roadmap

- **MCP SDK v2** once it ships as stable alongside the 2026-07-28 spec
  (extensions framework, MCP Tasks — a natural fit for OpenRoost's async
  task model — and MCP Apps for a richer in-client HUD)
- **Second game package** to prove the core boundary (Luanti or Factorio
  are the strongest candidates)
- **Autonomous sessions** — standing goals + the skill/task systems already
  support unattended play; needs a driving loop on the client side
