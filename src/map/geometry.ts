import { CHAR_FRAME_HEIGHT, CHAR_FRAME_WIDTH, ENTITY_BODY_SIZE, PLAYER_BODY } from "../config";
import type { Point, Rect } from "./types";

/** The player's feet body for a 16x32 sprite centered on `spriteCenter`. */
export function playerBodyRect(spriteCenter: Point): Rect {
  return {
    x: spriteCenter.x - CHAR_FRAME_WIDTH / 2 + PLAYER_BODY.offsetX,
    y: spriteCenter.y - CHAR_FRAME_HEIGHT / 2 + PLAYER_BODY.offsetY,
    width: PLAYER_BODY.width,
    height: PLAYER_BODY.height,
  };
}

/** The 16x16 body of an NPC or fixture centered on its map point. */
export function entityBodyRect(center: Point): Rect {
  return squareAt(center.x, center.y, ENTITY_BODY_SIZE);
}

/** True when the rectangles share interior area. Touching edges do not count. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function squareAt(cx: number, cy: number, size: number): Rect {
  return { x: cx - size / 2, y: cy - size / 2, width: size, height: size };
}
