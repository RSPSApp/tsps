# Dwarf multicannon

`server/plugins/items/DwarfCannon.plugin.js`, with its parts in `server/plugins/items/dwarfcannon/`:

| Unit | Contents |
|---|---|
| `Setup` | setting the cannon up |
| `Ammo` | Fire, Empty, Load X |
| `Firing` | turning and shooting |
| `Decay` | breaking, Repair, loss, Pick-up, logout and login |
| `Nulodion` | getting a lost cannon back |
| `Ornament` | the shattered cannon ornament kit |
| `Restrictions` + `data/definitions/cannon-restrictions.json` | where a cannon can't be set up |
| `Data`, `Common` | shared numbers and state |

**Sources:**
- **an OSRS capture** (rsprox) of a cannon's whole life at the Woodcutting Guild's ents: setup, auto-load, Fire, two shots, Empty, Load X, Pick-up;
- **the OSRS Wiki:** "Dwarf multicannon" (its prohibited-areas list too), "Shattered cannon ornament kit", and Nulodion's transcript;
- **this cache:** ids;
- **Near-Reality's code** for what neither shows: the firing zones and most area outlines. It's flagged below wherever it's used.

## Setting up (captured)
"Set-up" on the base marks the player busy (varbit 12393).
- **The base:** two ticks after the click: "You place the cannon base on the ground.". The base (loc 7) appears with the player on its centre tile, and they run off to the tile south of its south-west corner.
- **The other parts:** the stand 2 ticks later, then the barrels and the furnace 3 ticks apart: "You add the stand.", "You add the barrels.", "You add the furnace.". The furnace turns it into the cannon (loc 6).
- **Each part:** animation 827, area sound 2876, the part leaves the inventory, and the player faces the cannon.
- **Auto-load:** the tick after the furnace, it loads up to 30 balls: "You load the cannon with 30 cannonballs.".

**Vars:**

| Var | Meaning |
|---|---|
| varp 2 | parts added (1–4) |
| varp 3 | balls loaded |
| varp 4, varp 3551 | the cannon's packed south-west tile `(z << 28) \| (x << 14) \| y` |
| varbit 2180 | the tick of the last part |
| varbit 1968 | the world. **Ours:** always 1, since this server has no world number. |

Only changed vars are sent, as in the capture; all of them are sent again on login.

**Refused (our wording, not captured):**
- a second cannon: "You cannot construct more than one cannon at a time.";
- missing or mixed parts: "You need the base, stand, barrels and furnace to set up a cannon.";
- no clear 3×3: "There isn't enough space to set up a cannon here.";
- a restricted area: that area's Wiki message.

