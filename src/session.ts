import type { ParsedMap } from "./map/types";
import { pickGenre } from "./scenario/genre";
import type { Genre, Scenario } from "./scenario/schema";

/** Data produced by BootScene and shared by later scenes. Never holds the API key. */
export interface BootData {
  map: ParsedMap;
  npcDescriptions: string[];
  defaults: Record<Genre, Scenario>;
  /** Phaser texture keys (= tileset names) for every tileset slice, in map order. */
  tilesetKeys: string[];
}

let bootData: BootData | null = null;
let genre: Genre | null = null;

export function setBootData(data: BootData): void {
  bootData = data;
}

export function getBootData(): BootData {
  if (!bootData) throw new Error("Boot data is not ready.");
  return bootData;
}

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The genre is picked once per page load, on the first Start / Play built-in scenario press. */
export function getOrPickGenre(): Genre {
  genre ??= pickGenre(safeLocalStorage());
  return genre;
}
