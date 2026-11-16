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
Remove-X ask "Enter amount:", and the amount only counts while that opening of the storage is still
shown (not under a modal that replaced it, nor after a close and reopen); Quick-withdraw runs
Withdraw-all. Preset items are not stored. The jars' Banknotes op (9, which script 2146 adds because
jars have a banknote) takes every stored jar out as one stack of noted jars; nothing records its
amount.

The Bank PIN guards Exchange and Quick-withdraw (the Wiki files Elnock Inquisitor under "Bank PIN
protection"; feature `elnock-storage`, the bank's keypad title). A locked PIN asks first; the right
PIN reruns the option only if the player is still within 2 tiles of him.

## Anchovy oil and imp repellent

From rsprox captures, recording 468 (rev 233), and the Wiki ("Anchovy oil", "Anchovy paste").
Code: `server/plugins/minigames/impetuousimpulses/Supplies.ImpetuousImpulses.js` and the
`ii_anchovy_paste` / `ii_imp_repellent` rows of `server/plugins/skills/data/herblore.json`.

- Pestle and mortar on anchovies (ticks 4470-4485): "You grind the anchovies into a fishy, sticky
  paste.", seq `human_herbing_grind`, synth sound 2608; the paste stacks.
- Anchovy paste on the sieve, with 10 paste and an empty vial carried (tick 4567): 8 paste and the
  vial go, `ii_anchovy_oil` goes into the first free slot (not the vial's), the same tick, with no
  message, animation or sound.
- Sieve on 2 anchovy paste (tick 4686): "You need 8 lots of anchovy paste to make anchovy oil."
- Orange flowers on anchovy oil (tick 4774): the next tick, "You mix the flower petals with the
  anchovy oil to make a very strange-smelling concoction." (spam), the oil becomes
  `ii_imp_repellent` in its slot, 5 Herblore XP.
- Paste on paste does nothing.

The Wiki has paste on an empty vial with a sieve carried as the one working order; the capture
shows paste on the sieve works too, so both do. Vial on paste does nothing.

Ours (not captured): sieve on eight or more paste makes the oil like paste on the sieve; paste on the
vial gives the oil the same way (first free slot); the too-few line is shared by every order; a
missing sieve says "You need a sieve to make anchovy oil." and a missing vial "You need an empty vial
to make anchovy oil."; the repellent is made the same tick as the click, not the next.
