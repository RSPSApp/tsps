# Spawn integration

`Spawn.AdminPanel.js` is a plugin-owned adapter over the existing
`admin:testing-tools` custom event. The actor is always the destination, regardless
of the player currently selected in Player editor. Controller and Layout mount it
as the Spawn tab with NPCs and Items sub-tabs.

```js
const Spawn = require('./Spawn.AdminPanel');
Spawn.actions(); // ['Spawn 1 under me', 'Spawn X']
Spawn.status(api, actor); // {allowed: {npc, item}, spawned: <owned NPC count>}
Spawn.search(api, actor, 'npc', query); // Npcs.AdminPanel search records
Spawn.search(api, actor, 'item', query); // PlayerTools searchItems records
Spawn.apply(api, actor, {kind:'npc', id, count:1, random:false});
Spawn.apply(api, actor, {kind:'item', id, count, random:true});
Spawn.clearNpcs(api, actor); // {ok:true,message}
```

Tab 5 is Spawn with NPCs/Items sub-tabs and separate query/result state.
The returned NPC records contain `id,name,level,hp`; item records contain
`id,name,noted,stackable`. Continue using the native pictured row/preview renderer
and canonical item descriptions. Both selections use the same two action labels.
The first calls `apply` with count 1 and random false. The second opens the existing
amount prompt with the title `Spawn how many? (1-20)`, then calls `apply` with random
true. Results are synchronous `{ok:true,message,count}`; show the message through
the existing Admin status mechanism. Errors are `PlayerToolError` with status and
message. No player save or persistence flush is needed.

The delayed amount callback rechecks the panel session, selection identity,
current sub-tab and command access. Switching sub-tabs cancels an outstanding
prompt, clears results, rotates the authenticated search session and focuses the
new search. Clear my NPCs appears only for the NPC sub-tab when
`status.allowed.npc` is true. Generic server-driven tab transitions keep the old
view hidden until its authoritative layout commits.

NPC spawning still requires Owner/Developer and `::npc` permission. Ground-item
spawning requires Admin or above and `::item` permission. Both also require a live
actor, `::admin` access, the active world profile, an alive actor and no teleport
or shutdown in progress. The source event rechecks these gates for new placements.

`AdminCommands` accepts `placement:'under-actor'|'near-actor'` for `spawn-npcs` and
`spawn-items`. It does not accept coordinates. Existing NPC event callers that omit
placement retain their prior behavior. New floor spawns contain one item each;
Spawn X counts separate placements, rather than a stack amount. Native ground-item
ownership, reveal/despawn timing, instance handling and pickup remain intact.

Random spawn anchors are unique and within 10 tiles by native map distance. NPC
footprints are clear of static collision, internal walls, instance boundaries and
other footprints in that batch. A bounded flood of ordinary native movement steps
finds reachable tiles even when the actor has noclip. It allows local detours up
to 20 tiles from the actor. A route that requires a greater detour is conservatively
omitted. There is no automatic door opening or transport execution. The whole
placement plan is required before spawning, so insufficient room creates nothing.
Native world-slot exhaustion can still produce a partial NPC count, which is
reported explicitly by the original spawner.

NPCs remain in the original per-admin 100-spawn registry, have
`__skipDefaultRespawn`, and use the existing Clear/logout cleanup. No spawn
definition or player save is written. Item drops use the normal native floor-item
lifetime and are not persistent world spawns.

Validation uses `server/tests/admin-spawn.test.cjs` with real NPC and floor-item
registration, synthetic collision, instance bounds, command permissions and native
logout cleanup. Run alongside `admin-commands.test.cjs` and the parent Admin tests
with isolated persistence paths after building the server.
