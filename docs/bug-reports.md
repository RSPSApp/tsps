# Bug reports

Players report bugs from the client (#581). A report reaches the developers as a GitHub issue
with the description, a screenshot, and enough of the client's and the server's state to
reproduce it without asking the player again.

## Opening the form

- **The sidebar's Report a Bug button:** the bug icon, second on the rail.
- **`::bug`**, or `::bug <what went wrong>` to start the description. The client handles the
  command itself; it never reaches the server.
- **Right-click the chatbox Report button, Report game bug:** the cache's own op 4 on 162:31.
  OSRS's form opens the same way: glitches "can be reported directly to Jagex by
  right-clicking the Report button and selecting 'Report game bug'" (OSRS Wiki, *Bug*). While
  Voice Chat holds the Report button, its clicks are voice's.

## What a report contains

- **The description:** required, at most 4,000 characters.
- **A screenshot:** optional, on by default. It's the game as drawn when the form opened, the
  scene and the interface canvases composed (HTML overlays such as the timers are left out),
  as a JPEG of at most 1600 × 1200. The form takes a new one whenever it opens with nothing
  written; a draft keeps its own, and Retake screenshot takes it again. A form left open
  through login takes the welcome screen, then the world once the player clicks to play,
  unless they've written something or retaken it by then.
- **Diagnostics:** on by default; the form says so, and the player can turn them off.
  - **The client:** its console over the last 5 minutes (every console call, uncaught errors
    and unhandled rejections, each line cut at 2,000 characters), the browser, renderer,
    viewport, fps and cache, the world, the position, inventory, equipment, skills, non-zero
    varps, mounted interfaces, enabled and failed plugins, and the last 50 game messages.
    Player chat is left out: the messages are the game's own, and console lines that carry
    what the player typed (chat, friends chat, ::commands, name and text dialogs) keep the
    line without the text.
  - **Console budget:** the client logs every widget event, about 40 lines a second, so
    ordinary lines keep the newest 3,000 (500 KB), a minute or two. Warnings and errors have a
    budget of their own (1,000 lines, 250 KB), so chatter never pushes them out of the 5 minutes.
  - **The server:** the character as the server has it (position, area, interface, skills,
    inventory, equipment), so a desync shows as a difference, and the world (cache, commit,
    members, XP rate, players online, uptime).
  - **Never:** the login state, which holds the password, or an IP address.
- **Without diagnostics** only the description, the screenshot and the player's name go.

The issue puts the description first, then the screenshot and a table of where and on what it
happened; client warnings and errors, game messages, and items sit in collapsed sections, and
everything else is in `diagnostics.json`. The player's text is made inert: it can't mention
anyone, link an issue, or add HTML, Markdown links or images. GitHub still makes a link of a
bare address (`https://…`), with the address as its text.

## Where reports go

- **GitHub:** set `BUG_REPORT_GITHUB_REPO=owner/name` and `BUG_REPORT_GITHUB_TOKEN` in
  `server/.env` or the root `.env`. Use a fine-grained token limited to that repository, with
  Issues and Contents read and write. GitHub's API can't attach files to an issue, so each
  report first commits `reports/<date>/<id>/screenshot.jpg` and `diagnostics.json`, then opens
  an issue that links them. In a private repository only people who can read it see them.
- **This server:** with neither variable set, or when GitHub fails, the report is saved to
  `server/data/saves/bug-reports/<time>-<player>-<id>/` as `report.md` (the issue as it would
  read), `diagnostics.json` and `screenshot.jpg`. The player is thanked either way.
- **Nowhere:** `"plugins": { "BugReports": false }` in world.json or world.local.json. The form
  then says the world doesn't take bug reports.

## How it travels

- **Plugin messages** on the `bug-report` channel, since a report is far bigger than one
  plugin message (16 KB): `status`, then `begin`, the report's JSON as base64 chunks of 15,000
  characters, and `end`; the server names any chunk it lacks and the client sends it again.
  Chunks go at 40 a second, under the server's 64 plugin messages a second per player.
- **Limits:** a report is at most 3,000,000 characters; one report a minute per player, 30 an
  hour per world, and 5 uploads at once. An upload with no chunk for a minute is dropped.

Code: `client/game/plugins/bugreport/` and `server/plugins/interface/bugreports/`.

## Not done

- **Server logs:** the server's console mixes every player's lines, so a report carries the
  server's view of the character instead.
- **Web workers** have consoles of their own, which aren't captured.
- **Known issues:** OSRS's form lists them to save duplicate reports; this one doesn't.
- **Replays** are out of scope.

## Testing

`client/tests/bug-report-plugin.test.ts`: the log buffer, the chunked upload, `::bug`, the
Report game bug op, the screenshot composition, the form and the report it sends.
`server/tests/bug-reports.test.cjs`: the upload protocol, the limits, the issue, GitHub
(against a fake API) and the local fallback.
