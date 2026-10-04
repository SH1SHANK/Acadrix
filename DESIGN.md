# Acadrix Design System

Canonical design language for Acadrix. This document is normative: implementers must not introduce visual values that are not defined here. If a need is not covered, extend the tokens first, then use them.

**Character:** minimal, editorial, technical, academic. Content is the interface; chrome recedes.

**Non-goals:** gradients, glassmorphism, blur, decorative illustration, marketing-style UI, animated attention-seeking.

---

## 1. Implementation Principles

1. **Tokens only.** No raw hex, px, ms, or shadow values in component CSS. Every value resolves to a `--acx-*` custom property.
2. **Three token tiers.** Brand → Semantic UI → Component. Components reference semantic tokens only; semantic tokens reference brand tokens. Components never reference brand tokens directly.
3. **Shadow DOM first.** All UI lives inside a shadow root. Tokens are declared on `:host`. The host page's CSS must not affect Acadrix and Acadrix must not leak out.
4. **Primitives over bespoke styling.** Build from a small set of primitives (`Button`, `IconButton`, `Input`, `Badge`, `Card`, `Surface`, `Overlay`). Components compose primitives; they do not restyle them.
5. **No new dependencies.** Plain CSS custom properties and native elements. No CSS framework, no CSS-in-JS runtime, no icon font.
6. **Native semantics first.** Use `<button>`, `<input>`, `<dialog>`-like patterns, and real headings before ARIA.
7. **Units.** Use `px` for UI chrome. Do not use `rem`/`em` for layout inside the shadow root: `rem` resolves against the host page's root font size, which is unpredictable. Use `em` only for typographic spacing within content (e.g., paragraph margins).

### Shadow DOM requirements

- Start every root with `:host { all: initial; }`, then declare tokens and base font properties.
- **`@font-face` declared inside a shadow root is not applied.** Fonts must be registered in the host document (inject one `<style>` with `@font-face` into `document.head`, with `src` from `chrome.runtime.getURL`) and listed under `web_accessible_resources`. Referencing by `font-family` inside the shadow root then works.
- Fonts are bundled locally (no CDN). Use `font-display: swap` and always specify the fallback stacks from §2.
- Set `color-scheme` on `:host` so native controls and scrollbars match the theme.
- Stacking: the launcher and reader share a single top-level container with `z-index: 2147483647`. Internal layering uses only the `--acx-z-*` tokens.
- Do not rely on `position: fixed` inside transformed ancestors; keep the fixed container at the shadow root top level.

---

## 2. Typography

### Families

| Role | Family | Use |
|---|---|---|
| UI / body | **Satoshi Variable** | All UI text, reader body, questions, options, labels |
| Display / brand | **Outfit** | Wordmark, reader title, section headlines (h1–h2), empty/hero states |
| Mono | **JetBrains Mono Nerd Font** | Code, keyboard shortcuts, diagnostics, technical metadata (IDs, timestamps, versions, token counts) |

```css
--acx-font-ui:      "Satoshi Variable", "Satoshi", system-ui, -apple-system, "Segoe UI", sans-serif;
--acx-font-display: "Outfit", "Satoshi Variable", system-ui, sans-serif;
--acx-font-mono:    "JetBrainsMono Nerd Font", "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
```

Rules: never use Outfit below 18px or for running text. Never use mono for UI labels or buttons (except shortcut hints). Never mix more than two families in one component.

### Weights

Satoshi Variable: **400** body, **500** labels/UI emphasis, **700** headings and strong emphasis. Outfit: **500** and **600** only. JetBrains Mono: **400** and **500**. No italics in UI chrome; italics permitted in content only (emphasis, citations).

### Type scale (px / line-height / tracking)

