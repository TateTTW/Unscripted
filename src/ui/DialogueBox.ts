import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH } from "../config";
import { bitmapText, COLORS, drawPanel, setFontText } from "./bitmap";
import type { Panel, UIKey } from "./panel";

const MARGIN = 8;
const PAD = 10;

/** Bottom-of-screen dialogue box. Each page is shown until Space/E/Enter. */
export class DialogueBox implements Panel {
  private container: Phaser.GameObjects.Container;
  private graphics: Phaser.GameObjects.Graphics;
  private text: Phaser.GameObjects.BitmapText;
  private more: Phaser.GameObjects.BitmapText;
  private page = 0;

  constructor(
    scene: Phaser.Scene,
    private readonly pages: string[],
    private readonly onDone: () => void,
  ) {
    this.container = scene.add.container(0, 0);
    this.graphics = scene.add.graphics();
    this.text = bitmapText(scene, MARGIN + PAD, 0, "", { maxWidth: GAME_WIDTH - (MARGIN + PAD) * 2 });
    this.more = bitmapText(scene, GAME_WIDTH - MARGIN - PAD, 0, "", { tint: COLORS.highlight }).setOrigin(1, 0);
    this.container.add([this.graphics, this.text, this.more]);
    this.show();
  }

  private show(): void {
    const content = this.pages[this.page] ?? "";
    setFontText(this.text, content);
    const isLast = this.page >= this.pages.length - 1;
    setFontText(this.more, isLast ? "[E]" : `${this.page + 1}/${this.pages.length} >`);
    const height = Math.max(60, this.text.height + PAD * 2 + 20);
    const top = GAME_HEIGHT - MARGIN - height;
    this.graphics.clear();
    drawPanel(this.graphics, MARGIN, top, GAME_WIDTH - MARGIN * 2, height);
    this.text.setY(top + PAD);
    this.more.setY(top + height - PAD - 16);
  }

  handleKey(key: UIKey, repeat: boolean): boolean {
    if (repeat) return true;
    if (key === "confirm" || key === "advance") {
      this.page++;
      if (this.page >= this.pages.length) this.onDone();
      else this.show();
    }
    return true;
  }

  destroy(): void {
    this.container.destroy(true);
  }
}

/** Full-screen text panel (briefing). Esc, E, Enter, or Space closes it. */
export class TextPanel implements Panel {
  private container: Phaser.GameObjects.Container;

  constructor(
    scene: Phaser.Scene,
    title: string,
    body: string,
    private readonly onClose: () => void,
  ) {
    this.container = scene.add.container(0, 0);
    const g = scene.add.graphics();
    drawPanel(g, 6, 6, GAME_WIDTH - 12, GAME_HEIGHT - 12, 1);
    const width = GAME_WIDTH - 40;
    const titleText = bitmapText(scene, 20, 18, title, { tint: COLORS.highlight, maxWidth: width });
    const bodyText = bitmapText(scene, 20, titleText.y + titleText.height + 12, body, { maxWidth: width });
    const hint = bitmapText(scene, GAME_WIDTH - 20, GAME_HEIGHT - 34, "Esc: back", { tint: COLORS.dim }).setOrigin(1, 0);
    this.container.add([g, titleText, bodyText, hint]);
  }

  handleKey(key: UIKey, repeat: boolean): boolean {
    if (!repeat && (key === "cancel" || key === "confirm" || key === "advance")) this.onClose();
    return true;
  }

  destroy(): void {
    this.container.destroy(true);
  }
}

/** Brief non-blocking notices stacked in the top-left corner. */
export class Toasts {
  private active: Phaser.GameObjects.Container[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly duration: number,
  ) {}

  show(message: string, tint: number = COLORS.text): void {
    const text = bitmapText(this.scene, 8, 5, message, { tint });
    const g = this.scene.add.graphics();
    drawPanel(g, 0, 0, Math.ceil(text.width) + 16, 28);
    const toast = this.scene.add.container(8, 8, [g, text]);
    toast.setDepth(50);
    this.active.push(toast);
    this.layout();
    this.scene.tweens.add({
      targets: toast,
      alpha: 0,
      delay: this.duration,
      duration: 400,
      onComplete: () => {
        this.active = this.active.filter((t) => t !== toast);
        toast.destroy(true);
        this.layout();
      },
    });
  }

  private layout(): void {
    this.active.forEach((toast, i) => toast.setY(8 + i * 32));
  }
}
