# Knight Waves Training Ground

The top floor of Camelot Castle: eight Round Table knights in order, melee only, a safe death, and
Chivalry/Piety plus the Camelot respawn on completion.

Implementation: `server/plugins/minigames/KnightWaves.plugin.js` and
`server/plugins/minigames/knightwaves/`.

## Sources

- **OSRS Wiki, [Knight Waves Training Ground](https://oldschool.runescape.wiki/w/Knight_Waves_Training_Ground):**
  the wave table (knight, level, hitpoints, weakness, drained stats), the restrictions, the death
  behaviour and the rewards.
- **OSRS Wiki, the individual knight pages** ([Sir Bedivere](https://oldschool.runescape.wiki/w/Sir_Bedivere),
  [Sir Pelleas](https://oldschool.runescape.wiki/w/Sir_Pelleas), [Sir Tristram](https://oldschool.runescape.wiki/w/Sir_Tristram),
  [Sir Palomedes](https://oldschool.runescape.wiki/w/Sir_Palomedes), [Sir Lucan](https://oldschool.runescape.wiki/w/Sir_Lucan),
  [Sir Gawain](https://oldschool.runescape.wiki/w/Sir_Gawain), [Sir Kay](https://oldschool.runescape.wiki/w/Sir_Kay),
  [Sir Lancelot](https://oldschool.runescape.wiki/w/Sir_Lancelot)): the fuller drain lists.
- **OSRS Wiki, [Spawning](https://oldschool.runescape.wiki/w/Spawning#Respawn_point):** the Camelot
  respawn area at the gate, `(2757,3478)`.
- **OSRS Wiki, [Transcript:Squire (Camelot)](https://oldschool.runescape.wiki/w/Transcript:Squire_(Camelot)):**
  the rules, the repeated explanations and the post-completion refusal.
- **Cache 242:** the wave NPCs 4361–4354 carry their combat definitions in
  `data/definitions/monsters-complete.json` (levels 110–127, hitpoints 90–115, max hits 14–23,
  5-tick attacks, Sir Lancelot 4-tick). The room's floor and the large doors at `2751,3507-3508`
  were read from the plane-2 collision and `MapObjects`; the squire is 4353.
- **Recordings:** the locked Chivalry/Piety refusal is a messagebox naming the level and King's
  Ransom/Knight Waves requirements (rsprox 227/910291.txt and 227/910403.txt for Chivalry,
  231/911282.txt and 237/01107.txt for Piety).

## Waves

| Wave | Knight | ID | Level | Hitpoints | Drained on a damaging hit |
| --- | --- | --- | --- | --- | --- |
| 1 | Sir Bedivere | 4361 | 110 | 90 | Strength, Ranged, Magic |
| 2 | Sir Pelleas | 4360 | 112 | 99 | Defence |
| 3 | Sir Tristram | 4359 | 115 | 105 | Strength, Ranged, Magic |
| 4 | Sir Palomedes | 4358 | 118 | 100 | Attack, Ranged, Magic |
| 5 | Sir Lucan | 4357 | 120 | 105 | Defence, Attack |
| 6 | Sir Gawain | 4356 | 122 | 110 | Attack |
| 7 | Sir Kay | 4355 | 124 | 110 | Defence |
| 8 | Sir Lancelot | 4354 | 127 | 115 | Defence, Strength |

The activity page lists the melee stats; the individual pages add Ranged and Magic, which are
unusable in the room but still lowered. The amount is Wiki-documented only for Sir Lancelot
("by 5 each"); the same five is used for every knight and disclosed as our value.

## Rules

- **Entry:** completing King's Ransom. The squire outside explains the rules from the transcript;
  the large doors lead into the room. After completion the squire refuses re-entry
  ("Once you have won, you cannot re-enter.").
- **Combat:** melee only. Merlin's spell prevents Prayer, Ranged and Magic: Prayer is cleared on
  entry and refused inside, and an attack in either other style is refused with a game message.
- **Death:** safe. Merlin puts the player back outside beside the squire with every item; the same
  knight is fought again on re-entry.
- **Leaving, teleporting and logging out:** the knight despawns and the wave count is kept. The
  12 August 2026 change also keeps it when leaving through the door.
- **Timeout:** a knight despawns if the fight takes too long. The Wiki gives no duration; ours is
  500 ticks (five minutes), disclosed.
- **Rewards:** once, on defeating Sir Lancelot: 20,000 XP in Attack, Strength, Defence and
  Hitpoints, Chivalry and Piety, and the Camelot respawn point.

## Implementation

| File | Owns |
| --- | --- |
| `Common.KnightWaves.js` | room bounds, wave table, drains, attribute/varbit, messages, `later` |
| `Room.KnightWaves.js` | the `Area`, entry/refusal, owner-only spawns, wave progression, death/logout cleanup, timeout |
| `Combat.KnightWaves.js` | the stat drains on a damaging hit |
| `Restrictions.KnightWaves.js` | melee-only and no-Prayer rules |
| `Squire.KnightWaves.js` | the pre/post activity transcript (King's Ransom emits `knight-waves:squire`) |
| `Rewards.KnightWaves.js` | XP, `respawn-point:grant` and the prayer sync |

Persistence: `knight-waves:wave` (0-8) and `knight-waves:rewards` (bool). The varbit is
`KR_KNIGHTWAVES_STATE` 3909; `PrayerUnlocks.plugin.js` asks `knight-waves:is-complete` and
`knight-waves:progress` and falls back to King's Ransom only when the activity plugin is off.

## Verification

`node --test tests/knight-waves.test.cjs` covers the gate, wave order, style and Prayer rules,
drains, delayed spawn, timeout, completion rewards, squire variants, death and logout.

Live run (agent MCP, `main` at this branch):

- the Large door at `2751,3507` opens onto the room; entering gives "Sir Bedivere steps forward.
  (Wave 1 of 8)";
- Bedivere's hit lowered Strength/Ranged/Magic by 5; Pelleas's lowered Defence by 5 per hit;
- a Magic cast on the knight was refused with "Only melee combat is allowed in the Knight Waves
  Training Ground.";
- dying put the player at `2750,3507` with the Antique lamp still carried and resumed wave 2 on
  re-entry;
- the eight kills gave the completion and 20,000 XP lines, `KR_KNIGHTWAVES_STATE` 3909 became 8,
  and the four skills each gained their 20,000 (plus the fight's own combat XP);
- the squire played "Congratulations on succeeding in the Knight Waves" and the room refused
  re-entry with "I'm afraid not, my liege. Once you have won, you cannot re-enter."

The first live run found a duplicate wave spawn (the per-tick catch-up raced the two-tick delayed
spawn); `Room` now holds a `pendingSpawn` guard and the test covers it. The room's west edge moved
to x 2754 because the squire's default wander radius is 5 and he can stand in the doorway.

## Limits

- The wave timeout, the per-knight drain amount (except Lancelot), the in-room melee/Prayer
  refusal wording and the spawn tile are ours, not captured.
- The room bounds and large-door path come from the cache collision; the in-game pass checks them.
- Merlin cannot yet change the respawn point back to Lumbridge (the Wiki says he can).
- The activity is not in the 520-item progress inventory; finishing it completes the King's
  Ransom objective work and the Chivalry/Piety gate instead.