| Token | Size | Line height | Weight | Family | Use |
|---|---|---|---|---|---|
| `--acx-text-display` | 32 | 40 | 600 | Outfit | Hero/empty-state headline |
| `--acx-text-h1` | 26 | 34 | 600 | Outfit | Reader title |
| `--acx-text-h2` | 20 | 28 | 600 | Outfit | Section heading |
| `--acx-text-h3` | 17 | 24 | 700 | Satoshi | Sub-section, card title |
| `--acx-text-body` | 16 | 26 | 400 | Satoshi | Reader/content body |
| `--acx-text-ui` | 14 | 20 | 500 | Satoshi | Buttons, inputs, menu items |
| `--acx-text-small` | 13 | 18 | 400 | Satoshi | Secondary text, helper text |
| `--acx-text-caption` | 12 | 16 | 500 | Satoshi | Badges, captions, table headers |
| `--acx-text-mono` | 13 | 20 | 400 | Mono | Code, shortcuts, metadata |

Tracking: `-0.01em` for display/h1/h2; `0` elsewhere; `0.04em` uppercase only on caption-size overlines. Minimum text size anywhere: 12px. Body measure in the reader: 60–72 characters (`max-width: 68ch`).

---

## 3. Design Tokens

### 3.1 Brand tokens (identity; theme-independent unless noted)

```css
/* Accent */
--acx-brand-accent-500: #2F4BDB;   /* Acadrix blue: light-theme accent */
--acx-brand-accent-600: #2540C2;   /* light hover */
--acx-brand-accent-700: #1D33A3;   /* light pressed */
--acx-brand-accent-300: #8EA2FF;   /* dark-theme accent */
--acx-brand-accent-200: #A9B8FF;   /* dark hover */
--acx-brand-accent-400: #7089F5;   /* dark pressed */

/* Neutrals: light */
--acx-brand-paper-0:   #FFFFFF;
--acx-brand-paper-50:  #FAFAF8;
--acx-brand-paper-100: #F3F3F0;
--acx-brand-paper-200: #E4E4DF;
--acx-brand-paper-300: #CFCFC8;
--acx-brand-ink-900:   #16181D;
--acx-brand-ink-600:   #5B606B;
--acx-brand-ink-500:   #6B707B;

/* Neutrals: dark */
--acx-brand-night-950: #0E1013;
--acx-brand-night-900: #15181D;
--acx-brand-night-800: #1C2026;
--acx-brand-night-700: #2A2F37;
--acx-brand-night-600: #3A404A;
--acx-brand-fog-100:   #ECEDEF;
--acx-brand-fog-300:   #A3A8B2;
--acx-brand-fog-400:   #868B95;

/* Typography families: see §2 */
```

### 3.2 Semantic UI tokens (what components consume)

Defined per theme. Values shown as `light / dark`.

```css
/* Surfaces */
--acx-bg:              paper-50   / night-950;   /* page-level backdrop inside Acadrix */
--acx-surface:         paper-0    / night-900;   /* cards, reader, inputs */
--acx-surface-raised:  paper-0    / night-800;   /* dialogs, menus, popovers */
--acx-surface-sunken:  paper-100  / night-950;   /* code blocks, table header, input wells */
--acx-overlay-scrim:   rgb(22 24 29 / 0.40) / rgb(0 0 0 / 0.60);

/* Text */
--acx-text:            ink-900 / fog-100;
--acx-text-muted:      ink-600 / fog-300;
--acx-text-subtle:     ink-500 / fog-400;        /* non-essential only; ≥4.5:1 on surface */
--acx-text-on-accent:  #FFFFFF / #0E1013;
--acx-text-disabled:   paper-300 / night-600;    /* exempt from contrast; always paired with non-color cue */

/* Borders */
--acx-border:          paper-200 / night-700;
--acx-border-strong:   paper-300 / night-600;

/* Accent */
--acx-accent:          accent-500 / accent-300;
--acx-accent-hover:    accent-600 / accent-200;
--acx-accent-active:   accent-700 / accent-400;
--acx-accent-subtle:   rgb(47 75 219 / 0.08) / rgb(142 162 255 / 0.14);  /* selected rows, tinted bg */
--acx-focus-ring:      accent-500 / accent-300;

/* Semantic status (fg / subtle bg) */
--acx-success:         #1A7F4B / #5FD08A;   --acx-success-bg: rgb(26 127 75 / 0.10) / rgb(95 208 138 / 0.14);
--acx-warning:         #9A6700 / #E3B341;   --acx-warning-bg: rgb(154 103 0 / 0.10) / rgb(227 179 65 / 0.14);
--acx-error:           #C62828 / #FF7B72;   --acx-error-bg:   rgb(198 40 40 / 0.08) / rgb(255 123 114 / 0.14);
--acx-info:            #0B6FB8 / #62B0F0;   --acx-info-bg:    rgb(11 111 184 / 0.08) / rgb(98 176 240 / 0.14);
```

