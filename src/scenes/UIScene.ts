import Phaser from "phaser";
import { TOAST_DURATION_MS } from "../config";
import type { Ending, InteractionResult } from "../engine/interaction";
import { heldItems } from "../engine/inventory";
import type { GameState, InteractionInput, World } from "../engine/state";
import { ICON_CATEGORIES, type Action, type ItemDefinition } from "../scenario/schema";
import { bitmapText, COLORS, drawPanel } from "../ui/bitmap";
import { DialogueBox, TextPanel, Toasts } from "../ui/DialogueBox";
import { MenuPanel, type MenuOption } from "../ui/MenuPanel";
import { toUIKey, type Panel } from "../ui/panel";

export interface Target {
  id: string;
  kind: "npc" | "fixture";
  name: string;
}

export interface GameController {
  readonly world: World;
  getState(): GameState;
  currentTarget(): Target | null;
  interact(input: InteractionInput): InteractionResult;
  end(ending: Ending): void;
}

export interface UIData {
  controller: GameController;
}

type Tag = "world" | "inventory" | "pause" | "dialogue";

const NEST_OFFSET = 24;

export class UIScene extends Phaser.Scene {
  private controller!: GameController;
  private stack: { panel: Panel; tag: Tag }[] = [];
  private toasts!: Toasts;
  private prompt!: Phaser.GameObjects.Container;
  private locked = false;
  private ready = false;

  constructor() {
    super("UIScene");
  }

