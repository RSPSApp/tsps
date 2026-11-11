# Kalphite Cave

The Slayer cave east of the Shantay Pass, entered through `slayer_kaphite_cave_entrance` (30180) at
(3319, 3121, 0). Its kalphites can only be killed on a Slayer task. It is not the Kalphite Lair
(the Queen's hive; [kalphite-queen.md](kalphite-queen.md)).

**Sources:**
- **rsprox captures:** recording 2922 (rev 230) enters the cave. No indexed recording uses the
  crevice out or attacks a kalphite in the cave.
- **The OSRS Wiki:** [Kalphite Cave](https://oldschool.runescape.wiki/w/Kalphite_Cave),
  [Entomologist](https://oldschool.runescape.wiki/w/Entomologist) and
  [Transcript:Entomologist](https://oldschool.runescape.wiki/w/Transcript:Entomologist).

## Way in and out

- **Enter** (captured, rec 2922) crawls in with `human_longcrawl` and sound 2495, and lands on
  (3305, 9497, 0) on tick 3. The multi icon comes on (`multiway_indicator` 0 -> 1). This was
  already in `plugins/world/data/loc-teleports.json`.
- **Out** is the Crevice `slayer_cave_passage_dark` (26712, "Use"), a wall at (3306, 9497, 0)
  beside the landing. It had no handler. Its loc-teleports entry lands on (3321, 3122, 0), beside
  the entrance, which is where the Shortest Path transports (`plugins/agent/data/transports.json`)
  put it. Ours: no capture exists, so no animation, sound or fade is played, and the move takes
  one tick.

## Buggie (task-only kalphites)

`server/plugins/areas/KalphiteCave.plugin.js` is an Area over x 3267-3340, y 9474-9542, plane 0.
These are the walkable tiles of the cache's map reachable from the landing. They hold all 43 cave
kalphite spawns (956, 958, 960), matching the Wiki's 18 workers, 20 soldiers and 5 guardians. The
Desert Mining Camp tunnels to the south (y 9469 and below) and the Elid cave exit (x 3347) are
outside it.

- **Multi-combat** (Wiki; the capture's multi icon): `isMulti()` is true.
- **Attacks** by a player whose task doesn't cover the target, as `slayer:on-task` answers, are
  refused. The Wiki says "upon attacking any monster inside the dungeon", so every NPC in the cave
  is covered. The only attackable ones there are the three kalphites.
- **The refusal** (Wiki): the game message `Buggie wants you to stick to your Slayer assignments.`
  and Buggie's line from the generated transcript (`npc-dialogue:start`, npc 491):
  - without a ghostspeak amulet: `wooooo ooo woo-woo`;
  - with one (552 or 4250): `I didn't... create this cave for... you to do that... sorry, it's not for you.`
- **Silent refusals:** as in the [Wyvern Cave](wyvern-cave.md), only the player's own attack
  shows the lines. Auto-retaliation and permission probes (cannon, target scans, agent
  `can_attack`) get `false` with nothing sent.

## Not covered

- Uncaptured: the refusal's order and timing, Buggie's chat head animation, and the name over his
  head. Ours: the message, then the line, on the click tick; the dialogue shows the cache name
  "Entomologist".
- Morytania legs 2+ as a ghostspeak amulet: the transcript names only the amulet.
- The crevice's animation and sound (see above).
