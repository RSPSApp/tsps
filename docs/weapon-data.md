# Weapon data

How a weapon's combat tab, attack speed and animations are decided, and where each comes from.

## Weapon types

A weapon's type (`weaponInterface` in `server/data/definitions/item-gameplay.json`) picks its combat tab, attack styles and default animations. The modern combat tab (593) draws the styles itself from the type's **category** (varbit 357), one of the cache's weapon categories in dbtable 78 (`combat_interface_weapon_category`, rows `combat_interface_<name>`).

`yarn sync:weapon-types` (`server/scripts/sync-weapon-types.ts`) gives every weapon in the cache its type:

1. **The category** comes from the OSRS Wiki's combat style for the item (its bonuses infobox, read through the Wiki's data API): "Slash Sword" is `hacksword`, "2h Sword" `heavysword`, "Salamander" `flamer`, "Powered Staff" `staff_selfpowering`, and so on.
2. **A type whose category already matches is kept.**
3. **Otherwise the type comes from a weapon with the same name**, or the same name without a variant suffix ("(or)", "(p++)", "(nz)"...), in that category; otherwise from the category's types by name (a "longsword" is `LONGSWORD`, a "karil" crossbow `KARILS_CROSSBOW`), or its only type.
4. **Stance animations:** a weapon still on the human ones takes its source weapon's, or its type's usual ones.
5. **Rows the loader skipped:** a row named differently from the cache item is never read. Renamed items' rows ("Mith crossbow", "Iron dart(p)") get the cache's name back, keeping their data. Rows exported as "Null" before the item existed are replaced.

The script prints every change and every weapon it couldn't resolve, and is safe to rerun: a second run changes nothing. A cache update that adds weapons fails `tests/weapon-data.test.cjs` until it's rerun.

In the first run, 234 weapons got a type they didn't have and 112 had theirs corrected. Among them:
- the Twisted bow, every crossbow below rune, the Abyssal daggers, the hastas, the Crystal halberds and the ornament godswords;
- the Tridents and Sanguinesti staff are powered staffs, not staffs;
- the Staff of the dead and Staff of light are bladed staffs, Dinh's bulwark a bulwark;
- Arclight is a slash sword, not a two-handed sword;
- the Elder maul's type was in the cache's "egg" category (32); it's blunt (2).

New types for categories tsps had none for: `BLADED_STAFF`, `BULWARK`, `GUN`, `MULTI_MELEE` (Infernal tecpatl) and `SLASH_FLAIL` (Hallowed flail). `yarn dump:item-combat-styles` filled their styles from the cache.

**Left without a type** (listed in the test):
- **Nature's reprisal** ("Multi-style"): its attacks change combat method with the chosen style, which the combat engine can't do yet.
- **Broken axes, the Teasing stick and Arrav's axe:** no Wiki combat style.

## Attack speed

From the most specific source to the least:
1. a profile registered for the item in `WeaponProfile.ts`;
2. **the cache's attack speed for the item** (item param 14);
3. the weapon type's profile;
4. the type's default.

So weapons whose speed differs from their type's are right without a per-item entry: the Scythe of Vitur is 5 (its type, scythe, is 4), the plain Scythe 7.

## Attack animations

From the most specific source to the least:
1. a profile registered for the item;
2. **the item's own `attackAnim`** in `item-gameplay.json`;
3. the weapon type's profile;
4. the attack style's animation.

- **Per attack type:** `attackAnim` is one animation for every style, or one per attack type: the Soulreaper axe has `{"slash": 10171, "crush": 10172}` (`ancient_axe_slash` / `ancient_axe_crush`).
- **Against NPCs:** the cache has separate animations for some ranged attacks on NPCs, named `..._pvn`. A style's `npcAnimation`, or a profile's `npcAttackAnimation`, is used when the target is an NPC; the plain one when it's a player. The captures (all on NPCs) show the `_pvn` ones. There's no capture of these attacks on players, so the plain ones stay there.

### From rsprox captures

The weapon view of the capture index (attacks with each weapon equipped, special attack off). Ids are the rev 241 cache's for the names.