State derivation (do not hand-pick per component):

| State | Rule |
|---|---|
| Hover | Accent surfaces → `--acx-accent-hover`. Neutral surfaces → overlay `--acx-accent-subtle`. |
| Active/pressed | Accent surfaces → `--acx-accent-active`. Neutral → `--acx-accent-subtle` + `--acx-border-strong`. |
| Focus | `--acx-focus-ring` outline, see §10. |
| Disabled | `--acx-text-disabled` text, `--acx-surface-sunken` fill, `cursor: not-allowed`, no hover/active response. |
| Selected | `--acx-accent-subtle` fill + 2px inline-start accent bar or check icon. |

### 3.3 Spacing, shape, depth, motion tokens

```css
/* Spacing: 4px base */
--acx-space-0: 0;   --acx-space-1: 4px;  --acx-space-2: 8px;  --acx-space-3: 12px;
--acx-space-4: 16px; --acx-space-5: 20px; --acx-space-6: 24px; --acx-space-8: 32px;
--acx-space-10: 40px; --acx-space-12: 48px; --acx-space-16: 64px;

/* Radii */
--acx-radius-sm: 4px;   /* badges, code inline, small chips */
--acx-radius-md: 8px;   /* buttons, inputs, menu items */
--acx-radius-lg: 12px;  /* cards, dialogs */
--acx-radius-xl: 16px;  /* bottom-sheet top corners */
--acx-radius-full: 999px; /* launcher, pills */

/* Borders */
--acx-border-width: 1px;
--acx-border-width-strong: 2px;   /* focus ring, selected bar */

/* Elevation (light; dark uses higher opacity, same offsets) */
--acx-shadow-1: 0 1px 2px rgb(22 24 29 / 0.06);                               /* cards (optional) */
--acx-shadow-2: 0 4px 12px rgb(22 24 29 / 0.10);                              /* menus, popovers, launcher */
--acx-shadow-3: 0 12px 32px rgb(22 24 29 / 0.16), 0 2px 6px rgb(22 24 29 / 0.08); /* dialogs, reader */
/* dark: replace rgb(22 24 29 / a) with rgb(0 0 0 / a*2.5) */

/* Motion */
--acx-duration-fast: 120ms;   /* hover, press, color */
--acx-duration-base: 200ms;   /* menus, fades, small transforms */
--acx-duration-slow: 280ms;   /* reader sheet enter/exit */
--acx-ease-standard: cubic-bezier(0.2, 0, 0, 1);
--acx-ease-exit:     cubic-bezier(0.4, 0, 1, 1);

/* Layers */
--acx-z-launcher: 1;  --acx-z-reader: 2;  --acx-z-popover: 3;  --acx-z-dialog: 4;  --acx-z-toast: 5;

/* Sizing */
--acx-control-h-sm: 28px;  --acx-control-h-md: 36px;  --acx-control-h-lg: 44px;
--acx-target-min: 32px;    /* fine pointer */  /* 44px under (pointer: coarse); see §9 */
--acx-reader-measure: 68ch;
```

### 3.4 Theme strategy

