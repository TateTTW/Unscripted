# Technical Specification: "Unscripted"

## A Low-Scope, Dynamic 2D Detective and Deduction Engine

---

## 1. Executive Summary

**Unscripted** is a lightweight, 2D top-down deduction and scenario game built with **Phaser 3** and **TypeScript**.

The game loads a Tiled tilemap (JSON) supplied by the project owner. The tilemap defines the map layout, collision data, spatial anchors, the player's start position, and fixed world fixtures such as dressers, chests, and desks. The local engine handles tilemap loading, collision, and player movement. On the loading screen the player enters an OpenAI API key, and the game asks the OpenAI API (through the OpenAI SDK) to generate the scenario. If the response fails validation, the game sends at most one repair request. The AI acts as an **LLM Scenario Master**, generating a complete, self-contained narrative blueprint. The blueprint covers:

- win/loss conditions triggered by interactions
- character roles
- inventory-item definitions
- character placements at the map's spatial anchors
- an interaction rulebook built around a standardized four-verb state machine

Fixed fixtures are world objects, not inventory items. The AI defines interaction rules for those fixtures. When a rule creates an item, the item goes directly into the player's inventory. Inventory items are never placed in the world: interaction outcomes create them and can later remove them.

The engine picks a genre for each scenario from **Murder Mystery**, **Heist**, **Escape**, **Sabotage**, and **Diplomatic Scandal**.

---

## 2. Technology Stack and Project Layout

| Concern | Choice |
|---|---|
| Game framework | **Phaser 3**, latest 3.x release, pinned to an exact version in `package.json`. Do **not** use Phaser 4. |
| Language | TypeScript with `strict: true` and `noUncheckedIndexedAccess: true` |
| Build / dev server | Vite |
| Package manager | npm |
| Unit tests | Vitest |
| Runtime validation & JSON Schema | Zod, using a version compatible with the OpenAI SDK's `openai/helpers/zod` helper |
| LLM client | Official `openai` npm SDK (Responses API) |

npm scripts: `dev`, `build` (`tsc --noEmit && vite build`), `preview`, `test` (`vitest run`).

`.gitignore` must include `node_modules/`, `dist/`, and `.env.local`.

Recommended layout:

```text
index.html
vite.config.ts                 # includes the production key-leak check (Section 9)
src/
  main.ts                      # Phaser game config
  config.ts                    # all tunable constants (model ID, timeouts, limits, ranges)
  scenes/                      # BootScene, KeyEntryScene, LoadingScene, IntroScene,
                               # GameScene, UIScene, EndScene
  map/                         # Tiled object parsing + map validation (pure TS, no Phaser)
  scenario/                    # Zod schema, types, validator, solver, prompt, OpenAI client
  engine/                      # game state, inventory, interaction engine (pure TS, no Phaser)
  ui/                          # dialogue box, verb menu, inventory panel, pause menu, toasts
public/assets/
  maps/map.json
  tilesets/
  sprites/                     # player.png, npcs.png, fixtures.png, fixtures.json, icons.png
  scenarios/default_scenario.json
tests/
```

**Code that must be pure TypeScript with no Phaser imports, and unit-tested under Vitest:** map parsing and validation, the scenario validator, the solver, the inventory, and the interaction engine. Both the solver and the runtime **must use the same interaction-engine code**, so the solver's verdict always matches real gameplay.

---

## 3. System Responsibilities

### Local Engine (Phaser 3)

- **Tilemap Loading, Anchors, and Fixtures:** Loads the supplied tilemap according to the convention in Section 4.
- **Player Start:** Spawns the player at the single `player_start` object authored in the map. The LLM never chooses or changes it.
- **Collision:** Uses tile collision from tiles marked `collides = true`, plus static bodies for fixtures and NPCs.
- **Entity Spawning:** Places scenario characters at anchor coordinates according to the AI's `npc_spawns`. It never places inventory items in the world.
- **Inventory Items:** Items are created only when an interaction runs `spawn_item`, which puts them straight into the player's inventory. `destroy_item` removes them.
- **Core Loop and Input:** Four-direction top-down movement, tile collision, and the UI described in Section 8.
- **State Engine:** Runs interactions for four universal verbs: `TALK`, `INSPECT`, `COMBINE`, and `USE`.
- **Victory/Defeat Logic:** The game ends only through a `trigger_end` event.

