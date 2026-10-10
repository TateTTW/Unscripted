import Phaser from "phaser";
import {
  ENTITY_BODY_SIZE,
  FACING_CONE_DOT,
  INTERACT_RANGE,
  PLAYER_BODY,
  PLAYER_SPEED,
  WORLD_ZOOM,
  type Facing,
} from "../config";
import { resolveInteraction, type Ending, type InteractionResult } from "../engine/interaction";
import { buildWorld, createInitialState, type GameState, type InteractionInput, type World } from "../engine/state";
import type { Scenario } from "../scenario/schema";
import { getBootData } from "../session";
import { MAP_CACHE_KEY, NPC_FRAME_NAME, npcTextureKey, PLAYER_KEY, playerAnimKey } from "./BootScene";
import type { EndData } from "./EndScene";
import type { GameController, Target, UIData, UIScene } from "./UIScene";

export interface GameData {
  scenario: Scenario;
}

interface WorldTarget extends Target {
  x: number;
  y: number;
  /** World Y of the top edge of what is drawn there, for placing the prompt. */
  top: number;
}

const FACING_VECTORS: Record<Facing, { x: number; y: number }> = {
  right: { x: 1, y: 0 },
  left: { x: -1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

export class GameScene extends Phaser.Scene implements GameController {
  world!: World;
  private state!: GameState;
  private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private facing: Facing = "down";
  private targets: WorldTarget[] = [];
  private target: WorldTarget | null = null;
  private ui!: UIScene;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;
  private ended = false;
  private characterDepth = 0;

  constructor() {
    super("GameScene");
  }

  create(data: GameData): void {
    const boot = getBootData();
    this.world = buildWorld(data.scenario, boot.map.fixtures);
    this.state = createInitialState(this.world);
    this.facing = "down";
    this.target = null;
    this.ended = false;

    // ---- Tilemap ----
    const map = this.make.tilemap({ key: MAP_CACHE_KEY });
    const tilesets = boot.tilesetKeys
      .map((key) => map.addTilesetImage(key, key))
      .filter((t): t is Phaser.Tilemaps.Tileset => t !== null);
    const layers: Phaser.Tilemaps.TilemapLayer[] = [];
    boot.map.tileLayers.forEach((name, index) => {
      const layer = map.createLayer(name, tilesets, 0, 0);
      if (!layer) return;
      layer.setDepth(index * 10);
      layer.setCollisionByProperty({ collides: true });
      layers.push(layer);
    });
    // Characters draw above every layer except the top one (borders/trim).
    const characterDepth = (boot.map.tileLayers.length - 1) * 10 - 5;
    this.characterDepth = characterDepth;

    const worldWidth = map.widthInPixels;
    const worldHeight = map.heightInPixels;
    this.physics.world.setBounds(0, 0, worldWidth, worldHeight);

    // ---- Static bodies: NPCs and fixtures ----
    const statics = this.physics.add.staticGroup();
    const addBody = (x: number, y: number) => {
      const zone = this.add.zone(x, y, ENTITY_BODY_SIZE, ENTITY_BODY_SIZE);
      statics.add(zone);
    };
    this.targets = [];
    const anchors = new Map(boot.map.anchors.map((a) => [a.id, a]));
    for (const npc of data.scenario.npc_spawns) {
      const anchor = anchors.get(npc.placed_at);
      if (!anchor) continue;
      this.add
        .image(anchor.x, anchor.y, npcTextureKey(npc.sprite_index), NPC_FRAME_NAME)
        .setDepth(characterDepth + anchor.y / 100000);
      addBody(anchor.x, anchor.y);
      this.targets.push({ id: npc.entity_id, kind: "npc", name: npc.display_name, x: anchor.x, y: anchor.y, top: anchor.y - 16 });
    }
    for (const fixture of boot.map.fixtures) {
      addBody(fixture.x, fixture.y);
      this.targets.push({ id: fixture.id, kind: "fixture", name: fixture.displayName, x: fixture.x, y: fixture.y, top: fixture.y - 8 });
    }

    // ---- Player ----
    const start = boot.map.playerStart;
    this.player = this.physics.add.sprite(start.x, start.y, PLAYER_KEY, "idle_down_0");
    this.player.body.setSize(PLAYER_BODY.width, PLAYER_BODY.height, false);
    this.player.body.setOffset(PLAYER_BODY.offsetX, PLAYER_BODY.offsetY);
    this.player.setCollideWorldBounds(true);
    this.player.play(playerAnimKey("idle", "down"));
    for (const layer of layers) this.physics.add.collider(this.player, layer);
    this.physics.add.collider(this.player, statics);

    // ---- Camera ----
    const camera = this.cameras.main;
    camera.setBounds(0, 0, worldWidth, worldHeight);
    camera.setZoom(WORLD_ZOOM);
    camera.startFollow(this.player, true);
    camera.setBackgroundColor("#000000");

    // ---- Input ----
    const keyboard = this.input.keyboard!;
    this.cursors = keyboard.createCursorKeys();
    this.wasd = keyboard.addKeys("W,A,S,D") as Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;

    const uiData: UIData = { controller: this };
    this.scene.launch("UIScene", uiData);
    this.ui = this.scene.get("UIScene") as UIScene;
  }

  update(): void {
    this.player.setDepth(this.characterDepth + this.player.y / 100000);
    if (this.ended || !this.ui.isReady() || this.ui.isModal()) {
      this.player.setVelocity(0, 0);
      this.player.play(playerAnimKey("idle", this.facing), true);
      if (this.ui.isReady()) this.ui.setPrompt(null);
      return;
    }

    const left = this.cursors.left.isDown || this.wasd.A.isDown;
    const right = this.cursors.right.isDown || this.wasd.D.isDown;
    const up = this.cursors.up.isDown || this.wasd.W.isDown;
    const down = this.cursors.down.isDown || this.wasd.S.isDown;
    const dx = (right ? 1 : 0) - (left ? 1 : 0);
    const dy = (down ? 1 : 0) - (up ? 1 : 0);
    if (dx !== 0 || dy !== 0) {
      const length = Math.hypot(dx, dy);
      this.player.setVelocity((dx / length) * PLAYER_SPEED, (dy / length) * PLAYER_SPEED);
      this.facing = dx !== 0 ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
      this.player.play(playerAnimKey("walk", this.facing), true);
    } else {
      this.player.setVelocity(0, 0);
      this.player.play(playerAnimKey("idle", this.facing), true);
    }

    this.target = this.findTarget();
    if (this.target) {
      const view = this.cameras.main.worldView;
      this.ui.setPrompt({
        x: (this.target.x - view.x) * WORLD_ZOOM,
        y: (this.target.top - 2 - view.y) * WORLD_ZOOM,
      });
    } else {
      this.ui.setPrompt(null);
    }
  }

  /** Nearest NPC or fixture within range and inside the facing cone, measured from the feet body. */
  private findTarget(): WorldTarget | null {
    const center = this.player.body.center;
    const facing = FACING_VECTORS[this.facing];
    let best: WorldTarget | null = null;
    let bestDistance = Infinity;
    for (const target of this.targets) {
      const dx = target.x - center.x;
      const dy = target.y - center.y;
      const distance = Math.hypot(dx, dy);
      if (distance > INTERACT_RANGE || distance === 0) continue;
      if ((facing.x * dx + facing.y * dy) / distance <= FACING_CONE_DOT) continue;
      if (distance < bestDistance) {
        best = target;
        bestDistance = distance;
      }
    }
    return best;
  }

  // ---- GameController ----

  getState(): GameState {
    return this.state;
  }

  currentTarget(): Target | null {
    return this.target;
  }

  interact(input: InteractionInput): InteractionResult {
    const result = resolveInteraction(this.world, this.state, input);
    if (result.committed) this.state = result.state;
    return result;
  }

  end(ending: Ending): void {
    if (this.ended) return;
    this.ended = true;
    this.scene.stop("UIScene");
    const data: EndData = ending;
    this.scene.start("EndScene", data);
  }
}