- Default follows `prefers-color-scheme`. An explicit `data-theme="light|dark"` attribute on the shadow host overrides it.
- Acadrix **never** inherits the host page's theme.
- Implement as: light tokens on `:host`; dark tokens under `@media (prefers-color-scheme: dark) { :host(:not([data-theme="light"])) { … } }` and `:host([data-theme="dark"]) { … }`. Keep both dark blocks generated from one source to prevent drift.
- Elevation in dark mode relies on surface lightness steps (`surface` → `surface-raised`) plus a border; shadows are secondary.

---

## 4. Shape & Depth

- **Borders over shadows.** Default separation is a 1px `--acx-border`. Shadows are reserved for floating layers.
- **Elevation levels:** 0 flat (inline content), 1 card (optional, only when a border is absent), 2 launcher/menus/popovers, 3 dialogs/reader.
- **Dividers:** 1px `--acx-border`, full-bleed inside containers, inset by `--acx-space-4` inside lists. No decorative dividers.
- **Radius pairing:** a child's radius is the parent's minus its padding (nested rounding), never larger than the parent's.
- No gradients. No blur. No inner shadows.

---

## 5. Spacing & Density

- Everything snaps to the 4px scale. Odd values (e.g., 5px, 10px) are prohibited.
- **Density:** compact-by-default for chrome (`control-h-md` 36px), comfortable for reading (body 16/26, `space-6` block gaps). Do not mix: chrome is dense, content is airy.
- Component padding:

| Component | Padding (block × inline) |
|---|---|
| Button md | 0 × `space-4`; height 36 |
| Button sm / lg | 0 × `space-3` / `space-5`; height 28 / 44 |
| Input | 0 × `space-3`; height 36 |
| Badge | `space-1` × `space-2` |
| Card | `space-4` (compact), `space-6` (default) |
| Dialog | `space-6`; footer gap `space-2` |
| Reader content | `space-6` inline (narrow: `space-4`), `space-8` top |
| Menu item | `space-2` × `space-3`; height 36 |

- Gaps: `space-2` between related controls, `space-4` between groups, `space-6`/`space-8` between content blocks/sections.

---

## 6. Components

All interactive components expose: default, hover, focus-visible, active, disabled (and loading/selected where relevant). Transitions: `color, background-color, border-color, box-shadow, opacity, transform` over `--acx-duration-fast` with `--acx-ease-standard`.

### Button
Native `<button>`. `--acx-text-ui`, weight 500, radius-md, 1px border.
- **Primary:** fill `--acx-accent`, text `--acx-text-on-accent`. One per view/region.
- **Secondary:** fill `--acx-surface`, border `--acx-border-strong`, text `--acx-text`.
- **Ghost:** transparent, no border, text `--acx-text-muted`; hover → `--acx-accent-subtle` + `--acx-text`.
- **Destructive:** secondary style with `--acx-error` text/border; confirm in a dialog.
- Optional leading icon 16px with `space-2` gap. Loading: replace icon with 16px spinner, keep width, set `aria-busy="true"`, block activation.

### Icon button
Square, `--acx-control-h-md` (36) visual min 32; 44 under coarse pointers. Icon 18px, stroke 1.5–2px, `currentColor`. Ghost style by default. **Requires `aria-label`** and a tooltip (`title` or custom) with shortcut in mono if one exists. Toggle variants use `aria-pressed` and the `selected` treatment.

### Input
Native `<input>`/`<textarea>`/`<select>`. Fill `--acx-surface`, 1px `--acx-border-strong`, radius-md, height 36, `--acx-text-ui` weight 400. Placeholder `--acx-text-subtle`. Hover: border `--acx-text-subtle`. Focus: border `--acx-accent` + focus ring. Invalid: border `--acx-error`, error icon + message below (`--acx-text-small`, `--acx-error`), `aria-invalid` and `aria-describedby`. Label always visible above (`--acx-text-caption`, 500); never placeholder-only.

