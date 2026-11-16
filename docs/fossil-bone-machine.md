# Fossil Island bone machine

The eastern strange machine in the House on the Hill converts enriched bones to Prayer XP.
The [OSRS Wiki](https://oldschool.runescape.wiki/w/Strange_Machine) gives 500, 1,000, 1,500
and 2,500 XP for small, medium, large and rare enriched bones respectively.
The [Zealot's robes Wiki](https://oldschool.runescape.wiki/w/Zealot%27s_robes) lists these
bones on this machine under unaffected items, so the robes do not save them here.

In rsprox captures 711 and 712, using a bone on `fossil_lab_bone_grinder` starts the pickup
animation, sound 127, the machine's active animation and the feed message. The bone and XP
follow a tick later. Capture 711 processes five small bones at two-tick intervals and returns
the machine to its inactive animation after the last. Capture 712 shows a single medium bone.

Ours: after the selected bone, other sizes are processed in inventory order; the recordings
show a batch of one size only. A level-up interrupts the batch through the normal skill
cancellation path; no level-up was captured. Ordinary fossils used on the machine are not implemented here;
the Wiki says they are destroyed without reward, but their interaction is not captured.
