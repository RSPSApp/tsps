# Ring of the elements

`server/plugins/items/RingOfElements.plugin.js`. Charges are kept per player (1-10,000);
one air, water, earth, fire and law rune make a charge, and each teleport costs one.
The charged ring is untradeable, so its id follows the stored charges.

## Live behaviour (rsprox captures)

Recordings 364 and 365 (revision 231) show the following. Revision 241's cache has the same
item (26815 uncharged, 26818 charged) and the varbits/spotanims named below.

- **Teleport.** Rubbing opens "Where would you like to teleport to?" with Air, Water, Earth
  and Fire Altar. The player casts `human_castteleport` with the altar's own graphic at height
  92 (`teleport_casting_air`, `_water`, `_earth`, `_fire`, not the plain `teleport_casting`),
  and lands on the third tick after the click. The charge is spent on that tick:
  `ring_of_the_elements_charges` drops by one and `ring_of_elements_last_destination` becomes
  1 (air), 2 (water), 3 (earth) or 4 (fire).
- **Landing tiles.** Air (2980, 3278); earth (3286, 3467-3468); fire (3314, 3276); water
  (3165-3167, 3156-3160). The server uses one recorded tile for each altar (water 3165, 3160),
  the live ring's small spread is not reproduced.
- **Low charges.** On landing with 5, 4, 3, 2 or 1 charges left the player receives
  `<col=ef1c1c>Your ring of elements has N charges remaining.` ("1 charge remaining" for one).
  No message is sent at 99-96 charges. Recordings show nothing between 6 and 95 remaining, so
  the server warns from five down.
- **Uncharged ring.** Rub shows an item box with the ring: "Your ring of the elements has no
  charges remaining."
- **Charging.** Using any of the five runes on the ring opens the amount prompt "How many
  charges would you like to add? (0-N)." where N is the largest charge the runes allow (the
  recordings show 557, 563 and 567). Without all five runes a message box says "You require at
  least one air, water, earth, fire and law rune to charge your Ring of the Elements."
- **Uncharge** (the charged ring's fifth inventory option). Away from a bank a message box says
  "The Ring of the Elements has N charges. You can uncharge it at a bank." At a bank a choice
  asks "Ring of the Elements charges: N. Uncharge it?" with "Yes - uncharge it" and
  "No - keep the charges".

## Wiki

[Ring of the elements](https://oldschool.runescape.wiki/w/Ring_of_the_elements) (fetched
7 November 2026): five runes per charge, 10,000 charges, per-player charge count,
untradeable when charged, Uncharge returns the runes at almost any bank.

## What the server does

All of the above, plus: the charges and last-destination varbits are sent on every change and
at login; Uncharge returns one of each rune per charge when every stack fits the inventory
(otherwise "You don't have enough inventory space to do that." and nothing changes).

## Not covered

- The live message after entering a charge amount, a fully charged ring and the last charge are
  not in any recording; the server keeps its earlier wording ("You charge the ring of the
  elements.", "Your ring of the elements is fully charged.") and sends no message for the last
  charge.
- "At a bank" is a loc or NPC with a Bank option within three tiles; the live check is a zone.
- The refunded rune amount is one of each per charge (the reverse of charging); no recording
  shows a completed Uncharge.
- Wintertodt warm clothing (the Wiki lists the ring) belongs to the Wintertodt plugin.
