# Where behaviour comes from

## Source-of-truth order

When behaviour is unclear, resolve in this order:

1. **OSRS Wiki** - gameplay intent, drop tables, requirements, mechanics:
   <https://oldschool.runescape.wiki/> (see also
   [Category:Game mechanics](https://oldschool.runescape.wiki/w/Category:Game_mechanics))
2. **osrs-docs** - engine-level mechanics the Wiki omits: collision, pathing, update masks,
   client/server internals: <https://osrs-docs.com/>
3. **osrsindex** - ids, definitions, cross-referenced cache data: <https://osrsindex.com/>
4. **OpenRune** - cache formats, tooling, definition layouts: <https://openrune.dev/>
5. **RuneLite** - client-side truth. Packet/opcode shapes, `gameval` id constants
   (`InterfaceID`, `VarbitID`, `VarPlayerID`, `ItemID`), and how the real client reacts to
   what the server sends.
6. **This server's own cache** - the final authority on ids and interface layout, read with
   the dump scripts in [cache.md](cache.md).

If a source conflicts with the cache in `server/caches`, the cache wins - it is what the
client actually loads. If sources conflict on behaviour, prefer the Wiki.

Do not cite another private server as justification. If a behaviour can only be found in
RSPS code, say so explicitly in the PR so it can be checked.

## Packet captures

Captures from live OSRS (for example with rsprox) are first-hand evidence for what the
server sends: packet order, varps/varbits, interface events, exact messages. Record the facts a
feature relies on in its docs page, not the raw logs (they carry account details), and check
every captured id against the cache - live may be a newer revision than `server/caches`.

## Reference codebases

External codebases, ranked by usefulness as reference material. Scores are overall quality,
with content and code noted separately where they diverge. These are references for
architecture, tooling and content - the order above still governs behaviour, except where a
source is called out as a behavior oracle.

- **Void** 9/10 — cleanest RSPS codebase; Kotlin, docs, CI, script system. 2011 rev634. BSD-3.
  <https://github.com/GregHib/void>
- **LostCity** 8/10 — TS engine + script-driven 2004 content; ideal architecture ref, not
  OSRS. MIT. <https://github.com/LostCityRS/Engine-TS> + `/Content`
- **OpenRune** 8/10 — RSMod fork, OSRS rev240, plugin loading, honest progress (20/23
  skills, 18/169 bosses). ISC. <https://github.com/OpenRune/OpenRune-Server>
- **Project Gielinor** 7/10 — RSMod fork rev239; cleaner docs, overlaps OpenRune. ISC.
  <https://github.com/Slashx124/Project-Gielinor>
- **Offline_Scape** 6/10 (content 8, code 6) — Near rev240, being de-customised toward
  vanilla OSRS; pristine OpenRS2 cache, auto-discovered early Sailing (boats/docks/cargo).
  Active, 1 dev. No license (NR lineage). Behavior oracle.
  <https://github.com/MouldyToast/Offline_Scape>
- **Near-Reality** 6/10 (content 9, code 3) — huge skills/bosses/skilling content; 2-commit
  leaked dump, no license, messy. Behavior oracle only.
  <https://github.com/kurdowns/RSPS-NEAR-REALITY>
