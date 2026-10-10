import { LAST_GENRE_STORAGE_KEY } from "../config";
import { GENRES, type Genre } from "./schema";

export interface GenreStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Picks a genre uniformly at random, excluding the last genre played, and records it
 * under `unscripted.lastGenre` immediately.
 */
export function pickGenre(storage: GenreStorage | null, random: () => number = Math.random): Genre {
  let last: string | null = null;
  try {
    last = storage?.getItem(LAST_GENRE_STORAGE_KEY) ?? null;
  } catch {
    last = null;
  }
  const options = GENRES.filter((g) => g !== last);
  const index = Math.min(options.length - 1, Math.floor(random() * options.length));
  const genre = options[index] ?? GENRES[0];
  try {
    storage?.setItem(LAST_GENRE_STORAGE_KEY, genre);
  } catch {
    // Storage may be unavailable (private mode); the genre still applies to this page load.
  }
  return genre;
}

export const GENRE_LABELS: Record<Genre, string> = {
  MURDER: "Murder Mystery",
  HEIST: "Heist",
  ESCAPE: "Escape",
  SABOTAGE: "Sabotage",
  DIPLOMACY: "Diplomatic Scandal",
};

export const DEFAULT_SCENARIO_FILES: Record<Genre, string> = {
  MURDER: "default_murder.json",
  HEIST: "default_heist.json",
  ESCAPE: "default_escape.json",
  SABOTAGE: "default_sabotage.json",
  DIPLOMACY: "default_diplomacy.json",
};
