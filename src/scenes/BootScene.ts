import Phaser from "phaser";
import {
  CHAR_FRAME_HEIGHT,
  CHAR_FRAME_WIDTH,
  DIRECTION_OFFSETS,
  FONT_KEY,
  FRAMES_PER_DIRECTION,
  IDLE_FRAME_RATE,
  MAX_TILESET_TEXTURE_HEIGHT,
  NPC_FRAME,
  NPC_VARIANT_COUNT,
  PLAYER_IDLE_ROW_Y,
  PLAYER_WALK_ROW_Y,
  WALK_FRAME_RATE,
  type Facing,
} from "../config";
import { validateCharacterAssets, type ImageSize } from "../map/assets";
import { parseMap } from "../map/parseMap";
import { splitTallTilesets, type TextureSlice } from "../map/tilesets";
import { DEFAULT_SCENARIO_FILES } from "../scenario/genre";
import { GENRES, type Genre, type Scenario } from "../scenario/schema";
import { validateScenario } from "../scenario/validator";
import { setBootData } from "../session";
import { showBootError } from "../ui/dom";

export const MAP_CACHE_KEY = "map";
const MAP_JSON_KEY = "map_json";
const NPCS_JSON_KEY = "npcs_json";
export const ICONS_KEY = "icons";
export const PLAYER_KEY = "player";
export const NPC_FRAME_NAME = "idle_down";

export function npcTextureKey(spriteIndex: number): string {
  return `npc${spriteIndex + 1}`;
}

export function playerAnimKey(kind: "idle" | "walk", facing: Facing): string {
  return `player_${kind}_${facing}`;
}

const scenarioKey = (genre: Genre) => `scenario_${genre}`;

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}

export class BootScene extends Phaser.Scene {
  private failedKeys = new Set<string>();

  constructor() {
    super("BootScene");
  }

