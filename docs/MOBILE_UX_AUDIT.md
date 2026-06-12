# Mobile-First UX/UI Audit — Church Finance App

**Date:** 2026-06-12 · **Scope:** All screens, modals, forms, tables, dashboards, reconciliation, reporting, admin workflows
**Lens:** Principal Mobile Product Designer / Senior UX Researcher / Accessibility Specialist / Fintech UX Lead
**Constraint honored:** No findings touch business logic, financial calculations, permissions, reconciliation logic, imports, audit trails, security, or backend architecture. UI/UX layer only.

---

## Executive Summary

The app has a **genuinely strong mobile foundation**: a bottom tab bar with a grouped "More" drawer, full-screen modals with sticky footers and dirty-guards, card views on the highest-traffic ledger pages, focus traps, a skip link, `prefers-reduced-motion` support, dark mode, and 44px form inputs. These are above-average for an internal finance tool.

The gaps cluster in five areas:

1. **iOS input zoom** — every form input in the app is 14px (`text-sm`), which triggers Safari's auto-zoom on focus. This is the single most disruptive mobile defect.
2. **No safe-area support** — no `viewport-fit=cover`, zero `env(safe-area-inset-*)` usage. The fixed bottom tab bar, toasts, FABs, and full-screen modals collide with the iPhone home indicator and notch.
3. **Sub-44px touch targets** on the actions users tap most: row edit/delete (~26px), bulk-select checkboxes (16px), pagination (~24px).
4. **211 instances of sub-12px text** (`text-[10px]` ×151, `text-[11px]` ×60), concentrated in ImportModal, CategoryLedger, BankMovement, Outflows — px-locked sizes that also ignore user font-size preferences.
5. **~16 table-only pages** with horizontal panning as the only mobile strategy, with no sticky first column, so users lose row context while panning to amounts.

**Mobile UX Score: 63 / 100** (rubric at end).

---

## 1 · MOBILE LAYOUT

| # | Screen / Component | Issue | Severity | User impact | Recommendation | Effort |
|---|---|---|---|---|---|---|
| L1 | Global — `index.html` | Viewport meta lacks `viewport-fit=cover`; **zero** `env(safe-area-inset-*)` usage in the codebase | **Critical** | On iPhone X+ the fixed `h-12` bottom tab bar sits inside the home-indicator gesture zone — taps on Import/More trigger app-switch gestures; full-screen modals butt against the notch | Add `viewport-fit=cover`; add `padding-bottom: env(safe-area-inset-bottom)` to BottomTabBar, More drawer, modal footers, `.toast-safe-bottom`, and FAB offsets; `padding-top: env(safe-area-inset-top)` on full-screen modal headers | S |
| L2 | `Modal.tsx` (all modals) | Mobile full-screen panel uses `h-full` (≈100vh) with internal scroll; no `100dvh`/`visualViewport` handling — when the on-screen keyboard opens, the sticky footer (Save/Cancel) can be pushed off-screen behind the keyboard | **High** | Users typing in a long form (AddInflow/AddOutflow, 16 fields) cannot see or reach Save without dismissing the keyboard first; feels broken | Switch panel height to `h-dvh` (`h-[100dvh]`) on mobile; add `interactive-widget=resizes-content` to viewport meta; keep footer `shrink-0` (already done) | S |
| L3 | `BottomTabBar.tsx` More drawer | Drawer `fixed bottom-16 … max-h-[75vh]`; in **landscape** (~360px tall) 75vh ≈ 270px starting 64px up — bottom rows of the 2-col grid become cramped; no safe-area padding | Medium | Landscape users (tablets propped on desks during counting sessions) struggle to reach drawer items | `max-h-[calc(100dvh-var(--tab-bar-height)-1rem)]`, add `pb-[env(safe-area-inset-bottom)]` | S |
| L4 | `TopBar.tsx` | 6–7 interactive elements at mobile width (hamburger, org switcher, connection dot, theme toggle, sign-out, avatar); role badge hidden `sm:` despite ui-rules saying it should stay | Medium | Crowding → mis-taps between theme toggle and sign-out; sign-out next to frequently-used controls is an accidental-tap hazard | Move sign-out into a user menu/More drawer on mobile; keep max 4 top-bar targets; enforce 44px hit areas | M |
| L5 | `OrgSwitcher.tsx` | Dropdown fixed `w-56`/`w-64`, anchored `left-0` — can overflow right viewport edge at 320–360px | Low | Org names clipped off-screen for multi-org treasurers | Add `max-w-[calc(100vw-2rem)]` and right-edge clamping | S |
| L6 | `HelpCenter.tsx` | Panel `w-full max-w-2xl` with article tables `min-w-full` inside | Medium | Help articles with tables force inner horizontal scroll inside a modal — double-scroll trap on phones | Render article tables as stacked definition lists below `sm`; cap content width with comfortable padding | M |
| L7 | `TourEngine.tsx` / `FloatingCalculator.tsx` | Fixed 320px card/panel widths; calculator FAB `bottom-20 right-4` + Help FAB share the same corner zone; landscape leaves <280px above the FAB for a ~420px panel | Medium | Tour cards and calculator clip or overlap the tab bar in landscape; two FABs compete with the thumb zone and content | Clamp widths to `min(320px, 100vw-2rem)`; stack FABs vertically with safe-area offsets; in landscape, open calculator as a bottom sheet | M |
| L8 | `Sidebar.tsx` | `w-72` fixed; fine on `lg:+`, but tablet-portrait (768–1023px) gets the mobile bottom-bar pattern with a large unused canvas | Low | Small-tablet users get a phone UI rather than a hybrid (rail) layout | Optional: `md:` icon-rail variant | L |
| L9 | 24 table pages | Horizontal scroll is the only mobile strategy on ~16 pages (see §6) — `overflow-x-auto` correctly applied (good), but nothing is sticky | High | Panning right to read amounts hides the date/description — users lose track of *which row* they're reading; core comprehension failure for financial data | See §6 recommendations (cards, sticky first column) | M–L |
| L10 | Global | No horizontal-scroll affordance (fade/edge hint) on scrollable tables and pill tab rows | Low | Users don't realize columns exist off-screen ("hidden actions") | Add right-edge gradient fade on `overflow-x-auto` containers | S |

