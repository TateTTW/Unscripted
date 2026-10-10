export type UIKey = "up" | "down" | "left" | "right" | "confirm" | "advance" | "cancel" | "inventory";

/** Maps a keyboard event to a UI action. `E`/`Enter` confirm; `Space` only advances dialogue. */
export function toUIKey(event: KeyboardEvent): UIKey | null {
  switch (event.key) {
    case "ArrowUp":
    case "w":
    case "W":
      return "up";
    case "ArrowDown":
    case "s":
    case "S":
      return "down";
    case "ArrowLeft":
    case "a":
    case "A":
      return "left";
    case "ArrowRight":
    case "d":
    case "D":
      return "right";
    case "e":
    case "E":
    case "Enter":
      return "confirm";
    case " ":
      return "advance";
    case "Escape":
      return "cancel";
    case "i":
    case "I":
      return "inventory";
    default:
      return null;
  }
}

export interface Panel {
  /** Returns true if the key was consumed. */
  handleKey(key: UIKey, repeat: boolean): boolean;
  destroy(): void;
}
