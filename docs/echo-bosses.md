# Leagues VI Echo bosses (normal-mechanics placeholders)

A Demonic Pacts League (Leagues VI) character carrying a region's Echo orb is asked at the
boss's entrance whether to fight its Echo. Yes starts a private encounter with that boss's
Echo. No orb is consumed. All nine encounters exist, with the Wiki's Echo stats and Echo
equipment rolls. **Their combat is a placeholder:** each Echo fights exactly like its normal
boss. Echo-specific attacks, shared health and special mechanics are not implemented. Captures
of Echo Hunllef and Echo Thermy exist (below) and are left for a follow-up; the recordings found
were not searched exhaustively, so others may exist too. Each boss's module and page says what it
keeps.

Source: [Echo bosses and echo equipment](https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Echo_bosses_and_echo_equipment)
and each linked boss page.

## How an Echo boss is built

An Echo boss **is the normal boss NPC**, spawned privately and dressed for that one instance by
`plugins/modes/echobosses/Actors.EchoBosses.js`. It keeps the normal id, Attack action,
animations, combat definition and controller, and changes only:

- **Appearance, name and level:** `NPC.setTypeCustomisation`, the NPC update's
  TYPE_CUSTOMISATION block (OSRS body customisation, name change and level change): the Echo
  stub's whole model list and recolours, the Echo name and the Wiki Echo combat level. The client
  resolves it as a synthetic type, so menus read the name and level. It holds through the normal
  boss's transformations, as live's does.
- **Combat values:** the Wiki Echo profile through the per-instance overrides other bosses use:
  `setMaxHitpoints` and `setCombatOverride` (stats, max hit, attack speed). A value the Wiki
  omits keeps the normal boss's. Status immunities and weaknesses stay the normal boss's.

This is what live does. RSProx recordings rsprox.net 1158 and 1161 (rev 237, Leagues VI, found
by searching the `league_echo_killcount_*` varbits) show two Echo bosses:

