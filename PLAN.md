# Technical Specification: "Unscripted"

## A Low-Scope, Dynamic 2D Detective and Deduction Engine

---

## 1. Executive Summary

**Unscripted** is a lightweight, 2D top-down deduction and scenario game built with **Phaser 3** and **TypeScript**.

The game loads a Tiled tilemap (JSON) supplied by the project owner. The tilemap defines the map layout, collision data, spatial anchors, the player's start position, and fixed world fixtures such as dressers, chests, and desks. The local engine handles tilemap loading, collision, and player movement. Before the loading screen, the player enters an OpenAI API key, and the game asks the OpenAI API (through the OpenAI SDK) to generate the scenario. If the response fails validation, the game sends at most one repair request. The AI acts as an **LLM Scenario Master**, generating a complete, self-contained narrative blueprint. The blueprint covers:

- win/loss conditions triggered by interactions
- character roles
- item definitions (a catalog of every item that can be spawned)
- character placements at the map's spatial anchors
- an interaction rulebook built around a standardized four-verb state machine

Fixed fixtures are world objects, not inventory items. The AI defines interaction rules for those fixtures. When a rule creates an item, the item goes directly into the player's inventory. Inventory items are never placed in the world: interaction outcomes create them and can later remove them.

The engine picks a genre for each scenario from **Murder Mystery**, **Heist**, **Escape**, **Sabotage**, and **Diplomatic Scandal**.

### Non-Goals

Do not build any of the following:

