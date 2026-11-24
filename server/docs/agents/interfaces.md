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
- A table can declare `list.textColumns: [{ start, field, baseY? }]`. Each pooled slot fills
  the text component `start + slot` from the matching row's `panel[field]`, preserving
  trusted server markup as `list.select` does. Empty rows and headers hide these cells unless
  the column declares the header layout described below.
  Backgrounds must paint before icons and text. Static widget siblings paint by component
  ID, so give backgrounds lower IDs than icons and text. The runtime
  refreshes pooled rows and scroll bounds when the list viewport changes size.
- A single-column list can opt into `collapsible: true`. Rows with `expandable: true`
  own following children identified by `parentId`; `collapsed: true` closes a group on a
  fresh open. `groupLabel` accepts `%toggle` as `[+]`/`[-]` and the usual `%name` replacement.
  `groupColor` and `groupHeight` style those rows. Optional `rowChrome` declares pooled
  `borderStart`, `dividerStart`, `guideStart`, `toggleStart` and `toggleGlyphStart` component
  ranges, each with `slotCount` widgets. Use native rectangles for borders/dividers/guides
  and a framed button plus text glyph for the disclosure. `indent` and `maxIndent` bound the
  horizontal offset of descendants. The runtime hides/repositions these controls as slots
  are reused; toggle components use the same local action as the whole folder row.
  A group text-column value can use `%action` for its current click instruction.
  Search reveals matching descendants and
  their ancestors; clearing search restores expansion, which also survives a root remount.
  Cyclic/orphaned ancestry is ignored, and nesting is bounded to 12 parents. Folder toggles
  stay local. Give their pooled widgets a transmitted op flag and an action as usual so the
  native menu can offer the click; both primary mouse-down and menu actions invoke the
  runtime before scripts or gameplay transmission, so local controls work on left-click too.
- `list.headerStyle: { height, backgroundColor, fontId?, textColor?, labelX?, labelWidth? }`
  gives section titles a full-width background and separate text style. Optional `labelY`
  and `labelHeight` leave space for a subtitle. A text column with
  `header: { baseY, x, width, height }` displays its panel field on headers in that raw layout;
  without it, the column stays hidden on headers. `indent: true` on a text column makes it
  follow the row's hierarchy offset. Width values retain the declared widget's width mode.
  `labelX`/`labelWidth`
  override the label's raw layout values; defaults are 8/16. Compact headers and optional
  group heights use measured row offsets for both pooling and scrolling. Other lists retain
  their existing fixed row heights. `list.select.local: true` makes item details stay local
  too; the declared `texts` can update both a scroll region's text and hidden content height.
- Custom widgets can opt into `maxWidth`/`maxHeight` to cap aligned dimensions before
  positioning. For a growing modal, first request the appropriate native mainmodal size
  through the cache script, as Bank or Omnishop does; resizing only the custom root cannot
  enlarge a fixed-size mount. NPC model widgets can opt into `npcFullBody: true` to fit an
  animated body inside their bounds using the normal NPC model/sequence loaders.
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


Custom text widgets may opt into `overflowScroll: true` for clipped single-line overflow
that moves left with pauses at both ends. It resets on text/width changes. Use it for compact
labels, not paragraphs. `list.tooltipField` names a row panel field for the existing native
TooltipManager/TooltipOverlay; `status.tooltipComponent` supplies a hidden text component
for the status tooltip. `getPointer` is supplied by the host and returns no pointer while
menus are open. These tooltips are removed on interface close and wrap within the canvas.


Lists can opt into `cards: { minWidth, maxColumns, gap, height, parts }`. Sibling leaf rows
pack into responsive native cards; section headings remain full-width bands. By default folders are bands too; `cards.groups`
opts expandable groups into tiles. Changing parent flushes the current card row. Each part names a
pooled component `start` and card-relative `x`, `y`, `width`, `height`; `stretch` uses the
card width minus `width`, and `align` can be `center` or `right`. Parts can set `fontId`,
`textColor`, `textAlignment`, `singleLine` and a `%text` template. Size the slot pool for
the maximum viewport including partially visible rows, and keep all component ranges
separate. The runtime restores original geometry/positioning modes as cards become bands.
This presentation does not change filtering, local expansion or row tooltip semantics.


`cards.groupParts` overrides/adds native component geometry for group tiles after `parts`.
A local list can declare `actions: { examine: true, info: { label, field } }` for native
right-click ops. Op 1 retains selection/expansion, op 2 calls the host `showInfo` with the
nonempty row panel field, and op 3 calls `examineItem` with `row.examineId ?? row.icon`.
Use `examineId: -1` for representative group thumbnails. Give pooled controls the matching
op flags. The host uses its existing item Examine and chat mechanisms; actions consume
locally and never send a widget gameplay packet. Empty info fields omit that menu action.

## Panel and list behaviour

- `lifecycle.persistOnWorldInteraction: true` keeps the custom main panel open during
  walking, item actions (including equips and drops), combat hits, teleports and skill
  starts via `SkillManager.startSkillable`. Those actions still end input prompts and
  close chatbox and side modals. Use `lifecycle.blocksGameplay: false` when the open panel
  should also let actions that check `player.busy()` proceed. Explicit closes and modal
  replacement still remove the panel.
- `preserveState: true` restores the query, rows, selection, tab and scroll after a close and
  reopen in the same client session. Logout and disconnect clear this state.
- Local search matches row names and `terms`. `search.matchSectionAndInfo: true` also
  matches each section title and the string in `panel.info`.
- `search.socket` searches over authenticated widget actions. Set `requestComponent` for
  the widget op and use `sessionComponent` to send a session token as widget text. The op's
  `target` carries JSON with `session`, `sequence` and `query`. Send JSON containing the
  same fields and `rows` to `responseComponent`, with an optional `total`. The client
  ignores responses for an earlier session, sequence or query. `tabs` limits the socket
  search to those tab indexes. `pageSize` adds `offset` to requests and expects `offset`,
  `pageSize` and `total` with each response. Use the fixed list layout for paging. When a
  paged declaration also supplies `list.cards`, the client uses its fixed list layout.
- `list.rowActions` adds controls to pooled rows. Each entry's `start` identifies the first
  component in a range of `slotCount` controls. `leafOnly` and `groupOnly` limit which rows
  show them. Text controls can take `label`, `groupLabel` and `expandedLabel` according
  to the row type and expansion state. In a clickable list these controls share the row's
  action slot, so the server receives the row ID even after scrolling or filtering.
- `tabs.serverDriven: true` waits for the server to send `active` to `tabs.layoutComponent`
  before switching tabs. Use `pendingComponents` to hide controls while the new data and
  layout arrive. The layout can also set widget visibility through `visibility` entries
  with `component` and `hidden`.
