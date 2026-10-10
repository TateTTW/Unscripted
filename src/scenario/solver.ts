import { SOLVER_MAX_STATES } from "../config";
import { conditionHolds, resolveInteraction, isInputAvailable } from "../engine/interaction";
import { createInitialState, stateKey, type GameState, type InteractionInput, type World } from "../engine/state";
import type { Condition } from "./schema";

export interface SolverResult {
  won: boolean;
  exceededCap: boolean;
  visited: number;
  diagnostics: string[];
}

function inputKey(input: InteractionInput): string {
  return `${input.action}|${input.target1}|${input.target2 ?? ""}`;
}

/** The distinct `(action, targets)` inputs named in the rulebook. COMBINE pairs are unordered. */
export function collectInputs(world: World): InteractionInput[] {
  const inputs = new Map<string, InteractionInput>();
  for (const it of world.scenario.interactions) {
    let input: InteractionInput = { action: it.action, target1: it.target_1, target2: it.target_2 };
    if (it.action === "COMBINE" && it.target_2 !== null && it.target_2 < it.target_1) {
      input = { action: it.action, target1: it.target_2, target2: it.target_1 };
    }
    inputs.set(inputKey(input), input);
  }
  return [...inputs.values()];
}

function describeCondition(world: World, c: Condition): string {
  if (world.kinds.get(c.target_id) === "item") {
    return c.state === null
      ? `the player never holds ${c.target_id}`
      : `the player never holds ${c.target_id} while it is '${c.state}'`;
  }
  return `${c.target_id} is never '${c.state ?? "null"}'`;
}

/** Breadth-first search proving a WIN is reachable (Section 10, rule 9). */
export function solve(world: World, maxStates: number = SOLVER_MAX_STATES): SolverResult {
  const inputs = collectInputs(world);
  const initial = createInitialState(world);
  const seen = new Set<string>([stateKey(initial)]);
  const queue: GameState[] = [initial];

  const everHeld = new Set<string>();
  const reachedPairs = new Set<string>();
  const conditionEverHeld = new Set<string>();
  const winIndexes = world.scenario.interactions
    .map((it, i) => (it.events.some((e) => e.event === "trigger_end" && e.outcome === "WIN") ? i : -1))
    .filter((i) => i >= 0);
  const winEligible = new Set<number>();

  let exceededCap = false;
  for (let head = 0; head < queue.length && !exceededCap; head++) {
    const state = queue[head]!;
    const key = stateKey(state);

    for (const id of state.held) everHeld.add(id);
    for (const [id, value] of Object.entries(state.states)) reachedPairs.add(`${id}\u0000${value}`);
    for (const index of winIndexes) {
      const it = world.scenario.interactions[index]!;
      it.required_state.forEach((c, ci) => {
        if (conditionHolds(world, state, c)) conditionEverHeld.add(`${index}:${ci}`);
      });
      if (it.required_state.every((c) => conditionHolds(world, state, c))) winEligible.add(index);
    }

    for (const input of inputs) {
      if (!isInputAvailable(world, state, input)) continue;
      const result = resolveInteraction(world, state, input);
      if (result.ending?.outcome === "WIN") {
        return { won: true, exceededCap: false, visited: seen.size, diagnostics: [] };
      }
      if (result.ending?.outcome === "LOSS") continue;
      if (!result.committed) continue;
      const nextKey = stateKey(result.state);
      if (nextKey === key || seen.has(nextKey)) continue;
      if (seen.size >= maxStates) {
        exceededCap = true;
        break;
      }
      seen.add(nextKey);
      queue.push(result.state);
    }
  }

  const diagnostics: string[] = [];
  if (exceededCap) {
    diagnostics.push(
      `The solver explored more than ${maxStates} game states without reaching a WIN. Simplify the scenario so a WIN is reached in fewer steps.`,
    );
    return { won: false, exceededCap, visited: seen.size, diagnostics };
  }

  diagnostics.push("No sequence of interactions from the start reaches a WIN ending.");
  for (const item of world.scenario.item_definitions) {
    if (!everHeld.has(item.item_id)) diagnostics.push(`Item ${item.item_id} is never held by the player.`);
  }
  const reported = new Set<string>();
  for (const it of world.scenario.interactions) {
    for (const c of it.required_state) {
      if (c.state === null) continue;
      const pair = `${c.target_id}\u0000${c.state}`;
      if (reachedPairs.has(pair) || reported.has(pair)) continue;
      reported.add(pair);
      diagnostics.push(`${c.target_id} never reaches state '${c.state}'.`);
    }
  }
  for (const index of winIndexes) {
    const it = world.scenario.interactions[index]!;
    if (winEligible.has(index)) {
      diagnostics.push(
        `WIN interaction #${index} became eligible but never ran: another matching interaction with more conditions (or an earlier one with the same number) is always chosen instead.`,
      );
      continue;
    }
    const unmet = it.required_state
      .filter((_, ci) => !conditionEverHeld.has(`${index}:${ci}`))
      .map((c) => describeCondition(world, c));
    const detail = unmet.length > 0 ? unmet.join("; ") : "its conditions never all hold at the same time";
    diagnostics.push(`WIN interaction #${index} never became eligible: ${detail}`);
  }
  return { won: false, exceededCap, visited: seen.size, diagnostics };
}
