import { describe, expect, it } from "vitest";
import { buildWorld } from "../src/engine/state";
import type { Interaction, Scenario } from "../src/scenario/schema";
import { solve } from "../src/scenario/solver";
import { FIXTURES, validScenario } from "./fixtures";

const world = (s: Scenario) => buildWorld(s, FIXTURES);

describe("solver", () => {
  it("finds a win in a winnable scenario", () => {
    const result = solve(world(validScenario()));
    expect(result.won).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports diagnostics for an unwinnable scenario", () => {
    const s = validScenario();
    // The maid now needs to be "bribed", which nothing ever does; the pass is never given.
    s.interactions[5]!.required_state = [
      { target_id: "letter", state: null },
      { target_id: "maid", state: "bribed" },
    ];
    s.interactions[5]!.events = [
      { event: "change_state", target_id: "maid", new_state: "convinced" },
      { event: "spawn_item", new_item_id: "pass" },
    ];
    const result = solve(world(s));
    expect(result.won).toBe(false);
    expect(result.exceededCap).toBe(false);
    expect(result.diagnostics).toContain("Item pass is never held by the player.");
    expect(result.diagnostics).toContain("maid never reaches state 'bribed'.");
    expect(result.diagnostics).toContain("WIN interaction #6 never became eligible: the player never holds pass");
  });

  it("fails when the state cap is exceeded", () => {
    const toggles: Interaction[] = ["butler", "maid", "desk", "door"].map((id) => ({
      action: "INSPECT",
      target_1: id,
      target_2: null,
      required_state: [{ target_id: id, state: "default" }],
      events: [{ event: "change_state", target_id: id, new_state: "seen" }],
    }));
    const s: Scenario = {
      ...validScenario(),
      interactions: [
        ...toggles,
        {
          action: "TALK",
          target_1: "butler",
          target_2: null,
          required_state: [{ target_id: "butler", state: "never" }],
          events: [{ event: "trigger_end", outcome: "WIN", text: "x" }],
        },
      ],
    };
    const result = solve(world(s), 5);
    expect(result.won).toBe(false);
    expect(result.exceededCap).toBe(true);
    expect(result.diagnostics[0]).toMatch(/more than 5 game states/);
  });

  it("finds a WIN whose interaction changes no state", () => {
    const s: Scenario = {
      ...validScenario(),
      interactions: [
        {
          action: "TALK",
          target_1: "butler",
          target_2: null,
          required_state: [],
          events: [
            { event: "show_dialogue", text: "It was me." },
            { event: "trigger_end", outcome: "WIN", text: "Solved." },
          ],
        },
      ],
    };
    expect(solve(world(s)).won).toBe(true);
  });

  it("treats LOSS as a dead end", () => {
    const s: Scenario = {
      ...validScenario(),
      interactions: [
        {
          action: "TALK",
          target_1: "butler",
          target_2: null,
          required_state: [{ target_id: "butler", state: "default" }],
          events: [
            { event: "change_state", target_id: "butler", new_state: "angry" },
            { event: "trigger_end", outcome: "LOSS", text: "Caught." },
          ],
        },
        {
          action: "TALK",
          target_1: "maid",
          target_2: null,
          required_state: [{ target_id: "butler", state: "angry" }],
          events: [{ event: "trigger_end", outcome: "WIN", text: "x" }],
        },
      ],
    };
    const result = solve(world(s));
    expect(result.won).toBe(false);
    expect(result.diagnostics).toContain("WIN interaction #1 never became eligible: butler is never 'angry'");
  });
});
