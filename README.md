# AI Office

A live 2D office for your coding agents, staffed by cats.

Every agent becomes a cat with its own desk. Each project or team gets its own room along a corridor, next to a kitchen, meeting room, lounge and a few tool rooms (a library for reading files, a server room for shell commands, a search room for the web, a work bench for edits). You can watch cats step out of the elevator, find their desk, type, think, show an amber badge when they need you, and send letters to each other when they talk. Click anyone to see exactly what they are doing.

Works with **Claude Code**, **Codex**, **Cursor**, and anything else that can send an HTTP request.

**Live demo:** once GitHub Pages is switched on for this repository it is served at <https://seonggi.github.io/ai-office/> (runs in your browser, no install). Until then, run `npm run demo` as described below.

![AI Office: the 2D office with a cat at every desk](docs/office-day.png)

![The same office at night](docs/office-night.png)

A 3D view (three.js) from the original project is still included. Press the **2D / 3D** button in the top bar, or add `?view=3d` to the URL. 2D is the default.

## Quick start

AI Office is not published to npm, so install it from source (Node 20 or newer):

```bash
git clone https://github.com/SeongGi/ai-office
cd ai-office
npm install
npm run build        # builds the web app into dist/
npm link             # puts the `ai-office` command on your PATH
ai-office setup claude --write
```

Do not run `npm i -g ai-office`: AI Office is not published to npm, so install it from source as shown above. Without `npm link`, replace `ai-office` in every command below with `node /path/to/ai-office/bin/ai-office.mjs`.

Compatibility: the old `AGENT_FLOOR_*` environment variables and the `~/.agent-floor` folder are still read for now (deprecated). When both names are set, the `AI_OFFICE_*` one wins; `~/.agent-floor` is only used when `~/.ai-office` does not exist. Hooks installed by an older version are replaced when you run `ai-office setup <claude|cursor> --write` again.

After that, the next time a Claude Code session starts, AI Office opens by itself in its own desktop window (no browser). Close the window and it keeps listening from the menu bar; use **Quit (pause auto-open for 6 hours)** in the menu bar icon when you want quiet. Run `ai-office` any time to open it yourself.

Start a Claude Code session in any project. A cat walks into a room named after the project folder, sits down, and starts working. When it spawns a subagent, a new teammate walks in, gets briefed by letter, works at its own desk, and reports back.

No agents yet? Click **Watch demo**, or run `ai-office demo` in a second terminal.

## Ways to run

| Mode | Command | Sign-in | Remote control |
| --- | --- | --- | --- |
| **Local only** | `ai-office` | None. There is no address to set, and it only listens on 127.0.0.1. | Yes, from this computer |
| **Server + token** | `docker compose -f docker-compose.token.yml up -d --build` | Enter the token on the login screen the first time you connect. | No |
| **Server + Google sign-in** | `docker compose up -d --build` | Google sign-in through oauth2-proxy. | Yes |

For the Google sign-in mode, follow [docs/deploy-mini.md](docs/deploy-mini.md) (written in Korean). It needs oauth2-proxy and a list of allowed emails. The token mode binds to 127.0.0.1 by default; to reach it from other devices, set `AI_OFFICE_BIND=0.0.0.0` and put it behind an HTTPS reverse proxy, because over plain HTTP the token travels in the clear. Hooks send the token as a bearer token. Of the two server modes, only the Google sign-in mode lets you close sessions and send instructions.

To point the desktop app at a server, pick it on the first-run screen, or run `ai-office app --url https://your-floor.example.com`. The app remembers the choice, so plain `ai-office` opens the same server next time. Change it later from the menu bar icon with **Change server…**. Sign in on the server's own login page inside the window; if `AI_OFFICE_TOKEN` is set, the app sends it as a cookie (never in the URL).

### Installing the desktop app

`ai-office` (described above) runs straight from the cloned repository every time. If you would rather have a real `AI Office.app` in your Dock that you can double-click from Finder or Launchpad, install it once (macOS only, Apple Silicon and Intel):

```bash
# on a Mac that has Node installed
git clone https://github.com/SeongGi/ai-office.git
cd ai-office
npm ci
npm run install-app
```

This copies the Electron binary that `npm ci` already downloaded, renames it to "AI Office", draws its icon, and re-signs it (ad hoc, no Apple Developer account needed) into `~/Applications/AI Office.app`. Unlike running from source, the Dock icon, the Cmd+Tab switcher and the first menu bar item all say "AI Office" instead of "Electron". Re-running `npm run install-app` rebuilds the app in place, so it is safe to use after pulling new code.

