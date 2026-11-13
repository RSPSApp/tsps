# Impetuous Impulses (Puro-Puro)

Code: `server/plugins/minigames/ImpetuousImpulses.plugin.js` and its units in
`server/plugins/minigames/impetuousimpulses/`. Catching implings belongs to the Hunter plugin
(`skills/hunter/Catching.Hunter.js`).

## Equipment storage

`Storage.ImpetuousImpulses.js`: Elnock Inquisitor's Exchange option (op 4) and Quick-withdraw (op 5).

Holds one insect net (butterfly net or magic butterfly net), one imp repellent and up to 1,000
impling jars (Wiki, Elnock Inquisitor; cache enum 2850 has the same caps). The cache scripts draw
both panels, so the server only stores the counts and sends them in four varbits:

| varbit | value |
| --- | --- |
| 11767 `ii_stored_net` | 0 none, 1 butterfly net, 2 magic butterfly net (script 2259) |
| 11768 `ii_stored_repellent` | 0-1 |
| 11770 `ii_stored_jars` | 0-1000 |
| 11795 `ii_elnock_storage_selectedquantity` | 0 = 1, 1 = 5, 2 = All, 3 = X; picks each item's first op (scripts 2146/2148). The tackle box uses it too. |

The side panel (681) counts the inventory, its banknotes and the worn items (script 2149), and shows a
magic net first when both kinds are held (script 2260). The net and the repellent have one op
(Remove / Store); jars have four (Remove-/Store- 1, 5, X, All) and a Banknotes op.

From rsprox capture 20261111T231757 (rev 242, ticks 104-136; also rsprox.net recordings 95 and
1104 for the open):

- Exchange runs script 917 (-1, -1), opens 661 (main modal) and 681 (side modal), sets OP1 on
  661:8-11 (the quantity buttons) and sets `busy` (12393) to 1. Closing sets it back to 0.
- Storing the wielded net (681:1): the weapon slot empties, synth sound 2238 plays, the combat tab
  shows Unarmed and `ii_stored_net` goes to 1. No message.
- Remove on the net (661:3): `ii_stored_net` 0 and the net goes into the inventory.
- Store-all (681:4) moves the inventory net in, with no message.
- With nothing stored: "You haven't got any nets stored in here.", "You haven't got any repellent
  stored in here.", "You haven't got any impling jars stored in here.", and Withdraw-all (661:6)
  says "You have no items that can be withdrawn."
- The quantity buttons set varbit 11795 without a message.

Ours (not captured): storing with none held, or with the slot full, does nothing and says nothing;
a withdrawal with a full inventory says "You don't have enough inventory space."; Store-X and
Remove-X ask "Enter amount:"; Quick-withdraw runs Withdraw-all. Preset items are not stored. The
jars' Banknotes op isn't handled.
