# Quest point cape

The Quest cape is members-only. The Wise Old Man sells a Quest point cape and hood for 99,000 coins after every main quest in
cache DB table `quest` is registered and complete. Eligibility matches each cache quest title
to one unique `QuestRuntime` definition; an unknown, missing, or duplicate quest closes the
purchase, equip, emote, and teleport gates. This also means free-to-play worlds cannot skip
members quests. The current runtime does not yet implement every cache quest, so this gate stays
closed until those quest modules exist.

The cape can be trimmed or untrimmed after all tiers of every Achievement Diary are complete.
The requirement is checked from diary progress, not by looking for an Achievement diary cape;
OSRS permits this toggle even when a later quest temporarily removes the cape's wear requirement.
The cape teleports to the Legends' Guild gate.

The OSRS wiki lists the cape and hood at 99,000 coins, the trim requirement as all Achievement
Diaries, and the unlimited teleport as the Legends' Guild gates:
[Quest point cape](https://oldschool.runescape.wiki/w/Quest_point_cape).
