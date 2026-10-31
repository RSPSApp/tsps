# Cache editor

Two halves, and only the first exists today:

1. **Inspect** — read any cache definition, its values, its links, and what points back at it.
   Done, and verified below.
2. **Author** — the browser page (`?cache=1`), the ref pickers, the overlay writer and the
   per-kind forms. Designed, not built.

Read this before adding a kind: the metadata table, not the UI, is what decides whether the tool
tells the truth.

## The problem this solves

A loc's animation is a **sequence** id. An item's noted form is another **item**. A varbit names its
**varp** and bit range. A multi-loc is a placeholder whose child depends on a live varbit. The cache
stores none of that: a config file is a flat list of opcodes and ids, and only knowledge turns
`seqId: 3206` into "the crate shakes via `quest_mcannon_crate_shake`".

So the editor keeps that knowledge in one place — `server/plugins/tools/cache-editor/Fields.CacheEditor.js`
— and both the inspector and (later) every form read it. Fields are listed by **name**, never by
opcode number, because names survive cache revisions and opcodes do not.

## Inspecting

Agent MCP tools, all read-only:

| Tool | Answers |
| --- | --- |
| `cache_kinds` | every kind, its definition count, how many are named, whether a decoder exists |
| `cache_inspect { kind, id, player? }` | the values, every link with the target's name and whether it resolves, and the multi-def block |
| `cache_search { text, kind?, limit? }` | ids by gameval name (`ent_totems_site_1_base`) or by id, custom items included |
| `cache_used_by { kind, id }` | which locs, npcs and items point at this id |

Links cover every reference field in the table, including `params` on locs, npcs, items and structs,
an npc's `modelIds`/`chatheadModelIds`, an item's `countObj` and `notedId`/`placeholder`, a loc's
`randomSeqIds`/`ambientSoundIds`, and a sequence's held items. The reverse index is keyed on the
overlay state as well as the cache, so installing a definition archive or adding a custom item
rebuilds it instead of answering from a stale scan.

`cache_inspect` link states are three-valued, and the order matters: the **archive or overlay
registry answers first**, and the gameval name list is only a fallback for an id that cannot be
proven absent.

- `known` — the cache actually holds it (`CacheDefinitions.hasDefinition`), including real locs that
  have no gameval name.
- `missing` — the archive proved it absent: a counted kind past the end (`loc`, `npc`, `item`) or an
  id with no file in `varbit`, `seq`, `spotanim`, `dbro`.
- `unverified` — the target is not a decoded definition (models, sprites, sounds, frames) **or** its
  absence cannot be proven (structs, enums, DB tables, varps, inventories answer "unknown" rather
  than pretending). The id and name are reported; fields are never invented.

An id that does not exist returns `{ exists: false }` and no values at all — a loader answering with
a default object is not evidence that a definition is there.

Real output for loc 1, which is the whole point of the tool:

```
loc 1  "Crate"
  seqId  3206  → seq quest_mcannon_crate_shake   known       (the loc's animation)
  models 15402 → model                          unverified  (a model file, not a definition)

cache_used_by seq 3206 → 3 locs: 1 (Crate), 15599 (Crate), 15600 (Crates)

cache_inspect dbro 14 → table 0, columns 2 (displayname) ["Clock Tower"], 19 (endstate) [8]
```

That last line is the same completion contract the quest work uses: a DB row's column names come
from gamevals, so `endstate` is read by name and survives a cache revision that renumbers columns.

## What is decoded today

`loc`, `npc`, `item`, `seq`, `spotanim`, `varbit`, `struct`, `enum`, `dbro`, `dbtable`, `idk`.
Missing: `varp`, `inv`, `bas` — none of which is a link target the inspector needs (a varbit already
names its varp, and varps are flat).

Sequence and spotanim were the two that mattered, because they are what a loc's animation actually
resolves to:

```
loc 1 "Crate"        seqId 3206 → seq quest_mcannon_crate_shake (known, 6 frames)
graphic 1 firebreath_attack → modelId 17549 (unverified) + animationId 86 → seq (known)
```

A sequence's frames are **not** definitions — they live in the frame archive — so a frame link
reports `unverified` and says why, rather than inventing a kind.

## Authoring, partially built

`Document.CacheEditor.cjs` is the canonical overlay document
(`server/data/definitions/custom-definitions.json`): rows of `{ kind, id, baseId, fields }`, overlay
ids starting above the cache's own count for the kind, validated for unknown fields, dangling links,
self-references, duplicate ids and the real compressed transport budget.

`Authoring.CacheEditor.plugin.js` is the only writable surface: loopback only, on
`WEBSOCKET_PORT + 1101`, opened by `CACHE_EDITOR_ENABLED=1`, with the item editor's guards — origin
allow-list matched to `PORT`, 1 MiB body, atomic temp-file replace, revision conflict on stale
clients, and a restart notice after saving. `Catalog.CacheEditor.plugin.js` serves the reads at
`/api/cache-kinds`, `/api/cache-inspect`, `/api/cache-search` and `/api/cache-used-by`.

Saving writes overlay rows, and they are **applied at the next server start**: `Catalog` reads the
document on startup and registers it with `CacheDefinitions.registerCustomDefinitions`, which clones
the base definition and overrides the listed fields. That is the whole reason locs and npcs need no
encoder and no repack — `getObject`/`getNpc`/`getItem` return the overlaid clone, so `ObjectDefinition`,
`NpcDefinition` and `ItemDefinition` (all of which route through them) see it too, while the base cache
definition stays untouched.

