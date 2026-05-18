# UI Design System Context

This document defines the visual system for future UI work in this project. Use it as the default reference for new screens, refinements, and component updates so the product evolves with a consistent look and feel.

## Reference Intent

The reference image suggests a soft, premium, mobile-first product aesthetic with:

- Rounded white device-like cards floating on a warm neutral background.
- Minimal, calm surfaces with strong separation through shadow rather than borders.
- Sparse but intentional use of a vivid purple accent for primary actions and active states.
- Soft gray typography with black used only for high-emphasis headings.
- Generous spacing, large corner radii, and a “friendly utility app” tone.

This app should adapt that language for a map-based waste-bin product rather than copying the original literally.

## Product Personality

The UI should feel:

- Clean
- Reassuring
- Light
- Mobile-native
- Polished without becoming corporate

The app is a civic utility, so it should feel trustworthy and easy rather than flashy.

## Core Visual Principles

1. Use soft contrast.
   Backgrounds should lean warm off-white or mist gray, not pure white-on-white or dark themes.

2. Prefer rounded geometry.
   Cards, controls, sheets, and buttons should use visibly rounded corners.

3. Reserve saturated color for action.
   Purple should signal primary actions, active navigation, and important confirmation points.

4. Let elevation do the work.
   Use subtle layered shadows and translucent surfaces instead of heavy outlines.

5. Design mobile-first even on desktop.
   Desktop layouts should still feel like expanded mobile surfaces rather than enterprise dashboards.

## Color System

### Base Neutrals

- `canvas`: `#f4f1ee`
- `canvas-warm`: `#efe9e4`
- `surface`: `rgba(255, 255, 255, 0.88)`
- `surface-strong`: `#ffffff`
- `surface-muted`: `#f6f3f0`
- `line-soft`: `rgba(65, 45, 90, 0.08)`
- `text-strong`: `#19161f`
- `text`: `#4f475d`
- `text-muted`: `#8a8198`

### Accent Colors

- `primary`: `#6f35f5`
- `primary-strong`: `#5926db`
- `primary-soft`: `#efe7ff`
- `primary-glow`: `rgba(111, 53, 245, 0.24)`

### Semantic Utility

- `success`: `#1f9d66`
- `warning`: `#d1a031`
- `danger`: `#cf4d5d`
- `info`: `#2f7cf6`

### Map-Specific Meaning

- Public bins remain green.
- Private bins remain yellow.
- User location remains blue.

Do not replace these functional map colors with the purple brand accent.

## Typography

Use a clean modern sans-serif stack with a softer tone than default system UI.

Recommended stack:

```css
font-family: "Inter", "Segoe UI", sans-serif;
```

Type roles:

- Display heading: bold, tight line-height, high contrast
- Section heading: semibold, calm, compact
- Body text: medium contrast, comfortable line-height
- Helper text: muted, smaller, never fully gray-on-gray
- Button text: semibold

## Radius System

- Small inputs: `14px`
- Standard controls: `16px`
- Card surfaces: `24px`
- Large hero/map panels: `28px` to `32px`
- Full pills: `999px`

Rounded corners are part of the brand. Avoid sharp corners unless required by a native library.

## Elevation System

Preferred shadow style:

- Soft
- Wide blur
- Low opacity
- Slight vertical offset

Examples:

- Card: `0 18px 50px rgba(38, 25, 62, 0.08)`
- Floating control: `0 10px 24px rgba(38, 25, 62, 0.14)`
- Modal/sheet: `0 28px 70px rgba(25, 16, 40, 0.2)`

Avoid harsh black shadows.

## Spacing System

Use airy spacing. Default to:

- `8px`
- `12px`
- `16px`
- `20px`
- `24px`
- `32px`

If a layout feels cramped, increase space before adding decoration.

## Component Guidelines

### App Shell

- Use a soft atmospheric background with blurred color blooms.
- Keep the main content inside one or two large floating surfaces.
- On desktop, center the experience with generous side margins.

### Cards

- White or translucent white
- Large radii
- Very light border or none
- Soft shadow

### Buttons

- Primary buttons use a purple gradient or purple solid fill.
- Secondary buttons use soft neutral fills.
- Floating map controls should look tactile and compact.
- Button labels should be short and direct.

### Forms

- Inputs should sit on white surfaces.
- Use soft borders and clear focus rings.
- Labels should be concise and always visible.

### Modal / Sheet Patterns

- Feedback, setup, and detail flows should appear as floating cards or bottom sheets.
- Use blurred or dimmed backdrops sparingly.
- Keep modal width compact and mobile-friendly.

### Status Pills

- Light tint backgrounds
- Rounded pill shape
- Compact text

### Map Overlays

- Controls should float above the map, not compete with the base map tiles.
- Bottom-center and bottom-right overlays should feel like native map controls.
- Overlay hierarchy:
  - Primary map content
  - Floating controls
  - Modals/sheets

## Motion

Motion should be subtle and purposeful:

- Hover lift: `translateY(-1px)` or `-2px`
- Modal entrance: short fade and upward slide
- Button transitions: `160ms` to `220ms`

Avoid bouncy or overly playful animation.

## Content Tone in UI

Text should be:

- Human
- Short
- Calm
- Slightly playful when appropriate

Avoid cluttered helper text and overly technical labels in the primary UI.

## Implementation Rules For Future Updates

1. Start with design tokens first.
2. Reuse the same purple primary accent across new actions.
3. Keep all new surfaces rounded and elevated consistently.
4. Favor mobile-sheet patterns over dense dashboard panels.
5. Preserve semantic map colors for bin meaning and location.
6. Add new UI in a way that still feels coherent on small screens.

## Anti-Patterns

Avoid:

- Flat admin-dashboard layouts
- Harsh green-on-white as the primary brand language
- Tiny squared buttons
- Heavy borders everywhere
- Dense blocks of text
- Multiple competing accent colors
- Dark mode styling unless explicitly requested

## Current Translation For This Project

The design system should currently express itself through:

- A soft off-white app canvas
- A rounded white hero panel
- A large elevated map surface
- Purple primary buttons and active accents
- Floating map utilities
- Minimal, readable forms and modal feedback flows

Use this file as the source of truth for future UI iterations.