### Remote LLM API (Load-Time Scenario Master)

- **Execution Window:** Runs only during the loading screen: one generation request, plus at most one repair request (Section 9). Gameplay makes no LLM requests.
- **Scenario Generation:** Writes the scenario for the genre the engine picked: plot, secret motives, red herrings, and clear win and loss conditions.
- **Spatial Placement:** Assigns characters to the anchor IDs given in the prompt, choosing locations that fit the story. Rules refer to fixtures by their map IDs. The AI does not place items in the world or choose the player start.
- **Inventory Item Definitions:** Defines each item's name, description, and icon category. Defining an item doesn't create it; it only exists once a rule spawns it.
- **Rulebook Generation:** Returns an array of interactions for the four verbs. Each has a priority, a list of state conditions (`required_state`), and an ordered event list.

---

## 4. Tilemap Convention (Supplied by the Project Owner)

The map is authored in **Tiled** and exported as JSON to `public/assets/maps/map.json`.

- **Orientation / size:** Orthogonal, **16×16 px** tiles.
- **Tilesets:** Must be **embedded** in the map, not external `.tsx` files. Tileset images go in `public/assets/tilesets/`. The game uses each tileset's name in Tiled as its Phaser texture key when loading the image.
- **Tile layers:**
  - `ground`: floor and decoration, no collision.
  - `walls`: blocking tiles. Any tile with the boolean custom property `collides = true` blocks movement. The game calls `setCollisionByProperty({ collides: true })` on both tile layers.
- **Object layer `objects`:** Every object's Tiled **Class** is one of `anchor`, `fixture`, or `player_start`. Tiled exports Class as `type` in JSON; read `type` first, then `class`. Use point objects. If a rectangle object is used, its position is the rectangle's center.

| Class | Custom properties | Notes |
|---|---|---|
| `anchor` | `id` (string, required), `label` (string, required) | `label` tells the AI where the anchor is, e.g. "beside the front door". At least 2 anchors. |
| `fixture` | `id`, `display_name`, `sprite` (string, required); `inspect_text` (string, optional) | `sprite` is a frame name in the `fixtures.json` atlas. |
| `player_start` | none | Exactly one. |

**Map validation (Boot):** These checks run when the game boots. A failure is a developer error: show a full-screen error listing every problem and stop. There is no fallback map.

- Layers `ground`, `walls`, and `objects` exist.
- There is exactly one `player_start`.
- There are at least 2 anchors.
- Every required property is present and non-empty.
- Every `id` matches `^[a-z][a-z0-9_]{0,39}$` and is unique across all map objects.
- Every fixture `sprite` frame exists in the atlas.
- No anchor or the player start sits on a colliding tile or overlaps a fixture.

---

## 5. Sprite Asset Convention (Supplied by the Project Owner)

All files live in `public/assets/sprites/`. All frames are **16×16 px**.

| File | Layout |
|---|---|
| `player.png` | 3 columns × 4 rows. Rows in order: down, left, right, up. Columns: 3 walk frames. Column 0 is the idle frame. |
| `npcs.png` | 3 columns. Each NPC variant is a block of 4 rows with the same layout as `player.png`. `sprite_index` = block index, so variant `v` occupies rows `4v` to `4v+3`. The variant count is the image height ÷ 64 px and is read at runtime. |
| `fixtures.png` + `fixtures.json` | Phaser texture atlas (JSON hash). Frame names match the fixtures' `sprite` property. |
| `icons.png` | 5 frames in one row, in this order: `icon_paper`, `icon_bottle`, `icon_tool`, `icon_trinket`, `icon_hazard`. |

If any of these files or the map is missing during development, the implementing agent creates **clearly named placeholder files** that follow these conventions, so work and tests can continue. Placeholders are replaced when the real assets arrive, and `default_scenario.json` must then be re-validated against the real map.

---

## 6. Data Schema: Load-Time Scenario Blueprint

The OpenAI response must be one JSON object with the structure below. The values are illustrative. `npc_spawns` lists scenario characters only; fixtures and the player start come from the map. `inventory_items` defines item types, not live items.

