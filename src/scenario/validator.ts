import type { z } from "zod";
import { ID_PATTERN, LIMITS, SOLVER_MAX_STATES, STATE_PATTERN } from "../config";
import { buildWorld, DEFAULT_STATE, type EntityKind } from "../engine/state";
import type { Anchor, Fixture } from "../map/types";
import { ScenarioWireSchema, type Genre, type Interaction, type Scenario } from "./schema";
import { solve } from "./solver";

export interface ValidationContext {
  anchors: readonly Anchor[];
  fixtures: readonly Fixture[];
  npcVariantCount: number;
  requestedGenre: Genre;
  solverMaxStates?: number;
}

export type ValidationResult = { ok: true; scenario: Scenario } | { ok: false; errors: string[] };

function formatZodError(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
    return `Structure: ${path}: ${issue.message}`;
  });
}

function textOk(value: string, max: number): boolean {
  return value.trim().length >= 1 && value.length <= max;
}

export function describeInteraction(it: Interaction, index: number): string {
  const targets = it.target_2 === null ? it.target_1 : `${it.target_1} + ${it.target_2}`;
  return `Interaction #${index} (${it.action} ${targets})`;
}

/** Item IDs the interaction guarantees are held when it fires: its item targets and item conditions. */
export function guaranteedHeldItems(it: Interaction, kinds: Map<string, EntityKind>): Set<string> {
  const held = new Set<string>();
  for (const t of [it.target_1, it.target_2]) {
    if (t !== null && kinds.get(t) === "item") held.add(t);
  }
  for (const c of it.required_state) {
    if (kinds.get(c.target_id) === "item") held.add(c.target_id);
  }
  return held;
}

function sameTargets(a: Interaction, b: Interaction): boolean {
  if (a.action !== b.action) return false;
  if (a.target_1 === b.target_1 && a.target_2 === b.target_2) return true;
  return a.action === "COMBINE" && a.target_1 === b.target_2 && a.target_2 === b.target_1;
}

/**
 * Validates a scenario against the map and requested genre (Section 10).
 * Collects every error; the solver runs only when all other checks pass.
 */