### Badge / status indicator
`--acx-text-caption`, radius-sm, `--acx-<status>-bg` fill, `--acx-<status>` text, 1px border at same hue (α 0.3). **Always includes an icon or text label**, never color alone. Neutral badge: `--acx-surface-sunken` + `--acx-text-muted`. Technical badges (IDs, versions) use mono.

### Card
`--acx-surface`, 1px `--acx-border`, radius-lg, padding per §5, no shadow by default. Interactive cards: whole card is one focusable element/link; hover → border `--acx-border-strong` + `--acx-accent-subtle` tint; no lift/translate. Title `--acx-text-h3`.

### Dialog / overlay
Centered, `--acx-surface-raised`, 1px `--acx-border`, radius-lg, `--acx-shadow-3`, width `min(480px, 100vw − 32px)`, max-height `calc(100dvh − 64px)` with internal scroll. Scrim `--acx-overlay-scrim`. `role="dialog"`, `aria-modal="true"`, labelled by its title. **Focus trap, Esc closes, focus returns to the trigger.** Footer: right-aligned, secondary then primary. Enter: fade + 8px translate-up (`duration-base`).

### Bottom-sheet reader
The primary surface. Fixed to the viewport bottom, `--acx-surface`, top border 1px `--acx-border`, top radius `--acx-radius-xl`, `--acx-shadow-3`. Structure: **handle → header → scroll region → (optional) footer**. Only the scroll region scrolls (`overscroll-behavior: contain`). Handle: 36×4px, `--acx-border-strong`, radius-full, centered, also a button for keyboard resize/close. Dimensions in §9. `role="dialog"` (non-modal unless a scrim is shown), labelled by the title; Esc closes; focus moves into the sheet on open and returns to the launcher on close. Enter/exit: translate-Y from 100% (`duration-slow`).

### Launcher
Fixed, bottom-right, 16px inset (plus `env(safe-area-inset-*)`). 44×44, `--acx-radius-full`, `--acx-surface-raised`, 1px `--acx-border-strong`, `--acx-shadow-2`, Acadrix mark 20px in `--acx-accent`. Hover → border `--acx-accent`; active → `--acx-accent-subtle`. `aria-label="Open Acadrix"`, `aria-expanded` reflects reader state. Never animates idly (no pulse/bounce). Hidden while the reader is open.

### Header (reader)
Height 56, padding-inline `space-4`, bottom 1px `--acx-border`, `--acx-surface`. Left: wordmark (Outfit 600, 16px) or content title (Outfit, truncate with ellipsis). Right: icon buttons, `space-1` gap, ordered: export, theme/settings, close (rightmost). Sticky inside the sheet.

### Export controls
Grouped as one primary-secondary split: a **secondary Button** "Export" with a menu (format options: Markdown, PDF, Copy). Menu = popover, `--acx-surface-raised`, radius-md, `--acx-shadow-2`, items 36px high, mono format hint right-aligned. `role="menu"` / `menuitem`, arrow-key navigation, Esc closes. Progress: button enters loading state; completion announces via `aria-live="polite"` and a success badge for ≤3s. Failure: error badge + retry ghost button.

### Loading / progress / error states
- **Loading (unknown duration):** 16px spinner (1.5px stroke, `currentColor`, 800ms linear). For content regions, use skeleton blocks (`--acx-surface-sunken`, radius-sm, **no shimmer**; static or opacity pulse 1.2s that is removed under reduced motion).
- **Progress (known):** 4px track `--acx-surface-sunken`, fill `--acx-accent`, radius-full; `role="progressbar"` with `aria-valuenow`; percentage in mono beside it.
- **Error:** inline block: 1px `--acx-error` border, `--acx-error-bg` fill, radius-md, icon + one-sentence cause + one recovery action (Retry). Technical detail in a collapsible mono `<details>`. Never raw stack traces by default.
- **Empty:** Outfit h2 headline, one sentence of `--acx-text-muted`, one action.

