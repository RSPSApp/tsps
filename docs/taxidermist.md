# Taxidermist

The Taxidermist in Canifis (`poh_taxidermist`) stuffs monster heads and big fish for the house's
skill hall trophy displays ([construction.md](construction.md)). Plugin:
`server/plugins/npcs/Taxidermist.plugin.js`.

## Stuffing

Use a trophy on her. Her lines are the transcript in `npc-dialogues.json` (page `Taxidermist`,
variants `using-items-on-her-<trophy>`): her remark, "I can preserve that for you for N coins.",
then, with N coins in the inventory, "Yes please" / "No thanks"; without them the player says
"Maybe another time." The price is the one her line names. The transcript writes "same as above"
for every trophy after the big bass, so each plays its own lines and then the big bass variant's
coin conditions.

At "There you go!" the coins are taken and the stuffed trophy (`<gameval>_stuffed`) takes the
head's slot. If the head or the coins are gone by then, nothing happens and the line is skipped.

Raw chicken gets its own remark; anything else gets "Don't be silly, I can't preserve that!".

## Unstuff

A stuffed trophy's inventory Unstuff opens a chat menu titled "Re-stuffing it will cost N coins."
(N is her stuffing price) with "Remove the stuffing." / "Cancel". Removing it puts the unstuffed
item back in the same slot and shows it in an item box: "You carefully unstuff it." It costs
nothing.

## Evidence

rsprox captures, rec 2617 (rev 229):

- t7780: a kurask head used on her; her two lines, the "Select an option" menu, "Yes please.",
  then on "There you go!" 6,000 coins taken and the stuffed kurask head in the head's slot (5).
- t6388: Unstuff on the stuffed kurask head; the menu "Re-stuffing it will cost 6,000 coins." /
  "Remove the stuffing.|Cancel"; t7285 Remove: the kurask head back in slot 5, mesbox and objectbox
  "You carefully unstuff it." showing the head.

Ours: the Unstuff menu titles of the other trophies (only the kurask's is captured) use her stuffing
price for that trophy; the transcript's raw-fish remark is not played (the transcript doesn't say
which fish count), so raw fish get the "anything else" line.
