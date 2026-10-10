/** HTML overlays placed over the game canvas. Text is always set with textContent. */

function gameContainer(): HTMLElement {
  return document.getElementById("game") ?? document.body;
}

export function createOverlay(extraClass?: string): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.className = extraClass ? `overlay ${extraClass}` : "overlay";
  gameContainer().appendChild(overlay);
  return overlay;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string } = {},
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (props.className) element.className = props.className;
  if (props.text !== undefined) element.textContent = props.text;
  return element;
}

export function showBootError(errors: readonly string[]): void {
  const panel = el("div", { className: "boot-error" });
  panel.appendChild(el("h1", { text: "Unscripted could not start" }));
  panel.appendChild(el("p", { text: "The game assets failed validation. Fix these problems and reload:" }));
  const list = el("ul");
  for (const error of errors) list.appendChild(el("li", { text: error }));
  panel.appendChild(list);
  gameContainer().appendChild(panel);
}
