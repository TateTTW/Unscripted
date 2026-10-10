import type { Fixture } from "../map/types";
import type { Action, Scenario } from "../scenario/schema";

export type EntityKind = "npc" | "fixture" | "item";

/** A scenario combined with the map's fixtures, indexed by global ID. */
export interface World {
  scenario: Scenario;
  kinds: Map<string, EntityKind>;
  names: Map<string, string>;
  inspectTexts: Map<string, string | null>;
}

export interface GameState {
  /** `current_state` of every NPC, fixture, and item. */
  states: Record<string, string>;
  /** Held item IDs in the order they were received. */
  held: string[];
}

export interface InteractionInput {
  action: Action;
  target1: string;
  target2: string | null;
}

export const DEFAULT_STATE = "default";

export function buildWorld(scenario: Scenario, fixtures: readonly Fixture[]): World {
  const kinds = new Map<string, EntityKind>();
  const names = new Map<string, string>();
  const inspectTexts = new Map<string, string | null>();
  for (const f of fixtures) {
    kinds.set(f.id, "fixture");
    names.set(f.id, f.displayName);
    inspectTexts.set(f.id, f.inspectText);
  }
  for (const n of scenario.npc_spawns) {
    kinds.set(n.entity_id, "npc");
    names.set(n.entity_id, n.display_name);
    inspectTexts.set(n.entity_id, n.inspect_text);
  }
  for (const i of scenario.item_definitions) {
    kinds.set(i.item_id, "item");
    names.set(i.item_id, i.display_name);
    inspectTexts.set(i.item_id, i.inspect_text);
  }
  return { scenario, kinds, names, inspectTexts };
}

export function createInitialState(world: World): GameState {
  const states: Record<string, string> = {};
  for (const id of world.kinds.keys()) states[id] = DEFAULT_STATE;
  return { states, held: [] };
}

export function cloneState(state: GameState): GameState {
  return { states: { ...state.states }, held: [...state.held] };
}

export function stateOf(state: GameState, id: string): string {
  return state.states[id] ?? DEFAULT_STATE;
}

/** Canonical serialization used by the solver to identify nodes. */
export function stateKey(state: GameState): string {
  const states = Object.keys(state.states)
    .filter((id) => state.states[id] !== DEFAULT_STATE)
    .sort()
    .map((id) => `${id}=${state.states[id]}`)
    .join(",");
  return `${states}|${[...state.held].sort().join(",")}`;
}
