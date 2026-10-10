import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH } from "./config";
import { BootScene } from "./scenes/BootScene";
import { EndScene } from "./scenes/EndScene";
import { GameScene } from "./scenes/GameScene";
import { IntroScene } from "./scenes/IntroScene";
import { KeyEntryScene } from "./scenes/KeyEntryScene";
import { LoadingScene } from "./scenes/LoadingScene";
import { UIScene } from "./scenes/UIScene";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: "#111018",
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: "arcade",
    arcade: { debug: false },
  },
  scene: [BootScene, KeyEntryScene, LoadingScene, IntroScene, GameScene, UIScene, EndScene],
});

if (import.meta.env.DEV) {
  // Debug handle for development only; production builds drop this branch.
  (window as unknown as { __unscripted: Phaser.Game }).__unscripted = game;
}
