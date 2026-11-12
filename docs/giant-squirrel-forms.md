# Giant squirrel forms

`plugins/npcs/pets/GiantSquirrel.Pets.js`. Every form is its own item and follower in the cache:
`skillpetagility` (20659 / 7351, house 7334), `skillpetagility_dark` (24701 / 9637, house 9638) and
`skillpetagility_bone` (30151 / 14044, house 14032); all share the Agility pet family, so one
insurance record follows the current form.

Wiki (Giant Squirrel, Dark acorn, Calcified acorn):
- A dark acorn used on the squirrel is eaten and turns it dark; a calcified acorn turns it skeletal.
  Either permanently unlocks that form for later Metamorphoses.
- The conversion lines are "The squirrel happily eats the dark acorn and magically turns into a
  darker colour. How unexpected." and "The squirrel carefully crunches the calcified acorn and
  magically turns into a skeleton. Whoops!".
- A calcified acorn on a bone squirrel answers "Your squirrel has had enough of those. It doesn't get
  more skeletal than this." and is not eaten.
- The Metamorphosis requirement is a dark acorn or a calcified acorn.

Issue 4423: Metamorphosis said "Nothing interesting happens." because `GIANT_SQUIRREL` has
`morphId: 0`. The giant squirrel items have only Drop in the cache's `inventoryActions`, so there is
no inventory Metamorphosis; the follower is the only place the option exists. No capture shows the
locked Metamorphosis click.

Ours: Metamorphosis cycles Giant, Dark, Bone through the unlocked forms (the Wiki's table order),
with the giant form always available; a change says "Your pet endures metamorphosis and transforms."
as the other pets do. The locked line, "You need a dark acorn or a calcified acorn to metamorphose
your pet like that.", is ours because there is no capture. A dark acorn on an already-dark squirrel
uses "Your pet can't change like that." as the Wiki records only the bone refusal.
