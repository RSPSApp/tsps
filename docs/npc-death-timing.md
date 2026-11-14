# NPC death timing

How long a dead NPC stays in the world before its drops land and it is removed
(issue [#5507](https://github.com/RSPSApp/tsps/issues/5507)).

## Live (rsprox captures)

- **The sequence:** the killing hitsplat on tick T, the death animation on T+1 (with the NPC's
  menu options cleared and its facing reset), then the drops and the NPC's removal together on
  T+1+n. Nothing else is sent in between: no fade (the transcripts carry `[transparency]` when
  live sends one, as in The Fractured Archive, and no NPC death has one).
- **n is per NPC, not per animation length.** Cow 4 (399 deaths; rec 1001932 ticks 1628-1633),
  man 2 (368), moss giant 6 (407), giant 4, wolf 5, lesser demon 5, Dagannoth Kings 2 (633;
  rec 89 ticks 5348-5350). The animation's own length doesn't predict it: the cow's death
  is 292 client cycles and waits 4 ticks, a bear's is 188 and waits 5, a giant's 1145 and waits 4.
- **NPCs sharing a death animation mostly share n** (249 of 272 animations agree across every
  NPC captured with them), but not always: War Guild cyclopes 2 and other giants 4 on
  `giant_update_basic_death`, blue dragons 6 and bronze/iron 5 on `dragon_death`.

## Ours

`NPCDeathTask` plays the death animation the tick after the killing blow and removes the NPC,
with its drops, `deathTicks` ticks later, so `deathTicks` is n. `NpcDefinitionLoader` takes it from:

1. `deathTicks` in `npc-combat-defs.json` (hand-set, mostly bosses);
2. the NPC's row in `npc-captured-death-ticks.json`: its death animation, its most common n,
   and the deaths timed. A row needs 3 deaths and its n in 80% of them (a capture where the
   player left the area early counts short);
3. the n every captured NPC with the same death animation shares, when at least 2 were
   captured and they all agree;
4. 2.

The startup line `[npc-definitions] ... death ticks captured=..., by death animation=...`
counts the NPCs step 2 sets and those step 3 sets to something other than 2 (326 at this
writing).

`npc-captured-death-ticks.json` is built by `rsprox_index.py npc-deaths` in
[osrs-captures](https://github.com/Bandit-HaxUnit/osrs-captures) (`rsprox_npc_deaths.py`, d346092) from the rsprox.net index and local captures, after `link-cache` reads
the current cache's ids. Two runs over the same transcripts write the same file. Regenerate it
to pick up new captures; hand-set values in `npc-combat-defs.json` keep winning.

Of the 37 hand-set `deathTicks` with captures, 36 match (33 before the kings' fix). The Dagannoth Kings' 5 had no capture
behind it and is now 2. Void Flare keeps its 2 (15 captured deaths say 3,
too few to change a boss plugin's value without its own check).

Not covered: a death that transforms the NPC first. The row is filed under the id that started
dying, while `NPCDeathTask` reads the transformed one: the Alchemical Hydra's captured 7 is on
8621, and our death runs as 8622 (no row, 2). Live (rec 1000143, rev 227): animation 8257 on
tick 494, `hydraboss_finaldeath` with 8258 on 497, loot on 504.
