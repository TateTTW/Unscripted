// All tunable constants live here.

// ---- OpenAI ----
export const OPENAI_MODEL = "gpt-6.1-sol";
export const REQUEST_TIMEOUT_MS = 120_000;
export const MAX_OUTPUT_TOKENS = 32_000;
/** Set to null to omit the `reasoning` parameter for models that don't support it. */
export const REASONING_EFFORT: "low" | "medium" | "high" | null = "medium";
export const MAX_REPAIR_ERRORS = 30;

// ---- Solver ----
export const SOLVER_MAX_STATES = 100_000;

// ---- Display ----
export const GAME_WIDTH = 640;
export const GAME_HEIGHT = 360;
export const WORLD_ZOOM = 2;
export const TILE_SIZE = 16;
/** Tileset images taller than this are split into several textures (GPU texture size limits). */
export const MAX_TILESET_TEXTURE_HEIGHT = 4096;

// ---- Font ----
export const FONT_KEY = "gridwright";
export const FONT_SIZE = 18;
export const FONT_LINE_HEIGHT = 20;

// ---- Player ----
export const PLAYER_SPEED = 80;
export const CHAR_FRAME_WIDTH = 16;
export const CHAR_FRAME_HEIGHT = 32;
export const PLAYER_BODY = { width: 10, height: 10, offsetX: 3, offsetY: 22 } as const;
/** Vertical distance from the sprite center to the center of the player's feet body. */
export const PLAYER_BODY_CENTER_DY =
  PLAYER_BODY.offsetY + PLAYER_BODY.height / 2 - CHAR_FRAME_HEIGHT / 2;
export const PLAYER_IDLE_ROW_Y = 32;
export const PLAYER_WALK_ROW_Y = 64;
export const FRAMES_PER_DIRECTION = 6;
export const IDLE_FRAME_RATE = 6;
export const WALK_FRAME_RATE = 10;

export type Facing = "right" | "up" | "left" | "down";
/** First column of each facing group, matching the supplied character sheets. */
export const DIRECTION_OFFSETS: Record<Facing, number> = {
  right: 0,
  up: 6,
  left: 12,
  down: 18,
};

// ---- NPCs ----
export const NPC_VARIANT_COUNT = 7;
/** The first down-facing idle frame of each NPC sheet. */
export const NPC_FRAME = {
  x: DIRECTION_OFFSETS.down * CHAR_FRAME_WIDTH,
  y: PLAYER_IDLE_ROW_Y,
  width: CHAR_FRAME_WIDTH,
  height: CHAR_FRAME_HEIGHT,
} as const;
export const NPC_DESCRIPTION_MAX = 80;
export const ENTITY_BODY_SIZE = 16;

// ---- Interaction ----
export const INTERACT_RANGE = 24;
export const FACING_CONE_DOT = 0.5;

// ---- UI ----
export const TOAST_DURATION_MS = 2200;

// ---- Persistence ----
export const LAST_GENRE_STORAGE_KEY = "unscripted.lastGenre";

// ---- Scenario limits (Section 6) ----
export const LIMITS = {
  titleMax: 40,
  introMax: 600,
  npcMin: 2,
  npcMax: 6,
  nameMax: 40,
  inspectMax: 300,
  itemMin: 3,
  itemMax: 10,
  interactionMin: 8,
  interactionMax: 40,
  conditionsMax: 4,
  eventsMin: 1,
  eventsMax: 8,
  textMax: 300,
} as const;

export const ID_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
export const STATE_PATTERN = /^[a-z][a-z0-9_]{0,29}$/;

// ---- Map limits (Section 4) ----
export const MAP_LIMITS = {
  anchorLabelMax: 80,
  fixtureNameMax: 40,
  fixtureInspectMax: 300,
  minAnchors: 2,
} as const;
