# Held-weapon stances and special-attack animations audit

Audit of every weapon the server can attack with, against the real game's own packets
(RSProx) and the cache's sequence names. Branch: `audit/weapon-animations`, based on
`origin/main` (`a9b03d4fb`), 4 November 2026.

The machine-readable results are next to this file:

- [`weapon-stance-changes.csv`](weapon-stance-changes.csv) - every changed weapon, its
  old and new stand/walk/run, why it changed and the recording that proves it.
- [`weapon-stance-unverified.csv`](weapon-stance-unverified.csv) - the 110 weapons with no clear
  capture; left as they were.

## Scope

| Measure | Count |
| --- | ---: |
| Cache items worn in the weapon slot, no notes or placeholders | 1,972 |
| - with an attack speed in the cache: the audited weapons | **1,080** |
| - held props and novelty items without one (not audited here) | 892 |
| Weapons with a direct stance capture | 587 |
| Weapons whose stored stance changed | **489** (401 stand, 447 walk, 310 run) |
| Special-attack plugins reviewed | 89 |
| Special animations confirmed by a capture | 34 |
| Special animations corrected | 7 |
| Specials left unverified or unimplemented | 18 |

## Sources

1. **RSProx recordings.** All 4,302 submissions in `C:\RSPS\rsprox-database\recordings`
   (revision 223 to 239, July 2024 to July 2026), decoded to text. Each player update's
   `AppearanceExtendedInfo` carries the 12 raw player-composition slots. Slot 3 is the
   weapon (`PlayerCompositionSlot.WEAPON`); values `>= 2048` are items, and the item id is
   `value - 2048`. `readyAnim`, `walkAnim` and `runAnim` in the same block are the stance
   the real server sent with that weapon worn. This was checked against known gear:
   `13856 - 2048 = 11808` (Zamorak godsword) with `readyAnim = 7053`,
   `13852 - 2048 = 11804` (Bandos godsword) with the same ready, and
   `8576 - 2048 = 6528` (Tzhaar-ket-om) with `readyAnim = 2065`.
2. **The cache (revision 241)** through `sequence-names.json`, RuneLite's gameval
   `AnimationID` names. These name each stance and special family
   (`HUMAN_STAFFREADY`, `XBOWS_HUMAN_READY`, `HUMAN_DH_WEAPON_READY`,
   `ABYSSAL_DAGGER_IDLE`, `SPECIALATTACK_UNLEASH`, ...).
3. **The OSRS Wiki** for equipment pages, special-attack names and the special-attack
   GIFs. The Wiki does not publish numeric animation ids, so it is used to name the
   behaviour, not to supply the id.

## Method

For each weapon id, the occurrence streams were aggregated **per cache revision**. The
newest revision with at least 3 observations and at least 60% agreement wins; a weapon
last seen only in older recordings falls back to all revisions with at least 5
observations and 80% agreement. Ties and ambiguous revisions are ignored, which is why
the Saradomin sword keeps `7053` (r239 has a 2/2 split; every older revision is 7053).
Four weapons changed stance between revisions and were checked by hand:

| Weapon | Older captures | Current captures | Used |
| --- | --- | --- | --- |
| Hill giant club (20756) | r223: `813` staff pose | r227+: `2065/2064/824` | current |
| Sanguine Scythe of Vitur (25739) | r223: `9494` | r224+: `8057/819/824` | current |
| Eye of Ayak (31113) | r229: `4193` crate pose | r231+: `813/1205/1210` | current |
| Saradomin sword (11838) | r224-r238: `7053/7052/7043` | r239: 2/2 split | `7053` |

