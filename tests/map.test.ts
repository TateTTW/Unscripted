import { describe, expect, it } from "vitest";
import { validateCharacterAssets } from "../src/map/assets";
import { parseMap } from "../src/map/parseMap";
import { splitTallTilesets } from "../src/map/tilesets";

type Obj = Record<string, unknown>;

const W = 20;
const H = 20;

function point(id: number, type: string, x: number, y: number, props: Record<string, string> = {}): Obj {
  return {
    id,
    type,
    point: true,
    x,
    y,
    width: 0,
    height: 0,
    properties: Object.entries(props).map(([name, value]) => ({ name, type: "string", value })),
  };
}

function baseObjects(): Obj[] {
  return [
    point(1, "player_start", 160, 160),
    point(2, "anchor", 40, 40, { id: "anchor_a", label: "North-west corner" }),
    point(3, "anchor", 120, 40, { id: "anchor_b", label: "North side" }),
    point(4, "fixture", 40, 120, { id: "desk", display_name: "Desk", inspect_text: "A desk." }),
  ];
}

/** Builds a minimal valid Tiled map. `colliding` lists tile indexes painted with a colliding tile on "borders". */
function makeMap(objects: Obj[] = baseObjects(), colliding: number[] = [], extra: (m: Obj) => void = () => undefined): Obj {
  const layer = (name: string, data: number[]): Obj => ({ name, type: "tilelayer", width: W, height: H, data, x: 0, y: 0 });
  const empty = () => new Array<number>(W * H).fill(0);
  const borders = empty();
  for (const i of colliding) borders[i] = 2;
  const map: Obj = {
    orientation: "orthogonal",
    infinite: false,
    width: W,
    height: H,
    tilewidth: 16,
    tileheight: 16,
    tilesets: [
      {
        firstgid: 1,
        name: "tiles",
        image: "../tilesets/tiles.png",
        columns: 2,
        tilecount: 4,
        tilewidth: 16,
        tileheight: 16,
        imagewidth: 32,
        imageheight: 32,
        margin: 0,
        spacing: 0,
        tiles: [{ id: 1, properties: [{ name: "collides", type: "bool", value: true }] }],
      },
    ],
    layers: [
      layer("floor", empty()),
      layer("walls", empty()),
      { name: "objects", type: "objectgroup", objects },
      layer("furniture", empty()),
      layer("borders", borders),
    ],
  };
  extra(map);
  return map;
}

function errorsOf(map: Obj): string[] {
  return parseMap(map).errors;
}

function expectMapError(map: Obj, fragment: string): void {
  const errors = errorsOf(map);
  expect(errors.some((e) => e.includes(fragment)), `expected "${fragment}" in:\n${errors.join("\n")}`).toBe(true);
}

const tileIndex = (px: number, py: number) => Math.floor(py / 16) * W + Math.floor(px / 16);

