# OpenRoost

MCP servers enabling Claude to play videogames as a cooperative AI player.

## Architecture

```
packages/
├── core/        → @openroost/core — shared EventManager, TaskManager, base types
└── minecraft/   → @openroost/minecraft — Mineflayer bot + MCP tools
```

## Quick Start

```bash
# Install all dependencies
npm install

# Build everything (core first, then game packages)
npm run build

# Run the Minecraft server
MC_HOST=localhost MC_PORT=25565 MC_USERNAME=ClaudeBot npm start -w packages/minecraft
```

## Claude Desktop Configuration

```json
{
  "mcpServers": {
    "minecraft": {
      "command": "node",
      "args": ["/path/to/OpenRoost/packages/minecraft/build/index.js"],
      "env": {
        "MC_HOST": "localhost",
        "MC_PORT": "25565",
        "MC_USERNAME": "ClaudeBot"
      }
    }
  }
}
```

## Phase 1 Tools

| Tool | Description |
|------|-------------|
| `get_observation` | Snapshot of position, health, nearby blocks/entities |
| `check_inventory` | Full inventory, armor, held item |
| `go_to` | Pathfind to coordinates (async, returns task ID) |
| `mine_block` | Break a block, auto-selects best tool |
| `send_chat` | Send a chat message |
| `get_events` | Retrieve recent events (damage, chat, deaths) |
| `get_task_status` | Poll async task progress |

## Design Principles

- **Event piggybacking** — urgent events ride on every tool response
- **Observation snapshots** — every action returns updated world state
- **Async task model** — long actions return task IDs, not blocking calls
- **Right-sized granularity** — tools are intentional actions, not key presses
