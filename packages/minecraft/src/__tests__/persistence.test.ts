import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Persistence, PersistedState } from "../Persistence.js";
import { ContainerMemory } from "../ContainerMemory.js";

function tmpFile(): string {
  return join(tmpdir(), `openroost-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

describe("Persistence", () => {
  let filePath: string;

  beforeEach(() => {
    filePath = tmpFile();
  });

  afterEach(() => {
    try {
      if (existsSync(filePath)) unlinkSync(filePath);
    } catch {
      // cleanup
    }
  });

  it("returns defaults when no file exists", () => {
    const p = new Persistence(filePath);
    const state = p.load();

    expect(state.containers).toEqual([]);
    expect(state.deaths).toEqual([]);
    expect(state.lastSleepTick).toBe(-1);
  });

  it("saves and loads state roundtrip", () => {
    const p = new Persistence(filePath);

    const state: PersistedState = {
      containers: [
        {
          position: { x: 10, y: 64, z: -20 },
          blockName: "chest",
          items: [{ name: "diamond", count: 5, slot: 0 }],
          lastCheckedTick: 1000,
          lastCheckedTime: Date.now(),
        },
      ],
      deaths: [
        {
          position: { x: 100, y: 64, z: -200 },
          timestamp: Date.now(),
          gameTime: 6000,
          message: "fell out of the world",
        },
      ],
      lastSleepTick: 48000,
      savedAt: new Date().toISOString(),
    };

    p.save(state);
    const loaded = p.load();

    expect(loaded.containers).toHaveLength(1);
    expect(loaded.containers[0].blockName).toBe("chest");
    expect(loaded.containers[0].items[0].name).toBe("diamond");
    expect(loaded.deaths).toHaveLength(1);
    expect(loaded.deaths[0].position.x).toBe(100);
    expect(loaded.lastSleepTick).toBe(48000);
  });

  it("handles corrupt file gracefully", () => {
    writeFileSync(filePath, "not valid json {{{");
    const p = new Persistence(filePath);
    const state = p.load();

    expect(state.containers).toEqual([]);
    expect(state.deaths).toEqual([]);
  });

  it("handles partial/missing fields in saved state", () => {
    writeFileSync(filePath, JSON.stringify({ deaths: [{ position: { x: 1, y: 2, z: 3 }, timestamp: 0, gameTime: 0 }] }));
    const p = new Persistence(filePath);
    const state = p.load();

    expect(state.containers).toEqual([]);
    expect(state.deaths).toHaveLength(1);
    expect(state.lastSleepTick).toBe(-1);
  });
});

describe("ContainerMemory import/export", () => {
  it("exports all records", () => {
    const cm = new ContainerMemory();
    cm.record(
      { x: 10, y: 64, z: -20 },
      "chest",
      [{ name: "diamond", count: 5, slot: 0 }],
      1000
    );
    cm.record(
      { x: 20, y: 64, z: -30 },
      "barrel",
      [{ name: "iron_ingot", count: 12, slot: 0 }],
      2000
    );

    const exported = cm.exportRecords();
    expect(exported).toHaveLength(2);
  });

  it("imports records and makes them recallable", () => {
    const cm = new ContainerMemory();
    cm.importRecords([
      {
        position: { x: 10, y: 64, z: -20 },
        blockName: "chest",
        items: [{ name: "diamond", count: 5, slot: 0 }],
        lastCheckedTick: 1000,
        lastCheckedTime: Date.now(),
      },
    ]);

    expect(cm.size).toBe(1);
    const recall = cm.recallAt({ x: 10, y: 64, z: -20 }, 1000);
    expect(recall).not.toBeNull();
    expect(recall!.blockName).toBe("chest");
    expect(recall!.items[0].name).toBe("diamond");
  });

  it("roundtrips through export and import", () => {
    const original = new ContainerMemory();
    original.record(
      { x: 5, y: 64, z: 5 },
      "chest",
      [
        { name: "diamond", count: 3, slot: 0 },
        { name: "cobblestone", count: 64, slot: 1 },
      ],
      500
    );

    const exported = original.exportRecords();

    const restored = new ContainerMemory();
    restored.importRecords(exported);

    expect(restored.size).toBe(1);
    const recall = restored.recallAt({ x: 5, y: 64, z: 5 }, 500);
    expect(recall!.clarity).toBe("exact");
    expect(recall!.items).toHaveLength(2);
  });
});
