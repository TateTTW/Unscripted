import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH } from "../config";
import { ICONS_KEY } from "../scenes/BootScene";
import { bitmapText, COLORS, drawPanel } from "./bitmap";
import type { Panel, UIKey } from "./panel";

export interface MenuOption {
  label: string;
  /** Frame index in icons.png. */
  icon?: number;
}

export interface MenuConfig {
  title?: string;
  options: MenuOption[];
  /** Shown when there are no options. */
  emptyText?: string;
  /** Top-left position; defaults to centered. */
  x?: number;
  y?: number;
  onSelect: (index: number) => void;
  onCancel: () => void;
}

const PAD = 10;
const ROW = 22;
const CURSOR_W = 16;
const ICON_W = 20;
const MAX_LABEL_WIDTH = 560;

/** A keyboard-driven list menu drawn with the bitmap font. */
export class MenuPanel implements Panel {
  private container: Phaser.GameObjects.Container;
  private cursor: Phaser.GameObjects.BitmapText | null = null;
  private labels: Phaser.GameObjects.BitmapText[] = [];
  private index = 0;
  private readonly firstRowY: number;

  constructor(
    scene: Phaser.Scene,
    private readonly config: MenuConfig,
  ) {
    this.container = scene.add.container(0, 0);
    const hasIcons = config.options.some((o) => o.icon !== undefined);
    const textX = PAD + CURSOR_W + (hasIcons ? ICON_W : 0);

    const title = config.title ? bitmapText(scene, PAD, PAD, config.title, { tint: COLORS.highlight, maxWidth: MAX_LABEL_WIDTH }) : null;
    this.firstRowY = PAD + (title ? title.height + 6 : 0);

    let contentWidth = title ? title.width : 0;
    config.options.forEach((option, i) => {
      const y = this.firstRowY + i * ROW;
      const label = bitmapText(scene, textX, y, option.label);
      this.labels.push(label);
      contentWidth = Math.max(contentWidth, textX - PAD + label.width);
      if (option.icon !== undefined) {
        const icon = scene.add.image(PAD + CURSOR_W, y + 1, ICONS_KEY, option.icon).setOrigin(0, 0);
        this.container.add(icon);
      }
    });
    let empty: Phaser.GameObjects.BitmapText | null = null;
    if (config.options.length === 0 && config.emptyText) {
      empty = bitmapText(scene, PAD, this.firstRowY, config.emptyText, { tint: COLORS.dim });
      contentWidth = Math.max(contentWidth, empty.width);
    }

    const rows = Math.max(1, config.options.length);
    const width = Math.ceil(contentWidth + PAD * 2);
    const height = this.firstRowY + rows * ROW + PAD - 4;
    const x = Math.round(config.x ?? (GAME_WIDTH - width) / 2);
    const y = Math.round(Math.min(config.y ?? (GAME_HEIGHT - height) / 2, GAME_HEIGHT - height - 4));

    const g = scene.add.graphics();
    drawPanel(g, 0, 0, width, height);
    this.container.addAt(g, 0);
    if (title) this.container.add(title);
    this.container.add(this.labels);
    if (empty) this.container.add(empty);
    if (config.options.length > 0) {
      this.cursor = bitmapText(scene, PAD, this.firstRowY, ">", { tint: COLORS.highlight });
      this.container.add(this.cursor);
    }
    this.container.setPosition(x, y);
    this.refresh();
  }

  get bounds(): { x: number; y: number } {
    return { x: this.container.x, y: this.container.y };
  }

  private refresh(): void {
    this.labels.forEach((label, i) => label.setTint(i === this.index ? COLORS.highlight : COLORS.text));
    this.cursor?.setY(this.firstRowY + this.index * ROW);
  }

  handleKey(key: UIKey, repeat: boolean): boolean {
    const count = this.config.options.length;
    switch (key) {
      case "up":
        if (count > 0) this.index = (this.index - 1 + count) % count;
        this.refresh();
        return true;
      case "down":
        if (count > 0) this.index = (this.index + 1) % count;
        this.refresh();
        return true;
      case "confirm":
        if (!repeat && count > 0) this.config.onSelect(this.index);
        return true;
      case "cancel":
        if (!repeat) this.config.onCancel();
        return true;
      default:
        return false;
    }
  }

  destroy(): void {
    this.container.destroy(true);
  }
}
