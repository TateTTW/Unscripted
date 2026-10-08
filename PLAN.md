# Technical Specification: "Unscripted"

## A Low-Scope, Dynamic 2D Detective and Deduction Engine

---

## 1. Executive Summary

**Unscripted** is a lightweight, 2D top-down deduction and scenario game.

The game loads a Phaser 3 tilemap supplied as a JSON asset. The tilemap defines the map layout, collision data, spatial anchors, and fixed world fixtures such as dressers, chests, and desks. The local engine handles tilemap loading, collision, and player movement. During the initial loading screen, a single request is made to the OpenAI API using the OpenAI SDK. The AI acts as an **LLM Scenario Master**, generating a complete, self-contained narrative blueprint—including dynamic win/loss conditions, character roles, inventory-item definitions, character placements at spatial anchors defined in the map, and an interaction rulebook built around a standardized four-verb state machine.

Fixed fixtures are world objects, not inventory items. The AI defines interaction rules for those fixtures; when a rule creates an item, the item is instantiated directly in the player's inventory. Inventory items are never placed in the world: they are created by interaction outcomes and can then be added to or removed from the player's inventory.

Scenarios dynamically rotate across genres including **Murder Mysteries**, **Heists**, **Escapes**, **Sabotage**, and **Diplomatic Scandals**.

---

## 2. System Responsibilities

### Local Engine (Phaser 3)

- **Tilemap Loading, Anchors, and Fixtures:** Loads the supplied Phaser 3 tilemap JSON asset, including its tile layers, collision data, named spatial anchors (such as `anchor_door`, `anchor_corner`, and `anchor_center`), and fixed interactive world fixtures (such as dressers, chests, and desks). Fixtures are defined in the tilemap and are not inventory items.
- **Collision:** Configures tile collisions from the map's collision layer or tile properties.
- **Entity Spawning:** Instantiates scenario characters at local anchor coordinates based on the AI JSON's character spawn mapping. It does not spawn inventory items into the world.
- **Inventory Items:** Creates inventory items only when an interaction rule generates them, adding them directly to the player's inventory. Items can be removed from the inventory by interaction outcomes.
- **Core Loop and Input:** Provides standard 2D top-down movement, tile collisions, and UI menus.
- **State Engine:** Executes interactions across four universal verbs: `TALK`, `INSPECT`, `COMBINE`, and `USE`.
- **Victory/Defeat Logic:** Evaluates rule triggers returned by the interaction engine and transitions to win/loss states.

### Remote LLM API (Load-Time Scenario Master)

- **Execution Window:** Executes strictly **once** during the game initialization loading screen.
- **Scenario Generation:** Selects a scenario genre (Murder, Heist, Escape, Sabotage, etc.), establishes plot context, secret motives, red herrings, and clear victory/defeat conditions.
- **Spatial Placement:** Assigns scenario characters to the local map anchor IDs provided in the request prompt, based on logical environmental context. It targets fixed fixtures by their tilemap entity IDs in interaction rules; it does not place items in the world.
- **Inventory Item Definitions:** Defines the names, descriptions, and icon categories of items that interaction rules may generate. These definitions do not create item instances; an item exists in play only after an interaction creates it in the player's inventory.
- **Rulebook Generation:** Returns a structured array of interaction outcomes matching the four-verb system, supporting optional state gating (`required_state`) and triggering five standardized engine events: `spawn_item`, `destroy_item`, `change_state`, `show_dialogue`, and `trigger_end`.

---

## 3. Data Schema: Load-Time Scenario Blueprint

The OpenAI API response must provide a single JSON object matching the following structure. The values below are illustrative placeholders. `npc_spawns` describes scenario characters only; fixed fixtures are authored in the tilemap, while `inventory_items` are definitions that become live items only when an interaction creates them.

