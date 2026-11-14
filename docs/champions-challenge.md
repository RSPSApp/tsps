# Champions' Challenge

The Champions' Guild basement minigame, built from the [OSRS Wiki](https://oldschool.runescape.wiki/w/Champions%27_Challenge) and checked against live rsprox captures (<https://rsprox.net/database>). Recording 2180 (rev 228) is a full Giant champion run, from the scroll through the lamp. It is a Leagues V world: its lamp says 2,800 XP and its XP drops are boosted, but the reward scroll shows the base 280. Recording 3219 (rev 232) covers the trapdoor and the gallery ladder.

The plugin is `server/plugins/minigames/ChampionsChallenge.plugin.js` (members). Its data is `server/plugins/minigames/data/champions-challenge.json`, and each part is a unit in `server/plugins/minigames/championschallenge/`.

| File | What it owns |
| --- | --- |
| `Common.ChampionsChallenge.js` | The data, the saved progress, varp 617, Larxus's lines. |
| `Gallery.ChampionsChallenge.js` | The per-player basement, the trapdoor and ladders, the statue, the portcullis, teleports, graves, login recovery. |
| `Larxus.ChampionsChallenge.js` | His transcript's variants, conditions, choices and actions; scrolls used on him. |
| `Rules.ChampionsChallenge.js` | Each champion's rule: combat styles, Prayer, special attacks, what may be carried or worn. |
| `Combat.ChampionsChallenge.js` | The ranged, magic and mixed champions' attacks. |
| `Rewards.ChampionsChallenge.js` | The kill, the Chest of Champions, the lamp, reading scrolls, which kills drop a scroll. |

## Progress

Varp 617 (`champions_defeated`) carries everything the client draws:

- **Bits 0-10:** one per champion (`champions_defeated_earthwarrior` 1452 … `champions_defeated_human` 1462). `champions_slain` (6278) is bits 0-15.
- **Bits 16-31:** `champions_lamps` (6279), with each champion's lamp at its own bit plus 16.
- **Saved attributes:** the server keeps the two bit sets as `champions-challenge:defeated` and `champions-challenge:lamps`, and sends the varp on login.
- **Multilocs on these varbits:** the banners on the Wall of Defeated Champions, and the Chest of Champions (31945). That chest is 22456 "Open" while `champions_slain` is 0, and 31944 "Search" after.
- **Captured on the Giant kill:** `champions_defeated_giant` 0→1 and `champions_slain` 0→4. Rubbing its lamp then set `champions_lamps` 0→4 (the varp reads 262148).

## The basement

| Action | Captured |
| --- | --- |
| Trapdoor (10559) "Climb-down" | +1: the player is in their own copy of the basement (map chunks 394-398 × 1218-1222), by the ladder at (3189, 9758). "Title Fight" (525) plays. |
| Ladder (10560) "Climb-up" | Back to (3190, 3356), beside the trapdoor. |
| Larxus (3321) and the Mystery figures | They stand at the captured tiles. Larxus wanders a few tiles. |
| Scroll used on Larxus, "Yes, let me at him!" | The champion appears at (3168, 9758). The Champion Statue (3184, 9758) turns from 10556 to 10557, with sound 84. |
| Statue 10556 "Open", no challenge | Larxus: "You need to arrange a challenge with me before you enter the arena." |
| Statue 10557 "Climb-down" | The player moves to (3182, 9758), behind it. |
| Portcullis (10553) "Open" | Loc animation 2976 (`champions_grill`) and sound 84. The player passes through to (3180, 9758) with "Victory is Mine" (528), unlocked then, or back to (3182, 9758) with "Title Fight". |
| Arena ladder (10554) "Climb-up" | The player goes to (3185, 9758) and the statue closes. The fight is over, won or not (Wiki: the scroll is kept). |

- **Instancing:** the capture shows a `rebuild_region` on the way down and instance coordinates on the way up. The basement is therefore one per player, so two players never share a champion.
- **Teleports:** refused, with Larxus saying "There's a ladder for a reason." (Wiki). The ladders and the portcullis are ordinary object interactions, so they still work.
- **Leaving early:** logging out puts the player beside the trapdoor, and so does a login after a server stop. The champion and the fight are removed.
- **Ground scrolls:** a champion's scroll dropped in the instance is taken back (or placed beside the trapdoor if the pack is full) before the instance is destroyed, so an early exit or a death cannot silently lose it.
- **Death:** a death is not safe. The grave goes up on the guild's ground floor "a few tiles away from the trapdoor" (Wiki); the tile (3188, 3356) is ours. Normal dangerous-death recovery applies to the scroll, as the Wiki says it can be recovered from the grave.

