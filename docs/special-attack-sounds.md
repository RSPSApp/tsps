# Special attack sounds

Issue #1744 reported the wrong sound on special attacks (Armadyl godsword and dragon claws
first). This is the audit behind the fix: what the specials sent, what live sends, and where
each value comes from.

Two sources agree on the ids:

- **OSRS Wiki**: each weapon's "Sound effects" table names the synth (`godwars_godsword_special_attack`,
  `dragonclaws_special_1`, ...). When a page has no table, its special attack's name matches the
  synth's name (`Sever` / `sever`, `Powershot` / `powershot`, `Sanctuary` / `sanctuary`).
- **RSProx**: the rev-241 gameval sound list gives the id for every synth name, and recorded
  sessions show the packet shape and delays. Captures are transcribed with the RSProx
  `TranscribeCommand`; the recording number is cited per row.

## Changed

`before` is the sound the plugin sent at activation; `after` is what it now sends. Area sounds
are positional at the attacker, as in the capture; synth sounds are private to the attacker.
Delays are client cycles (20 ms).

| Weapon | Before | After | Evidence |
| --- | --- | --- | --- |
| Armadyl / Bandos / Saradomin / Zamorak / Ancient godsword | 3847 (`godwars_godsword_slash`, the normal attack) | 3869 area | Wiki tables for the four godswords; the ancient godsword has no table of its own and uses the same `godwars_godsword_special_attack` |
| Dragon claws | 2500 (`hacksword_slash`, the normal attack) | 4138 @10, 4140 @30, 4141 @42, 4141 @60, all area | Wiki Dragon claws; RSProx 4014 gives exactly these four area sounds |
| Burning claws | 2500 (inherited normal attack) | 9316 @29, 9316 @60, synth | Wiki Burning claws; RSProx 3327 |
| Rune claws | 2500 (inherited normal attack) | 2534 area | Wiki Rune claws (`Impale.wav`); RSProx `impale` |
| Dragon scimitar | 2500 (normal attack) | 2540 synth | Special is `Sever`; RSProx `sever` and 4152 |
| Dragon halberd | 2548 (`stabsword_slash`, the normal attack) | 2533 area | Special is `Sweep`; RSProx `halberd_swipe` |
| Dragon warhammer | 2567 (`warhammer_crush`, the normal attack) | 2520 area | Wiki Dragon warhammer (`tzhaar_ket_om_crush`) |
| Statius's warhammer (both) | 2567 (normal attack) | 2520 area | Same `Smash` special as the dragon warhammer |
| Granite maul | 2567 (normal attack) | 2715 synth | Wiki Granite maul (`quicksmash`); RSProx 3142 |
| Abyssal bludgeon | 2567 (normal attack) | 2715 area | Wiki Abyssal bludgeon (`quicksmash`) |
| Abyssal tentacle | 2720 (`WEAPON_WHIP`, the normal attack) | 2713 synth | Wiki Abyssal tentacle (`energydrain`, the same as the whip) |
| Barrelchest anchor | normal attack | 3481 area | Wiki Barrelchest anchor (`anchor_sunder`); RSProx 3951 |
| Brine sabre | 2500 (inherited normal attack) | 3473 synth | Wiki Brine sabre (`brain_special_brine_saber`) |
| Magic longbow | 2700 (`SHOOT_BOW_QUIET`) | 2536 synth | Special is `Powershot`; RSProx `powershot` |
| Seercull | 2702 (`SHOOT_ARROW`) | 2546 synth | Special is `Soulshot`; RSProx `soulshot` |
| Excalibur | nothing | 2539 synth | Special is `Sanctuary`; RSProx `sanctuary` |
| Armadyl crossbow | 2695 (`SHOOT_CROSSBOW`) | 3892 area @15, radius 1 | Wiki Armadyl crossbow; RSProx 3277 |
| Toxic blowpipe | 2696 (`THROW_DART`) only | 2696, then 800 @32 | Wiki Toxic blowpipe (`snake_hit`); RSProx 4121 |
| Dark bow | 2700 (`SHOOT_BOW_QUIET`) | 3731, then 3733 for dragon arrows / 3736 otherwise | Wiki Dark bow; RSProx 273 (dragon arrows: 3731 + 3733, impacts 3737) |
| Emberlight | 2500 (inherited normal attack) | 9319 @11, 9320 @28, 9321 @53 | Wiki Emberlight; RSProx 3333 |
| Voidwaker | 2500 (inherited normal attack) | 5027, then 6182 @30 | Wiki Voidwaker (demonbane cast + wardens' thunder); RSProx 1698 |

`RangedCombatMethod` gained a `fireSound()` hook so the magic longbow and Seercull can replace
the normal bow shot sound without duplicating the ranged start sequence.

## Checked and left alone

These specials already sent their own correct sound, confirmed against the same sources:

- Dragon dagger 2537, dragon longsword 2529, dragon mace 2541, dragon battleaxe 2538,
  dragon spear / Shove 2544, dragon axe 2531, magic shortbow 2545.
- Abyssal whip 2713.
- Rune thrownaxe 2528 (`chainshot`).

The remaining specials have no distinct sound in the Wiki's tables and no RSProx gameval name
that matches their special, so they keep the normal weapon sound:

- Dragon 2h sword (`Powerstab`), dragon sword (`Wild Stab`), dragon hasta (`Unleash`),
  dragon thrownaxe (`Momentum Throw`), ancient mace (`Favour of the War God`), Saradomin sword,
  staff of light (`Power of Death`), granite hammer (`Hammer Blow`).

## Still unverified

The Wiki names sounds for these, but no player capture was found, so the timing is unknown and
they were not changed:

- Noxious halberd: 9403 (buildup) and 9404 (impact) for Virulence.
- Osmumten's fang: 9367 / 9366 / 9365 for the three parts of Eviscerate.
- Tonalztics of Ralos: 7942 (throw) and 7943 (spin).

A capture of one activation would settle each: the sound packets carry the delays directly.
