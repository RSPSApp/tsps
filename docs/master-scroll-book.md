# Master scroll book

`server/plugins/items/MasterScrollBook.plugin.js`. The book stores teleport scrolls and reads
them from interface 597 (`bookofscrolls`) or, as its Teleport, the default one.

## From the cache

- Interface 597 has 20 entries, `bookofscrolls:teleportscroll_<key>`, each with the ops Activate,
  Set as default and Remove. Revenant caves also has Config, and its cache script gives that
  entry the Revenant cave teleport's three entrance submenus. The entries' ops are static
  (flags), so the server sends no `if_setevents` for them. The capture sends none either.
- Script 1939 (onLoad, through 1937 with a var transmit on varps 1589-1593, 4254 and 4699) draws
  each entry from its count varbit `bookofscrolls_<key>`: 10 bits each, so up to 1023. Watson's
  count is split: `watson_highbits * 256 + watson_lowbits` (script 2832).
- The default teleport is `selected_teleport_highbits * 15 + selected_teleport_lowbits`
  (script 5157). 0 means none. 1-20 follow the interface's order: Nardah, Digsite, Feldip Hills,
  Lunar Isle, Mort'ton, Pest Control, Piscatoris, Tai Bwo Wannai, Iorwerth Camp, Mos Le'Harmless,
  Lumber yard, Zul-andra, Key Master, Revenant caves, Watson, Guthixian Temple, Spider Cave,
  Colossal Wyrm, Chasm of Fire and Ardeaglais.
- Each key is also the scroll's obj gameval after `teleportscroll_`.

## From rsprox captures

From rsprox.net recording 3932 (rev 236). Its ticks are the client packet's tick, and the
server answers on the next one.

| tick | action | live |
|---:|---|---|
| 7294 | Teleport, default Zul-andra | `bookofscrolls_zulandra` 86 -> 85 and `busy` 1 on the next tick, with the scroll's own animation 3864 and sound 200. It lands at 2195,3057 three ticks later: the Zul-andra scroll's read. |
| 7304 | Open | `busy` 1, script `toplevel_mainmodal_open [-1, -1]`, 597 opened as the main modal |
| 7340 | Watson teleport (20) used on the book | the stack leaves the inventory, `watson_lowbits` 0 -> 20, "Your Master Scroll Book is now storing 20 Watson teleport scrolls" |
| 7344 | Remove default | chatbox menu "Remove your default teleport?" / "Yes\|No" |
| 7346 | Yes | `selected_teleport_lowbits` 12 -> 0, "You remove your default Master Scroll book teleport." |
| 7356 | 597 Watson entry, op 2 (Set as default) | 597 closes, chatbox menu "Set Watson teleport as your default teleport?" / "Yes\|No" |
| 7358 | Yes | `selected_teleport_highbits` 0 -> 1 (15 = Watson), "Your default Master Scroll Book teleport has been set to Watson teleport.", then 597 opens again |
| 7359 | Teleport | `watson_lowbits` 20 -> 19, animation 3864, map_anim 1039 and sound 200 on the player's tile, 597 closes |

On login the recording has every count varbit and the default sent with the rest of the
player's varbits.

## Not from a capture

- Wiki: the book holds up to 1000 of each scroll, and the counts stay with the player. A book
  swapped with Watson keeps them for the next book.
- Ours: Activate and Remove from 597 aren't in any recording. Activate closes the book and reads
  one stored scroll. Remove puts every stored scroll of that kind back in the inventory, or says
  "You don't have enough inventory space." when they don't fit.
- Ours: a scroll whose entry already holds 1000 isn't stored, and nothing is said.
- Ours: Teleport with no default set, or with none of the default left, opens the book.
- Ours: a scroll used on the empty book turns it into the book (the empty one has only Open,
  which opens 597).
- Not done: a dangerous PvP death that gives the stored scrolls to the killer (Wiki).

## Reading a stored scroll

The book doesn't teleport itself. It emits `teleport-scroll:read`
`{ player, itemId, subOpId, source: { has(), spend() }, handled }`, and the plugin that reads
that scroll from the inventory reads it the same way: the same checks, prompts, landing and
quest lock. The first listener that takes it sets `handled`:
`SpellTeleports` (the `scrolls` in `teleport-tablets.json`), `RevenantCaves`, `Shrine.Zulrah`
and `Scroll.TormentedDemons`. `spend()` takes one from the book once the reader's checks pass,
where it would have deleted the inventory scroll. The Revenant caves entry's Config emits
`teleport-scroll:configure`, which RevenantCaves answers with the scroll's own Config menu.
