---
quest: Observatory Quest
key: observatory_quest
status: passed-with-issues
tested: 2026-11-10
tester: agent
model: claude-opus-5-5
commit: 70fc7bd23
cache: osrs-242_2026-11-03
start: fresh
travel: travel_to
---

# Observatory Quest

Fresh run through the hand-ins, the dungeon warning, the key chest, the sleeping guard and kitchen gate, the stove,
the lens, the closing cutscene and the telescope's constellation to the Leo reward, against the user's start-to-finish
capture (#4118). Unchecked: the full-inventory reward branch, the assistant's wine, the star charts.

## Findings

- **open** The star charts' Look-at and the Orrery's View do nothing; no capture or Wiki source shows them.
- **open** The cutscene leaves the side tabs open; live closes them (combat, stats, quests, inventory, worn, prayer,
  magic, settings, emotes) and reopens them at the end.
- **fixed** The sleeping guard wandered; a second, attackable goblin guard stood on his tile. #4118
- **fixed** The kitchen gate vanished when opened instead of opening and shutting behind the player. #4118
- **fixed** No closing cutscene; no telescope view (only a chat line naming the constellation). #4118
- **fixed** A duplicate guard remained visible after the encounter.
- **fixed** The Spirit of Scorpius gave no unholy mould and blessed nothing after the quest, so an unholy symbol
  could not be finished. See [Spirit of Scorpius](#spirit-of-scorpius-after-the-quest).

## Live behaviour (rsprox captures)

From the user's capture 20261110T110141-5ab63b4 (revision 242, start to finish). Ticks are the capture's.

- **Start (131):** observatory_starsign (3828) is set with varp 112 = 1. Its 0-11 order is the professor's menu
  order: Aquarius, Capricorn, Sagittarius, Scorpio / Libra, Virgo, Leo / Cancer, Gemini, Taurus / Aries, Pisces
  (menus at 1626-1631; Quest Helper keys the same values). The capture's 9 is Taurus.
- **Hand-ins (140, 156, 171, 1022, 1040):** the player plays 6291 on the hand-over line's continue; the item goes
  and the stage moves with the professor's next line. The mould hand-in (1013) starts at "Did you bring me the
  mould?"; the glass comes back in an item box (1023). The lens hand-in asks "Is the lens finished?" first (1038),
  and the lens and mould go at the closing message box, after a fade (1045-1047).
- **Dungeon stairs (227-239):** the surface stairs open cws_warning_9 (interface 560), counting each showing in
  varbit 3859; Proceed closes it and the player is below two ticks later.
- **Chests (466-717):** Open: "You open the chest.", 536, loc anim 6851, sound 52, the open loc a tick later.
  Search: 6840, then two ticks later "The chest is empty." or the key's item box ("You find a kitchen key.", key
  given on its continue), or "You already have a kitchen key." / "Another one will be of no use." Close: "You close
  the chest.", 535, loc anim 6850, sound 51. observatory_chestchoice (3827) picks the chest: 0 is 2364,9355 (this
  capture), 2 is 2351,9361 (Quest Helper's note).
- **Guard (806-808):** the sleeping guard (5368) stands on 2327,9394. Prod plays 6839 on the player and 6827 on
  him; two ticks later he is replaced by a goblin guard (5369), who says "Oi, how dare you wake me up!" and attacks.
- **Kitchen gate (816-920):** while that guard is up and free: "You need to get rid of that goblin guard first."
  With him on 2327,9399 (856) or falling (914) it opens; the first time, "The gate unlocks." / "The key is useless
  now. You discard it." and observatory_gatelock (3826). Open puts inviswall 38848 on both doorway tiles and the
  open leaves 1574/1573 on the tiles north, sound 71; the player steps across that tick (both ways, 888 out) and
  says "You had better be quick, there may be more guards about." going in. The gate is back two ticks later.
- **Stove (871-883):** two message boxes ("The goblins appear to have been using the lens mould to cook their
  stew!", then 536 and "You shake out its contents and take it with you."); on the second's continue the player says
  "Euuuw, that smells awful!" and two ticks later has the mould (observatory_mould_pres 3837). Afterwards: "Just a
  plain stove. Nothing there."
- **Lens (1029-1031):** an item box with the mould, no continue; two ticks later the glass becomes the lens and a
  second box adds "It has produced a small, convex glass disc." No XP, no level check.
- **Cutscene (1402-1588):** see `server/plugins/quests/observatory/Cutscene.ObservatoryQuest.js` for the timeline:
  the fade a tick after reaching the south dungeon stairs, the copy of x 2432-2463, y 3136-3183 three ticks later,
  track 368, the camera tour, the professor's animations (6844, 6847, 6848, 6845, 862) and overheads, the trip
  upstairs, observatory_cutscene_seen (3838) on the last fade, and the real map at 2438,3163.
- **Telescope (1604-1618):** "You look through the telescope." and 6849; two ticks later observatory_scopelooked
  (3836) and interface 552 with the sign's model on 552:7 (27059 for Taurus). The other signs' models were matched
  to the Wiki's star chart images: Aquarius 27064, Capricorn 27061, Sagittarius 27056, Scorpio 27055, Libra 27057,
  Virgo 27060, Leo 27058, Cancer 27067, Gemini 27068, Aries 27066, Pisces 27062.
- **Ending (1638-1644):** the reward and varp 112 = 7 arrive with "By Saradomin's earlobes!"; the scroll after
  the last line.

## Spirit of Scorpius (after the quest)

`server/plugins/quests/observatory/Scorpius.ObservatoryQuest.js`. No packet recording shows a conversation with him:
the rsprox archive has him (5371) only in view in four recordings, and nothing with the transcript's words or the
unpowered or unholy symbol (1722, 1724).

**Sources:**
- **The OSRS Wiki:** [Spirit of Scorpius (revision 15409376)](https://oldschool.runescape.wiki/w/Spirit_of_Scorpius?oldid=15409376)
  ("An unholy mould must be claimed from him before he will bless any unholy symbols", "He will not give the player
  an unholy mould if there is one already in their inventory", and the trivia's ghostspeak message),
  [Ghostspeak amulet (revision 15289500)](https://oldschool.runescape.wiki/w/Ghostspeak_amulet?oldid=15289500)
  (Morytania legs 2 stand in for it), the generated
  `Transcript:Spirit of Scorpius` (both variants), and
  [Unholy symbol (revision 15295046)](https://oldschool.runescape.wiki/w/Unholy_symbol?oldid=15295046).
- **The end of a [YouTube video of the quest](https://www.youtube.com/watch?v=v3q37wl-hCM)**, both conversations with him: the first meeting's menu ("I seek your wisdom." and "I have come to
  kill you."), "The ghost gives you a casting mould.", "The ghost mutters in a strange voice." and "The unholy symbol
  throbs with power" as game messages in the chat (the blessed symbol appears with the last), the standard menu, and
  his next line about three seconds after the blessing.
- **Before the quest:** the OSRS Wiki has none. RuneScape Classic's transcript
  ([revision 141531](https://classic.runescape.wiki/w/Transcript:Spirit_of_Scorpius?oldid=141531)) has "How dare you
  disturb me!", and Lost City's 2004 script plays "Who treads upon my grave?" first. Both lines are used.

**What he does:**
- **Talk-to:** without an amulet of ghostspeak (or Morytania legs 2 or above, which stand in for it), the game message
  "This powerful spirit seems capable of speaking to you even though you are not wearing an Amulet of Ghostspeak."
  comes first, as the Wiki's trivia says. The video shows no such message; whether its player wore an amulet is not
  visible.
- **Before the quest is complete:** the two lines above, and nothing else.
- **The first conversation after it:** the transcript's "speaking to him for the first time". "I seek your wisdom."
  ends on the game message "The ghost gives you a casting mould." and hands over an unholy mould (1594); the meeting is
  remembered (`observatory-quest:scorpius-mould-given`). With a mould already carried (from a chaos druid or Tarn's
  Lair zombie drop), he gives none and sends no message, as the Wiki says ("He will not give the player an unholy
  mould if there is one already in their inventory"), and the meeting is still remembered, so blessings unlock.
  "I have come to kill you." changes nothing, so the next conversation is the first one again.
- **Later conversations:** the standard dialogue. "I have come to seek a blessing." with an unpowered symbol (1722):
  past "I see you have the unholy symbol of our Lord. I will bless it for you." come the game messages "The ghost
  mutters in a strange voice." and "The unholy symbol throbs with power.", one unpowered symbol becomes an unholy
  symbol (1724), and the chatbox closes until his next line. With only an unholy symbol he says it is already blessed;
  with neither, he refuses. "I need another unholy symbol mould." gives one, with the game message "The ghost hands
  you another mould.", unless the inventory already has one.
- **The Grave of Scorpius (2211):** Read shows its inscription in a message box (below).

The Wiki's transcript marks the four game messages as boxes; the video shows three of them in the chat, and Lost City
sends all four as messages.

**Not from OSRS:** no OSRS source covers these, so they come from Lost City's 2004 scripts
([quest_itgronigen at 65b754f](https://github.com/LostCityRS/Content/tree/65b754f768b79b941b21b2a1eb3b0d1ecae3cdfe/scripts/quests/quest_itgronigen/scripts)), which may differ from today's game:
- The two lines before the quest (the second is also RuneScape Classic's).
- An unpowered symbol is blessed even when an unholy one is also carried. The Wiki lists the conditions without
  saying which wins; Lost City checks the unpowered symbol first.
- The pause after the blessing is five ticks (its `p_delay(5)`); the video shows about three seconds.
- Each line's chat-head mood (angry, neutral or happy, as Lost City's lines mark them), played as `chatang`,
  `chatneu` or `chathap` 1-4 by the number of chatbox lines.
- The grave's inscription: "Here lies Scorpius: Only those who have seen beyond the stars may seek his counsel."

## Runs

### 2026-11-10 · agent · claude-opus-5-5

- **Start:** fresh account at the reception with `::tele`; planks, bronze bar and two molten glass spawned.
- **Route:** every conversation through the professor; the surface stairs' warning (Stay out and Proceed); the key
  chest; Prod, kill and the gate both ways; the stove; the lens; the lens hand-in; the south stairs into the cutscene
  (played under the vision client); the telescope; a wrong answer (Aquarius), then Leo. Goblins kept the player in
  combat on the dungeon walk, so after the key the player was placed beside the guard with `::tele`, and a second
  account was set to stage 6 with `::quest` for the cutscene recording.
- **Result:** varp 112 = 7, observatory_gatelock/mould_pres/scopelooked/cutscene_seen 1, the uncut sapphire and
  Leo's Hitpoints XP. Quest Helper followed each step. A logout in the cutscene comes back on 2438,3163 with the
  cutscene unseen.
- **Not checked:** the full-inventory reward branch, the wine, the unmarked chests, trapping the guard by walking.
