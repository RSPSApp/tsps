# Alfred Grimhand's Barcrawl drinks

Each of the ten bars on the Barcrawl card serves its drink with its own lines, stat drops, Hitpoints damage
and, at the Rising Sun, a swaying screen ([Wiki: Alfred Grimhand's Barcrawl (revision 15366023)](https://oldschool.runescape.wiki/w/Alfred_Grimhand%27s_Barcrawl?oldid=15366023)).
They are part of the miniquest's plugin, `server/plugins/quests/quests/AlfredGrimhandsBarcrawl.Quest.js`
(`BARS`, `playDrink`).

Before this, a drink took the coins and signed the card, and its lines all came at once.

## Where the drink is offered

A bar offers its drink only while the player carries the Barcrawl card and has not had that bar signed. The Wiki's
Flying Horse transcript has this condition ("If the player has a barcrawl card in their inventory without Flying
Horse Inn completed"). Zembo's and the Blurberry Bar barman's transcripts say "During Alfred Grimhand's
Barcrawl", the Rusty Anchor's "If the player has started but not finished". After the crawl, a card taken to any bar
starts it over (Wiki: Barcrawl card): the drink clears the other signatures, and the guard keeps the course shut
until the card is handed in again. Vial smashing stays as it was, and its settings row stays open then only once
Scorpion Catcher is done, as the cache's lock for the row has it.

The bartender's usual conversation plays, and its menu gets the option "I'm doing Alfred Grimhand's Barcrawl." in the
wording and place of the Wiki's Barcrawl transcript. Bandit-HaxUnit's local rsprox recording 1002001 (revision 242)
shows it so in the Blue Moon Inn's, the Jolly Boar Inn's and, before Recipe for Disaster, Kaylee's menus. Blurberry goes
straight to it, and the Blurberry Bar's barman offers "I'm trying to do Alfred Grimhand's barcrawl.", which sends the
player to Blurberry, under the same condition.

The Rising Sun's barmaids open with "Heya! What can I get you?" and a menu of "What ales are you serving?", which
plays the barmaid's own ales talk, and the Barcrawl option (Wiki: the Barcrawl transcript; rsprox recordings 3241
and 1636 for the greeting and the ales talk). During Recipe for Disaster's Golden Nectar step, their Talk-to is that
quest's talk, and the Barcrawl option joins its menu before "What can you tell me about dwarves and ale?", as the
Wiki's Barcrawl transcript shows the three options together. After that step the barmaids still offer the dwarves
option (the same recordings), so the Barcrawl menu keeps it last; it plays the quest's "again" talk (Wiki: the
quest's transcript; that it plays after the step is an inference).

During Song of the Elves' insurrection step, the Flying Horse Inn bartender's Talk-to is that quest's tax talk. The
tax talk has no menu (Wiki: the quest's transcript, "Taxing the bar"), and his own talk reaches its menu only after
"What do you serve?", so the Barcrawl option does not show there.

Using the card on the Flying Horse Inn's bartender while the bar offers the drink starts the Barcrawl at once
(Wiki: his transcript, "Same as above"), during Song of the Elves too. The other bartenders do the same; at the
Rising Sun the barmaid's menu comes without the greeting, and the Blurberry Bar's barman points to Blurberry. When
the bar does not offer the drink, the Rising Sun's barmaids answer "No thanks, I don't need that.", their
transcripts' answer to any other item. At every other bartender and the barman, the player gets the game message
"Nothing interesting happens.", the standard message for an item with no use (Wiki: Choose Option).

Zembo's transcript has an empty box (`{{tbox|}}`) after his greeting. Bandit-HaxUnit's local rsprox recording
1002303 (revision 242) shows his greeting followed straight by his menu, so the imported dialogue data leaves the box
out (RSPSApp/osrsreboxed-db#157). The Rising Sun's Barcrawl transcript has two empty boxes too; rsprox
recordings 3241 and 1636 show the barmaids' greeting with no box before it, and their Barcrawl menu has none.

The coins are checked after the price line (Wiki: the Barcrawl transcript): without them, the player says the bar's
line ("I don't have 50 coins.") and the conversation ends.

Before this, the plugin skipped the greeting and the menu at every bar and started with the player's line, and
using the card on a bartender did nothing. Outside an unsigned bar, the Rusty Anchor's Barcrawl option still showed
to every player, Zembo's during the crawl and the Blurberry Bar barman's to everyone; none played a drink.

## What happens

Once the player continues past the bartender's price line, the box closes and the coins go. The drink then plays
out tick by tick under a full stall, which ends with its last step (Wiki: Animation stall). Until then:

- A new walk or a click on the world does nothing.
- The inventory and most buttons do nothing ("Not from OSRS" lists which), and the Logout button answers "You
  can't log out right now.".
- Hits from others and the player's own damage wait, and land with the last step (Wiki: Animation stall;
  osrs-docs: Queues).
- Poison, venom and disease halt at 0 and run when the drink ends, which restarts their period (osrs-docs: Timers,
  Delays).
- Run energy does not recover. The Wiki's Energy page says it does not regenerate while the player crosses an
  agility obstacle, and osrs-docs lists agility obstacles among the uses of a delay; that a drink does the same is
  an inference.
- Prayer drains, and stats and Hitpoints restore and boosts decay as usual (osrs-docs: Timers, where Prayer
  draining and stat replenishment are soft timers, which run whatever the player's state).
- Special attack energy keeps restoring. The Wiki's Special attacks page says a 2014 update made it restore while
  interfaces are open; that it restores during the drink is an inference.

Buttons pressed on the last step's tick work. The lines are game messages; the ones marked filterable below are
hidden while the chat's Game filter is set to Filtered.

| Bar | Drink | Stats that drop | Hitpoints |
| --- | --- | --- | --- |
| Blue Moon Inn | Uncle Humphrey's Gutrot | Attack, Defence, Strength, Smithing | 3% |
| Blurberry Bar | Fire Toad Blast | | 5% |
| Dead Man's Chest | Supergrog | Attack, Defence, Cooking, Herblore, Prayer | |
| Dragon Inn | Fire Brandy | Attack, Defence (5 plus 10%) | |
| Flying Horse Inn | Heart Stopper | | 25% |
| Forester's Arms | Liverbane Ale | Attack, Defence, Firemaking, Fletching, Woodcutting | |
| Jolly Boar Inn | Olde Suspiciouse | Attack, Defence, Crafting, Mining, Magic | |
| Karamja Spirits Bar | Ape Bite Liqueur | | |
| Rising Sun | Hand of Death Cocktail | Attack, Defence, Fishing, Ranged | 3% |
| Rusty Anchor | Black Skull Ale | | |

A stat drops by 5 plus 5% of its current level, rounded down (Fire Brandy: 5 plus 10%). The Hitpoints
damage is a hit of that share of the current Hitpoints, rounded down; a share that rounds to 0 is a blue hit of 0.

The ticks count from the box closing:

| Bar | Tick: what happens |
| --- | --- |
| Blue Moon Inn | 0 "You buy some Uncle Humphrey's Gutrot."; 3 "You drink the Uncle Humphrey's Gutrot."; 6 "Your insides feel terrible." and the stat drops; 9 "The bartender signs your card."; 12 the hit and the shout "Blearrgh!" |
| Blurberry Bar | 0 "You buy a Fire Toad Blast." (filterable); 3 "Your mouth and throat burn as you gulp it down." (filterable); 6 "Blurberry signs your card."; 8 the hit |
| Dead Man's Chest | 0 "The bartender serves you a glass of strange thick dark liquid."; 3 "You wince and drink it." (filterable); 7 "You stagger backwards." (filterable) and the stat drops; 10 "You think you see 2 bartenders signing 2 barcrawl cards." |
| Dragon Inn | 0 "The bartender hands you a small glass and sets light to the contents."; 3 "You blow out the flame and drink it." (filterable); 7 "Your vision blurs and you stagger slightly." (filterable) and the stat drops; 10 "You can just about make out the bartender signing your barcrawl card." |
| Flying Horse Inn | 0 "The bartender hands you a shot of Heart Stopper."; 3 "You grimace and drink it." (filterable); 7 "You clutch your chest." (filterable); 10 "Through your tears you see the bartender...", "signing your barcrawl card" and the hit |
| Forester's Arms | 0 "The bartender gives you a glass of Liverbane Ale."; 3 "You gulp it down." (filterable); 7 "The room seems to be swaying." and the stat drops; 10 "The bartender scrawls his signature on your card." |
| Jolly Boar Inn | 0 "You buy a pint of Olde Suspiciouse."; 3 "You gulp it down."; 6 "Your head is spinning." and the stat drops (all three filterable); 9 "The bartender signs your card."; 12 the player's line "Thanksh very mush..." |
| Karamja Spirits Bar | 0 "You buy some Ape Bite Liqueur."; 3 "You swirl it around and swallow it." (both filterable); 6 "Zembo signs your card."; 9 the player's line "Mmmmm, dat was luverly..." |
| Rising Sun | 0 "You buy a Hand of Death cocktail."; 3 "You drink the cocktail." and the stat drops; 6 "You stumble around the room." and the screen starts to sway (all three filterable); 10 "&lt;barmaid&gt; giggles and signs your card.", the sway stops and the hit |
| Rusty Anchor | 0 "You buy a Black Skull Ale."; 3 "You drink your Black Skull Ale..."; 6 "Your vision blurs." (all three filterable); 9 "The bartender signs your card." and the shout "Hiccup!" |

The card is signed with the bar's signing line, except at the Dead Man's Chest and the Rusty Anchor (tick 0) and
the Karamja Spirits Bar (tick 9, with the player's line). A player who leaves during the drink anyway (a dropped
connection, a kick) gets its signature, stat drops and Hitpoints loss at once; at a server shutdown the rest of the
drink is lost.

In OSRS, damage is a strong queue, which waits during a delay; a divine potion's damage is an exception, as its
item script deals it without a queue (osrs-docs: Queues). Here too, only content that takes Hitpoints outside the
hit queue can kill a player during the drink. As a safety net, such a death stops the rest of the drink and signs
the card.

The sway swings the screen left and right (Wiki: the Barcrawl transcript, "The player's game screen swings slightly
left and right."; RSProx's CamShake message names its type 0 "Left and right"). From tick 6 to tick 10 it lasts
2.4 seconds, which fits the Barcrawl page's "for between 2–5 seconds". It is sent whatever the "Toggle all
atmospheric camera shake effects" setting: the cache's atmospheric group holds only Baba Yaga's, the Fishing
Trawler's and the Barrows chest's shakes, so the Barcrawl's is outside it (an inference from the cache).

## Sources

- **Stat drops**: the Wiki's [Temporary skill drain (revision 15401538)](https://oldschool.runescape.wiki/w/Temporary_skill_drain?oldid=15401538)
  table, and the Barcrawl page's effects column for Supergrog's Prayer (the table leaves it out).
- **Hitpoints**: the Wiki's table for Heart Stopper (25%) and Fire Toad Blast (5%). The Barcrawl page only says
  Gutrot and the Hand of Death lower Hitpoints; 3% fits guide footage (below).
- **A hit of 0**: osrs-docs's [Hit mask](https://osrs-docs.com/docs/packets/outgoing/updating/masks/hit/) has a
  block splat that "Indicates a hit of zero damage.", and the 2018 guide shows a blue 0 with "Blearrgh!" at 21
  Hitpoints, where 3% rounds to 0.
- **Lines**: the Wiki's [Transcript:Alfred Grimhand's Barcrawl (revision 15263216)](https://oldschool.runescape.wiki/w/Transcript:Alfred_Grimhand%27s_Barcrawl?oldid=15263216),
  as before.
- **Filterable lines**: the client's `[proc,filtertest]` ([osrs-dumps 853150e3](https://github.com/Joshua-F/osrs-dumps/tree/853150e3f75e1463391b470f98caf5d3bf796339/script))
  hides only chat type 105 (`^chattype_spam`) while the Game filter is set to Filtered, and RuneLite names that
  type `SPAM`. rsprox recording 1636 (revision 226) shows a bar's purchase line, "You buy an Asgarnian Ale.", sent
  as that type. Which Barcrawl lines are filterable comes from the guides (below).
- **The stall**: the Wiki's [Animation stall (revision 15395100)](https://oldschool.runescape.wiki/w/Animation_stall?oldid=15395100):
  "a full stall does not allow the player to move independently or perform actions. Hits are usually queued up on
  the player, and received only after the action is complete." TSPS's full stall drops world clicks as the local
  rsprox recording 1001438 (revision 241, ticks 19815-19828) shows.
- **Delays, queues and timers**: osrs-docs's [Delays](https://osrs-docs.com/docs/mechanics/delays/) (normal
  timers "will pause once the timer reaches 0, until the delay ends"; the music player works and unequipping is
  ignored), [Queues](https://osrs-docs.com/docs/mechanics/queues/)
  (damage is a strong queue, which does not run under a delay; divine potions deal their damage in the item
  script) and [Timers](https://osrs-docs.com/docs/mechanics/timers/) (toxins
  are normal timers, set back to their period after they run; Prayer draining and stat replenishment are soft
  timers).
- **Run and special attack energy**: the Wiki's [Energy (revision 15412096)](https://oldschool.runescape.wiki/w/Energy?oldid=15412096)
  ("will not regenerate while ... crossing an agility obstacle") and [Special attacks (revision 15410960)](https://oldschool.runescape.wiki/w/Special_attacks?oldid=15410960).
- **The sway**: the Barcrawl transcript and page (above); RSProx's CamShake message (revision 242: type 0 is "Left
  and right"); rsprox recording 1723 (revision 227, ticks 10414-10436), where live OSRS stops a shake with a zero
  one, as the drink does on tick 10; the settings under the cache's atmospheric toggle (structs 349-351, whose
  `param_1080` is `enum_5198`, in osrs-dumps 853150e3).
- **Menus and card use**: the Wiki's [Transcript:Bartender (Flying Horse Inn) (revision 14289090)](https://oldschool.runescape.wiki/w/Transcript:Bartender_%28Flying_Horse_Inn%29?oldid=14289090);
  the barmaids' transcripts, [Tina (revision 14961761)](https://oldschool.runescape.wiki/w/Transcript:Tina?oldid=14961761),
  [Emily (revision 15091019)](https://oldschool.runescape.wiki/w/Transcript:Emily?oldid=15091019) and
  [Kaylee (revision 14961759)](https://oldschool.runescape.wiki/w/Transcript:Kaylee?oldid=14961759);
  [Transcript:Recipe for Disaster/Freeing the Mountain Dwarf (revision 15315379)](https://oldschool.runescape.wiki/w/Transcript:Recipe_for_Disaster/Freeing_the_Mountain_Dwarf?oldid=15315379);
  [Transcript:Song of the Elves (revision 15346107)](https://oldschool.runescape.wiki/w/Transcript:Song_of_the_Elves?oldid=15346107);
  [Choose Option (revision 15347794)](https://oldschool.runescape.wiki/w/Choose_Option?oldid=15347794);
  [Barcrawl card (revision 15360753)](https://oldschool.runescape.wiki/w/Barcrawl_card?oldid=15360753), whose
  trivia says "It is possible to redo the miniquest by going to one of the bars with the card in the player's
  inventory"; rsprox recordings 3241 (revision 233) and 1636 (revision 226) for the barmaids' greeting and menus.
- **Recorded drinks**: Bandit-HaxUnit's local rsprox recording 1002001 (revision 242, as he reported it in #6935;
  not on rsprox.net) has the Blue Moon Inn's and the Jolly Boar Inn's drinks. At both, the price line's continue
  takes the coins and closes the box on the tick of the first line, and the other lines follow 3, 6, 9 and 12 ticks
  later, as in the table: the Blue Moon's as game messages with the hit and "Blearrgh!" on tick 12, the Jolly
  Boar's first three as chat type 105 with the stat drops on tick 6. The player sends nothing during either drink.
- **Footage**: three YouTube guides, measured frame by frame.

The three guides on YouTube:

- [Alfred Grimhand's Barcrawl Miniquest | OSRS Quality Quick Guide [2024]](https://www.youtube.com/watch?v=NAZJnG32pmo)
  (from 3:01). Its chat's Game filter is set to Filtered. Its speed changes between bars (from about 1.5 to 2.5
  times real time, an inference from its three-tick gaps), so its ticks are read as ratios within each bar. It
  shows the amounts: Gutrot 78 to 76 Hitpoints and the Hand of Death 77 to 75, Heart Stopper 78 to 59
  (25%), Fire Toad Blast 62 to 59 (5%), Supergrog's Prayer 61 to 53, Fire Brandy's Attack 44 to 35 (5 plus 10%),
  and the other drops by 5 plus 5%. It also shows the Rising Sun's single line on tick 10 with the hit and the
  sway's end.
- [OSRS P2P How to complete Alfred Grimhand's Barcrawl Quest Walkthrough Guide](https://www.youtube.com/watch?v=e8z3LG1E_8E)
  (2021). Its Game filter is On, so every line shows, and it plays in real time (its three-tick gaps take 1.73
  to 1.9 s). Its lines come on the ticks above at every bar. Back then the Rising Sun still had two lines, "The
  barmaid giggles." on tick 10 and "The barmaid signs your card." on tick 14.
- [[Quick Guide] Alfred Grimhand Barcrawl](https://www.youtube.com/watch?v=GSloHSTIRTw) (2018). Its Game filter
  is Filtered, and it plays in real time (the Blue Moon's gaps take 1.8 s). It shows Fire Toad Blast's hit two
  ticks after the signing line (22 to 21 Hitpoints), and the Blue Moon's hit of 0 at 21 Hitpoints.

The lines marked filterable are those that both filtered guides hid and the 2021 guide showed, so they are sent
as filterable game messages (an inference). The Blurberry Bar's two first lines are hidden in the 2018 guide;
the 2024 guide cuts away there.

## Not from OSRS (server/AGENTS.md rule 10)

From Lost City (its bar scripts and its engine, Engine-TS):

- That the drink holds the player at all. Lost City's bar scripts delay the player (`p_delay`); the Wiki and
  osrs-docs describe what a stall or a delay does, and no source says the drink is one.
- The tick schedule's numbers, except at the Blue Moon Inn and the Jolly Boar Inn (recording 1002001). The guides time
  them (the 2021 guide in real time at all ten bars, the 2024 guide as ratios). Where a guide differs, the guide is
  followed, as for Fire Toad Blast's hit on tick 8 (Lost City: 9).
- The tick the card is signed, except at those two bars. The Rising Sun's signature comes with OSRS's single line on
  tick 10; Lost City signs with its second line, on tick 14.
- The price line's continue closes the box and takes the coins, except at those two bars.
- The offer condition at every bar but the Flying Horse Inn.
- Using the card on a bartender other than the Flying Horse Inn's starts the drink. At the Rising Sun the menu then
  comes without the greeting, and the Blurberry Bar's barman points to Blurberry.
- Which clicks are dropped beyond those on the world: every click on the inventory and worn items (an engine
  check), with an inventory drag put back, and every button whose script needs the player (prayers, spells, emotes,
  combat options). The settings, music, quest list and Skills tab buttons, the friends, ignore, chat and report
  abuse messages and the tab buttons take clicks, so OSRS's interfaces for those stay open, with the chatbox.
  osrs-docs confirms only that the music player works and that unequipping is ignored during a delay.
- The special attack bar turns the special on or off; a special that acts on the press (the dragon battleaxe's,
  Excalibur's) does nothing, after the energy check ("You don't have enough power left."). Lost City's script
  says in a comment that OSRS strong-queues these specials; no source confirms it.
- The run, attack-style and auto-retaliate settings are refused and sent back as they were.
- The Logout button does nothing; TSPS answers it with its usual refusal line.
- A player who leaves anyway (a dropped connection, a kick) gets the drink's lasting steps at once: Lost City keeps
  such a player in the world until the drink has played to its end. At a server shutdown Lost City removes the
  player at once, so the rest of the drink is lost there as here.
- Lost City also drops the buttons pressed on the last step's tick. Here they work.
- The sway's amounts (random 0, sine amplitude 15, frequency 2).
- The player's chatbox lines at the Jolly Boar Inn and the Karamja Spirits Bar open even when another conversation
  is open.

Ours:

- A safety net: a death during the drink stops the rest of it and signs the card. No source covers a death during
  a delay.
- OSRS's buttons that Lost City does not have are held, except the clan chat, the chat channel setup, the world map
  and its orb, and the quick-prayer setup. The quick-prayer orb is held as the prayers are, and the special attack
  orb works as the special attack bar.
- While the Rising Sun offers the drink, its barmaids open the Barcrawl's menu without their own talk's beer glass
  and party room options. Recording 1002001 shows that menu, but not whether those options' conditions held.
- During Recipe for Disaster's Golden Nectar step, using the card on a Rising Sun barmaid opens the Barcrawl's
  menu ("What ales are you serving?" and the Barcrawl option), without that quest's dwarves option. No source
  covers card use in that step.
- During Song of the Elves' insurrection step, the tax talk takes the Flying Horse Inn bartender's Talk-to for a
  player who is also on the Barcrawl. No source covers a player who is in both.

`server/tests/barcrawl-drinks.test.cjs` plays every bar with the real engine, tick by tick.
