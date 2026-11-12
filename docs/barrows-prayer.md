# Barrows Prayer drain

The underground Prayer drain occurs every 30 ticks, starting afresh on entering a crypt
or entering the tunnels from outside, and removes eight points plus one per defeated
brother. Ghommal's hilt 2–6 or the corresponding Avernic defenders prevent it when worn.
See the [Barrows strategy guide](https://oldschool.runescape.wiki/w/Barrows/Strategies).

Normal-world rsprox capture 1694 (revision 226) shows the crypt drain at ticks 8831,
8898, 8946, 8996 and 9076, 30 ticks after entry. There is no face on the first drain
with no defeated brothers; subsequent drains invoke clientscript 894 with a defeated
brother's component and a face model. The Barrows overlay opens on the atmosphere slot.
The alternate Guthan and Dharok models appear at ticks 9153 and 9183. Leagues capture
4057 (revision 237) shows the same script on the drain tick and the newer chat message,
and no faces after the chest is looted. The latter observations are from a modified world.

The active cache's clientscript 894 sets the face model and sequence 2085, then hides
it after 120 client cycles. Its script 168 sizes the face using the overlay's full height.
Ours: the alternate face's one-in-four selection approximates capture 4057's observed
frequency; its exact live odds are unknown.