- **Echo Corrupted Hunllef** is added as the normal `crystal_hunllef_melee_hm` (9035), and in the
  same update gets `body_customisation` model 60373 (the `league_6_crystal_hunllef_melee` stub's),
  `name_change` "Corrupted Hunllef (Echo)", `level_change` 1,117 and a head icon. Its style
  changes are normal transformations (9035/9036). At death it takes `body_customisation` 60374
  (the `league_6_crystal_hunllef_death` stub's) and transforms to `crystal_hunllef_death_hm` (9038).
- **Echo Thermonuclear smoke devil** is added as the normal `smoke_devil_boss` (499) with
  `body_customisation` model 60399 (the `league_6_smoke_devil_boss` stub's), `name_change`
  "Thermonuclear Smoke Devil (Echo)", `level_change` 602, and an Echo spawn spotanim
  (`leagues_6_lore_dust_devil_spawn_spotanim`) and sequence (`lore_lust_devil_spawn`).
- A completion sends `tracking_echo_bosses_killed`, `league_echo_killcount_<region>` and
  `league_echo_pb_<region>`, and "Your <col=a53fff>Corrupted Hunllef (Echo)</col> kill count
  is:<col=ff3045>1</col>". Echo Hunllef also keeps the Gauntlet's own duration and personal-best
  messages, and adds Echo-only crystals (`crystal_hunllef_crystals_echo_crystals`, 14142).

The cache's `league_6_*` NPCs (15611-15623, 15635) are therefore appearance stubs: the normal
bosses with their models swapped (same size, scale and animations; no Attack action except Dusk
and Dawn, no levels or hitpoints). The other seven bosses follow the same pattern by inference:
the Wiki lists their Echo ids as `override<normal id>`; no recording of them has been examined
(see Not implemented).

Sent here as live does: the Echo models, name and combat level; Thermy's spawn spotanim and
sequence; and at completion the kill-count message, a new personal best ("You have set a new
personal best", timed from entry) and the `league_echo_pb_`/`killcount_` varbits. Not sent: Echo
Hunllef's death model, because this server's Hunllef (normal fights too) never takes its death
form (`crystal_hunllef_death_hm`).

| Boss | Echo appearance | Notes |
|---|---|---|
| Cerberus, Thermonuclear smoke devil, Corrupted Hunllef, Hespori, Kalphite Queen (both forms), the three Dagannoth Kings, Dawn, Dusk phases 1-3 | Echo models | The stub's whole model list and recolours (Rex and Prime drop their normal recolours) |
| King Black Dragon, Amoxliatl | Echo model | No NPC stub: the single model (60340, 60338) their `leagues_echo_bosses` row's struct gives the League Areas panel (param 1999; param 1322 is the normal model) |
| Dusk phase 4 | Normal | A size-6 form with its own rig; the only Echo Dusk is size 4 |

Every Echo is named `<normal name> (Echo)` with its Wiki Echo combat level. Thermy's name keeps
live's capitalisation, "Thermonuclear Smoke Devil (Echo)". That name shows in menus. The health bar
(interface 303) is titled by the client's own script from the npc id: its param 510 if it has one,
otherwise its cache name. So an Echo's bar reads "Corrupted Hunllef", "Dawn" and so on. The normal
Dagannoth Kings' param 510 is "Dagannoth Kings (Echo)", so their bar says "(Echo)" even in a normal
fight (see dagannoth-kings.md).

## Data

- **Echo profiles and equipment:** `server/data/definitions/npc-encounter-variants.json`,
  generated by [osrsreboxed-db](https://github.com/RSPSApp/osrsreboxed-db)
  `scripts/monsters/encounter_variants.py`. Never edited by hand (server rule 16).
- **Roles:** `Actors.EchoBosses` `ROLES` maps each adapter role to the normal form's gameval,
  the Echo stub's gameval and the profile. A missing gameval or profile logs "Echo bosses
  unavailable" at startup.

## Encounter flow

1. The boss's entrance emits `echo-boss:entry`; LeagueMode's `EchoOrbs` asks Yes/No.
2. Yes emits `echo-boss:start`. The owning boss module (`Echo.<Boss>.js`, or its own file for
   KBD, Amoxliatl and Hespori) claims a session (`echo-boss:claim`) and builds a private area.
3. It spawns the normal boss and emits `echo-boss:configure { player, boss, role, npc, token }`.
   `Sessions.EchoBosses` checks the token, dresses the NPC and marks it (`echo-boss:encounter`).
   A form change re-emits `configure` with the new role; the damage dealt is kept.
4. When the encounter ends (the airborne Queen, the last King, Dusk), the module emits
   `echo-boss:completed`. Sessions commits it once and calls `Loot.EchoBosses`; Progress
   credits the completion.

The marker keeps an Echo kill out of the normal boss's kill count, Combat Achievements, League
kill tasks, collection-log kill count and normal Echo-orb rolls. Its loot is still logged.

## Loot

- **Normal loot** comes from the normal path, as for every kill of that boss: NpcDrops at the
  boss's death (each Dagannoth King its own), the Guardians' table, the Gauntlet's reward chest,
  and Hespori's harvest (saved apart from the crop).
- **Echo equipment** (`Loot.EchoBosses`) rolls once per completed encounter, at the Wiki rate.
  A player who has not received an item gets it on the kill at twice its listed rate (1/30: the
  60th). The world's `NpcDrops:bossRareMultiplier` applies once; league drop boosts do not. The
  guarantee stays at the listed count.
- Saved per player (`echo-boss:loot`): completions per boss and items received. Trading or
  losing an item never restarts its guarantee.

## Not implemented

Echo special attacks and phases, the Kings' shared mechanics and rotating prayers, Echo poison
floors, and anything else the Wiki describes that the normal fights lack. Whether an Echo kill
counts toward a Slayer task is unverified; the normal boss's rule applies.

Captures of Echo mechanics, for that follow-up:

| Recording | Fights | Echo-only mechanics recorded |
|---|---|---|
| rsprox.net 1158 (rev 237) | 110 Echo Corrupted Hunllef kills | Echo crystals (`crystal_hunllef_crystals_echo_crystals`, 14142) and their hits (`leagues_6_crystal_hunleff_crystals_hit`); Echo ranged and magic projectiles (`leagues_6_crystal_hunleff_range_travel`, `_magic_travel`); an anti-prayer attack (`leagues_6_hunleff_antiprayer_travel`) |
| rsprox.net 1161 (rev 237) | 31 Echo Thermonuclear smoke devil kills | Smoke pools (`leagues_6_vfx_smoke_devil_pool_spawn`, `_idle_01`, `_despawn`, `_shield`); Echo ranged, magic and special projectiles (`leagues_6_vfx_lore_dust_devil_attack_*_projanim`) |
| rsprox.net 89 (rev 227) | 43 Leagues V Echo Dagannoth Kings encounters | A different league's Echo Kings; whether Leagues VI's match is unknown |

A search of rsprox.net/database for the `league_echo_killcount_*` varbits also matched three
more Leagues VI recordings (19-20 April 2026, rev 237) that have not been examined; they may hold
other Echo bosses.

## Tests

`server/tests/echo-bosses.test.cjs` (dressing on the real cache and profiles, sessions, loot),
`echo-boss-controllers.test.cjs` (Cerberus, Queen, Kings), and the Echo cases in the KBD,
Thermonuclear, Guardians, Gauntlet and Hespori suites.
