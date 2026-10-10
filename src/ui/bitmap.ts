import Phaser from "phaser";
import { FONT_KEY, FONT_SIZE } from "../config";
import { toFontText } from "./text";

export const COLORS = {
  panel: 0x1d1b26,
  panelBorder: 0x8b84a8,
  text: 0xffffff,
  dim: 0x8a8799,
  highlight: 0xffd966,
  win: 0x7ee08a,
  loss: 0xff7a7a,
  notice: 0xffb366,
} as const;

export interface TextOptions {
  maxWidth?: number;
  /** Integer multiple of the font's native 18 px size. */
  scale?: 1 | 2 | 3;
  tint?: number;
  align?: 0 | 1 | 2;
}

/** All in-game text goes through here: bitmap font, integer scale, printable ASCII only. */
export function bitmapText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  options: TextOptions = {},
): Phaser.GameObjects.BitmapText {
  const t = scene.add.bitmapText(x, y, FONT_KEY, toFontText(text), FONT_SIZE * (options.scale ?? 1), options.align ?? 0);
  if (options.maxWidth) t.setMaxWidth(options.maxWidth);
  if (options.tint !== undefined) t.setTint(options.tint);
  return t;
}

export function setFontText(t: Phaser.GameObjects.BitmapText, text: string): void {
  t.setText(toFontText(text));
}

export function drawPanel(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  alpha = 0.94,
): void {
  graphics.fillStyle(COLORS.panel, alpha);
  graphics.fillRect(x, y, width, height);
  graphics.lineStyle(2, COLORS.panelBorder, 1);
  graphics.strokeRect(x + 1, y + 1, width - 2, height - 2);
}
