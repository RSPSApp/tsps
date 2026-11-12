# Beaver forms

`plugins/npcs/pets/Beaver.Pets.js`. Every form is its own item and follower in the cache: `skillpetwc` (13322 / 12181),
`skillpet_wc_<oak|willow|teak|jatoba|maple|mahogany|arctic|yew|camphor|magic|ironwood|redwood|rosewood>` and
`skillpet_wc_pheasant` / `skillpet_wc_fox`; all share the Woodcutting pet family, so one insurance record follows the
current form.

Wiki (Beaver, Funky shaped log):
- A Funky shaped log used on the beaver is consumed and permanently unlocks recolouring; each colour is then applied by
  using that log on the beaver, which uses up the log. Plain logs give the default colour back.
- A golden pheasant egg and a fox whistle (each consumed) unlock the pheasant and fox forms, without the funky log.
- Once unlocked the forms change freely; a recoloured beaver turned into a fox or pheasant comes back in the default
  colour.

rsprox captures: 2780 tick 349 and 2783 tick 160, inventory Metamorphosis with nothing unlocked, open the messagebox
"You can unlock the ability for your pet Beaver to change colour by<br>feeding it a <col=0000b2>Funky shaped log</col>."
(`messagebox:safezone`); 2783 tick 172, magic logs used on that beaver, "Nothing interesting happens.".

Ours (no capture of an unlocked beaver): Metamorphosis cycles Beaver, Pheasant, Fox through the unlocked forms (the
Wiki's table order); with only colours unlocked it says "Your pet can't change like that."; the unlock lines; a change
says "Your pet endures metamorphosis and transforms." as the other pets do; the follower's locked Metamorphosis shows the
item's messagebox.
