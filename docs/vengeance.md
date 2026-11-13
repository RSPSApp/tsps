# Vengeance and Vengeance Other

Lunar spells that rebound 75% (rounded down, minimum 1) of the next hit taken. Vengeance is
cast in `EffectSpells.ts`, Vengeance Other in `LunarSpells.ts`; the rebound itself is
`CombatFactory.handleVengeance`.

## Sources

- OSRS Wiki: [Vengeance](https://oldschool.runescape.wiki/w/Vengeance),
  [Vengeance Other](https://oldschool.runescape.wiki/w/Vengeance_Other).
- rsprox captures of `magic_spellbook:vengeance` "Cast": recordings 820, 837, 1148, 1158, 1164,
  1168, 1179, 1196, 1197, 1235, 1239, 1245, 1247, 4119, 4120, 4126, 4127, 4129, 4131, 4134, 4140,
  4141 and 4143 (Leagues VI and Grid Master worlds), and 1074 (a main-game world, in a house).

## Behaviour

| | Live | Source |
| --- | --- | --- |
| Vengeance XP | 112 Magic XP | Wiki |
| Vengeance Other XP | 108 Magic XP | Wiki |
| Cooldown | 50 ticks (30 seconds), on the **caster**, shared by both spells | Wiki (Vengeance Other) |
| Cooldown refusal | `You can only cast vengeance spells every 30 seconds.` | recordings 1247, 4120, 4143 (rev 238, the number masked); Wiki gives 30 seconds |
| Successful Vengeance | no chat message; `vengeance_rebound` (varbit 2450) 0 -> 1 and `vengeance_timelimit` (varbit 2451) 0 -> 1 on the cast tick | every recording above except 1074 |
| Rebound fires | `vengeance_rebound` 1 -> 0 | recordings 820, 1148, 1179, 1197, 1239, 1245, 4120, 4127, 4134, 4140, 4141, 4143 |
| Vengeance Other target | `You have the power of vengeance!` | Wiki |
| In a player-owned house | `You can't use this spell inside a player-owned house.`; entering a house ends the effect | recording 1074, Wiki |
| Animation, graphic | `vengeance_spell_anim_nostalling` (8316), `quest_lunar_spellbook_vengeance_other_spot_anim` (726) | captures |
| Poison, venom, disease | do not trigger the rebound | Wiki |
| Rebound chat | the player says `Taste vengeance!` (lower-case v) | Wiki; recordings 1148, 1864 |
| Monsters immune to recoil (Nex, Vorkath, The Nightmare...) | take no rebound; Vengeance still goes off and is spent (`Taste vengeance!`, `vengeance_rebound` 1 -> 0) | Wiki (Category:Monsters immune to recoil: "recoil effects such as ring of recoil and vengeance"); recording 1148 (rev 237), where The Nightmare's 3 rebounds no 2, while a Kalphite's 4 in 1864 (rev 227) rebounds 3 |

## Not done yet

- Vengeance Other in a house or in a single-way Wilderness area is refused on live (Wiki), but
  no capture shows the refusal message.
