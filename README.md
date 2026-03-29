# OpenRoost

MCP servers enabling Claude to play videogames as a cooperative AI player.

## Architecture

```
packages/
├── core/        → @openroost/core — shared EventManager, TaskManager, base types
└── minecraft/   → @openroost/minecraft — Mineflayer bot + 22 MCP tools
```

## Quick Start

```bash
# Install all dependencies
npm install

# Build everything (core first, then game packages)
npm run build

# Run tests
npm test

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

## Tools

### Layer 1 — Perception & Awareness
| Tool | Description |
|------|-------------|
| `get_observation` | Snapshot of position, health, nearby blocks/entities |
| `check_inventory` | Full inventory, armor, held item |
| `look_at` | Look in a direction/position, describe what's visible |
| `scan_area` | Scan larger area for specific block types |
| `get_recipe` | Look up crafting recipes via minecraft-data |
| `get_events` | Retrieve recent events (damage, chat, deaths) |

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

### Layer 7 — Task Management
| Tool | Description |
|------|-------------|
| `get_task_status` | Poll async task progress |
| `cancel_task` | Cancel any running async task |

## Design Principles

- **Event piggybacking** — urgent events ride on every tool response
- **Observation snapshots** — every action returns updated world state
- **Async task model** — long actions return task IDs, not blocking calls
- **Right-sized granularity** — tools are intentional actions, not key presses
- **Game-agnostic core** — EventManager and TaskManager are generic
