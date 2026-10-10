import {
  CHAR_FRAME_HEIGHT,
  CHAR_FRAME_WIDTH,
  DIRECTION_OFFSETS,
  FRAMES_PER_DIRECTION,
  NPC_DESCRIPTION_MAX,
  NPC_FRAME,
  NPC_VARIANT_COUNT,
  PLAYER_WALK_ROW_Y,
} from "../config";

export interface ImageSize {
  width: number;
  height: number;
}

export interface CharacterAssetResult {
  npcDescriptions: string[];
  errors: string[];
}

/**
 * Validates the player sheet, the seven NPC sheets, and `npcs.json`.
 * A `null` size means the image failed to load.
 */
export function validateCharacterAssets(
  player: ImageSize | null,
  npcSheets: (ImageSize | null)[],
  npcsJson: unknown,
): CharacterAssetResult {
  const errors: string[] = [];

  const maxOffset = Math.max(...Object.values(DIRECTION_OFFSETS));
  const playerNeedW = (maxOffset + FRAMES_PER_DIRECTION) * CHAR_FRAME_WIDTH;
  const playerNeedH = PLAYER_WALK_ROW_Y + CHAR_FRAME_HEIGHT;
  if (!player) errors.push("sprites/player.png is missing.");
  else if (player.width < playerNeedW || player.height < playerNeedH) {
    errors.push(`sprites/player.png is ${player.width}x${player.height}; it must be at least ${playerNeedW}x${playerNeedH}.`);
  }

  const needW = NPC_FRAME.x + NPC_FRAME.width;
  const needH = NPC_FRAME.y + NPC_FRAME.height;
  for (let i = 0; i < NPC_VARIANT_COUNT; i++) {
    const sheet = npcSheets[i];
    const file = `sprites/npc${i + 1}.png`;
    if (!sheet) errors.push(`${file} is missing.`);
    else if (sheet.width < needW || sheet.height < needH) {
      errors.push(`${file} is ${sheet.width}x${sheet.height}; it must contain the frame rectangle at (${NPC_FRAME.x}, ${NPC_FRAME.y}) of ${NPC_FRAME.width}x${NPC_FRAME.height}.`);
    }
  }

  const npcDescriptions: string[] = [];
  if (!Array.isArray(npcsJson)) {
    errors.push("sprites/npcs.json must be a JSON array of strings.");
  } else {
    if (npcsJson.length !== NPC_VARIANT_COUNT) {
      errors.push(`sprites/npcs.json must contain exactly ${NPC_VARIANT_COUNT} descriptions (found ${npcsJson.length}).`);
    }
    npcsJson.forEach((d, i) => {
      if (typeof d !== "string" || d.trim() === "" || d.length > NPC_DESCRIPTION_MAX) {
        errors.push(`sprites/npcs.json entry ${i} must be a string of 1-${NPC_DESCRIPTION_MAX} characters.`);
      } else {
        npcDescriptions.push(d);
      }
    });
  }
  return { npcDescriptions, errors };
}
