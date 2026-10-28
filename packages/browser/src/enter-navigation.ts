/** Enter advances data-entry fields; saving always remains an explicit action. */
export function installEnterNavigation(root: Document = document): () => void {
  const fields = 'input:not([type="hidden"]):not([type="submit"]):not([type="reset"]):not([type="button"]), select, textarea';
  function available(element: HTMLElement): boolean {
    return element.tabIndex >= 0 && !element.matches(":disabled") &&
      !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
      element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden" &&
      !(element instanceof HTMLInputElement && element.readOnly) &&
      !(element instanceof HTMLTextAreaElement && element.readOnly);
  }
  function handle(event: KeyboardEvent) {
    if (event.key !== "Enter" || event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.altKey || event.metaKey) return;
    const current = event.target;
    if (!(current instanceof HTMLInputElement || current instanceof HTMLSelectElement)) return;
    if (current.closest('[data-enter-native], [contenteditable="true"]')) return;
    if (current instanceof HTMLInputElement && ["file", "submit", "reset", "button", "color", "range"].includes(current.type)) return;
    // Searchable controls consume Enter to choose a result before advancing.
    if (current.getAttribute("role") === "combobox" && current.getAttribute("aria-expanded") === "true") return;
    const scope = current.closest('[data-enter-scope], .modal, [role="dialog"], form, main, .content') ?? root.body;
    const candidates = Array.from(scope.querySelectorAll<HTMLElement>(fields)).filter(available);
    const index = candidates.indexOf(current);
    if (index < 0) return;
    event.preventDefault();
    const next = candidates[index + (event.shiftKey ? -1 : 1)];
    if (next) { next.focus(); return; }
    if (event.shiftKey) return;
    const action = Array.from(scope.querySelectorAll<HTMLElement>('button[type="submit"], input[type="submit"], .actions button.primary, button.primary')).find(available);
    action?.focus();
  }
  root.addEventListener("keydown", handle);
  return () => root.removeEventListener("keydown", handle);
}
