import { ID_PATTERN, MAP_LIMITS } from "../config";
import { entityBodyRect, playerBodyRect, rectsOverlap } from "./geometry";
import type { Anchor, Fixture, ParsedMap, Point, Rect, TilesetInfo } from "./types";

export const REQUIRED_TILE_LAYERS = ["floor", "walls", "furniture", "borders"] as const;
export const OBJECT_LAYER = "objects";

const GID_MASK = 0x0fffffff;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Last segment of a Tiled image path, e.g. `../tilesets/interior.png` -> `interior.png`. */
export function imageFileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

function readProperties(obj: Json): Map<string, unknown> {
  const props = new Map<string, unknown>();
  if (Array.isArray(obj.properties)) {
    for (const p of obj.properties) {
      if (isObject(p) && typeof p.name === "string") props.set(p.name, p.value);
    }
  }
  return props;
}

function objectClass(obj: Json): string {
  if (typeof obj.type === "string" && obj.type !== "") return obj.type;
  if (typeof obj.class === "string") return obj.class;
  return "";
}

export interface MapParseResult {
  map: ParsedMap | null;
  errors: string[];
}

/** Parses and validates a Tiled JSON map (Section 4). Returns the map only when there are no errors. */
export function parseMap(json: unknown): MapParseResult {
  const errors: string[] = [];
  if (!isObject(json)) return { map: null, errors: ["map.json is not a JSON object."] };

  if (json.orientation !== "orthogonal") errors.push("The map must be orthogonal.");
  if (json.infinite === true) errors.push("The map must not be infinite.");
  const width = num(json.width);
  const height = num(json.height);
  const tileWidth = num(json.tilewidth);
  const tileHeight = num(json.tileheight);
  if (tileWidth !== 16 || tileHeight !== 16) errors.push("Map tiles must be 16x16 px.");
  if (width === null || height === null || width <= 0 || height <= 0) {
    errors.push("The map has no valid width/height.");
    return { map: null, errors };
  }

  // ---- Tilesets ----
  const tilesets: TilesetInfo[] = [];
  const collidingGids = new Set<number>();
  const rawTilesets = Array.isArray(json.tilesets) ? json.tilesets : [];
  if (rawTilesets.length === 0) errors.push("The map has no tilesets.");
  for (const [i, ts] of rawTilesets.entries()) {
    if (!isObject(ts)) {
      errors.push(`Tileset #${i} is not an object.`);
      continue;
    }
    if (typeof ts.source === "string") {
      errors.push(`Tileset "${ts.source}" is external; tilesets must be embedded in the map.`);
      continue;
    }
    const name = typeof ts.name === "string" ? ts.name : "";
    const image = typeof ts.image === "string" ? ts.image : "";
    const firstgid = num(ts.firstgid);
    const columns = num(ts.columns);
    const tilecount = num(ts.tilecount);
    const imageWidth = num(ts.imagewidth);
    const imageHeight = num(ts.imageheight);
    const tw = num(ts.tilewidth);
    const th = num(ts.tileheight);
    if (!name || !image || firstgid === null || columns === null || tilecount === null ||
        imageWidth === null || imageHeight === null || tw === null || th === null) {
      errors.push(`Tileset #${i} ("${name}") must be a single-image tileset with name, image, and sizes.`);
      continue;
    }
    if ((num(ts.margin) ?? 0) !== 0 || (num(ts.spacing) ?? 0) !== 0) {
      errors.push(`Tileset "${name}" must have zero margin and spacing.`);
    }
    tilesets.push({
      name,
      imageFile: imageFileName(image),
      firstgid,
      columns,
      tilecount,
      tileWidth: tw,
      tileHeight: th,
      imageWidth,
      imageHeight,
    });
    if (Array.isArray(ts.tiles)) {
      for (const tile of ts.tiles) {
        if (!isObject(tile)) continue;
        const id = num(tile.id);
        if (id !== null && readProperties(tile).get("collides") === true) collidingGids.add(firstgid + id);
      }
    }
  }
  const names = new Set<string>();
  for (const ts of tilesets) {
    if (names.has(ts.name)) errors.push(`Duplicate tileset name "${ts.name}".`);
    names.add(ts.name);
  }

  // ---- Layers ----
  const layers = Array.isArray(json.layers) ? json.layers.filter(isObject) : [];
  const tileLayers = layers.filter((l) => l.type === "tilelayer");
  const tileLayerNames = tileLayers.map((l) => String(l.name));
  for (const required of REQUIRED_TILE_LAYERS) {
    if (!tileLayerNames.includes(required)) errors.push(`Missing tile layer "${required}".`);
  }
  for (const extra of tileLayerNames) {
    if (!(REQUIRED_TILE_LAYERS as readonly string[]).includes(extra)) {
      errors.push(`Unexpected tile layer "${extra}"; the map must have exactly floor, walls, furniture, and borders.`);
    }
  }
  const objectLayer = layers.find((l) => l.type === "objectgroup" && l.name === OBJECT_LAYER);
  if (!objectLayer) errors.push(`Missing object layer "${OBJECT_LAYER}".`);

  const collides: boolean[] = new Array<boolean>(width * height).fill(false);
  for (const layer of tileLayers) {
    const name = String(layer.name);
    if (layer.encoding !== undefined && layer.encoding !== "csv") {
      errors.push(`Tile layer "${name}" must use CSV (array) encoding.`);
      continue;
    }
    if (!Array.isArray(layer.data) || layer.data.length !== width * height) {
      errors.push(`Tile layer "${name}" has no tile data of the map's size.`);
      continue;
    }
    if ((num(layer.offsetx) ?? 0) !== 0 || (num(layer.offsety) ?? 0) !== 0) {
      errors.push(`Tile layer "${name}" must not have an offset.`);
    }
    layer.data.forEach((raw, index) => {
      const gid = (num(raw) ?? 0) & GID_MASK;
      if (gid !== 0 && collidingGids.has(gid)) collides[index] = true;
    });
  }

  // ---- Objects ----
  const anchors: Anchor[] = [];
  const fixtures: Fixture[] = [];
  const starts: Point[] = [];
  const seenIds = new Map<string, string>();
  const objects = objectLayer && Array.isArray(objectLayer.objects) ? objectLayer.objects.filter(isObject) : [];

  const requireText = (
    props: Map<string, unknown>,
    key: string,
    max: number,
    where: string,
    optional = false,
  ): string | null => {
    const value = props.get(key);
    if (value === undefined && optional) return null;
    if (typeof value !== "string" || value.trim() === "") {
      errors.push(`${where}: property "${key}" is ${optional ? "empty" : "missing or empty"}.`);
      return null;
    }
    if (value.length > max) errors.push(`${where}: property "${key}" is longer than ${max} characters.`);
    return value;
  };

  for (const obj of objects) {
    const cls = objectClass(obj);
    const where = `Object #${String(obj.id)} (${cls || "no class"})`;
    if (obj.gid !== undefined) {
      errors.push(`${where}: tile objects are not allowed; use a point object.`);
      continue;
    }
    if (obj.ellipse === true || obj.polygon !== undefined || obj.polyline !== undefined || obj.text !== undefined) {
      errors.push(`${where}: must be a point or rectangle object.`);
      continue;
    }
    const x = num(obj.x);
    const y = num(obj.y);
    if (x === null || y === null) {
      errors.push(`${where}: has no position.`);
      continue;
    }
    const w = obj.point === true ? 0 : (num(obj.width) ?? 0);
    const h = obj.point === true ? 0 : (num(obj.height) ?? 0);
    const pos: Point = { x: x + w / 2, y: y + h / 2 };
    const props = readProperties(obj);

    const readId = (): string | null => {
      const id = requireText(props, "id", 40, where);
      if (id === null) return null;
      if (!ID_PATTERN.test(id)) errors.push(`${where}: id "${id}" must match ${ID_PATTERN.source}.`);
      const previous = seenIds.get(id);
      if (previous) errors.push(`${where}: id "${id}" is already used by ${previous}.`);
      seenIds.set(id, where);
      return id;
    };

    if (cls === "anchor") {
      const id = readId();
      const label = requireText(props, "label", MAP_LIMITS.anchorLabelMax, where);
      if (id !== null && label !== null) anchors.push({ id, label, ...pos });
    } else if (cls === "fixture") {
      const id = readId();
      const displayName = requireText(props, "display_name", MAP_LIMITS.fixtureNameMax, where);
      const inspectText = requireText(props, "inspect_text", MAP_LIMITS.fixtureInspectMax, where, true);
      if (id !== null && displayName !== null) fixtures.push({ id, displayName, inspectText, ...pos });
    } else if (cls === "player_start") {
      starts.push(pos);
    } else {
      errors.push(`${where}: class must be anchor, fixture, or player_start.`);
    }
  }

  if (objectLayer) {
    if (starts.length !== 1) errors.push(`The map must have exactly one player_start (found ${starts.length}).`);
    if (anchors.length < MAP_LIMITS.minAnchors) {
      errors.push(`The map must have at least ${MAP_LIMITS.minAnchors} anchors (found ${anchors.length}).`);
    }
  }

  // ---- Body overlaps ----
  const overlapsCollidingTile = (rect: Rect): boolean => {
    const x0 = Math.floor(rect.x / 16);
    const x1 = Math.ceil((rect.x + rect.width) / 16) - 1;
    const y0 = Math.floor(rect.y / 16);
    const y1 = Math.ceil((rect.y + rect.height) / 16) - 1;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
        if (collides[ty * width + tx]) return true;
      }
    }
    return false;
  };

  const anchorRects = anchors.map((a) => ({ id: a.id, rect: entityBodyRect(a) }));
  const fixtureRects = fixtures.map((f) => ({ id: f.id, rect: entityBodyRect(f) }));
  for (const [i, a] of anchorRects.entries()) {
    if (overlapsCollidingTile(a.rect)) errors.push(`Anchor "${a.id}": NPC body overlaps a colliding tile.`);
    for (const f of fixtureRects) {
      if (rectsOverlap(a.rect, f.rect)) errors.push(`Anchor "${a.id}": NPC body overlaps fixture "${f.id}".`);
    }
    for (const b of anchorRects.slice(i + 1)) {
      if (rectsOverlap(a.rect, b.rect)) errors.push(`Anchor "${a.id}": NPC body overlaps anchor "${b.id}".`);
    }
  }
  const start = starts[0];
  if (start && starts.length === 1) {
    const body = playerBodyRect(start);
    if (overlapsCollidingTile(body)) errors.push("player_start: player body overlaps a colliding tile.");
    for (const f of fixtureRects) {
      if (rectsOverlap(body, f.rect)) errors.push(`player_start: player body overlaps fixture "${f.id}".`);
    }
    for (const a of anchorRects) {
      if (rectsOverlap(body, a.rect)) errors.push(`player_start: player body overlaps anchor "${a.id}".`);
    }
  }

  if (errors.length > 0 || !start) return { map: null, errors };
  return {
    map: {
      width,
      height,
      tileWidth: 16,
      tileHeight: 16,
      tileLayers: tileLayerNames,
      anchors,
      fixtures,
      playerStart: start,
      collides,
      tilesets,
    },
    errors,
  };
}
