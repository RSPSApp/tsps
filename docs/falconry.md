# Falconry

Piscatoris falconry: Matthias lends a gyr falcon and falconer's glove, the player clicks a
kebbit, and the falcon holds the catch until it is retrieved. The code is
`server/plugins/skills/hunter/Catching.Hunter.js` (`catchFalcon`, `collect`, `retrieve`,
`process`) with the kebbit table in `Data.Hunter.js`; its test is the falconry part of
`server/tests/skill-max-level.test.cjs`.

No rsprox recording shows a falconry catch or retrieval: recordings 948 and 3414 (rev 235) only
contain Matthias and the perches, with no player action on them. Everything below follows the
OSRS Wiki, fetched for this change:

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
| Unretrieved falcon | After 100 ticks the falcon leaves with the message above, no XP, and the glove shows the falcon back on it |

## Not done

- **Fur and meat pouches** (the Wiki says open ones collect the fur and the raw dashing kebbit):
  the pouches don't exist in this server.
- **Kebbity tuft** during a Hunter Rumour: the Rumours module owns it.
- **Matthias' 500,000 coin investment** that makes falcons free: it needs the dialogue, which
  nothing captured shows.
- **Sending the falcon while moving** (Wiki, 2026 update): the flight time that replaced the
  stand-still wait isn't documented, so the two-tick stand-still is unchanged.
