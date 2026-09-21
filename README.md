# Bot Crossing — Offline Demo

A public, **offline demo** of a 3D agent colony: every astronaut is a coding-agent session,
walking out of the ship, claiming a plot for its repo, and building. It runs entirely in the
browser with **fabricated data** — no machine scan, no backend, no access to anyone's files.

> This is a showcase. The bots are made up, and **access is locked**: click a bot and press
> **Open** and it will politely tell you it can't unlock the models for you.

Built on the open-source **[Bot Crossing](https://github.com/jarrenrocks/bot-crossing)** by
Jarren Rocks (MIT). See [`NOTICE.md`](./NOTICE.md) for what was changed.

## Live demo

Deployed to GitHub Pages on every push to `main` (see `.github/workflows/deploy.yml`):

**https://FrantisekFloch.github.io/bot-crossing-offline/**

## What it shows

A lively colony of nine bots across four tools (Kiro, Claude Code, Cursor, Codex):

- **4 bots need attention** — 1 with a red **!** (errored) and 3 with blue **?** (waiting on you)
- Plus 2 working (hammer), 1 shipped (✓), and 2 idle

Click a zone (its deck or its name) for the repo; fly around like Google Earth — drag the
ground, right-drag to tilt, scroll to zoom. Press **?** for the in-app help.

## Run it locally

```bash
npm install
npm run dev      # http://localhost:5274/
```

Needs Node 22.13+. `npm run dev` also serves a tiny `/api/state` (colony layout persistence)
for local use; the deployed static build simply skips it and the colony still renders.

## Build the static site

```bash
BASE_PATH=/bot-crossing-offline/ npm run build   # outputs to dist/
```

(Locally, `npm run build` with no `BASE_PATH` builds for the site root.)

## How the offline mode works

| File | Change |
| --- | --- |
| `src/game/offline-data.js` | The fabricated demo bots (new module). |
| `src/game/api.js` | `fetchThreads()` returns the fabricated data instead of scanning. |
| `src/main.js` | Clicking **Open** shows the "access locked" message. |
| `src/ui/hud.js` · `src/ui/styles.css` | The locked-message modal + offline help text. |

Everything else — the 3D colony, badges, zones, layout, navigation — is the original
Bot Crossing, running unchanged and fully client-side.

## License

MIT. The original Bot Crossing copyright is retained in [`LICENSE`](./LICENSE) alongside the
fork's. Credit to Jarren Rocks for the original project.

## Project status — PARKED

Feature-complete and pushed to GitHub. **One manual step remains to make the live demo public:**

1. **Enable GitHub Pages** — repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
   (Until this is set, the deploy workflow's build succeeds but the final "Deploy to GitHub Pages"
   step fails, and the live URL 404s.)
2. Then **Actions** tab → re-run the latest **"Deploy demo to GitHub Pages"** run (or push any commit).
3. The site goes live at **https://FrantisekFloch.github.io/bot-crossing-offline/** (first publish
   can take 1–2 minutes to propagate).

### What's done

- Offline fork rendering **16 fabricated bots** across 4 tools (Kiro, Claude Code, Cursor, Codex):
  4 need attention (1 red **!**, 3 blue **?**), 2 working, 1 shipped ✓, 9 idle (7 are static filler
  to fill the screen). Data lives in `src/game/offline-data.js`.
- Clicking **Open** on any bot shows the "access locked / not František" modal
  (`hud.lockedMessage()`, wired from `actions.openThread` in `src/main.js`).
- **Mobile:** on-screen **+ / −** zoom buttons (`.zoom-controls`) + iOS pinch hardening in
  `src/core/camera.js` (`zoomBy`, `touchmove`/`gesturestart` preventDefault).
- **Sidebar collapse:** `»` button in the panel header + floating **"Panel"** button + **B** key
  (`hud.collapseSide()`), so the repos panel can be hidden to see the colony.
- Attribution: original MIT `LICENSE` retained + fork copyright, `NOTICE.md`, updated `package.json`.
- GitHub Actions Pages workflow (`.github/workflows/deploy.yml`) builds with
  `BASE_PATH=/bot-crossing-offline/`.

### Local dev note

`node_modules` in the working copy is a **directory junction** to `../bot-crossing/node_modules`
(saved space on the dev machine). If the folder is moved or the original is deleted, just run
`npm install`.

### Ideas if resumed

- Default the sidebar to collapsed on small screens (phones) for an unobstructed first view.
- Real vendor logos on zone labels instead of colored-initial badges.
- A `localStorage` fallback for colony layout persistence on the static Pages build (currently
  `/api/state` is absent there and layout simply isn't saved — the colony still renders fine).
