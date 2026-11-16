# Amrod's crystal seed exchange

Amrod's Trade option, and the exchange action in his Talk-to dialogue, open a five-item
`skillmulti` menu. The OSRS Wiki's [Amrod](https://oldschool.runescape.wiki/w/Amrod) lists
unnoted crystal tool, weapon, armour, enhanced teleport and enhanced weapon seeds for 100, 10,
250, 150 and 1,500 crystal shards respectively.

The rsprox capture recording 312 (rev 230), ticks 2569–2583, shows the menu (mode 4), choosing
one enhanced teleport seed, confirmation, and a double-item result box for 150 shards. Recording
1104 (rev 237), ticks 17716–17720, shows 24 seeds exchanged for 3,600 shards. The result box
uses `prif_crystal_shard_25` as its shard illustration. The transcript's Talk-to exchange action
opens the same menu.

Ours: an unheld seed selection closes the menu; if the inventory changes before confirmation or
there is no room in the shard stack, the exchange aborts silently. These branches and the other
seed types' result text are not recorded. The quantity selector uses the number of eligible seeds
in the inventory as its maximum and remembers the last selection; live's empty-menu and
mixed-seed quantity behaviour has not been captured. Noted seeds never count (Wiki).
