# Thieving: pickpocketing

Pickpocketing is built from the OSRS Wiki: the [Thieving](https://oldschool.runescape.wiki/w/Thieving#Pickpocketing) page, each target's own page (its skilling success chart, Thieving info and loot), and the [Coin pouch](https://oldschool.runescape.wiki/w/Coin_pouch), [Rogue equipment](https://oldschool.runescape.wiki/w/Rogue_equipment), [Gloves of silence](https://oldschool.runescape.wiki/w/Gloves_of_silence), [Dodgy necklace](https://oldschool.runescape.wiki/w/Dodgy_necklace) and [Thieving cape](https://oldschool.runescape.wiki/w/Thieving_cape) pages. Item and NPC ids come from the cache.

## Layout

| File | What it owns |
| --- | --- |
| `server/data/definitions/pickpocketing.json` | Every target: its NPCs, level, experience, success chart, stun damage, coin pouch, quest, pet rate and loot. |
| `server/plugins/skills/Thieving.plugin.js` | Stalls, and registering the two modules below. |
| `server/plugins/skills/thieving/Pickpocket.Thieving.js` | The pickpocket itself: checks, timing, success, loot, failure and the equipment effects. |
| `server/plugins/skills/thieving/CoinPouch.Thieving.js` | Opening coin pouches ("Open-all" and "Open"). |

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

1. **The click tick:** the checks run, the attempt message is sent ("You attempt to pick the man's pocket.") and the two-tick cooldown starts. The checks are the level, the requirement, the stun, combat, the coin pouch limit and inventory space.
2. **The outcome tick, either way:** the player stops tracking the NPC and faces the tile it stood on, so a walking NPC isn't followed round.
3. **The next tick, on success:** the pickpocket animation (881), the loot, "You pick the man's pocket.", the pickpocket sound (2581) and the experience.
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
9. **Digsite workman:** "Steal-from" rather than "Pickpocket". After The Dig Site, coins are 4/11 and the animal skull no longer drops.

## Equipment and effects

- **Gloves of silence:** ×1.05 success. They wear out after 62 failed pickpockets, which are counted on the player.
- **Thieving cape** (or a max cape): ×1.1 success, multiplied with the gloves.
- **Rogue equipment:** 15% double loot per piece; the full set of 5 always doubles. A doubled coin pouch gives one pouch plus that pouch's coins (the lowest of a range). Clue scrolls are never doubled.
- **Shadow Veil:** a 15% chance to avoid the stun, rolled first.
- **Dodgy necklace:** a 25% chance to avoid the stun and damage. It has 10 charges, stored on the player; the last one crumbles it.
- **Coin pouches:** a stack of 28 of one kind blocks pickpocketing until the pouches are opened. With a full inventory, a coins-only target can still be pickpocketed while its pouch stack has room.

## Requirements

Quest requirements are checked with the `quest:is-complete` event, falling back to the quest's stage attribute. A quest that isn't in the game yet counts as not completed, so its targets stay locked until it's added:
- Death to the Dorgeshuun (cave goblins)
- Children of the Sun (Knights of Varlamore)
- Sins of the Father (vyres)
- Mourning's End Part I (Lletya elves)
- Song of the Elves (Prifddinas elves)

TzHaar-Hur need a fire or infernal cape (including their max-cape versions), worn or carried. That's the Wiki's requirement for entering Mor Ul Rek, which has no entrance check here.

## Not modelled

- **Blackjacking:** knocking out and luring Pollnivneach villagers, bandits and thugs. The villagers and Pollnivneach bandits are left out, since the Wiki gives no plain pickpocket rate for them. Menaphite thugs can be pickpocketed normally.
- **Wealthy citizen:** the street urchin distraction, which lets them be pickpocketed repeatedly with one click.
- **The Ardougne diary:** no diary system exists yet. Its effects would be +10% success (medium: in Ardougne; hard: everywhere), the gloves of silence becoming ineffective, and coin pouch limits of 56, 84 and 140.
- **Location- or quest-only loot:** the Pirate's medallion fragment (The Onyx Crest only), the Pirate's very rare medium clue (no rate given), and the H.A.M. robe table during Death to the Dorgeshuun.
- **The Digsite workman** being twice as slow to pickpocket as other NPCs.
- **The in-game loot tracker:** OSRS adds each pickpocket's loot to it (client script 7192, `loottracker_lootadd`).
- **Spam filtering:** OSRS sends the pickpocket messages as spam-type messages, which players can filter out. Here they are ordinary game messages.

## Cache NPCs with a Pickpocket option that this doesn't cover

- **Quest plugins:** Twig and Berry (Troll Stronghold), Curator Haig Halen (The Golem), Dr Fenkenstrain (Creature of Fenkenstrain) and Sandy (The Hand in the Sand) handle their own.
- **Blackjacking (not modelled):** Villager, and the Pollnivneach bandits (NPC ids 734–737, which share the name "Bandit" with the Bandit Camp's 690 and 695).
- **No Wiki pickpocket data:** Anja, Hengel, Drunken man, Head Guard, Student, Tourist, Priest, Zealot, Salvager, Adala, Constantinius, Cozyac, Istoria, Movario, Patzi, Pavo, Xocotla, Emissary Ascended, Cuffs, Jeff, Narf, Rusty, 'Black-eye', 'Gummy', 'No fingers' and 'The Guns'.

## Unverified details

These aren't on the Wiki and are worth checking against a capture:
- **Messages:** the requirement messages, the coin pouch opening messages, the dodgy necklace's charge and crumble messages, and "Your gloves of silence have worn out."
- **NPC names in messages:** NPC names are lowercased, except the H.A.M. member, the Menaphite thug and TzHaar-Hur. Named NPCs (Fremennik citizens, vyres and elves) keep their own names without "the".
- **The Master Farmer's line** "Cor blimey mate, what are ye doing in me pockets?". The Wiki only confirms "Cor blimey"; the other targets use "What do you think you're doing?".
- **Stun length:** each target's Thieving info lists a stun timer of 4–6 s. The stun here is the 9 ticks of no movement and 8 of no pickpocketing that the Thieving page gives for all targets. The capture confirms 9 ticks of no movement for a hero, whose page says 6 s; the 8-tick pickpocket lock wasn't captured.
- **Pet rates:** the Digsite workman and the Knight of Varlamore have no Rocky rate on the Wiki. They use the Warrior's and the Knight of Ardougne's.
