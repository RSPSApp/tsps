# Fishing

Fishing spots are `server/plugins/skills/Fishing.plugin.js`: one loop for every spot, with a tool
per spot option (`TOOLS`) and its fish, levels, XP and catch charts (`FISH`). Units with their own
rules sit in `server/plugins/skills/fishing/` (harpoons, the angler's outfit, the Fishing Guild,
minnows, karambwan vessels). Tests: `server/tests/fishing.test.cjs`.

## Sources

- **The OSRS Wiki:** levels, XP and the skilling success charts from each fish's page, the ticks
  between catch rolls from
  [Game tick/Action lengths](https://oldschool.runescape.wiki/w/Game_tick/Action_lengths), and the
  karambwan rules from [Raw karambwan](https://oldschool.runescape.wiki/w/Raw_karambwan),
  [Raw karambwanji](https://oldschool.runescape.wiki/w/Raw_karambwanji),
  [Karambwan vessel](https://oldschool.runescape.wiki/w/Karambwan_vessel),
  [Fishing spot (karambwanji)](https://oldschool.runescape.wiki/w/Fishing_spot_(karambwanji)) and
  [Fishing spot (karambwan)](https://oldschool.runescape.wiki/w/Fishing_spot_(karambwan)), and
  [Fishing](https://oldschool.runescape.wiki/w/Fishing) for the karambwan spots never moving. Heron
  base chances from [Heron](https://oldschool.runescape.wiki/w/Heron).
- **rsprox recordings** ([rsprox.net database](https://rsprox.net/database)): the karambwan and
  karambwanji messages (recordings 75, 83, 96, 792, 1102 and 1779). These are Leagues and Grid Master
  worlds, whose boosts change the speed, so only their messages and item changes are used.

## Catch rolls

- **Ticks per roll (Wiki):** small net (shrimps, anchovies), cage, harpoon and big net spots, and
  the Holy Lake karambwanji, roll every 6 ticks. Rods roll every 5 (fly fishing, bait fishing,
  barbarian fishing, anglerfish); pike takes 6 one time in 5. Karambwan vessels roll every 4,
  minnows every 2. Spots the Wiki's table doesn't list (eels, frog spawn, monkfish, dark crabs)
  keep 5.
- **Chance:** the Wiki's skilling chart, low at level 1 to high at 99, out of 256. A tool's catch
  bonus scales both ends. Several fish on one spot roll highest first, and the first success is
  the catch (a big net rolls each on its own).

## Karambwanji and karambwan

- **Karambwanji (Holy Lake, small net, 5 Fishing):** chart 100/250, then shrimps 48/256 when the
  karambwanji roll fails. A catch lands floor(level / 5) + 1 karambwanji, for 5 XP and one heron
  roll per catch. A full inventory keeps stacking karambwanji, but the shrimps need a free slot.
  Messages (rsprox): "You cast out your net...", "You catch # Karambwanji."
- **Karambwan (vessel, 65 Fishing):** chart 5/160, 50 XP. A baited vessel holds one raw
  karambwanji, and every attempt uses it, caught or not; the vessel then reloads from the
  inventory, and an empty vessel loads itself on the click. Fishing stops when no karambwanji
  are left. The spots never move, so a session runs until the inventory is full.
- **Messages (rsprox):** "You lower the Karambwan vessel." on the click, "You catch a Karambwan!",
  "A Karambwan deftly snatches the Karambwanji from your vessel!" on a miss, and the message box
  "You need a Karambwan vessel to fish here." without a vessel.

## Messages, animations and timing (rsprox)

From rsprox captures 75, 86, 543, 552, 1098, 1102, 1106, 1149, 1710, 1718, 1757, 1858, 3275, 3276
and 3285 (all Leagues, Grid Master or event worlds). Rev 237 recordings 1098, 1102, 1106 and 1149
roll at the Wiki's tick lengths, so their timing is used; the others are used for text only.

- **Channel:** every start, catch and miss line is on the spam channel.
- **Start lines:** nets "You cast out your net...", harpoons "You start harpooning fish.",
  lobster pots "You attempt to catch a lobster.", fly rods, pike and barbarian rods one line
  "You cast out your line...<br>You attempt to catch a fish.", sea bait "You cast out your
  line..." and "You attempt to catch a fish." a tick later (casting again), infernal eels
  "You cast out your line...". Spots of the same kind without captures (frog spawn, monkfish,
  minnows, the other eels, anglerfish) use the same line as their kind; dark crabs keep
  "You begin to fish..".
- **First roll:** 3 ticks after the start line for nets and cages, 4 for harpoons and rods, then
  every roll interval. The tool's animation restarts on every roll, caught or not (minnows'
  2-tick rolls keep a 5-tick animation timer). Rods cast once (`human_fishing_casting`), then
  play `human_fish_onspot` on each roll; barbarian rods use `human_fishing_casting_brut` and
  `human_fishing_onspot_brut`. The infernal eel recording only repeats the cast animation.
- **Catch lines:** "You catch a raw trout" and "You catch a raw salmon" have no full stop;
  "You catch a pike.", "You catch a lobster.", "You catch a shark!", "You catch an infernal eel.
  It hardens as you handle it with your ice gloves."
- **Big net junk:** boots, seaweed, gloves, oyster and casket roll on their own with the Wiki's
  charts ([Fishing spot (big net, harpoon)](https://oldschool.runescape.wiki/w/Fishing_spot_(big_net,_harpoon))):
  10/10, 10/10, 5/5, 3/7, 1/2. The Wiki gives no XP for them; the recordings' XP drops give 1 for
  boots, gloves and seaweed and 10 for oysters and caskets. Lines: "You catch some boots.",
  "You catch some seaweed.", "You catch some gloves.", "You catch an oyster shell.",
  "You catch a casket." They don't roll the heron.
- **Message boxes:** "You can't carry any more fish." on the tick after the catch that fills the
  inventory (or on the click), with the animation reset and sound 2277; "You don't have any
  fishing bait.", "You don't have any feathers left." and "You don't have any suitable bait
  left." (barbarian rod) without bait; "You need to be at least level # Fishing to harpoon these
  fish." and "You need at least level # Fishing to bait these fish." below the level.
  Tempoross uses the same full-inventory box.

## Civitas illa Fortis park pond

- **Spot:** `civitas_park_fishingspot_hmm` (NPC 13329, "Fishing spot", option Cast), stationary.
  [Fishing spot (Civitas illa Fortis)](https://oldschool.runescape.wiki/w/Fishing_spot_(Civitas_illa_Fortis)):
  a big fishing net, level 1, 7.5 XP a catch whatever it lands.
- **Table (Wiki):** jade 1/100 and red topaz 1/505 first, else broken glass 3, old boot 2, big
  fishing net 2, casket 2, house keys 1 (out of 10); a moon key loop half 1/1014 on top.
- **rsprox (237/01098, 7 casts):** `human_largenet` every tick, "You cast out your net...",
  catches 4-10 ticks apart ("You find some broken glass.", "You find a casket.", "You find a big
  fishing net.", "You find some house keys."), and "This is the wrong size net for fishing here."
  in the chat without the net. The other items' lines follow that pattern (ours); the catch rate
  (21/256 a tick) is the recording's, the Wiki gives none.
- The park has its own clue-bottle base (152,120). Rada's blessing and spirit flakes do
  not double its table items (they are not fish).

## Clue bottles (supported methods)

Fishing rolls each eligible tier independently after a supported ordinary catch, using the
[Wiki formula](https://oldschool.runescape.wiki/w/Clue_bottle), the visible Fishing level and
the applicable Combat Achievement points threshold. The ordinary catch batch supplies one
roll set, even when a big net lands several supported fish; this is the implementation's
interpretation of a successful action, not a captured multi-fish observation. Rada's extra
fish do not add a roll set. Fortis park has its own documented base. Inventory, bank and
scroll-case capacity, X Marks the Spot boxes, full-inventory ground placement and league
vessel modifiers use the shared clue services. A worn imbued ring of wealth doubles the
non-beginner bottle rate in the Wilderness; [beginner bottles](https://oldschool.runescape.wiki/w/Clue_bottle_%28beginner%29) are excluded.

Arthur's vessel opt-out suppresses new bottles, geodes and clue nests from their supported
skilling sources without blocking an already held vessel from being opened. TSPS defaults
existing accounts to receiving vessels until they opt out; that compatibility default is
not a captured retail fresh-account observation.

The initial source scope covers the ordinary catches whose existing heron bases are
explicitly listed in Fishing, plus Fortis park. Tutorial Island's separate pond, frog
spawn, slimy eels, lava eels and an ordinary big-net batch containing only non-fish items
retain their prior behavior: their bottle rules are unverified here, not asserted to be
ineligible. Exact drop feedback has not been captured. Spirit-flake extra fish are not
implemented for ordinary Fishing, so this change does not claim a native ordinary-flakes proc.

## Not covered

- Which quest step unlocks karambwan fishing (Lubufu's apprenticeship in Tai Bwo Wannai Trio) is
  not checked: no recording or Wiki page gives the refusal.
- What live OSRS says when the karambwanji run out mid-session is not recorded; the loop stops
  with the generic "You do not have the required bait." So do sandworms and dark fishing bait.
- The missing-tool line ("You don't have the right tool to fish there.") is not recorded.

## Crystal harpoon signets

The [celestial signet](https://oldschool.runescape.wiki/w/Celestial_signet#Passive_effect)
retains the [elven signet](https://oldschool.runescape.wiki/w/Elven_signet#Passive_effect)'s
10% chance to save a crystal equipment charge. Both the charged and uncharged celestial
signet work while worn; carrying a signet does not activate it. Its stardust charges belong
to the Mining effect, rather than this passive saving effect.

Ordinary harpoon fishing previously recognised only the elven signet, so upgrading it to
a celestial signet lost the saving effect. Both celestial signet states now participate in
the existing saving roll. Saving the final charge keeps the harpoon active and still awards
the catch and Fishing XP; a roll of 0.1 or greater spends the charge and the final charge
turns it inactive. The [crystal harpoon](https://oldschool.runescape.wiki/w/Crystal_harpoon#Gaining_and_Consuming_Charges)
then continues to fish with the dragon harpoon's catch bonus.

Regression coverage exercises catch delivery with both celestial signet states and both
carried and wielded harpoons, the final charge, the 10% boundary and carrying the ring
without wearing it. The capture index has no crystal harpoon or signet actions; this
correction relies on the Wiki, rather than a recording or an exact packet/timing comparison.