```json
{
  "scenario_title": "The Alchemist's Heist",
  "genre": "MURDER | HEIST | ESCAPE | SABOTAGE | DIPLOMACY",
  "intro_text": "Narrative briefing presented to the player on load",
  "npc_spawns": [
    {
      "entity_id": "character_guard_captain",
      "display_name": "String",
      "sprite_index": 0,
      "placed_at": "Anchor ID supplied in the request",
      "inspect_text": "String"
    }
  ],
  "inventory_items": [
    {
      "item_id": "evidence_letter",
      "display_name": "String",
      "inspect_text": "String",
      "icon_category": "icon_paper | icon_bottle | icon_tool | icon_trinket | icon_hazard"
    }
  ],
  "general_dialogue": {
    "character_entity_id": {
      "about_self": "String",
      "about_situation": "String",
      "about_suspicion": "String"
    }
  },
  "interactions": [
    {
      "action": "TALK | INSPECT | COMBINE | USE",
      "target_1": "Fixture entity ID, character entity ID, or inventory item ID",
      "target_2": "Entity ID, item ID, or null",
      "required_state": {
        "target_id": "Entity ID whose state must match",
        "state": "bribed | unlocked | panicked"
      },
      "result": {
        "event": "spawn_item | destroy_item | change_state | show_dialogue | trigger_end",
        "new_item_id": "Optional inventory item ID; created and added to inventory only when this interaction runs",
        "target_id": "Optional entity or item ID",
        "new_state": "Optional state",
        "outcome": "WIN | LOSS",
        "text": "Dialogue or narrative output"
      }
    }
  ]
}
```

The `inventory_items` array supplies metadata only. An item instance is created and added to the player's inventory only when an interaction's `spawn_item` result references its `item_id`. No interaction places an item into the world.

## 4. Universal Interaction State Machine

The local engine executes all interactions through a single, generic lookup handler. No custom, hardcoded logic scripts are written for individual items or characters.

```text
[Player Selection]
  Action: TALK / INSPECT / COMBINE / USE
  Target A, Target B
          |
          v
[Search AI Blueprint Rules]
          |
          v
[Check required_state] ---- No match ----> [Default feedback: "Nothing happens."]
          |
          +-- State matches --> [Execute event]
          |
          +-- State does not match --> [Fallback text]
```

### Execution Event Types

- `spawn_item`: Creates the referenced inventory item and adds it directly to the player's inventory; it does not place the item in the world.
- `destroy_item`: Removes the target item from the player's inventory.
- `change_state`: Sets `target_id.current_state` to `new_state`.
- `show_dialogue`: Displays text to the player in the UI.
- `trigger_end`: Ends the game with a `WIN` or `LOSS` outcome and displays text.

## 5. Implementation Roadmap for an Agentic Developer

### Phase 1: Tilemap Loading, Fixtures, and Spatial Anchors

1. Load the supplied Phaser 3 tilemap JSON asset and render its tile layers, collision data, named spatial anchors, and fixed interactive fixtures (such as dressers, chests, and desks).
2. Read the anchor IDs and coordinates and the fixture entity IDs from the map JSON; provide them to the scenario-generation request so characters can be assigned to anchors and interaction rules can target fixtures.
3. Configure tile collisions from the map and build 2D player movement and interact-key handling (`E`).

### Phase 2: Generic Entity and Interaction System

1. Create interactive world entities for the tilemap's fixed fixtures and scenario characters, with base properties such as `id`, `display_name`, `sprite_index`, `inspect_text`, and `current_state = "default"`.
2. Build an inventory data system for items created by interactions, supporting adding and removing items, combining them, and using them on world entities, with five category icons: paper, bottle, tool, trinket, and hazard. Inventory items are not placed in the world.
3. Implement the Universal Interaction State Machine to evaluate `required_state` checks and execute `spawn_item` (create and add to inventory), `destroy_item` (remove from inventory), `change_state`, `show_dialogue`, and `trigger_end`.

### Phase 3: LLM Integration and Loading Pipeline

1. Construct the system prompt instructing the model to output valid JSON conforming strictly to the schema in Section 3, using the provided anchor IDs and fixture entity IDs.
2. Build an asynchronous network service using the OpenAI SDK during the game loading screen to send the scenario request and map data to the OpenAI API.
3. Parse the returned JSON, instantiate scenario characters at their mapped anchors, and load inventory-item definitions as metadata only; create item instances only when their interaction rules run.
4. Implement a fail-safe fallback mechanism: if the API times out or returns malformed JSON, load a static local `default_scenario.json` so the game always runs.