**Positives:** `<main>` `overflow-x-hidden` backstop prevents page-level horizontal scroll; tab nav rows use `overflow-x-auto`; FX cards use `grid-cols-2` + `break-all` overflow hardening; toast offsets above the tab bar via `--tab-bar-height`; modal `overscroll-contain`.

---

## 2 · TOUCH TARGETS

| # | Screen / Component | Issue | Severity | User impact | Recommendation | Effort |
|---|---|---|---|---|---|---|
| T1 | All list pages (e.g. `Inflows.tsx:429-435`) | Row Edit/Delete buttons: `p-1.5` + `w-3.5 h-3.5` icon ≈ **26×26px**, placed adjacent with `gap-1` | **Critical** | Edit and Delete sit ~28px apart at ~26px each — far below the 44px (Apple)/48dp (Android) minimum; mis-tapping **Delete** instead of **Edit** on a financial record is the highest-stakes accidental tap in the app | Increase to `min-w-[44px] min-h-[44px]` (visual icon can stay small); insert ≥8px spacing; on card view, move Delete into an overflow menu or the row detail panel | S |
| T2 | Bulk select (e.g. `Inflows.tsx:469,513`) | Checkboxes `w-4 h-4` (16px) with no enlarged tap zone | **High** | Selecting 30 rows for bulk categorization means 30 precision taps on 16px targets — slow, error-prone, frustrating | Wrap checkbox in a 44px label/td tap area (`p-3` on the cell, `htmlFor` row id); keep visual size | S |
| T3 | `PaginationBar.tsx` (compact) | Prev/Next: `text-xs px-1 py-0.5` ≈ **22px tall** | High | Paging through transaction history on a phone requires repeated precision taps | `min-h-[44px] px-3`; consider larger chevron-only buttons on mobile | S |
| T4 | `SortableHeader.tsx:48` | Sort chevron `opacity-0 group-hover:opacity-40` — **invisible on touch devices** (no hover); header button has no min-height | Medium | Touch users get no affordance that columns sort; sorting is effectively a hidden action on mobile | Always render the chevron at `opacity-40` on touch (`@media (hover:none)`), full opacity when active; add `aria-sort` | S |
| T5 | `BulkActionBar.tsx` | Action buttons `py-1.5` ≈ 34px; bar is `flex` with **no wrap and no overflow-x-auto** — 3 actions + count + Clear overflow at 320–375px | High | Bulk action buttons clip off-screen at phone widths; "Clear" can become unreachable | `flex-wrap gap-2` or `overflow-x-auto`; bump buttons to `min-h-[44px]` | S |
| T6 | `EmptyState.tsx` | Action is a `text-xs` underline link | Medium | The primary recovery action on empty screens is one of the smallest targets in the app | Render as a proper button (`min-h-[44px] px-4`, primary style) | S |
| T7 | `DataControlsBar.tsx` | Sort/Rows/View cluster `self-end` with `text-xs` controls; page-size `<select>` `py-1` | Medium | Frequently used controls at ~28–32px | Bump interactive heights to ≥40px on mobile breakpoint | S |
| T8 | Row expand chevrons (RowDetailPanel triggers) | `w-3.5 h-3.5` chevron in `p-1` button ≈ 22px | Medium | Progressive disclosure (the right pattern!) is gated behind a tiny target | Make the whole first cell or row header tappable to expand | S |