```json
{
  "scenario_title": "The Alchemist's Heist",
  "genre": "HEIST",
  "intro_text": "Narrative briefing presented to the player on load.",
  "npc_spawns": [
    {
      "entity_id": "guard_captain",
      "display_name": "Captain Vell",
      "sprite_index": 0,
      "placed_at": "anchor_door",
      "inspect_text": "A tired guard with a ring of keys on his belt."
    }
  ],
  "inventory_items": [
    {
      "item_id": "evidence_letter",
      "display_name": "Sealed Letter",
      "inspect_text": "Wax seal bearing the alchemist's crest.",
      "icon_category": "icon_paper"
    }
  ],
  "interactions": [
    {
      "action": "INSPECT",
      "target_1": "desk_study",
      "target_2": null,
      "priority": 10,
      "required_state": [
        { "target_id": "desk_study", "state": "default" }
      ],
      "events": [
        { "event": "show_dialogue", "text": "Under a false bottom you find a sealed letter." },
        { "event": "spawn_item", "new_item_id": "evidence_letter" },
        { "event": "change_state", "target_id": "desk_study", "new_state": "searched" }
      ]
    }
  ]
}
```

### Field Rules and Limits

Unknown fields are rejected. All fields are required. `target_2` is the only field that can be `null`.

| Field | Rule |
|---|---|
| `scenario_title` | 1–40 characters |
| `genre` | One of `MURDER`, `HEIST`, `ESCAPE`, `SABOTAGE`, `DIPLOMACY`. Must equal the genre the engine requested. |
| `intro_text` | 1–600 characters |
| `npc_spawns` | 2 to `min(6, anchor count)` entries |
| `npc_spawns[].entity_id`, `inventory_items[].item_id` | Match `^[a-z][a-z0-9_]{0,39}$` |
| `npc_spawns[].display_name`, `inventory_items[].display_name` | 1–40 characters |
| `npc_spawns[].sprite_index` | Integer from 0 to (NPC variant count − 1) |
| `npc_spawns[].placed_at` | A map anchor ID. Each NPC uses a different anchor. |
| `npc_spawns[].inspect_text`, `inventory_items[].inspect_text` | 1–300 characters |
| `inventory_items` | 3–10 entries |
| `icon_category` | One of `icon_paper`, `icon_bottle`, `icon_tool`, `icon_trinket`, `icon_hazard` |
| `interactions` | 8–40 entries |
| `priority` | Integer, 0–100. Higher wins (Section 7). |
| `required_state` | Array of 0–4 conditions `{ "target_id", "state" }`. Every condition must hold. An empty array means unconditional. |
| `events` | 1–8 events |
| State strings (`state`, `new_state`) | Match `^[a-z][a-z0-9_]{0,29}$` |
| Dialogue / end text | 1–300 characters |

### ID Namespace

**IDs are global.** Every NPC `entity_id`, map fixture `id`, and `item_id` must be unique across all three groups. A target ID therefore always refers to exactly one thing. Anchor IDs are used only in `placed_at` and must not collide with any of these IDs either.

### Mutable State

Every NPC, fixture, and **item type** has a `current_state` string, and they all start as `"default"`. An item type's state belongs to the type as a whole, not to individual units. It stays the same whether the player holds 0 or many units. `required_state` conditions and `change_state` events may target NPCs, fixtures, or item types.

### Events

Each entry in `events` has exactly the fields shown for its type:

| Event | Object shape | Effect |
|---|---|---|
| `spawn_item` | `{ "event": "spawn_item", "new_item_id": "evidence_letter" }` | Adds one unit of a defined item type to the inventory. |
| `destroy_item` | `{ "event": "destroy_item", "target_id": "evidence_letter" }` | Removes one unit. Invalid if the player holds none. |
| `change_state` | `{ "event": "change_state", "target_id": "guard_captain", "new_state": "panicked" }` | Sets the NPC, fixture, or item type's `current_state`. |
| `show_dialogue` | `{ "event": "show_dialogue", "text": "The guard looks away." }` | Shows one dialogue page. |
| `trigger_end` | `{ "event": "trigger_end", "outcome": "WIN", "text": "You escaped with the evidence." }` | Ends the game with `WIN` or `LOSS`. At most once per interaction, and it must be the last event. |

Example: a combine that turns a note and a key into a pass:

