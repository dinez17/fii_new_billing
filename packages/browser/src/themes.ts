/** Studio and Inter are the shared, fixed appearance for all app surfaces. */
export function installThemePicker(): () => void {
  document.documentElement.dataset.theme = "studio";
  document.documentElement.dataset.font = "inter";
  try {
    localStorage.setItem("fii-appearance", "studio");
    localStorage.setItem("fii-font", "inter");
  } catch { /* The fixed appearance also works without browser storage. */ }
  return () => { /* No appearance picker or event listeners are needed. */ };
}
