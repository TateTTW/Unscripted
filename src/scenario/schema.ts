import { z } from "zod";

export const GENRES = ["MURDER", "HEIST", "ESCAPE", "SABOTAGE", "DIPLOMACY"] as const;
export type Genre = (typeof GENRES)[number];

export const ACTIONS = ["TALK", "INSPECT", "COMBINE", "USE"] as const;
export type Action = (typeof ACTIONS)[number];

export const ICON_CATEGORIES = ["icon_paper", "icon_bottle", "icon_tool", "icon_trinket", "icon_hazard"] as const;
export type IconCategory = (typeof ICON_CATEGORIES)[number];

const ConditionSchema = z.strictObject({
  target_id: z.string(),
  state: z.string().nullable(),
});

const SpawnItemEvent = z.strictObject({ event: z.literal("spawn_item"), new_item_id: z.string() });
const DestroyItemEvent = z.strictObject({ event: z.literal("destroy_item"), target_id: z.string() });
const ChangeStateEvent = z.strictObject({
  event: z.literal("change_state"),
  target_id: z.string(),
  new_state: z.string(),
});
const ShowDialogueEvent = z.strictObject({ event: z.literal("show_dialogue"), text: z.string() });
const TriggerEndEvent = z.strictObject({
  event: z.literal("trigger_end"),
  outcome: z.enum(["WIN", "LOSS"]),
  text: z.string(),
});

const EventSchema = z.union([SpawnItemEvent, DestroyItemEvent, ChangeStateEvent, ShowDialogueEvent, TriggerEndEvent]);

const InteractionSchema = z.strictObject({
  action: z.enum(ACTIONS),
  target_1: z.string(),
  target_2: z.string().nullable(),
  required_state: z.array(ConditionSchema),
  events: z.array(EventSchema),
});

const NpcSpawnSchema = z.strictObject({
  entity_id: z.string(),
  display_name: z.string(),
  sprite_index: z.number().int(),
  placed_at: z.string(),
  inspect_text: z.string(),
});

const ItemDefinitionSchema = z.strictObject({
  item_id: z.string(),
  display_name: z.string(),
  inspect_text: z.string(),
  icon_category: z.enum(ICON_CATEGORIES),
});

/** Structure only (Section 9). Lengths, ranges, references, and rules are checked by the validator. */
export const ScenarioWireSchema = z.strictObject({
  scenario_title: z.string(),
  genre: z.enum(GENRES),
  intro_text: z.string(),
  npc_spawns: z.array(NpcSpawnSchema),
  item_definitions: z.array(ItemDefinitionSchema),
  interactions: z.array(InteractionSchema),
});

export type Scenario = z.infer<typeof ScenarioWireSchema>;
export type NpcSpawn = z.infer<typeof NpcSpawnSchema>;
export type ItemDefinition = z.infer<typeof ItemDefinitionSchema>;
export type Interaction = z.infer<typeof InteractionSchema>;
export type Condition = z.infer<typeof ConditionSchema>;
export type ScenarioEvent = z.infer<typeof EventSchema>;
