# Indoor Training Console

A single-page indoor cycling app: a library of 500+ structured workouts, ERG control of a
smart trainer over Web Bluetooth, live power / heart rate / cadence, auto-pause, ramp and
20-minute FTP tests, and `.fit` + summary-image export for Strava.

Everything runs in the browser. There is no backend and nothing is uploaded: your FTP,
favourites and remembered devices stay in the browser's storage on your machine, and
exports download to your computer.

## Files

| File | Purpose |
|---|---|
| `index.html` | The app, with the workout library embedded |
| `manifest.webmanifest`, `sw.js`, `icon*.png`, `icon.svg` | Make it installable and give it an offline fallback |
| `library-gen.js`, `library-builder.html` | Regenerate the workout library (optional) |
| `start-online.bat` | Windows launcher that enables one-click device reconnect (see below) |

## Publishing on GitHub Pages

1. Create a repository (public — Pages on a private repo needs a paid plan).
2. Upload every file in this folder to the repository root.
3. In the repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   branch `main`, folder `/ (root)`. Save.
4. After a minute or two the site is live at `https://<username>.github.io/<repo>/`.

To update the app later, upload the new `index.html` over the old one. Browsers pick it up
on the next open (the service worker is network-first, so a fresh copy always wins when
you're online).

## Using it

Open the URL in **Chrome or Edge** — Web Bluetooth isn't available in Firefox or Safari.
Chrome on Android works too; iPhone needs a third-party browser such as Bluefy.

Connect the trainer (and optionally a heart-rate strap), set your FTP, pick a workout and
press **Start Workout**. The Guide button at the bottom of the filter panel has the short
version of everything, including keyboard shortcuts.

**Install as an app:** in Chrome, the install icon in the address bar (or menu → *Install
Indoor Training Console*) gives you a frameless window and an icon in the Start menu.

### One-click reconnect (Windows)

Reconnecting to the same trainer and strap without the Bluetooth picker relies on two
Chrome features that are still behind flags. `start-online.bat` launches Chrome with the
switches that enable them, using its own profile folder so it works even if Chrome is
already open:

1. Edit `start-online.bat` and replace the placeholder URL with your Pages address.
2. Double-click it. The first connect goes through the picker; every launch after that
   shows **Reconnect trainer & HR**.

Without it, the app still works normally — you just pick the devices from the list each time.

## Uploading straight to Strava

Press **Connect** on the Strava row, approve on Strava's consent page, and you're back in the
app with your name on the row. After a ride, **Upload to Strava** on the summary sends the .fit
and links to the new activity. Tokens are kept in that browser's storage only. The summary image
still has to be attached by hand; Strava's API doesn't accept photos.

How it works: the app is registered with Strava once (the owner's API application). Its secret
lives in a small Cloudflare Worker (`cloudflare-worker.js` in this repo) that performs the
token exchange; the browser talks to Strava directly for everything else. Strava caps a new
application at 10 connected athletes until you request an increase from developers.strava.com.

Anyone who would rather not go through the shared application can use their own: *Use your own
Strava API app instead…* under the Connect button takes a Client ID and Secret, kept in that
browser and used directly.

To run your own copy of the Worker: create a Worker on Cloudflare, paste `cloudflare-worker.js`,
add `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` (secret) and `ALLOWED_ORIGIN` (your Pages
origin) under Settings → Variables, then set `STRAVA_APP_ID` and `STRAVA_PROXY` near the top
of the Strava section in `index.html`.

## Regenerating the library

Open `library-builder.html` from the hosted site (or locally through a server), press
**Generate library**, review, then **Download index.html** and upload that over the
existing one.
