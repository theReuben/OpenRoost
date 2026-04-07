import http from "http";
import { BotManager } from "./BotManager.js";
import { getTimePhase } from "./timeUtils.js";

interface HudPayload {
  connected: boolean;
  health: number;
  food: number;
  experience: { level: number; progress: number };
  hotbar: ({ name: string; count: number } | null)[];
  selectedSlot: number;
  position: { x: number; y: number; z: number };
  biome: string;
  time: { timeOfDay: number; phase: string; dayCount: number };
  weather: string;
  chatMessages: { sender: string; text: string }[];
  gameMode: string;
}

/**
 * Create a HUD overlay server that wraps the prismarine-viewer iframe
 * with a Minecraft-style streaming HUD.
 *
 * @returns close function to tear down the server
 */
export function createHudServer(
  bot: BotManager,
  publicPort: number,
  internalPort: number
): { close: () => void } {
  const clients = new Set<http.ServerResponse>();
  const chatBuffer: { sender: string; text: string }[] = [];
  const MAX_CHAT = 20;

  // Chat listener — keeps its own buffer separate from EventManager
  let chatCleanup: (() => void) | undefined;

  function wireChat(): void {
    const handler = (username: string, message: string) => {
      if (username === bot.bot.username) return;
      chatBuffer.push({ sender: username, text: message });
      if (chatBuffer.length > MAX_CHAT) chatBuffer.shift();
    };
    bot.bot.on("chat", handler);
    chatCleanup = () => {
      try {
        bot.bot.removeListener("chat", handler);
      } catch { /* bot may be gone */ }
    };
  }

  // Wire chat on first call — re-wire handled externally via close/recreate
  if (bot.isConnected) wireChat();

  const server = http.createServer((req, res) => {
    if (req.url === "/sse") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    // Serve the HUD page
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(getHudHtml(internalPort));
  });

  // Push bot state to all SSE clients every 500ms
  const interval = setInterval(() => {
    if (clients.size === 0) return;

    // Re-wire chat if bot reconnected and handler was lost
    if (bot.isConnected && !chatCleanup) wireChat();

    const payload = gatherData(bot, chatBuffer);
    const frame = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of clients) {
      try {
        client.write(frame);
      } catch {
        clients.delete(client);
      }
    }
  }, 500);

  server.listen(publicPort, () => {
    console.error(`[OpenRoost] HUD viewer running at http://localhost:${publicPort}`);
  });

  return {
    close() {
      clearInterval(interval);
      chatCleanup?.();
      chatCleanup = undefined;
      for (const c of clients) {
        try { c.end(); } catch { /* ignore */ }
      }
      clients.clear();
      server.close();
    },
  };
}

// ── Data gathering ──

function gatherData(
  bot: BotManager,
  chatBuffer: { sender: string; text: string }[]
): HudPayload | { connected: false } {
  if (!bot.isConnected) return { connected: false } as any;

  const b = bot.bot;
  const hotbar: ({ name: string; count: number } | null)[] = [];
  for (let i = 36; i <= 44; i++) {
    const slot = b.inventory.slots[i];
    hotbar.push(slot ? { name: slot.name, count: slot.count } : null);
  }

  return {
    connected: true,
    health: b.health ?? 20,
    food: b.food ?? 20,
    experience: {
      level: b.experience?.level ?? 0,
      progress: b.experience?.progress ?? 0,
    },
    hotbar,
    selectedSlot: b.quickBarSlot ?? 0,
    position: {
      x: Math.floor(b.entity.position.x),
      y: Math.floor(b.entity.position.y),
      z: Math.floor(b.entity.position.z),
    },
    biome: bot.getBiome(),
    time: {
      timeOfDay: b.time?.timeOfDay ?? 0,
      phase: getTimePhase(b.time?.timeOfDay ?? 0),
      dayCount: Math.floor((b.time?.age ?? 0) / 24000),
    },
    weather: bot.currentWeather,
    chatMessages: chatBuffer.slice(-10),
    gameMode: (b as any).game?.gameMode ?? "unknown",
  };
}

