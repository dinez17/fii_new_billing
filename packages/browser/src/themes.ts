const KEY = "fii-appearance", FONT_KEY = "fii-font";
const THEMES = ["teal", "indigo", "ocean", "plum", "graphite"] as const;
type Theme = typeof THEMES[number];
const FONTS = { clean: "Clean · Arial", aptos: "Professional · Aptos", calibri: "Business · Calibri", modern: "Modern · Segoe UI", humanist: "Humanist · Trebuchet", classic: "Classic · Georgia" };
type Font = keyof typeof FONTS;
const validFont = (value: string | null): Font => value && Object.hasOwn(FONTS, value) ? value as Font : "clean";
const valid = (value: string | null): Theme => THEMES.includes(value as Theme) ? value as Theme : "teal";

/** Visual preference only; no account data is stored. Shared by all three apps. */
export function installThemePicker(): () => void {
  let selected: Theme = "teal", font: Font = "clean";
  const apply = (theme: Theme, family: Font = font) => {
    font = family; document.documentElement.dataset.font = family;
    selected = theme; document.documentElement.dataset.theme = theme;
    for (const select of document.querySelectorAll<HTMLSelectElement>('[data-theme-picker] select')) select.value = select.dataset.preference === "font" ? font : theme;
  };
  try { apply(valid(localStorage.getItem(KEY)), validFont(localStorage.getItem(FONT_KEY))); } catch { apply("teal"); }
  const mount = () => {
    for (const slot of document.querySelectorAll<HTMLElement>('[data-theme-picker]')) {
      if (slot.querySelector("select")) continue;
      const details = document.createElement("details"); details.className = "appearance-picker";
      const summary = document.createElement("summary"); summary.textContent = "Appearance";
      const panel = document.createElement("div"); panel.className = "appearance-panel";
      const label = document.createElement("label"); label.className = "theme-picker";
      const caption = document.createElement("span"); caption.textContent = "Theme";
      const select = document.createElement("select"); select.setAttribute("aria-label", "Colour theme");
      for (const theme of THEMES) { const option = document.createElement("option"); option.value = theme; option.textContent = theme[0].toUpperCase() + theme.slice(1); select.append(option); }
      select.value = selected;
      select.onchange = () => { apply(valid(select.value)); try { localStorage.setItem(KEY, selected); } catch { /* Styling also works without preference storage. */ } };
      const fontLabel = document.createElement("label"); fontLabel.className = "theme-picker";
      const fontCaption = document.createElement("span"); fontCaption.textContent = "Font family";
      const fontSelect = document.createElement("select"); fontSelect.dataset.preference = "font"; fontSelect.setAttribute("aria-label", "Font family");
      for (const [value, name] of Object.entries(FONTS)) { const option = document.createElement("option"); option.value = value; option.textContent = name; fontSelect.append(option); }
      fontSelect.value = font;
      fontSelect.onchange = () => { apply(selected, validFont(fontSelect.value)); try { localStorage.setItem(FONT_KEY, font); } catch { /* Styling works without storage. */ } };
      fontLabel.append(fontCaption, fontSelect); label.append(caption, select); panel.append(label, fontLabel); details.append(summary, panel); slot.append(details);
    }
  };
  const sync = (event: StorageEvent) => { if (event.key === KEY) apply(valid(event.newValue)); else if (event.key === FONT_KEY) apply(selected, validFont(event.newValue)); else if (event.key === null) apply("teal", "clean"); };
  const dismiss = (event: MouseEvent | KeyboardEvent) => { for (const details of document.querySelectorAll<HTMLDetailsElement>('.appearance-picker[open]')) if ((event instanceof KeyboardEvent && event.key === "Escape") || (event instanceof MouseEvent && !details.contains(event.target as Node))) { details.open = false; if (event instanceof KeyboardEvent) details.querySelector("summary")?.focus(); } };
  const observer = new MutationObserver(mount); observer.observe(document.body, { subtree: true, childList: true });
  window.addEventListener("storage", sync); document.addEventListener("click", dismiss); document.addEventListener("keydown", dismiss); mount();
  return () => { observer.disconnect(); window.removeEventListener("storage", sync); document.removeEventListener("click", dismiss); document.removeEventListener("keydown", dismiss); for (const slot of document.querySelectorAll('[data-theme-picker]')) slot.replaceChildren(); };
}
