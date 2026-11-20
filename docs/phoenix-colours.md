# Phoenix colours

`plugins/npcs/pets/Phoenix.Pets.js`. Every colour is its own item, follower and house NPC in the cache:
`phoenixpet` (20693) / `phoenix_pet` (7370) / `poh_phoenix_pet` (7368) for red, and
`phoenixpet_<blue|green|purple|white>` (24484, 24483, 24486, 24485) / `phoenix_pet_<colour>` (3082, 3081, 3084,
3083) / `poh_phoenix_pet_<colour>` (3078, 3077, 3080, 3079). All share the red phoenix's family, so one insurance
record follows the current colour. The unlocked colours are kept in `pets:phoenix-unlocks`.

Wiki (Phoenix):
- "Players can change the Phoenix's colour by using 250 of the desired gnomish firelighters on it [...] Doing so
  unlocks that colour permanently, even if the pet is reclaimed from Probita."
- Players "can switch freely between the unlocked colours" with Metamorphosis, which is on the item and the follower.

rsprox captures:
- 2783 tick 346: 250 purple firelighters (`trail_gnomish_firelighter_purple`) used on the white phoenix item take all
  250, turn the item into `phoenixpet_purple`, and open `objectbox_double` with the firelighter and the purple
  phoenix: "You coat your phoenix in the Purple chemical, turning<br>it a brilliant Purple! You have now unlocked
  Purple as<br>a colour for your pet." The text is sent first as a mesbox chat line.
- 2780 tick 487 and 2784 tick 600 (item), 2783 tick 416 (house phoenix): Metamorphosis opens the chatmenu
  "What colour would you like to transform your phoenix into?" with Red, then the unlocked colours without the
  current one, then Cancel. Seen: `Red.|Cancel.` (white, only white unlocked), `Red.|Purple.|Cancel.` (white) and
  `Red.|White.|Cancel.` (purple).
- 2783 tick 419-420: choosing White changes the house phoenix with no chat line.

The firelighters: blue `gnomish_firelighter_blue`, green `gnomish_firelighter_green`, purple
`trail_gnomish_firelighter_purple`, white `trail_gnomish_firelighter_white`. Red is the default colour and has no unlock.

Ours (not captured):
- When several colours are unlocked, they are listed in the Wiki's variant order: Blue, Green, Purple, White.
- A red phoenix with nothing unlocked says "Your pet can't change like that.", the line other pets use.
- Fewer than 250 firelighters, a colour that is already unlocked, or a red firelighter are left to the engine's
  "Nothing interesting happens."
- Choosing a colour on the item or the follower is silent, as the house phoenix's change is.
- The house phoenix's own Metamorphosis in the menagerie isn't handled here.
