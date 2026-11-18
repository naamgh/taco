---
name: Indoor Training Console
description: A local-first indoor-cycling training app in a minimal-monochrome world — warm off-white, ink, and soft zone tints.
colors:
  bg: "#F4F3EF"
  bg-elev: "#FFFFFF"
  bg-card: "#FFFFFF"
  bg-card-hover: "#ECEAE3"
  border: "#E7E5DD"
  border-soft: "#EFEDE6"
  ink: "#14140F"
  text-dim: "#4A4A44"
  text-faint: "#6E6B60"
  accent: "#14140F"
  ok: "#1C8579"
  warn: "#8A6410"
  star: "#D99A00"
  line-power: "#E0A400"
  line-cadence: "#55554E"
  line-hr: "#FF453A"
  zone-recovery: "#8A92A8"
  zone-endurance: "#3F79E8"
  zone-tempo: "#1E9E99"
  zone-sweetspot: "#E0A22F"
  zone-threshold: "#E85F2E"
  zone-vo2: "#A65BF0"
  zone-anaerobic: "#E8395A"
typography:
  display:
    fontFamily: "ui-monospace, SF Mono, Cascadia Mono, Roboto Mono, Consolas, monospace"
    fontSize: "clamp(24px, min(6vw, 8.5vh), 72px)"
    fontWeight: 700
    lineHeight: 0.95
    letterSpacing: "-0.01em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Arial, sans-serif"
    fontWeight: 700
    fontSize: "17px"
    lineHeight: 1.2
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Arial, sans-serif"
    fontWeight: 400
    fontSize: "15px"
    lineHeight: 1.45
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Arial, sans-serif"
    fontWeight: 600
    fontSize: "12px"
    letterSpacing: "0.12em"
rounded:
  chip: "12px"
  card: "14px"
  panel: "18px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "9px"
  md: "14px"
  lg: "18px"
  xl: "30px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.bg}"
    rounded: "{rounded.pill}"
    padding: "9px 18px"
  button-secondary:
    backgroundColor: "{colors.bg-elev}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "20px"
  card:
    backgroundColor: "{colors.bg-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "16px"
  readout-cell:
    backgroundColor: "{colors.bg-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
---

# Design System: Indoor Training Console

## Overview

**Creative North Star: "The Instrument Panel"**

The console reads like a well-made analog instrument reskinned for a phone: warm paper-white, one ink color, and monospaced numerals that sit dead still while the data behind them changes. It was seeded from a habit-tracker reference — hairline rounded cards on an off-white field, a single black-filled pill for the one thing that is active or primary — and applied wholesale to a cycling app. Nothing glows. Nothing gradients. Color enters only where it carries meaning: the training zones, and the three live traces (power, heart rate, cadence).

Light is the world; dark is the same structure with inverted surfaces. Both are deliberately warm (off-white `#F4F3EF`, near-black `#14140F` rather than pure `#000`/`#fff`). The design's confidence comes from restraint and from typographic weight, not from ornament: a big mono number anchored to the bottom of a hairline card is the signature move, repeated across the live player, the log, and the charts.

The rider is often mid-effort and a meter away, so hierarchy is literal — the number they need is simply the largest object on screen — and the interface recedes to hairlines and quiet tint around it.

**Key Characteristics:**
- Warm off-white default, warm near-black dark; never pure black or white.
- One flat ink accent — primary/active elements are inverted black pills.
- Monospaced numerals for all live/telemetry figures; sans for labels and prose.
- Hairline (1px) borders and soft radii do the structural work; no shadows at rest.
- Color is meaning-only: 7 training zones + 3 chart traces. Everything else is grayscale.

## Colors

A near-grayscale system on warm paper, with a small, disciplined set of meaning-colors.

### Primary
- **Ink** (`#14140F`): the single accent. Text, hairlines-at-strength, and — as a fill — every primary or active control (Start, Done, the selected layout option). Its scarcity as a *fill* is what makes it read as "the one thing."

### Neutral
- **Warm Paper** (`#F4F3EF`): the page field.
- **Card White** (`#FFFFFF`): cards, elevated surfaces, readout cells.
- **Card Hover** (`#ECEAE3`): the only rest-state surface shift.
- **Hairline** (`#E7E5DD`) / **Soft hairline** (`#EFEDE6`): borders and dividers.
- **Dim** (`#4A4A44`) / **Faint** (`#6E6B60`): secondary and tertiary text; uppercase labels.

### Tertiary — Zones (meaning-only)
Recovery `#8A92A8`, Endurance `#3F79E8`, Tempo `#1E9E99`, Sweet Spot `#E0A22F`, Threshold `#E85F2E`, VO2 `#A65BF0`, Anaerobic `#E8395A`. Each also has a **soft tint** (`--zt-*`) used to fill interval blocks and zone chips; the saturated value then reads as a dot or edge on top of the tint.

### Tertiary — Live traces
Power `#E0A400` (gold), Cadence `#55554E` (dark grey), Heart rate `#FF453A` (red). Solid lines, drawn over the chart's paper field.

### Named Rules
**The Ink-Fill Rule.** Ink is everywhere as text and hairlines, but a *filled* ink surface is reserved for the single primary or active control in a view. If two things are filled ink, one of them is wrong.

**The Meaning-Color Rule.** Saturated color appears only for a training zone or a live trace. A control, a card, or a piece of chrome never borrows a zone hue for decoration.

## Typography

**Display / Numerals:** system monospace (`ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Consolas`).
**Body / Labels:** system sans (`-apple-system, "Segoe UI", "Helvetica Neue", Arial`).

**Character:** engineered and quiet. Mono carries every number that changes or is measured (watts, cadence, times, dates, counts) so figures line up and hold still; sans carries names, labels, and prose. The pairing signals "instrument, not marketing."