describe("map parser", () => {
  it("parses a valid map", () => {
    const result = parseMap(makeMap());
    expect(result.errors).toEqual([]);
    expect(result.map?.anchors.map((a) => a.id)).toEqual(["anchor_a", "anchor_b"]);
    expect(result.map?.fixtures[0]).toMatchObject({ id: "desk", displayName: "Desk", inspectText: "A desk." });
    expect(result.map?.playerStart).toEqual({ x: 160, y: 160 });
    expect(result.map?.tilesets[0]?.imageFile).toBe("tiles.png");
  });

  it("marks colliding tiles from tileset properties on any layer", () => {
    const result = parseMap(makeMap(baseObjects(), [0, 5]));
    expect(result.map?.collides[0]).toBe(true);
    expect(result.map?.collides[5]).toBe(true);
    expect(result.map?.collides[1]).toBe(false);
  });

  it("uses a rectangle's center and reads class from `class` when `type` is absent", () => {
    const objects = baseObjects();
    objects.push({ id: 9, class: "anchor", x: 192, y: 32, width: 16, height: 16, properties: [{ name: "id", value: "rect_anchor" }, { name: "label", value: "Rect" }] });
    const result = parseMap(makeMap(objects));
    expect(result.errors).toEqual([]);
    expect(result.map?.anchors.find((a) => a.id === "rect_anchor")).toMatchObject({ x: 200, y: 40 });
  });

  it("requires the four tile layers and the objects layer", () => {
    expectMapError(makeMap(baseObjects(), [], (m) => (m.layers as Obj[]).splice(4, 1)), 'Missing tile layer "borders"');
    expectMapError(makeMap(baseObjects(), [], (m) => (m.layers as Obj[]).splice(2, 1)), 'Missing object layer "objects"');
    expectMapError(
      makeMap(baseObjects(), [], (m) => (m.layers as Obj[]).push({ name: "extra", type: "tilelayer", width: W, height: H, data: new Array(W * H).fill(0) })),
      'Unexpected tile layer "extra"',
    );
  });

  it("rejects external tilesets", () => {
    expectMapError(makeMap(baseObjects(), [], (m) => (m.tilesets = [{ firstgid: 1, source: "tiles.tsx" }])), "must be embedded");
  });

  it("requires exactly one player_start", () => {
    expectMapError(makeMap(baseObjects().filter((o) => o.type !== "player_start")), "exactly one player_start (found 0)");
    expectMapError(makeMap([...baseObjects(), point(10, "player_start", 200, 200)]), "exactly one player_start (found 2)");
  });

  it("requires at least two anchors", () => {
    expectMapError(makeMap(baseObjects().filter((o) => o.id !== 3)), "at least 2 anchors");
  });

  it("rejects tile objects", () => {
    expectMapError(makeMap([...baseObjects(), { ...point(11, "fixture", 200, 200, { id: "lamp", display_name: "Lamp" }), gid: 3 }]), "tile objects are not allowed");
  });

  it("rejects unknown classes", () => {
    expectMapError(makeMap([...baseObjects(), point(12, "spawn", 200, 200)]), "class must be anchor, fixture, or player_start");
  });

  it("requires properties and enforces text limits", () => {
    expectMapError(makeMap([...baseObjects(), point(13, "anchor", 200, 40, { id: "anchor_c" })]), 'property "label" is missing');
    expectMapError(makeMap([...baseObjects(), point(14, "anchor", 200, 40, { id: "anchor_c", label: "x".repeat(81) })]), 'property "label" is longer than 80');
    expectMapError(makeMap([...baseObjects(), point(15, "fixture", 200, 120, { id: "lamp", display_name: "x".repeat(41) })]), 'property "display_name" is longer than 40');
    expectMapError(makeMap([...baseObjects(), point(16, "fixture", 200, 120, { id: "lamp", display_name: "Lamp", inspect_text: "x".repeat(301) })]), 'property "inspect_text" is longer than 300');
    expectMapError(makeMap([...baseObjects(), point(17, "fixture", 200, 120, { id: "lamp", display_name: "Lamp", inspect_text: "" })]), 'property "inspect_text" is empty');
    expectMapError(makeMap([...baseObjects(), point(18, "fixture", 200, 120, { display_name: "Lamp" })]), 'property "id" is missing');
  });

  it("validates id format and global uniqueness", () => {
    expectMapError(makeMap([...baseObjects(), point(19, "fixture", 200, 120, { id: "Lamp", display_name: "Lamp" })]), 'id "Lamp" must match');
    expectMapError(makeMap([...baseObjects(), point(20, "fixture", 200, 120, { id: "anchor_a", display_name: "Lamp" })]), 'id "anchor_a" is already used');
  });

  it("rejects overlapping bodies but allows touching edges", () => {
    expectMapError(makeMap(baseObjects(), [tileIndex(40, 40)]), 'Anchor "anchor_a": NPC body overlaps a colliding tile');
    expectMapError(makeMap([...baseObjects(), point(21, "fixture", 50, 40, { id: "lamp", display_name: "Lamp" })]), 'Anchor "anchor_a": NPC body overlaps fixture "lamp"');
    expectMapError(makeMap([...baseObjects(), point(22, "anchor", 50, 50, { id: "anchor_c", label: "Close" })]), 'Anchor "anchor_a": NPC body overlaps anchor "anchor_c"');
    // Touching: anchor_a covers x 32..48; an anchor at x=56 covers 48..64.
    expect(errorsOf(makeMap([...baseObjects(), point(23, "anchor", 56, 40, { id: "anchor_c", label: "Touching" })]))).toEqual([]);
  });

  it("checks the player-start feet body (11 px below the sprite center)", () => {
    // Feet body for a sprite at (160,160) spans x 155..165, y 166..176.
    expectMapError(makeMap(baseObjects(), [tileIndex(160, 170)]), "player_start: player body overlaps a colliding tile");
    expect(errorsOf(makeMap(baseObjects(), [tileIndex(160, 150)]))).toEqual([]);
    expectMapError(makeMap([...baseObjects(), point(24, "fixture", 160, 180, { id: "lamp", display_name: "Lamp" })]), 'player_start: player body overlaps fixture "lamp"');
    expectMapError(makeMap([...baseObjects(), point(25, "anchor", 165, 175, { id: "anchor_c", label: "Near" })]), 'player_start: player body overlaps anchor "anchor_c"');
  });
});