```json
[
  { "event": "spawn_item", "new_item_id": "forged_pass" },
  { "event": "destroy_item", "target_id": "evidence_note" },
  { "event": "destroy_item", "target_id": "brass_key" }
]
```

**Atomic execution:** The engine runs the event list in order against a temporary copy of the game state. If any event is invalid (for example, destroying an item the player doesn't hold), nothing is applied and the player sees **"Nothing happens."** Otherwise all changes are committed together. Inventory counts are tracked per item type. A player may hold several units of the same type.

### Target Contract

| Action | `target_1` | `target_2` | Availability |
|---|---|---|---|
| `TALK` | NPC | `null` | — |
| `INSPECT` | NPC, fixture, or item | `null` | An item target must be held (count ≥ 1). |
| `COMBINE` | item | item | Unordered pair. Both must be held; if they're the same type, at least 2 units are needed. |
| `USE` | item | NPC or fixture | Order matters. The item must be held. |

Using an item with no target (e.g. drinking a potion) is not supported.

---

## 7. Universal Interaction State Machine

One generic handler runs every interaction. No item or character has custom hardcoded logic.

```text
[Player input: action, target_1, target_2]
          |
          v
[Candidates = interactions with same action and targets]
[(COMBINE pairs match in either order)]
          |
          v
[Eligible = candidates whose every required_state condition holds]
          |
          +-- Non-empty --> [Pick highest priority; ties -> earliest in array]
          |                         |
          |                         v
          |                 [Atomically execute ordered events]
          |                         |
          |                         +-- Any event invalid --> "Nothing happens."
          |
          +-- Empty --> [INSPECT and target has inspect_text?]
                              |
                              +-- Yes --> show inspect_text
                              +-- No  --> "Nothing happens."
```

- If the selected interaction fails to execute, the engine does **not** try the next candidate.
- `INSPECT` without an applicable interaction shows the target's `inspect_text`, from the map for fixtures and from the scenario for NPCs and items.
- All dialogue comes from `show_dialogue` events or `inspect_text`.

---

## 8. Player Experience and UI

### Resolution and Camera

- Logical game size **640×360**, `pixelArt: true`, `roundPixels: true`, `Scale.FIT` + `CENTER_BOTH`.
- World camera at zoom 2 follows the player, bounded to the map.
- A parallel `UIScene` at zoom 1 draws all UI with Phaser Text at 12 px or larger.

### Controls

| Input | Effect |
|---|---|
| WASD / Arrow keys | Move (4 directions, 80 px/s, diagonals normalized). Navigate menus. |
| `E` / `Enter` | Interact; confirm a menu choice; advance dialogue |
| `Space` | Advance dialogue |
| `I` | Open/close inventory |
| `Esc` | Cancel or close the open menu. If nothing is open, opens the pause menu. |

**Modal rule:** While any dialogue, menu, inventory, pause, or end screen is open, the player stops moving and world input is ignored.

### World Interaction

- **Target selection:** On `E`, find NPCs and fixtures whose center is within **24 px** (1.5 tiles) of the player's center and inside the facing cone (dot product of the facing direction and the direction to the target > 0.5). Pick the nearest. While a valid target exists, show a small "E" prompt above it.
- **Verb menu:** Shows only valid verbs. NPCs: `TALK`, `INSPECT`, `USE`. Fixtures: `INSPECT`, `USE`. `USE` is hidden when the inventory is empty. Choosing `USE` opens an item picker that lists only held items.
- NPCs and fixtures are static, immovable bodies that block the player. NPCs face down when idle.

### Inventory Panel (`I`)

- Lists held item types with icon, name, and count.
- Selecting an item offers `INSPECT`, `COMBINE`, or Cancel.
- `COMBINE` then asks for a second held item. The same type can be picked again only if the player holds at least 2.

### Dialogue and Feedback

- Bottom-of-screen dialogue box. Each `show_dialogue` event (or `inspect_text` / fallback message) is one page. `Space`/`E` moves to the next page.
- After a committed interaction, show a brief non-blocking toast for each `spawn_item` ("Received: Sealed Letter") and each `destroy_item` ("Lost: Brass Key").

### Ending, Pause, and Restart

- On `trigger_end`, first show any earlier dialogue pages from the same interaction. Then show the end screen with the outcome (WIN/LOSS), its text, and a **Play Again** button. Play Again reloads the page, which means a new key prompt and a new scenario.
- **Pause menu (`Esc`):** **Resume** and **Restart**. Restart reloads the page, so a player who is soft-locked can always escape. The winnability check (Section 10) only proves that a win is reachable from the start; later choices can still lock the player out.

---

## 9. LLM Integration and Loading Pipeline

### API Key Handling

- Each launch shows an HTML key-entry form (password input, `autocomplete="off"`) with **Start** and **Play built-in scenario** buttons. An empty key loads `default_scenario.json`.
- The key stays in memory only and is dropped once loading finishes. Never write it to `localStorage`, `sessionStorage`, cookies, or URLs. Never log it, and never put it in prompt content.
- **Development key:** When `import.meta.env.DEV` is true, `VITE_OPENAI_API_KEY` from a git-ignored `.env.local` pre-fills the key field. Read it **only** inside an `import.meta.env.DEV` branch so production builds drop it.
- **Build-time leak check:** A Vite plugin (build only, `closeBundle`) scans `dist/`. The build fails if any file contains the `VITE_OPENAI_API_KEY` value (loaded with `loadEnv`) or matches `sk-[A-Za-z0-9_-]{20,}`.
- Any key used in a browser can be read by that browser's user. Git-ignoring the dev key only stops it from being committed; it does not make a browser key secret.
- Any DOM element that shows text from the LLM or the scenario must set `textContent`, never `innerHTML`.

### Genre Selection

The engine picks a genre uniformly at random from the five, excluding the last genre played. That last genre is stored in `localStorage` under `unscripted.lastGenre`; it is not sensitive. The chosen genre is passed in the prompt, and the response must echo it back.

### Request

```ts
const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true, timeout: 90_000, maxRetries: 0 });
const response = await client.responses.parse({
  model: OPENAI_MODEL,
  input: [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ],
  text: { format: zodTextFormat(ScenarioWireSchema, "scenario") },
});
```

- `OPENAI_MODEL` lives in `src/config.ts`, default `"gpt-6.1-sol"`. Check the exact model ID against OpenAI's model documentation.
- `maxRetries: 0` is required. Otherwise the SDK's built-in retries would send extra requests.
- **Two schema layers:**
  - `ScenarioWireSchema` describes structure only: types, enums, required fields, `target_2` nullable, and events as a union keyed on `event`. It is used for Structured Outputs (strict mode).
  - The validator (Section 10) then enforces lengths, ranges, references, and rules. Many of those constraints can't be expressed in strict Structured Outputs.

### Prompt Contents

The user prompt gives the model:

- the requested genre
- anchors (`id`, `label`)
- fixtures (`id`, `display_name`, `inspect_text`)
- the NPC sprite variant count
- every limit in Section 6
- the global-ID rule
- the target contract
- how `priority` and `required_state` work
- the spawn-once rule
- the winnability requirements
- one worked example interaction

It never includes the player start or any API key.

### Pipeline

1. **Generation request.** On a transport error, timeout, auth error, or refusal, use `default_scenario.json` (no retry).
2. **Parse and fully validate** (Section 10). If valid, go to step 5.
3. **Repair request (at most once).** Same system prompt, plus the previous JSON and the list of validation errors (up to 30), asking for a complete corrected JSON object.
4. Validate the repaired response. If any part of the repair fails, use `default_scenario.json`.
5. Instantiate NPCs, load item definitions as metadata, and load rules. **Never start with a partial or invalid scenario.**

**Diagnostics:**

- In development, `console.warn` the error list. Never log the key.
- In production, the intro screen shows a short "Using the built-in scenario" notice with no details.
- The loading screen shows progress text while requests are in flight.

`default_scenario.json` is written by the implementing agent against the supplied map. It must pass the full validator, including the solver.

---

## 10. Scenario Validation

The validator collects **all** errors as readable messages (they feed the repair request). It returns success only if every check passes.

1. **Structure:** `ScenarioWireSchema` parse, then the field rules and limits in Section 6.
2. **References:**
   - IDs are unique in the global namespace, including against map fixture IDs.
   - Every `placed_at` is a real anchor, and each anchor is used at most once.
   - `sprite_index` is in range.
   - Every target, `required_state.target_id`, and event `target_id` / `new_item_id` refers to a declared entity of an allowed type.
   - `genre` equals the requested genre.
3. **Target contract:** Every interaction's `action` / `target_1` / `target_2` combination follows the contract in Section 6.
4. **Events:** At most one `trigger_end` per interaction, and it must be last.
5. **No dead duplicates:** Reject two interactions with the same action, the same targets (COMBINE pairs compared in either order), and the same set of conditions (order doesn't matter). The lower-priority or later one could never fire.
6. **Spawn-once rule:** Every interaction that contains `spawn_item` must meet at least one of these:
   - **Gate:** It has a `required_state` condition `{ X, S }`, and its events include a `change_state` on `X` to a state other than `S`. It can't fire again until something changes `X` back.
   - **Exchange:** It has at least as many `destroy_item` events as `spawn_item` events, so the total number of items never goes up.
7. **Static winnability:**
   - At least one `trigger_end` with `outcome: "WIN"` exists.
   - Every defined item type is spawned by at least one interaction.
   - Every item used as an `INSPECT`, `COMBINE`, or `USE` target, or as a `destroy_item` target, can be spawned.
   - Every `required_state` state other than `"default"` is set by some `change_state` on that same target.
8. **Reachability solver:** A breadth-first search from the initial state (all states `"default"`, empty inventory) proves that a `WIN` can be reached.
   - A node is the full set of states plus inventory counts, serialized in a canonical form.
   - Edges are the distinct `(action, targets)` inputs found in `interactions`, limited to the ones currently available (Section 6). Each edge is resolved by **the same interaction-engine function the game uses**.
   - Inputs that produce no change are skipped. A `LOSS` is a dead end.
   - The search stops with success when a `WIN` fires.
   - It fails if the states run out, or if it visits more than `SOLVER_MAX_STATES` (config, default 100,000) without finding a win.

---

## 11. Implementation Roadmap

### Phase 1: Project, Map, and Movement

1. Scaffold Vite + TypeScript (strict) + Phaser 3 (pinned) + Vitest + Zod + OpenAI SDK. Set up `.gitignore` and npm scripts.
2. Implement the pure map parser and validator (Section 4). Load the map, tilesets, and sprites (Section 5). Show the boot error screen on map validation failure.
3. Render layers, apply collision, and spawn the player at `player_start` with walk animations. Add camera follow and scaling (Section 8).
4. Spawn fixtures as static bodies. Add facing-cone target selection with the "E" prompt.

### Phase 2: Engine, Validation, and UI

1. Implement the pure game state (`current_state` for NPCs, fixtures, and item types; inventory counts) and the interaction engine (Section 7), including atomic execution.
2. Implement the Zod schemas, the full validator, and the solver (Section 10).
3. Write `default_scenario.json` for the supplied map and validate it.
4. Build the UI: verb menu, item picker, inventory panel with COMBINE, dialogue pages, toasts, pause menu, end screen (Section 8).
5. Play the default scenario from start to finish.

### Phase 3: LLM Integration

1. Add the key-entry form, dev-key pre-fill, and the build-time leak check (Section 9).
2. Add genre selection, prompt construction, the generation request, the one repair request, and the fallback to the default scenario.
3. Add the loading screen and the intro screen (title, intro text, and the built-in-scenario notice when it applies).

---

## 12. Acceptance Criteria

**Unit tests (Vitest) cover at least:**

- **Map parser:** each map validation error.
- **Validator:** at least one failing case for every rule in Section 10, plus a fully valid scenario.
- **Interaction engine:**
  - priority selection and ties going to array order
  - conditions spanning several entities (an NPC, a fixture, and an item type)
  - COMBINE matching in either order
  - same-type COMBINE needing 2 units
  - atomic rollback when a later event is invalid
  - no fall-through to the next candidate after a failed execution
  - the INSPECT `inspect_text` fallback
  - "Nothing happens."
- **Solver:** a winnable scenario, an unwinnable one, and the state cap being exceeded.
- **`default_scenario.json`:** passes full validation against the parsed `map.json`.

**Manual checks:**

- `npm run build` succeeds and `dist/` contains no key.
- With no key, the default scenario plays and can be won.
- With a valid key, a generated scenario loads, or the game falls back after one repair attempt.
- Esc → Restart and Play Again both reload into the key prompt.
