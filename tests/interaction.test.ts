import { describe, expect, it } from "vitest";
import { NOTHING_HAPPENS, resolveInteraction } from "../src/engine/interaction";
import { buildWorld, createInitialState, type GameState, type InteractionInput } from "../src/engine/state";
import type { Interaction, Scenario } from "../src/scenario/schema";
import { FIXTURES, validScenario } from "./fixtures";

function scenarioWith(interactions: Interaction[]): Scenario {
  return { ...validScenario(), interactions };
}

function stateWith(scenario: Scenario, held: string[] = [], states: Record<string, string> = {}): GameState {
  const base = createInitialState(buildWorld(scenario, FIXTURES));
  return { states: { ...base.states, ...states }, held };
}

const dialogue = (text: string) => ({ event: "show_dialogue" as const, text });
const talk = (target: string): InteractionInput => ({ action: "TALK", target1: target, target2: null });

describe("interaction engine", () => {
  it("picks the eligible interaction with the most conditions; no-condition acts as fallback", () => {
    const s = scenarioWith([
      { action: "TALK", target_1: "butler", target_2: null, required_state: [], events: [dialogue("fallback")] },
      { action: "TALK", target_1: "butler", target_2: null, required_state: [{ target_id: "butler", state: "default" }], events: [dialogue("one")] },
      {
        action: "TALK",
        target_1: "butler",
        target_2: null,
        required_state: [
          { target_id: "butler", state: "default" },
          { target_id: "key", state: null },
        ],
        events: [dialogue("two")],
      },
    ]);
    const world = buildWorld(s, FIXTURES);
    expect(resolveInteraction(world, stateWith(s), talk("butler")).pages).toEqual(["one"]);
    expect(resolveInteraction(world, stateWith(s, ["key"]), talk("butler")).pages).toEqual(["two"]);
    expect(resolveInteraction(world, stateWith(s, [], { butler: "angry" }), talk("butler")).pages).toEqual(["fallback"]);
  });

  it("breaks ties by array order", () => {
    const s = scenarioWith([
      { action: "TALK", target_1: "butler", target_2: null, required_state: [{ target_id: "butler", state: "default" }], events: [dialogue("first")] },
      { action: "TALK", target_1: "butler", target_2: null, required_state: [{ target_id: "maid", state: "default" }], events: [dialogue("second")] },
    ]);
    const result = resolveInteraction(buildWorld(s, FIXTURES), stateWith(s), talk("butler"));
    expect(result.pages).toEqual(["first"]);
    expect(result.interactionIndex).toBe(0);
  });

  it("checks conditions spanning an NPC, a fixture, and an item", () => {
    const s = scenarioWith([
      {
        action: "TALK",
        target_1: "maid",
        target_2: null,
        required_state: [
          { target_id: "butler", state: "asleep" },
          { target_id: "desk", state: "open" },
          { target_id: "letter", state: null },
        ],
        events: [dialogue("all three")],
      },
    ]);
    const world = buildWorld(s, FIXTURES);
    const ok = stateWith(s, ["letter"], { butler: "asleep", desk: "open" });
    expect(resolveInteraction(world, ok, talk("maid")).pages).toEqual(["all three"]);
    for (const broken of [
      stateWith(s, [], { butler: "asleep", desk: "open" }),
      stateWith(s, ["letter"], { butler: "default", desk: "open" }),
      stateWith(s, ["letter"], { butler: "asleep", desk: "default" }),
    ]) {
      expect(resolveInteraction(world, broken, talk("maid")).pages).toEqual(["Maid has nothing to say."]);
    }
  });

  it("item conditions: null needs possession; a state needs possession and the state", () => {
    const s = scenarioWith([
      { action: "TALK", target_1: "butler", target_2: null, required_state: [{ target_id: "key", state: "bent" }], events: [dialogue("bent key")] },
      { action: "TALK", target_1: "maid", target_2: null, required_state: [{ target_id: "key", state: null }], events: [dialogue("any key")] },
    ]);
    const world = buildWorld(s, FIXTURES);
    expect(resolveInteraction(world, stateWith(s, ["key"]), talk("maid")).pages).toEqual(["any key"]);
    expect(resolveInteraction(world, stateWith(s, []), talk("maid")).pages).toEqual(["Maid has nothing to say."]);
    expect(resolveInteraction(world, stateWith(s, ["key"], { key: "bent" }), talk("butler")).pages).toEqual(["bent key"]);
    expect(resolveInteraction(world, stateWith(s, ["key"]), talk("butler")).pages).toEqual(["Butler has nothing to say."]);
    expect(resolveInteraction(world, stateWith(s, [], { key: "bent" }), talk("butler")).pages).toEqual(["Butler has nothing to say."]);
  });

  it("matches COMBINE pairs in either order", () => {
    const s = scenarioWith([
      { action: "COMBINE", target_1: "key", target_2: "letter", required_state: [], events: [dialogue("combined")] },
    ]);
    const world = buildWorld(s, FIXTURES);
    const state = stateWith(s, ["key", "letter"]);
    expect(resolveInteraction(world, state, { action: "COMBINE", target1: "letter", target2: "key" }).pages).toEqual(["combined"]);
    expect(resolveInteraction(world, state, { action: "COMBINE", target1: "key", target2: "letter" }).pages).toEqual(["combined"]);
  });

  it("fails the whole interaction when spawning an already-held item", () => {
    const s = scenarioWith([
      {
        action: "TALK",
        target_1: "butler",
        target_2: null,
        required_state: [],
        events: [dialogue("here"), { event: "change_state", target_id: "butler", new_state: "x" }, { event: "spawn_item", new_item_id: "key" }],
      },
    ]);
    const state = stateWith(s, ["key"]);
    const result = resolveInteraction(buildWorld(s, FIXTURES), state, talk("butler"));
    expect(result.committed).toBe(false);
    expect(result.pages).toEqual([NOTHING_HAPPENS]);
    expect(result.state).toBe(state);
    expect(state.states.butler).toBe("default");
  });

  it("rolls back atomically when a later event is invalid", () => {
    const s = scenarioWith([
      {
        action: "TALK",
        target_1: "butler",
        target_2: null,
        required_state: [],
        events: [
          { event: "spawn_item", new_item_id: "pass" },
          { event: "change_state", target_id: "desk", new_state: "open" },
          { event: "destroy_item", target_id: "letter" },
        ],
      },
    ]);
    const state = stateWith(s, []);
    const result = resolveInteraction(buildWorld(s, FIXTURES), state, talk("butler"));
    expect(result.committed).toBe(false);
    expect(result.notices).toEqual([]);
    expect(state.held).toEqual([]);
    expect(state.states.desk).toBe("default");
  });

  it("does not fall through to the next candidate after a failed execution", () => {
    const s = scenarioWith([
      {
        action: "TALK",
        target_1: "butler",
        target_2: null,
        required_state: [{ target_id: "butler", state: "default" }],
        events: [{ event: "destroy_item", target_id: "letter" }],
      },
      { action: "TALK", target_1: "butler", target_2: null, required_state: [], events: [dialogue("fallback")] },
    ]);
    const result = resolveInteraction(buildWorld(s, FIXTURES), stateWith(s), talk("butler"));
    expect(result.pages).toEqual([NOTHING_HAPPENS]);
    expect(result.interactionIndex).toBe(0);
  });

  it("falls back to inspect_text for INSPECT", () => {
    const s = scenarioWith([]);
    const world = buildWorld(s, FIXTURES);
    expect(resolveInteraction(world, stateWith(s), { action: "INSPECT", target1: "desk", target2: null }).pages).toEqual(["A plain wooden desk."]);
    expect(resolveInteraction(world, stateWith(s), { action: "INSPECT", target1: "butler", target2: null }).pages).toEqual(["A stiff butler."]);
    expect(resolveInteraction(world, stateWith(s, ["key"]), { action: "INSPECT", target1: "key", target2: null }).pages).toEqual(["A brass key."]);
    // A fixture with no inspect_text falls back to "Nothing happens."
    expect(resolveInteraction(world, stateWith(s), { action: "INSPECT", target1: "door", target2: null }).pages).toEqual([NOTHING_HAPPENS]);
  });

  it("falls back to '<name> has nothing to say.' for TALK", () => {
    const s = scenarioWith([]);
    expect(resolveInteraction(buildWorld(s, FIXTURES), stateWith(s), talk("maid")).pages).toEqual(["Maid has nothing to say."]);
  });

  it("shows 'Nothing happens.' for USE/COMBINE without a match, or unavailable inputs", () => {
    const s = scenarioWith([]);
    const world = buildWorld(s, FIXTURES);
    expect(resolveInteraction(world, stateWith(s, ["key"]), { action: "USE", target1: "key", target2: "door" }).pages).toEqual([NOTHING_HAPPENS]);
    expect(resolveInteraction(world, stateWith(s, []), { action: "USE", target1: "key", target2: "door" }).pages).toEqual([NOTHING_HAPPENS]);
    expect(resolveInteraction(world, stateWith(s, ["key", "letter"]), { action: "COMBINE", target1: "key", target2: "letter" }).pages).toEqual([NOTHING_HAPPENS]);
  });

  it("reports WIN and LOSS endings with earlier dialogue and item notices", () => {
    const s = scenarioWith([
      {
        action: "USE",
        target_1: "pass",
        target_2: "door",
        required_state: [{ target_id: "pass", state: null }],
        events: [dialogue("bye"), { event: "destroy_item", target_id: "pass" }, { event: "trigger_end", outcome: "WIN", text: "won" }],
      },
      { action: "TALK", target_1: "butler", target_2: null, required_state: [], events: [{ event: "trigger_end", outcome: "LOSS", text: "lost" }] },
    ]);
    const world = buildWorld(s, FIXTURES);
    const win = resolveInteraction(world, stateWith(s, ["pass"]), { action: "USE", target1: "pass", target2: "door" });
    expect(win.ending).toEqual({ outcome: "WIN", text: "won" });
    expect(win.pages).toEqual(["bye"]);
    expect(win.notices).toEqual([{ kind: "lost", itemId: "pass", name: "Pass" }]);
    expect(resolveInteraction(world, stateWith(s), talk("butler")).ending).toEqual({ outcome: "LOSS", text: "lost" });
    expect(resolveInteraction(world, stateWith(s), talk("maid")).ending).toBeNull();
  });

  it("commits spawn/destroy/change_state together and reports notices", () => {
    const s = validScenario();
    const world = buildWorld(s, FIXTURES);
    const result = resolveInteraction(world, stateWith(s, ["key"]), { action: "USE", target1: "key", target2: "desk" });
    expect(result.committed).toBe(true);
    expect(result.state.held).toEqual(["letter"]);
    expect(result.state.states.desk).toBe("open");
    expect(result.notices.map((n) => `${n.kind}:${n.name}`)).toEqual(["lost:Key", "received:Letter"]);
  });
});