describe("character assets", () => {
  const sheet = { width: 896, height: 656 };
  const sheets = () => Array.from({ length: 7 }, () => sheet);
  const descriptions = () => Array.from({ length: 7 }, (_, i) => `NPC ${i}`);

  it("accepts seven sheets and seven descriptions", () => {
    const result = validateCharacterAssets(sheet, sheets(), descriptions());
    expect(result.errors).toEqual([]);
    expect(result.npcDescriptions).toHaveLength(7);
  });

  it("reports missing NPC sheets", () => {
    const s: ({ width: number; height: number } | null)[] = sheets();
    s[3] = null;
    expect(validateCharacterAssets(sheet, s, descriptions()).errors).toContain("sprites/npc4.png is missing.");
  });

  it("reports sheets too small for the required frame", () => {
    const s = sheets();
    s[0] = { width: 200, height: 656 };
    expect(validateCharacterAssets(sheet, s, descriptions()).errors[0]).toMatch(/npc1\.png is 200x656/);
  });

  it("checks the player sheet", () => {
    expect(validateCharacterAssets(null, sheets(), descriptions()).errors).toContain("sprites/player.png is missing.");
    expect(validateCharacterAssets({ width: 300, height: 96 }, sheets(), descriptions()).errors[0]).toMatch(/player\.png/);
  });

  it("requires npcs.json to hold exactly seven valid strings", () => {
    expect(validateCharacterAssets(sheet, sheets(), descriptions().slice(0, 6)).errors[0]).toMatch(/exactly 7 descriptions \(found 6\)/);
    expect(validateCharacterAssets(sheet, sheets(), [...descriptions(), "extra"]).errors[0]).toMatch(/found 8/);
    expect(validateCharacterAssets(sheet, sheets(), { a: 1 }).errors[0]).toMatch(/JSON array/);
    const long = descriptions();
    long[2] = "x".repeat(81);
    expect(validateCharacterAssets(sheet, sheets(), long).errors[0]).toMatch(/entry 2/);
  });
});

describe("tileset splitting", () => {
  it("leaves small tilesets alone and slices tall ones into contiguous GID ranges", () => {
    const map = {
      tilesets: [
        { firstgid: 1, name: "small", image: "../a/small.png", columns: 2, tilecount: 4, tilewidth: 16, tileheight: 16, imagewidth: 32, imageheight: 32 },
        {
          firstgid: 5,
          name: "tall",
          image: "../a/tall.png",
          columns: 4,
          tilecount: 40,
          tilewidth: 16,
          tileheight: 16,
          imagewidth: 64,
          imageheight: 160,
          tiles: [
            { id: 1, properties: [] },
            { id: 17, properties: [] },
          ],
        },
      ],
    };
    const { mapJson, slices } = splitTallTilesets(map, 64);
    expect(slices.map((s) => [s.key, s.sourceY, s.height])).toEqual([
      ["small", 0, 32],
      ["tall", 0, 64],
      ["tall__part2", 64, 64],
      ["tall__part3", 128, 32],
    ]);
    const ts = mapJson.tilesets as Record<string, unknown>[];
    expect(ts.map((t) => [t.name, t.firstgid, t.tilecount])).toEqual([
      ["small", 1, 4],
      ["tall", 5, 16],
      ["tall__part2", 21, 16],
      ["tall__part3", 37, 8],
    ]);
    expect(ts[2]!.tiles).toEqual([{ id: 1, properties: [] }]);
  });
});
