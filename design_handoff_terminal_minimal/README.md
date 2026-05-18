# Handoff: Leominal Terminal — Minimal Redesign

## Overview

This package is a visual + behavioural redesign of the Leominal web terminal UI
(`src/client/terminal/*` + `src/client/styles.css`). It is the **Minimal** direction
from the design exploration: monospace‑forward, text‑first, single cyan/teal
accent, no extra chrome.

It includes three behavioural additions beyond the visual refresh:

1. **Collapsible workspace sidebar on desktop/tablet** (toggle button at the top of the sidebar).
2. **Per‑pane Close button** (in each pane's header, not the global tab toolbar).
3. **Drag‑to‑resize between split panes** (the current `.split-divider` is a static 1px line — it now becomes an interactive resizer).

## About the design files

The files in `prototype/` are **HTML design references**, not production code.
They are React JSX rendered via Babel‑in‑the‑browser so the design can be poked
at live; do **not** copy them into the codebase as‑is. The task is to recreate
the same look and behaviour inside the existing `src/client/terminal/*` React
TypeScript files, reusing the existing component boundaries (`TerminalWorkspace`,
`TerminalTabs`, `SplitPane`, `XtermPane`).

The main reference file to open and play with is `prototype/Leominal Prototype.html`.
`prototype/index.html` shows the broader exploration (Warp / Command / Minimal
variants) for context — Minimal was chosen.

## Fidelity

**High‑fidelity** — colours, type, spacing, hover/active states, and
animations are all final. The dev should aim for pixel parity with
`Leominal Prototype.html`.

---

## Design tokens

Drop these into `:root` in `src/client/styles.css` and use them throughout.

### Colour

| Token | Value | Used for |
|---|---|---|
| `--leo-bg`         | `#0a0d10` | App background |
| `--leo-bg-2`       | `#0d1216` | Hover surface |
| `--leo-bg-sidebar` | `#08090b` | Sidebar + status bar |
| `--leo-line`       | `#1a2128` | Hairlines, dividers (rest) |
| `--leo-line-2`     | `#2a3340` | Stronger lines, button borders |
| `--leo-fg`         | `#e2e8ee` | Primary text |
| `--leo-fg-2`       | `#8896a3` | Secondary text (cwd, meta) |
| `--leo-fg-3`       | `#54616d` | Tertiary text (labels, hints) |
| `--leo-accent`     | `#5eead4` | Active state, brand (teal‑300) |
| `--leo-accent-soft`| `rgba(94,234,212,0.10)` | Active backgrounds |
| `--leo-accent-glow`| `rgba(94,234,212,0.55)` | Glow shadows |
| `--leo-ok`         | `#34d399` | "running" pane state |
| `--leo-danger`     | `#f87171` | Destructive hover (close pane) |

### Typography

```css
--leo-font-ui:   'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
--leo-font-mono: 'JetBrains Mono', 'MesloLGS NF', ui-monospace, 'SF Mono', monospace;
```

- All UI chrome uses `--leo-font-ui` at 12–13px.
- Workspace `cwd` lines, pane headers, status bar, and terminal output use `--leo-font-mono`.
- The existing MesloLGS NF font already shipping with the repo is the perfect
  monospace fallback — keep it.

### Spacing / sizes

- Sidebar width expanded: **232px**. Collapsed: **56px**.
- Top tab bar height: **40px** desktop, **48px** mobile.
- Status bar height: **22px** desktop, **24px** mobile.
- Pane header height: **26px**.
- Active pane accent bar width: **2px**, full pane height, on the **left**.
- Active tab underline: **2px**, with `box-shadow: 0 0 10px var(--leo-accent-glow)`.
- Divider: rendered at **1px** of background `var(--leo-line)`, with a
  **±4px pseudo‑element hit area** so the line is easy to grab without
  visually being thicker.
- Mobile breakpoint: **`max-width: 760px`**.

---

## Screens / views

### 1. Sidebar (`.workspace-sidebar` / `<aside>`)

**Layout** — 4 rows, grid:
1. Brand row: `[lion icon] [leominal] [chevron toggle]` (16px padding)
2. Section header: `workspaces` + tiny `+` button (10.5px, fg‑3, letter‑spacing 0.06em)
3. Workspace list (scrollable)
4. Footer: `session · 11h left` + `logout` link

**Workspace row (`.workspace-entry`)** — restyle as:
- Two lines of text (no boxes). Top line: workspace name in `--leo-fg-2`,
  12.5px / 500. Bottom line: cwd in monospace, 10.5px, `--leo-fg-3`, with the
  tab count right‑aligned.
- Padding: `7px 16px 7px 14px`. Left border: `2px solid transparent`.
- Hover: `color: --leo-fg`, background `rgba(255,255,255,0.015)`.
- Active: name turns 600 weight, left border becomes `2px solid --leo-accent`,
  background becomes a left‑to‑right fade `linear-gradient(90deg, var(--leo-accent-soft), transparent 60%)`.
- The existing per‑row `×` close button is no longer shown by default — only
  reveal on row hover (`opacity: 0` → `opacity: 1`).
- **Rename preserved**: double‑click on the workspace name swaps the row from
  a `<button>` to a `<form>` containing an `<input>` (same DOM pattern the
  existing `TerminalWorkspace.tsx` already uses — `editingWorkspace` state +
  `commitRenameWorkspace`). Style the input: full‑width, 12.5px / 600 weight,
  `border: 1px solid var(--leo-accent)`, 3px radius, soft glow
  `box-shadow: 0 0 8px var(--leo-accent-soft)`. Background `var(--leo-bg)`.
  Enter / blur commits, Escape cancels. Reject empty strings. Renaming is
  disabled while the sidebar is collapsed.

**Collapsed sidebar (56px)** — new state, controlled by a `sidebarCollapsed`
boolean held in `TerminalWorkspace`.
- Brand row stacks: lion icon centred, chevron‑right toggle just below it.
- `workspaces` section header is hidden.
- Each workspace becomes a single 28×28 rounded square containing the
  uppercase first letter of the workspace name, monospace 12px bold. Active
  square: bg `--leo-accent-soft`, border `--leo-accent`, color `--leo-accent`,
  with the same soft glow.
- Footer is hidden.
- The collapse toggle is a single button that flips between `<` and `>` based
  on state — there is intentionally **no** hamburger button in the top bar on
  desktop. (Earlier iterations had both; they're redundant.)

**Mobile sidebar** — full drawer pattern (already exists in `.workspace-sidebar`
mobile CSS). The chevron toggle is replaced by an `×` button that just closes
the drawer. Backdrop scrim: `rgba(0,0,0,0.5)` with `backdrop-filter: blur(2px)`.

### 2. Top tab bar (`.terminal-tabs`)

**Layout** — `grid-template-columns: auto 1fr auto`:
- Left: hamburger button (**mobile only**, hidden on desktop).
- Middle: tab list, horizontally scrollable.
- Right: pane action buttons.

**Tab (`.terminal-tab`)**
- Plain text + count, no background fill, no rounded chip.
- Layout: `[title] [pane-count-small]   [× on hover]`.
- Padding: `0 4px 0 14px`, height matches bar (40px). Max title width: 200px,
  truncate with ellipsis.
- Inactive: `color: --leo-fg-2`, font 12px.
- Hover: `color: --leo-fg`.
- Active: `color: --leo-fg`, count gets `color: --leo-accent`, and a **2px
  underline** is drawn at the bottom edge (`12px` inset from each side):
  ```css
  .terminal-tab[data-active="true"]::after {
    content: ''; position: absolute; bottom: -1px; left: 12px; right: 12px;
    height: 2px; background: var(--leo-accent);
    box-shadow: 0 0 10px var(--leo-accent-glow);
  }
  ```
- The per‑tab `×` is `opacity: 0` by default, `opacity: 1` on row hover or when
  the tab is active. 18×18, hover background `--leo-bg-2`, hover color
  `--leo-fg`.
- New‑tab `+` button at the end of the list: 30×30, transparent, fg‑3, hovers
  to `--leo-accent`.
- **Rename preserved**: double‑click on a tab title swaps the `.terminal-tab-select`
  button for a `.terminal-tab-editor` form containing an `<input>` — same
  pattern as the existing `TerminalTabs.tsx`. Input: 12px, `border: 1px solid
  var(--leo-accent)`, `box-shadow: 0 0 8px var(--leo-accent-soft)`, bg
  `var(--leo-bg-2)`. The pane‑count `small` stays visible to the right of the
  input (color `var(--leo-accent)` while editing). The per‑tab `×` is hidden
  during edit so a misclick can't close the tab. Enter / blur commits, Escape
  cancels.

**Pane action buttons (`.terminal-pane-actions`)** — now **only Split Right
and Split Down**. The existing global "Close pane" button **moves to each
pane's header** (see below). Buttons are 28×28 squares, 5px radius,
transparent until hover (then border `--leo-line`, bg `--leo-bg-2`).

### 3. Pane (`.terminal-pane`)

**New: 26px header strip above the xterm container.** This is added in
`XtermPane.tsx` (or as a sibling wrapper) — it contains:

```
[● dot] cwd · branch              state   [× on hover]
```

- Background: same as pane body (no fill); 1px bottom border `--leo-line`.
- Font: `--leo-font-mono`, 10.5px.
- Dot: 5×5 circle, `--leo-fg-3` when inactive. When the pane is active:
  `background: --leo-accent`, `box-shadow: 0 0 8px --leo-accent`.
- `cwd`: `--leo-fg-2`. `branch`: `--leo-fg-3`. Separator dot `·` at 50% opacity.
- State: `running` → `--leo-ok` (#34d399). `idle` → `--leo-fg-3`. 10.5px,
  weight 500.
- Per‑pane close `×`: 18×18, `opacity: 0` default, `opacity: 1` when pane is
  hovered OR active. Hover: color `--leo-danger`, background
  `rgba(248,113,113,0.10)`. Stop click propagation so it doesn't trigger
  pane‑select.
- **Mobile**: per‑pane close is always visible (`opacity: 1`), 26×26 for thumb
  reach.

**Active pane indicator** — replace the existing amber `border-color: #b58a3a`
with:
- A 2px left accent bar via `::before`: full height, `background: --leo-accent`,
  `box-shadow: 0 0 14px --leo-accent-glow`, `pointer-events: none`.
- A subtle top‑down soft accent wash on the pane background:
  `background: linear-gradient(180deg, var(--leo-accent-soft), transparent 22%)`.
- No border ring.

### 4. Split divider (`.split-divider`)

Currently a static 1px bar (`flex: 0 0 1px; background: #303846`).
**New behaviour: drag to resize.**

Visual:
- 1px bar at `--leo-line` at rest.
- Hover / active drag: bar becomes `--leo-accent` with the glow shadow.
- A 28×4 (vertical split) or 4×28 (horizontal split) accent rectangle
  appears at the centre on hover — purely a visual handle hint.
- The clickable hit area is ±4px around the line (via a pseudo‑element with
  `position: absolute; inset: -4px 0` or `0 -4px`) — the visible line stays
  thin but it's easy to grab.

Behaviour:
- On `pointerdown` on the divider, capture the pointer, record the parent
  split's `getBoundingClientRect()`, and on each `pointermove` compute
  `ratio = (clientX - rect.left) / rect.width` (or `clientY` / `height` for
  horizontal splits). Clamp `[0.1, 0.9]`.
- Apply the ratio either via inline `flex: <ratio>` on each child or by
  switching `.split-pane` to a CSS grid template:
  `grid-template-columns: ${ratio*100}% 1px ${(1-ratio)*100}%`.
- Use `touch-action: none` on the divider so touch drags don't scroll the
  page.

**Data model change required:** the existing `TerminalSplit` shape in
`src/shared/types.ts` / `terminalReducer.ts` has no ratio field. Add one:

```ts
interface TerminalSplit {
  type: 'split';
  direction: 'horizontal' | 'vertical';
  ratio: number; // 0..1, default 0.5
  children: [PaneNode, PaneNode];
}
```

…and persist it through `serializeWorkspaceState` /
`reconstructTerminalState` so resizes survive reload (the layout state is
already round‑tripped through `terminalLayoutRoutes` on the server — just
include `ratio` in the JSON shape).

Add a new reducer action `split.ratio.changed` that sets the ratio at a given
path in the tree. Throttle saves (the existing 75ms debounce in
`TerminalWorkspace.tsx` is fine).

### 5. Status bar (new, optional)

22px row at the bottom of `.terminal-main`. `bg: --leo-bg-sidebar`, monospace
10.5px, `--leo-fg-3`:

```
~/code/leominal  ·  main  ·  zsh 5.9            3 tab · 5 pane  ·  ● connected
```

The `●` is `--leo-accent`. This is purely informational — not strictly
required for the first cut but recommended; it replaces the bottom‑sidebar
"session expiry" text that currently sits in the sidebar footer.

---

## Interactions & behaviour summary

| Trigger | Effect |
|---|---|
| Click `<` toggle in sidebar | `sidebarCollapsed = true`. Width animates from 232px → 56px. |
| Click `>` toggle (collapsed) | `sidebarCollapsed = false`. Reverse animation. |
| Click hamburger (mobile only) | Opens the sidebar drawer (`mobileSidebarOpen`). |
| Click scrim / `×` in mobile drawer header | Closes drawer. |
| **Double-click a workspace name** | Workspace row swaps to an inline input. Enter/blur commits, Escape cancels. Empty strings are rejected. Only available when the sidebar is expanded (no rename in 56px collapsed mode). |
| **Double-click a tab title** | Tab swaps to an inline input. Enter/blur commits, Escape cancels. The pane‑count `small` stays visible to the right of the input. Per‑tab `×` is hidden while editing so a misclick can't close the tab. |
| Click pane header `×` | Removes that pane from the tree. If it was active, focus moves to the first remaining pane in tree order. If only one pane remains in the tab, the `×` is hidden. |
| Hover divider | Bar turns teal + handle dot appears. |
| Drag divider | Cursor `col-resize` / `row-resize`. Live ratio update. Persist on `pointerup`. |
| Click pane body | Pane becomes active (existing behaviour, just visually different now). |
| Active tab change | Active tab gets the teal underline. The pane‑actions row updates to point at the new active pane. |

All animations are 120–180ms easing `ease`.

---

## State changes required

In `TerminalWorkspace.tsx`:
- Add `const [sidebarCollapsed, setSidebarCollapsed] = useState(false);` and
  optionally persist it (localStorage key `leominal.sidebarCollapsed.v1`).
- Apply `data-collapsed={sidebarCollapsed}` on `.terminal-shell`.
- Update CSS grid:
  ```css
  .terminal-shell { grid-template-columns: 232px minmax(0, 1fr); }
  .terminal-shell[data-collapsed="true"] { grid-template-columns: 56px minmax(0, 1fr); }
  ```

In `terminalReducer.ts`:
- Add `ratio` to split nodes (default 0.5 when created via `terminal.split`).
- Add new action `pane.resized` (path + ratio) that updates the tree.

In `SplitPane.tsx`:
- Wire pointer events on `.split-divider` to call `onResize(path, ratio)`.
- Pass that ratio through to children via inline flex‑basis or grid template.

In `XtermPane.tsx` (or a wrapper around it):
- Add the new pane header strip described above. Pass `cwd`, `branch`,
  `state`, `active`, and an `onClose()` callback (which dispatches
  `terminal.closed` for that pane).

In `TerminalTabs.tsx`:
- Drop the global "Close pane" `.pane-action-button` (it's redundant now).
- Keep split right / split down as the only two pane actions.

---

## Preserved existing behaviours (do not regress)

This redesign is **chrome only** — every existing functional behaviour in
`src/client/terminal/*` must keep working. Audit checklist:

**Workspaces (`TerminalWorkspace.tsx`)**
- [x] List all workspaces in sidebar; click row to switch active workspace.
- [x] **Rename workspace**: double‑click name → inline `<input>` form. Enter/blur commits via `dispatchLayoutChange({ type: 'workspace.renamed', ... })`, Escape cancels. Reject empty strings. **Disabled in collapsed mode.**
- [x] **New workspace**: `+` button in sidebar header dispatches `workspace.created`. Switches active workspace to the new one.
- [x] **Close workspace**: hover‑revealed `×` per row, hidden when only one workspace exists. Calls `closeWorkspace` which closes all PTYs in that workspace and dispatches `workspace.closed`.
- [x] First workspace falls back to active when current workspace is closed.

**Tabs (`TerminalTabs.tsx`)**
- [x] List all tabs in active workspace; click to switch active tab.
- [x] **Rename tab**: double‑click title → inline `<input>` form. Enter/blur commits via `tab.renamed`, Escape cancels.
- [x] **New tab**: `+` at end of list. Creates a new terminal via `api.createTerminal`, dispatches `terminal.created`.
- [x] **Close tab**: per‑tab `×` (only visible when 2+ tabs). Closes all PTYs in the tab.
- [x] Active tab gets the teal underline (replaces the existing `background: #1d2530` fill).

**Panes (`SplitPane.tsx` / `XtermPane.tsx`)**
- [x] Click a pane to make it active; dispatch `pane.selected`.
- [x] **Split right** / **split down** (top‑bar actions, only enabled when there's an active pane) call `api.createTerminal({ parentTerminalId, ... })` and dispatch `terminal.split`.
- [x] **Close pane** moves from the top toolbar to the per‑pane header `×`. Closes that specific pane via `closeTerminal(id)`; if it was active, focus moves to the first remaining pane. Hidden when only one pane remains in the tab.
- [x] **NEW: Drag‑resize** between sibling panes. Persist `ratio` in the layout state alongside `direction`.
- [x] Pane exit handling (`terminal.exited`) and snapshot updates (`terminal.updated`) are unaffected.

**Layout persistence**
- [x] All state mutations continue to go through `dispatchLayoutChange` so they round‑trip to the server (`api.saveTerminalLayout`) and `localStorage` (`leominal.terminalWorkspaces.v2`).
- [x] 75ms debounce stays.
- [x] 409 conflict handling stays (re‑fetch server layout, reconcile).
- [x] **Schema additions**: add `ratio: number` to split nodes in `src/shared/types.ts` and `normalizeTerminalLayoutState`. Default to `0.5` for legacy nodes. Add a new reducer action `pane.resized` that sets the ratio at a given path; debounce save the same way.

**Session / chrome**
- [x] Session expiry text (currently `.session-expiry` in the sidebar footer of `TerminalWorkspace.tsx` — actually it's passed in via `sessionExpiresAt` prop, but the render block was elided in the version I read; preserve whatever rendering already exists). Show it next to the `logout` link in the new footer.
- [x] **Logout** button stays in sidebar footer. Calls existing `onLogout` prop, which already routes back to `view === 'login'` in `AuthGate.tsx`. The redesigned auth screen renders automatically.
- [x] **Auth screen** (`AuthGate.tsx`): restyle setup + login views with new tokens (see §6 above). Same forms, same submit handlers, same `api.setupPassword` / `api.login` / `api.logout` / `api.getSession` flow.
- [x] **Error banner** (`.workspace-error` div) stays above `.workspace-body`. Restyle: `background: rgba(248,113,113,0.08)`, `border-bottom: 1px solid rgba(248,113,113,0.25)`, `color: #fca5a5`, padding `6px 12px`, font 12px.
- [x] **Loading placeholder** ("Opening shell..." in `.workspace-placeholder`) stays. Restyle: `color: var(--leo-fg-3)`, monospace, centred. Add a tiny `●` blinking dot to the left.
- [x] **Empty workspace** state (`<EmptyWorkspace>`) stays. Restyle: centred two‑line layout, `color: var(--leo-fg-2)`, with a single ghost button "new tab" using the same style as `.tab-add-button`.

**Mobile / responsive**
- [x] All existing mobile behaviour: hamburger toggles `[data-sidebar-open]` on `.terminal-shell`, the sidebar becomes a fixed‑position drawer, backdrop scrim is clickable to close, tab/pane action buttons grow to ≥38px hit targets.
- [x] Sidebar drawer header gets an `×` (close) button in place of the desktop chevron‑toggle.
- [x] Per‑pane close `×` is always visible on mobile (not hover‑gated).
- [x] Drag handles need touch support: use **pointer events** with `touch-action: none` on `.split-divider` so touches don't scroll the page.

**Keyboard / IME / xterm**
- [x] `XtermPane.tsx`, `hangulInput.ts`, font stack (`MesloLGS NF`), WebSocket reconnect, PTY reattach after refresh — **all unaffected**. The redesign is CSS + a handful of structural JSX changes.

---

## Files

- `prototype/Leominal Prototype.html` — the interactive prototype. Open this
  alongside the codebase as your visual reference. All states (active, hover,
  collapsed, mobile drawer) are exercised live.
- `prototype/proto-app.jsx`, `prototype/proto-panes.jsx`, `prototype/shared.jsx`
  — the React source for the prototype. Read these to see how state is
  modelled (workspaces / tabs / pane tree) and how the drag‑resize is
  implemented.
- `prototype/index.html` — design canvas with all three explored directions
  (Warp / Command / Minimal). Useful for context; not the chosen direction.

## Assets

No new assets required. The existing `public/icons/icon-*.png` and the
`MesloLGS NF` fonts in `src/client/terminal/fonts/` stay as‑is. The "lion"
mark in the sidebar brand row is rendered inline as SVG (see
`prototype/shared.jsx` → `Icon.Lion`) — copy that JSX into a small
`LeominalMark.tsx` component.

## Files
