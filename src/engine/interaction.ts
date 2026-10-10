import type { Condition, Interaction } from "../scenario/schema";
import { cloneState, stateOf, type GameState, type InteractionInput, type World } from "./state";

export interface ItemNotice {
  kind: "received" | "lost";
  itemId: string;
  name: string;
}

export interface Ending {
  outcome: "WIN" | "LOSS";
  text: string;
}

export interface InteractionResult {
  /** True when an interaction's events were applied. */
  committed: boolean;
  /** Index of the selected interaction, or null when none was eligible. */
  interactionIndex: number | null;
  /** The new state (the input state when nothing was committed). */
  state: GameState;
  pages: string[];
  notices: ItemNotice[];
  ending: Ending | null;
}

export const NOTHING_HAPPENS = "Nothing happens.";

export function nothingToSay(name: string): string {
  return `${name} has nothing to say.`;
}

export function isHeld(state: GameState, itemId: string): boolean {
  return state.held.includes(itemId);
}

/** Section 6, Conditions. */
export function conditionHolds(world: World, state: GameState, condition: Condition): boolean {
  const kind = world.kinds.get(condition.target_id);
  if (kind === "item") {
    if (!isHeld(state, condition.target_id)) return false;
    return condition.state === null || stateOf(state, condition.target_id) === condition.state;
  }
  if (kind === "npc" || kind === "fixture") {
    return condition.state !== null && stateOf(state, condition.target_id) === condition.state;
  }
  return false;
}

export function interactionMatches(interaction: Interaction, input: InteractionInput): boolean {
  if (interaction.action !== input.action) return false;
  if (interaction.target_1 === input.target1 && interaction.target_2 === input.target2) return true;
  return (
    input.action === "COMBINE" &&
    interaction.target_1 === input.target2 &&
    interaction.target_2 === input.target1
  );
}

/** Whether the input is currently offered to the player (Section 6, Target Contract). */
export function isInputAvailable(world: World, state: GameState, input: InteractionInput): boolean {
  const k1 = world.kinds.get(input.target1);
  const k2 = input.target2 === null ? null : world.kinds.get(input.target2);
  switch (input.action) {
    case "TALK":
      return k1 === "npc" && input.target2 === null;
    case "INSPECT":
      if (input.target2 !== null) return false;
      if (k1 === "item") return isHeld(state, input.target1);
      return k1 === "npc" || k1 === "fixture";
    case "COMBINE":
      return (
        k1 === "item" &&
        k2 === "item" &&
        input.target2 !== null &&
        input.target1 !== input.target2 &&
        isHeld(state, input.target1) &&
        isHeld(state, input.target2)
      );
    case "USE":
      return k1 === "item" && isHeld(state, input.target1) && (k2 === "npc" || k2 === "fixture");
  }
}

/** Picks the eligible interaction with the most conditions; ties go to the earliest. */
export function selectInteraction(world: World, state: GameState, input: InteractionInput): number | null {
  let best: number | null = null;
  let bestCount = -1;
  world.scenario.interactions.forEach((interaction, index) => {
    if (!interactionMatches(interaction, input)) return;
    if (!interaction.required_state.every((c) => conditionHolds(world, state, c))) return;
    if (interaction.required_state.length > bestCount) {
      best = index;
      bestCount = interaction.required_state.length;
    }
  });
  return best;
}

function notCommitted(state: GameState, pages: string[], index: number | null): InteractionResult {
  return { committed: false, interactionIndex: index, state, pages, notices: [], ending: null };
}

/**
 * The single interaction engine (Section 7): `(world, state, input) -> result`.
 * Used by both the game and the solver. Never mutates `state`.
 */
export function resolveInteraction(world: World, state: GameState, input: InteractionInput): InteractionResult {
  if (!isInputAvailable(world, state, input)) return notCommitted(state, [NOTHING_HAPPENS], null);

  const index = selectInteraction(world, state, input);
  if (index === null) {
    if (input.action === "INSPECT") {
      const text = world.inspectTexts.get(input.target1);
      if (text) return notCommitted(state, [text], null);
    }
    if (input.action === "TALK") {
      return notCommitted(state, [nothingToSay(world.names.get(input.target1) ?? input.target1)], null);
    }
    return notCommitted(state, [NOTHING_HAPPENS], null);
  }

  const interaction = world.scenario.interactions[index];
  if (!interaction) return notCommitted(state, [NOTHING_HAPPENS], null);
  const next = cloneState(state);
  const pages: string[] = [];
  const notices: ItemNotice[] = [];
  let ending: Ending | null = null;

  for (const event of interaction.events) {
    if (ending) return notCommitted(state, [NOTHING_HAPPENS], index);
    switch (event.event) {
      case "spawn_item": {
        if (world.kinds.get(event.new_item_id) !== "item" || isHeld(next, event.new_item_id)) {
          return notCommitted(state, [NOTHING_HAPPENS], index);
        }
        next.held.push(event.new_item_id);
        notices.push({ kind: "received", itemId: event.new_item_id, name: world.names.get(event.new_item_id) ?? event.new_item_id });
        break;
      }
      case "destroy_item": {
        if (!isHeld(next, event.target_id)) return notCommitted(state, [NOTHING_HAPPENS], index);
        next.held = next.held.filter((id) => id !== event.target_id);
        notices.push({ kind: "lost", itemId: event.target_id, name: world.names.get(event.target_id) ?? event.target_id });
        break;
      }
      case "change_state": {
        if (!world.kinds.has(event.target_id)) return notCommitted(state, [NOTHING_HAPPENS], index);
        next.states[event.target_id] = event.new_state;
        break;
      }
      case "show_dialogue":
        pages.push(event.text);
        break;
      case "trigger_end":
        ending = { outcome: event.outcome, text: event.text };
        break;
    }
  }

  return { committed: true, interactionIndex: index, state: next, pages, notices, ending };
}
