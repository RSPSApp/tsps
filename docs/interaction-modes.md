# Interaction modes

OSRS tells the client what clicks on a world's tiles and entities do with two server packets,
`set_interaction_mode` and `reset_interaction_mode`. tsps sends them as `SET_INTERACTION_MODE`
(145) and `RESET_INTERACTION_MODE` (146) in its own protocol.

| Field | Values |
| --- | --- |
| world | a world entity index (a boat), `-1` the root world, `-2` the default every world without its own mode follows |
| tile mode | `0` disabled, `1` walk, `2` heading (clicks steer the boat at whose helm the player is) |
| entity mode | `0` disabled, `1` all, `2` examine only, `3` default (revisions 229-232 only) |

`reset_interaction_mode` drops a world's own mode, so it follows the default again. The
client keeps the modes until it is told otherwise, including across a logout, which is why
live sets walk again before each logout.

Constants: `server/.../net/protocol/InteractionMode.ts` and `client/game/InteractionModes.ts`.

## What live sends

From rsprox captures (rev 235-239, normal worlds).

### Taking a sailing boat's helm

Op1 (Navigate) on `sailing_boat_steering_*`: 812 attempts in 210 recordings (rev 235), on the
tick the helm is taken, right after `varbit sailing_boat_facility_lockedin 0->3`:

```
set_interaction_mode  type=default, tileinteractionmode=heading, entityinteractionmode=all
set_interaction_mode  worldentity=<the boat>, tileinteractionmode=walk, entityinteractionmode=all
```

So a click on the sea steers, and a click on the boat's own tiles stays a walk click.
Recordings 901, 3461, 3650, 3721, 3730, 3754 show it attempt by attempt.

Walk clicks on the deck while at the helm (59 `move_gameclick` on deck tiles between the two
packets above) never moved the helmsman, never left the helm and sent nothing back.

### Leaving the helm

Whatever ends it (op1 on the helm again, another loc such as a salvaging hook or the drink
crate, an NPC, an inventory item, docking, the logout button), on the same tick and before the
helm's varbits change:

```
reset_interaction_mode  worldentity=<the boat>
set_interaction_mode    type=default, tileinteractionmode=walk, entityinteractionmode=all
set_interaction_mode    type=default, tileinteractionmode=walk, entityinteractionmode=all
```

tsps sends the `set` once: the second one is the same packet again.

### Logout and world switch

Every accepted logout button press, immediately before `logout_withreason`, on the click's
tick: rev 239 35/35 recordings, rev 238 67/68, rev 237 100/100. Kicks (`reason=kicked`) too.

```
set_interaction_mode  type=default, tileinteractionmode=walk, entityinteractionmode=all
logout_withreason     reason=requested
```

Revisions 229-232 sent `entityinteractionmode=default` instead, and revisions 226-236
sometimes also `reset_interaction_mode worldentity="root"`. World switcher logouts and world
hops send the same `set`. Logging out from the helm sends the helm's reset first (rev 238).

## In tsps

- **Helm** (`plugins/skills/sailing/Helm.Sailing.js`): taking it sends the two sets, leaving it
  the reset and the walk set. Leaving the boat while at the helm without leaving the helm
  first (Escape, a teleport that sinks it) sends the reset from the `sailing:left` event, which
  now carries `atHelm`.
- **Logout** (`PlayerSession.logout`): the walk set goes before the logout response. A logout
  from the helm doesn't send the boat's reset: the client is about to drop the boat anyway.
  Kicks (`Player.requestLogout`) send no logout packet in tsps, so they send no set either.
- **Client**: `InteractionModes` keeps the default and each world's mode. A walk click
  (`HelmSteering.handleTileClick`) uses the mode of the world it landed in: a deck-scene tile
  inside the boat's template zones is the boat's world, anything else (including the drawn sea
  around the deck) is the root world. Heading sends `SET_HEADING`, walk walks, disabled does
  nothing. This replaces the client's own check of `sailing_sidepanel_player_at_helm`. A full
  reset to the login screen clears the modes, for connections that drop without a logout.
- **Server walk clicks at the helm** (`BoatManager.steerToward`): a sea tile still steers (for
  agents and clients that walk rather than send `SET_HEADING`); a deck tile does nothing, as
  live.
- The agent MCP reports the packets under `client.interactionModes`.

## The heading indicator

The client draws two arrows around the boat while clicks steer; the server sends nothing for
them. The models are the cache's graphics defaults `headingindicator` pair: 57378 (white) and
57379 (yellow), the same flat chevron in two colours with a black outline. No capture can show
them, so this follows the Wiki ("a white arrow will appear around the player's boat in the
direction of their cursor") and the user's own play:

- **White** follows the mouse while the tile mode under it is heading (the sea, not the
  boat), pointing at the heading a click there would set (one of the 16).
- **Yellow** appears at the heading a click set, for `HEADING_FLASH_MS` (1.2 s, "a few
  ticks"), and fades. The white arrow keeps following the mouse meanwhile.

`client/game/sailing/HeadingIndicator.ts` builds both as world triangles; the tile-marker
overlays of both renderers draw them, depth-tested, just above the water. The distance from
the boat's centre (half its larger footprint side) is a guess.

## Not done

- Entity modes are stored but not applied to menus: nothing in tsps sends disabled or examine
  only yet, and no capture shows content that does.
- The "Walk here" menu text at the helm is unchanged.
