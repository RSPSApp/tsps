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

## Audio follow-up (#2417)

The follow-up keeps private synths and positioned area sounds distinct. Five public Pest Control
recordings (4014, 4025, 4028, 4029 and 4031) contain 454 own whip animations with 454 same-tick
private 2720 sounds and no area 2720. They also contain 290 nearby remote whip animations without
that sound. Ordinary attacks are therefore not blanket-broadcast to spectators. Recording 4014
also provides the positive contrast: a nearby player's claw special emits its four area sounds.

The recorded additions and corrections are:

| Action | Contract | Primary recording |
| --- | --- | --- |
| Vengeance |2907 at the caster, immediate, one play, area radius 10 | [1685](https://rsprox.net/download/1685) |
| Vengeance Other |2908 at the caster, not its recipient, immediate, area radius 10 | [2796](https://rsprox.net/download/2796) |
| Dark Bow normal and special observer release |3731 at the target, radius 10; exclude the archer, who retains the private launch | [2510](https://rsprox.net/download/2510), [273](https://rsprox.net/download/273) |
| Dark Bow dragon-special impacts | Two 3737 sounds at the launch target, queued at their respective projectile end cycles, radius 10 | [273](https://rsprox.net/download/273) |
| Scimitar-family Lunge | Private 2501 with sequence 386; the captured weapon is Arkanblade | [3151](https://rsprox.net/download/3151) |
| Dharok Smash | Private 1316 with sequence 2066; Chop remains 1321 | [1885](https://rsprox.net/download/1885) |
| Prayer activation | Existing supported prayers use their recorded private activation sounds, including the 15 previously missing mappings | [2990](https://rsprox.net/download/2990), [1091](https://rsprox.net/download/1091) |
| Prayer replacement and depletion | Replacing a conflicting prayer is quiet; natural shutdown one tick after zero sends one 2672, not one off sound per prayer | [2990](https://rsprox.net/download/2990), [3167](https://rsprox.net/download/3167) |
| Quick-prayer group | One 2663 on manual group-off; group-on plays each activated prayer's sound, with quiet preclear | [3277](https://rsprox.net/download/3277) |

The two combat-style sound fields are canonical server-owned metadata in
`server/data/definitions/item-combat-styles.json`. The cache dumper explicitly preserves these
fields while refreshing cache-owned style/slot/type data; they are not osrsreboxed-db output.
Two regeneration runs give identical content, and `yarn dump:item-combat-styles --check`
checks the full serialization without writing it.

### Positioned playback and listeners

The browser preserves positioned radius 0 as an area sound rather than turning it into a
full-volume private synth. Each queued source position is copied before onset delays or cache
retries, so later animation emitters cannot move an earlier sound. Server area sounds use the
native inclusive tile radius+1 admission check at receipt, after refreshing the current listener.
Admitted sounds still use the listener's playback-time position for Manhattan attenuation.
Sequence-frame admission is unchanged; no generic sound deduplication was added.

Entity-origin area sounds retain the entity's private-area identity. Other overlapping rooms,
public/private mismatches, other planes and distant recipients receive no packet. An explicit
bot area emitter still reaches human listeners, while bot recipients and an explicitly excluded
private-launch recipient are skipped. Absolute world-coordinate callers retain their existing
contract.

### Ordinary player hurt voices

The same five Pest Control recordings contain 68 ordinary positive local damage entries and 68
private hurt sounds from 518–521, with one play and 20 client cycles of delay. Their physical body
flag is 0; the later text-pronoun byte is a separate field. Two silent positive entries are poison,
not ordinary damage.

`PlayerHitSounds` uses the existing resolved-hit hook and each actual applied damage part.
For NPC attacks on an unmorphed body-type-0 player, ordinary positive health loss emits one
recorded variant per landed splat, including delayed and stalled parts. HP clamping, zero actual
loss, poison and reflected/direct status damage do not fabricate a hurt voice. Current body and
morph are checked again when the damage lands. The private recipient and bot suppression remain
unchanged.

Uniform choice among the four observed variants is an implementation inference: the recordings
prove variation, not its exact weights. Body-type-1, PvP and morphed-player mappings remain
unverified and keep the legacy fallback. No separate death sound is invented from an absent
producer: the checked normal-death recordings do not establish one. Zeal activation, non-dragon
Dark Bow impact audio and a replacement for the archer's ordinary private Dark Bow launch also
remain unverified.

### Validation scope

Actual Player/HitQueue and encoded-recipient tests cover damage timing, per-part callbacks,
room/exclusion boundaries, private synth preservation and refusal paths. Browser subscription
and mixer tests cover radius 0, loops, source identity through delay/retry, receipt edges and
moving listeners. Native/browser checks on owned worktree servers exercise both Vengeance
casts, normal/special Dark Bow, Lunge/Smash, prayer/quick-prayer/depletion, four claw area sounds
and a real NPC hit producing a private hurt voice. Observed playback buffers are nonempty and
nonzero with running AudioContexts. These are bounded interaction checks, not a full-game or
packet-for-packet audio parity claim; raw account-bearing models and media remain outside git.
