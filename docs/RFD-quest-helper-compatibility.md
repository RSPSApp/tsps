# Recipe for Disaster helper compatibility

The native adapter reads the implementation in
`server/plugins/quests/quests/RecipeForDisaster.Quest.js`. It never changes game
state. The RuneLite helpers remain available in the Java source, but their
instanced council coordinates and native conversation stages do not match this
server. In particular, the server council is at Lumbridge Castle (3236–3240,
3219–3220), and several conversation phases have no persisted native equivalent.

Implementation plan:

1. Add failing fixtures using the actual server identifier tables and read-only
   player doubles. Cover all 256 rescue masks, opening eligibility, every route,
   each persisted substate, inventory recipes, and finale waves.
2. Implement `createRfdRenderer({core, getQuests})`, returning
   `rfdResult(request, player)`. Use only explicitly owned attributes and actual
   server containers, skills, location, and registered quest handles.
3. Select concrete instructions and targets from the server's action handlers.
   Where conversation history is not persisted, direct the player to the actual
   NPC to continue; do not invent a native stage. Retain known ingredient,
   equipment, quest, and skill checks in the response.
4. Run the focused tests and existing helper transport/runtime checks. The parent
   task wires this renderer into Runtime; no Java repackaging is required.

The response uses protocol 1 and `sourceCommit: tsps-native-rfd-v1`. Missing or
unknown required state produces a named diagnostic. No client-provided attribute
name is read. Evil Dave's hidden randomized recipe is not exposed: instructions
use his taste feedback and the player's known stew doses. Recreating a renderer
or reconnecting does not lose progress because the adapter has no session memory.

## Integration

`createRfdRenderer({core, getQuests})` returns `(request, player) => response`.
`getQuests()` is called during each evaluation, so constructing the renderer
before quest registration finishes is supported. Only dispatch RFD requests to
this renderer. Other quests retain their existing route.

`completionProjection(player)` returns a flat varbit map. Merge it into the
authoritative snapshot through the existing varbit/packed-varp synchronization:

| Rescue bit | Completed component | Varbit | Native completed value |
| ---: | --- | ---: | ---: |
| 1 | Mountain Dwarf | 1892 | 60 |
| 2 | Goblin generals | 1867 | 40 |
| 4 | Pirate Pete | 1895 | 110 |
| 8 | Lumbridge Guide | 1896 | 5 |
| 16 | Evil Dave | 1878 | 5 |
| 32 | Skrach Uglogwee | 1904 | 170 |
| 64 | Sir Amik Varze | 1910 | 20 |
| 128 | King Awowogei | 1914 | 50 |

These thresholds come from the pinned upstream component helpers' `getState`
and `isCompleted` methods. Unfinished component varbits are omitted. Main varbit
1850 maps canonical stage 0→0, 1→1, 4→3 while rescues remain, 4→4 when all eight
are rescued, and completed stage ≥5→5. Unimplemented canonical stages 2/3 are
omitted rather than assigned invented native progress. The exact canonical stage
attribute is `quest.recipe_for_disaster.stage`, as defined by QuestRuntime.

This completion-only projection deliberately does not reconstruct intermediate
native states. In particular, PacketSender's spell-unlock bootstrap sets 1914
to 50 independently of rescue progress. The native RFD adapter always uses the
authoritative rescue bit, so that client spell flag cannot complete its route.

## Validation

Run from `server/`:

```
node --test tests/quest-helper-rfd.test.cjs tests/quest-helper-runtime.test.cjs tests/quest-helper-transport.test.cjs
```

The RFD suite has 24 passing tests, including all 256 independent rescue masks,
all 256 completion projections, every persisted substate family, six finale
waves, actual identifier-table integrity, item recipes and equipped forms,
reconnection determinism, deferred quest registration, and all 28 Traiborn quiz
answers checked against the server source. Combined helper checks: 34 passing.
These fixtures establish route behavior; they do not assert that every route
has been played through live.