export function validateScenario(raw: unknown, ctx: ValidationContext): ValidationResult {
  const parsed = ScenarioWireSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: formatZodError(parsed.error) };
  const s = parsed.data;
  const errors: string[] = [];
  const err = (message: string) => errors.push(message);

  // ---- 1. Field rules and limits ----
  if (!textOk(s.scenario_title, LIMITS.titleMax)) err(`scenario_title must be 1-${LIMITS.titleMax} characters.`);
  if (!textOk(s.intro_text, LIMITS.introMax)) err(`intro_text must be 1-${LIMITS.introMax} characters.`);
  const npcMax = Math.min(LIMITS.npcMax, ctx.anchors.length);
  if (s.npc_spawns.length < LIMITS.npcMin || s.npc_spawns.length > npcMax) {
    err(`npc_spawns must have ${LIMITS.npcMin}-${npcMax} entries (found ${s.npc_spawns.length}).`);
  }
  if (s.item_definitions.length < LIMITS.itemMin || s.item_definitions.length > LIMITS.itemMax) {
    err(`item_definitions must have ${LIMITS.itemMin}-${LIMITS.itemMax} entries (found ${s.item_definitions.length}).`);
  }
  if (s.interactions.length < LIMITS.interactionMin || s.interactions.length > LIMITS.interactionMax) {
    err(`interactions must have ${LIMITS.interactionMin}-${LIMITS.interactionMax} entries (found ${s.interactions.length}).`);
  }
  s.npc_spawns.forEach((n, i) => {
    const where = `npc_spawns[${i}] (${n.entity_id})`;
    if (!ID_PATTERN.test(n.entity_id)) err(`${where}: entity_id must match ${ID_PATTERN.source}.`);
    if (!textOk(n.display_name, LIMITS.nameMax)) err(`${where}: display_name must be 1-${LIMITS.nameMax} characters.`);
    if (!textOk(n.inspect_text, LIMITS.inspectMax)) err(`${where}: inspect_text must be 1-${LIMITS.inspectMax} characters.`);
    if (!Number.isInteger(n.sprite_index) || n.sprite_index < 0 || n.sprite_index >= ctx.npcVariantCount) {
      err(`${where}: sprite_index must be an integer from 0 to ${ctx.npcVariantCount - 1}.`);
    }
  });
  s.item_definitions.forEach((item, i) => {
    const where = `item_definitions[${i}] (${item.item_id})`;
    if (!ID_PATTERN.test(item.item_id)) err(`${where}: item_id must match ${ID_PATTERN.source}.`);
    if (!textOk(item.display_name, LIMITS.nameMax)) err(`${where}: display_name must be 1-${LIMITS.nameMax} characters.`);
    if (!textOk(item.inspect_text, LIMITS.inspectMax)) err(`${where}: inspect_text must be 1-${LIMITS.inspectMax} characters.`);
  });
  s.interactions.forEach((it, i) => {
    const where = describeInteraction(it, i);
    if (it.required_state.length > LIMITS.conditionsMax) {
      err(`${where}: required_state may have at most ${LIMITS.conditionsMax} conditions.`);
    }
    if (it.events.length < LIMITS.eventsMin || it.events.length > LIMITS.eventsMax) {
      err(`${where}: events must have ${LIMITS.eventsMin}-${LIMITS.eventsMax} entries.`);
    }
    for (const c of it.required_state) {
      if (c.state !== null && !STATE_PATTERN.test(c.state)) {
        err(`${where}: state "${c.state}" must match ${STATE_PATTERN.source}.`);
      }
    }
    for (const e of it.events) {
      if (e.event === "change_state" && !STATE_PATTERN.test(e.new_state)) {
        err(`${where}: new_state "${e.new_state}" must match ${STATE_PATTERN.source}.`);
      }
      if ((e.event === "show_dialogue" || e.event === "trigger_end") && !textOk(e.text, LIMITS.textMax)) {
        err(`${where}: ${e.event} text must be 1-${LIMITS.textMax} characters.`);
      }
    }
  });

  // ---- 2. References ----
  if (s.genre !== ctx.requestedGenre) err(`genre must be "${ctx.requestedGenre}" (found "${s.genre}").`);

  const kinds = new Map<string, EntityKind>();
  const owners = new Map<string, string>();
  const claim = (id: string, owner: string) => {
    const previous = owners.get(id);
    if (previous !== undefined) err(`ID "${id}" is used by both ${previous} and ${owner}; IDs must be globally unique.`);
    else owners.set(id, owner);
  };
  for (const a of ctx.anchors) claim(a.id, `map anchor "${a.id}"`);
  for (const f of ctx.fixtures) {
    claim(f.id, `map fixture "${f.id}"`);
    kinds.set(f.id, "fixture");
  }
  s.npc_spawns.forEach((n, i) => {
    claim(n.entity_id, `npc_spawns[${i}]`);
    if (!kinds.has(n.entity_id)) kinds.set(n.entity_id, "npc");
  });
  s.item_definitions.forEach((item, i) => {
    claim(item.item_id, `item_definitions[${i}]`);
    if (!kinds.has(item.item_id)) kinds.set(item.item_id, "item");
  });

  const anchorIds = new Set(ctx.anchors.map((a) => a.id));
  const usedAnchors = new Map<string, string>();
  s.npc_spawns.forEach((n, i) => {
    if (!anchorIds.has(n.placed_at)) {
      err(`npc_spawns[${i}] (${n.entity_id}): placed_at "${n.placed_at}" is not a map anchor. Anchors: ${[...anchorIds].join(", ")}.`);
      return;
    }
    const other = usedAnchors.get(n.placed_at);
    if (other) err(`npc_spawns[${i}] (${n.entity_id}): anchor "${n.placed_at}" is already used by ${other}.`);
    else usedAnchors.set(n.placed_at, n.entity_id);
  });

  const kindName = (id: string) => kinds.get(id) ?? "undeclared";
  const requireKind = (where: string, field: string, id: string, allowed: EntityKind[]) => {
    const kind = kinds.get(id);
    if (kind === undefined) {
      err(`${where}: ${field} "${id}" is not a declared ${allowed.join(" or ")}.`);
      return false;
    }
    if (!allowed.includes(kind)) {
      err(`${where}: ${field} "${id}" is a ${kind}, but must be a ${allowed.join(" or ")}.`);
      return false;
    }
    return true;
  };

  // ---- 3. Target contract, 4. events and conditions ----
  s.interactions.forEach((it, i) => {
    const where = describeInteraction(it, i);
    switch (it.action) {
      case "TALK":
        requireKind(where, "target_1", it.target_1, ["npc"]);
        if (it.target_2 !== null) err(`${where}: TALK must have target_2 = null.`);
        break;
      case "INSPECT":
        requireKind(where, "target_1", it.target_1, ["npc", "fixture", "item"]);
        if (it.target_2 !== null) err(`${where}: INSPECT must have target_2 = null.`);
        break;
      case "COMBINE":
        requireKind(where, "target_1", it.target_1, ["item"]);
        if (it.target_2 === null) err(`${where}: COMBINE needs a second item in target_2.`);
        else {
          requireKind(where, "target_2", it.target_2, ["item"]);
          if (it.target_2 === it.target_1) err(`${where}: COMBINE must name two different items.`);
        }
        break;
      case "USE":
        requireKind(where, "target_1", it.target_1, ["item"]);
        if (it.target_2 === null) err(`${where}: USE needs an NPC or fixture in target_2.`);
        else requireKind(where, "target_2", it.target_2, ["npc", "fixture"]);
        break;
    }

    const conditionTargets = new Set<string>();
    for (const c of it.required_state) {
      if (conditionTargets.has(c.target_id)) {
        err(`${where}: required_state lists "${c.target_id}" more than once.`);
      }
      conditionTargets.add(c.target_id);
      if (requireKind(where, "required_state target_id", c.target_id, ["npc", "fixture", "item"])) {
        const kind = kinds.get(c.target_id);
        if ((kind === "npc" || kind === "fixture") && c.state === null) {
          err(`${where}: the condition on ${kind} "${c.target_id}" must have a non-null state.`);
        }
      }
    }

    const endIndexes = it.events.flatMap((e, ei) => (e.event === "trigger_end" ? [ei] : []));
    if (endIndexes.length > 1) err(`${where}: has more than one trigger_end.`);
    if (endIndexes.length > 0 && endIndexes[endIndexes.length - 1] !== it.events.length - 1) {
      err(`${where}: trigger_end must be the last event.`);
    }

    const spawned = new Set<string>();
    const startHeld = guaranteedHeldItems(it, kinds);
    const held = new Set(startHeld);
    const destroyed = new Set<string>();
    const changed = new Set<string>();
    for (const e of it.events) {
      if (e.event === "spawn_item") {
        if (!requireKind(where, "spawn_item new_item_id", e.new_item_id, ["item"])) continue;
        if (spawned.has(e.new_item_id)) err(`${where}: spawns "${e.new_item_id}" more than once.`);
        spawned.add(e.new_item_id);
        if (held.has(e.new_item_id)) {
          err(`${where}: spawn_item "${e.new_item_id}" always fails because the player already holds it at that point.`);
        }
        held.add(e.new_item_id);
        destroyed.delete(e.new_item_id);
      } else if (e.event === "destroy_item") {
        if (!requireKind(where, "destroy_item target_id", e.target_id, ["item"])) continue;
        if (!startHeld.has(e.target_id)) {
          err(`${where}: destroy_item "${e.target_id}" may only remove one of the interaction's own item targets or an item named in its required_state.`);
        } else if (destroyed.has(e.target_id)) {
          err(`${where}: destroy_item "${e.target_id}" always fails because it was already destroyed earlier in this interaction.`);
        }
        held.delete(e.target_id);
        destroyed.add(e.target_id);
      } else if (e.event === "change_state") {
        if (!requireKind(where, "change_state target_id", e.target_id, ["npc", "fixture", "item"])) continue;
        // ---- 5. Forward-only: every change needs a known starting state ----
        if (changed.has(e.target_id)) err(`${where}: has more than one change_state on "${e.target_id}".`);
        changed.add(e.target_id);
        const from = it.required_state.find((c) => c.target_id === e.target_id);
        if (!from || from.state === null) {
          err(`${where}: change_state on "${e.target_id}" needs a required_state condition on "${e.target_id}" with a non-null state.`);
        } else if (from.state === e.new_state) {
          err(`${where}: change_state on "${e.target_id}" must change its state ("${from.state}" -> "${e.new_state}" is no change).`);
        }
      }
    }
  });

  // ---- 5. Forward-only: no loops in state transitions ----
  type Step = { to: string; index: number };
  const transitions = new Map<string, Map<string, Step[]>>();
  s.interactions.forEach((it, index) => {
    for (const e of it.events) {
      if (e.event !== "change_state") continue;
      const from = it.required_state.find((c) => c.target_id === e.target_id)?.state;
      if (from === null || from === undefined || from === e.new_state) continue;
      const graph = transitions.get(e.target_id) ?? new Map<string, Step[]>();
      transitions.set(e.target_id, graph);
      const steps = graph.get(from) ?? [];
      graph.set(from, steps);
      steps.push({ to: e.new_state, index });
    }
  });
  for (const [target, graph] of transitions) {
    const reportedLoops = new Set<string>();
    const color = new Map<string, number>();
    const path: { state: string; index: number }[] = [];
    const visit = (state: string) => {
      color.set(state, 1);
      for (const step of graph.get(state) ?? []) {
        const c = color.get(step.to) ?? 0;
        if (c === 1) {
          const startAt = path.findIndex((p) => p.state === step.to);
          const loop = [...path.slice(startAt === -1 ? path.length : startAt), { state, index: step.index }];
          const states = [...loop.map((p) => p.state), step.to];
          const indexes = [...new Set(loop.map((p) => p.index))].sort((a, b) => a - b);
          const signature = [...new Set(states)].sort().join(",");
          if (!reportedLoops.has(signature)) {
            reportedLoops.add(signature);
            err(
              `${target}'s states loop: ${states.join(" -> ")} (interactions ${indexes.map((n) => `#${n}`).join(", ")}). States can only move forward.`,
            );
          }
        } else if (c === 0) {
          path.push({ state, index: step.index });
          visit(step.to);
          path.pop();
        }
      }
      color.set(state, 2);
    };
    for (const state of graph.keys()) if ((color.get(state) ?? 0) === 0) visit(state);
  }

  // ---- 6. No dead interactions ----
  s.interactions.forEach((b, bi) => {
    for (let ai = 0; ai < bi; ai++) {
      const a = s.interactions[ai]!;
      if (!sameTargets(a, b) || a.required_state.length !== b.required_state.length) continue;
      const guaranteed = a.required_state.every((ca) =>
        ca.state === null
          ? b.required_state.some((cb) => cb.target_id === ca.target_id)
          : b.required_state.some((cb) => cb.target_id === ca.target_id && cb.state === ca.state),
      );
      if (guaranteed) {
        err(
          `${describeInteraction(b, bi)} can never fire: interaction #${ai} has the same action, targets, and number of conditions, is eligible whenever #${bi} is, and comes first. Merge them or give #${bi} different conditions.`,
        );
        break;
      }
    }
  });

  // ---- 7. Spawn-once rule ----
  s.interactions.forEach((it, i) => {
    if (!it.events.some((e) => e.event === "spawn_item")) return;
    const changedTargets = new Set(it.events.flatMap((e) => (e.event === "change_state" ? [e.target_id] : [])));
    const gated = it.required_state.some((c) => c.state !== null && changedTargets.has(c.target_id));
    const startHeld = guaranteedHeldItems(it, kinds);
    const consumes = it.events.some(
      (e, ei) =>
        e.event === "destroy_item" &&
        startHeld.has(e.target_id) &&
        !it.events.slice(ei + 1).some((later) => later.event === "spawn_item" && later.new_item_id === e.target_id),
    );
    if (!gated && !consumes) {
      err(
        `${describeInteraction(it, i)} spawns an item but could fire again. Gate it (add a condition { X, S } and a change_state on X) or consume an item it requires the player to hold.`,
      );
    }
  });

  // ---- 8. Static winnability ----
  const hasWin = s.interactions.some((it) => it.events.some((e) => e.event === "trigger_end" && e.outcome === "WIN"));
  if (!hasWin) err(`No interaction has a trigger_end with outcome "WIN".`);
  for (const item of s.item_definitions) {
    const sources = s.interactions.flatMap((it, i) =>
      it.events.some((e) => e.event === "spawn_item" && e.new_item_id === item.item_id) ? [i] : [],
    );
    if (sources.length === 0) err(`Item "${item.item_id}" is never given: exactly one interaction must spawn it.`);
    else if (sources.length > 1) {
      err(`Item "${item.item_id}" is spawned by interactions ${sources.map((n) => `#${n}`).join(", ")}; exactly one interaction may spawn each item (define another item ID for a second source).`);
    }
  }
  const setStates = new Set<string>();
  for (const it of s.interactions) {
    for (const e of it.events) if (e.event === "change_state") setStates.add(`${e.target_id}\u0000${e.new_state}`);
  }
  const reportedStates = new Set<string>();
  s.interactions.forEach((it, i) => {
    for (const c of it.required_state) {
      if (c.state === null || c.state === DEFAULT_STATE) continue;
      const key = `${c.target_id}\u0000${c.state}`;
      if (setStates.has(key) || reportedStates.has(key)) continue;
      reportedStates.add(key);
      err(`Interaction #${i} requires ${kindName(c.target_id)} "${c.target_id}" to be '${c.state}', but no change_state ever sets it to '${c.state}'.`);
    }
  });

  if (errors.length > 0) return { ok: false, errors };

  // ---- 9. Reachability solver ----
  const world = buildWorld(s, ctx.fixtures);
  const solved = solve(world, ctx.solverMaxStates ?? SOLVER_MAX_STATES);
  if (!solved.won) return { ok: false, errors: solved.diagnostics };
  return { ok: true, scenario: s };
}
