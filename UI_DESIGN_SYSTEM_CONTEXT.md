# UI Design System Context

This document defines the visual system for future UI work in this project. Use it as the default reference for new screens, refinements, and component updates so the product evolves with a consistent look and feel.

## Reference Intent

A calm, map-first utility in the style of modern ride and maps apps:

- The map is the product. It fills the screen and everything else floats over it.
- White cards and sheets with soft shadows, on top of a full-colour map.
- Black for primary actions, light grey for secondary ones. Colour is reserved for meaning on the map.
- Large, plain type; few words; generous touch targets.

## Product Personality

The UI should feel:

- Clean
- Reassuring
- Quick
- Mobile-native
- Polished without becoming corporate

The app is a civic utility, so it should feel trustworthy and easy rather than flashy.

## Core Visual Principles

1. Map first.
   Nothing sits above or beside the map in the page flow. Controls, messages and forms float over it.

2. Black and white chrome, colour on the map.
   Buttons, text and surfaces are black, grey and white. Green, yellow and blue only mean something on the map.

3. Rounded geometry.
   Cards, sheets, controls and buttons use visibly rounded corners.

4. Let elevation do the work.
   Use soft shadows rather than borders to lift floating UI off the map.

5. Design for the phone first.
   Wide screens get the same pieces, arranged in a side panel.

## Layout

- **Map:** fills the window (`.map-app__map`). The page itself never scrolls.
- **Top bar:** app name, current area, and icon buttons for install and feedback. Phone: floats across the top. Wide screens: the top card of the left panel.
- **Sheet:** one place for whatever is in focus, most important first: the add/edit form, then a selected bin's details, then the nearest bin after "Find nearest bin", and otherwise a short welcome with the "Find nearest bin" button. Phone: along the bottom edge. Wide screens (900px and up): under the top bar in a 380px panel on the left.
- **Notices:** errors, confirmations and status chips. Phone: under the top bar. Wide screens: between the top bar and the sheet.
- **Map buttons:** "Add bin" (black) and locate (white, round) in the bottom-right corner, sitting just above the sheet on phones. Zoom buttons top-right on wide screens only; phones pinch.
- **Map key:** a small chip in the bottom-left corner, beside the map buttons on phones.
- **Dialogs** (feedback): a card over a dimmed backdrop, at the bottom on phones and centred on wide screens.
- When a pin or selected bin would be hidden behind the sheet or panel, the map pans to show it.

## Color System

### Neutrals

- `ink`: `#111111` (primary buttons, headings, icons, focus ring)
- `ink-hover`: `#2c2c30`
- `text`: `#3f3f46`
- `text-muted`: `#67676f` (at least 4.5:1 on white and on `surface-muted`)
- `surface`: `#ffffff`
- `surface-muted`: `#f2f2f3` (secondary buttons, segmented controls)
- `surface-muted-hover`: `#e6e6e8`
- `line`: `#e4e4e7` (input borders, dividers)

### Semantic

- `danger`: `#b42318` on `danger-soft` `#fef3f2`
- `success`: `#067647` on `success-soft` `#ecfdf3`

### Map-Specific Meaning

- Public bins: green `#1d8554` (badge text `#17663f` on `#e8f5ee`).
- Private bins: yellow `#f2b705` with a `#a77a0c` ring for contrast (badge text `#7a5500` on `#fdf3d3`).
- Your location: blue `#2f7cf6`.

Keep the map tiles in full colour. Do not use these map colours for buttons or other UI.

## Typography

Inter, bundled with the app through `@fontsource-variable/inter`:

```css
font-family: "Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
```

- Sheet titles: 20px, semibold, slightly tight letter-spacing.
- Body: 15px. Helper text: 13–14px in `text-muted`.
- Buttons: 15px semibold.
- Form fields: 16px, which stops iPhone Safari zooming in on focus.
- Numbers that change (distances, coordinates): tabular figures.
- Sentence case everywhere. No uppercase labels.

## Radius System

- Buttons and inputs: `12px`
- Cards, sheets, dialogs: `20px`
- Chips, round buttons: `999px`

## Elevation System

- Floating control (map buttons, top bar on phones, chips): `0 1px 2px rgba(0,0,0,0.06), 0 6px 16px rgba(0,0,0,0.12)`
- Card or panel: `0 1px 2px rgba(0,0,0,0.06), 0 12px 32px rgba(0,0,0,0.14)`
- Bottom sheet: `0 -4px 24px rgba(0,0,0,0.12)`

## Spacing System

Use `8px`, `12px`, `16px`, `20px` and `24px`. Floating UI keeps 12px from the screen edge on phones and 16px on wide screens, inside the safe-area insets.

## Component Guidelines

### Buttons

- **Primary:** black fill, white text, 48px tall. One per view.
- **Secondary:** `surface-muted` fill, black text.
- **Danger:** red fill, white text, only to confirm a delete. The first tap on delete is a grey icon button with a red icon.
- **Icon buttons:** 44px (top bar), 48px tiles beside a primary button (Edit, Delete), 36px round grey for close.
- Press feedback: scale to 0.98. Disabled: 50% opacity.
- Every icon-only button has an `aria-label`.

### Icons

One line-icon set (`src/components/icons.jsx`): 24px grid, 2px stroke, round caps. Never emoji.

### Forms

- Labels are always visible, 14px semibold.
- Inputs: white, 1px `line` border, black border on focus.
- Two-option choices (bin type) use a segmented control, not a drop-down.
- Cancel and Save sit side by side at the bottom.

### Focus

- `:focus-visible` shows a 2px solid `ink` outline with a 2px gap.
- Headings that receive focus from code (to guide screen readers) show no ring.
- Opening a bin moves focus to its details; closing returns focus to its marker.

### Map markers

- Round, 30px, white 2px border, drawn bin icon. Selected: 40px with a black ring. Draft (not saved yet): dashed black outline.
- Markers are keyboard buttons: Enter or Space opens them.

### Status

- Loading or saving: a black pill with a small spinner.
- Errors and confirmations: a white card tinted red or green, with a close button. Confirmations hide after 4 seconds.

## Motion

- Buttons: 120–160ms.
- Sheet content: 180ms fade when it changes.
- Dialog: short fade and upward slide.
- All motion is cut to near zero when the user prefers reduced motion.

## Content Tone in UI

Human, short and calm. Use sentence case and plain words ("Add bin", "Find nearest bin", "Keep it").

## Anti-Patterns

Avoid:

- Anything that pushes the map down or makes the page scroll
- Gradients and glowing shadows on buttons
- Uppercase labels and badges
- Colour on buttons or chrome (keep colour for the map)
- Native `alert()` / `confirm()` boxes
- Dark mode styling unless explicitly requested

## Implementation Rules For Future Updates

1. Start with the tokens in `src/index.css`.
2. Add new views as sheet content, not as new floating cards.
3. Keep floating UI inside the safe area and clear of the map attribution.
4. Check every new text colour pair reaches 4.5:1.
5. Check new layouts at 320px, 390px and desktop widths.

Use this file as the source of truth for future UI iterations.
