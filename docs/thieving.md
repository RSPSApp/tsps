# Thieving: stalls, pickpocketing and blackjacking

Pickpocketing is built from the OSRS Wiki: the [Thieving](https://oldschool.runescape.wiki/w/Thieving#Pickpocketing) page, each target's own page (its skilling success chart, Thieving info and loot), and the [Coin pouch](https://oldschool.runescape.wiki/w/Coin_pouch), [Rogue equipment](https://oldschool.runescape.wiki/w/Rogue_equipment), [Gloves of silence](https://oldschool.runescape.wiki/w/Gloves_of_silence), [Dodgy necklace](https://oldschool.runescape.wiki/w/Dodgy_necklace) and [Thieving cape](https://oldschool.runescape.wiki/w/Thieving_cape) pages. Item and NPC ids come from the cache.

## Layout

| File | What it owns |
| --- | --- |
| `server/plugins/skills/data/pickpocketing.json` | Every target: its NPCs, level, experience, success chart, stun damage, coin pouch, quest, pet rate and loot. |
| `server/plugins/skills/Thieving.plugin.js` | Module registration. |
| `server/plugins/skills/thieving/Stalls.Thieving.js` | Stall attempts, rewards, depletion and merchant memory. |
| `server/plugins/skills/thieving/Blackjacking.Thieving.js` | Pollnivnian bandit/thug lure, knockout and the shared pickpocket target event. |
| `server/plugins/skills/thieving/Pickpocket.Thieving.js` | The pickpocket itself: checks, timing, success, loot, failure and the equipment effects. |
| `server/plugins/skills/thieving/CoinPouch.Thieving.js` | Opening coin pouches ("Open-all" and "Open"). |

## Stalls

`server/plugins/skills/thieving/Stalls.Thieving.js` owns stall theft, alongside the pickpocket modules.

### Sources

- [Thieving: stalls](https://oldschool.runescape.wiki/w/Thieving#Stalls): success is guaranteed outside an owner's/guard's line of sight; multiple players may steal during the same tick. Current restock times are bakery/tea/seed 4 ticks, silk/wine 8, fur 12, silver 32, spice 10 and gem 100. Keldagrim bakery is 16 ticks.
- [Wine stall](https://oldschool.runescape.wiki/w/Market_stall_(wine)): level 22, 27 XP; bottle of wine/grapes/jug/jug of water/jug of wine weights 11/17/39/20/13 out of 100.
- [Silver ore](https://oldschool.runescape.wiki/w/Silver_ore#Item_sources), [silver bar](https://oldschool.runescape.wiki/w/Silver_bar#Item_sources), [tiara](https://oldschool.runescape.wiki/w/Tiara#Item_sources): ordinary silver-stall weights 16/3/1 out of 20. Level 50 and 205 XP; spice is level 65 and 92 XP.
- [Thieving training](https://oldschool.runescape.wiki/w/Thieving_training#Levels_5%E2%80%9325:_Bakery_stalls): standing under the baker is a safe spot, so an owner sharing the thief's tile does not spot them.
- [Prifddinas marketplace](https://oldschool.runescape.wiki/w/Prifddinas#Meilyr_district), [Keldagrim](https://oldschool.runescape.wiki/w/Keldagrim#Shops): named owners supplement the generic merchant names.
- [Port Roberts](https://oldschool.runescape.wiki/w/Port_Roberts#Marketplace_thieving): its stalls never deplete. Their automatic stealing and timed guard/jail activity is separate content and is not implemented here.

IDs and actions were checked in cache `osrs-241_2026-10-20` with `dump:loc`, `CacheDefinitions` and the cache's LOC gamevals. Ardougne silver/spice are 11734/11733. Draynor wine is 14011 (`Market stall`, `Steal-From`); its empty 14012 retains the same action, so it must not grant loot. Other empty models are 634 (ordinary), 6944 (Hosidius bakery), 6984 (Keldagrim), 36568 (Prifddinas) and 51932 (Fortis).

### Captured attempt and outcome

Rsprox recording **3220** shows the tea attempt message, `human_pickuptable` and sound 2581 together, followed one tick later by the success message, one cup of tea, the empty stall and `marketthief_tea = 1`. Recording **1554** shows the same one-tick separation for bread, silver ore and an uncut sapphire, setting `marketthief_cake`, `marketthief_silver` and `marketthief_gem` respectively. Caught silver and gem attempts in 1554 show the attempt message and an owner warning, without a success animation, reward or an extra caught-stealing chat message. Silver attempts repeat on consecutive ticks before succeeding; failed attempts therefore do not start the success cooldown. The gem owner also catches a thief sharing his tile; the documented bakery safe spot is not a general owner exemption. The captures' XP deltas are not used to set reward amounts; the Wiki supplies those amounts.

The attempt now faces the stall and checks its lookouts. On success it plays cache animation `human_pickuptable` (**832**, rather than pickpocket animation 881), with sound 2581. Loot, XP, the recorded success message, theft state and depletion follow on the next tick. Restocking counts from depletion. Attempts begun together can both complete; later clicks cannot steal from the empty stall. A full inventory at completion prevents both loot and XP.

### Merchant memory

The [Thieving stalls section](https://oldschool.runescape.wiki/w/Thieving#Stalls) says successful theft prevents interaction with owners of that stall type for ten consecutive in-game minutes. [Silk merchant](https://oldschool.runescape.wiki/w/Silk_merchant) confirms the ten-minute wait restarts after logging back in. Specific NPC pages give different waits: [Baker](https://oldschool.runescape.wiki/w/Baker) says fifteen minutes, and [Spice seller](https://oldschool.runescape.wiki/w/Spice_seller) says six. The implementation follows those specific durations for bakery and spice, with ten minutes for the other supported types. No recording measured expiration; the disagreement between the general and specific Wiki pages remains an evidence limitation.

Successful theft now sets a saved, namespaced merchant-memory attribute and the corresponding cache theft varbit, including the separate Keldagrim, Fremennik and Prifddinas keys. A new theft resets that type's timer. Logout cancels its timer; login starts a full consecutive wait again. Expiry clears the memory and varbit. Idle players with no recent theft have no theft timer.

Named Talk-to/Trade hooks stop recent thieves reaching ordinary dialogue or a shop. Refusal speech is shown in [Transcript:Tea Seller](https://oldschool.runescape.wiki/w/Transcript:Tea_Seller), [Transcript:Baker](https://oldschool.runescape.wiki/w/Transcript:Baker), [Transcript:Silk merchant](https://oldschool.runescape.wiki/w/Transcript:Silk_merchant), [Transcript:Spice seller](https://oldschool.runescape.wiki/w/Transcript:Spice_seller), [Transcript:Olivia](https://oldschool.runescape.wiki/w/Transcript:Olivia) and [Transcript:Fortunato](https://oldschool.runescape.wiki/w/Transcript:Fortunato). They identify the thief and call guards; Fortunato uses a different first line. The Baker, Tea Seller, Spice seller, Olivia and Fortunato transcripts also give the owner's warning when catching an attempt. Recording **1554** also confirms both Talk-to and Trade refusal by the gem merchant and Trade refusal by the silver merchant: the guard call follows the initial overhead line by **two ticks**. A nearby idle guard responds to a remembered thief's interaction.

### Validation and limits

Earlier validation of the previous stall implementation recorded an Ardougne knight catching silver theft without loot/XP; unseen Kourend silver gave 205 XP and restocked after 32 ticks; Fortis spice and Draynor wine dispatched their cache options and could be caught. Those are historical checks, separate from the current checks below.


The stall regressions cover attempt/outcome separation, cache animation and sound, reward/XP, captured varbits, merchant refusal and expiration, consecutive caught attempts, the non-bakery same-tile catch, repeated theft, logout/login, simultaneous thieves, stale clicks, restock, inventory changes during an attempt and private-area destruction. The original handler fails the new timing, state, refusal and caught-attempt assertions. The adjacent pickpocket tests retain their existing gameplay coverage; their registration fixture includes the new lifecycle hooks.

Live checks confirmed a level-one player cannot steal tea. With the skill requirement supplied, an unseen Varrock theft grants one cup of tea and **16 XP**, sets varbit **170**, empties/restocks the stall, and prevents trading with the Tea Seller, who calls guards. Logout/login preserved the item, theft flag and refusal on Talk-to. Timer boundary checks use deterministic regressions rather than a captured expiration measurement.

Every attempt and steal line is a spam message (rsprox captures 1554 and 3220, and the Leagues stalls in 1098, 1102, 1104 and 1105). A stolen item without its own line is named with its article: "You steal a cake.", "You steal a chocolate slice." (1098), "You steal a silver bar." (1105), "You steal an uncut emerald." (1104), "You steal a banana." (3275). Bread, silver ore, silk ("You attempt to steal some silk from the silk stall." / "You steal a piece of silk.", 1098 and 1102) and tea keep their own lines. Items not seen in a capture (fur, spice, wine stall items, seeds, tiara, the other fruit) follow the same rule, with "some" for a plural name such as jangerberries.

The Hosidius **Fruit Stall** (28823, empty 27537) follows its Wiki page: level 25, 28.5 XP, restocked after 4 ticks, cooking apple 40/100 down to papaya fruit 1/100, and the `marketthief_hosidius` varbit (capture 3275, Grid Master). Its guard dogs are among the stall guards; they attack a thief they see without the guards' "Hey! Get your hands off there!".

Five tiles remains a provisional lookout radius. The available stall captures do not establish exact guard detection range or facing. Guard sight now follows the [Line of sight](https://oldschool.runescape.wiki/w/Line_of_sight) page's rule that another character blocks the view: a character sharing the thief's tile hides them from guards, which is what makes the documented bakery safe spot (standing under the baker) work even when a guard has an unobstructed path to the tile. The owner's check stays separate, so an owner sharing the thief's tile can still catch them outside the bakery spot (recording 1554). Merchant overhead-line timing is calibrated against the gem and silver refusals in 1554. Characters standing elsewhere along the ray are not yet treated as blockers. The existing scenery visibility ray and busy-guard exclusion are retained. Port Roberts' automatic stealing/jail activity belongs to a separate mechanic and remains unimplemented. No generated data changes are required.

## Targets

Success is out of 256, at level 1 / level 99. A `*` marks a target whose page has no success chart (the Wiki lists its rate as unknown). These targets use the chart of the closest documented target at or below their level, named in the data file's `estimatedFrom`.

| Target | NPCs | Level | XP | Success | Stun damage | Coins per pouch | Requirement |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [Man](https://oldschool.runescape.wiki/w/Man) | Man, Woman, Citizen | 1 | 8 | 180/240 | 1 | 3 |  |
| [Farmer](https://oldschool.runescape.wiki/w/Farmer) | Farmer | 10 | 14.5 | 150/240 | 1 | 9 |  |
| [H.A.M. member](https://oldschool.runescape.wiki/w/H.A.M._Member) | H.A.M. Member | 15 | 22.2 | 135/239 | 1–3 | 1–21 |  |
| [Workman](https://oldschool.runescape.wiki/w/Digsite_workman) | Digsite workman | 25 | 10.4 | 100/240* | 1 | – |  |
| [Warrior](https://oldschool.runescape.wiki/w/Warrior_(Thieving)) | Warrior, Al Kharid warrior | 25 | 26 | 100/240 | 2 | 18 |  |
| [Rogue](https://oldschool.runescape.wiki/w/Rogue) | Rogue | 32 | 36.5 | 75/240 | 2 | 25–40 |  |
| [Cave goblin](https://oldschool.runescape.wiki/w/Cave_goblin_(Dorgesh-Kaan)) | Cave goblin | 36 | 40 | 75/240* | 1 | 10–50 | Death to the Dorgeshuun |
| [Master farmer](https://oldschool.runescape.wiki/w/Master_Farmer) | Master Farmer, Martin the Master Gardener | 38 | 43 | 90/240 | 3 | – |  |
| [Guard](https://oldschool.runescape.wiki/w/Guard) | Guard | 40 | 46.8 | 50/240 | 2 | 30 |  |
| [Fremennik citizen](https://oldschool.runescape.wiki/w/Fremennik_citizen) | Agnar, Borrokar, Freidir and 6 more | 45 | 65 | 50/240* | 2 | 40 | The Fremennik Trials |
| [Wealthy citizen](https://oldschool.runescape.wiki/w/Wealthy_citizen) | Wealthy citizen | 50 | 96 | 35/200 | 3 | 85 |  |
| [Bandit](https://oldschool.runescape.wiki/w/Bandit_(Bandit_Camp)) | Bandit | 53 | 79.4 | 50/240 | 3 | 30 |  |
| [Knight](https://oldschool.runescape.wiki/w/Knight_of_Ardougne) | Knight of Ardougne | 55 | 84.3 | 50/240 | 3 | 50 |  |
| [Knight](https://oldschool.runescape.wiki/w/Knight_of_Varlamore) | Knight of Varlamore | 55 | 84.3 | 50/240* | 3 | 50 | Children of the Sun |
| [Pirate](https://oldschool.runescape.wiki/w/Pirate_(Thieving)) | Pirate | 60 | 72 | 50/240* | 3 | 20 |  |
| [Menaphite thug](https://oldschool.runescape.wiki/w/Menaphite_Thug) | Menaphite Thug | 65 | 137.5 | 50/160 | 5 | 60 |  |
| [Watchman](https://oldschool.runescape.wiki/w/Watchman) | Watchman | 65 | 137.5 | 15/160 | 3 | 60 |  |
| [Paladin](https://oldschool.runescape.wiki/w/Paladin) | Paladin | 70 | 131.8 | 40/170 | 3 | 80 |  |
| [Gnome](https://oldschool.runescape.wiki/w/Gnome) | Gnome, Gnome woman, Gnome child | 75 | 133.3 | 43/175 | 1 | 300 |  |
| [Hero](https://oldschool.runescape.wiki/w/Hero) | Hero | 80 | 163.3 | 39/160 | 3 | 200–300 |  |
| [Vyre](https://oldschool.runescape.wiki/w/Vyre_(Thieving)) | Caninelle Draynar, Carnivus Belamorta, Diphylla Bechstein and 27 more | 82 | 306.9 | 8/128 | 5 | 230–315 | Sins of the Father |
| [Elf](https://oldschool.runescape.wiki/w/Elf_(Thieving)) | Arvel, Goreu, Kelyn, Mawrth | 85 | 353.3 | 6/100 | 5 | 280–350 | Mourning's End Part I |
| [Elf](https://oldschool.runescape.wiki/w/Elf_(Thieving)) | Anaire, Aranwe, Aredhel and 46 more | 85 | 353.3 | 6/100 | 5 | 280–350 | Song of the Elves |
| [TzHaar-Hur](https://oldschool.runescape.wiki/w/TzHaar-Hur) | TzHaar-Hur | 90 | 103.4 | -200/200 | 4 | – | Fire cape |

## How a pickpocket plays out

Every line below is a spam message (rsprox captures 335, 338, 339, 691, 2601, 3059 and the Leagues and Grid Master recordings), except the Digsite workman's.

1. **The click tick:** the checks run, the attempt message is sent ("You attempt to pick the man's pocket.") and the two-tick cooldown starts. The checks are the level, the requirement, the stun, combat, the coin pouch limit and inventory space.
2. **The outcome tick, either way:** the player stops tracking the NPC and faces the tile it stood on, so a walking NPC isn't followed round.
3. **The next tick, on success:** the pickpocket animation (881), the loot, "You pick the man's pocket.", the loot's own lines, the pickpocket sound (2581) and the experience. The loot's lines, as captured:
   - the Master Farmer counts his seeds: "You steal 3 potato seeds.", "You steal 1 redberry bush seed.", "You steal 6 Krandorian hop seeds." (335, 338; bush and hop seeds are named as their gamevals, not their item names);
   - H.A.M. members name each item: "You steal a bronze dagger.", "You steal some thread.", "You steal a piece of cow hide.", "You steal a herb.", and "You steal a coin pouch." for their coins (1723, 3275). Coal wasn't seen and has no line;
   - any clue scroll: "You steal a clue scroll." (1102, 1104, 1105, 1723, 3273, 3275);
   - other targets' loot, a man's coin pouch included, has no line.
4. **The next ticks, on failure** (from an rsprox capture of a hero, 2026-10-05):
   - **The next tick:** "You fail to pick the man's pocket." and the NPC's line ("What do you think you're doing?"), with no pickpocket animation.
   - **A tick later:** the NPC turns and strikes (its attack animation). The player blocks under the stunned_thieving graphic (245, height 124), the stun sound (2727) plays, and the 9-tick stun starts. Pickpocketing is blocked for 8 of those ticks, and no new attempt can start before the stun lands.
   - **A tick after that:** "You've been stunned!" and the target's stun damage.
5. **Success chance:** the Wiki's interpolation, `(floor(low × (99 − level) / 98 + high × (level − 1) / 98 + 0.5) + 1) / 256`. Each bonus scales low and high first, rounded down.
6. **Loot**, from the data file:
   - every `always` item;
   - then each `first` roll in order (clue scrolls, the Prifddinas crystal shard and enhanced crystal teleport seed, the vyre blood shard), where a hit replaces the table;
   - then one weighted `table` roll.

   Coins are given as the target's coin pouch.
7. **Clue scrolls:** a clue is a scroll box once X Marks the Spot is complete. Rolling a tier the player already owns, carried or banked, gives nothing.
8. **Master Farmer:** its herb seeds follow Farming level, as in the Wiki's calculator. Herb seeds are 48/1000 of its loot. Within that, ranarr, snapdragon and torstol share `(6 + min(85, Farming)) / 1000`, and guam gets 0.401 minus that.
9. **Digsite workman:** "Steal-from" rather than "Pickpocket". After The Dig Site, coins are 4/11 and the animal skull no longer drops. His lines are game messages that trail off: "You attempt to pick the workman's pocket...", "You pick the workman's pocket...", then "You find a specimen brush." (3228), "You steal some rope." or "You steal a bucket." (90). His other loot has no captured line.
10. **Names in the lines** (`messageName` and `messageNames` in the data file): "the Master Farmer", "Martin" for Martin the Master Gardener (95), "the man" and "the woman" for the two H.A.M. members (2540, 2541), "the Menaphite" for the thug and "the Bandit" in the Bandit Camp (1757, 1788, 1858).

## Equipment and effects

- **Gloves of silence:** ×1.05 success. They wear out after 62 failed pickpockets, which are counted on the player.
- **Thieving cape** (or a max cape): ×1.1 success, multiplied with the gloves.
- **Rogue equipment:** 15% double loot per piece; the full set of 5 always doubles. A doubled coin pouch gives one pouch plus that pouch's coins (the lowest of a range). Clue scrolls are never doubled.
- **Shadow Veil:** a 15% chance to avoid the stun, rolled first.
- **Dodgy necklace:** a 25% chance to avoid the stun and damage. It has 10 charges, stored on the player; the last one crumbles it.
- **Coin pouches:** Open-all says "You open all of the pouches and receive a total of N coins." as a spam message with synth 2115, even for a single pouch (2601, 3059 and others). Open (one pouch) isn't captured and keeps "You open the pouch and find N coins.". A stack of 28 of one kind blocks pickpocketing until the pouches are opened; the Ardougne Diary raises that to 56 (Medium), 84 (Hard) and 140 (Elite), see [diary-rewards.md](diary-rewards.md#ardougne-pickpocketing). With a full inventory, a coins-only target can still be pickpocketed while its pouch stack has room.

## Digsite workman success timing

Rsprox recording **3228**, decoded against revision **232**, shows the workman attempt at tick **1988** and its successful outcome at **1991**, three tick intervals later. Success animation 881 and the specimen-brush line accompany the outcome. The decoder emitted ByteBuf leak diagnostics. This observation covers a successful attempt; it does not establish failure timing, the minimum repeat cadence or relic-specific repeats.

Successful workman rewards now resolve on the third task tick. Other targets retain their ordinary outcome delay. A delayed completion only clears or repeats the interaction it owns, so an older workman task cannot clear a newer accepted interaction. The existing click cooldown and failure timing are unchanged.

At revision `679a09dac94fc863c620be90657e479e0424c730` with cache `osrs-242_2026-11-03`, the native build/cache run passed **35/35** `thieving-pickpocket.test.cjs` tests and **1/1** `thieving-workman-timing-native.test.cjs` test. From a built server with that cache installed, run `node --test --test-concurrency=1 tests/thieving-pickpocket.test.cjs` and `node --test --test-concurrency=1 tests/thieving-workman-timing-native.test.cjs`. The native fixture uses registered NPC handlers, seeded adjacent actors, deterministic randomness and manual task ticks. It checks no reward on ticks one/two, one reward and 10.4 XP on tick three, no duplicate reward, level refusal and the next ordinary Man pickpocket. It does not test natural walking, a rendered client, workman message-versus-inventory order, failure timing or relic repeat cadence. Overlapping-interaction and unavailable-actor controls are mocked unit tests.

The earlier cache-241 comparison used the same native fixture: baseline `42bdbf131bb5f5321cfed8a5414cfbd2e1c3ba17` failed at the first-tick no-XP assertion; later assertions were unreached. Fixed `22f0c8a3e67ed5a6b21255948fea4f13cae684d5` passed the then-current 30 unit tests and one native test. That comparison is causal timing evidence on cache 241; the later 679a run establishes the scoped cache-242 integration result.

## Requirements

Quest requirements are checked with the `quest:is-complete` event, falling back to the quest's stage attribute. A quest that isn't in the game yet counts as not completed, so its targets stay locked until it's added:
- Death to the Dorgeshuun (cave goblins)
- Children of the Sun (Knights of Varlamore)
- Sins of the Father (vyres)
- Mourning's End Part I (Lletya elves)
- Song of the Elves (Prifddinas elves)

TzHaar-Hur need a fire or infernal cape (including their max-cape versions), worn or carried. That's the Wiki's requirement for entering Mor Ul Rek, which has no entrance check here.

## Blackjacking

Sources: [Blackjack](https://oldschool.runescape.wiki/w/Blackjack?action=raw), [Thieving training](https://oldschool.runescape.wiki/w/Thieving_training?action=raw), [Pollnivnian bandits](https://oldschool.runescape.wiki/w/Bandit_(Pollnivneach)?action=raw), [Menaphite Thug](https://oldschool.runescape.wiki/w/Menaphite_Thug?action=raw), and [Coin pouch](https://oldschool.runescape.wiki/w/Coin_pouch?action=raw). The Blackjacking page redirects to Thieving training.

- Lure and Knock-Out require learning the technique during The Feud (stage 9), an equipped blackjack, and 45/55/65 Thieving for bearded bandits/unbearded bandits/thugs. Lure makes the target follow, allowing the player to take it behind a closed door.
- The cache's bearded bandits are 736/737 (65 XP); unbearded bandits are 734/735 (84.3 XP). The Feud keeps the unlocked NPC transforms after completion, so the client still offers Lure and Knock-Out after relogging.
- Knock-Out is refused during combat or when another blackjacking target can see the player. The Wiki does not require standing behind the target.
- All blackjacks and target types use the Blackjack page's chart: low 80, high 240, interpolated by Thieving level. Its cited Jagex explanation explicitly says the rate is independent of target type. The Menaphite Thug subpage instead lists low 78; the main Blackjack page wins here.
- Success gives 10 Thieving XP and holds the NPC unconscious for six ticks, with two guaranteed pickpockets. Those reuse the normal pickpocket cooldown, loot, rogue equipment, XP and pet path, using the bending animation and direct coins. A full inventory permits them if coins already have a stack; the coin-pouch cap does not stop them.
- Captured knock-out (1788, 1858, Leagues V): the swing is `human_blunt_pound` with synth 1842; a tick later "You smack the bandit over the head and render them unconscious." (spam), the target says "Zzzzzz" and plays `human_unconscious`. It wakes with "Arghh my head." and `human_ready`. A failed swing says "Your blow only glances off the bandit's head." (spam) and the target "I'll kill you for that!", and strikes a tick later. An unconscious target answers a second knock-out with "I can't do that. They're unconscious."
- Failure makes the NPC aggressive a tick later. A quick retry or pickpocket cancels that pending aggression, including a pickpocket with a full inventory. An attempt with a different weapon stops the target attacking, matching the documented reset method.
- Awake bandits give coin pouches (40/50 coins); thugs give 60. The Wiki has no awake Pollnivnian success chart, so those two targets follow this module's established estimated-chart policy using the awake thug's 50/160 chart. Their stun damage is also estimated from the thug. These awake-only values need an OSRS capture before claiming exact parity.
- The Wiki guarantees two pickpockets but gives no exact knockout/failure/lure tick counts. The six-tick unconscious window and ten-tick lure window are implementation timings needing a capture; no other RSPS was used. The capture shows the failed swing's strike landing as a stun (`stunned_thieving`) with 4 damage; its length isn't captured, so the target attacks normally instead.

## Not modelled

- **Villagers after The Feud:** the quest retains its own tutorial lure and knockout; generic post-quest villagers are not implemented.
- **Wealthy citizen:** the street urchin distraction, which lets them be pickpocketed repeatedly with one click.
- **The Ardougne diary:** no diary system exists yet. Its effects would be +10% success (medium: in Ardougne; hard: everywhere), the gloves of silence becoming ineffective, and coin pouch limits of 56, 84 and 140.
- **Location- or quest-only loot:** the Pirate's medallion fragment (The Onyx Crest only), the Pirate's very rare medium clue (no rate given), and the H.A.M. robe table during Death to the Dorgeshuun.
- **The H.A.M. camp's failures:** "You feel slightly concussed from the blow.", "Your agility helps you partially avoid the blow." and "You're beaten unconscious and bundled out of the HAM Camp." (1723, Leagues V, and the Wiki). A failure here is the ordinary stun.
- **The in-game loot tracker:** OSRS adds each pickpocket's loot to it (client script 7192, `loottracker_lootadd`).

## Cache NPCs with a Pickpocket option that this doesn't cover

- **Quest plugins:** Twig and Berry (Troll Stronghold), Curator Haig Halen (The Golem), Dr Fenkenstrain (Creature of Fenkenstrain) and Sandy (The Hand in the Sand) handle their own.
- **Villagers:** generic post-quest pickpocketing is not implemented; The Feud owns its tutorial interaction.
- **No Wiki pickpocket data:** Anja, Hengel, Drunken man, Head Guard, Student, Tourist, Priest, Zealot, Salvager, Adala, Constantinius, Cozyac, Istoria, Movario, Patzi, Pavo, Xocotla, Emissary Ascended, Cuffs, Jeff, Narf, Rusty, 'Black-eye', 'Gummy', 'No fingers' and 'The Guns'.

## Unverified details

These aren't on the Wiki and are worth checking against a capture:
- **Messages:** the requirement messages, the single coin pouch's line, the dodgy necklace's charge and crumble messages, and "Your gloves of silence have worn out."
- **NPC names in messages:** NPC names are lowercased, except the captured ones above and TzHaar-Hur. Named NPCs (Fremennik citizens, vyres and elves) keep their own names without "the".
- **The Master Farmer's line** "Cor blimey mate, what are ye doing in me pockets?" is captured (335, 339); the other targets use "What do you think you're doing?".
- **Stun length:** each target's Thieving info lists a stun timer of 4–6 s. The stun here is the 9 ticks of no movement and 8 of no pickpocketing that the Thieving page gives for all targets. The capture confirms 9 ticks of no movement for a hero, whose page says 6 s; the 8-tick pickpocket lock wasn't captured.
- **Pet rates:** the Digsite workman and the Knight of Varlamore have no Rocky rate on the Wiki. They use the Warrior's and the Knight of Ardougne's.