**Ours:** the setup stops (keeping what's built) if the player walks more than 5 tiles away, logs out, or no longer has the next part.

**No quest requirement:** the Wiki requires the Dwarf Cannon quest. This server leaves it out by choice.

## Firing (captured)
- **Starting:** "Fire" tops the cannon up from the inventory. The next tick varp 1 (`mcannonmulti`) is set to `1 << 20`, and from the tick after, the barrel turns one step a tick, N → NE → … → NW.
- **Each turn:** area sound 2877 and `mcannon_<dir>_turn` (514 N … 521 NW).
- **A shot:** on a tick when something is in the direction it faces, it plays `mcannon_<dir>_fire` (506 N … 513 NW) and sound 1667, then turns in the same tick.
- **The ball:** projectile 53 from the cannon's centre, heights 145 → 140 (36 → 35 here), angle 2, progress 11. The capture's two shots took 35 cycles (north) and 40 (south-west). **Ours:** 35 for straight directions and 40 for diagonals.
- **The hit** lands the next tick, as the owner's (kill credit, retaliation).

**From the Wiki:**
- **Damage:** up to 30, or 35 with granite.
- **Accuracy:** the owner's Ranged roll with a ranged weapon, otherwise melee, against the target's Ranged defence.
- **XP:** 2 Ranged XP per damage, no Hitpoints XP. Core's `PendingHitConfig.experience: false` skips the usual combat XP for these hits.
- **Targets:**
  - in singles, only what fights the owner or nothing at all, and only while the owner isn't fighting something else; in multi, anything attackable;
  - never sand crabs, ammonite crabs, demonic gorillas or kurasks;
  - in line of sight from the cannon's footprint.
  - **Ours:** a target fighting the owner first, otherwise the nearest.
- **Granite:** granite balls load first, and steel only once the granite is used up. Granite fires first (projectile 1443).

**Ours or unverified:**
- **Firing zones:** each direction's polygon is Near-Reality's (the Wiki gives no shape). Both captured shots fall inside the right zone. They overlap, so one monster can take two balls a rotation (Wiki), and they leave a few tiles uncovered.
- **Running dry:** "Your cannon is out of ammo!" and the cannon stops.
- **Fire with nothing to load:** "You need to load the cannon with cannonballs first.".
- **Logging out:** the cannon stops firing.

## Cannonballs (captured)
- **Empty:** "You unload your cannon and receive Steel cannonball x 28." (granite: "Granite cannonball"). Varp 3 goes to 0, and firing stops the next tick. **Ours:** the no-space message.
- **Load X:** the first time, a count prompt "Set load-x cannonballs (1 - 30):", then varbit 17870 and "You will now load 10 cannonballs when using Load-x.". After that it loads that many: "You load the cannon with 10 cannonballs.". Saved per player.

## Pick-up (captured)
"You pick up the cannon. It's really heavy.", synth sound 2581.
- **Vars:** they clear, except that varp 4 keeps the player's tile, as captured.
- **Items:** the parts added so far and every ball come back in the same tick.

Also works on a broken cannon or a part-built one. **Ours:** the no-space message.

## Decay (Wiki)
- **Breaking:** after 25 minutes set up it breaks: the broken multicannon (14916; ornament 43028), with "Repair" and "Pick-up". Repair starts the 25 minutes again.
- **Loss:** 10 more minutes unrepaired and it's gone. Its parts wait at Nulodion; balls in it are lost.
- **Logout:** the cannon stays up while the owner is logged out. If the server restarts, a cannon saved on a player but missing from the world counts as lost.
- **Messages (ours, unverified):** "Your cannon has broken!", "You repair your cannon, restoring it to working order.", "Your cannon has decayed. Speak to Nulodion to obtain a new one.".
- **Testing:** `::cannondecay` (developer) breaks your cannon, and on a broken one makes it disappear, each on the next tick.

## Nulodion (Wiki transcript)
"I've lost my cannon." follows his transcript, with its conditions answered from the cannon's state:
- still set up somewhere;
- fewer than 4 free slots;
- lost by despawning or world-hopping (a restart here);
- not lost.

"The dwarf gives you a new cannon." hands back the lost cannon's parts, ornament if it was one.

## Ornament kit (Wiki)
- **Applying:** one shattered cannon ornament kit used on each part makes its (or) version.
- **Dismantle:** gives the part and the kit back.
- **No mixing:** ornament and plain parts can't be set up together.
- **Objects:** the ornament cannon uses 43029 base, 43030 stand, 43031 barrels, 43027 cannon and 43028 broken.
- **Animations (not captured):** the cache's matching runs of eight, fire 9230–9237 and turn 9239–9246, taken in the same N-first order as the plain ones.

## Restricted areas
`cannon-restrictions.json` lists all 71 of the Wiki's prohibited areas with their messages. Anywhere in an instance (a private area) is refused with the default "You can't set up a cannon here.".

**Outlines:** 28 have one. The others are listed but not bounded yet.
- **From Near-Reality's code**, unverified: most of them, e.g. the Grand Exchange, the Dwarven Mine and the Slayer Tower.
- **From this server's own bounds:**
  - the Revenant Caves, from `world.json`;
  - Pest Control's game area;
  - Zulrah's shrine;
  - the Gemstone Crab's three spots.

## Follow-ups
- outlines for the 43 unbounded areas;
- Nulodion's cannon sale (his transcript's 750,000-coin set and the parts shop);
- the Combat Achievements capacity increases (35/45/60), once that system exists;
- the real messages for the parts marked "ours".