What is still missing is **placement**: a new loc id exists but nothing spawns it. That is the map
editor's job (`WorldLocSpawnRow` / `WorldLocChangeRow`), and the next step is linking the two
workbenches — "place this loc" from here, "inspect its definition" from there.

## The page

`?cache=1` loads `client/custom/cache-editor/` on demand (lazy, so the game bundle is untouched) and
takes over the screen. Reads go through `fetchContent` on the world's own origin; writes go only to
the loopback authoring service, whose port is derived as the content port + 1101 and refused for any
non-`http:` world.

- **Browser (left):** a kind selector with counts, then name/id search. Rows show `kind id name`, and
  a `custom` badge for overlay items.
- **Inspector (right):** `values`, `links`, `used by`, `transforms`.
  - Every link is a link: clicking `seq 3206` inspects that sequence, with a back arrow over the
    visited trail.
  - `links` is where a draft is built: each target has a **use** button that puts that id into the
    draft's field, so "this loc should use that graphic" is one click, not an id typed from memory.
  - The draft picker filters a **field's target kind by gameval name**, so a new link never needs an
    id typed from memory: choose `seqId → seq`, type `quest_mcannon`, click the hit. Only fields
    whose target kind is searchable are offered — `models`/`mapSceneId` point at model and sprite
    archives, so they stay inspectable but cannot be picked by name.
  - `transforms` shows the gating variable, the children, which one is the fallback, and — with a
    player — which child that player currently sees.
- **Preview:** drawn by the client's own software model renderer (`Model2DRenderer`), so no WebGL
  context and no game render loop are needed. Each kind goes through **its own builder**, because the
  geometry genuinely differs:

  | Kind | Builder | What matters |
  | --- | --- | --- |
  | loc | `LocModelLoader.getModel(locType, shape, rotation)` | which `types` group the shape selects, mirroring, `modelSize*` resize, `offset*` translate, lighting |
  | npc | `NpcModelLoader.getModel(npcType, seq, frame)` | transforms (multi-npc), stance animations, recolours |
  | item | `ObjModelLoader.getModel(id, count)` | inventory model plus recolours and custom-model overlays |
  | spotanim | merged `modelId` + the renderer's sequence frame | model, then the graphic's animation |

  A loc is not "a model": the same loc placed as a wall and as a centrepiece is different geometry, so
  the preview offers the shapes the definition actually carries (`types`) and a quarter-turn control.
  Kinds without a builder fall back to merging `models`/`modelIds` directly. A sequence plays at 120 ms per frame while the tab is open: a loc's `seqId`,
  an npc's `idleSeqId`, a graphic's `animationId`. A definition with no models says so, and a model
  missing from the archive names the id rather than drawing an empty square.
- **New element:** `+ New` asks for a **type**, an optional **starting definition** ("starts from" —
  the base an overlay overrides; blank means a bare field list), a **name**, and an **id** that is
  pre-filled with the next free overlay id, computed from the authoring document so it never collides
  with the cache or an earlier overlay. `+ New based on this` in the footer starts the same flow with
  the selected entry already chosen.
- **Editing:** after Create the ordinary tabs open on the new element, and **every value cell is
  editable in place** — click, type, Enter. Values are parsed by field type (booleans, integers,
  arrays as `a, b, c`, strings), overridden cells turn green, and with a base the table is pre-filled
  from it so an override is visible against what it replaces. `Save` writes only the changed fields
  and reports "restart to apply"; `Discard` drops the session.

The page holds no cache knowledge of its own: every field name, kind, name and link state comes from
the server, so the field table stays the single place that decides what the editor can say.

Order, because each step is what the next one reads:

1. ~~`seq`, `spotanim` decoders~~ — done.
2. The page at `?cache=1`, lazy-loaded like `?items=1`: browser, inspector tabs, generated form,
   changes tray. Read from the client's loaded cache, write through a loopback authoring endpoint
   with the item editor's guards (revision check, atomic write, origin + loopback check, restart to
   apply).
3. Overlay documents per kind, `{ id, baseId, fields }`, applied over the cache definition at load —
   the item overlay's model, generalised. Note `plugins/world/DefinitionArchives.plugin.js` already
   installs loc/npc/obj definition overlays from bundles at runtime and pushes them to clients;
   the authoring format should emit those rather than invent a second path.
4. Placement, which a loc definition does not give you on its own: reuse the map editor's
   `EditorWorldMap` and loc spawn/change rows, and link the two workbenches by tile.

## What not to do

- Do not resolve a link by guessing. `unverified` is a useful answer; a fabricated kind is not.
- Do not show a multi-def as if it were one definition. The id in hand is a placeholder, and the
  child a player sees depends on a varbit — the same trap quest code kept hitting.
- Do not key metadata by opcode. `Columns can move between revisions` is already a comment in this
  codebase for exactly this reason.
- Do not hand-edit generated cache data. Content authored here is tsps data and belongs in
  `data/definitions/`; anything dumped from the cache goes through
  [RSPSApp/osrsreboxed-db](https://github.com/RSPSApp/osrsreboxed-db) (see `server/AGENTS.md`).

## Verification

`server/tests/cache-editor.test.cjs` runs against the real cache (needs `yarn build`): the field
table's internal consistency, a loc's links and names, a multi-loc's gated children, an item's noted
form, a varbit's varp and width, a DB row's named columns, name and id search, a kind without a
decoder, the reverse index, and that every loc and npc definition describes without throwing.