### Hierarchy
- **Display** (mono, 700, `clamp(24px, min(6vw,8.5vh), 72px)`, lh 0.95): the hero live readout — interval time, cadence — anchored to the bottom of its card.
- **Title** (sans, 700, 17px): modal and panel headings, workout name.
- **Body** (sans, 400, 15px, lh 1.45): coaching cues, descriptions, controls.
- **Label** (sans, 600, 12px, `letter-spacing 0.12em`, UPPERCASE): every readout-cell title and section eyebrow.
- **Sub** (mono, 12px, faint): in-cell subtitles (e.g. the "1 of 11" segment counter under a readout title).

### Named Rules
**The Bottom-Anchor Rule.** In a readout cell the big number sits at the *bottom* (`margin-top:auto`); the uppercase label and any subtitle stack at the top. Every figure in a row baseline-aligns, whatever else the cell carries.

**The Mono-for-Data Rule.** If it is a measured or changing number, it is mono. If it is a word, it is sans. No exceptions in telemetry.

## Layout

A responsive single-column app shell with content in hairline cards. The live player is a full-screen modal that reflows by CSS `order` (the DOM stays put so the start-countdown number-fly-in animation can run): chart hero → next/intensity row → readout rail → controls. The readout rail is a 12-column grid where a preset promotes two cells to `span 6` heroes and demotes the rest to `span 3`; per-cell order is driven by a `--cell-order` CSS variable so presets can reorder without touching the DOM.

Spacing rhythm runs on a loose ~4px base with common steps at 6 / 9 / 14 / 18 / 30px. Cards breathe (16–30px internal padding); the live player is deliberately airy.

**Responsive:** the breakpoint is **640px**. On phones the live player goes full-bleed (`100dvh`, no radius/border/shadow, `env(safe-area-inset-bottom)` padding), the readout rail collapses to a fixed **even 2-per-row grid** regardless of the desktop preset, and the desktop-only layout picker (its cog) is hidden. The main page has its own `≤900px` IA (detail becomes a tap-opened slide-over; filters pin in a sticky list header).

## Elevation & Depth

**Flat by default.** Surfaces are flat at rest — depth is carried by the hairline border and the warm surface step (paper → card white), not by shadow. Glows and gradients are explicitly zeroed (`--glow-bg: transparent`). The only shadows in the system are functional: a soft drop under a true overlay (the settings panel's `.ls-card`, the mobile detail slide-over) to lift it off the scrim.

### Named Rules
**The No-Glow Rule.** No box glows, no colored halos, no gradient fills on chrome. Structure comes from hairlines and the surface step. (The one sanctioned "glow" is the reduced-motion-aware *lure* that points a rider toward an available filter segment.)

## Shapes

Softly rounded rectangles throughout: chips/steppers ~12px, cards ~14px, overlay panels ~18px, and full pills (`999px`) for primary buttons and range chips. Borders are 1px hairlines in `--border`. Interval-profile blocks and zone chips use a soft `color-mix` tint fill with a stronger same-hue top edge — the recurring "quiet block with a lit edge" silhouette.

## Components

### Buttons
- **Shape:** pill (`999px`) for primary/range, rounded rect (`14px`) for large controls.
- **Primary:** flat **ink** fill, paper text (`background: var(--accent); color: var(--bg)`). Used once per view.
- **Secondary / control:** `bg-elev` surface, hairline border, ink text (Skip and Pause are identical — no special fill on Pause).
- **Hover:** `filter: brightness(1.08)` or a surface step to `--bg-card-hover`; no lift.

### Chips (readout cells & zone tags)
- **Readout cell:** white card, hairline border, uppercase label top-left, big mono number bottom-left (`margin-top:auto`). A **hero** cell doubles its column span and scales the numeral up.
- **Zone tag:** soft `--zt-*` tint + a saturated `--c-*` dot; never a solid saturated fill.

### Cards / Containers
- **Corner:** 14px. **Background:** card white on paper. **Border:** 1px `--border`. **Shadow:** none at rest (see Elevation). **Padding:** 15–22px.

### Inputs / Fields
- Hairline-bordered, `bg-card`, rounded. Filter sliders and search live in a sticky list header on the main page.

### Signature Component — Live readout rail
A 12-col grid of white readout cells above a canvas interval chart. Presets ("Interval + Cadence", "Heart Rate + Cadence", "Interval + Heart Rate", "Even grid") pick which two cells are heroes and the left-to-right order, via `--cell-order` + a `.hero` class. A compact intensity stepper (`− ⚡ 100% +`, ±1%) rides on the "Next:" line, clear of Skip/Pause. Chosen through a cog-opened `.live-settings` overlay; desktop-only.

## Do's and Don'ts

### Do:
- **Do** keep the biggest object on screen the number the rider needs mid-effort.
- **Do** use mono for every measured/changing figure and sans for words.
- **Do** anchor the big number to the bottom of its cell so a row baseline-aligns.
- **Do** reserve a filled ink surface for the one primary/active control in a view.
- **Do** convey depth with hairlines and the paper→white surface step.
- **Do** keep effort-ending controls (End/Skip/Pause) clear of controls a rider reaches for while pedaling.

### Don't:
- **Don't** add glows, colored halos, or gradient fills to chrome.
- **Don't** borrow a zone or trace hue for decoration; saturated color means zone or trace.
- **Don't** use pure `#000` / `#FFF`; the world is warm off-white and warm near-black.
- **Don't** hand-edit `ftp-plan.html` / `github/index.html`; edit `src/` and run `build.ps1`.
- **Don't** write em dashes in UI copy; use regular hyphens.
