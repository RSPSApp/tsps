# Death Charge

Arceuus utility spell (80 Magic; death, blood and soul rune; 90 XP). Code:
`ArceuusSpells.startDeathCharge` / `useDeathCharge` (`ArceuusSpells.ts`), the kill hook in
`NPCDeathTask.ts`. Tests: `server/tests/magic-stance-bonuses.test.cjs`,
`server/tests/rite-of-vile-transference.test.cjs`.

## Confirmed behaviour

Live main-game cast and fade (rsprox recording 4102, revision 237), and recasts and kills (recording
3340, a Leagues world, whose base-spell responses are used here):

- The cast sets the cache varbits `arceuus_death_charge_cooldown` and `arceuus_death_charge_active`
  to 1 on the click tick, with the message "Upon the death of your next foe, some of your special
  attack energy will be restored." and the cast sound 5034.
- 100 ticks later (recording 4102: cast on tick 41, both varbits off on tick 141) the cooldown varbit
  ends. A charge no kill used ends in the same tick: `active` goes to 0 with "Your Death Charge has
  faded away." and sound 5056.
- A kill spends the charge: `active` goes to 0 with "Some of your special attack energy has been
  restored." (recording 3340). The cooldown varbit stays on until the 100 ticks are up.
- Casting again refuses with "You already have a Death Charge pending on you." while a charge is
  up, and with "You can only cast Death Charge every 60 seconds." once a kill spent it (recording
  3340).
- Wiki (Death Charge): 15% special energy once per cast, only when the creature dies within 16
  tiles of the caster; a full bar still spends the charge.
  <https://oldschool.runescape.wiki/w/Death_Charge>

## Rite of vile transference

`server/plugins/items/RiteOfVileTransference.plugin.js` (test:
`server/tests/rite-of-vile-transference.test.cjs`). Read, as in rsprox recording 3285 (revision 234)
ticks 6162-6178:

- An objectbox of the scroll: "You can make out some faded words on the ancient parchment. It
  appears to be a demonic learning on spell efficiency. Would you like to absorb its knowledge?"
- Then a chatmenu titled "This will consume the scroll." with "Upgrade Death Charge" (the spell's
  name in `7f0000`) and Cancel.
- Upgrade, the same tick: varbit `death_charge_scroll_used` 1, seq
  `qip_watchtower_read_scroll_and_stop`, spotanim `death_charge_upgrade_cast_spotanim` (3288) and
  synth 5034, both with delay 80, and the scroll leaves the inventory. Six ticks later an objectbox
  of the scroll: "You study the scroll and upgrade an Arceuus Spell: Death Charge".
- Recordings 787-792 send `death_charge_scroll_used` 1 at login; the plugin does the same.

The upgrade (Wiki: Death Charge, Rite of vile transference): a cast restores 15% special energy
from two kills instead of one, within the same 100-tick window, and the skull turns red. The cast
and kill graphics become the cache's `death_charge_upgrade_cast_spotanim` (3288) and
`death_charge_end_upgrade_spotanim` (3289). The `active` varbit stays at 1 until the second kill or
the fade. Yama's Dossier counts a read rite as owned, so it gives chasm teleport scrolls instead.

## Not covered

- The Wiki's list of creatures that never trigger it (Moons of Peril, Nightmare totems, ...), the
  16-tile rule's PvP and last-hitter cases.
- No recording casts the upgraded spell. Its cast and restore messages are the plain spell's, and
  `arceuus_death_charge_active` is 2 bits wide but is only ever sent as 0 or 1 here (Ours). The
  red-skull graphics are named by the cache, not recorded.
- Ours: reading a second rite once upgraded says the prayer scrolls' "nothing more for you to
  learn" line, with the rite's own wording.
- The message colour in recording 4102 is `a53fff` once and `6800bf` once; the server uses `a53fff`
  like its other game-message colours.
