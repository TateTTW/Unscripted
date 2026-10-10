import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NPC_VARIANT_COUNT } from "../src/config";
import { parseMap } from "../src/map/parseMap";
import { DEFAULT_SCENARIO_FILES } from "../src/scenario/genre";
import { GENRES } from "../src/scenario/schema";
import { validateScenario } from "../src/scenario/validator";

const mapResult = parseMap(JSON.parse(readFileSync("public/assets/maps/map.json", "utf8")));

describe("default scenarios", () => {
  it("map.json parses without errors", () => {
    expect(mapResult.errors).toEqual([]);
  });

  for (const genre of GENRES) {
    it(`${DEFAULT_SCENARIO_FILES[genre]} passes full validation as ${genre}`, () => {
      const map = mapResult.map!;
      const raw = JSON.parse(readFileSync(`public/assets/scenarios/${DEFAULT_SCENARIO_FILES[genre]}`, "utf8"));
      const result = validateScenario(raw, {
        anchors: map.anchors,
        fixtures: map.fixtures,
        npcVariantCount: NPC_VARIANT_COUNT,
        requestedGenre: genre,
      });
      expect(result.ok ? [] : result.errors).toEqual([]);
    });
  }
});
