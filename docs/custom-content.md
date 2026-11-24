# Custom content

The server can add items, models, NPCs and interfaces that aren't in the OSRS cache. The client
receives them at login in the `GAMEMODE_DATA` packet and resolves them alongside cache data, so
no client changes are needed. [Architecture](ARCHITECTURE.md#custom-content) explains the
pipeline; this page covers custom items and plugin pets.

Other custom definitions:

- Custom locs, NPCs and items made in the cache editor:
  [server/docs/agents/cache-editor.md](https://github.com/RSPSApp/tsps/blob/main/server/docs/agents/cache-editor.md)
- Interfaces that don't exist in the cache:
  [server/docs/agents/interfaces.md](https://github.com/RSPSApp/tsps/blob/main/server/docs/agents/interfaces.md)

## Custom items

Custom items are rows in `server/data/definitions/custom-items.json`, loaded at startup by
`server/plugins/items/ItemDefinitionLoader.plugin.js`. Their ids start at **50000** so they never
collide with cache items.

```json
{
  "id": 50000,
  "baseItemId": 4587,
  "objType": { "name": "Dragonic katana", "examine": "...", "model": 1000000, "maleModel": 1000001 },
  "itemDef": { "tradeable": true },
  "models": { "1000000": "dragonic-katana/drop.dat", "1000001": "dragonic-katana/equip.dat" }
}
```

- `baseItemId` (optional): a cache item the new item copies everything from, on the server and in
  the client.
- `objType`: client-side fields that override the base (name, examine, actions, models, 2D
  sprite zoom and angles, recolours).
- `itemDef`: server-side fields that override the base: `equipmentType`, `weaponInterface`,
  `bonuses`, `requirements`, the flags `doubleHanded`, `stackable`, `tradeable`, `dropable`,
  `sellable`, and numbers such as `value` and the animations.
- `models` (optional): model ids (1000000+) mapped to `.dat` files under `server/data/models/`.
  Every `objType` model field of 1000000 or more must name one of them.
- `specialAttack` (optional): see below.
- `retainWornModelForAnimations` (optional): animation IDs whose poses keep this item's worn
  model instead of the sequence's replacement item. Empty-hand cues still hide the item.
  Creator exports populate this list for authored movements and special attacks. Re-export
  existing gear to add the policy; native weapons and unrelated tool animations are unchanged.
- `visuals` (optional): version 1 item visuals, with compiled surface bindings, particle
  geometry and motion tracks for each custom model. Creator's Visuals tab authors these on
  any gear slot. The client samples them before the player's pose in WebGL and WebGPU.
  Exported packages require `CacheDefinitions.ITEM_VISUALS_VERSION === 1`.

The loader validates each item at registration. Multiple item rows may arrive in batches at
login. Each item must fit in a single 64 KiB game message after compression. The registration
error names an oversized item so you can reduce its imported surface image size or frame count.
On the client,
`CustomItemRegistry` (`client/custom/items/`) holds the rows and `CustomObjTypeLoader` wraps the
cache's `ObjTypeLoader`, so custom items show in inventories, shops and tooltips like any other.

### Special attacks

A custom weapon in `server/data/definitions/custom-items.json` gets a special attack bar in Combat
Options with a `specialAttack` entry on its row (next to `objType` and `itemDef`). Give at least one
of its two fields:

- `from` (optional): another item whose special attack the weapon uses, such as 29000 for the
  Eclipse atlatl's.
- `energy` (optional): the cost in percent, 1 to 100. Without it the weapon costs what its special
  costs (for `from`).

To borrow a special, name it in `from`:

```json
{
  "id": 50002,
  "baseItemId": 29000,
  "objType": { "name": "Sanguine atlatl" },
  "itemDef": { "equipmentType": "WEAPON" },
  "specialAttack": { "from": 29000, "energy": 50 }
}
```

To give the weapon a special of its own, leave out `from` and register the special for the weapon's
id in a plugin, as the files in `server/plugins/combat/specials/` do:

```json
"specialAttack": { "energy": 50 }
```

```js
api.registerCombatSpecial({ id: "sanguine_atlatl", itemIds: [50002], drainAmount: 50, ... });
```

A special registered for the weapon's own id is always the one it uses, even with `from` set. The
`energy` in `custom-items.json` is its cost either way, so the bar and the drain agree.

The client shows the bar because the entry gives the weapon a place in the cache's special weapons
list (enum 906), which the combat tab checks. Without `energy`, `from` must be a cache special
weapon for the bar to show. A borrowed special whose own code checks which weapon is worn, or what
else is worn (the Eclipse atlatl's needs the Eclipse moon set), keeps those checks. The server logs a
warning at startup for a weapon whose bar has no special behind it.

## Adding pets from a plugin

A plugin can add pets of its own to the Pets plugin (the Plugin Hub's Custom Pets does). As the
Pets plugin registers, it emits `pets:extensions` `{ pets, services }`. A listener pushes rows
onto `pets`, each `{ petId, itemId, ... }`: `petId` is the follower's NPC id and `itemId` the item
it's summoned from (Drop). Summoning, Pick-up, banking, following, relogging and ownership then
work as for real pets. Any other fields stay on the row, and the plugin's `pets:interact`
handler gets that row back as `pet`. `services` lends `getOwnedPetItems(player)`,
`holdsPetItem(player, itemId)`, `getPetForItemId(itemId)` and `getPetByNpcId(npcId)`.

Plugin Hub plugins in `plugins/imported/` normally register before Pets, and custom items are
loaded by then. The listener must be registered before Pets emits the event. A dependency that
delays the plugin until after Pets registers will miss it. A follower NPC of a plugin's own is a
custom definition registered under its own source,
`CacheDefinitions.registerCustomDefinitions(rows, "my-plugin")`, which the cache editor's
document doesn't replace. The cache editor rejects saves that claim an id owned by another source.
If a saved row conflicts at startup, the editor logs the conflict, skips that row, and keeps it on disk.
The client receives editor definitions first, then one packet per plugin source. Registration refuses
a source whose compressed definitions exceed the packet limit, leaving the previously registered rows intact.