  preload(): void {
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => this.failedKeys.add(file.key));
    this.load.json(MAP_JSON_KEY, "assets/maps/map.json");
  }

  create(): void {
    void this.boot().catch((error: unknown) => {
      showBootError([error instanceof Error ? error.message : String(error)]);
    });
  }

  private async boot(): Promise<void> {
    const mapJson = this.cache.json.get(MAP_JSON_KEY) as unknown;
    if (this.failedKeys.has(MAP_JSON_KEY) || mapJson === undefined) {
      showBootError(["assets/maps/map.json is missing or is not valid JSON."]);
      return;
    }
    const parsed = parseMap(mapJson);
    if (!parsed.map) {
      showBootError(parsed.errors);
      return;
    }
    const map = parsed.map;
    const errors: string[] = [];

    // Phase 2: tileset images (sliced to fit GPU texture limits), sprites, font, scenarios.
    const split = splitTallTilesets(mapJson as Record<string, unknown>, MAX_TILESET_TEXTURE_HEIGHT);
    const tilesetPromise = this.loadTilesetSlices(split.slices, errors);

    this.load.image(PLAYER_KEY, "assets/sprites/player.png");
    for (let i = 0; i < NPC_VARIANT_COUNT; i++) this.load.image(npcTextureKey(i), `assets/sprites/npc${i + 1}.png`);
    this.load.json(NPCS_JSON_KEY, "assets/sprites/npcs.json");
    this.load.spritesheet(ICONS_KEY, "assets/sprites/icons.png", { frameWidth: 16, frameHeight: 16 });
    this.load.bitmapFont(FONT_KEY, "assets/fonts/gridwright_5x7_regular.png", "assets/fonts/gridwright_5x7_regular.xml");
    for (const genre of GENRES) this.load.json(scenarioKey(genre), `assets/scenarios/${DEFAULT_SCENARIO_FILES[genre]}`);
    await new Promise<void>((resolve) => {
      this.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
      this.load.start();
    });
    await tilesetPromise;

    const sizeOf = (key: string): ImageSize | null => {
      if (this.failedKeys.has(key) || !this.textures.exists(key)) return null;
      const source = this.textures.get(key).getSourceImage();
      return { width: source.width, height: source.height };
    };
    const npcsJson = this.failedKeys.has(NPCS_JSON_KEY) ? undefined : (this.cache.json.get(NPCS_JSON_KEY) as unknown);
    const characters = validateCharacterAssets(
      sizeOf(PLAYER_KEY),
      Array.from({ length: NPC_VARIANT_COUNT }, (_, i) => sizeOf(npcTextureKey(i))),
      npcsJson,
    );
    errors.push(...characters.errors);
    if (this.failedKeys.has(ICONS_KEY) || !this.textures.exists(ICONS_KEY)) errors.push("sprites/icons.png is missing.");
    else if (this.textures.get(ICONS_KEY).frameTotal < 6) errors.push("sprites/icons.png must contain 5 frames of 16x16.");
    if (!this.cache.bitmapFont.exists(FONT_KEY)) errors.push("The bitmap font in assets/fonts failed to load.");

    const defaults: Partial<Record<Genre, Scenario>> = {};
    for (const genre of GENRES) {
      const file = DEFAULT_SCENARIO_FILES[genre];
      const raw = this.failedKeys.has(scenarioKey(genre)) ? undefined : (this.cache.json.get(scenarioKey(genre)) as unknown);
      if (raw === undefined) {
        errors.push(`scenarios/${file} is missing or is not valid JSON.`);
        continue;
      }
      const result = validateScenario(raw, {
        anchors: map.anchors,
        fixtures: map.fixtures,
        npcVariantCount: NPC_VARIANT_COUNT,
        requestedGenre: genre,
      });
      if (result.ok) defaults[genre] = result.scenario;
      else errors.push(...result.errors.map((e) => `scenarios/${file}: ${e}`));
    }

    if (errors.length > 0) {
      showBootError(errors);
      return;
    }

    this.registerCharacterFrames();
    this.cache.tilemap.add(MAP_CACHE_KEY, { format: Phaser.Tilemaps.Formats.TILED_JSON, data: split.mapJson });
    setBootData({
      map,
      npcDescriptions: characters.npcDescriptions,
      defaults: defaults as Record<Genre, Scenario>,
      tilesetKeys: split.slices.map((s) => s.key),
    });
    this.scene.start("KeyEntryScene");
  }

  /** Loads each tileset image once and copies row bands into canvas textures keyed by tileset name. */
  private async loadTilesetSlices(slices: TextureSlice[], errors: string[]): Promise<void> {
    const files = [...new Set(slices.map((s) => s.imageFile))];
    const images = new Map<string, HTMLImageElement>();
    await Promise.all(
      files.map(async (file) => {
        try {
          images.set(file, await loadHtmlImage(`assets/tilesets/${file}`));
        } catch {
          errors.push(`tilesets/${file} is missing.`);
        }
      }),
    );
    for (const slice of slices) {
      const img = images.get(slice.imageFile);
      if (!img) continue;
      const texture = this.textures.createCanvas(slice.key, slice.width, slice.height);
      if (!texture) {
        errors.push(`Could not create a texture for tileset "${slice.key}".`);
        continue;
      }
      texture.context.imageSmoothingEnabled = false;
      texture.context.drawImage(img, 0, slice.sourceY, slice.width, slice.height, 0, 0, slice.width, slice.height);
      texture.refresh();
    }
  }

  private registerCharacterFrames(): void {
    const player = this.textures.get(PLAYER_KEY);
    for (const facing of Object.keys(DIRECTION_OFFSETS) as Facing[]) {
      for (const [kind, rowY, rate] of [
        ["idle", PLAYER_IDLE_ROW_Y, IDLE_FRAME_RATE],
        ["walk", PLAYER_WALK_ROW_Y, WALK_FRAME_RATE],
      ] as const) {
        const frames: Phaser.Types.Animations.AnimationFrame[] = [];
        for (let i = 0; i < FRAMES_PER_DIRECTION; i++) {
          const name = `${kind}_${facing}_${i}`;
          player.add(name, 0, (DIRECTION_OFFSETS[facing] + i) * CHAR_FRAME_WIDTH, rowY, CHAR_FRAME_WIDTH, CHAR_FRAME_HEIGHT);
          frames.push({ key: PLAYER_KEY, frame: name });
        }
        this.anims.create({ key: playerAnimKey(kind, facing), frames, frameRate: rate, repeat: -1 });
      }
    }
    for (let i = 0; i < NPC_VARIANT_COUNT; i++) {
      this.textures.get(npcTextureKey(i)).add(NPC_FRAME_NAME, 0, NPC_FRAME.x, NPC_FRAME.y, NPC_FRAME.width, NPC_FRAME.height);
    }
  }
}
