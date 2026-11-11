# Freezes

What happens around a freeze once it lands: Ice spells (Rush, Burst, Blitz, Barrage), the
Bind-type curses (Bind, Snare, Entangle; see [standard-binding-spells.md](standard-binding-spells.md)),
the Binding Tentacle and the Zamorak godsword. `CombatFactory.freezeTicks` applies the freeze
and its five-tick immunity as before, takes who froze the target and the kind of freeze
(`"ice"`, `"bind"`), and emits `combat:frozen` `{ target, source, ticks, kind }`.
`server/plugins/combat/Freezes.plugin.js` owns what follows.

## Freeze resistance

From the [Freeze](https://oldschool.runescape.wiki/w/Freeze) page (revision 15388216): "Some monsters,
mostly bosses, possess freeze resistance, which reduces the duration in which they are frozen. If the
monster possesses 100% resistance, then they will not be frozen at all even if the spell successfully
hits them." The value is the Wiki infobox's `freezeresistance`, exported per NPC id as
`freeze_resistance` (a whole percentage, 0 when the page has none) in
`data/definitions/npc-status-immunities.json` by osrsreboxed-db's `scripts.monsters.status_immunities`
and read by `NpcDefinitionLoader.applyStatusImmunities` (`NpcDefinition.getFreezeResistance()`).

- `CombatFactory.freezeTicks` refuses a 100% NPC outright (no timer, no `combat:frozen`), and shortens
  any other freeze to `ticks * (100 - resistance) / 100`, at least one tick.
- The existing rule that NPCs larger than 2x2 shrug freezes off stays for NPCs with no resistance
  data; a partial resistance (1-99%) says the Wiki treats the NPC as freezable, so it is frozen for the
  shortened time (Scurrius, Dreadnoth the Jellied, the Scarred greater demon). The Wiki gives no size rule;
  an explicit 0% is indistinguishable from a page without the field, so large 0% NPCs (K'ril, Dusk,
  Dawn) are unchanged.
- A `combat:freeze-duration` listener that already applies the NPC's resistance exactly sets
  `event.resisted = true` and the generic rule leaves it alone: the Phantom Muspah's page states "33% freeze
  resistance, meaning it will only stay frozen for 66% of the base freeze duration", which its hook keeps.
- **Data pin.** `npc-status-immunities.json` is the unedited output of RSPSApp/osrsreboxed-db#71, merged as commit
  `c6fedd9203ef92cee30a7a051f4a98dd040baafa` (PR head `da6799dc29bc529466ec894c31deb1e88447fa6c`; the merge adds only
  dialogue files, so `docs/npc-status-immunities.json` is the same blob `061bdae2b6f2` at both), regenerated twice byte-identically from unchanged inputs: sha256
  `a648aad7da1a64715ee0cbaedf14cc74b1e3f45c4cafd3ed4cffb395f1e66553` (3,947 records). The previous file
  (`146a93b0...06e1`, producer master and `29cfa63287`) predates the producer's revision-242 inputs, so the same
  import also brings that unregenerated drift, independent of this change: 60 NPCs added (revision-242 ids such as
  Bork 16640, Dreadnoth the Jellied 16665, Archive Guardian 16659, the Pete Kayer set), 2 removed (3284 Hengel,
  3285 Anja) and Venator 16213-16217 no longer poison/venom immune. Removing `freeze_resistance` from the new
  file gives exactly an unmodified regeneration at the same inputs. Merge after the producer PR.
- Not covered: whether each Wiki value matches live OSRS (no capture); the Wiki's PvP freeze rules are above.

## PvP range

From the [Freeze](https://oldschool.runescape.wiki/w/Freeze) page: a freeze one player puts on
another "will only restrict movement whilst both players remain within the 10-tile maximum player
weapon range. Moving outside of this range will cause the frozen target to become free to move",
and only X and Y are compared, so a player who climbs a ladder keeps the freeze while above
their target.

- The plugin watches each player-on-player freeze with a task for as long as the freeze lasts.
  When the two are more than 10 tiles apart on X or Y (plane ignored), it ends the freeze.
- The freeze immunity keeps running from the original freeze, so an early release does not
  open a refreeze window. The page doesn't say what happens to the immunity.
- If the caster logs out, the freeze runs its course. The page doesn't cover it either.
- Ice spells, binds, the Binding Tentacle and the Zamorak godsword pass their caster. Boss and
  NPC freezes don't, and are left alone.

## Messages

rsprox captures of Ice Barrage freezes in PvP: recordings 451, 604, 612, 623, 624, 629, 2236
and 2238 (revisions 228 and 233).

- Ice spells: `<col=ef1020>You have been frozen!</col>` as a spam (filterable) game message,
  sent in the same tick as the impact graphic and the projectile.
- `<col=ef1020>The freeze cast upon you is beginning to thaw.</col>` follows 29 ticks after it
  (604, 623 twice, 624, 2238 twice) or 30 ticks (451 twice, 612, 629, 2236 twice). The plugin
  sends it when the freeze has three ticks left as tasks see it, which gives 29 when the target
  takes its turn after the caster and 30 when before.
- Bind-type spells send nothing when they land and
  `<col=ef1020>The holding effect is beginning to fade.</col>` before they end (the Freeze and
  [Bind](https://oldschool.runescape.wiki/w/Bind) pages; the text in Leagues recordings 1102 and
  1858). It uses the same three-tick point; no non-Leagues capture times it.
- Casting a curse bind on a target that is still immune: "Your target is currently immune to that
  spell." (Leagues recordings 95 and 2174).

## Acting while frozen

A freeze "restricts movement ... without disabling other actions", and forced movement through
"adjacent game objects such as ladders or cave entrances" still works (Freeze page).

- A frozen player's walk click gets no reply: recordings 623 and 451 show move clicks during
  the freeze with no message (we used to say "A magical spell has made you unable to move.",
  which appears in no recording).
- Objects and NPCs the player already reaches from their tile still work: a frozen player climbs
  the ladder or talks to the NPC next to them. Before, these clicks were refused while frozen.
- Anything further away answers "I can't reach that!" and is dropped, not queued for after the
  freeze. Recording 2238 shows it for a loc 14 tiles away (`clanwars_ffaexit`, clicked over and
  over until the freeze ended) and for an Attack on a player four tiles away. NPC clicks use the
  same reply; no capture shows one.

## Not changed

- In recording 2238 the frozen player's first step comes 33 ticks after "You have been frozen!",
  and they are still held at 32. Our 32-tick freeze frees them one tick sooner in the same turn
  order, because a timer set during a tick counts that tick down for anyone who takes their turn
  after the setter. That is how every `TimerKey` timer counts, so it needs its own change and
  more than one recording.