| Weapon | Captured | Was | Recordings |
| --- | --- | --- | --- |
| Scythe of Vitur (all versions) | `scythe_of_vitur_attack` 8056; block `human_scythe_block` 435; stand `scythe_of_vitur_ready` 8057 | the scythe type's 414 / 382 / 2066 | 36 of 38 (Leagues worlds) |
| Osmumten's fang | `human_osmumtens_fang` 9471 | the sword type's | 32 of 34 |
| Venator bow | `human_weapon_bow_venator01_shoot` 9858 | the bow's 426 | 11 of 11 |
| Blisterwood flail | `ivandis_flail_attack` 8010 | the staff's | 21 of 21 |
| Wolfbane | `stab_wolbanedagger` 6095 | the sword's | 4 of 4 |
| Soulreaper axe | `ancient_axe_crush` 10172 (slash styles: `ancient_axe_slash` 10171) | the battleaxe's | 9 of 11 |
| Zombie axe | `godwars_godsword_zamorak_player` 7004 | the battleaxe's | 22 of 26 |
| Sunlight spear | `league_5_spear_shield_stab` 11931 (slash: `_slash` 11932) | the sword's | 3 of 3 |
| Hallowed flail | `human_weapons_hallowed_flail01_attack01` 14244, sound 1713 | none (no type) | 2 of 2 |
| Infernal tecpatl | `human_infernal_tecpatl_attack` 13763, sound 11456 | none (no type) | 1 (Leagues world) |
| Daggers (type) | `human_sword_stab` 386 | `human_blunt_spike` 400 for every style | adamant and rune dagger, 4 |
| Crossbows (type, on NPCs) | `xbows_human_fire_and_reload_pvn` 7552 | 4230 | rune, dragon and sunlight crossbow, 15 |
| Ballistas (type, on NPCs) | `ballista_attack_pvn` 7555 | 7218 | heavy ballista, 2 |
| Chinchompas (type) | `human_chinchompa_attack_pvn` 7618 on NPCs; `human_chinchompa_attack` 2779 on players | 288 / 282 / 281: `unicorn_walk`, `spider_death`, `spider_block` | 4 |
| Axes (type) | `human_axe_hack` 395 for chop, hack and block | `human_blunt_pound` 401 for every style | dragon axe, 4 of 6 |

The captures also confirm, unchanged: the Abyssal whip, the two-handed swords' slash, the Elder maul, the Dragon dagger, Arkan blade, Thunder khopesh and Emberlight's slash, the Noxious halberd, the shortbows' and longbows' 426, and the Toxic blowpipe.

