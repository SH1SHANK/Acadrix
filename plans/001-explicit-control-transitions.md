# 001 — Replace broad control transitions with explicit properties

- **Status**: TODO
- **Commit**: f55432a
- **Severity**: MEDIUM
- **Category**: Performance and cohesion
- **Estimated scope**: 1 source file, 4 selectors

## Problem

Four frequently used control styles transition every CSS property. This makes future layout or paint properties animate unintentionally and obscures the intended state feedback. The current design uses color, background, border, and shadow changes; those should be the only transitioned properties.

`src/ui/styles.css:819`:

```css
.saq-qrail-pill {
  transition: all var(--acx-duration-fast) var(--acx-ease-standard);
}
```

`src/ui/styles.css:903`:

```css
.saq-rail-btn {
  transition: all var(--acx-duration-fast) var(--acx-ease-standard);
}
```

`src/ui/styles.css:939`:

```css
.saq-qselect-cb {
  transition: all var(--acx-duration-fast) var(--acx-ease-standard);
}
```

`src/ui/styles.css:3049`:

```css
.saq-diff-tab {
  transition: all var(--acx-duration-fast) var(--acx-ease-standard);
}
```

## Target

Keep the existing 120ms duration and standard easing token. Replace `all` with only the properties each control changes:

```css
.saq-qrail-pill {
  transition:
    color var(--acx-duration-fast) var(--acx-ease-standard),
    background-color var(--acx-duration-fast) var(--acx-ease-standard),
    border-color var(--acx-duration-fast) var(--acx-ease-standard),
    box-shadow var(--acx-duration-fast) var(--acx-ease-standard);
}

.saq-rail-btn {
  transition:
    color var(--acx-duration-fast) var(--acx-ease-standard),
    background-color var(--acx-duration-fast) var(--acx-ease-standard);
}

.saq-qselect-cb {
  transition:
    color var(--acx-duration-fast) var(--acx-ease-standard),
    background-color var(--acx-duration-fast) var(--acx-ease-standard),
    border-color var(--acx-duration-fast) var(--acx-ease-standard);
}

.saq-diff-tab {
  transition:
    color var(--acx-duration-fast) var(--acx-ease-standard),
    background-color var(--acx-duration-fast) var(--acx-ease-standard),
    box-shadow var(--acx-duration-fast) var(--acx-ease-standard);
}
```

Do not add transforms or new easing/duration tokens. If inspection shows another property is currently changed by one of these controls, add only that property to its transition list.

## Repo conventions to follow

- Motion tokens are defined in `src/ui/styles.css` under `:host, :root`: `--acx-duration-fast: 120ms` and `--acx-ease-standard: cubic-bezier(0.2, 0, 0, 1)`.
- `src/ui/styles.css:528` (`.saq-btn`) already uses explicit transitions for color, background color, border color, box shadow, and opacity. Follow that property-specific pattern.
- `bookmarklet/styles.css` and the extension bundle are generated from `src/ui/styles.css`; do not edit generated output directly.

## Steps

1. In `src/ui/styles.css`, replace `transition: all` on `.saq-qrail-pill`, `.saq-rail-btn`, `.saq-qselect-cb`, and `.saq-diff-tab` with the property lists above.
2. Check the hover, focus, active, selected, and attempted-state rules for those selectors. Add a property only if one of those rules currently changes it and the property is not listed.
3. Regenerate the extension and bookmarklet outputs with `npm run build` once after the source edit.

## Boundaries

- Do not change markup, selector behavior, colors, spacing, or interaction semantics.
- Do not add animation, transforms, dependencies, or new tokens.
- Do not edit `bookmarklet/styles.css`, `extension/run.js`, or other generated bundles by hand.
- If the selectors or token names no longer match the cited code, stop and report the drift instead of improvising.

## Verification

- **Mechanical**: run `npm run check`; expect generated JavaScript syntax validation to pass. Run the existing targeted UI/browser verification available in the repository if the stylesheet change alters visible behavior.
- **Feel check**: compare hover, focus, selected, and attempted states for each selector. They should retain the same short color/border feedback, with no movement or size change. In DevTools, inspect computed transitions and confirm no selector lists `all`.
- Toggle `prefers-reduced-motion: reduce`; controls should remain visually understandable without noticeable motion.
- **Done when**: all four selectors transition only their current state-feedback properties, existing states look unchanged, and generated outputs match the source.
