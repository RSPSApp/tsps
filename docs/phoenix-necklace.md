# Phoenix necklace

Plugin: `server/plugins/items/PhoenixNecklace.plugin.js`. Source: the OSRS Wiki page
<https://oldschool.runescape.wiki/w/Phoenix_necklace> (no rsprox recording of the necklace
activating is indexed, so no recording ID backs any detail below).

## Behaviour

- Damage that leaves the wearer alive at 20% of their maximum Hitpoints or less heals 30% of
  their base Hitpoints level, rounded down (29 at level 99), and destroys the necklace.
- Attacks still on their way in are cleared (delayed spells and arrows, the remaining hits of a
  multi-hit special). The wearer's own pending damage (poison, recoil) stays.
- It fires before a ring of life or a Defence cape (`phoenix-necklace:will-trigger`, asked by
  `RingOfLife.plugin.js`) and before Redemption, which then does not activate.
- No effect in the Bounty Hunter arena (`phoenix-necklace:eligible`, answered by
  `Area.BountyHunter.js`) or where food is refused: a duel with No Food, the Tombs of Amascut
  On a Diet invocation (`onCanEat`).
- The core only emits `combat:damage-applied` from `Mobile.decrementHealth` after HP is taken.

## Not verified

The Wiki does not quote the activation message; "Your phoenix necklace heals you, but is
destroyed in the process." is our wording. Self-inflicted damage such as a dwarven rock cake is
covered by the same event, but the Guzzle option is not implemented in this server.
