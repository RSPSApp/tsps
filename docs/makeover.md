# The makeover interface (Thessalia)

`server/plugins/npcs/Makeover.plugin.js` runs the makeover interface (516 `makeover`) that clothes,
hair and shoe providers open, and wires Thessalia's "Makeover" option (Varrock clothes shop,
npc `thessalia` 534 shown as `thessalia_normal` 10477). `openMakeover(player, type)` is exported
for the other providers.

Sources:
- rsprox captures (<https://rsprox.net/database>):
  - Thessalia's Makeover option, her Talk-to makeover branch and the burger menu: recording 3219, rev 232;
  - the Cam Torum barber's haircut (item clicks, Confirm): recording 1098, rev 237;
  - the Falador hairdresser (hat refusal, haircut, shave): recording 3241, rev 233;
  - the burger menu from the Makeover Mage, and the shoes/wristwear categories: recording 1552, rev 224;
  - Yrsa's shoes message: recording 102, rev 227;
- client scripts in the [pinned osrs-dumps](https://github.com/Joshua-F/osrs-dumps/tree/6e5033af6215963581a51b348f452320ff18f0f6/script):
  `makeover_init` (6776), `makeover_draw_items` (7072), `makeover_draw_item` (7073), `makeover_draw_colours` (7077),
  `makeover_create_dropdown` (7084), `makeover_draw_select_button` (7068); config `dump.enum` / `dump.dbrow` / `dump.dbtable`;
- the OSRS Wiki: [Thessalia's Makeovers](https://oldschool.runescape.wiki/w/Thessalia%27s_Makeovers).

## Thessalia's Makeover option (rec 3219)

op4 opens the chat menu `chatbox_multi_init ["A makeover is free!", "Change your top.|Change your bottoms.|Change your wristwear.|Cancel."]`.
The three choices open the interface on category 3 (top), 5 (bottoms) and 7 (wristwear). Cancel closes.
There is no refusal: the Wiki says equipment can be worn, the change just isn't visible under it.

## Opening a category

On the same tick, in this order:
- `varp makeover_colour` (3789) to the category's current colour (not for wristwear, which has none);
- `varbit makeover_interface_type` (4130) to the category;
- `varp makeover_hair` (3788) to the current style;
- `if_opensub` main modal `makeover`;
- `if_setevents` OP1 on `makeover:item_area` 0..(styles x 5), `makeover:colours` 0..(colours x 2) when the
  category has colours, `makeover:select` 0..10, `makeover:select_and_close` 0..10, `makeover:burger_menu_frame` 10..24;
- the chat menu closes.

From the next tick, and every tick while open, `map_anim makeover_changing_booth_idle` (2372) plays on the player's tile.
The capture is one player's view; the plugin sends it to every viewer (`sendGlobalGraphic`).

Captured ranges match the cache: top 0..100 / 0..58, arms 0..85 / 0..58, legs 0..110 / 0..58, hair 0..285 / 0..60,
facial hair 0..75 / 0..60, shoes 0..10 / 0..12, wristwear 0..10.

## Categories (makeover_init)

| type | name | style enum (int -> dbrow) | colour enum | appearance slot | colour slot |
| --- | --- | --- | --- | --- | --- |
| 0 | Hair | 496 `hair_styles` (57) | 890 (30) | head | hair |
| 1 | Facial hair | 2630 `facial_hair_styles` (15) | 890 | beard | hair |
| 2 | Body types | - | - | opens `makeover_mage` (205) live | |
| 3 | Top | 5495 `torso_styles` (20) | 789 (29) | chest | torso |
| 4 | Arms | 5496 `sleeve_styles` (17) | 789 | arms | torso |
| 5 | Legs | 5497 `legging_styles` (22) | 791 (29) | legs | legs |
| 6 | Shoes | 5498 `shoe_styles` (2) | 5290 (6) | feet | feet |
| 7 | Wristwear | 5499 `hand_styles` (2) | none | hands | |

Each style row gives `player_kit_id_type_a` / `player_kit_id_type_b`; the player's body type picks one.

## Clicks

- **Style** (`item_area`): the client makes 5 components per style, so style = slot / 5 (rec 1098: slots 15, 20, 25 set
  `makeover_hair` 3, 4, 5). The server previews it on the player's own appearance (an appearance update follows each click).
- **Colour** (`colours`): 2 components per colour, colour = slot / 2; sets `makeover_colour` and previews.
- **Apply** (`select`) and **Confirm** (`select_and_close`) keep the preview; Confirm also closes. Confirm messages:
  hair "You get a fresh, new haircut!", facial hair "You get a nice, clean trim!", shoes "You get a nice, new pair of shoes!".
  No capture shows a message for the clothes categories, so none is sent. No capture uses Apply.
- **Close** (close_modal): an appearance update follows (rec 3219), so the unkept preview is put back.
- **Burger menu** (`burger_menu_frame`): slot = 10 + 2 x type (Hair 10 ... Wristwear 24), from any provider. The server
  closes and reopens the interface on that category (if_closesub then if_opensub, rec 3219/1552).
- **Hat:** switching to hair or facial hair while wearing a head item closes the interface and shows the objectbox
  "You should take off your hat if you want to get a haircut!" with the worn item (rec 3219: max hood; rec 3241).

## Approximations

- `makeover_hair` on opening: live sends values that are not the style index (32 for a top list of 20), and the client
  compares it with a style's first component id. The plugin sends style x 5 so the worn style is highlighted.
- Body types: live opens `makeover_mage` (205); the plugin hands over to the Makeover Mage's designer (679) with the
  custom event `makeover-mage:open`.
- Switching category starts from the kept look: an unapplied preview is dropped, as the appearance update on the
  live switch suggests.

## Other providers

The Falador hairdresser (`hairdresser` 1305: op4, and Talk-to "I'd like a haircut please." / "I'd like a shave please.") would open type 0 / 1,
and Yrsa type 6; both need their own registration and the dialogue lines from their captures (rec 3241, 102).
Thessalia's Talk-to branch ("I'd like to change my top please." etc., rec 3219) is still the transcript dialogue and
does not open the interface.
