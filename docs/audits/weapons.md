# Weapon attack animations and stats audit

Audit of every weapon the server can attack with, against the OSRS Wiki's equipment-stat table
and the cache's animation data. Branch: `audit/weapon-attack-animations-stats`, based on
`origin/main` (`3c39bb065`), 2 November 2026.

The machine-readable results are next to this file:

- [`weapon-census.csv`](weapon-census.csv) - one row for every audited weapon: its type, the
  Wiki's combat style and stat row, the server's 14 bonuses beside the Wiki's, the server's,
  cache's and Wiki's attack speed and range, two-handedness, the resolved attack animation of
  every style (with the cache's gameval name), and any finding.
- [`weapon-census-findings.csv`](weapon-census-findings.csv) - the 111 rows with a finding.

Both files are the output of a read-only audit run: cache definitions read through the server's own
`ItemDefinition`/`CacheDefinitions` and `WeaponProfiles`, joined to the two committed dumps below.
The runner was a local one-off and is not part of this branch, so the CSVs cannot be regenerated
from the repository alone - [Method](#method) records exactly what each check does.

The audit reads two dumps from [RSPSApp/osrsreboxed-db](https://github.com/RSPSApp/osrsreboxed-db),
imported into `server/data/definitions/` and never edited here:

- `weapon-stats.json`: the Wiki's equipment-stat rows for the weapon and two-handed slots, by
  item id (1,273 items from 5,427 stat rows and 16,947 item pages);
- `sequence-names.json`: RuneLite's gameval sequence names for cache revision 241 (15,160),
  with its license in `sequence-names.LICENSE`.

Regenerate them there and copy them over:

```bash
cd ../osrsreboxed-db
python -m scripts.weapons.update      # docs/weapon-stats.json
python -m scripts.sequences.update    # docs/sequence-names.json, docs/sequence-names.LICENSE
cp docs/weapon-stats.json docs/sequence-names.json docs/sequence-names.LICENSE \
  ../tsps/server/data/definitions/
```

After a cache bump, pass the new revision's RuneLite gameval commit to
`scripts.sequences.update --ref`. See [Method](#method).

## Scope

| Measure | Count |
| --- | ---: |
| Cache items worn in the weapon slot (no notes or placeholders) | 1,868 |
| - with an attack speed in the cache: the audited weapons | **1,080** |
| - held props and novelty items without one (excluded) | 788 |
| Audited weapons with a weapon type | 1,068 |
| - without one (listed in `tests/weapon-data.test.cjs`) | 12 |

The 1,080 are the weapons the server can attack with: `ItemDefinition.ATTACK_SPEED_PARAM` (14)
is present, which is also the predicate `tests/weapon-data.test.cjs` uses. A weapon-slot item
without it has no attack rate and is not a weapon (a banner held as a prop, a rake, a
"Nothing").

The 12 untyped are the documented exceptions in [weapon-data.md](../weapon-data.md): Nature's
reprisal (multi-style, which the combat engine cannot swap yet), the broken axes, the Teasing
stick and Arrav's axe.

## Method

Three sources, in the order the server itself uses them:

1. **The cache (revision 241).** The 14 equipment bonuses come from item stat params, attack
   speed from param 14 and range from param 13, two-handedness from `wearPos2`, and dbtable 78
   supplies each weapon category's styles. The audit reads these through the same
   `ItemDefinition`/`CacheDefinitions` the server runs on, after
   `ItemDefinitionLoader.plugin` overlays `item-gameplay.json` (weapon type, per-item
   `attackAnim`, stance animations).
2. **The server's resolution.** Attack speed, reach and animation are resolved with
   `WeaponProfiles.attackSpeed` / `meleeAttackDistance` / `attackDistance` / `attackAnimation`
   against a stand-in player, so a profile override is measured, not inferred.
3. **The OSRS Wiki.** `bucket('infobox_bonuses')` for the 14 bonuses, slot, attack speed, attack
   range and combat style, joined to item ids through `bucket('infobox_item')`, as dumped by
   osrsreboxed-db into `weapon-stats.json`. The Wiki does **not** publish attack animation ids,
   so the animation half is checked structurally (below) and the ids are named from
   `sequence-names.json`, RuneLite's gameval `AnimationID.java`, which is the game's own
   sequence names for the same cache revision (`HUMAN_SWORD_SLASH = 390`, ...).

An animation check has four parts:

- every weapon resolves a non-zero animation for every style it has, and every such id exists
  in the cache's `seq` archive;
- the styles come from the weapon's type, and the type's cache category is the one the Wiki's
  combat style maps to (this is what `sync-weapon-types` maintains): 0 mismatches;
- a type may not animate with a **combat-tab icon id**: dbtable 78's fourth column is the style
  icon sprite, not a sequence, and three types had those copied into `animation`;
- each type's animation names should belong to its own family. The
  [table below](#types-and-their-animations) is the review of all 50 live types.

## Findings

| Finding | Weapons |
| --- | ---: |
| Attack animation fixed (six types) | 47 in the types; 39 resolve differently |
| Attack speed fixed (stale profile overrides) | 4 |
| Bonuses differ from the Wiki while matching the cache | 40 |
| Attack speed differs (cache and Wiki disagree) | 12 |
| Attack range differs (cache and Wiki disagree) | 5 |
| Two-handedness differs (cache and Wiki disagree) | 2 |
| No Wiki stat row (unobtainable, beta, rotten, shop-only variants) | 30 |
| Per-item animation overrides, documented and left alone | 27 |
| Powered staves with no item animation (spells cast) | 42 |

### 1. Fixed: six weapon types animated by the wrong thing

dbtable 78 stores four values per style: slot, name, description and a **combat-tab icon**
sprite id. The partisan, banner and polestaff rows had that icon id in `animation`, so a Keris
partisan attacked with `rat_attack`, a Guthix mjolnir with `skeleton_trans_block` and a banner
with `sheep_attack`. Three more types used another weapon's animation. All six are now the
weapon's own family:

| Type | Was | Now | Evidence |
| --- | --- | --- | --- |
| `PARTISAN` (5) | 240 `rat_attack`, 239 `rat_walk`, 238 `penguin_block`, 237 `penguin_attack` | 2080, 2080, 2082, 2080 `barrows_war_spear_stab` / `_crush` | The type's sounds are `WEAPON_SPEAR_*`; a partisan is a spear, and the spear type uses 2080-2082 |
| `BANNER` (0) | 241 `rat_block`, 251 `sheep_block`, 242 `rat_ready`, 250 `sheep_attack` | 1428, 1428, 1428, 1429 `human_banner_spike` / `human_banner_block` | The cache has the banners' own animations |
| `POLESTAFF` (17) | 266 `skeleton_trans_block`, 267 `skeleton_trans_ready`, 252 `sheep_ready` | 401 `human_blunt_pound` (all three) | No polestaff animation exists; the mace and warhammer (same crush styles) use 401 |
| `ABYSSAL_BLUDGEON` (1) | 7054 `dh_sword_update_smash` (a godsword's) | 3298 `abyssal_bludgeon_crush` | The cache has the bludgeon's own crush |
| `CLAWS` (15) | 393 `human_axe_chop` (all four) | 7527 `dclaws_human_attack` (all four) | The cache has the human claws' attack |
| `SCYTHE` (9) | 414 `human_staff_pummel`, 382 `human_dspear_lunge`, 2066 `barrow_dharok_slash` | 440 `human_scythe_sweep` (all four) | The cache has the scythe's sweep. The Scythe of Vitur and its variants carry their own 8056 and are unaffected |

The audit's icon check found exactly these three types using a style icon as an animation; the
new `no weapon type attacks with a combat-tab icon id` test keeps it that way. The banner type
has no weapons today; it is fixed so a future banner does not inherit the bug.

### 2. Fixed: two stale attack-speed overrides

| Weapon | Server was | Cache | Wiki |
| --- | ---: | ---: | ---: |
| Opal, jade and red topaz machete (6313, 6315, 6317) | 5 | 4 | 4 |
| Twisted bow (20997) | 5 | 6 | 6 |

`WeaponProfile.ts` had a "machetes, sickles and canes swing one tick slower" block that put the
gem machetes a tick slow; every other item in it already carried the same value in the cache, so
the whole block was removed and all 11 take the cache's speed. The Twisted bow's per-item
`attackSpeed: 5` was removed for the same reason (the cache and the Wiki's infobox and
`{{CombatStyles}}` call all say 6); its animation, projectiles and launch sound stay.

### 3. Bonuses: 40 weapons differ from the Wiki, all from the cache

Every one of the 40 is cache-sourced (`hasCacheBonuses()`); the server's `item-gameplay.json`
fallback is not involved. `docs/weapon-data.md` deliberately makes the cache's stat params
authoritative, and the repo forbids a per-item override layer (`server/AGENTS.md` rule 13), so
these are differences between the cache and the Wiki, not between the server and the cache.
They fall into four groups.

**The Wiki row is a different version of the item (9).** The page's own sub-row is for the
charged/active/ornamented variant; the cache entry is the base one, and the server reads the
cache.

| Id | Weapon | Difference |
| ---: | --- | --- |
| 23985 | Crystal bow (inactive) | Wiki page is `#Active`: 0/0 vs 100 ranged, 78 ranged strength |
| 23989 | Crystal halberd (inactive) | Wiki page is `#Active`: all 0 vs the charged values |
| 12924 | Toxic blowpipe (empty) | 20 ranged strength vs 0 |
| 28687 | Blazing blowpipe (empty) | 20 ranged strength vs 0 |
| 30373 | Drygore blowpipe (empty) | 10 ranged strength vs 0 |
| 30392 | Nature's reprisal (uncharged) | 0 vs 95/45/155/103/92 (the Wiki's uncharged row keeps them) |
| 28543, 28545 | Corrupted Scythe of Vitur | Cache is buffed against the Wiki's charged/uncharged rows |
| 12796 | Mystic steam staff | matched the Wiki's `(or)` page (astab 10 vs 7); the base page has the cache's 10 |

**Buffed event variants (7).** Last Man Standing and Deadman "corrupted" copies carry the
event's stronger stats in the cache; the Wiki pages list the main-game ones.

| Id | Weapon | Difference |
| ---: | --- | --- |
| 23628 | Ghrazi rapier (Last Man Standing) | stab 100 vs 94, strength 93 vs 89 |
| 27198 | Inquisitor's mace (Last Man Standing) | crush 102 vs 95, strength 96 vs 89 |
| 28531 | Corrupted voidwaker | stab 70/56, slash 80/64, magic 5/4, strength 68/64 |
| 28534 | Corrupted dragon claws | stab 41/33, slash 57/46, dstab 13/11, dslash 26/21, dcrush 7/6 |
| 28537 | Corrupted armadyl godsword | slash 132/106, crush 80/64, strength 112/106 |
| 28540 | Corrupted twisted bow | ranged 70/56, ranged strength 5/2 |
| 29599 | Corrupted dark bow | ranged 89/95 (the cache is *lower* here) |

**The cache omits a small non-zero bonus (7).** The cache stores only the params it needs, and
the reader treats a missing param as 0; on these seven the Wiki has a value the cache entry does
not carry.

| Id | Weapon | Difference |
| ---: | --- | --- |
| 21205 | Elder maul | magic attack 0 vs -4 |
| 22542, 22545 | Viggora's chainmace (u / charged) | slash defence 0 vs 1 |
| 27657, 27660 | Ursine chainmace (u / charged) | slash defence 1 vs 0 |
| 33249 | Fang of the hound | magic defence 3 vs 0 |
| 34727 | Zorya's tome (uncharged) | prayer 0 vs 2 |

**Plain differences (17).** Ordinary items where the cache's numbers and the Wiki's disagree.
These are the ones worth reporting upstream (a cache or Wiki error, not a server decision).

| Id | Weapon | Difference |
| ---: | --- | --- |
| 494-506, 6741 | Broken axes (bronze to dragon) | the cache keeps the unbroken axe's bonuses; the Wiki lists 0 |
| 26511, 26513, 26515 | Shattered relics trophies | -100/-100/-50/-10, the Wiki lists 0 (its speedrun trophies do list -100) |
| 3194 | Steel halberd | slash defence 2 vs 1, crush defence 3 vs 2 |
| 7439 | Spatula | strength 22 vs 26 |
| 28205 | Black felling axe | stab -3/-2, slash 16/10, crush 12/8, strength 19/12 |
| 30340 | Crystal dagger (perfected) | slash 120 vs 140 |
| 30390 | Nature's reprisal | magic damage 12.5% vs 12% (the cache stores tenths: 125) |
| 30891 | Keris partisan of amascut | stab 58 vs 108, strength 45 vs 67 - see below |

`30891` is the Wiki's **inside-ToA** row. The cache holds the outside-Tombs of Amascut values
(58/45), which the Wiki also lists as `#Outside ToA`, so the outside stats are correct. The
inside-ToA boost (+108 stab / +67 strength) is not implemented anywhere in
`plugins/minigames/toa`, so the partisan is weaker inside the raid than live OSRS. That is
content work, not a data fix, and is left open here.

The `23985`/`23989` and `12796` rows are join artifacts rather than data (see the first group);
the CSV keeps them so the numbers are traceable.

### 4. Attack speed, range and two-handedness

These are the remaining non-bonus differences. Every weapon's speed now equals the cache's, so
all twelve are cache-versus-Wiki.

| Id | Weapon | Server (cache) | Wiki |
| ---: | --- | ---: | ---: |
| 6760, 6762, 6764 | Guthix / Saradomin / Zamorak mjolnir | 5 | 6 |
| 10858 | Shadow sword | 7 | 6 |
| 13142 | Western banner 2 | 6 | 5 |
| 22335 | Starter staff | 5 | 4 |
| 27414 | Giant stopwatch | 6 | 4 |
| 27676, 27679, 27785, 27788 | Accursed / Thammaron's sceptre (a), (au) | 4 | 5 |
| 29599 | Corrupted dark bow | 7 | 6 |

The sceptre `(a)` and `(au)` pages list 5 where the plain wand page lists 4; the cache says 4
throughout, so the plain page agrees with the cache.

| Id | Weapon | Server (cache) | Wiki | Note |
| ---: | --- | ---: | ---: | --- |
| 28773 | Sage's axe | 5 | 6 | plain difference |
| 29000, 29851 | Eclipse atlatl | 6 | 5 | the Wiki's infobox says 5 but its own `{{CombatStyles}}` says 6; the cache says 6 |
| 33178 | Noxious halberd | 2 | 1 | halberds reach 2 by design (docs/weapon-data.md) |
| 33253 | Shadowflame quadrant | 1 | 8 | the Wiki lists a spell's reach; the item's melee reach is 1 |

| Id | Weapon | Server (cache) | Wiki |
| ---: | --- | --- | --- |
| 27418, 27420 | Bronze / Silver speedrun trophy | one-handed (cache `wearPos2`) | 2h |

### 5. Weapons the Wiki has no stats for (30)

Their pages are unobtainable, beta or event-only versions with no equipment-stat table, or the
id is only listed with a `hist`/`beta` prefix (a different cache revision's item). No action:
there is nothing to compare against.

`1235 Poisoned dagger(p)`, `4159 Leaf-bladed spear`, `5684 Poison dagger(p+)`, `5702 Poison
dagger(p++)`, `7804 Ancient mjolnir`, `10029 Teasing stick`, `11165`/`11167 Phoenix crossbow`,
`20401 Yew shortbow`, `20402 Rune scimitar`, `20403 Maple shortbow`, `20552 Rune battleaxe`,
`20554 Toktz-xil-ak`, `20555 Rune 2h sword`, `20558 Magic shortbow`, `20559 Dragon 2h sword`,
`20785 Dragon warhammer`, `21206 Dragon sword`, `21207 Dragon thrownaxe`, `25484 Soulreaper axe`
(the beta copy; 28338 is live), `25489`-`25492 Ancient sceptres`, `28555`/`28557`/`28559`
Starter bow/staff/sword, `30320 Arrav's axe`, `31133 Venator bow (rotten)`, `33434 Uncharged
trident (o)`.

`20401`-`21207` are the 2021-2022 event/LMS shop copies; the Wiki files them under the main
item's page, whose item id is the main-game one.

### 6. Left alone, with reasons

- **Per-item animation overrides (27 weapons).** The Scythe of Vitur and its seven variants,
  Osmumten's fang and its copies, the Venator bows, Wolfbane, the black chinchompa, the goblin
  paint cannon, the Blisterwood flail, the Soulreaper axes, the Zombie axe, the Sunlight spear,
  the Morrigan's javelins, the Blisterwood stake and the Ascension crossbows. Each is a
  deliberate per-item `attackAnim` or profile, most with an RSProx capture recorded in
  [weapon-data.md](../weapon-data.md); the CSV lists the animation each resolves to. None of
  them is a type animation and none is an icon id.
- **Powered staves (42 weapons).** Their styles carry animation 0 on purpose: they attack with
  spells, and the spell supplies the cast animation. They are the only 126 zero-animation style
  rows in the audit.
- **`STAFF` and `BLADED_STAFF`.** Bash/Jab use 401 (`human_blunt_pound`); Pound/Swipe/Fend use
  406 (`human_dhsword_chop`). The bladed staffs keeping 401/406 is recorded in weapon-data.md as
  having no capture; the staffs share the row. The cache has `human_staff_pound` (413),
  `human_staff_pummel` (414) and `human_staff_block` (415), which look like the better family,
  but no capture or Wiki id supports the change, so it is left as a question, not a guess.
- **`VERACS_FLAIL`** uses 1658, the abyssal whip's attack. A flail and a whip swing the same way,
  and there is no Verac's flail sequence in the cache; unverified either way.
- **`SWORD`, `FANG` and `LONGSWORD` Lunge** use 412 (`human_staff_spike`), where the daggers and
  the scimitar's Lunge use 386 (`human_sword_stab`). Long-standing data with no capture either
  way; flagged for a future recording rather than changed.
- **`MAUL` and `GUN`** have no weapons using them. `MAUL` still points at 2661
  (`dragon_pickaxe_anim`) and `GUN` at the unarmed punch/kick; inert, left as they are.

## Types and their animations

All 48 types with at least one weapon, and the animation each style resolves to today. Format:
style, attack type, sequence id, gameval name.

| Type | Weapons | Styles |
| --- | ---: | --- |
| STAFF | 115 | Bash crush 401 `human_blunt_pound`; Pound crush 406 `human_dhsword_chop`; Focus crush 406 `human_dhsword_chop` |
| WARHAMMER | 126 | Pound/Pummel/Block crush 401 `human_blunt_pound` |
| GRANITE_MAUL | 5 | Pound/Pummel/Block crush 1665 `slayer_granite_maul_attack` |
| VERACS_FLAIL | 6 | Pound/Pummel/Spike/Block 1658 `slayer_abyssal_whip_attack` |
| SCYTHE | 9 | Reap/Chop/Jab/Block 440 `human_scythe_sweep` |
| BATTLEAXE | 51 | Chop/Hack/Block slash 395 `human_axe_hack`; Smash crush 401 `human_blunt_pound` |
| GREATAXE | 6 | Chop/Hack/Block 2062 `barrow_guthan_crush`; Smash 2066 `barrow_dharok_slash` |
| CROSSBOW | 28 | Accurate/Rapid/Longrange 4230 `xbows_human_fire_and_reload` (NPCs 7552 `..._pvn`) |
| BALLISTA | 6 | 7218 `ballista_attack` (NPCs 7555 `ballista_attack_pvn`) |
| BLOWPIPE | 12 | 5061 `snakeboss_blowpipe_attack` |
| KARILS_CROSSBOW | 6 | 2075 `barrows_repeating_crossbow_fire` |
| SHORTBOW | 33 | 426 `human_bow` |
| LONGBOW | 33 | 426 `human_bow` |
| DARK_BOW | 9 | 426 `human_bow` |
| DRAGON_DAGGER | 9 | Stab/Lunge/Block 376 `human_ddagger_lunge`; Slash 377 `human_ddagger_hack` |
| ABYSSAL_DAGGER | 8 | as the dragon dagger |
| DAGGER | 51 | Stab/Lunge/Block 386 `human_sword_stab`; Slash 390 `human_sword_slash` |
| SWORD | 47 | Stab/Lunge/Block 412 `human_staff_spike`; Slash 390 `human_sword_slash` |
| FANG | 1 | as `SWORD` (shared fight types) |
| SCIMITAR | 77 | Chop/Slash/Block 390 `human_sword_slash`; Lunge 386 `human_sword_stab` |
| LONGSWORD | 13 | Chop/Slash/Block 390 `human_sword_slash`; Lunge 412 `human_staff_spike` |
| MACE | 30 | Pound/Pummel/Spike/Block 401 `human_blunt_pound` |
| KNIFE | 33 | 806 `human_stake` |
| OBBY_RINGS | 1 | 2614 `thzarr_ring_chuck` |
| SPEAR | 97 | Lunge 2080 `barrows_war_spear_stab`; Swipe 2081 `..._slash`; Pound 2082 `..._crush`; Block 2080 |
| TWO_HANDED_SWORD | 23 | Chop/Slash/Block 407 `human_dhsword_slash`; Smash 406 `human_dhsword_chop` |
| PICKAXE | 27 | Spike/Impale/Smash 401 `human_blunt_pound`; Block 400 `human_blunt_spike` |
| CLAWS | 15 | all four 7527 `dclaws_human_attack` |
| HALBERD | 16 | Jab/Swipe/Fend 440 `human_scythe_sweep` |
| UNARMED | 6 | Punch/Block 422 `human_unarmedpunch`; Kick 423 `human_unarmedkick` |
| WHIP | 8 | Flick/Lash/Deflect 1658 `slayer_abyssal_whip_attack` |
| THROWNAXE / DART / JAVELIN | 11 / 44 / 2 | 806 `human_stake` |
| ANCIENT_STAFF | 2 | as `STAFF` |
| POWERED_STAFF | 42 | 0 (spell cast) |
| GODSWORD | 13 | Chop 7046 `dh_sword_update_chop`; Slash 7045 `..._slash`; Smash 7054 `..._smash`; Block 7055 `..._block` |
| ABYSSAL_BLUDGEON | 1 | all three 3298 `abyssal_bludgeon_crush` |
| SARADOMIN_SWORD | 1 | as `TWO_HANDED_SWORD` |
| ELDER_MAUL | 3 | 7516 `human_elder_maul_attack` |
| GHRAZI_RAPIER | 4 | Stab/Lunge/Block 8145 `ghrazi_rapier_attack`; Slash 390 |
| PARTISAN | 5 | Stab 2080, Lunge 2080, Pound 2082, Block 2080 (the spear's) |
| POLESTAFF | 17 | Bash/Pound/Block 401 `human_blunt_pound` |
| SALAMANDER | 5 | all three 5247 `human_attack_salamander` |
| CHINCHOMPA | 3 | 2779 `human_chinchompa_attack` (NPCs 7618 `..._pvn`) |
| BLADED_STAFF | 2 | Jab 401 `human_blunt_pound`; Swipe/Fend 406 `human_dhsword_chop` |
| BULWARK | 2 | 7507 `human_dinhs_bulwark_crush` |
| MULTI_MELEE | 1 | 13763 `human_infernal_tecpatl_attack` |
| SLASH_FLAIL | 1 | 14244 `human_weapons_hallowed_flail01_attack01` |
| EXTENDING_CHAINMACE | 2 | Thrust 15123 `tfa_human_obligator_multihit`; Smash 15122 `..._attack` |

## Applied changes

- `server/data/definitions/item-combat-styles.json`: the six types in
  [Findings 1](#1-fixed-six-weapon-types-animated-by-the-wrong-thing). The file's animation
  field is server-owned and preserved by `yarn dump:item-combat-styles`, so it is edited here
  rather than dumped.
- `server/src/main/typescript/elvarg/game/content/combat/WeaponProfile.ts`: removed the
  machete/sickle/cane speed block and the cane block (both already matched the cache), and the
  Twisted bow's `attackSpeed: 5`.
- `server/tests/weapon-data.test.cjs`: three tests - no type animates with a combat-tab icon
  id, the six audited families animate with their own family, and the gem machetes and Twisted
  bow take the cache's speed.

## Verification

```bash
cd server && npx tsc --build           # clean
cd server && node --test tests/weapon-data.test.cjs          # 14 pass
```

The wider weapon suites (16 files, 170 tests) all pass: `weapon-styles`, `weapon-style-memory`,
`weapon-families-melee-misc`, `melee-special-weapons`, `melee-weapon-specials`, `thrown-weapons`,
`blackjack-polestaff-crozier-shield`, `bladed-staff-autocast`, `item-bonuses`, `maxgear`,
`scythe-and-bowfa`, `bounty-hunter-weapons`, `fractured-archive-weapons`, `rat-bone-weapons`,
`weapon-effects`.

Not run: `weapon-equipment-melee-gaps`, which fails on `api.persistAttribute` in its own fake
plugin api. `ScytheOfVitur.plugin.js` gained that call on 1 November 2026
(`d05b9f015`), after the test's last change (30 October 2026); the failure is on the branch
before this one and is unrelated.

The audit itself was run before and after the changes: the four speed rows leave
`weapon-census-findings.csv`, the 47 weapons in the six fixed types show their new animation
names in `weapon-census.csv`, and nothing else moves.

## Limitations

- The Wiki does not publish attack animation ids. The animation review is therefore
  structural (family names, icon-id check, one animation per style, sequence existence) plus
  the existing per-item captures; it cannot prove a family choice for the types in
  [Left alone](#6-left-alone-with-reasons).
- The Wiki's bucket is the current revision of each page. Variant pages (charged/uncharged,
  active/inactive, inside/outside a raid, Last Man Standing, Deadman) are joined by the page's
  own sub-row, but a page that has since been renumbered can still be matched to the wrong
  variant; the two known cases are called out above.
- No RSProx recording was consulted for this audit. The animation evidence is the cache's own
  sequence names and the captures already recorded in `docs/weapon-data.md`.
- Requirement levels (Attack/Ranged/Magic) are not in the Wiki's equipment-stat table and were
  not audited.
