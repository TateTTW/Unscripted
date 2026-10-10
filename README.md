# Unscripted

Unscripted is a browser-based, top-down detective and deduction game built with Phaser 3 and TypeScript. Explore a small map, talk to characters, inspect fixtures, collect and use items, and uncover how to win each scenario.

Each playthrough uses one of five genres: Murder Mystery, Heist, Escape, Sabotage, or Diplomatic Scandal. Choose a built-in scenario to play immediately, or provide an OpenAI API key to generate a new scenario.

## Stories as playable systems

Unscripted's core idea is a **scenario protocol that turns narrative into executable rules**. Rather than simply generating a story for the player to read, it defines how characters, clues, items, and discoveries fit together into a mystery the player can explore and solve.

Each scenario describes:

- **The cast and objects:** characters placed in the world and items the player can acquire.
- **The possible actions:** talking, inspecting, combining items, and using items on characters or fixtures.
- **Cause and effect:** prerequisites determine when an interaction is available; its effects reveal dialogue, give or consume items, change entity states, or trigger an ending.

The same engine interprets this contract for both built-in and AI-generated scenarios. A clue can be more than descriptive text: discovering it can change a character's response or unlock the next step toward a solution.

The [scenario schema](src/scenario/schema.ts) defines the data format, and the [generation prompt](src/scenario/prompt.ts) explains the rules to the AI. Generated scenarios are checked by a [validator](src/scenario/validator.ts), including a [solver](src/scenario/solver.ts) that searches interaction sequences to verify that a winning ending is reachable.

Currently, generation creates new scenarios within a fixed map and action system, not entirely new maps or mechanics. Reachability checks establish that a solution exists; they do not guarantee that every mystery is compelling or fairly deducible. The foundation is the bridge between storytelling and playable causality: **new stories, expressed through a consistent set of game rules**.

## Requirements

- Node.js (npm is included with Node.js)
- A modern web browser
- An OpenAI API key only if you want AI-generated scenarios

## Run locally

From the repository root, install dependencies and start the Vite development server:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite in your browser (usually `http://localhost:5173`). On the game's start screen, choose **Play built-in scenario** to play without an API key. To generate a scenario, enter your OpenAI API key and choose **Start**.

The game uses the key in memory for the generation request; the app does not save it. Only enter a key you own and are comfortable using from your browser.

## Controls

| Input | Action |
| --- | --- |
| `W`, `A`, `S`, `D` or arrow keys | Move; navigate menus |
| `E` or `Enter` | Interact, confirm a menu choice, or advance dialogue |
| `Space` | Advance dialogue |
| `I` | Open or close inventory |
| `Esc` | Cancel or close a menu; opens pause menu when no menu is open |

## Development commands

```sh
npm run dev      # Start the local development server
npm run build    # Type-check and create a production build in dist/
npm run preview  # Serve the production build locally
npm test         # Run the Vitest test suite
```

## Tech stack

- Phaser 3 with Arcade Physics
- TypeScript
- Vite
- Vitest
- OpenAI Node.js SDK and Zod for generated-scenario handling and validation
