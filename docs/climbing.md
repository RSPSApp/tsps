# Ladders, stairs and gangplanks

Where a ladder, staircase, trapdoor or gangplank leads is worked out from the cache's own map data. There is no list of coordinates. The code is `server/plugins/objects/Ladders.plugin.js` (the handlers) and `server/plugins/objects/ClimbLinks.js` (where they lead).

## How a destination is found

1. **The other end:** an object with a climb option in the opposite direction. For example, a Climb-up staircase pairs with a Climb-down one above it, and a trapdoor with the ladder below it.
   - **The plane above or below:** it is looked for there first, within a few tiles of the clicked object.
   - **Underground:** ladders and trapdoors on the ground floor lead 6400 tiles north, on plane 0, where OSRS keeps the area below. Going up from underground, the surface is checked first. Lumbridge castle's trapdoor at 3209,3216 opens over the cellar ladder at 3209,9616.
2. **The landing tile:** a walkable tile next to the other end, on a side it can be used from. That's its access mask and rotation, the same reach check object clicks use. Where several qualify, the one nearest the tile the player climbed from is used.
3. **Top-floor / Bottom-floor** (Lumbridge castle's staircases): the chain of staircases is followed to the last floor.
4. **Gangplanks** ("Cross" on both halves): between a dock (plane 0) and the ship's deck beside it (plane 1). The other half is the gangplank of the same name on the other plane. The landing carries on in the direction of travel, onto the deck or back onto the dock.

If the map has nothing at the other end, the click does nothing.

## What is covered

- **Names:** Ladder (and "ladder"), Staircase, Stairs, Steps, Trapdoor, Manhole, Spiral staircase, Vine ladder, Ship's ladder, Bamboo Ladder, Metal/Iron/Rope/Stone/Copper/Tower/Boney/Troll ladder, Kings' ladder, Ladder top, Rope, Climbing rope, Escape rope, Anchor rope, Rope anchor, Stairs up/down, Wooden Stair, Stone/Crystal/Crypt staircase, Broken stairs, Cellar stairs and Stairwell.
- **Options:** Climb (asks which way), Climb-up/Climb-down and their spellings (Climb up, Climb Down, Walk-up, Walk-down, Ascend, Descend), Top-floor, Bottom-floor, and a gangplank's Cross.

These come from a survey of every placed object in the cache with a climb option.

## Not covered

These lead somewhere content decides, so they belong in area, minigame and quest plugins (issue #119):
- "Enter", "Exit", "Leave-area", "Pass", "Jump" and "Squeeze-through" (cave entrances, portals, agility obstacles, minigame objects);
- trapdoors' and manholes' "Open", which swaps in an open object the cache doesn't link to.

## When content knows better

- **An explicit destination:** an area, quest or minigame plugin passes it through `ladders:climbUp` / `ladders:climbDown`. Edgeville, the Varrock sewers, the Wizards' Tower basement, Karamja and King Black Dragon do this.
- **Claiming the click:** a plugin claims it outright with `ladders:climb`. Castle Wars does this for its ladders, and Dragon Slayer for the Lady Lumbridge's gangplanks.

Objects that need a quest in OSRS (for example a Troll ladder, Kings' ladder or Crystal Staircase) can now be climbed wherever the map pairs them up. The quest should claim them when it is implemented.