**Positives:** `inputCls` enforces `min-h-[44px]` on all form inputs; modal close button is `min-w/h-[44px]`; More-drawer items `min-h-[48px]`; primary page-header buttons are ~40px.

---

## 3 · TYPOGRAPHY

### Census (whole `src/`)

| Class | Size | Count | Note |
|---|---|---|---|
| `text-[10px]` | 10px (px-locked) | **151** | Ignores user font-size prefs |
| `text-[11px]` | 11px (px-locked) | **60** | Ignores user font-size prefs |
| `text-xs` | 12px | 975 | Dominant body size — too small as default |
| `text-sm` | 14px | 946 | Dominant secondary size |
| `text-base` | 16px | 42 | Rare |
| `text-lg`–`text-2xl` | 18–24px | 52 | Titles |

Worst sub-12px concentrations: `ImportModal.tsx` (20), `CategoryLedger.tsx` (19), `BankMovement.tsx` (14), `Outflows.tsx` (12), `Setup.tsx` (11), `Categories.tsx` (10).

### Issues

| # | Issue | Severity | Impact | Recommendation | Effort |
|---|---|---|---|---|---|
| Y1 | App's de-facto body size is 12px (`text-xs`), secondary at 10–11px | **High** | Treasurers are frequently 45+; reading 10px financial figures on a phone causes errors and zooming | Re-baseline: body 14px min, financial amounts 14–16px; reserve 12px for true captions | M–L |
| Y2 | 211 px-locked sub-12px instances don't scale with OS font-size settings | High | Users with Larger Text enabled get no benefit on exactly the smallest text | Replace `text-[10px]/[11px]` with `text-xs` (rem-based) minimum | M |
| Y3 | Bottom tab labels `text-[10px]`; active state = `font-semibold` only | Medium | Primary navigation labels barely legible; active tab hard to distinguish peripherally | 11–12px labels; add color+weight active state (already colored — verify contrast) | S |
| Y4 | Table headers `text-xs uppercase tracking-wide` in gray-400/500 | Medium | Low contrast + small caps + letterspacing = poor legibility | Keep size, raise color to gray-600 (≥4.5:1) | S |
| Y5 | StatCard label `text-xs uppercase text-gray-400` | Low | KPI labels under-readable in sunlight | gray-500/600 | S |

### Recommended type scale (mobile)

| Role | Recommended | Current typical |
|---|---|---|
| Page titles | 22–24px / bold (`text-2xl`) | 20–24px ✓ |
| Section headers | 17–18px / semibold | 14–16px ✗ |
| Card titles | 15–16px / semibold | 14px ✗ |
| Body text | **14–16px** | 12–14px ✗ |
| Secondary text | 13–14px | 12px ✗ |
| Labels (form/field) | 13–14px | 12px ✗ |
| Captions / meta | 12px floor | 10–11px ✗ |
| Table content | 13–14px; **amounts 14–15px mono** | 12–14px ~ |
| Mobile dashboard KPI values | 24–28px | 24px ✓ |
| Bottom-nav labels | 11–12px | 10px ✗ |

---

## 4 · ACCESSIBILITY