  create(data: UIData): void {
    this.controller = data.controller;
    this.stack = [];
    this.locked = false;
    this.toasts = new Toasts(this, TOAST_DURATION_MS);

    const g = this.add.graphics();
    drawPanel(g, 0, 0, 20, 24);
    const e = bitmapText(this, 10, 3, "E", { tint: COLORS.highlight }).setOrigin(0.5, 0);
    this.prompt = this.add.container(0, 0, [g, e]).setVisible(false).setDepth(40);

    this.input.keyboard?.on("keydown", (event: KeyboardEvent) => this.onKey(event));
    this.ready = true;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.ready = false;
    });
  }

  isReady(): boolean {
    return this.ready;
  }

  /** True while any dialogue, menu, inventory, pause, or pending ending blocks world input. */
  isModal(): boolean {
    return this.stack.length > 0 || this.locked;
  }

  /** Screen position (UI camera, zoom 1) of the bottom-center of the prompt, or null to hide it. */
  setPrompt(position: { x: number; y: number } | null): void {
    if (!position || this.isModal()) {
      this.prompt.setVisible(false);
      return;
    }
    this.prompt.setPosition(Math.round(position.x - 10), Math.round(position.y - 26)).setVisible(true);
  }

  // ---- Input routing ----

  private onKey(event: KeyboardEvent): void {
    const key = toUIKey(event);
    if (!key || !this.ready) return;
    const top = this.stack[this.stack.length - 1];
    if (top) {
      if (key === "inventory" && this.stack[0]?.tag === "inventory") {
        if (!event.repeat) this.closeAll();
        return;
      }
      top.panel.handleKey(key, event.repeat);
      return;
    }
    if (this.locked || event.repeat) return;
    if (key === "confirm") {
      const target = this.controller.currentTarget();
      if (target) this.openVerbMenu(target);
    } else if (key === "inventory") {
      this.openInventory();
    } else if (key === "cancel") {
      this.openPause();
    }
  }

  private push(panel: Panel, tag: Tag): void {
    this.stack.push({ panel, tag });
    this.prompt.setVisible(false);
  }

  private pop(): void {
    this.stack.pop()?.panel.destroy();
  }

  private closeAll(): void {
    while (this.stack.length > 0) this.pop();
  }

  private nestedPosition(): { x?: number; y?: number } {
    const parent = this.stack[this.stack.length - 1]?.panel;
    if (parent instanceof MenuPanel) return { x: parent.bounds.x + NEST_OFFSET, y: parent.bounds.y + NEST_OFFSET };
    return {};
  }

  private itemOption(item: ItemDefinition): MenuOption {
    return { label: item.display_name, icon: ICON_CATEGORIES.indexOf(item.icon_category) };
  }

  // ---- World interaction ----

  private openVerbMenu(target: Target): void {
    const held = heldItems(this.controller.world, this.controller.getState());
    const verbs: Action[] = target.kind === "npc" ? ["TALK", "INSPECT"] : ["INSPECT"];
    if (held.length > 0) verbs.push("USE");
    const menu = new MenuPanel(this, {
      title: target.name,
      options: verbs.map((v) => ({ label: v })),
      onSelect: (i) => {
        const verb = verbs[i];
        if (verb === "USE") {
          this.openItemPicker(`Use what on ${target.name}?`, held, (item) =>
            this.run({ action: "USE", target1: item.item_id, target2: target.id }),
          );
        } else if (verb) {
          this.run({ action: verb, target1: target.id, target2: null });
        }
      },
      onCancel: () => this.pop(),
    });
    this.push(menu, "world");
  }

  private openItemPicker(title: string, items: ItemDefinition[], onPick: (item: ItemDefinition) => void): void {
    const tag = this.stack[this.stack.length - 1]?.tag ?? "world";
    const menu = new MenuPanel(this, {
      title,
      options: items.map((item) => this.itemOption(item)),
      ...this.nestedPosition(),
      onSelect: (i) => {
        const item = items[i];
        if (item) onPick(item);
      },
      onCancel: () => this.pop(),
    });
    this.push(menu, tag);
  }

  // ---- Inventory ----

  private openInventory(): void {
    const items = heldItems(this.controller.world, this.controller.getState());
    const menu = new MenuPanel(this, {
      title: "Inventory",
      options: items.map((item) => this.itemOption(item)),
      emptyText: "Your pockets are empty.",
      x: 16,
      y: 40,
      onSelect: (i) => {
        const item = items[i];
        if (item) this.openItemActions(item, items);
      },
      onCancel: () => this.pop(),
    });
    this.push(menu, "inventory");
  }

  private openItemActions(item: ItemDefinition, items: ItemDefinition[]): void {
    const actions: ("INSPECT" | "COMBINE" | "Cancel")[] = ["INSPECT"];
    if (items.length >= 2) actions.push("COMBINE");
    actions.push("Cancel");
    const menu = new MenuPanel(this, {
      title: item.display_name,
      options: actions.map((a) => ({ label: a })),
      ...this.nestedPosition(),
      onSelect: (i) => {
        const action = actions[i];
        if (action === "INSPECT") this.run({ action: "INSPECT", target1: item.item_id, target2: null });
        else if (action === "COMBINE") {
          const others = items.filter((other) => other.item_id !== item.item_id);
          this.openItemPicker(`Combine ${item.display_name} with...`, others, (other) =>
            this.run({ action: "COMBINE", target1: item.item_id, target2: other.item_id }),
          );
        } else this.pop();
      },
      onCancel: () => this.pop(),
    });
    this.push(menu, "inventory");
  }

  // ---- Pause ----

  private openPause(): void {
    const options = ["Resume", "Briefing", "Restart"];
    const menu = new MenuPanel(this, {
      title: "Paused",
      options: options.map((label) => ({ label })),
      onSelect: (i) => {
        if (i === 0) this.pop();
        else if (i === 1) {
          const scenario = this.controller.world.scenario;
          this.push(new TextPanel(this, scenario.scenario_title, scenario.intro_text, () => this.pop()), "pause");
        } else window.location.reload();
      },
      onCancel: () => this.pop(),
    });
    this.push(menu, "pause");
  }

  // ---- Results ----

  private run(input: InteractionInput): void {
    this.closeAll();
    const result = this.controller.interact(input);
    if (result.committed) {
      for (const notice of result.notices) {
        this.toasts.show(notice.kind === "received" ? `Received: ${notice.name}` : `Lost: ${notice.name}`,
          notice.kind === "received" ? COLORS.win : COLORS.notice);
      }
    }
    const ending = result.ending;
    if (ending) this.locked = true;
    const finish = () => {
      if (ending) this.controller.end(ending);
    };
    if (result.pages.length > 0) {
      this.push(
        new DialogueBox(this, result.pages, () => {
          this.pop();
          finish();
        }),
        "dialogue",
      );
    } else {
      finish();
    }
  }
}
