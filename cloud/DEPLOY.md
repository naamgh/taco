# Deploy the cloud-sync Worker (Phase 0) — detailed guide

Goal: put your ride log + planner in the cloud so it syncs across your devices,
using your Strava account as the login. It's free (Cloudflare's free tier), and
takes about 10–15 minutes. You already deployed the Strava-proxy Worker, so the
tools are the same.

Everything below happens in a terminal (PowerShell is fine) inside the `cloud`
folder of this project: `C:\Users\hire\Desktop\ftp\cloud`.

---

## Step 0 — Check you have Node.js (one-time)

Wrangler (Cloudflare's tool) runs on Node.js. Check it's installed:

```bash
node --version
```

- If it prints a version like `v20.x` → you're good, skip to Step 1.
- If it says "not recognized" → install Node.js LTS from https://nodejs.org
  (the big green "LTS" button), accept the defaults, then **close and reopen**
  your terminal and run `node --version` again.

---

## Step 1 — Open the cloud folder in a terminal

Open PowerShell and move into the folder:

```bash
cd C:\Users\hire\Desktop\ftp\cloud
```

You should be able to see the two files that matter here:

```bash
dir
```

Expect to see `sync-worker.js` and `wrangler.toml` (plus this guide).

---

## Step 2 — Connect Wrangler to your Cloudflare account (one-time)

This uses `npx`, which runs Wrangler without a separate install.

```bash
npx wrangler login
```

- The first time, it may ask to install the `wrangler` package — type `y`.
- Your browser opens a Cloudflare "Authorize Wrangler" page → click **Allow**.
- Back in the terminal you'll see `Successfully logged in.`

(If you'd rather install it permanently, `npm install -g wrangler` also works and
then you can drop the `npx` prefix from every command.)

---

## Step 3 — Create the storage (KV namespace)

This is the little database that holds one blob per rider.

```bash
npx wrangler kv namespace create RIDES
```

It prints a block that looks like this (the id will be different):

```
[[kv_namespaces]]
binding = "RIDES"
id = "a1b2c3d4e5f60718293a4b5c6d7e8f90"
```

**Copy the long `id` value** (the part in quotes).

> If that command errors with "unknown argument", your Wrangler is older — use
> the colon form instead: `npx wrangler kv:namespace create RIDES`

---

## Step 4 — Paste the id into wrangler.toml

Open `wrangler.toml` (in this `cloud` folder) in any text editor. Find this line:

```toml
id = "PASTE_KV_ID_HERE"
```

Replace `PASTE_KV_ID_HERE` with the id you copied, so it reads e.g.:

```toml
id = "a1b2c3d4e5f60718293a4b5c6d7e8f90"
```

Save the file.

---

## Step 5 — Deploy

```bash
npx wrangler deploy
```

You'll see it upload and then print your Worker's URL, e.g.:

```
Uploaded ftp-sync (1.2 sec)
Published ftp-sync (0.8 sec)
  https://ftp-sync.YOURNAME.workers.dev
```

**Copy that URL** — that's your cloud endpoint. (The first time, Cloudflare may
ask you to pick a `workers.dev` subdomain — any name is fine; it becomes the
`YOURNAME` part.)

---

## Step 6 — Turn it on in the app (one-time per device)

1. Open the app in your browser: **https://naamgh.github.io** (or the localhost
   preview).
2. Make sure you're **connected to Strava** in the app — that's your login for
   sync.
3. Open the browser DevTools console: press **F12**, click the **Console** tab.
4. Paste this line — swap in **your** Worker URL from Step 5 — and press Enter:

   ```js
   localStorage.setItem('ftpPlan_syncUrl', 'https://ftp-sync.YOURNAME.workers.dev')
   ```

5. **Reload the page.**

From now on, every time you open the **Calendar**, the app pulls your cloud data
and pushes any local changes automatically. Nothing else to click.

---

## Step 7 — Check it's working

1. On this device, open the Calendar and add a planned workout (any day, any
   type). Wait a couple of seconds.
2. Open a **second device** (or a different browser / a private window):
   - open https://naamgh.github.io
   - connect the **same** Strava account
   - run the same `localStorage.setItem('ftpPlan_syncUrl', ...)` line from Step 6
   - reload, open the Calendar.
3. The plan you added on the first device should appear. That's sync working.

---

## Troubleshooting

| What you see | What it means / fix |
|---|---|
| `node` / `npx` "not recognized" | Node.js isn't installed or the terminal wasn't reopened after installing — see Step 0. |
| `wrangler login` browser page doesn't finish | Make sure you're logged into the correct Cloudflare account in that browser, then retry. |
| `unknown argument: namespace` on Step 3 | Older Wrangler — use `npx wrangler kv:namespace create RIDES`. |
| Deploy error: "KV namespace RIDES not bound" later | The `id` in `wrangler.toml` is still `PASTE_KV_ID_HERE` or wrong — redo Steps 3–4 and `npx wrangler deploy` again. |
| Calendar doesn't sync | (a) Are you connected to Strava in the app? (b) Did you reload after setting the URL? (c) Re-check the URL has no trailing slash and no typo. |
| Want to see what's happening | F12 → **Network** tab → open the Calendar → look for a `sync` request. A green `200` means it reached the Worker. A `401` means the Strava token wasn't accepted (reconnect Strava). |

---

## Good to know

- **No secrets** are stored in this Worker — your Strava token proves who you are,
  so there's nothing sensitive to leak.
- Only **light** data syncs (calendar, plans, stats, pies). The heavy per-second
  ride samples stay on the device that recorded them, keeping the cloud tiny.
- Free tier limits (KV: ~100k reads/day, 1k writes/day) are far more than personal
  or small-beta use needs.
- Later I can **bake the URL into the app** so new users never touch the console —
  the manual `localStorage` step is just for getting it running now.
