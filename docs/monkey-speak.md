# Monkeys and the M'speak amulet

`server/plugins/npcs/MonkeySpeak.plugin.js` picks the Talk-to section for monkeys whose Wiki
transcript has both a "without" and a "with" M'speak amulet section:

| NPC ids | Transcript | Without | With |
|---|---|---|---|
| 1038, 2848 | Monkey (monster), Mos Le'Harmless | "Eeekeek ookeek!" | one of the random pirate-monkey lines |
| 1825 | Blue monkey | "Eeek! Eeek! Ook!" | the Taunt/Calm menu |
| 23 | Monkey (magic carpet) | "Ukkuk oook! Eeek aka, ahh aka gonk." | "Who's an ugly human? Give me a banana!" |

The understood section plays when the player wears the M'speak amulet (4021) or has completed
Monkey Madness II, the condition in the Wiki's section titles. Carrying the amulet is not enough.
Before this the dialogue runtime always took the first standard section, so these monkeys never
talked in words.

Evidence: rsprox recording 3030 (rev 231), a Mos Le'Harmless monkey (1038) answering Talk-to with
"Are ye here for...the stuff?" (the understood section's second random line); the Wiki
transcripts above.

The same plugin answers the understood sections' conditions:

- Magic carpet monkey: "has a banana in their inventory" checks the inventory for a banana (1963), and "Give the monkey a banana." takes one.
- Blue monkey: the taunted and cautioned conditions read a per-player flag set by the Taunt and Caution lines. Ours: the Wiki doesn't say what clears them; here the Calm and Reassure lines do, and the flags aren't saved across logins.