## Larxus

Everything he says comes from his Wiki transcript in `npc-dialogues.json`. The plugin picks the variant and answers its conditions:

- **Talk-to:** the standard conversation. Once the other ten champions are beaten it is Leon d'Cour's challenge instead, and once Leon is beaten it is the cape.
- **"Have you any rewards for me?":**
  - nothing beaten yet: no rewards;
  - a lamp to collect and none held: look in the chest;
  - a lamp held: rub it;
  - otherwise: nothing more.
- **A scroll used on him:**
  - normally, that champion's rule line. The Giant's line is captured exactly.
  - a champion already beaten: "The challenge is void.", and the scroll is taken.
  - a champion already waiting: its own line.
  - any other item: its own line.
- **The cape:** "Larxus hands you the cape of Leon d'Cour." gives a Champion's cape (21439) and logs it to the collection log.

The transcript's "I'd like another one." branch ends after the second cape (the export marks the loop as unavailable). Talking to him again gives more.

## Rules

| Champion | Rule (Wiki) | How |
| --- | --- | --- |
| Imp | No special attacks | The special attack bar won't turn on; it is turned off on the way down. |
| Goblin | Magic only | Other styles are refused. |
| Skeleton | Ranged only | Other styles are refused. |
| Zombies | No Magic | Magic is refused. |
| Giant | Melee only | Other styles are refused. |
| Hobgoblin | No Melee | Melee is refused. |
| Ghoul | Weapons only | The statue refuses anything but a weapon in the weapon slot, and an inventory that isn't empty, the champion's scroll included: a scroll dropped before the fight and picked up after keeps working. Armour can't be put on in the fight. |
| Earth Warrior | No Prayer | Prayers are turned off on the way down, and turning one on is refused. |
| Jogre | No Ranged | Ranged is refused. Its hits poison, starting at 8 (Wiki). |
| Lesser Demon | No weapons, armour or materials | The statue refuses anything worn or anything equippable carried, then the materials used to make equipment (logs, ores, bars, hides, fletching supplies, tools and the imbued heart). Runes and potions are allowed. Equipping is refused ("You're not supposed to be using any weapons!" / "…armour!"). |
| Leon d'Cour | Only what is worn | The statue refuses an inventory that isn't empty. |

- **How a refusal looks:** captured for the Giant. A game message, "You're only allowed to use Melee in this duel!", and Larxus: "I believe I mentioned you're only allowed to use Melee in this duel."
- **"Not allowed" wording:** the Wiki's Earth Warrior line ("…you're not allowed to use Prayer in this duel.") gives the pattern for the "not allowed" rules.
- **A new hook for the Imp:** core has a generic `onSpecialAttackDisabled` hook, which works like `onPrayerDisabled`.

## The fights

- **Stats:** they come from the monster data, and the Wiki confirms them.
- **Melee champions:** the Giant, Zombies, Earth Warrior, Jogre and Leon d'Cour use the core NPC melee, with their cache animations in `npc-combat-defs.json`. The Giant's animations (6368/6370/6369) and death sound 450 are captured.
- **Ranged, magic and mixed champions:** the Imp, Goblin, Skeleton, Hobgoblin, Ghoul and Lesser Demon have their own attacks in `Combat.ChampionsChallenge.js`. The animations and spot animations come from the cache's `champions_*` names. The Ghoul and the Lesser Demon keep their distance and only swing at a player beside them (Wiki).
- **Projectiles:** the Imp, Hobgoblin, Ghoul and Lesser Demon use the cache's launch/travel graphics and the engine's arc; the hit lands on the arrival tick. The Goblin's drain impact is delayed to its hit. The Skeleton has no named projectile in the cache, so it fires none.
- **Imp teleports:** when damaged, it teleports a short distance to a free arena tile, never outside the arena (Wiki). The Wiki gives no rate; it is throttled so it cannot blink on every hit.
- **Goblin prayer drain:** its spell drains one Prayer point per hit (the Wiki gives the effect, not an amount).
- **Jogre poison:** its hits poison, starting at 8 (Wiki), through the normal NPC poison path.
- **Aggression:** the champion comes for the player once they pass the portcullis (captured for the Giant). The Goblin isn't aggressive (Wiki).

## The kill

Captured for the Giant, on the tick it was removed:

- the defeat varbits are set and the scroll leaves the pack;
- the same XP goes to Hitpoints and Slayer (Wiki values, 128-592);
- the jingle "A New Champion!" (85) plays;
- the reward scroll `champions_scroll` (63) opens: "Well done, you defeated the Giant Champion!", "280 Slayer XP", "280 Hitpoints XP", and the scroll's item at zoom 300.

