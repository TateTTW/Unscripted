import Phaser from "phaser";
import { GAME_WIDTH } from "../config";
import { getBootData, getOrPickGenre } from "../session";
import { bitmapText, COLORS } from "../ui/bitmap";
import { createOverlay, el } from "../ui/dom";
import type { IntroData } from "./IntroScene";
import type { LoadingData } from "./LoadingScene";

export interface KeyEntryData {
  error?: string;
}

export class KeyEntryScene extends Phaser.Scene {
  private overlay: HTMLDivElement | null = null;

  constructor() {
    super("KeyEntryScene");
  }

  create(data: KeyEntryData): void {
    this.cameras.main.setBackgroundColor("#111018");
    bitmapText(this, GAME_WIDTH / 2, 10, "UNSCRIPTED", { scale: 2, tint: COLORS.highlight }).setOrigin(0.5, 0);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.removeForm());
    this.showForm(data?.error);
  }

  private showForm(error?: string): void {
    const overlay = createOverlay();
    this.overlay = overlay;
    const form = el("form", { className: "key-form" });
    form.autocomplete = "off";
    form.appendChild(el("h1", { text: "Unscripted" }));
    form.appendChild(
      el("p", {
        text: "Enter an OpenAI API key to generate a brand-new scenario, or play a built-in one. The key is kept in memory only and is never stored.",
      }),
    );
    const input = el("input");
    input.type = "password";
    input.autocomplete = "off";
    input.placeholder = "sk-...";
    input.setAttribute("aria-label", "OpenAI API key");
    if (import.meta.env.DEV) {
      input.value = import.meta.env.VITE_OPENAI_API_KEY ?? "";
    }
    form.appendChild(input);
    form.appendChild(el("div", { className: "error", text: error ?? "" }));
    const buttons = el("div", { className: "buttons" });
    const builtIn = el("button", { text: "Play built-in scenario" });
    builtIn.type = "button";
    const start = el("button", { text: "Start" });
    start.type = "submit";
    buttons.append(builtIn, start);
    form.appendChild(buttons);
    overlay.appendChild(form);

    builtIn.addEventListener("click", () => {
      input.value = "";
      this.begin("");
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const key = input.value.trim();
      input.value = "";
      this.begin(key);
    });
    input.focus();
  }

  private removeForm(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  private begin(apiKey: string): void {
    this.removeForm();
    const genre = getOrPickGenre();
    if (apiKey === "") {
      const intro: IntroData = { scenario: getBootData().defaults[genre], notice: null };
      this.scene.start("IntroScene", intro);
      return;
    }
    const loading: LoadingData = { apiKey };
    this.scene.start("LoadingScene", loading);
  }
}
