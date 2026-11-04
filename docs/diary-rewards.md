# Diary reward items

The achievement diaries' reward items (Ardougne cloak, Karamja gloves, Explorer's ring, ...) and what their own options do. The plugin is `server/plugins/items/DiaryRewards.plugin.js`, with its units in `server/plugins/items/diaryrewards/` and its data in `server/plugins/items/data/diary-rewards.json`. Claiming the items is the diary framework's job ([achievement-diaries.md](achievement-diaries.md)).

**What's not here yet:**
- the Explorer's ring's free alchemy (the Alchemy option and using items on the ring);
- the passive perks: shop discounts, Kandarin headgear's extra logs, Morytania legs as a ghostspeak amulet, desert heat protection, and the like.

## Zaff's battlestaves

The barrel in Zaff's shop sells one noted stack of battlestaves a day at 7,000 coins each: 15 / 30 / 60 / 120 for the highest Varrock tier claimed from Toby. The barrel checks room first, then offers the price (Yes. / No.); Yes. re-checks coins and room, takes the coins, gives the stack and sets `zaff_last_claimed`. The day is the UTC date in the daily attribute; the barrel is a multiloc on `zaff_last_claimed`, so a claim and each login of a claimed player schedule a task that sends the varbit back to 0 at 00:00 UTC (Wiki, 23 July 2025: no relog). The flow is as captured in rsprox archive 3216; the reset is from the Wiki and the cache, no capture shows it. Not done: the Wiki also says the battlestaves are only purchasable after partial completion of What Lies Below (the quest page ties it to defeating King Roald). No capture or cache check shows that gate and no refusal text is known, so it is not enforced. A player with no claimed tier clicking the full barrel gets no response (no text is known).

## Options

Every option works whether the item is worn or carried. The inventory names and the worn names (cache params 451+) lead to the same thing.