| # | Issue | Severity | WCAG | Impact | Recommendation | Effort |
|---|---|---|---|---|---|---|
| A1 | `FormField.tsx` `inputCls`/`filterInputCls` use `text-sm` (14px) → **iOS Safari auto-zooms on every input focus**, app-wide (also `LoginPage.tsx:20`) | **Critical** | — | Every form interaction on iOS lurches the viewport to ~115% zoom; user must pinch back out; the №1 perceived-quality killer | Make inputs 16px on mobile: `text-base sm:text-sm` in `inputCls`, `filterInputCls`, and LoginPage. Two-line fix, app-wide payoff | **S** |
| A2 | `text-gray-400` (#9ca3af ≈ 2.8:1 on white) used widely on sub-14px text: field icons-as-buttons, table headers, captions, EmptyState copy | High | 1.4.3 AA fail | Low-vision users (and anyone outdoors) cannot read these | gray-500 minimum for ≥14px, gray-600 for <14px text | M |
| A3 | Icon-only row actions rely on `title=` (Pencil/Trash etc.) rather than `aria-label` | High | 4.1.2 | `title` is unreliable for screen readers and invisible on touch; 74 `aria-label`s exist but coverage is partial | Add `aria-label` to every icon-only button (audit: row actions, expand chevrons, X buttons, copy buttons) | S |
| A4 | No `aria-sort` anywhere; sort state conveyed by a hover-only chevron | Medium | 1.3.1 | SR users can't tell sort column/direction | Add `aria-sort` to `SortableHeader` `<th>` | S |
| A5 | MFA code inputs (`MFAEnrollModal`, `MFAChallengeModal`) have `inputMode="numeric"` ✓ but no `autocomplete="one-time-code"` | Medium | — | iOS/Android SMS-code auto-fill doesn't trigger; users transcribe 6 digits manually | Add `autoComplete="one-time-code"` | S |
| A6 | Loading: `LoadingSkeleton`/`CardSkeleton`/`TableRowSkeleton` have no `role="status"`/`aria-busy`/SR text | Medium | 4.1.3 | SR users hear silence during loads | Wrap skeleton regions in `role="status"` + `sr-only` "Loading…"; `aria-hidden` the pulse divs | S |
| A7 | Color-only meaning: green/red `AmountCell` values; status badges color-coded | Medium | 1.4.1 | Color-blind users can't distinguish inflow/outflow at a glance in mixed ledgers | Already mitigated in ledgers by separate In/Out columns; for card views add `+`/`−` prefix or directional icon | S |
| A8 | Dashboard Recharts charts have no text alternative / table fallback | Medium | 1.1.1 | Chart data invisible to SR users | `role="img"` + `aria-label` summary; "View as table" toggle | M |
| A9 | No focus move on SPA route change (title updates via `usePageTitle` ✓, focus does not) | Medium | 2.4.3 | SR/keyboard users stay focused on the old nav link after navigation | Focus `#main-content` (tabindex −1) on route change | S |
| A10 | Toast `role="alert"` ✓ but errors auto-dismiss; no persistent error surface for failed mutations beyond the toast | Medium | — | Users who glance away lose the only record of what failed | Persist error toasts until dismissed (success can auto-dismiss); or inline error banner on the page | S–M |
| A11 | Touch-device focus: `:focus:not(:focus-visible){outline:none}` removes all feedback for touch interactions on controls without active styles | Low | — | Some buttons give no pressed feedback | Add `active:` scale/bg states on primary buttons | S |

**Positives:** global `:focus-visible` ring with dark variant; skip link; modal focus trap + focus return + `role="dialog" aria-modal`; `Field` auto-injects `aria-invalid`/`aria-describedby`/`htmlFor` with `role="alert"` errors; toasts `role="alert"`+`aria-live`; `aria-expanded` on More button & CollapsibleSection; `aria-pressed` on ViewToggle; `prefers-reduced-motion` respected; `color-scheme: dark` set.

---

## 5 · FORMS

| # | Screen | Issue | Severity | Impact | Recommendation | Effort |
|---|---|---|---|---|---|---|
| F1 | ~16 fields across `ImportModal`, `BulkReallocation`, `CreateSpecialConfigModal`, `AddFXConversionModal`, `ReconciliationCenter`, `ForeignCurrency`, `AllocationConfigModal`, `AddIntraFlowModal` | `type="number"` inputs (vs. the correct `type="text" inputMode="decimal"` already used by `CurrencyInput` and `Import.tsx`) | High | `type=number` brings spinner artifacts, scroll-wheel value changes, locale decimal-comma rejection, silent empty-on-invalid — dangerous for amounts and percentages | Standardize on `CurrencyInput`/`inputMode="decimal"` pattern for all monetary/percent fields | M |
| F2 | `AddInflowModal` / `AddOutflowModal` | 16 `<Field>`s each in one scroll; **no `CollapsibleSection` is used in any modal** despite the component existing | High | On a phone this is 4–5 screens of scrolling for what is usually a 5-field task; cognitive load + missed-field risk | Group optional fields (FX details, remarks, refs, stage codes) into collapsed `CollapsibleSection`s; keep the happy path (date, amount, bank, type, description) above the fold | M |
| F3 | All modals | No scroll-to-first-error on submit (only `DynamicReportEditor` uses `scrollIntoView`) | High | Submitting a long form with an error above the fold appears to "do nothing" — user taps Save repeatedly | On failed validation, scroll first `aria-invalid` field into view and focus it | S |
| F4 | All modals | Footer buttons are right-aligned inline pair; no full-width stacking on mobile; Cancel sits beside Save | Medium | Sub-44px-wide Cancel adjacent to Save risks wrong-tap; thumb reach favors full-width | Stack `Save` (full-width, primary) above `Cancel` below `sm:`; keep desktop layout | S |
| F5 | Required-field marking | `*` in label text by convention, not enforced; some labels lack it | Low | Users can't predict which fields block submission | Audit labels; standardize asterisk + "(optional)" suffixes | S |
| F6 | `SearchableSelect` / `InlineCategorySelect` | Custom dropdown lists inside scrollable modal bodies; with keyboard open, list + keyboard can exceed viewport | Medium | Category picking (the most common bulk task) becomes scroll-fighting | Cap list `max-h-[40dvh]`; consider bottom-sheet presentation on mobile for long lists | M |
| F7 | Date entry | Native `type="date"` ✓ (good), but no quick presets at point of entry (DatePresetBar exists for filters only) | Low | Most entries are "today"/"last Sunday" | Default to today ✓; add "Yesterday / Last Sunday" chips in Add modals | S |
| F8 | `Setup` → color pickers (`TypeColorPicker`) | 14 swatches + native color input + hex field | — | Fine on mobile | Ensure swatches ≥32px with 8px gaps | S |

**Positives:** sticky modal footers with `form=` submit wiring; dirty-guard ("Discard changes?") on every close path incl. Cancel; `disableClose` during async ops; type-to-confirm on `ResetDataModal`/`DeleteOrgModal`; proper `autoComplete` on auth forms; native date inputs; `CurrencyInput` with `inputMode="decimal"`.

---

## 6 · TABLES & FINANCIAL DATA

### Coverage map

- **Card view available (7 pages + Import step 4):** Inflows, Outflows, BankLedger, BankMovement, Categories, CategoryLedger, IntraFlow — the right pages prioritized ✓, with mobile defaulting to cards ✓.
- **Table-only (~16 pages):** ChangeLog, PendingDeductions, ForeignCurrency (txn table), Receipts, UserManagement, RefundTransactions, ReversalTransactions, SpecificGivings, SavingsPortions, PercentageAllocation, AllocationConfigs, Setup tabs, Reports, FinancialReport, BulkReallocation, ReconciliationCenter detail tables.

| # | Issue | Severity | Impact | Recommendation | Effort |
|---|---|---|---|---|---|
| D1 | Table-only pages above force horizontal panning for 5–8 column financial tables | **High** | On PendingDeductions (an action queue!) and ChangeLog (old/new diffs) users pan repeatedly, losing row context | Priority order for card views: **PendingDeductions, ChangeLog, ForeignCurrency, RefundTransactions, ReversalTransactions, UserManagement**; reuse the existing card-view + `RowDetailPanel` patterns | M–L |
| D2 | No sticky first column (or sticky header) on any horizontally scrolling table | High | Panning to Amount/Balance hides Date/Description — "which row am I on?" | `position:sticky left-0` on the first data column with bg + right shadow on scroll | M |
| D3 | FX table 4dp amounts + `font-mono whitespace-nowrap` widen rows beyond two viewports | Medium | Heavy panning on FX review | Card view 2dp with tap-to-expand 4dp (cards already use 2dp ✓ — extend to txn list) | M |
| D4 | tfoot totals only visible after scrolling to table bottom; closing balances are the №1 mobile glance target | Medium | Treasurer opens BankLedger to check balance → must scroll past N rows | Surface closing balance in a summary strip above the table (some pages have this — make universal on ledger pages) | S |
| D5 | `DescriptionCell` popover (tap-to-expand) is the right pattern ✓, but popover is `z-[9999]` portal w/o viewport clamping audit at 320px | Low | Long descriptions may clip at edges | Clamp popover within `100vw - 16px` | S |
| D6 | ChangeLog old→new values in adjacent columns | Medium | Diff comprehension requires panning between old and new | Stacked "old ↘ new" card layout on mobile | M |

**Positives:** `AmountCell` standardization (right-aligned, mono, semantic colors); `RowDetailPanel` progressive disclosure already on 10 pages; `EmptyState compact` inside tables; B/F row protection in CategoryLedger; `DataTable` enforces header/divider standards.

---

## 7 · BULK ACTIONS

| # | Issue | Severity | Impact | Recommendation | Effort |
|---|---|---|---|---|---|
| B1 | `BulkActionBar` renders **inline at the top of the table** — selecting rows mid-list scrolls the bar out of view; selection count and actions become invisible | **High** | The user selects 12 rows, then must scroll back up to act; selection state feels lost ("hidden actions") | On mobile, render as a **fixed bottom action bar** above the tab bar (`bottom: calc(var(--tab-bar-height) + env(safe-area-inset-bottom))`) with count + actions; this also fixes one-handed reach | M |
| B2 | Bar overflows horizontally at ≤375px with 3+ actions (no wrap / no scroll) | High | Buttons clipped, Clear unreachable | `flex-wrap` or horizontal scroll with edge fade; collapse to icon+label sheet on overflow | S |
| B3 | Selection: 16px checkboxes, one tap per row; select-all covers the current page; no tap-drag range select, no "select all N matching" | Medium | Selecting 40 of 200 filtered rows = 40 precision taps + pagination juggling | Enlarge tap zones (T2); add "Select all N matching filter" affordance after select-all-page; consider long-press-to-select in card view | M |
| B4 | `PendingDeductions` bulk resolve loops mutations sequentially with toasts only at the end | Medium | On 30+ rows the UI sits silent for seconds — feels hung | Show inline progress ("Resolving 12/30…") in BulkActionBar during the loop | S |
| B5 | Bulk taps summary: bulk-categorize 10 rows ≈ **14 taps** (10 selects + bar action + modal field + save + confirm) — acceptable; the cost is per-tap precision, not count | — | — | Fixes T2 + B1 bring effort down more than redesign | — |

**Positives:** selection count always shown when bar visible; `BulkResultsModal` reports partial failures; guard-rails on bulk resolve (skip-not-error); bulk edit modals reuse standard form patterns.

---

## 8 · WORKFLOW EFFICIENCY (tap estimates, mobile)

| Task | Current path | Taps* | Cognitive load | Opportunities |
|---|---|---|---|---|
| Record inflow | Dashboard → Add Inflow → 16-field modal → Save | ~12–18 | **High** — 16 fields visible for a ~5-field task; jargon (stage codes, allocation config) un-explained inline | F2 grouping (collapse optional fields) cuts perceived form to 5 fields; smart defaults (last-used bank/type) |
| Import statement | Import → 5-step wizard (Upload → Sheet → Map → Configure rows → Import) | ~10 + per-row config | High but well-structured; step 4 has card view + apply-bars ✓ | Persist column mappings per bank (if not already); show step indicator with progress on mobile; biggest sub-12px text cleanup target (20 instances) |
| Reconcile account | ReconciliationCenter → run → review match groups → resolve | ~6–10 | Medium — responsive grids ✓, `ConfidenceGauge`/`TransactionStory` aid comprehension ✓ | Detail tables need card/sticky treatment (D1/D2); keep primary "resolve" CTA in thumb zone |
| Investigate discrepancy | Recon → drill into group → RootTransactionSearch | ~5–8 | Medium-high | `text-[10px]/[11px]` in RootTransactionSearch/TransactionStory hurt exactly this flow — raise to 12px+ |
| Approve/resolve pending | PendingDeductions → select → bulk resolve | ~N+3 | Medium | B1–B4; card view (D1) |
| Review reports | Reports/FinancialReport | ~3–5 to view | **FinancialReport edit on touch: near-unusable** — dnd-kit configured with `PointerSensor {distance:5}` only; drag conflicts with scroll, no `TouchSensor` with long-press delay | Add `TouchSensor` with `{delay:250, tolerance:8}`; provide non-drag reorder (up/down buttons) as fallback — pure UI, no logic change |

*Taps exclude typing keystrokes.

---

## 9 · USER STRESS REDUCTION

| # | Finding | Severity | Recommendation | Effort |
|---|---|---|---|---|
| S1 | Error toasts auto-dismiss → failed save evidence vanishes | Medium | Errors persist until dismissed; successes auto-dismiss | S |
| S2 | Destructive confirmation is strong ✓ (DeleteDialog, type-to-confirm for org/data resets), but row Delete is a bare confirm with the tiny target (T1) | High | Fix T1; in DeleteDialog, restate the record (date + amount + description) so users confirm *what*, not just *whether* | S |
| S3 | Friendly error layer (`friendlyError`, `TechDetails` collapsed) is excellent ✓ — verify all mutation catches route through it | Low | Sweep for raw `error.message` toasts | S |
| S4 | Empty states are neutral and calm ✓ (`PageEmptyState` onboarding definitions); action link too small (T6) | Low | T6 | S |
| S5 | Reconciliation tone: gauge + story humanize matching ✓; discrepancy rows should lead with "what to do next" copy, not just deltas | Medium | Add one-line guidance per discrepancy state | M |
| S6 | No undo anywhere; deletes are confirm-only | Medium | Out of scope to change data layer — but a 5s "Deleted — Undo" toast calling the existing add-mutation is a pure-UI compensator worth designing later | L |

---

## 10 · MOBILE PERFORMANCE PERCEPTION

| # | Finding | Severity | Recommendation | Effort |
|---|---|---|---|---|
| P1 | Refetch-after-mutation swaps the whole table for skeletons (the scroll-preservation pattern exists precisely to fight the symptom) | Medium | Keep stale data rendered during refetch (`loading && !data` gates skeletons; show a thin top progress bar instead) — perceived speed win, no data-layer change | M |
| P2 | Skeletons exist ✓ but full-screen spinner (`LoadingSkeleton`) used for route loads — feels heavier than content-shaped skeletons | Low | Page-shaped skeletons for top 5 pages | M |
| P3 | `ButtonSpinner` on async buttons ✓; `useCountUp` on KPIs ✓ | — | Keep | — |
| P4 | No view transitions between routes; tab switches are instant-blank-then-paint | Low | 150ms fade on route content (respect reduced-motion) | S |

---

## 11 · ONE-HANDED USAGE

| # | Finding | Severity | Recommendation | Effort |
|---|---|---|---|---|
| O1 | Bottom tab bar + grouped More drawer = strong thumb-zone navigation ✓ | — | Keep | — |
| O2 | Primary page actions (Add Inflow/Outflow, Export, Run) live in the **page header (top)** — the hardest one-handed zone on 6"+ phones | High | Mobile-only FAB or bottom-aligned primary CTA for the page's main action (Add on ledger pages, Resolve on PendingDeductions); coordinate with calculator/help FABs (L7) | M |
| O3 | Modal close X top-right only; no swipe-down-to-close on full-screen mobile modals | Medium | Add drag-handle + swipe-to-close (routes through existing dirty-guard `requestClose`) ; until then the sticky footer Cancel (F4 full-width) covers reach | M |
| O4 | Filters/sort/search at top of every list page | Medium | Acceptable (setup-once controls); ensure DataControlsBar taps ≥40px (T7) | S |
| O5 | BulkActionBar at top (B1) breaks one-handed bulk flows | High | B1 bottom-bar fix doubles as the one-handed fix | M |

---

## REMEDIATION ROADMAP

### Phase 1 — Critical usability fixes (1–2 sprints, mostly S effort)
1. **A1** 16px inputs on mobile (`inputCls`, `filterInputCls`, LoginPage) — kills iOS zoom.
2. **L1** `viewport-fit=cover` + safe-area insets (tab bar, drawer, modal footer, toasts, FABs).
3. **L2** `h-dvh` modals + keyboard-safe sticky footer.
4. **T1** 44px row Edit/Delete targets + spacing.
5. **T2** 44px checkbox tap zones.
6. **T3** 44px pagination controls.
7. **B2** BulkActionBar wrap/overflow fix at narrow widths.
8. **F3** Scroll-to-first-error in modals.
9. **S2** DeleteDialog restates the record being deleted.

### Phase 2 — Mobile workflow improvements
1. **B1/O5** Fixed bottom BulkActionBar on mobile.
2. **F2** Collapse optional groups in AddInflow/AddOutflow (CollapsibleSection).
3. **D1** Card views for PendingDeductions, ChangeLog, ForeignCurrency, Refunds, Reversals, UserManagement.
4. **D2** Sticky first column on remaining scroll tables.
5. **F1** Replace `type="number"` with decimal-keyboard pattern on all 16 sites.
6. **D4** Closing-balance summary strip on all ledger pages.
7. **B3** "Select all N matching" + larger selection ergonomics.
8. **O2** Mobile FAB / bottom CTA for primary page actions.
9. Reports: **TouchSensor + non-drag reorder** for FinancialReport editor.

### Phase 3 — Accessibility improvements
1. **A2/Y4** Contrast pass: gray-400 → gray-500/600 on small text (incl. dark variants).
2. **Y1/Y2** Type-scale re-baseline; eliminate `text-[10px]/[11px]` (211 instances).
3. **A3** `aria-label` sweep on icon-only buttons.
4. **A4** `aria-sort` + always-visible sort chevrons on touch.
5. **A5** `autocomplete="one-time-code"` on MFA.
6. **A6** `role="status"` loading announcements.
7. **A8** Chart text alternatives / table toggle.
8. **A9** Focus main on route change.
9. **A10/S1** Persistent error toasts.

### Phase 4 — Premium mobile experience
1. **O3** Swipe-down-to-close modals with drag handle.
2. **P1** Stale-while-refetching tables + top progress bar.
3. **F6** Bottom-sheet pickers for long category/bank lists.
4. **L7** FAB orchestration + landscape bottom-sheet calculator.
5. **P4** Route transitions (reduced-motion aware).
6. **D6** ChangeLog mobile diff cards.
7. **F7** Date quick-chips in entry modals.
8. **L10** Scroll-edge fades on panning containers.
9. **S6** Undo-toast design exploration.

---

## MOBILE UX SCORE: **63 / 100**

| Dimension | Score | Rationale |
|---|---|---|
| Layout & responsiveness | 7/10 | Solid shell, overflow backstops; loses points on safe areas, dvh, landscape |
| Touch targets | 4/10 | Inputs 44px ✓ but the most-tapped controls (row actions, checkboxes, pagination) are 16–28px |
| Typography | 5/10 | Consistent system, but baseline too small; 211 sub-12px px-locked instances |
| Accessibility | 7/10 | Strong semantics/focus foundations; contrast + announcements gaps |
| Forms | 6/10 | Great primitives & guards; iOS zoom, long flat forms, `type=number` |
| Tables & data | 6/10 | Card views + RowDetailPanel on key pages ✓; 16 pan-only tables, no sticky column |
| Bulk actions | 5/10 | Capable but top-anchored bar + tiny checkboxes |
| Workflow efficiency | 7/10 | Import wizard & recon flows well-structured; entry forms heavy |
| Stress & confidence | 8/10 | Dirty guards, friendly errors, type-to-confirm — genuinely good |
| One-handed usage | 6/10 | Bottom nav ✓; primary actions and bulk bar live at the top |

---

## TOP 20 IMPROVEMENTS (highest usability & confidence ROI)

1. 16px input font on mobile — eliminates iOS auto-zoom app-wide (A1) — **S**
2. Safe-area support: `viewport-fit=cover` + insets on tab bar/modals/toasts/FABs (L1) — **S**
3. 44px row Edit/Delete targets with spacing — de-risks accidental Delete (T1) — **S**
4. Keyboard-safe modals (`h-dvh`, footer visible while typing) (L2) — **S**
5. Fixed bottom BulkActionBar on mobile (B1/O5) — **M**
6. 44px checkbox tap zones for bulk select (T2) — **S**
7. Card views for PendingDeductions + ChangeLog + ForeignCurrency (D1) — **M**
8. Sticky first column on horizontally scrolling tables (D2) — **M**
9. Collapse optional fields in Add Inflow/Outflow to a 5-field happy path (F2) — **M**
10. Scroll-to-first-error on modal submit (F3) — **S**
11. Replace `type="number"` with decimal-keyboard inputs (16 sites) (F1) — **M**
12. Contrast pass on gray-400 small text (A2) — **M**
13. Eliminate `text-[10px]/[11px]`; 12px floor (Y1/Y2) — **M**
14. 44px pagination controls (T3) — **S**
15. Always-visible sort affordance + `aria-sort` (T4/A4) — **S**
16. Closing-balance summary strip on ledger pages (D4) — **S**
17. Mobile FAB/bottom CTA for each page's primary action (O2) — **M**
18. Persistent error toasts + DeleteDialog record restatement (S1/S2) — **S**
19. Stale-while-refetch tables (no skeleton flash after saves) (P1) — **M**
20. `aria-label` sweep + loading announcements + one-time-code autofill (A3/A6/A5) — **S**

---

*All findings are confined to the presentation layer. No recommendation alters business logic, financial calculations, permissions, reconciliation logic, import pipelines, audit trails, security controls, or backend architecture.*