**Inferred rather than captured:**
- **Scimitars' Lunge:** 386 (`human_sword_stab`), seen in game (#461). It had been the slash, 390; the captures never had a scimitar on Lunge.
- **Daggers' slash style:** 390 (`human_sword_slash`, as the stab-sword types' slash). Only their stab was in the captures.
- **Stance sets from the cache's animation names:**
  - Soulreaper axe: `ancient_axe_idle` / `_walk` / `_run`;
  - Venator bow: `human_weapon_bow_venator01_*`;
  - Blisterwood flail: `ivandis_flail_*`;
  - Sunlight spear: `league_5_spear_shield_*`;
  - Hallowed flail: `human_weapons_hallowed_flail01_*`;
  - Dinh's bulwarks: `human_dinhs_bulwark_*`;
  - Colossal blade: `human_weapon_giant01_ready` / `_walk` / `_run` (9460/9461/9459), added among the Giants' Foundry animations it was released with. It had been on the two-handed swords' stance (#461). Its attacks stay the two-handed sword's: the giant set has no attack or block of its own.

  Turn and side-step animations without their own name use the walk.
- **Dinh's bulwark's Pummel:** `human_dinhs_bulwark_crush` 7507 (Pummel is a crush attack; `_bash` is its special).

## Arrow launch graphics

The bow shows the arrow being drawn: the ammunition's `<ammo>_arrow_launch` spotanim (live OSRS with the twisted bow: `dragon_arrow_launch`, slot 1, height 96; the projectile `ii_dragon_arrow_normal_projanim` follows at cycle 41). Dragon arrows used `double_dragon_arrow_launch` (1111) for every bow, which drew two arrows: they now use `dragon_arrow_launch` (1116). The dark bow, which fires two, uses each arrow's `double_<ammo>_arrow_launch` (1104-1112) through its profile's `doubleStartGraphic`.

## Not covered yet

- **Bladed staffs (Jab, Swipe, Fend):** no capture. They keep the staff animations they had (401 / 406).
- **Staffs, wands and sceptres** attack with spells, and spells use their cast animations. The captures' main rows for them are the player blocking. The Warped sceptre's `pog_warped_sceptre_attack` (10501) is captured but not used: its attacks are spells.
- The Warped sceptre spell uses `VFX_WARPED_SCEPTRE_CAST` (10500), with cast/projectile/impact spotanims 2567/2569/2568 and charge-count varbit `CHARGES_WARPED_SCEPTRE_QUANTITY` (16155), from the client gameval definitions. Its 4-tick speed, 7-tile range (9 on Longrange), 62 Magic requirement, and base max-hit formula are from the [OSRS Wiki item page](https://oldschool.runescape.wiki/w/Warped_sceptre), not another RSPS.
- **Weak captures, left alone:** banners (`human_banner_spike`, 3 recordings, one style), the Bone mace (`barrow_guthan_crush`, half the attacks), the Twinflame staff.
- **Weapons outside the captures' coverage** keep their type's animations. 69 weapons have attacks in 3 or more recordings; the rest need a capture or the Wiki.

## Remaining ranged and magic checks (PR #797)

- [Dark bow](https://oldschool.runescape.wiki/w/Dark_bow?action=raw) and
  [its BH variant](https://oldschool.runescape.wiki/w/Dark_bow_(bh)?action=raw): both arrows
  roll independently and use the bow profile's separate hit delays. Ordinary Descent rolls
  zero to its boosted maximum, then clamps to the guaranteed minimum and 48 dragon-arrow
  cap; BH rolls minimum to maximum, with minima 7/10. Seeking dragon arrows use Descent of
  Dragons and their successful ordinary hits have a minimum of 3. Painted, LMS, BH,
  corrupted and Deadman bows share ammunition and special registration. The dark bow's
  ordinary range is 10 tiles. The BH bow now refuses attacks outside approved contexts.
  Castle Wars, the Fight Pit and the actual combat ring inside a player-owned house
  answer a shared custom-event query using their own area/room data. Daimon's Crater,
  Clan Wars, Soul Wars and Clan Hall rings have no implementation to approve them yet;
  unrestricted wilderness, lobby, ordinary POH tiles and unrelated PvP areas stay blocked.
- [Hit delay](https://oldschool.runescape.wiki/w/Hit_delay?action=raw): Snapshot now creates
  two single-arrow hits a tick apart. Chainhit uses captured projectile 258, launch delay 41,
  heights 40→36, angle 0 and progress 11. Initial flight is `max(10, 5*(distance+1))`
  client cycles; each bounce starts at the previous arrival and takes `10+3*distance`,
  using the Chebyshev gap between occupied footprints. RSProx recordings
  [1851](https://rsprox.net/download/1851), [1856](https://rsprox.net/download/1856) and
  [1863](https://rsprox.net/download/1863) (revision 227, Leagues V) show a four-target
  timeline 41→61→77→99→118 and overlapping 3×3 bosses bouncing in 10 cycles. They also
  show animation 1068, launch graphic 257 at height 96 and sound 2528 per hit. Only one
  thrownaxe is consumed for the entire chain. Its five-target cap includes the primary
  (50% maximum energy), and unused opponents are picked randomly, as the Rune thrownaxe
  page's cited Mod Ash answers specify. Damage still uses the existing primary hit-delay
  rule; the door-support targets in the Leagues capture do not establish a general new
  primary impact-delay rule.
- [Ammunition](https://oldschool.runescape.wiki/w/Ammunition?action=raw): ballista javelins
  already use the common 20% break, floor-drop and Ava's recovery path; the regression now
  actually selects BALLISTA. Salamander tar is consumed in **all three** styles, with the
  matching tar required for Scorch and Blaze as well as Flare. Flare and Blaze have no hit
  delay, as the Wiki Hit delay page specifies.
- [Chinchompa](https://oldschool.runescape.wiki/w/Chinchompa_(weapon)?action=raw): accuracy
  uses heavy ranged defence. The NPC loader now preserves the dump's light/standard/heavy
  bonuses and rolls cache each category separately; weapon profiles select the category.
- [Morrigan's throwing axe](https://oldschool.runescape.wiki/w/Morrigan%27s_throwing_axe):
  Hamstring uses the existing movement drain modifier to multiply actual drain by six for
  one minute; repeated hits refresh a single expiry instead of stacking drain tasks.
- [Toxic blowpipe](https://oldschool.runescape.wiki/w/Toxic_blowpipe?action=raw): Toxic
  Siphon remembers its damage roll before the target-HP cap, so a killing 40 roll against a
  4 HP target heals 20. Ordinary venom still requires an accurate positive hit.
- [Staff of the Dead](https://oldschool.runescape.wiki/w/Staff_of_the_Dead): the main text
  and its cited Mod Ash answer give **1/7** rune saving. The comparison table still says
  1/8; the cited direct answer takes precedence. Offensive spells only; Kodai remains 15%.
- Power of Death IDs were checked with cache revision 241 `dump:seq` and `dump:spotanim`
  and its gamevals: dead 7083/1228, light 7967/1516, balance 3652/1733, **charged toxic
  1720/1228** (1719 is explicitly the uncharged animation).
- [Ancient sceptre](https://oldschool.runescape.wiki/w/Ancient_sceptre?action=raw): plain
  and locked sceptres now apply the 10% improved ancient effects through the existing
  `magic:hit-effects` event: poison severity 11/22, shadow drain 11%/16.5%, blood healing
  27.5%, ice freeze 8/17/26/35 ticks. These values are listed in that page's Passive
  effect table; [Smoke spells](https://oldschool.runescape.wiki/w/Smoke_spells?action=raw)
  supplies the unchanged 1/8 poison chance. The plugin modifies the base spell's effect
  multiplier rather than cancelling/replacing its callback. Its NPC-only Shadow
  supplement runs through `magic:hit-effects-applied` after the base callback and all
  quest vetoes. [Ice spells](https://oldschool.runescape.wiki/w/Ice_spells?action=raw)
  gives base durations of 8/16/24/32 ticks and rounds the 10% enhancement down. These
  now use `freezeTicks` directly, preserving exact durations and the existing immunity.
  Its cache supplies +10% magic damage. Tests also
  verify Kodai's +15%, every normal wand's 4-tick melee profile, and the actual
  [3rd Age bow](https://oldschool.runescape.wiki/w/3rd_Age_bow) data (the Wiki redirects
  “3rd age longbow” to that bow).
- [Black salamander](https://oldschool.runescape.wiki/w/Black_salamander?action=raw)
  explicitly defines Bonus as the hidden salamander bonus (92), with equipment magic
  damage applied afterwards. The existing shared formula already does this; a regression
  verifies that +15% gear takes the level-99 Blaze base of 24 to 27. Gear is not added to
  the hidden Bonus term. Actual OSRS [rsprox recording 1607](https://rsprox.net/download/1607)
  (13 October 2024, revision 225) establishes the visuals: red salamander 10147, combat-style
  varp 43 set to 2 at tick 506, then Blaze at ticks 508/513 sends attacker spotanim **952**
  in slot **1**, height **104**, delay 0, sequence reset **65535**, and sound **740**.
  Target hits arrive at 509/514 with no projectile, map animation or target spotanim.
  Adding projectile and impact effects would contradict this capture. Scorch uses the same
  attacker flame with animation 5247/sound 738; Flare uses the flame with reset 65535/sound
  736. Tar 10144 decrements for every captured attack: 1000 to 996 across four Scorches, 995
  after Flare, then 994/993 after two Blazes. Raw recording logs contain account information
  and are intentionally excluded from the repository.
- The wand of the praesul is a RuneScape 3 item; neither the OSRS Wiki wand list nor this
  cache has one. No unrelated item or invented identifier was added.
