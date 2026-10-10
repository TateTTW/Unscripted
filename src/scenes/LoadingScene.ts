import Phaser from "phaser";
import { GAME_WIDTH, NPC_VARIANT_COUNT } from "../config";
import { createOpenAIClient } from "../scenario/openaiClient";
import { FAILURE_REASONS, fallbackNotice, runScenarioPipeline, type PipelinePhase } from "../scenario/pipeline";
import { GENRE_LABELS } from "../scenario/genre";
import { getBootData, getOrPickGenre } from "../session";
import { bitmapText, COLORS, setFontText } from "../ui/bitmap";
import { createOverlay, el } from "../ui/dom";
import type { IntroData } from "./IntroScene";
import type { KeyEntryData } from "./KeyEntryScene";

export interface LoadingData {
  apiKey: string;
}

const PROGRESS_TEXT: Record<PipelinePhase, string> = {
  generating: "Writing your scenario\u2026",
  repairing: "Fixing a few problems\u2026",
};

export class LoadingScene extends Phaser.Scene {
  private overlay: HTMLDivElement | null = null;
  private finished = false;

  constructor() {
    super("LoadingScene");
  }

  create(data: LoadingData): void {
    // Take the key out of the scene's stored data so only the pipeline holds it.
    const apiKey = data.apiKey;
    data.apiKey = "";
    this.finished = false;

    const boot = getBootData();
    const genre = getOrPickGenre();
    this.cameras.main.setBackgroundColor("#111018");
    bitmapText(this, GAME_WIDTH / 2, 110, GENRE_LABELS[genre].toUpperCase(), { scale: 2, tint: COLORS.highlight }).setOrigin(0.5, 0);
    const progress = bitmapText(this, GAME_WIDTH / 2, 170, PROGRESS_TEXT.generating).setOrigin(0.5, 0);
    let dots = 0;
    const status = bitmapText(this, GAME_WIDTH / 2, 196, "", { tint: COLORS.dim }).setOrigin(0.5, 0);
    this.time.addEvent({
      delay: 400,
      loop: true,
      callback: () => {
        dots = (dots + 1) % 4;
        setFontText(status, ".".repeat(dots));
      },
    });

    const controller = new AbortController();
    this.overlay = createOverlay("bottom");
    const cancel = el("button", { text: "Use built-in scenario" });
    cancel.type = "button";
    this.overlay.appendChild(cancel);
    cancel.addEventListener("click", () => {
      if (this.finished) return;
      controller.abort();
      this.finish({ scenario: boot.defaults[genre], notice: null });
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.overlay?.remove();
      this.overlay = null;
    });

    const warn = import.meta.env.DEV
      ? (message: string, details?: unknown) => console.warn(`[Unscripted] ${message}`, details ?? "")
      : undefined;

    void runScenarioPipeline({
      apiKey,
      genre,
      prompt: { anchors: boot.map.anchors, fixtures: boot.map.fixtures, npcDescriptions: boot.npcDescriptions },
      validation: { anchors: boot.map.anchors, fixtures: boot.map.fixtures, npcVariantCount: NPC_VARIANT_COUNT },
      defaultScenario: boot.defaults[genre],
      clientFactory: createOpenAIClient,
      signal: controller.signal,
      onProgress: (phase) => {
        if (!this.finished) setFontText(progress, PROGRESS_TEXT[phase]);
      },
      warn,
    })
      .then((outcome) => {
        if (this.finished) return;
        if (outcome.kind === "rejected") {
          this.finished = true;
          const keyData: KeyEntryData = { error: "API key was rejected." };
          this.scene.start("KeyEntryScene", keyData);
          return;
        }
        this.finish({ scenario: outcome.scenario, notice: outcome.notice });
      })
      .catch((error: unknown) => {
        if (import.meta.env.DEV) console.warn("[Unscripted] Pipeline crashed", error);
        if (!this.finished) {
          this.finish({ scenario: boot.defaults[genre], notice: fallbackNotice(FAILURE_REASONS.invalid) });
        }
      });
  }

  private finish(intro: IntroData): void {
    this.finished = true;
    this.overlay?.remove();
    this.overlay = null;
    this.scene.start("IntroScene", intro);
  }
}
