# Wyvern Cave

`server/plugins/areas/WyvernCave.plugin.js` is the northern, task-only cave on Fossil Island: Weve, at its exit, stops anyone without a Fossil Island wyvern Slayer task from attacking its wyverns. The southern cave (entrance south of the Museum Camp, landing at 3604, 10231) has no guard and is not an Area.

**Sources:**
- **rsprox captures** (rev 231, recordings 3038 and 3040): the refusal, on a spitting wyvern;
- **the OSRS Wiki:** "Fossil Island wyvern" (which cave Weve guards), "Weve", and the spitting, taloned, long-tailed and ancient wyvern pages.

## The guard (captured)
Attacking a wyvern in the northern cave without the task ends the attack on the arrival tick:
- the game message `Weve wants you to stick to your Slayer assignments.`;
- Weve's chat head (`fossil_slayerdungeonguard`, animation `chatang3`) with `Hey! Leave them alone! My dad Steve will beat you up unless a Slayer Master has given you special permission.`;
- the player's target is cleared; no attack, animation or hit of theirs follows.

The wyverns keep attacking a player the guard stopped, and the capture shows no further message or dialogue on their later attacks. Our choice, so those attacks do not repeat the lines every tick: a fight the server starts as auto-retaliation is refused silently, and only the player's own click shows them.

**What counts:** the four Fossil Island wyverns (Spitting, Taloned, Long-tailed, Ancient). A player on that task, or counted as on task by `slayer:on-task` (a league relic), may attack. Skeletal wyverns have their own task and cave, and the southern cave's wyverns can be attacked at any time (Wiki).

**Where:** the Area is the rectangle x 3580-3656, y 10246-10312, plane 0. Every wyvern the cache spawns from y 10246 north stands in it (Weve's own tile 3597, 10293 too), and none of the southern cave's, whose spawns end at y 10215. The north-west of the northern cave dips to y 10235 beside the southern cave's east lobe; that strip is left out. A player there is not in the Area, but the target's Area is asked too, so an attack on a wyvern inside the rectangle is still refused.

## Not covered
The wyverns' own attacks (the icy breath and its freeze, shield and Protect from Magic limits, the typeless ranged attack) are not implemented: the wyverns fight with the generic NPC attack. The Wiki gives the maxima and the freeze length, but neither it nor the captures give how often each attack is chosen.
