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
  after opening it.

Adding an interface of this kind should need no client change. If it does, the missing
capability belongs in the runtime as a declared option, not in a feature-specific module.
