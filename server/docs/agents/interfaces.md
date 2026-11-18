# Server-defined interfaces

An interface that does not exist in the cache is defined entirely by the server. A plugin
registers one definition - the widget group plus the behaviour the client drives it with -
and it becomes an addressable resource:

    api.registerCustomInterface({ groupId, widgets, search, list, status, hint })
    -> GET /api/interfaces/<groupId>

The client fetches it the first time that group is opened, so opening one only needs the
usual sub-interface packet. `widgets/custom/CustomInterfaceRuntime.ts` reads the behaviour
half and owns focus, keystrokes, scrolling and slot binding; see
`plugins/interface/Commands.plugin.js` for a worked example.

Row data is a separate resource, registered with
`api.registerContentEndpoint(name, handler)` and served at `/api/<name>`. Use it for
request/response shaped, cache-derived data - searches, lists, lookups.

Declared `scroll` regions can read their height from a hidden text component using
`contentHeightComponent`, falling back to `contentHeight`. `resetOnComponents` lists
buttons that return the view to the top while still sending their click to the server.

Rules for both:

- Read-only and public. Anything player-specific or privileged stays on the game socket,
  where the session is already authenticated.
  A search declaration can use `dataComponent` instead of `endpoint`: send JSON rows
  (`[{ id, name }]`) to that hidden text component with `sendString`. The shared search
  runtime filters those rows locally, including all rows when the query is empty. Use
  `list.textOnly: true` for rows that are text rather than inventory items. Commands uses
  this mode to send only the current player's permitted commands, then prefills the query
  by sending text to `search.inputComponent`.
- A list can be a menu of things to act on. `list.clickable: true` sends the clicked row's
  `id` back as the action's `slot` (with the usual `opId`), however the list is scrolled or
  filtered. `list.labelStart` gives each slot a separate text component, so the `iconStart`
  slots show each row's `icon` item. Rows may also carry `detail` (plain text for the
  label's `%detail`), `terms` (extra words the search matches) and `header: true` (a section
  title drawn with `headerLabel`, not clickable, kept only while a row under it matches).
  `list.select` fills a details panel the moment a row is clicked, without a server
  round-trip: each `texts` component takes the row's `panel` value of that name (server
  markup kept), `iconComponent` takes its icon and `showComponents` appear. The click still
  reaches the server, which only needs to remember the selection. New data for the same
  list keeps its scroll and redraws the selected row's panel, so a server can refresh rows
  (a toggled favourite) without jolting the list; a new query scrolls back to the top.
  A `tabs` declaration switches tabs client-side too: the data component holds every row
  once, and `tabs.layoutComponent` gets `{ active?, tabs: [[rowId | { header }]] }`. A tab
  click shows that tab's rows at once (still telling the server, which can remember it);
  only send `active` when opening, so a later refresh doesn't pull the player back.
  A widget text packet carries at most 64 KB, so a long list can arrive in parts:
  `search.extraDataComponents` lists more hidden components whose rows follow
  `dataComponent`'s, and each part can be replaced on its own.
  `plugins/interface/TeleportInterface.plugin.js` uses all of these.
- `sendString` skips text equal to the last it sent to that component. Text the client
  changes on its own (a typed search) is unknown to the server, so clear its copy with
  `player.getFrameUpdater().clear(uid)` before resetting it.
- Responses carry an ETag and revalidate to 304, so definitions are fetched once per build
  rather than pushed on every open.
- The first open of a session waits on a fetch. Updates sent in the same batch are held by
  the client and applied once the widgets exist, so an interface can be populated straight
  after opening it. What was sent with an open stays with it until the server closes or
  reopens it: a root change (Play on the welcome screen, after an open right at login)
  mounts it again with its rows, tab, query and selection, and nothing needs resending.

Optional extras, all off unless declared (a client that predates them ignores the keys and
draws the plain list):

- `list.stripeColors: [even, odd]` colours each row's background by its place in the list
  (a zebra list that stays correct while scrolling and filtering).
- `list.detailStart` + `list.detailLabel` add a second text component per slot (a bold name
  over a plain description), filled like `itemLabel`. `list.rowParts` lists more per-slot
  components (lines, bevels) that move and hide with their row, keeping their own offset.
- `list.nameTarget: true` names a row by its `name` in the right-click menu ("Buy Shark")
  when the label shows something else (a price).
- `list.headerSpan: { fontId, color, lineColor, height, fillColor }` gives each header a
  whole grid row, its title centred across the view (a shop's "Magic" section).
- `list.jumpComponents` are buttons that scroll to the nth header. `list.jumpLit` lights the
  clicked one at once (plates shown/hidden, text through `textTemplate`), and
  `list.jumpClearsQuery` clears a typed search first.
- Rows with `searchOnly: true` appear only while a query is typed (other markets' items).
- `search.focusOnOpen: false` opens with the placeholder showing until the box is clicked.
- `overlay: true` declares a non-modal panel (mounted beside other interfaces); it keeps no
  list state, so it leaves the open modal alone. Its `hotkeys: { gate?, keys: [{ key,
  component }] }` click a component's op 1 while `gate` is visible, and
  `dockBesideSidePanel: true` keeps it against the side panel on the resizable frames.
- A hover preview needs no option: a widget's `onMouseOver`/`onMouseLeave` can run cache
  script 69 (`if_sethide`).

None of these touch the cache: they are client code reading server JSON, so cache and OSRS
updates leave them alone.

Adding an interface of this kind should need no client change. If it does, the missing
capability belongs in the runtime as a declared option, not in a feature-specific module.