- Visual changes from state changes. A `change_state` updates engine state only; sprites never change.
- NPC movement, despawning, or animation. NPCs stand at their anchors for the whole game.
- Audio.
- Save/load or any persistence other than `unscripted.lastGenre` (Section 9).
- Input other than the keyboard (no mouse-driven gameplay, touch, or gamepad). The HTML overlays (the key-entry form and the loading screen's cancel button) are the only exceptions; they also accept mouse clicks.

---

## 2. Technology Stack and Project Layout

| Concern | Choice |
|---|---|
| Game framework | **Phaser 3**, latest 3.x release, pinned to an exact version in `package.json`. Do **not** use Phaser 4. |
| Physics | Phaser **Arcade Physics** |
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
  config.ts                    # all tunable constants (model ID, timeouts, token limits,
                               # reasoning effort, limits, ranges)
  scenes/                      # BootScene, KeyEntryScene, LoadingScene, IntroScene,
                               # GameScene, UIScene, EndScene
  map/                         # Tiled object parsing + map validation (pure TS, no Phaser)
  scenario/                    # Zod schema, types, validator, solver, prompt, genre
                               # selection, loading pipeline, OpenAI client
  engine/                      # game state, inventory, interaction engine (pure TS, no Phaser)
  ui/                          # dialogue box, verb menu, inventory panel, pause menu, toasts
public/assets/
  PLACEHOLDERS.md              # lists placeholder assets still in use (Section 5)
  maps/map.json
  tilesets/
  sprites/                     # player.png, npcs.png, npcs.json, icons.png
  fonts/                       # ui.png + ui.xml (bitmap font)
  scenarios/                   # default_murder.json, default_heist.json, default_escape.json,
                               # default_sabotage.json, default_diplomacy.json
tests/
```

**Code that must be pure TypeScript with no Phaser imports, and unit-tested under Vitest:** map parsing and validation, the scenario validator, the solver, the inventory, the interaction engine, genre selection, and the loading pipeline. The loading pipeline takes the OpenAI client as a parameter so tests can pass in a fake one. Both the solver and the runtime **must use the same interaction-engine code**, so the solver's verdict always matches real gameplay.

---

## 3. System Responsibilities

### Local Engine (Phaser 3)

- **Tilemap Loading, Anchors, and Fixtures:** Loads the supplied tilemap according to the convention in Section 4.
- **Player Start:** Spawns the player at the single `player_start` object authored in the map. The LLM never chooses or changes it.
- **Collision:** Uses Arcade Physics. Tiles marked `collides = true` block movement. Fixtures and NPCs are 16×16 static bodies centered on their map/anchor point. The player's body is 10×10 px, bottom-centered on the sprite (at the feet), so 1-tile-wide corridors and doorways are easy to pass through.
- **Entity Spawning:** Places scenario characters at anchor coordinates according to the AI's `npc_spawns`. It never places items in the world.
- **Inventory Items:** Items are created only when an interaction runs `spawn_item`, which puts them straight into the player's inventory. `destroy_item` removes them. The inventory is always empty at the start of a game.
- **Core Loop and Input:** Top-down movement (Section 8), tile collision, and the UI described in Section 8.
- **State Engine:** Runs interactions for four universal verbs: `TALK`, `INSPECT`, `COMBINE`, and `USE`.
- **Victory/Defeat Logic:** The game ends only through a `trigger_end` event.

### Remote LLM API (Load-Time Scenario Master)

- **Execution Window:** Runs only during the loading screen: one generation request, plus at most one repair request (Section 9). Gameplay makes no LLM requests.
- **Scenario Generation:** Writes the scenario for the genre the engine picked: plot, secret motives, red herrings, and clear win and loss conditions.
- **Spatial Placement:** Assigns characters to the anchor IDs given in the prompt, choosing locations that fit the story. Rules refer to fixtures by their map IDs. The AI does not place items in the world or choose the player start.
- **Item Definitions:** Fills the `item_definitions` catalog with every item that can be spawned: its name, description, and icon category. Defining an item doesn't create it; it only exists once a rule spawns it.
- **Rulebook Generation:** Returns an array of interactions for the four verbs. Each has a list of conditions (`required_state`) on states and held items, and an ordered event list.

---

## 4. Tilemap Convention (Supplied by the Project Owner)

The map is authored in **Tiled** and exported as JSON to `public/assets/maps/map.json`.

- **Orientation / size:** Orthogonal, **16×16 px** tiles.
- **Tilesets:** Must be **embedded** in the map, not external `.tsx` files. Tileset images go in `public/assets/tilesets/`. The game uses each tileset's name in Tiled as its Phaser texture key when loading the image.
- **Two-phase loading:** The game can't know which tileset images to load until it has read the map. `BootScene` loads `map.json` first, then loads each tileset image from `public/assets/tilesets/<file name>`. `<file name>` is the last part of the tileset's `image` path in the JSON. Tiled stores that path relative to the map, e.g. `../tilesets/interior.png` → `interior.png`.
- **Tile layers:**
  - The map has exactly four tile layers, named `floor`, `walls`, `furniture`, and `borders`. They are drawn in the order they appear in the map file (bottom to top).
    - `floor`: floor tiles.
    - `walls`: wall tiles.
    - `furniture`: furniture and other decoration tiles. A fixture's art is drawn here.
    - `borders`: border and trim tiles.
  - Collision is per tile, not per layer. Any tile with the boolean custom property `collides = true` (set on the tile in its tileset) blocks movement, on whichever layer it is painted. The game calls `setCollisionByProperty({ collides: true })` on **every** tile layer. Currently only the `borders` tileset tiles have `collides = true`; the `walls` and `interior` tilesets have none yet, and the map owner may add it later without any code change.
- **Object layer `objects`:** Every object's Tiled **Class** is one of `anchor`, `fixture`, or `player_start`. Tiled exports Class as `type` in JSON; read `type` first, then `class`. Use point objects. If a rectangle object is used, its position is the rectangle's center. Tile objects (objects with a `gid`) are not allowed, because Tiled positions them by their bottom-left corner.
- **Positions:** An object's position is the **center** of the sprite drawn there (NPC or player) or of the fixture's tile art (fixtures draw no sprite). For overlap checks, fixtures and NPCs occupy the 16×16 square centered on that point.

| Class | Custom properties | Notes |
|---|---|---|
| `anchor` | `id` (string, required), `label` (string, required, 1–80 characters) | `label` tells the AI where the anchor is, e.g. "beside the front door". At least 2 anchors. |
| `fixture` | `id`, `display_name` (1–40 characters); `inspect_text` (string, optional, 1–300 characters when present) | Invisible interaction point. The fixture's art is drawn in the tile layers; the game draws no sprite for it. |
| `player_start` | none | Exactly one. |

**Map author guarantees (not checked automatically):** Any subset of anchors may be occupied by NPCs, since the AI chooses which anchors to use. The map is authored so that, **even with every anchor occupied**, no NPC blocks a path. The player can then walk from `player_start` to within interaction range (Section 8) of every fixture and every anchor.

**Boot validation:** These checks run when the game boots. A failure is a developer error: show a full-screen error listing every problem and stop. There is no fallback map.

- Tile layers `floor`, `walls`, `furniture`, and `borders`, and object layer `objects`, exist.
- There is exactly one `player_start`.
- There are at least 2 anchors.
- No object is a tile object (has a `gid`).
- Every required property is present and non-empty, and every text property is within its length limit.
- Every `id` matches `^[a-z][a-z0-9_]{0,39}$` and is unique across all map objects.
- Bodies don't overlap (checked as rectangles; touching edges is fine). Each anchor's NPC body is the 16×16 square centered on the anchor. The player-start body is the player's 10×10 feet body (Section 3) for a sprite centered on `player_start`.
  - No anchor's NPC body overlaps a colliding tile, a fixture's 16×16 footprint, or another anchor's NPC body.
  - The player-start body doesn't overlap a colliding tile, a fixture's footprint, or any anchor's NPC body.
- `npcs.json` is valid, and its length equals the NPC variant count (Section 5).
- All five default scenarios pass the full scenario validator, including the solver, against the parsed map (Section 9).

---

## 5. Sprite and Font Asset Convention (Supplied by the Project Owner)

Sprite files live in `public/assets/sprites/`. All sprite frames are **16×16 px**.

| File | Layout |
|---|---|
| `player.png` | 3 columns × 4 rows. Rows in order: down, left, right, up. Columns: 3 walk frames. Column 0 is the idle frame. |
| `npcs.png` | 3 columns. Each NPC variant is a block of 4 rows with the same layout as `player.png`. `sprite_index` = block index, so variant `v` occupies rows `4v` to `4v+3`. The variant count is the image height ÷ 64 px and is read at runtime. |
| `npcs.json` | JSON array of strings, one short appearance description (1–80 characters) per NPC variant, in `sprite_index` order, e.g. `["elderly man in a grey suit", "young woman in a maid's uniform"]`. Its length must equal the variant count. The descriptions are sent in the prompt so the AI can pick fitting sprites. |
| `icons.png` | 5 frames in one row, in this order: `icon_paper`, `icon_bottle`, `icon_tool`, `icon_trinket`, `icon_hazard`. |

The UI font lives in `public/assets/fonts/` as a pixel-art bitmap font in BMFont format (`ui.png` + `ui.xml`). It's loaded with `load.bitmapFont` and used for **all** in-game text, at integer multiples of its native size.

**Placeholders:** If any of these files or the map is missing during development, the implementing agent creates placeholder files that follow these conventions, so work and tests can continue. Placeholders use the **real file names and paths** so the game loads them unchanged. Every placeholder is listed in `public/assets/PLACEHOLDERS.md`. When a real asset replaces a placeholder, remove its entry from that file. When the real map arrives, all five default scenarios must be re-validated against it.

---

## 6. Data Schema: Load-Time Scenario Blueprint

The OpenAI response must be one JSON object with the structure below. The values are illustrative. `npc_spawns` lists scenario characters only; fixtures and the player start come from the map. `item_definitions` is a **catalog** of every item that can be spawned during the game. It is not a starting inventory: the player always starts with nothing, and an item isn't in play until a `spawn_item` event gives it to the player.

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
  "item_definitions": [
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

Unknown fields are rejected. All fields are required. `target_2` and `required_state[].state` are the only fields that can be `null`.

| Field | Rule |
|---|---|
| `scenario_title` | 1–40 characters |
| `genre` | One of `MURDER`, `HEIST`, `ESCAPE`, `SABOTAGE`, `DIPLOMACY`. Must equal the genre the engine requested. |
| `intro_text` | 1–600 characters |
| `npc_spawns` | 2 to `min(6, anchor count)` entries |
| `npc_spawns[].entity_id`, `item_definitions[].item_id` | Match `^[a-z][a-z0-9_]{0,39}$` |
| `npc_spawns[].display_name`, `item_definitions[].display_name` | 1–40 characters |
| `npc_spawns[].sprite_index` | Integer from 0 to (NPC variant count − 1) |
| `npc_spawns[].placed_at` | A map anchor ID. Each NPC uses a different anchor. |
| `npc_spawns[].inspect_text`, `item_definitions[].inspect_text` | 1–300 characters |
| `item_definitions` | 3–10 entries |
| `icon_category` | One of `icon_paper`, `icon_bottle`, `icon_tool`, `icon_trinket`, `icon_hazard` |
| `interactions` | 8–40 entries |
| `required_state` | Array of 0–4 conditions `{ "target_id", "state" }` (see Conditions below). Every condition must hold. An empty array means unconditional. A `target_id` may appear at most once per array. |
| `events` | 1–8 events |
| State strings (`state` when not `null`, `new_state`) | Match `^[a-z][a-z0-9_]{0,29}$` |
| Dialogue / end text | 1–300 characters |

### ID Namespace

**IDs are global.** Every NPC `entity_id`, map fixture `id`, and `item_id` must be unique across all three groups. A target ID therefore always refers to exactly one thing. Anchor IDs are used only in `placed_at` and must not collide with any of these IDs either.

### Mutable State

**Every ID is exactly one thing.** Each `item_id` is a single, unique object, never a stack or a count. At any moment the player either holds it or doesn't. If a scenario needs two similar items, it defines two IDs (e.g. `brass_key_1`, `brass_key_2`).

Every NPC, fixture, and item has one `current_state` string, and they all start as `"default"`. **States only move forward:** once something leaves a state, it never returns to it (Section 10). `required_state` conditions and `change_state` events may target NPCs, fixtures, or items. Because a `change_state` must name the state it comes from in a condition, and a condition on an item requires holding it, an item's state can only change while the player holds it.

The engine keeps this runtime state in memory. It is not part of the scenario JSON:

```json
{
  "states": { "guard_captain": "panicked", "desk_study": "searched", "brass_key_1": "default" },
  "held_items": ["brass_key_1", "evidence_letter"]
}
```

### Conditions

Each `required_state` entry is `{ "target_id", "state" }`. What it checks depends on what `target_id` refers to:

| Target | `state` | Holds when |
|---|---|---|
| NPC or fixture | A state string (never `null`) | The entity's `current_state` equals `state`. |
| Item | `null` | The player holds the item. |
| Item | A state string | The player holds the item **and** its `current_state` equals `state`. |

A condition on an item always requires the player to hold it, because an item that isn't held doesn't exist in the game. A condition can't check the state of an item the player isn't holding.

Example: `{ "target_id": "bribe", "state": null }` means "the player has the bribe".

### Events

Each entry in `events` has exactly the fields shown for its type:

| Event | Object shape | Effect |
|---|---|---|
| `spawn_item` | `{ "event": "spawn_item", "new_item_id": "evidence_letter" }` | Gives the item to the player. Invalid if the player already holds it. The validator's one-source and spawn-once rules (Section 10) mean every item is given at most once per game, so this can't fail in a valid scenario. |
| `destroy_item` | `{ "event": "destroy_item", "target_id": "evidence_letter" }` | Removes the item from the inventory. Invalid if the player doesn't hold it. The validator only allows removing an item the interaction already requires the player to hold (Section 10), so this can't fail in a valid scenario. |
| `change_state` | `{ "event": "change_state", "target_id": "guard_captain", "new_state": "panicked" }` | Sets the NPC, fixture, or item's `current_state`. |
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

**Atomic execution:** The engine runs the event list in order against a temporary copy of the game state. If any event is invalid (for example, destroying an item the player doesn't hold, or spawning one they already hold), nothing is applied and the player sees **"Nothing happens."** Otherwise all changes are committed together. The validator (Section 10) ensures no event can be invalid in a valid scenario, so this is a safety net that also protects against engine bugs.

### Target Contract

| Action | `target_1` | `target_2` | Availability |
|---|---|---|---|
| `TALK` | NPC | `null` | — |
| `INSPECT` | NPC, fixture, or item | `null` | An item target must be held. |
| `COMBINE` | item | item | Unordered pair of two **different** items. Both must be held. |
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
[Eligible = candidates whose every required_state condition holds (Section 6, Conditions)]
          |
          +-- Non-empty --> [Pick the one with the most conditions; ties -> earliest in array]
          |                         |
          |                         v
          |                 [Atomically execute ordered events]
          |                         |
          |                         +-- Any event invalid --> "Nothing happens."
          |
          +-- Empty --> [INSPECT and target has inspect_text?]
                              |
                              +-- Yes --> show inspect_text
                              +-- No  --> [TALK?]
                                            |
                                            +-- Yes --> "<NPC display_name> has nothing to say."
                                            +-- No  --> "Nothing happens."
```

- If the selected interaction fails to execute, the engine does **not** try the next candidate.
- `INSPECT` without an applicable interaction shows the target's `inspect_text`, from the map for fixtures and from the scenario for NPCs and items.
- `TALK` without an applicable interaction shows "<NPC display_name> has nothing to say." A selected `TALK` interaction that fails to execute still shows "Nothing happens."
- All dialogue comes from `show_dialogue` events, `inspect_text`, or these fallback messages.
- **Engine result:** The interaction engine is one pure function, `(scenario, state, input) → result`. The result says whether an interaction was committed, and gives the new state, the dialogue pages, the item spawn/destroy notices for toasts, and the **ending** (`WIN`, `LOSS`, or none). The game and the solver (Section 10) both call this same function.

---

## 8. Player Experience and UI

### Resolution and Camera

- Logical game size **640×360**, `pixelArt: true`, `roundPixels: true`, `Scale.FIT` + `CENTER_BOTH`.
- World camera at zoom 2 follows the player, bounded to the map.
- A parallel `UIScene` at zoom 1 draws all UI. All in-game text uses the bitmap font (Section 5) at an integer scale, never regular Phaser Text, with glyphs at least 12 px tall on the 640×360 canvas.

### Controls

| Input | Effect |
|---|---|
| WASD / Arrow keys | Move in 8 directions at 80 px/s (diagonal speed normalized to 80 px/s). Navigate menus. |
| `E` / `Enter` | Interact; confirm a menu choice; advance dialogue |
| `Space` | Advance dialogue |
| `I` | Open/close inventory |
| `Esc` | Cancel or close the open menu. If nothing is open, opens the pause menu. |

**Modal rule:** While any dialogue, menu, inventory, pause, or end screen is open, the player stops moving and world input is ignored.

**Facing:** The player always faces one of 4 directions (down, left, right, up), which picks the walk-animation row and the interaction cone. When moving diagonally, the horizontal direction wins (e.g. up-left faces left). When the player stops, the last facing direction stays.

### World Interaction

- **Target selection:** On `E`, find NPCs and fixtures whose center is within **24 px** (1.5 tiles) of the player's center and inside the facing cone (dot product of the facing direction and the direction to the target > 0.5). Pick the nearest. While a valid target exists, show a small "E" prompt above it.
- **Verb menu:** Shows only valid verbs. NPCs: `TALK`, `INSPECT`, `USE`. Fixtures: `INSPECT`, `USE`. `USE` is hidden when the inventory is empty. Choosing `USE` opens an item picker that lists only held items.
- NPCs and fixtures are static, immovable 16×16 bodies that block the player (Section 3). Fixtures have no sprite; they are invisible bodies over the tile art, so the "E" prompt is the only cue that a fixture is interactive. NPCs face down when idle.

### Inventory Panel (`I`)

- Lists held items with icon and name.
- Selecting an item offers `INSPECT`, `COMBINE`, or Cancel. `COMBINE` is hidden when fewer than 2 items are held.
- `COMBINE` then asks for a second, different held item.

### Dialogue and Feedback

- Bottom-of-screen dialogue box. Each `show_dialogue` event (or `inspect_text` / fallback message) is one page. `Space`/`E` moves to the next page.
- After a committed interaction, show a brief non-blocking toast for each `spawn_item` ("Received: Sealed Letter") and each `destroy_item` ("Lost: Brass Key").

### Ending, Pause, and Restart

- On `trigger_end`, first show any earlier dialogue pages from the same interaction. Then show the end screen with the outcome (WIN/LOSS), its text, and a **Play Again** button. Play Again reloads the page, which means a new key prompt and a new scenario.
- **Pause menu (`Esc`):** **Resume**, **Briefing**, and **Restart**. Briefing shows the scenario title and `intro_text` again, and `Esc` returns to the pause menu. Restart reloads the page, so a player who is soft-locked can always escape. The winnability check (Section 10) only proves that a win is reachable from the start; later choices can still lock the player out.

---

## 9. LLM Integration and Loading Pipeline

### API Key Handling

- Each launch shows the key-entry form: a **plain HTML form** (not a Phaser DOM element) placed over the game canvas and removed from the DOM after submit. It has a password input (`autocomplete="off"`) and **Start** and **Play built-in scenario** buttons. Start with an empty key does the same as Play built-in scenario: it loads the default scenario for the chosen genre.
- The key stays in memory only and is dropped once loading finishes or the key is rejected. Never write it to `localStorage`, `sessionStorage`, cookies, or URLs. Never log it, and never put it in prompt content.
- **Rejected key:** If OpenAI returns 401 or 403, drop the key, return to the key-entry form with an empty field, and show "API key was rejected." The player can enter another key or play the built-in scenario.
- **Development key:** When `import.meta.env.DEV` is true, `VITE_OPENAI_API_KEY` from a git-ignored `.env.local` pre-fills the key field. Read it **only** inside an `import.meta.env.DEV` branch so production builds drop it.
- **Build-time leak check:** A Vite plugin (build only, `closeBundle`) scans `dist/`. The build fails if any file contains the `VITE_OPENAI_API_KEY` value (loaded with `loadEnv`; this check is skipped when the value is unset or empty) or matches `(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}`. The lookbehind makes `sk-` match only at the start of a token, so ordinary strings such as `task-…` or `desk-…` in minified code don't trigger it.
- Any key used in a browser can be read by that browser's user. Git-ignoring the dev key only stops it from being committed; it does not make a browser key secret.
- Any DOM element that shows text from the LLM or the scenario must set `textContent`, never `innerHTML`.

### Genre Selection

The genre is picked **once per page load, on every path**, including the built-in scenario path. It's picked when the player first presses Start or Play built-in scenario. The engine chooses uniformly at random from the five genres, excluding the last genre played, and writes the result to `localStorage` under `unscripted.lastGenre` right away. That value is not sensitive. If the player goes back to the key form after a rejected key, the same genre is reused.

The chosen genre is passed in the prompt, and the response must echo it back. Every fallback loads the default scenario **for the chosen genre** (see Default Scenarios below).

### Request

```ts
const client = new OpenAI({
  apiKey,
  dangerouslyAllowBrowser: true,
  timeout: REQUEST_TIMEOUT_MS,
  maxRetries: 0,
});
const response = await client.responses.parse(
  {
    model: OPENAI_MODEL,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    text: { format: zodTextFormat(ScenarioWireSchema, "scenario") },
    reasoning: { effort: REASONING_EFFORT },
    max_output_tokens: MAX_OUTPUT_TOKENS,
    store: false,
  },
  { signal: abortController.signal },
);
```

- These constants live in `src/config.ts`:
  - `OPENAI_MODEL`: default `"gpt-6.1-sol"`. Check the exact model ID against OpenAI's model documentation.
  - `REQUEST_TIMEOUT_MS`: default `120_000`, per request.
  - `MAX_OUTPUT_TOKENS`: default `32_000`. Reasoning tokens count toward it.
  - `REASONING_EFFORT`: default `"medium"`. Omit the `reasoning` parameter if the chosen model doesn't support it.
- `maxRetries: 0` is required. Otherwise the SDK's built-in retries would send extra requests.
- `store: false` stops OpenAI from storing the response.
- The `AbortController` lets the loading screen's cancel button (see Pipeline) stop a request in flight.
- **Two schema layers:**
  - `ScenarioWireSchema` describes structure only: types, enums, required fields, `target_2` and `required_state[].state` nullable, and events as a union keyed on `event`. It is used for Structured Outputs (strict mode).
  - The validator (Section 10) then enforces lengths, ranges, references, and rules. Many of those constraints can't be expressed in strict Structured Outputs.

### Prompt Contents

The user prompt gives the model:

- the requested genre
- anchors (`id`, `label`)
- fixtures (`id`, `display_name`, `inspect_text`)
- the NPC sprite variants: each `sprite_index` with its description from `npcs.json`
- every limit in Section 6
- the global-ID rule
- that `item_definitions` is a catalog and the inventory starts empty
- the target contract
- how `required_state` works, including that a condition on an item requires the player to hold it (`state: null` checks only that)
- how one interaction is chosen: the eligible interaction with the most conditions wins, so an interaction with no conditions acts as the fallback; ties go to the earliest in the array
- that `destroy_item` may only remove one of the interaction's own item targets or an item named in its `required_state`
- that each item is given by exactly one interaction (a second source needs a second item ID)
- that states only move forward: every `change_state` on a target needs a condition on that target's current state, at most one `change_state` per target per interaction, and no target may return to a state it has left
- the spawn-once rule (Gate or Consume, for any action)
- the winnability requirements
- one worked example interaction

It never includes the player start or any API key.

### Pipeline

The pipeline is pure TypeScript. It receives the OpenAI client (or a factory for it) as a parameter so tests can substitute a fake (Section 12).

1. **Generation request.** Classify the result:

   | Result | Action | Reason shown on the intro screen |
   |---|---|---|
   | Parsed successfully | Go to step 2 | — |
   | 401 / 403 | Return to the key form (see Rejected key above) | — |
   | Timeout | Fall back, no repair | "Request timed out" |
   | Network or other API error (429, 5xx, 400, …) | Fall back, no repair | "Couldn't reach OpenAI" |
   | Refusal | Fall back, no repair | "The model declined the request" |
   | Incomplete (`status: "incomplete"`, e.g. hit `max_output_tokens`) or output that can't be parsed | Fall back, no repair | "The response was incomplete" |
   | Cancelled by the player | Fall back, no repair | none |

2. **Fully validate** (Section 10). If valid, go to step 5.
3. **Repair request (at most once).** Send these messages, in order:
   1. the same system prompt
   2. the same original user prompt
   3. the previous response JSON, as an `assistant` message
   4. a new `user` message listing the validation errors (up to 30) and asking for a complete corrected JSON object
4. **Validate the repaired response.** If the repair request fails for any reason other than cancellation, or its result is invalid, fall back with the reason "The generated scenario was invalid". Cancelling during the repair request falls back with no notice, the same as during generation.
5. **Start.** Instantiate NPCs, load item definitions as metadata, and load rules. **Never start with a partial or invalid scenario.**

"Fall back" means: load the default scenario for the chosen genre and show "<reason> — using the built-in scenario." on the intro screen. No notice is shown when the player chose the built-in scenario on purpose (empty key, the Play built-in scenario button, or the cancel button).

**Loading screen:** Shows progress text while requests are in flight ("Writing your scenario…", "Fixing a few problems…"). It also shows a **Use built-in scenario** HTML button over the canvas. Clicking it aborts the in-flight request through the `AbortController`, ignores any late response, and loads the chosen genre's default scenario.

**Diagnostics:**

- In development, `console.warn` the error list and the failure classification. Never log the key.
- In production, show only the short reason above. Never show validation details, raw API error messages, or anything containing the key.

### Default Scenarios

There are five default scenarios, one per genre, in `public/assets/scenarios/`:

- `default_murder.json`
- `default_heist.json`
- `default_escape.json`
- `default_sabotage.json`
- `default_diplomacy.json`

Each one's `genre` matches its file name. The implementing agent writes all five against the supplied map. Each must pass the full validator, including the solver, with its own genre as the requested genre. The game validates all five at boot (Section 4); any failure shows the boot error screen.

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
4. **Events and conditions:**
   - At most one `trigger_end` per interaction, and it must be last.
   - An interaction can't spawn the same item twice.
   - `COMBINE` can't name the same item as both targets.
   - A `required_state` can't list the same `target_id` more than once, because conditions like `{ butler: "calm" }` and `{ butler: "angry" }` can never both hold.
   - A condition on an NPC or fixture must have a non-`null` `state`.
   - **Only remove held items:** Every `destroy_item` must name one of the interaction's own item targets or an item named in its `required_state`. Both are guaranteed to be held when the interaction fires, so the removal can't fail.
   - **No events that always fail:** Read the events in order and track which items are certainly held. At the start, the interaction's own item targets and the items named in its `required_state` are held, because the target contract and the conditions require it.
     - Reject a `spawn_item` of an item that is held at that point (e.g. `USE brass_key → door` that spawns `brass_key` without destroying it first).
     - Reject a `destroy_item` of an item already destroyed earlier in the same interaction with no `spawn_item` of it in between.
5. **Forward-only states:** An NPC, fixture, or item never returns to a state it has left.
   - Every `change_state` on `X` needs a condition `{ X, S }` with a non-`null` state in the same interaction, and its `new_state` must differ from `S`. This makes every change a known step `S → new_state`.
   - An interaction can have at most one `change_state` per target.
   - For each target, collect the `S → new_state` steps from all interactions. They must not form a loop (check with a depth-first search). Report each loop with its states and interaction indexes, e.g. `"butler's states loop: default → helped → default (interactions #3, #9). States can only move forward."`
6. **No dead interactions:** Reject a later interaction B if an earlier interaction A has the same action, the same targets (COMBINE pairs compared in either order), the same number of conditions, and every condition of A is guaranteed whenever B's conditions hold. A condition `{ X, S }` is guaranteed by the same condition in B. An item condition `{ X, null }` is guaranteed by any condition on `X` in B. In that case A is eligible whenever B is and wins the tie, so B could never fire. This includes exact duplicates. Interactions with different condition counts never block each other this way, because the one with more conditions wins whenever it is eligible.
7. **Spawn-once rule:** Every interaction that contains `spawn_item` must meet at least one of these:
   - **Gate:** It has a condition `{ X, S }` with a non-`null` state, and its events include a `change_state` on `X`. Because states only move forward, `X` never returns to `S`, so the interaction can never fire again.
   - **Consume:** Its events destroy an item the interaction requires the player to hold (one of its own item targets or an item named in its `required_state`) and don't spawn that item again later. This applies to every action, e.g. `INSPECT sealed_envelope` that spawns `letter` and destroys `sealed_envelope`. It could fire again only if that item were given again.
   - **Result:** Combined with one source per item (rule 8), every item is given at most once per game. A gated interaction never fires twice, and a consuming one would need its item to be given a second time first. So `spawn_item` can't fail in a valid scenario.
8. **Static winnability:**
   - At least one `trigger_end` with `outcome: "WIN"` exists.
   - **One source per item:** Every item in `item_definitions` is spawned by **exactly one** interaction. Each item therefore has a single, known source. A scenario that needs a second way to get a similar item defines a second item ID.
   - Every non-`null` `required_state` state other than `"default"` is set by some `change_state` on that same target.
9. **Reachability solver:** A breadth-first search from the initial state (all states `"default"`, empty inventory) proves that a `WIN` can be reached.
   - A node is the full set of states plus the set of held items, serialized in a canonical form.
   - Edges are the distinct `(action, targets)` inputs found in `interactions`, limited to the ones currently available (Section 6). Each edge is resolved by **the same interaction-engine function the game uses** (Section 7).
   - For each edge, check the result's **ending first**. A `WIN` ends the search with success, even if the interaction changed no state. A `LOSS` is a dead end. Only after that are inputs that produce no change skipped.
   - It fails if the states run out, or if it visits more than `SOLVER_MAX_STATES` (config, default 100,000) without finding a win.
   - **Failure diagnostics** (these feed the repair request): if the cap was exceeded, say so. Otherwise, using everything the search explored, report:
     - each defined item that was never held
     - each `(target_id, state)` pair with a non-`null` state used in a `required_state` that was never reached
     - each `WIN` interaction (by array index) that never became eligible, with its unmet conditions

     Example: `"WIN interaction #12 never became eligible: vault_door is never 'unlocked'"`.

---

## 11. Implementation Roadmap

### Phase 1: Project, Map, and Movement

1. Scaffold Vite + TypeScript (strict) + Phaser 3 (pinned) + Vitest + Zod + OpenAI SDK. Set up `.gitignore` and npm scripts. Create any missing assets as placeholders and list them in `public/assets/PLACEHOLDERS.md` (Section 5).
2. Implement the pure map parser and validator (Section 4). Load `map.json` first, then the tilesets, sprites, `npcs.json`, and bitmap font (Sections 4–5). Show the boot error screen on validation failure.
3. Render layers, apply Arcade Physics collision, and spawn the player at `player_start` with its feet-sized body, 8-way movement, 4-way facing, and walk animations. Add camera follow and scaling (Section 8).
4. Spawn fixtures as 16×16 static bodies. Add facing-cone target selection with the "E" prompt.

### Phase 2: Engine, Validation, and UI

1. Implement the pure game state (`current_state` for NPCs, fixtures, and items; the set of held items) and the interaction engine (Section 7), including atomic execution and the result type with the ending.
2. Implement the Zod schemas, the full validator, and the solver with failure diagnostics (Section 10).
3. Write the five default scenarios (one per genre) for the supplied map. Validate them in tests and at boot.
4. Build the UI with the bitmap font: verb menu, item picker, inventory panel with COMBINE, dialogue pages, toasts, pause menu with Briefing, end screen (Section 8).
5. Play each default scenario from start to finish.

### Phase 3: LLM Integration

1. Add the HTML key-entry form, dev-key pre-fill, rejected-key handling, and the build-time leak check (Section 9).
2. Add genre selection, prompt construction (including the NPC sprite descriptions), the generation request, failure classification, the one repair request, and the fallback to the chosen genre's default scenario. Write the pipeline so a fake client can be passed in.
3. Add the loading screen with its **Use built-in scenario** cancel button, and the intro screen (title, intro text, and the fallback reason when it applies).

---

## 12. Acceptance Criteria

**Unit tests (Vitest) cover at least:**

- **Map parser / boot validation:** each map validation error, including tile objects, text-length limits, and an `npcs.json` length mismatch.
- **Validator:** at least one failing case for every rule in Section 10, plus a fully valid scenario.
- **Interaction engine:**
  - the eligible interaction with the most conditions winning (a no-condition interaction acts only as a fallback), and ties going to array order
  - conditions spanning several entities (an NPC, a fixture, and an item)
  - item conditions: a `null` state requires only possession, a state string requires possession and that state, and neither holds when the item isn't held
  - COMBINE matching in either order
  - spawning an already-held item failing the whole interaction
  - atomic rollback when a later event is invalid
  - no fall-through to the next candidate after a failed execution
  - the INSPECT `inspect_text` fallback
  - the TALK fallback "<NPC display_name> has nothing to say."
  - "Nothing happens."
  - the result reporting `WIN` / `LOSS` endings
- **Solver:**
  - a winnable scenario
  - an unwinnable one, with the expected diagnostics
  - the state cap being exceeded
  - a `WIN` whose interaction changes no state (only `show_dialogue` + `trigger_end`) still being found
- **Loading pipeline (fake OpenAI client):**
  - a valid first response starts the game with no repair
  - timeout, network/API error, refusal, and incomplete response each fall back with no repair and the right reason
  - 401/403 returns to the key form
  - an invalid response triggers **exactly one** repair, whose messages include the original user prompt, the previous JSON, and the errors
  - a valid repair starts the game
  - an invalid or failed repair falls back
  - cancelling falls back with no notice
  - the client is created with `maxRetries: 0`, and requests send `store: false`
- **Genre selection:** never repeats `unscripted.lastGenre`, and updates it on every run, including the built-in path.
- **Default scenarios:** all five pass full validation against the parsed `map.json`, each with its own genre.

**Manual checks:**

- `npm run build` succeeds and `dist/` contains no key.
- With no key, the default scenario for the chosen genre plays and can be won.
- With a valid key, a generated scenario loads, or the game falls back after one repair attempt.
- With an invalid key, the game returns to the key form with "API key was rejected."
- The loading screen's **Use built-in scenario** button cancels a request in flight and starts the default scenario.
- Esc → Restart and Play Again both reload into the key prompt.
