import { describe, expect, it } from "vitest";
import type { Interaction, Scenario } from "../src/scenario/schema";
import { validateScenario } from "../src/scenario/validator";
import { context, validScenario } from "./fixtures";

function errorsFor(mutate: (s: Scenario) => void, ctx = context()): string[] {
  const s = validScenario();
  mutate(s);
  const result = validateScenario(s, ctx);
  return result.ok ? [] : result.errors;
}

function expectError(mutate: (s: Scenario) => void, fragment: string | RegExp, ctx = context()): void {
  const errors = errorsFor(mutate, ctx);
  const match = errors.some((e) => (typeof fragment === "string" ? e.includes(fragment) : fragment.test(e)));
  expect(match, `expected an error matching ${String(fragment)}, got:\n${errors.join("\n")}`).toBe(true);
}

const it_ = (s: Scenario, i: number): Interaction => s.interactions[i]!;

describe("validator", () => {
  it("accepts a fully valid scenario", () => {
    const result = validateScenario(validScenario(), context());
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  describe("1. structure and field limits", () => {
    it("rejects non-objects and missing fields", () => {
      const result = validateScenario({ scenario_title: "x" }, context());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.some((e) => e.startsWith("Structure:"))).toBe(true);
    });
    it("rejects unknown fields", () => {
      expectError((s) => Object.assign(s, { extra: 1 }), "Structure:");
    });
    it("rejects a wrong event shape", () => {
      expectError((s) => it_(s, 0).events.push({ event: "show_dialogue", text: "x", extra: true } as never), "Structure:");
    });
    it("rejects an unknown genre value", () => {
      expectError((s) => Object.assign(s, { genre: "ROMANCE" }), "Structure:");
    });
    it("limits scenario_title and intro_text", () => {
      expectError((s) => (s.scenario_title = "x".repeat(41)), "scenario_title");
      expectError((s) => (s.intro_text = "   "), "intro_text");
      expectError((s) => (s.intro_text = "x".repeat(601)), "intro_text");
    });
    it("limits npc_spawns count to 2..min(6, anchors)", () => {
      expectError((s) => s.npc_spawns.pop(), "npc_spawns must have 2-3");
    });
    it("limits item_definitions and interactions counts", () => {
      expectError((s) => s.item_definitions.splice(0, 1), "item_definitions must have 3-10");
      expectError((s) => s.interactions.splice(7, 1), "interactions must have 8-40");
    });
    it("checks ID patterns, names, and inspect text", () => {
      expectError((s) => (s.npc_spawns[0]!.display_name = ""), "display_name");
      expectError((s) => (s.item_definitions[0]!.inspect_text = "x".repeat(301)), "inspect_text");
      expectError((s) => (s.npc_spawns[1]!.entity_id = "Maid"), "entity_id must match");
      expectError((s) => (s.item_definitions[2]!.item_id = "9pass"), "item_id must match");
    });
    it("limits conditions and events per interaction", () => {
      expectError(
        (s) =>
          (it_(s, 0).required_state = [
            { target_id: "butler", state: "a" },
            { target_id: "maid", state: "a" },
            { target_id: "desk", state: "a" },
            { target_id: "door", state: "a" },
            { target_id: "key", state: null },
          ]),
        "at most 4 conditions",
      );
      expectError((s) => (it_(s, 0).events = []), "events must have 1-8");
      expectError(
        (s) => (it_(s, 0).events = Array.from({ length: 9 }, () => ({ event: "show_dialogue" as const, text: "x" }))),
        "events must have 1-8",
      );
    });
    it("checks state strings and dialogue length", () => {
      expectError((s) => (it_(s, 1).events[1] = { event: "change_state", target_id: "butler", new_state: "Talked!" }), "new_state");
      expectError((s) => (it_(s, 3).required_state[0]!.state = "Open"), 'state "Open"');
      expectError((s) => (it_(s, 0).events[0] = { event: "show_dialogue", text: "x".repeat(301) }), "show_dialogue text");
      expectError((s) => (it_(s, 6).events[1] = { event: "trigger_end", outcome: "WIN", text: "" }), "trigger_end text");
    });
  });

  describe("2. references", () => {
    it("requires globally unique IDs, including map fixtures and anchors", () => {
      expectError((s) => (s.item_definitions[0]!.item_id = "desk"), 'ID "desk" is used by both');
      expectError((s) => (s.npc_spawns[1]!.entity_id = "butler"), 'ID "butler" is used by both');
      expectError((s) => (s.item_definitions[2]!.item_id = "anchor_c"), 'ID "anchor_c" is used by both');
    });
    it("requires real, unused anchors", () => {
      expectError((s) => (s.npc_spawns[0]!.placed_at = "garden"), "is not a map anchor");
      expectError((s) => (s.npc_spawns[1]!.placed_at = "anchor_a"), "is already used by butler");
    });
    it("checks sprite_index range", () => {
      expectError((s) => (s.npc_spawns[0]!.sprite_index = 7), "sprite_index");
      expectError((s) => (s.npc_spawns[0]!.sprite_index = -1), "sprite_index");
    });
    it("requires declared targets", () => {
      expectError((s) => (it_(s, 0).target_1 = "ghost"), 'target_1 "ghost" is not a declared');
      expectError((s) => it_(s, 0).required_state.push({ target_id: "ghost", state: "x" }), '"ghost" is not a declared');
      expectError((s) => (it_(s, 1).events[2] = { event: "spawn_item", new_item_id: "butler" }), "spawn_item new_item_id");
    });
    it("requires the requested genre", () => {
      expectError((s) => (s.genre = "HEIST"), 'genre must be "ESCAPE"');
    });
  });

  describe("3. target contract", () => {
    it("TALK must target an NPC with no target_2", () => {
      expectError((s) => (it_(s, 4).target_1 = "desk"), "must be a npc");
      expectError((s) => (it_(s, 4).target_2 = "desk"), "TALK must have target_2 = null");
    });
    it("INSPECT takes no target_2", () => {
      expectError((s) => (it_(s, 3).target_2 = "key"), "INSPECT must have target_2 = null");
    });
    it("COMBINE needs two different items", () => {
      expectError(
        (s) =>
          s.interactions.push({
            action: "COMBINE",
            target_1: "key",
            target_2: "key",
            required_state: [],
            events: [{ event: "show_dialogue", text: "x" }],
          }),
        "two different items",
      );
      expectError(
        (s) =>
          s.interactions.push({ action: "COMBINE", target_1: "key", target_2: "desk", required_state: [], events: [{ event: "show_dialogue", text: "x" }] }),
        'target_2 "desk" is a fixture',
      );
    });
    it("USE needs an item then an NPC or fixture", () => {
      expectError((s) => (it_(s, 6).target_2 = "key"), 'target_2 "key" is a item');
      expectError((s) => (it_(s, 6).target_1 = "desk"), 'target_1 "desk" is a fixture');
      expectError((s) => (it_(s, 6).target_2 = null), "USE needs an NPC or fixture");
    });
  });

  describe("4. events and conditions", () => {
    it("allows at most one trigger_end, and it must be last", () => {
      expectError((s) => it_(s, 6).events.push({ event: "trigger_end", outcome: "LOSS", text: "x" }), "more than one trigger_end");
      expectError((s) => it_(s, 6).events.push({ event: "show_dialogue", text: "x" }), "trigger_end must be the last event");
    });
    it("rejects spawning the same item twice in one interaction", () => {
      expectError((s) => it_(s, 1).events.push({ event: "spawn_item", new_item_id: "key" }), 'spawns "key" more than once');
    });
    it("rejects duplicate condition targets", () => {
      expectError((s) => it_(s, 3).required_state.push({ target_id: "desk", state: "default" }), 'lists "desk" more than once');
    });
    it("requires a non-null state on NPC and fixture conditions", () => {
      expectError((s) => (it_(s, 3).required_state[0]!.state = null), "must have a non-null state");
    });
    it("only removes held items", () => {
      expectError((s) => it_(s, 6).events.unshift({ event: "destroy_item", target_id: "letter" }), "may only remove");
    });
    it("rejects spawning an item that is held at that point", () => {
      expectError(
        (s) => (it_(s, 2).events = [{ event: "spawn_item", new_item_id: "key" }, { event: "change_state", target_id: "desk", new_state: "open" }]),
        'spawn_item "key" always fails',
      );
    });
    it("rejects destroying an item twice", () => {
      expectError(
        (s) => it_(s, 2).events.splice(3, 0, { event: "destroy_item", target_id: "key" }),
        'destroy_item "key" always fails',
      );
    });
  });

  describe("5. forward-only states", () => {
    it("requires a condition on the changed target", () => {
      expectError((s) => it_(s, 0).events.push({ event: "change_state", target_id: "maid", new_state: "upset" }), "needs a required_state condition");
    });
    it("requires the new state to differ", () => {
      expectError((s) => (it_(s, 1).events[1] = { event: "change_state", target_id: "butler", new_state: "default" }), "is no change");
    });
    it("allows one change_state per target per interaction", () => {
      expectError((s) => it_(s, 1).events.push({ event: "change_state", target_id: "butler", new_state: "done" }), "more than one change_state");
    });
    it("rejects state loops and reports them", () => {
      expectError(
        (s) =>
          s.interactions.push({
            action: "INSPECT",
            target_1: "butler",
            target_2: null,
            required_state: [{ target_id: "butler", state: "talked" }],
            events: [{ event: "change_state", target_id: "butler", new_state: "default" }],
          }),
        /butler's states loop: default -> talked -> default \(interactions #1, #8\)/,
      );
    });
  });

  describe("6. dead interactions", () => {
    it("rejects exact duplicates", () => {
      expectError((s) => s.interactions.push(structuredClone(it_(s, 4))), "Interaction #8 (TALK maid) can never fire");
    });
    it("rejects a later interaction whose conditions guarantee an earlier one's", () => {
      expectError(
        (s) =>
          s.interactions.push({
            action: "USE",
            target_1: "pass",
            target_2: "door",
            required_state: [{ target_id: "pass", state: "shiny" }],
            events: [{ event: "show_dialogue", text: "x" }],
          }),
        "can never fire",
      );
    });
    it("treats COMBINE pairs as unordered", () => {
      const combine = (a: string, b: string): Interaction => ({
        action: "COMBINE",
        target_1: a,
        target_2: b,
        required_state: [],
        events: [{ event: "show_dialogue", text: "x" }],
      });
      expectError((s) => s.interactions.push(combine("key", "letter"), combine("letter", "key")), "Interaction #9");
    });
    it("allows different condition counts", () => {
      expect(errorsFor(() => undefined)).toEqual([]);
    });
  });

  describe("7. spawn-once", () => {
    it("rejects a spawn that is neither gated nor consuming", () => {
      expectError(
        (s) => {
          it_(s, 5).required_state = [{ target_id: "letter", state: null }];
          it_(s, 5).events = [{ event: "spawn_item", new_item_id: "pass" }];
        },
        "spawns an item but could fire again",
      );
    });
    it("accepts a consuming spawn", () => {
      const errors = errorsFor((s) => {
        it_(s, 5).required_state = [{ target_id: "letter", state: null }];
        it_(s, 5).events = [
          { event: "destroy_item", target_id: "letter" },
          { event: "spawn_item", new_item_id: "pass" },
        ];
        s.interactions.splice(7, 1, {
          action: "TALK",
          target_1: "maid",
          target_2: null,
          required_state: [{ target_id: "maid", state: "default" }],
          events: [{ event: "show_dialogue", text: "Hm." }],
        });
      });
      expect(errors.filter((e) => e.includes("could fire again"))).toEqual([]);
    });
  });

  describe("8. static winnability", () => {
    it("requires a WIN ending", () => {
      expectError((s) => (it_(s, 6).events[1] = { event: "trigger_end", outcome: "LOSS", text: "x" }), 'No interaction has a trigger_end with outcome "WIN"');
    });
    it("requires each item to be spawned exactly once", () => {
      expectError(
        (s) => s.item_definitions.push({ item_id: "coin", display_name: "Coin", inspect_text: "Shiny.", icon_category: "icon_trinket" }),
        'Item "coin" is never given',
      );
      expectError((s) => it_(s, 2).events.push({ event: "spawn_item", new_item_id: "pass" }), 'Item "pass" is spawned by interactions #2, #5');
    });
    it("requires every non-default condition state to be set somewhere", () => {
      expectError((s) => (it_(s, 3).required_state[0]!.state = "smashed"), "no change_state ever sets it to 'smashed'");
    });
  });

  describe("9. reachability solver", () => {
    it("rejects a statically valid scenario whose WIN can't be reached, with diagnostics", () => {
      const errors = errorsFor((s) => {
        // The door only unlocks while holding both the key and the pass, but the key is
        // consumed before the pass can be obtained.
        it_(s, 6).required_state.push({ target_id: "door", state: "unlocked" });
        s.interactions.push({
          action: "USE",
          target_1: "key",
          target_2: "door",
          required_state: [
            { target_id: "key", state: null },
            { target_id: "pass", state: null },
            { target_id: "door", state: "default" },
          ],
          events: [{ event: "change_state", target_id: "door", new_state: "unlocked" }],
        });
      });
      expect(errors).toContain("door never reaches state 'unlocked'.");
      expect(errors).toContain("WIN interaction #6 never became eligible: door is never 'unlocked'");
    });
  });
});
