# The Apothecary's Potions (Varrock)

`server/plugins/npcs/Apothecary.plugin.js` serves the Apothecary's potion-making interface,
`apothecary_potions` (556).

## How live does it (rsprox captures)

Recordings 3219 (rev 232, ticks 5444-7171) and local 1001334 (rev 240, tick 2673):

- **Potions** (op3) opens the interface: `toplevel_sidebutton_switch [3]`,
  `toplevel_mainmodal_open [-1, -1]`, then the main modal.
- **Talk-to** -> "Can you make potions for me?" opens it as the player's line is continued.
  The osrsreboxed-db transcript exports this step as `open_shop "Apothecary's Potions"`; the
  plugin answers it with the interface rather than the shops.json shop.
- On open, each potion gets its title, its contents and its model (`if_setobject`, zoom 380):

  | Potion | Model | Contents |
  |---|---|---|
  | Strength potion | strength4 (113) | Red spiders' eggs, Limpwurt root, 5 coins |
  | Energy potion | 4dose1energy (3008) | Chocolate dust, 2 limpwurt roots |
  | Antipoison potion | 4doseantipoison (2446) | Cadava berry, Limpwurt root, 5 coins |

  Each ingredient line the player lacks is wrapped in `<str>`, and lines are joined by `<br>`.
- Buy-1, Buy-5, Buy-X and Buy-All (static ops on components 2, 7 and 12) without the
  ingredients answer `You haven't got the required items.`. Buy-X refuses without opening
  an amount prompt.
- With the ingredients, Buy-X opens the `Enter amount:` prompt (meslayer_mode7, tick 7070).
  The answer 5 with ingredients for 3 made three strength potions (tick 7171), with no message
  or sound. The same tick, the whole open ran again: both scripts, the modal, then the
  contents. This is the only captured purchase.

The quantities come from the OSRS Wiki's Apothecary page.

## Ours

- Buy-1, Buy-5 and Buy-All purchases follow the one captured Buy-X purchase: as many as the
  ingredients pay for, then the interface is opened again.
- A second Buy-X while the prompt is still open re-arms it for the potion clicked last, as
  the core's shops do. No capture shows this.
- From the chat the interface opens one tick after the line is continued. On live it opens
  in the same tick. The conversation runtime closes the chatbox after the action step.

A strength potion made here emits `apothecary:strength-potion-made`, which credits the Varrock
diary task.
