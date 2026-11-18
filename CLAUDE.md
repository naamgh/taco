# Indoor Training Console — notes for Claude

Local-first indoor cycling app: smart-trainer control (Web Bluetooth ERG), a
structured workout library, a ride-log calendar, Strava import/upload, .fit
export, and a Fitness section (Fitness/Fatigue/Form, coach, FTP check, power
records). Hosted on GitHub Pages at naamgh.github.io.

## Build — never edit the outputs
- Source: `src/head.html`, `src/styles.css`, `src/theme-boot.js`, `src/shell.html`,
  `src/library.json` (embedded workout library), `src/app/*.js`.
- `src/app/*.js` are concatenated in name order into ONE IIFE, so functions
  hoist across files. Modules: 01-core, 02-filtering (list, Quick Pick, mobile
  tabs), 03-guided-start, 04-bluetooth, 05-strava, 06-live-player, 07-download,
  08-fit-export, 08b-ride-log (calendar), 08d-trends (Fitness modal + charts),
  08e-cloud-sync, 08f-coach (Today / Next 4 weeks / FTP check), 08g-beta-charts,
  09-boot, 10-desktop-nav, 11-log-mode.
- Build: `powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1`
  (`-Check` dry-runs). It's plain concatenation, so it can be ported to Node if
  PowerShell isn't available. Outputs (git-ignored):
  - `ftp-plan.html` + `github/index.html` — the full app
  - `ftp-log.html` + `github/log.html` — the Training Log page: the same bundle
    with `<html data-mode="log" data-app-url=…>`, opening straight into Calendar +
    Fitness; it hands workout links to the full app via `#workout=<key>` and
    `#browse=zone,spice,duration`.
- Deploy: upload `github/index.html` and `github/log.html` (plus anything else
  changed in `github/`) to the GitHub Pages repo.
- Source files mix CRLF and LF; keep each file's existing line endings.

## Services
- Strava OAuth via Cloudflare Worker `strava-proxy.nomtron.workers.dev` (source
  `github/cloudflare-worker.js`; Strava app id 248261; the client secret lives
  only in the Worker — never put secrets or tokens in this repo).
- Ride-log cloud sync: Worker `ftp-sync.nomtron.workers.dev`, KV `RIDES`
  (source in `cloud/`). Runs only when Strava is connected, and strips heavy
  per-ride fields (samples/streams/laps) — so light summaries (`pbCurve`,
  `effort`, `outBest`) are stored on each ride so they sync.

## Design
DM Mono "typographic index" look: light theme by default (warm off-white) plus
dark; hairline rules, no boxed cards on desktop, uppercase letter-spaced
labels, greys + zone colours. Tokens live in `src/styles.css` (`--text-strong`,
`--text`, `--text-dim`, `--text-faint`, `--border`, `--border-soft`, `--ok`,
`--warn`, `--c-<zone>`, `--display`). Desktop = `@media(min-width:901px)`;
phone layout ≤900px. See DESIGN.md / PRODUCT.md; mockups in `mockups/`.

## Working with me
- Visual changes: mock first (standalone HTML in `mockups/` with Desktop/Phone
  and Light/Dark toggles); I choose, then build.
- "Discuss first" / "no changes" means don't edit anything.
- Plain English, short. After a build, say exactly which files to upload.
- Test with synthetic rides seeded into a local preview's IndexedDB
  (`ftpPlanRides` / `rides`), never real data; check Strava isn't connected
  before seeding, and delete the test data afterwards. Local preview:
  `.claude/launch.json` → serve.ps1 on port 8777.
- No "beat last week" comparisons — load is shown against healthy targets or
  ceilings, never as a competition.