Two kills add a line from Leon d'Cour (Wiki transcripts):

- **The tenth champion:** "You have done well brave adventurer, but I would test your mettle now. You may arrange the fight with Larxus at your leisure."
- **Leon himself:** "Adventurer, you have defeated me in battle! For this, I congratulate you. Please accept my cape as a sign of your accomplishment." His reward scroll shows Leon's champion scroll (6808).

## The Chest of Champions and the lamp

All of this was captured unless marked.

- **The closed chest, "Open":** "It's locked." and sound 2402.
- **The open chest, "Search":** it gives one Champion's lamp (22320) for the first champion beaten and not yet rubbed for, with the item box "Well done, you defeated the Giant Champion! Here's a reward for you.".
- **Search refusals (Wiki):**
  - a lamp already held: "Maybe you should rub that lamp you're holding before you try looking for more rewards.";
  - a full pack: "There's a reward in here for you, but don't have space to hold it.";
  - nothing left: "There's nothing in here for you now." (captured).
- **The lamp, "Rub":**
  - the item box "Well done, you defeated the Giant Champion! This lamp will award you 2,800 XP in Slayer and Hitpoints.";
  - then "Gain 2,800 XP in Slayer and Hitpoints?" with Proceed/Cancel;
  - then "You gain 2,800 XP in Slayer and Hitpoints." The lamp gives ten times the kill's XP to each skill (Wiki).

## Scrolls

- **"Read":** the letter on `messagescroll_handwriting` (222).
  - The Giant's layout is captured: letter lines 4-5, the signature on line 7.
  - The other letters are the Wiki's texts. They are wrapped the same way, and a three-line letter starts on line 3.
- **Drops:** the scrolls are 1/5,000 tertiaries in the generated drop tables. The plugin edits `npc-drops:roll`:
  - **a player with fewer than 32 Quest Points:** gets no scroll;
  - **a champion already beaten:** the scroll is replaced by the red "You have a funny feeling that you would have received a Champion's scroll...";
  - **a scroll that drops:** comes with the red "A Champion's scroll falls to the ground as you slay your opponent." (Wiki).

## The champions log

A POH adventure log's Read menu ("The Exploits of <owner>": Slayer log, Boss log, Champions log, Collection log, Counters) has a "Champions log" entry. Captured in rsprox recordings 1001169 (tick 88), 2905 and 2906 (rev 230):

- **Opening it:** `if_opensub` of `champions_log` (468) as the main modal, then `runclientscript` 1408 with one int.
- **The int:** a bitmask of defeated champions. Script 1409 draws enum 1470's names (Earth Warrior Champion ... Leon d'Cour, rows 0-10) and crosses out row *i* when bit *i* is set. Those rows are our `bit`s, which are the `champions_defeated_*` varbit offsets in varp 617. All three recordings pass 0, from an account that had beaten no champion.
- **Whose log:** the house owner's (the menu is titled with the owner's name). Study.Construction emits `champions-challenge:open-log` with `{ player, owner }`, and Rewards.ChampionsChallenge opens the log. Without this plugin, the entry still says "Nothing interesting happens."
- **Close:** the cache button `champions_log:com_4` (op1 "Close").

## Not yet done

- **Unknown amounts:** the Wiki gives no number for the Goblin's Prayer drain (one point is used) or the Imp's teleport rate (it is throttled).
- **The adventure log's other entries:** the Slayer log, Boss log and Counters still say "Nothing interesting happens."
- **Dialogue pagination:** the long rule lines run onto a second page here, but fit one box in the capture. This is the dialogue runtime's pagination.

## Testing

`node --test server/tests/champions-challenge.test.cjs server/tests/construction-adventure-log.test.cjs` checks:

- the transcript covers every scroll, statue and Lesser Demon materials refusal;
- the rules match the rule lines, including the Ghoul's empty inventory and the Lesser Demon's materials;
- the reward conditions, Leon's unlock, the lamp order and scroll-drop gating;
- the Goblin's Prayer drain, the Jogre's starting poison, projectile landing, the Imp's arena teleport and the ground-scroll rescue;
- the champions log: a real house's marble adventure log menu opens 468 and script 1408 with the owner's defeated bits, and each champion's bit is its row in enum 1470.

Checked in-game with the agent MCP:

- the trapdoor, Larxus, the statue refusal;
- the Giant run: the melee-only refusal, the kill, the varp, the reward interface, the chest, the lamp and the void scroll;
- the Ghoul's carry refusal and fight, the Imp's special-attack refusal;
- logging out inside, and progress after a relog.
