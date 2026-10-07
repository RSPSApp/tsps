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
- Responses carry an ETag and revalidate to 304, so definitions are fetched once per build
  rather than pushed on every open.
- The first open of a session waits on a fetch. Updates sent in the same batch are held by
  the client and applied once the widgets exist, so an interface can be populated straight
  after opening it.

Adding an interface of this kind should need no client change. If it does, the missing
capability belongs in the runtime as a declared option, not in a feature-specific module.
