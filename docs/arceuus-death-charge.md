# Death Charge

Arceuus utility spell (80 Magic; death, blood and soul rune; 90 XP). Code:
`ArceuusSpells.startDeathCharge` / `useDeathCharge` (`ArceuusSpells.ts`), the kill hook in
`NPCDeathTask.ts`. Test: `server/tests/magic-stance-bonuses.test.cjs`.

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

## Not covered

- The Wiki's list of creatures that never trigger it (Moons of Peril, Nightmare totems, ...), the
  16-tile rule's PvP and last-hitter cases, and the Rite of vile transference upgrade.
- The message colour in recording 4102 is `a53fff` once and `6800bf` once; the server uses `a53fff`
  like its other game-message colours.
