# NOTICE

This project is an **offline demo fork** of **Bot Crossing**, an open-source 3D colony
visualizer for coding-agent sessions.

- **Original project:** Bot Crossing by **Jarren Rocks** — https://github.com/jarrenrocks/bot-crossing
- **License:** MIT (see `LICENSE`). The original copyright notice is retained as required.

## What is different in this fork

This is a **demonstration** build. It does **not** scan the local machine for real agent
sessions. Instead it renders a fixed, **fabricated** set of bots (see
`src/game/offline-data.js`) so the colony can be shown publicly and hosted as a static site
with no backend and no access to anyone's files.

Key modifications:

- `src/game/offline-data.js` — new module providing the fabricated demo threads.
- `src/game/api.js` — `fetchThreads()` returns the fabricated data instead of calling
  `/api/threads`.
- `src/main.js` — clicking **Open** on a bot shows a friendly "access locked" message rather
  than handing the session back to a harness.
- `src/ui/hud.js` / `src/ui/styles.css` — an "access locked" modal, plus updated help text that
  frames the app as an offline demo.

All original functionality for rendering the colony (zones, badges, layout, navigation) is
unchanged and runs entirely client-side.
