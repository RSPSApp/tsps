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
- **Weak captures, left alone:** banners (`human_banner_spike`, 3 recordings, one style), the Bone mace (`barrow_guthan_crush`, half the attacks), the Twinflame staff.
- **Weapons outside the captures' coverage** keep their type's animations. 69 weapons have attacks in 3 or more recordings; the rest need a capture or the Wiki.
