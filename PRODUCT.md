# Product

<!-- impeccable:product-schema 1 -->

<!-- Drafted from the maintainer's own knowledge of the app + the project memory, without a live init interview (the user opted for a fast bootstrap so /impeccable live could run). Facts are inferred from the codebase; correct anything that is off. -->

## Platform

web

## Users

A single power-user cyclist (the maintainer) doing structured indoor training. The primary usage scene is on the bike, mid-effort: reading big numbers from the saddle, occasionally tapping a control with a sweaty finger. Secondary scenes are off the bike — browsing the workout library, reviewing a ride log/calendar, and checking training-load charts. Not a multi-tenant or commercial product; it is a personal tool that happens to be built to a high craft bar.

## Product Purpose

A self-contained indoor-cycling training console: pick a structured workout, run it live against a smart trainer (ERG control over Web Bluetooth), and record the ride. It exists to replace a subscription trainer app with something the owner fully controls — local-first, hackable, and free. Success is a session the rider can complete without touching a keyboard: clear targets, honest live readouts, and a saved, reviewable record afterward.

## Positioning

Local-first and dependency-light: the whole app is a single built HTML file with an inline IIFE, no backend required to train. Data lives in the browser (IndexedDB) and syncs opt-in through the owner's own Cloudflare Worker; hosting is a static GitHub Pages deploy. Strava import/export and Web Bluetooth trainer control are wired directly to the owner's own API app registrations. Nothing about the mechanism depends on a vendor's cloud staying alive.

## Operating Context

- **Live workout:** full-screen player driving a smart trainer in ERG mode; an interval chart plus a readout rail (power, cadence, HR, interval/total time, target), an intensity trim, and Skip/Pause/End controls. Read from ~1m away while pedaling.
- **Library:** a large workout catalogue (~500+ structured workouts) with search, star, sort, and zone/duration filters.
- **Ride log & calendar:** month calendar, per-ride detail (route map, zone breakdown, RPE), training-load charts (PMC, power curve). Rides regenerate a .fit and image from stored samples.
- **Hardware:** smart trainer (e.g. KICKR) + HR strap (e.g. TICKR) over Web Bluetooth; auto-reconnect is fiddly on Windows and handled with a re-arm loop.

## Capabilities and Constraints

- Built from `src/` by `build.ps1` into `ftp-plan.html` and `github/index.html`; **the built files are never hand-edited**.
- App code is concatenated `src/app/*.js` (sorted by name) into one shared IIFE scope; `src/shell.html` holds markup, `src/styles.css` the token layer.
- Light theme is the default (fresh users land in light); a dark theme exists via toggle.
- Cross-device sync strips raw sample arrays, so anything needed on another device (e.g. a ride's power-PB curve) must be persisted as a light derived field.
- Everything runs client-side; no server is required to train. Sync/import are optional and route through the owner's own Worker + Strava app.

## Brand Commitments

- **Minimal-monochrome visual world** (established this project, user-approved): warm off-white default + warm dark, hairline rounded cards, flat ink pills for the primary/active thing, mono numerals, soft zone tints, no glows or gradients. Seeded from a habit-tracker reference the user supplied. This is binding; see DESIGN.md.
- Voice is plain, terse, and coach-like ("nice work", "Pace it evenly") — instructional, never marketing.
- No em dashes in UI copy (user preference; regular hyphens only).

## Evidence on Hand

- Real, shipped implementation in `src/` (styles, shell, app modules) is the source of truth.
- Throwaway design comps under `mockups/` (light + dark) captured the agreed visual world.
- Project memory under the Claude project dir records the build workflow, ride log, calendar rework, sync setup, and design-system history.
- No fabricated users, testimonials, or metrics exist and none should be invented.

## Product Principles

1. **Readable from the saddle.** Mid-effort legibility beats density or decoration; the number the rider needs is the biggest thing on screen.
2. **Local-first, owner-controlled.** Prefer client-side + the owner's own infra over any vendor dependency.
3. **Don't punish a sweaty tap.** Destructive or effort-ending controls stay clear of the controls a rider reaches for while pedaling.
4. **One quiet visual world.** Structure through hairlines, ink, and soft tint — never glow or gradient.
5. **Never hand-edit the build.** Source in `src/`, run `build.ps1`.

## Accessibility & Inclusion

Live readouts must hold strong contrast in both themes (status and zone colors are deepened in light so they clear ~4.5:1 on white). Touch targets on the live player are sized for gloved/sweaty use.