// ── Inline HTML page ──

function getHudHtml(viewerPort: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenRoost - Bot Viewer</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #000; overflow: hidden; font-family: 'Press Start 2P', monospace; }

  #viewer-frame {
    position: fixed; inset: 0;
    width: 100%; height: 100%;
    border: none; z-index: 0;
  }

  #hud {
    position: fixed; inset: 0;
    z-index: 1; pointer-events: none;
    color: #fff; text-shadow: 2px 2px 0 #000;
  }

  /* ── Top bar ── */
  .top-left {
    position: absolute; top: 12px; left: 12px;
    font-size: 10px; line-height: 1.8;
  }
  .top-right {
    position: absolute; top: 12px; right: 12px;
    font-size: 10px; text-align: right; line-height: 1.8;
  }

  /* ── Bottom HUD ── */
  .bottom-hud {
    position: absolute; bottom: 0; left: 50%;
    transform: translateX(-50%);
    display: flex; flex-direction: column; align-items: center;
    padding-bottom: 8px; gap: 2px;
  }

  /* Health + food row */
  .bars-row {
    display: flex; gap: 40px; align-items: center;
    font-size: 14px; margin-bottom: 2px;
  }
  .hearts, .food { display: flex; gap: 1px; }
  .heart { color: #555; }
  .heart.full { color: #e22; }
  .heart.half { color: #e22; opacity: 0.6; }
  .drumstick { color: #555; }
  .drumstick.full { color: #c93; }
  .drumstick.half { color: #c93; opacity: 0.6; }

  /* XP bar */
  .xp-bar-container {
    width: 364px; height: 10px;
    background: #222; border: 1px solid #0a0;
    position: relative; margin-bottom: 2px;
  }
  .xp-bar-fill {
    height: 100%; background: #5f5;
    transition: width 0.3s;
  }
  .xp-level {
    font-size: 9px; color: #5f5;
    text-align: center; margin-bottom: 1px;
  }

  /* Hotbar */
  .hotbar {
    display: flex; gap: 2px;
  }
  .hotbar-slot {
    width: 40px; height: 40px;
    background: rgba(50, 50, 50, 0.75);
    border: 2px solid #555;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    font-size: 6px; text-align: center;
    position: relative;
    overflow: hidden;
  }
  .hotbar-slot.selected {
    border-color: #eee;
    background: rgba(80, 80, 80, 0.85);
  }
  .hotbar-slot .item-name {
    font-size: 6px; max-width: 36px;
    overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hotbar-slot .item-count {
    font-size: 7px; color: #fff;
    position: absolute; bottom: 1px; right: 3px;
  }

  /* Chat */
  .chat-feed {
    position: absolute; bottom: 110px; left: 12px;
    font-size: 9px; line-height: 1.6;
    max-width: 400px;
  }
  .chat-msg {
    background: rgba(0,0,0,0.45);
    padding: 2px 6px; margin-bottom: 1px;
    border-radius: 2px;
  }
  .chat-msg .sender { color: #ff5; }

  /* Disconnected overlay */
  .disconnected {
    position: fixed; inset: 0;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.7); z-index: 2;
    font-size: 14px; color: #f55;
  }
  .disconnected.hidden { display: none; }
</style>
</head>
<body>
  <iframe id="viewer-frame" src="http://localhost:${viewerPort}"></iframe>

  <div class="disconnected hidden" id="dc-overlay">Disconnected from server...</div>

  <div id="hud">
    <!-- Top left: position & biome -->
    <div class="top-left">
      <div id="coords">XYZ: 0 64 0</div>
      <div id="biome">Biome: unknown</div>
      <div id="gamemode" style="color:#aaa;margin-top:4px;"></div>
    </div>

    <!-- Top right: time & weather -->
    <div class="top-right">
      <div id="time-display">Morning</div>
      <div id="weather-display">Clear</div>
      <div id="day-count" style="color:#aaa;margin-top:4px;"></div>
    </div>

    <!-- Chat feed -->
    <div class="chat-feed" id="chat-feed"></div>

    <!-- Bottom HUD -->
    <div class="bottom-hud">
      <div class="bars-row">
        <div class="hearts" id="hearts"></div>
        <div class="food" id="food"></div>
      </div>
      <div class="xp-level" id="xp-level">Lvl 0</div>
      <div class="xp-bar-container">
        <div class="xp-bar-fill" id="xp-fill" style="width:0%"></div>
      </div>
      <div class="hotbar" id="hotbar"></div>
    </div>
  </div>

<script>
const TIME_ICONS = { morning: "\\u2600", afternoon: "\\u2600", dusk: "\\u{1F305}", night: "\\u{1F319}", midnight: "\\u{1F319}", dawn: "\\u{1F305}" };
const WEATHER_ICONS = { clear: "\\u2600 Clear", rain: "\\u{1F327} Rain", thunder: "\\u26A1 Thunder" };

function renderHearts(hp) {
  const el = document.getElementById("hearts");
  let html = "";
  for (let i = 0; i < 10; i++) {
    const v = hp - i * 2;
    const cls = v >= 2 ? "full" : v >= 1 ? "half" : "";
    html += '<span class="heart ' + cls + '">\\u2764</span>';
  }
  el.innerHTML = html;
}

function renderFood(food) {
  const el = document.getElementById("food");
  let html = "";
  for (let i = 0; i < 10; i++) {
    const v = food - i * 2;
    const cls = v >= 2 ? "full" : v >= 1 ? "half" : "";
    html += '<span class="drumstick ' + cls + '">\\u{1F357}</span>';
  }
  el.innerHTML = html;
}

function renderHotbar(hotbar, selected) {
  const el = document.getElementById("hotbar");
  let html = "";
  for (let i = 0; i < 9; i++) {
    const item = hotbar[i];
    const sel = i === selected ? " selected" : "";
    const name = item ? item.name.replace(/_/g, " ") : "";
    const count = item && item.count > 1 ? item.count : "";
    html += '<div class="hotbar-slot' + sel + '">'
      + '<span class="item-name">' + name + '</span>'
      + (count ? '<span class="item-count">' + count + '</span>' : '')
      + '</div>';
  }
  el.innerHTML = html;
}

function renderChat(messages) {
  const el = document.getElementById("chat-feed");
  el.innerHTML = messages.map(function(m) {
    return '<div class="chat-msg"><span class="sender">' + m.sender + '</span>: ' + m.text + '</div>';
  }).join("");
}

function update(data) {
  const dc = document.getElementById("dc-overlay");
  if (!data.connected) {
    dc.classList.remove("hidden");
    return;
  }
  dc.classList.add("hidden");

  renderHearts(data.health);
  renderFood(data.food);

  document.getElementById("xp-level").textContent = "Lvl " + data.experience.level;
  document.getElementById("xp-fill").style.width = (data.experience.progress * 100) + "%";

  renderHotbar(data.hotbar, data.selectedSlot);

  const p = data.position;
  document.getElementById("coords").textContent = "XYZ: " + p.x + " " + p.y + " " + p.z;
  document.getElementById("biome").textContent = "Biome: " + data.biome.replace(/_/g, " ");
  document.getElementById("gamemode").textContent = data.gameMode;

  const icon = TIME_ICONS[data.time.phase] || "";
  document.getElementById("time-display").textContent = icon + " " + data.time.phase.charAt(0).toUpperCase() + data.time.phase.slice(1);
  document.getElementById("weather-display").textContent = WEATHER_ICONS[data.weather] || data.weather;
  document.getElementById("day-count").textContent = "Day " + data.time.dayCount;

  renderChat(data.chatMessages);
}

// SSE connection with auto-reconnect
const es = new EventSource("/sse");
es.onmessage = function(e) {
  try { update(JSON.parse(e.data)); } catch {}
};
es.onerror = function() {
  document.getElementById("dc-overlay").classList.remove("hidden");
};
</script>
</body>
</html>`;
}
