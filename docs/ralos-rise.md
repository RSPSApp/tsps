# Ralos' Rise prayer training

`server/plugins/skills/RalosRise.plugin.js` (members) covers the Prayer method at Ralos' Rise and the Teomat:

1. Bless bones and jugs of wine at the **exposed altar**.
2. Break the blessed bones into **blessed bone shards** with a chisel.
3. Fill the **libation bowl** with blessed wine and sacrifice the shards there for Prayer experience.

Each step is its own unit in `server/plugins/skills/ralosrise/`. Messages, sequences, sounds, amounts and varbits are in `server/plugins/skills/data/ralos-rise.json`. Each blessable bone's blessed form (`blessed`) and shard count (`shards`) are on its row in `server/plugins/skills/data/bones.json`, a hand-maintained file that osrsreboxed-db does not generate.

Sources:
- the OSRS Wiki: [Exposed altar](https://oldschool.runescape.wiki/w/Exposed_altar), [Libation bowl](https://oldschool.runescape.wiki/w/Libation_bowl), [Blessed bone shards](https://oldschool.runescape.wiki/w/Blessed_bone_shards), [Jug of blessed sunfire wine](https://oldschool.runescape.wiki/w/Jug_of_blessed_sunfire_wine), [Pay-to-play Prayer training](https://oldschool.runescape.wiki/w/Pay-to-play_Prayer_training);
- rsprox captures from <https://rsprox.net/database>: recordings 1104, 1141, 1157 and 4054. All four are rev 237 on Leagues VI. Both the altar and the bowl appear in all four.

All the recordings come from a Leagues world. Their Crafting experience is multiplied, so that experience is not used, and their relic effects are ignored: transmutation spotanims, jugs banked to the floor, `leagues_6_bank_heist`. The 4-tick sacrifice pace was recorded with no clicking (1141, ticks 6688-6704), and it matches the Wiki.

## Exposed altar (loc 52799 `varlamore_prayer_activity_altar`, option Bless)

| | |
| --- | --- |
| Requires | 30 Prayer (Wiki). Blessed superior dragon bones need 70 (their row's `level`) |
| Blesses | Every jug of wine (`jug_wine` to `jug_wine_blessed`), every jug of sunfire wine (to `jug_sunfire_wine_blessed`) and every bone that has a `blessed` form, each swapped in its own slot. Noted bones are left alone |
| Cannot be blessed | Burnt, jogre, monkey, shaikahan, wolf, long and curved bones (Wiki) |
| Experience | None |
| Player | `human_lockedchest` with sound 2674 |
| Messages | "You bless # jugs of wine on the altar." and "You bless # bones on the altar." (gamemessage) |
| Nothing to bless | Message box: "You don't have anything suitable to bless on this altar. You'll either need to bring bones or wines to bless." |

Estimated:
- The recordings never show wine and bones blessed together. Blessing both in one click, with the wine line first, is ours.
- The recordings only show the bless lines for 7 to 24 items, so the same wording is used for one.
- The refusals for too low a Prayer level are ours.

## Blessed bone shards

- **Starting:** use a chisel on blessed bones, or pick their Break-down option.
- **Pace:** one bone breaks at once, then another every 4 ticks while that kind lasts (Wiki; recording 1104: +0, +4).
- **Each bone:** plays `human_cutting_restart` with sound 2586 and gives 5 Crafting experience (Wiki).
- **Shards:** each bone gives its row's `shards`. Sun-kissed bones give 45 and bone statuettes 125 (`breakdown.extra`). Both are already blessed.
- **Superior dragon bones:** blessed superior dragon bones need 70 Prayer (Wiki, Blessed bone shards recipe).
- **Estimated:** the refusals for no chisel and for too low a Prayer level are ours.
- **Not covered:** Alan's blessed bones are in the cache, but the Wiki gives them no shard count, so they don't break down.

## Libation bowl (loc 53018 `varlamore_libation_bowl`)

The bowl is a multiloc on varbit 9945 `varlamore_prayer_winequant`, the charges left. The cache transforms are `[52797 varlamore_libation_bowl_empty]`, with `53016 varlamore_libation_bowl_full` as the default:
- at 0, the empty bowl offers Fill;
- from 1 to 400, the full bowl offers Sacrifice and Check.

Varbit 9946 `varlamore_prayer_winetype` holds the wine: 0 for blessed wine, 1 for blessed sunfire wine (recording 4054 tick 4072). Both values are saved as `libation-bowl:charge` and `libation-bowl:wine-type`, and are sent again at login.

| | |
| --- | --- |
| Fill | Uses the first blessed jug carried, which becomes an empty jug. Sets 400 charges and the wine type. Plays `human_pickuptable` with sound 2401 and shows an objectbox with the jug: "You pour some regular blessed wine into the libation bowl." or "...some blessed sunfire wine...". Sacrificing starts 4 ticks later, and that first sacrifice closes the box |
| No wine to fill with | Message box: "You don't have any blessed wine to fill the libation bowl with." |
| A sacrifice | Up to 100 shards, one charge each. Gives 5 Prayer experience a shard (6 with sunfire wine) and costs 2 Prayer points. Plays `human_pray_blessed_bone_shards_01` with sound 958 |
| Pace | Every 4 ticks when left alone. Each click sacrifices at once, at most once a tick, however many clicks arrive (recordings 1104 and 4054: 2-4 clicks a tick, one sacrifice) |
| Zealot's robes | 1.25% a piece, rolled for each shard (Wiki). A saved shard still gives its experience and still uses its charge |
| Refill | On the tick the bowl runs dry, a blessed jug carried refills it. Spam line "You pour some more blessed wine into the libation bowl." and sound 2401, the same for sunfire wine |
| Stops | Message boxes: "You don't have any blessed bone shards to sacrifice into the libation bowl."; "You need at least two prayer points to sacrifice blessed bone shards into the libation bowl." (at the start); "You need at least two prayer points to continue sacrificing blessed bone shards into the libation bowl." (after a sacrifice); "You don't have enough blessed wine to sacrifice any more shards into the libation bowl." (dry, no jug). After a sacrifice, the Prayer check comes before the wine check (1141 tick 6704) |
| Check | "The libation bowl has enough blessed wine left to sacrifice # more blessed bone shards." (the wine type named) |

Estimated (ours):
- The Check wording. No recording or Wiki page gives it.
- The Prayer level 30 refusal.
- Which jug fills first: the first one carried.
- Whether the bowl checks shards or Prayer first when both are missing.
- Repeating the shards line when a sacrifice uses the last shards.
- A Fill with no shards or Prayer points just leaves the bowl filled. No box appears 4 ticks later.

The Prayer loops pause for a level-up pop-up, as the bone altars' loop does (docs/bone-altars.md). They are paced through `skills:action-interval`, kind `libation` (Prayer) and `blessed-bones` (Crafting).

Virilis at the foot of the altar unnotes the bones for 10 coins each (docs/note-exchange.md).

## Not here

- Making sunfire wine (two sunfire splinters on a jug of wine with a pestle and mortar). Recording 1141 has its refusal: "You need two sunfire splinters, a jug of wine, and a pestle and mortar to create sunfire wine."
- Blessed wine being unbankable.
- Soul Harvest's Soul shards (Leagues) in the bowl. There is no capture of their rate (see `SoulHarvest.LeagueRelics.js`).