---

## 7. Content Styling (reader content)

All content lives in a `.acx-content` scope at `--acx-text-body`, `--acx-text` color, `max-width: var(--acx-reader-measure)`.

| Element | Rule |
|---|---|
| Headings | h1/h2 Outfit, h3+ Satoshi 700. Margin-top `space-8`, bottom `space-3`. No underlines/borders. Anchored with `scroll-margin-top: 72px` (header height + gap). |
| Paragraphs | Margin-bottom `space-4`. No justify; `text-wrap: pretty`, `hyphens: manual`. |
| Questions | Question block: prompt in body weight 500, number as mono caption (`--acx-text-muted`) in a fixed 32px hanging column. Block spacing `space-8`. |
| Options | List of 36–44px rows, radius-md, 1px `--acx-border`, gap `space-2`. Letter marker (A, B, …) in mono, 24px square, in a bordered radius-sm box. Hover → `--acx-accent-subtle`. Selected → accent border + accent-subtle + check icon. Correct/incorrect (if shown): success/error border **plus** check/cross icon **plus** visually-hidden text. |
| Math | Render with the existing engine; inherit `--acx-text`. Display equations: centered, block margin `space-4`, `overflow-x: auto` (never wrap, never clip). Inline math must not alter line height (clamp to line-height). |
| Code blocks | Mono 13/20, `--acx-surface-sunken`, 1px `--acx-border`, radius-md, padding `space-4`, `overflow-x: auto`, `tab-size: 2`, no line wrapping, `tabindex="0"` for keyboard scroll. Optional copy icon button top-right. Inline code: mono 0.92em, `--acx-surface-sunken`, radius-sm, padding 1px `space-1`. No syntax-highlight palette beyond: keyword = accent, string = success, comment = text-subtle, number = warning. |
| Tables | Wrapped in a scroll container (`overflow-x: auto`). Full-width, collapsed borders, 1px `--acx-border` horizontal rules only. Header: caption style, `--acx-surface-sunken`, weight 500, sticky when the container scrolls vertically. Cell padding `space-2` × `space-3`. Numeric columns right-aligned with `font-variant-numeric: tabular-nums`. No zebra striping. |
| Images/figures | `max-width: 100%`, `height: auto`, radius-md, 1px `--acx-border`. `<figure>` with `<figcaption>` in `--acx-text-small` / `--acx-text-muted`, margin-top `space-2`. Alt text required; decorative → `alt=""`. On dark theme, never apply filters; images with transparent backgrounds sit on `--acx-surface`. |
| Links | `--acx-accent`, underline always on (offset 2px, thickness 1px); hover → `--acx-accent-hover`, thickness 2px; visited unchanged; external links append a 12px arrow icon. Focus ring per §10. |
| Lists | `space-5` indent, markers `--acx-text-muted`, item gap `space-1`. |
| Blockquote | 2px inline-start border `--acx-border-strong`, padding-inline-start `space-4`, `--acx-text-muted`. |

---

## 8. Interaction & Motion

**States** (applied through shared tokens, §3.2): hover (fine pointers only: wrap in `@media (hover: hover)`), focus-visible, pressed, disabled, selected, loading.

- **Pressed:** color change only (`--acx-accent-active`); no scale transforms.
- **Disabled:** use `disabled`/`aria-disabled`, not just opacity. Disabled elements that need explanation expose it via tooltip or helper text (disabled buttons are otherwise not focusable; prefer `aria-disabled` + explanation where the reason matters).
- **Motion principles:** purposeful, short, spatially consistent. Movement only for layers entering/leaving (reader slide, dialog fade-up, menu fade). State changes are color/opacity only. Exit is faster than enter (`ease-exit`, `duration-base`).
- **`prefers-reduced-motion: reduce`:** set all `--acx-duration-*` to `0.01ms`, remove translate/scale (use opacity-only or instant), stop spinners' rotation in favor of a static "busy" icon + text, and remove skeleton pulse. Implement once at `:host` by redefining the duration tokens, not per component.

