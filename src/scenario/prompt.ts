import { LIMITS } from "../config";
import type { Anchor, Fixture } from "../map/types";
import { GENRE_LABELS } from "./genre";
import type { Genre } from "./schema";

export interface PromptInput {
  genre: Genre;
  anchors: readonly Anchor[];
  fixtures: readonly Fixture[];
  npcDescriptions: readonly string[];
}

export const SYSTEM_PROMPT = `You are the Scenario Master for "Unscripted", a small 2D top-down detective and deduction game set in a single house.
You write one complete, self-contained scenario as a single JSON object that matches the provided schema exactly.
The game engine is strict: it rejects any scenario that breaks a rule, so follow every rule in the user's message precisely.
Write all player-facing text in plain printable ASCII (straight quotes, "-" instead of dashes, "..." instead of ellipsis characters).
Keep the story coherent: plot, secret motives, at least one red herring, and clear WIN and LOSS conditions that are triggered by interactions.`;

const WORKED_EXAMPLE = `{
  "action": "USE",
  "target_1": "brass_key",
  "target_2": "office_desk",
  "required_state": [
    { "target_id": "brass_key", "state": null },
    { "target_id": "office_desk", "state": "default" }
  ],
  "events": [
    { "event": "show_dialogue", "text": "The key turns. Inside the drawer lies a torn ledger page." },
    { "event": "change_state", "target_id": "office_desk", "new_state": "unlocked" },
    { "event": "destroy_item", "target_id": "brass_key" },
    { "event": "spawn_item", "new_item_id": "ledger_page" }
  ]
}`;