| Item | Option (inventory / worn) | Destination | Per day by tier (1 / 2 / 3 / 4) |
| --- | --- | --- | --- |
| Ardougne cloak | Monastery Teleport / Kandarin Monastery | Ardougne Monastery | unlimited |
| | Farm Teleport / Ardougne Farm | Ardougne farm patch | – / 3 / 5 / unlimited |
| Karamja gloves | Gem Mine | Shilo Village gem mine (underground) | – / – / unlimited / unlimited |
| | Slayer Master | Duradel | – / – / – / unlimited |
| Wilderness sword | Teleport | Fountain of Rune | – / – / 1 / unlimited |
| Morytania legs | Ecto Teleport / Ectofuntus Pit | Ectofuntus slime pit | 2 / 5 / 5 / unlimited |
| | Burgh Teleport / Burgh de Rott | Burgh de Rott | – / – / unlimited / unlimited |
| Fremennik sea boots | Teleport | Rellekka | 1 / 3 / 5 / unlimited |
| Desert amulet | Teleport / Nardah | Nardah; amulet 4 inside the shrine | locked / 1 / 1 / unlimited |
| | Kalphite cave | Kalphite Cave | – / – / – / unlimited |
| Kandarin headgear | Teleport | Sherlock | – / – / 1 / unlimited |
| Western banner | Teleport | Piscatoris Fishing Colony | locked / locked / 1 / unlimited |
| Explorer's ring | Teleport | Falador cabbage patch | – / 3 / unlimited / unlimited |
| Rada's blessing | Kourend Woodland | Kourend Woodland | 3 / 5 / unlimited / unlimited |
| | Mount Karuulm | Mount Karuulm | – / – / 3 / unlimited |
| Falador shield | Recharge-prayer / Recharge Prayer | Restores 25% / 50% / 100% / 100% of the Prayer level | 1 / 1 / 1 / 2 |
| | Check | The day's restores left | |
| Explorer's ring | Energy (Functions > Energy on rings 2–4) | Restores 50% / 50% / 50% / 100% run energy | 2 / 3 / 4 / 3 |
| | Check | The day's alchemy and energy charges, and ring 2's teleports | |
| Robin | Claim-slime | Bones to bonemeal and a bucket of slime each (rsprox 703, 1857; varbit 4543, RuneLite's MORYTANIA_SLIME_CLAIMED) | – / 13 / 26 / 39 |

"–" means the tier has no such option in the cache. "locked" means the option is there but does nothing until a later tier (Wiki).

- **Daily limits** reset at 00:00 UTC.
- **Counting is per destination,** not per item. Upgrading keeps the day's uses: Ardougne cloak 2's 3 farm teleports used leaves cloak 3 with 2 of 5 (Wiki trivia).
- **The Falador shield** spends nothing when Prayer is already full (Wiki changelog). The restore rounds down.

## From the captures

Captures (rsprox) cover the Ardougne cloak (both teleports), the Desert amulet 4 (both), Morytania legs (Ecto and Burgh), Fremennik sea boots 4, Rada's blessing 4 (Mount Karuulm), Karamja gloves 4 (Slayer Master) and the Explorer's ring 4's Check.

**Casting a teleport:**
- **On the click:** the player's sequence and spotanim (height 92), area sound 200 and `busy` = 1.
- **Three ticks later:** the move, the reset sequence and `busy` = 0, with the reset sent again a tick later.

| Teleport | Sequence | Spotanim |
| --- | --- | --- |
| Ardougne Monastery | `teleport_nardah_human` | `teleport_monastery` |
| Ardougne Farm | `teleport_nardah_human` | `teleport_farm` |
| Nardah, Kalphite Cave | `teleport_nardah_human` | `teleport_nardah` |
| Ectofuntus, Burgh de Rott | `teleport_slime_human` | `teleport_slimepit` |
| Rellekka, Mount Karuulm | `human_castteleport` | `teleport_casting` |

**The Karamja gloves clap first:**
1. On the click: `emote_clap` and the spam-channel message "You clap your hands and the world changes...".
2. Two ticks later: the standard cast, its sequence and spotanim delayed by 30 client cycles.
3. Three ticks after that: the move (Duradel at 2868–2869, 2982–2983 on level 1).

**Counter varbits:** after a limited teleport the server sets that destination's counter varbit to the day's uses. The elite tiers count too, though they are unlimited (`zeah_blessing_brimstone_teleport` 0→1→2, `fremennik_basic_teleport` 0→1). Ardougne cloak 2 also sends "You have used # of your # Ardougne Farm teleports for today." on arrival.

**Landing tiles seen:**
- Monastery: 2607–2608, 3219–3222.
- Farm: 2664–2667, 3373–3377.
- Burgh de Rott: 3481–3484, 3228–3232.
- Rellekka: 2643–2647, 3670–3673.
- Nardah shrine: 3424–3428, 2928–2929.
- Kalphite Cave: 3322, 3122.
- Mount Karuulm: 1310–1312, 3795–3797.

The data file keeps a centre and a radius for each, and the landing is a free tile within it.

**Explorer's ring 4 Check:** "You have # out of # alchemy charges left and # of your # energy restores left for today."

| Allowance | Varbit |
| --- | --- |
| Fountain of Rune | `wilderness_sword_last_teleport` (4541) |
| Ectofuntus | `morytania_legs_last_teleport` (4542) |
| Rellekka | `fremennik_basic_teleport` (5005) |
| Nardah | `desert_nardah_teleport` (4558) |
| Sherlock | `seers_sherlock_teleport` (4561) |
| Piscatoris | `western_pisc_teleport` (4564) |
| Cabbage patch | `lumbridge_cabbage_teleport` (4552) |
| Energy restores | `lumbridge_energy_restore` (4553) |
| Kourend Woodland | `zeah_blessing_woodland_teleport` (7937) |
| Mount Karuulm | `zeah_blessing_brimstone_teleport` (7938) |
| Falador shield | `falador_shield_recharge` (4544) |

The Ardougne farm count is split. Only its low bit has a name (`ardougne_cloak_lowbits`, 6069), so that count is kept server-side and not sent.

## Unverified

- **Casts nobody captured:**
  - The Wilderness sword and the Explorer's ring use the matching `teleport_rune_human`/`teleport_rune` and `teleport_cabbage_human`/`teleport_cabbage` from the same set.
  - The Gem Mine clap is assumed to match Slayer Master's.
  - Kandarin headgear, the Western banner and Kourend Woodland use the standard cast.
- **Destinations from the Wiki's maps, not captures:**
  - The Ectofuntus pit, the gem mine, Nardah outside the shrine, Sherlock, Piscatoris, the cabbage patch and Kourend Woodland.
  - The Fountain of Rune tile (3375, 3892) is a guess next to the fountain. Neither the Wiki nor our cache's map places it.
- **The Falador shield's restore:**
  - The Elysian spirit shield graphic (`elysian_shield_defend_spotanim`, Wiki trivia), with no player animation and no sound.
- **Messages this server writes itself:**
  - "You have already used all # of your … teleports for today." and "You have used # of your # … teleports for today." for the other teleports.
  - The locked desert amulet and western banner lines.
  - The Falador shield's messages: restored, full, spent and Check.
  - The Explorer's ring's energy messages, and the extra teleports line on ring 2's Check.
- **Explorer's ring recharge:** the Wiki says the ring's charges only come back after logging out and in. Here they reset at midnight like the others.

## Explorer’s ring daily allowances

The ring’s limited run-energy/free-alchemy counters are now owned by a separate persisted record. The Wiki specifies replenishing after logging out/back in; staying online across midnight does not restore uses. The existing shared diary daily record can advance when another reward is used, so its current spent counts migrate eagerly at login before any player actions. After migration, other diary rewards cannot reset the ring.

Counts remain shared across ring tiers, including four energy restores used on ring3 followed by upgrading to ring4 (which allows three). Same-day relog and real PlayerSave round trips retain spent uses; a qualifying next-day login resets both counters and transmits zero. Every use/reset/migration requests a save. Seven real-object tests cover these cases, including a real spellbook refresh preserving the ring counter. No alchemy casting or interface is added by this prerequisite fix.

Source: [Explorer’s ring4](https://oldschool.runescape.wiki/w/Explorer%27s_ring_4), Benefits: daily energy and alchemy charges replenish on logging back in. The shipped cache supplies the named energy/alchemy varbits and each ring tier’s menu/submenus. The local RSProx index contains ring mentions but no indexed lumbridge_alchemy interface/actions; reset/migration behavior comes from the Wiki and the migration safety design, not a captured midnight session.

Native QA exposed an additional overwrite: PacketSender’s spell-unlock defaults incorrectly labelled varbit4554 as Bones to Peaches and set it to30 whenever the magic tab refreshed. The active cache identifies4554 as lumbridge_free_alchs. Removing that one incorrect default preserves the ring’s saved counter; the separate legitimate Bones to Peaches default1505 is unchanged. A real PacketSender regression reproduces30 instead of the saved17 before this removal.

Final verification: fresh build and32/32 focused diary/alchemy/gameframe checks. Full suite8,772/8,773 with only minigame-teleports.test.cjs:204 failing when a real minute rolled over (19 versus20 remaining); its complete file passes8/8 on rerun, and clean baseline7cbfc71dc reproduces the clock-boundary failure with a controlled rollover. No teleport source/tests changed. Native final server retains counters4553=1/4554=17 through login, then a prepared previous-day login resets both0 and Check reports30/30 alchemy and2/2 energy. Owned slot88 server saved and shut down.

## Rada's blessing and fishing

Worn Rada's blessing 1 to 4 give a 2/4/6/8% chance, per landed fish, of the same catch again (a stackable catch doubles, so 14 karambwanji become 28), with no extra experience or bait (no extra crystal harpoon charge either, which is inferred, not Wiki), and the message "Rada's blessing enabled you to catch an extra fish." (Wiki; no capture confirms the wording or channel). On an infernal harpoon the extra fish has its own chance to be cooked, which gives Cooking XP and uses an infernal charge. Junk from a big net is left out, which the Wiki doesn't settle. Fishing Trawler, Tempoross and drift nets don't use it. Spirit flakes in ordinary fishing are not built. See `server/plugins/skills/fishing/RadasBlessing.Fishing.js`.