A weapon with no row in `item-gameplay.json` and a captured stance was added to the file
(Nature's reprisal and its uncharged copy). Crimson kisten already had a row and was
corrected.

## Idle stance findings

The old export's stances are not the game's. Whole families were on the human default or
on another family's gait, and 33 spears carried `8980 HUMAN_SPELLCAST_DEGRIME` - a
spellcast animation, not a stance at all. Two abyssal whips carried
`1832 HUMAN_RUBBER_CHICKEN_READY`.

### Family corrections

Representative captures (`file:tick`, the tick in the recording's decoded text; the
revision is given where it is outside 235-239):

| Family | Correct stance `stand / walk / run` | Examples |
| --- | --- | --- |
| Staffs | `813 HUMAN_STAFFREADY / 1205 HUMAN_HALBERDWALK_F / 1210 HUMAN_HALBERDRUNNING` | Staff of air `2.txt:326`; 89 of 115 staff-type weapons |
| Powered staffs | `813 / 1205 / 1210` | Sanguinesti staff, tridents, sceptres |
| Halberds | `813 / 1205 / 1210` | Steel halberd `1098.txt:11008`; 14 of 16 |
| Spears | `813 / 1205 / 1210` | Dragon spear `4006.txt:373`; 66 of 97 |
| Blowpipes | `813 / 1205 / 1210` | Toxic blowpipe `239`, Drygore `3314.txt:1158` |
| Partisans | `813 / 1205 / 1210` | Keris partisans |
| Crossbows | `4591 XBOWS_HUMAN_READY / 4226 / 4228` | Rune crossbow `4270.txt:21` |
| Two-handed swords | `2561 HUMAN_DH_WEAPON_READY / 2562 / 2563` | Steel 2h sword `1098.txt:14392` |
| Barrows greataxe | `2065 / 2064 / 11466` | Dharok's greataxe `1133.txt:678` |
| Barrows flail | `2061 / 2060 / 824` | Verac's flail `1134.txt:6328` |
| Barrows crossbow | `2074 / 2076 / 2077` | Karil's crossbow `1157.txt:21092` |
| Granite maul family | `1662 / 1663 / 1664` | Granite maul `1133.txt:4855` |
| Tzhaar-ket-om / Hill giant club | `2065 / 2064 / 824` (club) and `2065 / 2064 / 11466` (ket-om) | `1102.txt:19930`, `2796.txt:368` |
| Abyssal bludgeon | `1652 / 3293 / 2847` | `4273.txt:0` |
| Abyssal dagger | `3296 / 819 / 824` | `1156.txt:641` |
| Salamander | `5246 / 5245 / 824` | Red salamander `4029.txt:860` |
| Chinchompa | `3175 / 3177 / 3178` | `3994.txt:19` |
| Dinh's bulwark | `7508 / 7510 / 7509` | `4084.txt:31` |
| Nightmare staff | `4504 / 1205 / 1210` | `4142.txt:1285` |
| Zamorakian spear / Sunspear | `1713 / 1703 / 1707` | `3110.txt:0` |
| Tumeken's shadow | `9494 / 1703 / 1707` | `4266.txt:27` |

Exceptions the captures insist on:

| Weapon | Stance | Capture |
| --- | --- | --- |
| Saradomin / Guthix / Zamorak staff | `808 / 819 / 824` (human) | `4150.txt:0` |
| Nightmare staffs | `4504 / 1205 / 1210` while the plain staffs are `813` | `4142.txt:1285` |
| Ivandis flail / Rod of Ivandis | `8009 / 8011 / 8016` | `24699`, `22398` |
| Iban's staff (o) | `13826 HUMAN_IBANS_ORN_READY` | cache name |
| Dragon longsword, Blade of Saeldor, Vesta's blighted longsword, Blurite sword | `809 HUMAN_DS_READY` | `1222.txt:4484` |
| Osmumten's fang | `809 / 819 / 824` | `4254.txt:16` |
| Sarachnis cudgel | `809 / 819 / 824` | capture |
| Rune crossbow (or) | `9161 HUMAN_XBOWS_LEAGUE03_IDLE` | `980.txt:2` |
| Comp bows | `813 / 1205 / 1210` (staff pose) | capture |
| Abyssal whips | `808 / 1660 / 1661` | capture |

### Dedicated stances the captures did not cover

| Weapon | Stance | Evidence |
| --- | --- | --- |
| Hallowfell (34027) | `14465 HUMAN_HALLOWFELL_IDLE / 14466 _WALK / 14468 _RUN`, block `14471 _BLOCK` | cache has the weapon's own ready/walk/run/block; it had been on the two-handed sword gait |
| Crimson kisten (33631) | ready/walk/run `14251/14252/14254`, block `14257 HUMAN_WEAPONS_CRIMSON_KISTEN_DEF` | cache names; see also PR #2387 |
| Archibald eggs (33151-33163) | `12317 PETEGG_HUMAN_READY / 12318 / 12320` | every variant shares the model; item 33163 is captured at `4271.txt:0`, r239 |

The carrot sword and '24-carat' sword have a cache sequence `8642 HUMAN_CARROT_SWORD_READY`, but
the only capture (item 24537, `2797.txt:25`, r229) sends `809/819/824` and no recording ever
sends 8642. They are left on the captured pose and listed as unverified.

### Corrupt values removed

- `8980 HUMAN_SPELLCAST_DEGRIME` on 33 spears (all `(kp)`, `(p+)`, `(p++)` variants,
  leaf-bladed and black spears, Anger spear) - now the spear gait.
- `1836 HUMAN_SKIPPING_WALK` as the Easter basket's stand - now `1837 HUMAN_SKIPPING_READY`.
- `1832 HUMAN_RUBBER_CHICKEN_READY` on the Volcanic and Frozen abyssal whips - now `808`.
- `1662 SLAYER_GRANITE_MAUL_READY` on the Tzhaar-ket-om, its (t) copy and the Hill giant
  club - now the Dharok two-handed gait (`2065/2064/...`).
- `8980` on the Leaf-bladed spear and Sunspear - now `813` and `1713`.

### Weapons left unverified

The 110 weapons in [`weapon-stance-unverified.csv`](weapon-stance-unverified.csv) have no
clear capture of their stance. Most are novelty or event copies (`Broken axe`, darts and
knives without a poison variant, White equipment, birthday items, speedrun trophies) and
are already on the human `808/819/824` pose. The non-human ones are left as authored:
Vesta's longsword and warhammer, Statius's warhammer, Morrigan's javelin/throwing axe,
Crystal axe, and the quest/joke items.

## Special-attack animations

Each `plugins/combat/specials/*.js` was read for its animation id, then that id was
checked against the weapon's captured sequences and the cache's sequence name.

### Fixed

| Special | Was | Now | Evidence |
| --- | --- | --- | --- |
| Voidwaker - Disrupt | `11240 HUMAN_SPECIAL_VOIDWAKER` | **`11275 HUMAN_SPECIAL02_VOIDWAKER`** | `1094.txt:555`, `1095.txt:281`, r237 and `1433.txt:1143`, r224; 11275 appears in 50 recordings, 11240 in none |
| Excalibur - Sanctuary | no animation | **`1057 SANCTUARY`** | cache name sits with `RAMPAGE`/`CLEAVE`/`SHATTER`/`PUNCTURE`; the special is named Sanctuary |
| Morrigan's javelin - Hamstring | `806 HUMAN_STAKE` (normal throw) | **`11467 WEAPON_MORRIGANS_JAVELIN_SPECIAL01`** | cache name; no recording of the special exists |
| Dragon knife - Duality | `8292` for every variant | **`8291` plain, `8292` for `(p)/(p+)/(p++)`** | cache names `HUMAN_DRAGON_TKNIVES_SPEC` / `_SPEC_POISON` |
| Dragon hasta - Unleash | normal spear attack | **`11171 SPECIALATTACK_UNLEASH`** | cache name matches the special |
| Statius's warhammer (bh) - Smash | normal warhammer attack | **`1378 DRAGON_WARHAMMER_SA_PLAYER`** | same Smash special as Statius's warhammer and the dragon warhammer |
| Toxic blowpipe - Toxic Siphon | normal blowpipe attack | **`876 TOXIC_BLOWPIPE_SPECIAL_UPDATED`** | cache name; ordinary attacks keep `5061` |

### Confirmed correct by capture

The following had their exact ids played in the recordings with the weapon equipped:
Abyssal bludgeon `3299`, abyssal dagger `3300` and `3296` idle, abyssal tentacle/whip
`1658`, accursed sceptre `9961`, Arclight `2890` (Darklight shares the same
`DARK_SPEC_PLAYER`), Arkan blade `12297`, Armadyl
crossbow `4230`, Armadyl godsword `7644`, Bandos godsword `7642`, barrelchest anchor
`5870`, burning claws `11140`, dark bow `426`, dragon 2h sword `3157`, dragon axe `2876`,
dragon battleaxe `1056`, dragon claws `7514`, dragon dagger `1062`, dragon halberd `1203`,
dragon longsword `1058`, dragon mace `1060`, dragon scimitar `1872`, elder maul `11124`,
emberlight `11138`, eye of Ayak `12394`, granite maul `1667`, Keris partisan `9544`,
magic shortbow `1074`, Osmumten's fang `11222`, rosewood blowpipe `13145`, rune thrownaxe
`1068`, Saradomin godsword `7640`, Voidwaker `11275`, Webweaver `9964`.

### Left unverified or unimplemented

| Special | Status |
| --- | --- |
| Bone dagger - Backstab | uses the normal dagger attack; the cache has `4198 DTTD_PLAYER_STAB_BONE_DAGGER`, but no recording uses it. Not changed. |
| Sunspear - Seeking Lunge | plugin returns before registering (`ITEM_IDS` empty although 33722/33723 exist); the animation is `14259 HUMAN_WEAPONS_SUNSPEAR_SPEC`. |
| Crimson kisten - Brutal Swing | plugin returns before registering (`ITEM_IDS` empty although 33631-33633 exist); the animation is `14255 HUMAN_WEAPONS_CRIMSON_KISTEN_SPECIAL`. |
| Dawnbringer | no player animation in the cache; the plugin plays only graphics. |
| Noxious halberd - Virulence | self-buff, no player animation; the VFX is `11516`. |
| Granite hammer - Hammer Blow | no dedicated sequence in the cache; keeps the mace swing. |
| Seercull - Soulshot | uses the normal bow draw (`426`); no separate sequence exists. |
| Magic longbow - Powershot | uses the normal bow draw; no separate sequence exists. |
| Dorgeshuun crossbow - Snipe | uses the normal crossbow fire; no separate sequence exists. |
| Dragon crossbow - Annihilate | uses the normal crossbow fire; no separate sequence exists. |
| Rune claws - Impale | uses the normal claws attack; no separate sequence exists. |
| Purging staff - Scatter Ashes | uses the normal staff attack; the plugin has a TODO. |
| Dual macuahuitl | normal attack plus `11054` spotanim; no player special sequence. |
| Vesta's longsword - Feint | `412 HUMAN_STAFF_SPIKE` (the normal lunge); the cache has no Feint sequence. |
| Dragon harpoon / dragon pickaxe | already per-variant (7393/7394/8333/11823/11824 and 7138/334/8330/3410/7267/8329/11821/11822). |
| Zaryte crossbow | `9166 ZCB_ATTACK`; the cache has no separate special player animation. |

## Applied changes

- `server/data/definitions/item-gameplay.json`: 489 stance rows corrected, Nature's
  reprisal and its uncharged copy added, Crimson kisten corrected.
- `server/plugins/combat/specials/Voidwaker.SpecialAttack.js`: 11275.
- `server/plugins/combat/specials/Excalibur.SpecialAttack.js`: 1057.
- `server/plugins/combat/specials/MorrigansJavelin.SpecialAttack.js`: 11467.
- `server/plugins/combat/specials/DragonKnife.SpecialAttack.js`: 8291/8292 split.
- `server/plugins/combat/specials/DragonHasta.SpecialAttack.js`: 11171.
- `server/plugins/combat/specials/StatiusWarhammerBh.SpecialAttack.js`: 1378.
- `server/plugins/items/ToxicBlowpipe.plugin.js`: 876 on the special path.
- `server/tests/weapon-data.test.cjs`: stance family regression, spellcast-stance check,
  Hill giant club and Tumeken expectations.
- `server/tests/melee-special-weapons.test.cjs`: Voidwaker, dragon hasta and Statius bh
  animation regression.
- `server/tests/melee-weapon-specials.test.cjs`: Excalibur plays 1057.

## Verification

```bash
cd server && npx tsc --build                                  # clean
cd server && node --test tests/weapon-data.test.cjs           # 15 pass
cd server && node --test tests/melee-special-weapons.test.cjs # 24 pass
cd server && node --test tests/melee-weapon-specials.test.cjs # 25 pass
```

The wider weapon suites (15 files, 165 tests) all pass: `weapon-styles`,
`weapon-style-memory`, `weapon-families-melee-misc`, `melee-special-weapons`,
`melee-weapon-specials`, `thrown-weapons`, `blackjack-polestaff-crozier-shield`,
`bladed-staff-autocast`, `item-bonuses`, `maxgear`, `scythe-and-bowfa`,
`bounty-hunter-weapons`, `fractured-archive-weapons`, `rat-bone-weapons` and
`weapon-effects`. `castlewars-navigation` (22 tests) also passes.

Not run: the two client tests that need a built `server/dist/Server` are unaffected (no
client change); the client typecheck was not run because nothing under `client/` changed.

## Other observations

- **Hallowfell (34027)** has dedicated attack sequences too - `14467 HUMAN_HALLOWFELL_CHOP`,
  `14469 _SMASH`, `14470 _SLASH`, `14471 _BLOCK` - but is typed `TWO_HANDED_SWORD` and
  therefore still attacks with the two-handed sword's 407/406. Its stance is fixed above;
  the attack animation is left for the attack-animation audit because a per-item
  `attackAnim` can only split by attack type, not by Chop versus Slash.
- **Rondache (34719-34721)** has no `item-gameplay.json` row at all, so it falls back to the
  human stance. Its special looks up `tfa_human_rondache_special` from the cache by name,
  which is correct.
- **Sunspear and crimson kisten** both exist in the cache (33722/33723 and 33631-33633) but
  their special plugins still return before registering. Their special animations are
  `14259 HUMAN_WEAPONS_SUNSPEAR_SPEC` and `14255 HUMAN_WEAPONS_CRIMSON_KISTEN_SPECIAL`.

## Limitations

- The newest recording is revision 239 (14 July 2026); the cache is revision 241
  (20 October 2026). Stances are assumed unchanged between those two revisions.
- Four weapons demonstrably changed stance during the recording window; they were
  resolved by hand and are listed above. A future recording can still overturn a stance
  that only has one revision of evidence.
- 110 weapons have no clear capture and were left alone rather than guessed.
- Held props and novelty items without an attack speed (892 weapon-slot items) were not
  audited; some of them also carry non-human poses (`Butler's tray`, carried crates,
  balloon and trophy items).
- The Wiki does not publish animation ids. Special ids that no recording plays are
  justified by the cache's sequence names, not by a packet.
- No recording of a Sunspear or crimson kisten special exists, so those two plugins were
  left disabled rather than enabled untested.


