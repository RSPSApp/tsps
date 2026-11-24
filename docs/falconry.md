# Falconry

Piscatoris falconry: Matthias lends a gyr falcon and falconer's glove, the player clicks a
kebbit, and the falcon holds the catch until it is retrieved. The code is
`server/plugins/skills/hunter/Catching.Hunter.js` (`catchFalcon`, `collect`, `retrieve`,
`process`) with the kebbit table in `Data.Hunter.js`; its test is the falconry part of
`server/tests/skill-max-level.test.cjs`.

Recordings 948 and 3414 (rev 235) contain Matthias and the perches; 3414 also has the falconers'
own flights. rev 242 recordings 911955 and 911946 show other players' falcons flying at kebbits;
every sender in them is out of view, so no recording shows the launch graphic on a player. The
flight numbers below come from those recordings; the rest follows the OSRS Wiki, fetched for
this change:

- [Falconry](https://oldschool.runescape.wiki/w/Falconry): after a catch the player retrieves
  the falcon and the drops. "Excess resources are discarded rather than dropped" (a full
  inventory no longer stops the retrieval), and a bonecrusher kept in the inventory buries the
  bones on retrieval. If the falcon isn't retrieved in time the game says "Your falcon has left
  its prey. You see it heading back toward the falconer." and the lost prey gives no XP.
- [Spotted kebbit](https://oldschool.runescape.wiki/w/Spotted_kebbit) and
  [Dashing kebbit](https://oldschool.runescape.wiki/w/Dashing_kebbit): bones and fur always; the
  dashing kebbit also drops a raw dashing kebbit. Catch rates (about 55.9% at level 69 for the
  dashing kebbit, 80% at 99) already match `Context.Hunter.probability`.

## What the server does

| Case | Behaviour |
| --- | --- |
| Retrieve with a full inventory | The falcon is retrieved and the Hunter XP is given; items that don't fit are discarded, nothing lands on the floor |
| Dashing kebbit | Bones, dashing kebbit fur and a raw dashing kebbit |
| Spotted and dark kebbit | Bones and fur |
| Bonecrusher | The bones go through `npc-drops:generated` like a kill's, so an active, charged bonecrusher crushes them for Prayer XP and they never reach the inventory |
| Sending the falcon | The player launches with spotanim 918 (height 150) and `falcon_travel_anim` 922 flies to the kebbit, locked on to it: start cycle 24, 8 cycles per tile, start height 150, end height 5, angle 10, progress 64. The catch resolves on tick `max(1, floor((24 + 8 * tiles) / 30))` (1 tile 1, 7 tiles 2), the hit is spotanim 923 on the kebbit delayed to the projectile's end, and the falcon NPC shows once the 26-cycle `falcon_hit` has played, 1 to 2 ticks after the catch message. Sources: rsprox_transcripts/242/911955.txt:1857-1860 (7 tiles, end cycle 80, hit delay 80) and 911946.txt:244382 (1 tile, end cycle 32), and rsprox_transcripts/235/03414.txt:13009-13015 (the falconers' 918 at height 150 and 927 landing with a delay equal to the projectile's end) |
| Unretrieved falcon | After 100 ticks the falcon leaves with the message above, no XP, and the glove shows the falcon back on it |

## Not done

- **Fur and meat pouches** (the Wiki says open ones collect the fur and the raw dashing kebbit):
  the pouches don't exist in this server.
- **Kebbity tuft** during a Hunter Rumour: the Rumours module owns it.
- **Matthias' 500,000 coin investment** that makes falcons free: it needs the dialogue, which
  nothing captured shows.
- **Sending the falcon while moving** (Wiki, 2026 update): the flight time now follows the
  recordings above, but the player still has to stand still while the falcon flies (the action
  cancels on a step); the Wiki says movement is allowed.
- **The launch graphic on a player:** no recording shows a player sending a falcon, so the 918
  on the player at height 150 is taken from the falconers in rsprox_transcripts/235/03414.txt.
  The hit's height on the kebbit is left at the default; the cited lines don't show it.
- **The hint arrow** the Wiki describes over the falcon with its catch.
