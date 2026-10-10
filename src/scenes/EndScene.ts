import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH } from "../config";
import type { Ending } from "../engine/interaction";
import { bitmapText, COLORS, drawPanel } from "../ui/bitmap";

export type EndData = Ending;

export class EndScene extends Phaser.Scene {
  constructor() {
    super("EndScene");
  }

  create(data: EndData): void {
    this.cameras.main.setBackgroundColor("#0c0b12");
    const win = data.outcome === "WIN";
    bitmapText(this, GAME_WIDTH / 2, 50, win ? "YOU WIN" : "YOU LOSE", {
      scale: 2,
      tint: win ? COLORS.win : COLORS.loss,
    }).setOrigin(0.5, 0);
    bitmapText(this, GAME_WIDTH / 2, 120, data.text, { maxWidth: 560, align: 1 }).setOrigin(0.5, 0);

    const buttonWidth = 180;
    const buttonX = GAME_WIDTH / 2 - buttonWidth / 2;
    const buttonY = GAME_HEIGHT - 80;
    const g = this.add.graphics();
    drawPanel(g, buttonX, buttonY, buttonWidth, 34);
    bitmapText(this, GAME_WIDTH / 2, buttonY + 8, "> Play Again <", { tint: COLORS.highlight }).setOrigin(0.5, 0);
    bitmapText(this, GAME_WIDTH / 2, buttonY + 44, "Press E or Enter", { tint: COLORS.dim }).setOrigin(0.5, 0);

    const readyAt = this.time.now + 300;
    this.input.keyboard?.on("keydown", (event: KeyboardEvent) => {
      if (event.repeat || this.time.now < readyAt) return;
      if (event.key === "e" || event.key === "E" || event.key === "Enter") window.location.reload();
    });
  }
}
