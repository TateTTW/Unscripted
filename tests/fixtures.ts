import type { Anchor, Fixture } from "../src/map/types";
import type { Interaction, Scenario } from "../src/scenario/schema";
import type { ValidationContext } from "../src/scenario/validator";

export const ANCHORS: Anchor[] = [
  { id: "anchor_a", label: "By the door", x: 40, y: 40 },
  { id: "anchor_b", label: "In the kitchen", x: 120, y: 40 },
  { id: "anchor_c", label: "In the study", x: 200, y: 40 },
];

export const FIXTURES: Fixture[] = [
  { id: "desk", displayName: "Desk", inspectText: "A plain wooden desk.", x: 40, y: 120 },
  { id: "door", displayName: "Door", inspectText: null, x: 120, y: 120 },
];

export function context(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return { anchors: ANCHORS, fixtures: FIXTURES, npcVariantCount: 7, requestedGenre: "ESCAPE", ...overrides };
}

/** A small scenario that passes every validator rule, including the solver. */
export function validScenario(): Scenario {
  const interactions: Interaction[] = [
    {
      action: "TALK",
      target_1: "butler",
      target_2: null,
      required_state: [],
      events: [{ event: "show_dialogue", text: "Good evening." }],
    },
    {
      action: "TALK",
      target_1: "butler",
      target_2: null,
      required_state: [{ target_id: "butler", state: "default" }],
      events: [
        { event: "show_dialogue", text: "Take this key." },
        { event: "change_state", target_id: "butler", new_state: "talked" },
        { event: "spawn_item", new_item_id: "key" },
      ],
    },
    {
      action: "USE",
      target_1: "key",
      target_2: "desk",
      required_state: [
        { target_id: "key", state: null },
        { target_id: "desk", state: "default" },
      ],
      events: [
        { event: "show_dialogue", text: "The drawer opens." },
        { event: "change_state", target_id: "desk", new_state: "open" },
        { event: "destroy_item", target_id: "key" },
        { event: "spawn_item", new_item_id: "letter" },
      ],
    },
    {
      action: "INSPECT",
      target_1: "desk",
      target_2: null,
      required_state: [{ target_id: "desk", state: "open" }],
      events: [{ event: "show_dialogue", text: "The drawer is empty now." }],
    },
    {
      action: "TALK",
      target_1: "maid",
      target_2: null,
      required_state: [],
      events: [{ event: "show_dialogue", text: "Show me proof." }],
    },
    {
      action: "USE",
      target_1: "letter",
      target_2: "maid",
      required_state: [
        { target_id: "letter", state: null },
        { target_id: "maid", state: "default" },
      ],
      events: [
        { event: "change_state", target_id: "maid", new_state: "convinced" },
        { event: "spawn_item", new_item_id: "pass" },
      ],
    },
    {
      action: "USE",
      target_1: "pass",
      target_2: "door",
      required_state: [{ target_id: "pass", state: null }],
      events: [
        { event: "show_dialogue", text: "The door opens." },
        { event: "trigger_end", outcome: "WIN", text: "You escaped." },
      ],
    },
    {
      action: "USE",
      target_1: "letter",
      target_2: "butler",
      required_state: [{ target_id: "letter", state: null }],
      events: [{ event: "trigger_end", outcome: "LOSS", text: "The butler locks you in." }],
    },
  ];
  return {
    scenario_title: "Test Escape",
    genre: "ESCAPE",
    intro_text: "Get out of the house.",
    npc_spawns: [
      { entity_id: "butler", display_name: "Butler", sprite_index: 0, placed_at: "anchor_a", inspect_text: "A stiff butler." },
      { entity_id: "maid", display_name: "Maid", sprite_index: 1, placed_at: "anchor_b", inspect_text: "A nervous maid." },
    ],
    item_definitions: [
      { item_id: "key", display_name: "Key", inspect_text: "A brass key.", icon_category: "icon_tool" },
      { item_id: "letter", display_name: "Letter", inspect_text: "A sealed letter.", icon_category: "icon_paper" },
      { item_id: "pass", display_name: "Pass", inspect_text: "An exit pass.", icon_category: "icon_paper" },
    ],
    interactions,
  };
}
