import type { ItemDefinition } from "../scenario/schema";
import type { GameState, World } from "./state";

/** Held item definitions in the order the player received them. */
export function heldItems(world: World, state: GameState): ItemDefinition[] {
  const defs = new Map(world.scenario.item_definitions.map((d) => [d.item_id, d]));
  return state.held.flatMap((id) => {
    const def = defs.get(id);
    return def ? [def] : [];
  });
}

export function canCombine(state: GameState): boolean {
  return state.held.length >= 2;
}

export function canUse(state: GameState): boolean {
  return state.held.length >= 1;
}
