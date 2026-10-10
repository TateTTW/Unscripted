import { afterEach, describe, expect, it, vi } from "vitest";
import { LAST_GENRE_STORAGE_KEY } from "../src/config";
import { pickGenre, type GenreStorage } from "../src/scenario/genre";
import { GENRES } from "../src/scenario/schema";
import { toFontText } from "../src/ui/text";

function memoryStorage(initial: Record<string, string> = {}): GenreStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe("genre selection", () => {
  it("never repeats the last genre and records every pick", () => {
    const storage = memoryStorage();
    let previous: string | null = null;
    for (let i = 0; i < 200; i++) {
      const genre = pickGenre(storage);
      expect(genre).not.toBe(previous);
      expect(storage.data[LAST_GENRE_STORAGE_KEY]).toBe(genre);
      previous = genre;
    }
  });

  it("chooses uniformly among the other four genres", () => {
    for (const last of GENRES) {
      const picks = new Set<string>();
      for (const r of [0, 0.24, 0.26, 0.49, 0.51, 0.74, 0.76, 0.999]) {
        picks.add(pickGenre(memoryStorage({ [LAST_GENRE_STORAGE_KEY]: last }), () => r));
      }
      expect(picks.has(last)).toBe(false);
      expect(picks.size).toBe(4);
    }
  });

  it("works without storage", () => {
    expect(GENRES).toContain(pickGenre(null));
    const broken: GenreStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(GENRES).toContain(pickGenre(broken));
  });

  describe("per page load (session)", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.resetModules();
    });

    it("picks once per load and writes unscripted.lastGenre, on every path", async () => {
      const storage = memoryStorage({ [LAST_GENRE_STORAGE_KEY]: "MURDER" });
      vi.stubGlobal("window", { localStorage: storage });
      const session = await import("../src/session");
      const first = session.getOrPickGenre();
      expect(first).not.toBe("MURDER");
      expect(storage.data[LAST_GENRE_STORAGE_KEY]).toBe(first);
      // Returning to the key form (e.g. rejected key) reuses the same genre.
      expect(session.getOrPickGenre()).toBe(first);

      // A new page load picks again and never repeats.
      vi.resetModules();
      const reloaded = await import("../src/session");
      const second = reloaded.getOrPickGenre();
      expect(second).not.toBe(first);
      expect(storage.data[LAST_GENRE_STORAGE_KEY]).toBe(second);
    });
  });
});

describe("bitmap font text", () => {
  it("converts typography to ASCII and replaces unsupported characters", () => {
    expect(toFontText("\u201CHi\u201D \u2014 it\u2019s\u2026")).toBe('"Hi" - it\'s...');
    expect(toFontText("caf\u00e9 \u2603")).toBe("caf? ?");
    expect(toFontText("line1\r\nline2")).toBe("line1\nline2");
    expect(toFontText("en\u2013dash")).toBe("en-dash");
  });
});
