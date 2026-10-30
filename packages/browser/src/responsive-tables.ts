export interface MobileHeader { label: string; colSpan?: number; rowSpan?: number }

/** Flatten grouped headers while retaining the meaning of financial statement columns. */
export function mobileHeaderLabels(rows: MobileHeader[][]): string[] {
  const grid: string[][][] = [];
  rows.forEach((row, r) => {
    grid[r] ??= [];
    let col = 0;
    for (const cell of row) {
      while (grid[r][col]) col++;
      for (let rr = r; rr < r + (cell.rowSpan || 1); rr++) {
        grid[rr] ??= [];
        for (let cc = col; cc < col + (cell.colSpan || 1); cc++) grid[rr][cc] = [cell.label.trim()];
      }
      col += cell.colSpan || 1;
    }
  });
  const count = Math.max(0, ...grid.map(r => r.length));
  const labels = Array.from({ length: count }, (_, col) => [...new Set(grid.flatMap(row => row[col] ?? []).filter(Boolean))].join(" / "));
  return labels.map((label, i) => label.toLowerCase() === "amount" && labels.filter(l => l.toLowerCase() === "amount").length > 1 && labels[i - 1]
    ? `${labels[i - 1]} — amount` : label);
}

/** Adds presentation metadata only: React continues owning every row, input and action. */
export function annotateMobileTables(root: ParentNode = document): void {
  for (const table of root.querySelectorAll<HTMLTableElement>("table")) {
    if (table.dataset.mobileLayout === "scroll") continue;
    const heads = table.tHead ? [...table.tHead.rows].map(row => [...row.cells].map(cell => ({
      label: cell.getAttribute("aria-label") || cell.textContent?.trim() || "", colSpan: cell.colSpan, rowSpan: cell.rowSpan,
    }))) : [];
    const labels = mobileHeaderLabels(heads);
    if (!labels.length) continue;
    table.dataset.mobileTable = "cards";
    if (!table.hasAttribute("role")) table.setAttribute("role", "table");
    for (const section of [...table.tBodies, ...(table.tFoot ? [table.tFoot] : [])]) {
      const spans = new Map<number, { remaining: number; context: string }>();
      section.setAttribute("role", "rowgroup");
      for (const row of section.rows) {
        row.setAttribute("role", "row");
        row.dataset.mobileContext = [...new Set([...spans.values()].filter(s => s.remaining > 0).map(s => s.context).filter(Boolean))].join(" · ");
        const occupied = new Set([...spans].filter(([, v]) => v.remaining > 0).map(([col]) => col));
        for (const span of spans.values()) span.remaining--;
        let col = 0;
        for (const cell of row.cells) {
          while (occupied.has(col)) col++;
          const label = labels.slice(col, col + cell.colSpan).filter(Boolean).join(" / ");
          const controls = cell.querySelector("button, a[href]");
          const editable = cell.querySelector("input,select,textarea");
          const actions = !!controls && (!label || /^actions?$/i.test(label));
          cell.dataset.mobileLabel = actions ? "Actions" : label || (cell.querySelector('input[type="checkbox"]') ? "Select" : "");
          cell.toggleAttribute("data-mobile-actions", actions);
          cell.toggleAttribute("data-mobile-wide", cell.colSpan > 1 || /description|narration|address|remarks|notes/i.test(label) || (!!editable && /product|plan|customer|supplier/i.test(label)));
          if (!cell.hasAttribute("role")) cell.setAttribute("role", cell.tagName === "TH" ? "rowheader" : "cell");
          if (cell.rowSpan > 1) for (let c = col; c < col + cell.colSpan; c++) spans.set(c, { remaining: cell.rowSpan - 1, context: `${label}: ${cell.textContent?.trim().slice(0, 200) || ""}` });
          col += cell.colSpan;
        }
      }
    }
  }
}

export function installResponsiveTables(): () => void {
  let frame = 0;
  const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; annotateMobileTables(); }); };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  schedule();
  return () => { observer.disconnect(); cancelAnimationFrame(frame); };
}