---

## 9. Responsive Behavior

Breakpoints (viewport width): **narrow** `< 640px`, **tablet** `640–1023px`, **desktop** `≥ 1024px`. Add no others.

| Property | Narrow | Tablet | Desktop |
|---|---|---|---|
| Reader width | 100vw | `min(720px, 100vw − 32px)`, centered | `min(880px, 100vw − 48px)`, centered |
| Reader height | `88dvh` | `80dvh` | `72dvh` (min 360px, max 90dvh) |
| Reader top radius | `radius-xl` | `radius-xl` | `radius-xl` |
| Reader inline padding | `space-4` | `space-6` | `space-8` |
| Content measure | full width | `68ch` | `68ch` |

- Use `dvh`, with a `vh` fallback declared first.
- Honor `env(safe-area-inset-bottom)` for reader bottom padding and launcher offset.
- **Overflow rules:** the page behind never scrolls via the reader (`overscroll-behavior: contain`). Code, math, and tables scroll horizontally inside their own containers; text wraps (`overflow-wrap: anywhere` on long tokens such as URLs); titles truncate with ellipsis in the header; no horizontal scroll on the reader itself, ever.
- **Touch targets:** under `@media (pointer: coarse)`, all interactive controls have a hit area ≥ **44×44px** (extend with padding or pseudo-element, not by enlarging the glyph); on fine pointers ≥ **32×32px** (WCAG 2.2 AA floor is 24px; Acadrix exceeds it). Adjacent targets are separated by ≥ `space-2`.
- Dialogs on narrow screens: full-width bottom-aligned, `radius-xl` top corners.

---

## 10. Accessibility

- **Contrast:** body and UI text ≥ **4.5:1**; large text (≥ 24px, or ≥ 18.66px bold) and UI component boundaries/icons ≥ **3:1**. Verify every `semantic token × surface` pair in both themes when changing a value. `--acx-text-subtle` must pass 4.5:1 on `--acx-surface`.
- **Focus treatment:** `:focus-visible { outline: var(--acx-border-width-strong) solid var(--acx-focus-ring); outline-offset: 2px; }`. Never `outline: none` without this replacement. Inside clipped/overflow containers use `outline-offset: -2px`. Focus order follows DOM order; no positive `tabindex`.
- **Target sizing:** see §9.
- **Non-color communication:** every status pairs color with an icon and/or text (success ✓, warning ▲, error ✕, info ⓘ). Selected = fill + bar/check. Links = underline. Required fields = text "Required", not only an asterisk color.
- **Accessible behavior:**
  - Reader and dialogs: roles, labels, focus move-in, focus return, Esc to close; trap focus only when modal.
  - Menus: arrow keys, Home/End, type-ahead optional, Esc closes and returns focus.
  - Async status (export done, errors) announced through a single `aria-live="polite"` region (`assertive` only for blocking errors).
  - Icon buttons labelled; images have alt; tables use `<th scope>`; headings are sequential.
  - Respect `prefers-reduced-motion` (§8) and `forced-colors: active` (use `CanvasText`/`Highlight`/`ButtonText` system colors; keep borders on all controls since shadows and fills vanish).
  - Support 200% text zoom without loss of content or function.

---

## 11. Component Rules Checklist (for implementers and review)

1. Does every value resolve to a `--acx-*` token?
2. Does the component consume semantic tokens only?
3. Is it built from existing primitives?
4. Are default / hover / focus-visible / active / disabled (+ loading, error) states defined?
5. Is meaning conveyed without color alone?
6. Does it meet the target size for both pointer types?
7. Does it work in light, dark, `forced-colors`, and reduced-motion?
8. Does it survive the Shadow DOM (fonts registered on the host document, no `rem`, no reliance on host styles)?
9. No gradients, blur, decorative effects, or new dependencies introduced?