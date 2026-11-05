# Construction

Player-owned houses: rooms, furniture and what the furniture does. The plugin is
`server/plugins/skills/Construction.plugin.js`, with one unit per part in
`server/plugins/skills/construction/` and its tables in `construction/data/`.

Behaviour follows the [OSRS Wiki](https://oldschool.runescape.wiki/w/Construction) and
[rsprox.net captures](https://rsprox.net/database); ids come from the cache. Where neither
covers something, this page says so.

## Layout

| Unit | What it does |
| --- | --- |
| `House` | Hooks, house entry and exit, building and removing furniture, guests, adverts, house options, chairs |
| `Instance` | `PlayerHouseInstance`: the instanced house (an `Area`), its palette, doors, hotspots and furniture |
| `Data`, `Estate` | Tables from `data/*.json`; house locations and styles |
| `Stairs` | Climbing between floors, building a room through a staircase |
| `Portals`, `Altars`, `Storage`, `Servants`, `EstateAgent` | Portal chamber and nexus, altars and burners, costume storage, servants, Estate agents |
| `JewelleryBox`, `Mounted`, `SuperiorGarden`, `Lectern` | Teleport furniture and teleport tablets |
| `Workshop`, `Workbench`, `Kitchen`, `Tea`, `Study`, `CombatRoom` | Tool stores, clockmaker's bench, repair stand, flatpacks, larders, shelves, barrels, kettles and tea, telescope, crystal ball, clock, adventure log, combat dummies |
| `Bookcase`, `TipJar`, `Scrying`, `CapeHanger`, `Trophies` | Bookcases, tip jars, the scrying pool, the cape hanger, skill hall trophy displays |
| `CombatRings` | Boxing, fencing and combat rings, ranging pedestals, racks, the balance beam |
| `GamesRoom` with `Prizes`, `RangingGames`, `Hangman`, `ElementalBalance`, `AttackStone`, `Jester`, `TreasureHunt` | The games room |
| `Menagerie` | Pet houses, the pet list, roaming pets |
| `Dungeon`, `ThroneRoom` | Guards, traps, doors, treasure, oubliette; the throne room lever, trapdoors and cages, challenge mode |
| `MahoganyHomes` | Contractors, contracts, the clients' homes, the reward shop |
| `Menu`, `Commands` | The generic option menu (script 217); `::hotspots` |
| `Ids` | Ids by the cache's gameval names (`Ids.loc("poh_exit_portal")`); a name the cache lacks stops the plugin loading |

Walls, windows and scenery collide as the cache's template chunks place them (each room turned
with its rotation), with the chunks' blocked tiles; doors and furniture add their own collision.
Before this every wall could be walked through.

Empty slots take each floor's filler chunk: the basement and ground floor templates, and upstairs
the blank chunk, whose tiles all block, one slot past the grid too. Live sends the blank chunk
upstairs whether or not building mode is on (rsprox captures: 1,463 of 1,470 house rebuilds), so
an upstairs doorway into nothing can't be walked through.

The house runs as an `Area`: per-tick work (chairs, servants, burners, the owner's Kick option,
combat dummies, dungeon traps and guards) happens in `PlayerHouseInstance.process` for
occupants only. Its `canAttack` lets players fight only inside a ring, and `canCastOnNpc`
sends spells on the elemental balance to the game.

## Data

Whatever the cache has is read from it when the plugin loads, by gameval name, so a cache update
needs no data refresh:

- Furniture name, level, materials, menu icon and hidden-in-menu from DB table 110 `furniture`;
  room level and cost from 111 `poh_room`; the house viewer's furniture rows per hotspot from
  112 `poh_hotspot`.
- The combat stone's crack forms (`poh_tbt_<stone>_<crush><stab><slash>` NPCs), each mounted
  cape loc and its cape and hood (`poh_mounted_*`), the trophy menu's trophies (enum 5215, their
  furniture rows and the `poh_trophy_<name>_<wood>` locs) and the Mahogany Homes homes (the
  `con_contract_<home>_hotspot<n>` multilocs and the furniture each turns into).

`plugins/skills/construction/data/` keeps only what the cache doesn't: each piece's experience,
built loc ids, build animation, tools and upgrade source (`furniture.json`), room names, template
chunks and hotspots (`rooms.json`), the hotspot locs, trophy experience (Wiki) and each Mahogany
Homes client and the Wiki's planks per piece. `yarn dump:construction` (in `server/`) reports rows
the data names that the cache lost, and cache rows and trophies with no hand data yet.

