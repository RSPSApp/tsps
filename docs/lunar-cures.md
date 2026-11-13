# Lunar cures: Cure Me, Cure Other, Cure Group

`server/plugins/combat/LunarCures.plugin.js` casts the three Lunar poison cures. They remove poison, turn venom
into poison (5 x its last hit - 4, as an antipoison does) and give no immunity (Wiki: Cure Me, Cure Other,
Cure Group).

## From rsprox captures

- **Cure Me** (rec 820, rev 234, 8 casts on poison): at the click the caster plays
  `quest_lunar_pushing_magic_animation` with spotanim `quest_lunar_cure_me_spot` at height 92, synth 2884, the
  game message `Your poison has been cured.`, and varp `poison` goes to 0.
- **Cure Group with no one to cure** (rec 820 tick 5192): the caster was not poisoned and two players beside them
  had Accept Aid off. The server sent `That spell cannot be cast on <name> as they are not accepting aid.` for each of
  them, then `No-one around you with Accept Aid on needs their poison healing.`. Nothing was cast: no animation,
  runes or XP.

## Ours

- Cure Me on venom or with no poison sends no line. Only the poison cure is recorded.
- A Cure Group that goes ahead names no refusing players. Only the refusal is recorded.
- Cure Other and Cure Group keep the summon animation (4413) and graphic 747, and play no sound. No capture shows
  a successful cast.