export function buildUserPrompt(input: PromptInput): string {
  const npcMax = Math.min(LIMITS.npcMax, input.anchors.length);
  const anchors = input.anchors.map((a) => `- ${a.id}: ${a.label}`).join("\n");
  const fixtures = input.fixtures
    .map((f) => `- ${f.id} ("${f.displayName}")${f.inspectText ? `: ${f.inspectText}` : ""}`)
    .join("\n");
  const sprites = input.npcDescriptions.map((d, i) => `- sprite_index ${i}: ${d}`).join("\n");

  return `Write a ${GENRE_LABELS[input.genre]} scenario. The "genre" field must be exactly "${input.genre}".

## The map
Anchors (places where you may put characters; use each at most once, in "placed_at"):
${anchors}

Fixtures (fixed world objects already on the map; refer to them by ID in interactions):
${fixtures}

NPC sprites (choose a fitting "sprite_index" for each character; sprites may repeat):
${sprites}

## Output limits
- scenario_title: 1-${LIMITS.titleMax} characters. intro_text: 1-${LIMITS.introMax} characters (the player's briefing).
- npc_spawns: ${LIMITS.npcMin}-${npcMax} characters. entity_id and item_id match ^[a-z][a-z0-9_]{0,39}$. display_name: 1-${LIMITS.nameMax} characters. inspect_text: 1-${LIMITS.inspectMax} characters.
- sprite_index: integer from 0 to ${input.npcDescriptions.length - 1}. placed_at: one of the anchor IDs above, each anchor used at most once.
- item_definitions: ${LIMITS.itemMin}-${LIMITS.itemMax} items. icon_category: one of icon_paper, icon_bottle, icon_tool, icon_trinket, icon_hazard.
- interactions: ${LIMITS.interactionMin}-${LIMITS.interactionMax} entries. Each has 0-${LIMITS.conditionsMax} required_state conditions and 1-${LIMITS.eventsMax} events.
- State strings (condition "state" when not null, and "new_state") match ^[a-z][a-z0-9_]{0,29}$. Dialogue and end text: 1-${LIMITS.textMax} characters.

## IDs and state
- IDs are global: every NPC entity_id, fixture ID, and item_id must be unique across all three groups, and must not reuse an anchor ID.
- item_definitions is a catalog of every item that can ever be given. The player's inventory always starts EMPTY; an item exists only after a spawn_item event gives it to the player. Items are never placed in the world.
- Each item_id is one unique object (never a stack). For two similar objects, define two IDs.
- Every NPC, fixture, and item has one current state, starting as "default".

## Target contract
- TALK: target_1 = NPC, target_2 = null.
- INSPECT: target_1 = NPC, fixture, or item (an item must be held), target_2 = null.
- COMBINE: target_1 and target_2 = two DIFFERENT items, both held. The pair is unordered.
- USE: target_1 = a held item, target_2 = an NPC or fixture. Order matters. Using an item on nothing is not supported.

## Conditions (required_state)
- Each condition is { "target_id", "state" }. All conditions must hold; an empty array means unconditional. A target_id may appear at most once per array.
- NPC or fixture: "state" must be a state string; it holds when that entity's current state equals it.
- Item: "state": null holds when the player holds the item. A state string holds when the player holds the item AND it is in that state. A condition on an item always requires holding it.
- Every non-null state other than "default" used in a condition must be set by some change_state on that same target.

## How one interaction is chosen
When the player acts, the engine takes all interactions with the same action and targets, keeps those whose conditions all hold, and runs the one with the MOST conditions. Ties go to the one earliest in the array. So an interaction with no conditions acts as the fallback. Do not write two interactions with the same action, targets, and number of conditions where one is eligible whenever the other is: the later one could never fire.
If nothing is eligible, INSPECT shows the target's inspect_text, TALK shows "<name> has nothing to say.", and anything else shows "Nothing happens."

## Events (run in order, all-or-nothing)
- { "event": "spawn_item", "new_item_id" }: gives the item to the player.
- { "event": "destroy_item", "target_id" }: removes a held item. It may ONLY remove one of the interaction's own item targets or an item named in its required_state.
- { "event": "change_state", "target_id", "new_state" }: sets an NPC, fixture, or item state.
- { "event": "show_dialogue", "text" }: one dialogue page.
- { "event": "trigger_end", "outcome": "WIN" or "LOSS", "text" }: ends the game. At most once per interaction, and it must be the LAST event.
- Never spawn an item the player already holds at that point (including the interaction's own item targets and required items, unless destroyed earlier in the same events), never spawn the same item twice in one interaction, and never destroy the same item twice.

## Rules that keep the game consistent
- One source per item: each item in item_definitions is spawned by EXACTLY ONE interaction. A second source needs a second item ID.
- States only move forward: every change_state on a target X needs a condition { X, S } with a non-null state S in the same interaction, and new_state must differ from S. At most one change_state per target per interaction. No target may ever return to a state it has left (no loops such as default -> angry -> default).
- Spawn-once: every interaction that contains spawn_item must either
  (Gate) have a condition { X, S } with a non-null state and a change_state on X, so it can never fire again, or
  (Consume) destroy an item it requires the player to hold (one of its own item targets or an item in its required_state) and not spawn that item again later.
  This applies to every action, including INSPECT and TALK.

## Winnability
- At least one interaction must end with trigger_end outcome "WIN", and the player must be able to reach it from the start (all states "default", empty inventory) by playing interactions in some order. The engine checks this with a search.
- Include at least one LOSS ending (for example, accusing the wrong person or triggering an alarm), and give the player clues that make the right path deducible.
- Make every item useful, give characters TALK interactions with personality, and give fixtures INSPECT interactions that reveal clues.

## Worked example interaction
This USE needs the player to hold brass_key and the desk to be "default". It is gated by the desk's state change and also consumes the key:
${WORKED_EXAMPLE}

Return only the JSON object.`;
}

export function buildRepairPrompt(errors: readonly string[]): string {
  return `Your scenario failed validation with these errors:
${errors.map((e) => `- ${e}`).join("\n")}

Fix every error and return the complete corrected scenario as one JSON object (not a diff). Keep everything that was valid, and make sure the result still follows every rule from my first message.`;
}