The units name every loc, NPC, obj, animation, graphic, varp, varbit and interface by its gameval
through `Ids`, and families by their pattern (`poh_nexus_tele_<n>`,
`poh_elemental_balance_<tier>_<colour><n>`, `chair_sit_ready_throne_<n>`, the door spaces
`poh_hotspot_door*`). Sounds, client scripts, enums and struct params have no gamevals and stay
named constants. The data files above still hold loc, obj and animation ids as numbers.

The house save attribute is `Data.HOUSE_ATTRIBUTE`; every unit that writes it imports that.

A furniture row may say `savesAs`: an upgrade row (a trophy display's next wood) saves as the
furniture it makes.

Hotspot locs are shared between some rooms (the hall and dungeon stair spaces), so a loc is
resolved to a hotspot through its room (`Data.hotspotIn`). Building on a hotspot furnishes every
placement of it in the room (all tiles of a rug, every window's curtains); Remove takes them all.

## Furniture with behaviour

### Teleports

- **Jewellery boxes:** Teleport Menu opens interface 590 through its init script (1685: tier,
  name, requirement bits); a pick is `resume_pausebutton` on 590:0 with the slot (captures). The
  teleport lands on the third tick and sets varbit 2308 to slot + 1, which picks the box's
  multiloc and so names its quick-teleport op (last destination). Tiles are the jewellery's own
  (`plugins/items/Teleports.Jewellery.js`). Of the requirement bits (Tears of Guthix, Kourend,
  Miscellania, Dondakan's Rock, Fortis Colosseum), the first four are sent set, as the jewellery
  doesn't gate them here; captures (rev 224-239, 61 of 62 recordings) send 15, and Fortis
  Colosseum's bit is set only with the Colosseum's Hero title (`colosseum:has-rank`; Wiki, Ring
  of dueling). A struck-out row shows the jewellery's own locked message.
- **Mounted amulet of glory, mythical cape:** one op per destination.
- **Mounted Xeric's talisman and digsite pendant** (portal nexus room): Teleport menu and
  Configuration use the generic menu ("Xeric's Talisman teleports" / "... left click", from
  captures). Each left-click setting is a separate loc, swapped in as the furniture's displayed
  loc. Xeric's casts `arceuus_necromancy_anim` with `xeric_teleport_spotanim`; its tiles are the
  middle of the captured landing spots (tsps has no Xeric's talisman item yet).
- **Superior garden spirit tree, fairy ring, spiritual fairy tree:** hand the player to the
  networks (`spirit-trees:open`, `spirit-trees:last-destination`, `fairy-rings:configure`,
  `fairy-rings:zanaris`, `fairy-rings:last-destination`), whose rules apply.
- **Lecterns:** Study opens `teletabs_craft_if` (403) after setting varp 4074 to the lectern's
  tablet enum (4108, 4178, 4179, 5267-5271 by lectern) and varp 2224 (quantity). Tabs set varbit
  10600; confirm makes one tablet every 4 ticks (`poh_create_magic_tablet`, synth 228), each
  taking soft clay and runes (staves and the rune pouch count). Levels, runes and experience per
  tablet are the Wiki's (Magic tablet).

### Portal nexus

Its interfaces are the live ones (rsprox captures; cache enums 1375 and 1377 and their structs
give each destination's name, runes, Magic level and alternate). The player's slots are varbits
`poh_nexus_tele_<n>` and `poh_nexus_left_click`; the interfaces work on their `_temp` copies.

- **Teleport** goes to the left-click destination (the menu when there is none): the player
  faces the portal and leaves two ticks after arriving, with `poh_nexus_id` set (captures,
  revisions 228-239).
- **Teleport Menu** opens `telenexus_teleport` (17); a row teleports at once, and the second
  list gives the Grand Exchange, Seers' Village and Yanille (landings from captures).
- **Configuration** opens `telenexus` (19). Dragging a slot onto the portal makes it the
  left-click destination and its options pick it or its alternate; Done saves (captured). Adding
  a destination (dragging it from the available list), reordering and removing slots aren't
  captured: new destinations cost 1,000x the spell's runes from the inventory on Done and need
  its Magic level, removing refunds nothing, and a nexus holds 4, 8 or 41 (Wiki).
- Older saves' destination lists on the nexus become the player's slots.

### Floors

Staircases (Climb-up, Climb-down, Climb on spiral staircases) and the garden's dungeon entrance
move the player a floor, keeping their tile. The room at the other end must have connecting
stairs, and two halls must face the same way. Otherwise the captured messages say why. In
building mode a staircase that leads nowhere offers to build the matching room with its
staircase ("These stairs do not lead anywhere. Do you want to build a room at the top?").
Halls' spiral staircases and the garden's entrance lead to the dungeon stairs room; a throne
room's trapdoor (Open, then Go-down) leads to the oubliette's ladder, and building mode offers
"Do you want to build an oubliette below the throne room?". House ladders and staircases answer
the generic Ladders plugin's `ladders:climb`, which otherwise claims every Climb.

### Workshop and kitchen

- **Tool stores:** each rack's tools ("Select a tool"; tiers from the Wiki's Tool space).
- **Clockmaker's bench:** menus by table tier, then "Select a toy" / "Select a horsey colour"
  (captures); 15 Crafting experience per product, levels from the Wiki. The watch's
  missing-materials message is inferred from the captured ones.
- **Workbench:** Work-at opens the flatpack categories (enum 3526), then the category's
  furniture; a pick makes the flatpack with the furniture's materials and experience, up to the
  bench's level. Using a flatpack on a hotspot installs it in building mode.
- **Armour repair stand:** Barrows repair at Bob's price x (1 - Smithing / 200) (Wiki), through
  the `barrows:repair` event.
- **Larders, shelves:** "Select an option", four at a time with More... (captures; contents
  from the Wiki). The shelves' cup is from captures (the Wiki's table leaves it out).
- **Barrels:** a beer glass on a barrel fills it, with the barrel's pour animation.
- **Stoves:** the firepits cook as fires, the ovens and ranges as ranges (Cooking). Kettles
  fill at sinks (WaterSources).
- **Tea:** a full kettle on any stove but the plain firepit shows the stove's kettle loc ("You
  place the kettle over the fire."), boils after eight ticks ("The kettle boils.", synth 935),
  and Take-kettle gives a hot kettle. Leaves, hot water, pouring and milk follow the captures.
  Drinking is the Potions plugin's: the cup's own drinking animation and messages, and
  Construction +1, +2 or +3 for clay, porcelain or gilt (Wiki). Cups of tea don't leave the
  house (Wiki).

### Study, gallery, garden and skill hall

- **Telescopes:** the next shooting star's region and a landing window as wide as the
  telescope's accuracy (Wiki: oak 24, teak 9, mahogany 2 minutes), via
  `shooting-stars:forecast`. Which regions take "the" is inferred beyond the captured
  "the Kharidian Desert".
- **Crystal ball, elemental sphere, crystal of power:** change an elemental staff's element;
  battlestaffs cost 100 and mystic staffs 1,000 runes of the new element (Wiki).
- **Bookcases:** `poh_bookcase` (910) lists enum 5210's books and shows the found ones from
  varps 805, 261-266 and 1037 (cache scripts 7834-7843); a click takes a copy with the captured
  messages. A book counts as found once the player has carried or banked it when they search a
  bookcase (the live game marks it when the book is obtained).
- **Tip jars:** guests tip coins or platinum tokens (amount prompt ours); the owner sees the
  captured contents box and takes them to the inventory or bank; Setup shows and switches
  notifications and banking on logout. One balance per house; Ironmen can't tip (Wiki).
- **Scrying pool:** Scry offers the room's directed portals and the entrance, places the player
  at the destination with the captured overlay and "You view ...", and brings them back to the
  pool when they continue. The live game hides the scrying player; tsps has no hidden players.
- **Garden plants:** furniture planted from a bagged plant (the `poh_sapling_*` objs: trees,
  plants, flowers, hedges, the topiary bush and the Zen theme) waters in, as rsprox captures
  show (rev 230-234, recordings 2856, 3267, 3275). The pick plays `farming_watering` with
  spotanim 410 at height 92, takes one charge from a watering can or Gricoller's can (through
  Farming's `farming:use-water`), plays synth 2446 and gives Farming experience equal to the
  Construction experience (Wiki: Bagged plants). With no water: "You need a watering can with
  water in order to plant garden plants." The menagerie's habitats water in too but give no
  Farming experience (Wiki: Pet house). The hammer and saw are still asked for; the captures
  don't show a planting without them.
- **Cape hanger:** cape and hood mount as their `poh_mounted_*` loc; Take, Admire and, for the
  owner, the cape's options through `skillcape:operate` in the SkillCapes plugin. Untrimmed
  skillcapes show trimmed once the owner has two 99s (Wiki).
- **Trophies:** the head and fishing spaces take teak/mahogany/gilded and oak/teak/mahogany
  displays (upgrades keep the trophy). Trophies opens `poh_trophy_menu` (912) and
  `poh_trophy_side` (911) with varps 261 (wood), 262 (shown), 263 (2 heads, 4 fish) and 264
  (mounted bits). A stuffed item clicked in the side panel is mounted for good with its
  experience (Wiki; the basilisk's Slayer 341 is captured), boss heads asking first about their
  combat experience; Display shows a mounted one if the wood allows. Old-system trophies become
  the display of their first wood showing that trophy.
- **Clocks:** "It's Rune o'clock." (captures).
- **Adventure logs:** the owner's log menu; Collection log opens the collection log.

### Combat room

- **Combat dummies:** Attach swaps the loc for the dummy NPC, which takes hits, never
  retaliates and never falls; Detach swaps back (captures).
- **Rings:** Climb-over (Walk-through for the pedestals' barrier) moves a tile across with the
  captured animations and equipment refusals. Players inside the same ring can fight; one
  beaten there is put outside at full health with their items (Wiki).
- **Racks:** "What do you want to take?" with gloves, wooden sword and shield and the pugel by
  tier (captures). These items don't leave the house.
- **Balance beam:** Stand-on at an end wields the pugel ("Climbing on to beam.", captured
  checks), Get-down jumps off. Pugel blows don't hurt; a landed one knocks the other player off
  a third of the time (ours).

### Games room

- **Prize chest:** the owner puts coins in, up to the chest's Wiki maximum. When the owner
  starts a game while it holds a prize, they are asked "Offer the prize for this game?"; that game's
  winner gets a prize key ("A little key appears in your pack!"), which opens the chest.
- **Hoop and stick, dartboard, archery target:** captured animations, projectiles, sounds and
  the `poh_ranging` overlay; ten shots each, the best score wins. Hit chances and scores are ours.
- **Hangman:** the Wiki's words, single letters or up to five with Guess, a piece of armour
  (armour1-10) per wrong guess, turns, and the captured word and winner messages. The
  no-winner ending is ours.
- **Elemental balance:** strike to surge spells move the orb 1-5 shades towards their element
  (Wiki), shown as the cache's colour and brightness NPCs; runes from the inventory only.
  Turning it white wins. How unbalanced it starts is ours.
- **Attack stones:** Set-up, Hit; the stone cracks by crush/stab/slash damage, "Fragments of stone
  hit you in the face!", "You shatter the stone!" (captures); 2.5% experience, none in Hitpoints
  (Wiki). Most damage wins.
- **Jester:** the captured summoning, then default emotes to copy within three tiles; ten copies
  win (Wiki). Emote timing and count messages are ours.
- **Treasure hunt:** the fairy hides on the fairy house's floor; Feel says the captured cold to
  very hot, and finds her on her tile. The distances behind each message are ours.

### Menagerie

Using a pet on menagerie furniture stores it; the pet house's View lists the stored pets (enum
985, varps 864, 1416 and 4718, cache scripts 639-643) and takes them back, and Toggle (varbit
2013) lets them roam the menagerie outside building mode. Stored pets count as owned
(`pets:held-elsewhere`).

### Dungeon and throne room

- **Guards and guardians** stand in for their furniture as NPCs outside building mode and come
  back when the house next loads; in challenge mode they attack guests nearby.
- **Doors and cages** open and close; in challenge mode they are locked to guests, who pick or
  force them at the Wiki's odds.
- **Traps** (challenge mode, Agility dodges) and oubliette floors hurt guests; damage the Wiki
  doesn't give is ours.
- **Treasure chests** hold the owner's coins up to the chest's limit, added every 5 minutes;
  guests take them in challenge mode once the guardian is dead.
- **Throne room:** thrones sit like chairs; the lever's Pull drops guests on a trapdoor floor
  into the oubliette ("The trapdoor opens!") or cages them for the owner to release, drop or
  expel (captured menus); its second op turns challenge mode on and off (message ours).

### Mahogany Homes

Amy (Falador), then Marlo, Ellie and Angelo give contracts at the Wiki's tiers for a random
client's home. Each home's hotspots show, per player, broken (Repair: a plank, or a steel bar
for a sink, range or bath), old (Remove), empty (Build: the Wiki's planks) or the new piece.
The client pays the tier's experience and Carpenter points and restores run energy; the full
Carpenter's outfit adds 2.5%. Last-tier contract repeats the last tier; Rewards opens the shop
(673) with the Wiki's prices; the supply crate rolls the Wiki's table. One Leagues capture
(recording 1863, rev 227) gives the tier menu ("Select an option": "Beginner Contract", "Novice
Contract (Requires 20 Construction)" ... "I'll pass actually.", every tier listed), Repair and
Build playing `human_poh_build` with synth 938, Remove playing `human_throw_away` with synth 2097
or 2098 (delay 20), and the last job's `<col=229628>Jeff seems happy with your work. Talk to him
for your reward.</col>` (him/her from the Wiki's client genders). The rest of its dialogue and
messages are ours (except "I'd better leave this alone right now."), and which pieces need work
approximates the Wiki's per-client layouts.

### Adding a room

Rsprox captures of picking a room in the room menu (212, rev 229-236):

- **At a door hotspot:** the room list closes and the chatbox asks "Select an option" with Rotate
  clockwise / Rotate anticlockwise / Build / Cancel (Build / Cancel for the one-door rooms:
  portal chamber, throne room, treasure room). Meanwhile the room shows in place: a
  `poh_preview_wall` on each doorway and its furniture spaces, turned with it. Rotating redraws
  it and asks again; Build takes the coins and rebuilds the house; Cancel takes the preview away.
- **From the house viewer:** the viewer shows the room at the spot (varbits 5329-5335, script
  1376), Clockwise and Anticlockwise turn it, Done builds it and opens the viewer again, and
  Cancel goes back to the plain viewer.

Either way the room starts turned so one of its doorways meets a neighbour's. Rooms built
through a staircase or trapdoor ask Yes/No instead (captures). No room build sends a "You build"
line.

Refusals (captures, rev 229-235): "You can't afford to build that room." is a chat line on the
pick; the rest are message boxes: "You can only build 38 rooms with your Construction level."
(the player's cap), "That room can only be built underground." / "... on ground level.", "You
can't build a room that would have no room to support it.", "Your house is already the maximum
length.". A costume room, portal nexus or menagerie the house already has asks "You can only
build one of those rooms." ("You can only build one menagerie.") with "Move the room here." /
"Cancel."; the move goes through the same rotate menu and is free. If it can't move, the box says
"You already have one of those rooms. " and why.

Moving a room in the viewer refuses with message boxes: "That room can only go underground." /
"... on ground level.", "That room is supporting something else, so it can't be moved.", "You
can't move it above itself. It would fall down.", "You can't put it above that room.".

### Removing a room

Build on a door hotspot into a built room, or Delete in the viewer, asks "Remove the parlour?"
Yes / No (captures, 14 of 16 recordings); Yes says "Room deleted!". The door removes the room on
the far side from the player. "You can't remove a room that is supporting another room." and
"Your house must have at least one exit portal." are message boxes.

### Building furniture

Captures of the build menu (`poh_furniture_creation`, 542 picks in 123 recordings, rev 226-239):

- Each row's text is the name, then four lines whatever the count
  (`Oak chair|Oak plank: 2<br><br><br>`).
- A pick plays the piece's animation with synth 938 (111 of 123 recordings). Without nails it
  takes the materials and gives the XP on that tick; the piece shows a tick later.
- With nails nothing goes on the pick; each tick after it uses one nail ("You use a nail.", spam),
  the animation every tick and the sound every second tick, and the last nail takes the rest and
  gives the XP (recording 268). The best nails go first (Wiki). Live nails also bend ("You
  accidentally bend a nail.", recording 2594) at a rate neither the captures nor the Wiki give,
  so they don't bend here; running out mid-build says "You don't have enough nails left.".
- No "You build ..." line.
- Refusals: "You need a saw and a hammer in order to make furniture." (rev 236), "That can only
  be built by upgrading the previous piece of furniture.", "That can only be built if the hotspot
  is empty.", "You already have a tool store of that level in the room.", and a message box
  listing every material with the missing ones red: "You don't have the right materials: 2 x
  Plank, <col=ef1020>2 x Nails</col>".
- Remove asks "Really remove it?" Yes / No and the Yes is silent (recordings 257, 2594).
- A flatpack installs with the animation and synth 938, no XP or message, and needs a hammer
  ("You need a hammer in order to install flatpack furniture."); a space that doesn't take it says
  "You can't place that there." (recording 2605).

### Estate agent

Captures (rev 229-236): Relocate opens "Select a New Location" with "Rimmington (5,000)" rows;
Redecorate opens "Choose a style:" with "Basic wood - 5,000 coins", "Twisted theme - Twisted
blueprints" for blueprint styles, grey (`<col=5f5f5f>`) while a style can't be picked, Canifis
before Civitas, and Cancel. A pick has no confirmation: the coins go and the agent says "Your
house has been moved to Taverley." or "Your house has been redecorated.", "Your house is already
there!", or "Hmph. Come back when you have 5,000 coins.". Twisted theme first says "Absolutely,
let me borrow your blueprints ..."; leaving it shows "The Estate agent returns your blueprints."
(message box). The Wilderness theme is only listed once it can be used (the captures show it
rarely, so when it shows otherwise isn't known).

A new house's save lists its garden's exit portal by hotspot only; loading a house now places
such furniture, so the portal shows, and you arrive in front of it.

Pools of restoration to ornate rejuvenation (RejuvenationPool plugin) play `poh_pool_drink`
when drunk from, with no message or sound (captures).

Already there before this page: portal chamber and nexus teleports, altars and incense burners,
spellbook and occult altars, pools, costume room storage, servants, the Estate agent, guests and
adverts, house options, the house viewer, chairs.

Moving the house to Hosidius needs a visit to Great Kourend first, and Aldarin a visit to
Varlamore (Wiki). Nothing else in tsps records those visits (the cache's
`zeah_playerhasvisited` and `varlamore_visited` varbits are never set, and varbits aren't saved),
so `House` keeps `visitedKourend` / `visitedVarlamore` in the house save from
`onPlayerMapSquareChange`, which fires once per 64x64 map square crossed. It is a global hook
because both regions span hundreds of map squares, the case `docs/agents/areas.md` gives it for;
the estate agent also accepts either varbit if a quest ever sets it.

## Not done yet

- The League hall (a Leagues-only room; the cache has its rows, `rooms.json` leaves it out).
- Hosidius blueprints from the reward shop do nothing yet; Amy's saw works as a saw only.
- Fish trophy experience the Wiki doesn't list (haddock and orangefin on teak use the
  mahogany values), and the Alchemical Hydra head's.

## Testing

Developer commands:

- `::housemats <furniture or room>` gives what building it needs: its materials, a hammer and
  saw, and a tinderbox for burners; a room gives its cost in coins. A name matching several
  pieces (the head and fish "Teak display") lists them, and their keys work too
  (`::housemats HEAD_DISPLAY_TEAK`). An upgrade says what it needs built first.
- `::deletehouse` deletes your house, taking you and any guests out of it, so you can buy a new
  one from an Estate agent.
- `::maxhouse` replaces your house with one of every room (27; not the League hall), each space
  holding its highest-level piece (the garden keeps the exit portal). The ground floor grows from
  the garden with every room's doorways meeting a neighbour's, the halls' upper halves stand over
  them, the dungeon stairs under the skill hall and the oubliette under the throne room, and the
  dungeon grows from the stairs. The portals and nexus are directed, the cape hanger holds a max
  cape, the trophy displays show Vorkath's head and a swift marlin, and the prize chest holds
  100,000 coins. Levels, room counts and house size are ignored. `::restorehouse` brings back the
  house it replaced.

`::hotspots` (developer) lists the build hotspots of the room you stand in, with their tiles, so
furniture can be built with the agent MCP: `object_option` Build on the hotspot, then
`send_packet` `dialogue_continue` on 458:2 with the menu choice (1-based) once 458 is open. Rooms
are picked from a door hotspot the same way with 212:4 and the room id, then built with
`dialogue_choose` "Build" (or "Rotate clockwise" first).