Launch it from Finder or Launchpad. On first run it shows the same server-choice screen as `ai-office`; pick local or enter a remote floor's address, and it remembers the choice. To connect an agent's hooks to the floor the app opens, follow [Connect your tools](#connect-your-tools) below, same as for a source install.

To remove it: `node bin/ai-office.mjs install-app --uninstall`. It only ever touches an app it installed itself (checked by bundle identifier); if something else is already at `~/Applications/AI Office.app`, both install and uninstall refuse and tell you to move it out of the way first.

A few things worth knowing before you install:

- **The installed app and a source checkout you are developing on share the same single-instance lock** (both are named "AI Office"). Only one window opens at a time; the other instance just brings that window forward. If you are editing the code and testing it, quit the installed app first, or your changes will not show up because the old window is the one that answers.
- **The app bundle's own code does not move with it.** `Contents/Resources/app/index.js` points back at the repository path that was installed from. Moving or deleting that repository breaks the installed app; reinstall (`npm run install-app`) after moving it.
- **If your repository lives under `~/Desktop` (or `~/Documents`) with iCloud Desktop & Documents sync turned on,** iCloud can offload its files to the cloud to save space, which breaks the `require` above even without moving anything. Turn that sync off for the repo's folder, or keep the repository outside `~/Desktop`/`~/Documents`, before installing. `~/Applications` itself is not synced by iCloud, so the installed app's location is safe either way.
- **The bundled Electron Helper apps keep the name "Electron Helper"** (visible in Activity Monitor and system logs); only the Dock/Cmd+Tab/menu bar identity described above changes.
- If Gatekeeper still complains after installing (for example, if you copied the `.app` to another Mac), clear the quarantine flag: `xattr -cr ~/Applications/AI\ Office.app`.

## What you see

| On the floor | Means |
| --- | --- |
| A room | One project, or whatever `team` you send. Its name is above the door. |
| A cat at a desk | One agent. The lead sits at the head of the desk pod. |
| Typing | `working`: running a tool. The monitor shows the tool and what it is doing. |
| Thought bubble | `thinking` |
| Amber badge | `waiting`: it needs you |
| Head shake, red badge | `error` |
| Little hop, green check | `done` |
| Idle pose | `idle` |
| A letter travelling across the floor | A message from one agent to another |
| Walking out of the elevator, down the corridor | An agent joining (or, in reverse, leaving) |
| A cat in a tool room | It is using a tool: reading files, running a command, searching the web or editing |

A side panel lists every agent with what it is doing now, and four room cards count how many cats are in each tool room.

**Controls:** drag to pan, scroll to zoom, click an agent or a room. `F` frames everyone, `[` and `]` step through agents, `T` switches day and night, `Esc` closes things. On touch: one finger pans, two fingers zoom.

## Connect your tools

### Claude Code

```bash
ai-office setup claude --write     # merges hooks into ~/.claude/settings.json (backup kept)
ai-office setup claude --project   # prints a snippet for .claude/settings.json in this repo
```

Uses `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Notification`, `Stop`, `SubagentStop`, `PreCompact` and `SessionEnd`. Subagents spawned with the Task tool get their own desks and their tool calls show up on their own screens.

### Codex

```bash
ai-office setup codex
```

Prints the `notify` line for `~/.codex/config.toml`. Codex reports once per finished turn. If your Codex build supports Claude-style hooks, point them at `ai-office hook codex` and you get live tool activity too.

### Cursor

```bash
ai-office setup cursor --write     # ~/.cursor/hooks.json
ai-office setup cursor --project   # .cursor/hooks.json in this repo
```

Only observing hooks are installed. AI Office never answers a permission prompt for you.

### Anything else

Post JSON to `http://localhost:4317/events`:

```bash
curl -X POST localhost:4317/events \
  -H 'content-type: application/json' \
  -d '{"type":"tool","agent":"bot-1","team":"Payments","tool":"Bash","activity":"Running tests"}'
```

Or from a shell script:

```bash
ai-office emit --agent bot-1 --team Payments --status working --activity "Running tests"
ai-office emit --agent bot-1 --to bot-2 --text "Tests are green"
```

The full event format is in [docs/protocol.md](docs/protocol.md). More integration notes, including LangGraph and CrewAI style frameworks, are in [docs/integrations.md](docs/integrations.md).

## Configuration

| Variable | Default | Used by |
| --- | --- | --- |
| `AI_OFFICE_PORT` | `4317` | server, hooks |
| `AI_OFFICE_HOST` | `127.0.0.1` | server |
| `AI_OFFICE_URL` | `http://127.0.0.1:4317` | hooks, `emit`, `demo` |
| `AI_OFFICE_TEAM` | project folder name | hooks: put this session in a named room |
| `AI_OFFICE_NAME` | `Claude`, `Codex`, `Cursor` | hooks: the lead's display name |
| `AI_OFFICE_OFFICE_NAME` | none (shows `AI Office`) | server: pin the office name; it then cannot be changed from the UI |
| `AI_OFFICE_OFFICE_FILE` | `office.json` next to the audit log | server: where the office name is saved |
| `AI_OFFICE_AUTOLAUNCH` | `1` | set to `0` so hooks never open the app |
| `AI_OFFICE_SEED` | `1` | set to `0` so the server does not read the Claude Code sessions already open on this machine |
| `AI_OFFICE_TOKEN` | none | if set on the server, every request must carry it; hooks and `emit` send it as a bearer token (see [docs/deploy-mini.md](docs/deploy-mini.md), written in Korean) |

Group several repos into one room by giving them the same `AI_OFFICE_TEAM`.

The office name defaults to `AI Office`. On first run the app asks you to name your office (top bar, lobby sign, the info cat's lines); click the name in the top bar to change it later. The server keeps the name in `office.json`, so every browser and the desktop app see the same one. Only someone with control rights can set it (local use, or an admin in the Google sign-in mode); on a token-mode server, set `AI_OFFICE_OFFICE_NAME` instead. If the data folder is not writable, the name is kept in memory only and is lost on restart, with no error shown.

## Privacy and safety

- The server binds to `127.0.0.1` and only answers loopback host names.
- `POST` requires `Content-Type: application/json`, so web pages cannot fire simple cross-site requests at it. CORS is limited to localhost origins.
- Hooks time out after 1.2 seconds, swallow every error and always exit 0. If the floor is down, your agents never notice.
- Agent activity is kept in memory only and is not sent anywhere else. Activity text is clipped to 280 characters. The only files the server writes are the audit log, custom agent names, terminal routes and the office name under `data/` (git-ignored), and only when you use the remote-control features (closing a session or sending it an instruction) or name your office.
- On start the server also reads which Claude Code sessions are already open on this machine, so their project names show up in the office right away. Set `AI_OFFICE_SEED=0` to turn that off.

## The desktop app

`ai-office` (or the first hook event when nothing is running) starts the floor and opens it as an Electron window. If Electron is not available, it falls back to a Chrome or Edge app window, and then to your default browser. Only one copy ever runs: parallel subagents share a launch lock. `ai-office start` runs just the server, with no window, if you prefer a browser tab at http://localhost:4317.

## Performance

The 2D floor is drawn on one canvas. Add `?stats` to the URL (or run `ai-office demo --agents 60` for a stress test) to see frame time.

## How it works

```
Claude Code / Codex / Cursor hooks ──┐
ai-office emit, curl, your code ─────┼──► POST /events ──► reducer ──► GET /stream (SSE) ──► browser
                                     │                       │                                │
                                     └─ adapters/*.mjs       └─ shared/protocol.js ◄──────────┘
                                        map native payloads     same reducer runs on both sides
```

- `server/` is a zero-dependency Node HTTP server.
- `shared/protocol.js` is the event reducer, used verbatim by the server and the browser, so a snapshot plus the stream always matches.
- `adapters/` turn each tool's hook payload into floor events. They are pure functions with tests.
- `src/world2d/` is the 2D office: rooms, desks, the cats, letters and the camera.
- `src/world/` is the optional three.js 3D scene from the original project.
- `src/ui/` is the HUD: side panel, name tags, speech bubbles, the agent card and the connect sheet.
- `desktop/` is the Electron shell: native window, tray icon, single instance, auto-launch state.

## Develop

```bash
git clone https://github.com/SeongGi/ai-office
cd ai-office
npm install
npm run dev        # floor server on :4317 + Vite on :5173
npm run demo       # in another terminal, stream fake agents
npm test           # protocol, adapters, server
npm run build      # typecheck + production build into dist/
```

`npm run build:pages` builds a demo-only version into `dist-pages/` for GitHub Pages. The included workflow publishes it on every push to `main`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how the scene is put together and what makes a good adapter.

## Credits

This project started from [develop212/agent-floor](https://github.com/develop212/agent-floor) (MIT). The 3D office (`src/world/`), the event protocol and the adapters come from that project.

The 2D office (`src/world2d/`), the cat characters, the break-room and farewell scenes, and the later changes were made in this repository by SeongGi, together with Claude Code. Along the way I looked at other people's ideas for inspiration, but I did not copy their code.

## License

MIT. The original copyright notice is kept in [LICENSE](LICENSE), and the changes in this repository are added under the same license.
