import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH } from "../config";
import { GENRE_LABELS } from "../scenario/genre";
import type { Scenario } from "../scenario/schema";
import { bitmapText, COLORS } from "../ui/bitmap";
import type { GameData } from "./GameScene";

export interface IntroData {
  scenario: Scenario;
  /** Fallback reason shown when a generated scenario could not be used. */
  notice: string | null;
}

export class IntroScene extends Phaser.Scene {
  constructor() {
    super("IntroScene");
  }

  create(data: IntroData): void {
    this.cameras.main.setBackgroundColor("#111018");
    const margin = 14;
    const width = GAME_WIDTH - margin * 2;
    bitmapText(this, margin, 12, GENRE_LABELS[data.scenario.genre].toUpperCase(), { tint: COLORS.dim });
    const title = bitmapText(this, margin, 36, data.scenario.scenario_title, { scale: 2, tint: COLORS.highlight, maxWidth: width });
    let y = title.y + title.height + 12;
    const intro = bitmapText(this, margin, y, data.scenario.intro_text, { maxWidth: width });
    y += intro.height + 12;
    if (data.notice) bitmapText(this, margin, y, data.notice, { maxWidth: width, tint: COLORS.notice });

    const prompt = bitmapText(this, GAME_WIDTH / 2, GAME_HEIGHT - 26, "Press E or Enter to begin", { tint: COLORS.highlight });
    prompt.setOrigin(0.5, 0);
    this.tweens.add({ targets: prompt, alpha: 0.35, duration: 700, yoyo: true, repeat: -1 });

    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    const begin = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.key === "e" || event.key === "E" || event.key === "Enter" || event.key === " ") {
        keyboard.off("keydown", begin);
        const game: GameData = { scenario: data.scenario };
        this.scene.start("GameScene", game);
      }
    };
    keyboard.on("keydown", begin);
  }
}
