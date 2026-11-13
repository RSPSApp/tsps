# House on the Hill stone chest

The stone chest upstairs in Fossil Island's House on the Hill (loc `fossil_dkl_chest1`, 30720, at
3767,3872,1) takes numulites and gives the ten Fossil Island Notes. Plugin:
`server/plugins/areas/HouseOnTheHillChest.plugin.js`.

## What live does (rsprox captures)

All from rsprox.net recording 3040 (rev 231), 44 Search clicks between ticks 11054 and 14378.

| State | Search shows |
| --- | --- |
| Hole not found yet, no numulite | message box "It looks like the hole in the front of this locked chest exactly the size of a numulite." (t11054, t11258) |
| Hole not found yet, numulites carried | the same message box, then "Insert a numulite into the hole?" / "Yes, insert a numulite." / "No, keep my numulites!" (t11279, t11343) |
| Hole found, 100+ numulites | "Insert 100 numulites into the hole?" / "Yes, insert 100 numulites." / "Don't waste numulites!" (t11969 on) |
| Hole found, no numulites | player chat (chatneu2): "Perhaps I should have brought some more numulites with me." (t11896) |

Inserting one numulite (t11347): human_pickuptable, sound 2402, one numulite removed, then two
numulite object boxes: "You place a numulite into the hole, it rattles around and a mechanism
clicks a few times and the lid opens ever so slightly." and "You notice a scratched number 100
near the hole. Perhaps you should feed in more numulites?". From then on Search offers 100.

Each "Yes, insert 100 numulites." removes 100 and has one outcome:

- **Clunk** (13 of 47): "The numulites seem to clunk hollowly and nothing happens to the chest.",
  sound 2386.
- **Spike** (13 of 47): "The numulites seem to rattle louder and a spike shoots out of the hole,
  stabbing you.", the player says "Ow!", sound 2386 and a hit. The 11 hits with a known
  Hitpoints level fit `5 + floor(hitpoints / 20)` (99, 94, 90, 85, 81 -> 9; 73, 67 -> 8; 59, 52,
  46 -> 7; 39 -> 6).
- **Open** (21 of 47): sound 2387, the collection log message, the note in the inventory and an
  object box with it: "The chest pops open and you snatch a very aged piece of parchment before
  it slams shut again." The notes came in item order, fossil_note1 (Scribbled note) to
  fossil_note10 (Short note), each after the previous one had been put into the note book.
  With all ten (t14378): "You don't find anything much of interest." and the player's
  (chatquiz1) "Hmm, maybe I have all the old notes now.", sound 2387.

Using a numulite on the chest is the engine's "Nothing interesting happens." (t11967).

## Ours

- The outcome weights (2 open : 1 clunk : 1 spike); the capture's 21/13/13 is all there is.
- Which notes count as owned: inventory, worn and bank. Live also counts the note book, which
  tsps doesn't have yet.
- A full inventory drops the note under the player; the capture always had room.
- The hole being found is a saved attribute (`house-on-the-hill:chest-hole-found`); live sends no
  varbit for it.
- The spike never takes the last Hitpoint (at 10 Hitpoints the formula alone would take 5 twice);
  the capture never went below 39.
