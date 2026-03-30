// ── Shared base types for all game packages ──

export type Position = { x: number; y: number; z: number };

export type BlockInfo = { name: string; position: Position };

export type EntityInfo = {
  name: string;
  type: "player" | "mob" | "animal" | "item";
  position: Position;
  health?: number;
  distance: number;
};

export type ItemStack = { name: string; count: number; slot: number };

// ── Observation & Action results ──

export type BaseObservation = {
  position: Position;
  health: number;
  gameTime: number;
};

export type ObservationSnapshot = BaseObservation & {
  food: number;
  experience: number;
  biome: string;
  isRaining: boolean;
  lightLevel: number;
  nearbyBlocks: BlockInfo[];
  nearbyEntities: EntityInfo[];
  activeEffects: string[];
};

export type ActionResult = {
  success: boolean;
  error?: string;
  observation: ObservationSnapshot;
};

// ── Events ──

export type GameEventType =
  | "chat"
  | "damage_taken"
  | "damage_dealt"
  | "death"
  | "respawn"
  | "player_joined"
  | "player_left"
  | "mob_spotted"
  | "sunrise"
  | "sunset"
  | "night_fall"
  | "item_picked_up"
  | "task_complete"
  | "task_failed"
  | "sound_heard"
  | "weather_change"
  | "phantom_warning";

export type GameEvent = {
  tick: number;
  type: GameEventType;
  data: Record<string, unknown>;
  summary: string;
};

// ── Task tracking ──

export type TaskStatus = "running" | "complete" | "failed";

export type TaskInfo = {
  id: string;
  status: TaskStatus;
  description: string;
  result?: unknown;
  progress?: string;
  createdAt: number;
};
