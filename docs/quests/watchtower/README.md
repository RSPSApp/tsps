---
quest: Watchtower
key: watchtower
status: untested
tested:
tester:
model:
commit:
cache:
start:
travel:
---

# Watchtower

No native playthrough recorded; natural completion pending.

## Findings

- **In progress (#4412):** mapless skavid entrances follow a fixed circuit between
  surface caves. Four successive entries from the cave south of Grew reach the
  eastern side near Toban; repeatedly clicking one cave is not an attempt counter.
  Mapless transport needs no light. With a map, the existing light requirement
  and skavid-interior destinations remain separate.
- Toban's `tobanladderdown` (2812, Climb-down) returns to the outer tunnel at
  2500,2988. The actionable `yanilleholein` (2823, Climb-down) returns to
  2585,3108; `yanilleholeout` (2824) has no operation. The enclave exit
  `enclavecave` (2813, Enter) returns to 2540,3054.
- Relic assembly starts after the third part's dialogue, before the completed
  statue is awarded. Consumed parts remain represented by the saved hand-in
  bits; closing the dialogue or interrupting the scene permits another Talk-to
  without consuming replacement parts. A completed scene grants one statue and
  stage 3. The first enclave entry through the nightshade dialogue shows a
  private shaman attacking a private dragon. It changes no world dragon,
  shaman-kill counter, potion or crystal progress.

### Sources and limits for #4412

The [Watchtower guide](https://oldschool.runescape.wiki/w/Watchtower) describes all
four reported routes/actions. [Skavid caves](https://oldschool.runescape.wiki/w/Skavid_caves)
explicitly describes the fixed route and its lack of a light requirement.
Surface destination coordinates are reconciled against the named branches in
[quest_itwatchtower.rs2](https://github.com/LostCityRS/Content/blob/65b754f768b79b941b21b2a1eb3b0d1ecae3cdfe/scripts/quests/quest_itwatchtower/scripts/quest_itwatchtower.rs2)
and the active-map fixtures. This older reference is supplementary evidence, not
a claim of present OSRS timing. Its hole XP award is not added without a current
oracle; this patch preserves the server's existing XP behavior.

The matching revision-242 [loc](https://github.com/Joshua-F/osrs-dumps/blob/853150e3f75e1463391b470f98caf5d3bf796339/config/dump.loc),
[NPC](https://github.com/Joshua-F/osrs-dumps/blob/853150e3f75e1463391b470f98caf5d3bf796339/config/dump.npc),
[sequence](https://github.com/Joshua-F/osrs-dumps/blob/853150e3f75e1463391b470f98caf5d3bf796339/config/dump.seq)
and [spotanim](https://github.com/Joshua-F/osrs-dumps/blob/853150e3f75e1463391b470f98caf5d3bf796339/config/dump.spot)
dumps identify the objects, dedicated cutscene actors (4384/4385), relic animation
5352/effect 969 and shaman casting animation 5357/impact 971.

The guide's [relic GIF](https://oldschool.runescape.wiki/w/File:Watchtower_-_Combining_relic_parts.gif)
shows the wizard raising his hands and combining the parts with a white effect;
its [shaman GIF](https://oldschool.runescape.wiki/w/File:Watchtower_-_Shaman_kills_dragon.gif)
shows "Take dis!", a spell, a 75 hitsplat, laughter and the dragon's death.
Both were inspected. Scene camera tiles, actor placement within copied quest
rooms, fades and server-tick scheduling are approximations. The private dragon's
death is visual, without world combat drops/XP. Exact retail framing, elapsed
timing and audio parity are unverified. Selected historical RSProx candidates
showed unrelated diary/bookcase/dialogue content; they establish no Watchtower
scene behavior or absence.

The `quest-scene-return-state.test.cjs` Watchtower cases use production plugins,
real players/sessions, cache objects, ordinary object/item/NPC/dialogue packets
and task/movement ticks. Quest stages, inventories and NPC positions are seeded
checkpoints. Forced walkout/death and a modeled in-copy login checkpoint test
recovery; they do not establish natural quest traversal, a rendered client,
audio, disk-save round trips or a running-server restart. Runtime results are
pending; source and syntax checks alone are not gameplay proof.

- **fixed** The battlement guards (OGRE_GUARD_6) and the southern guards (OGRE_GUARD_7) had swapped roles; the rock cake is handed over and the battlement (2507, 3011-3012) is climbed both ways. The broken bridge takes its 20-coin toll only at the gap's south take-off (2530, 3026), jumps north to 2530, 3029, and returns south for free; the east-gate guards, which share the bridge guard's id, no longer offer the toll. Feeding cave nightshade to an enclave guard lets the player run past once. Exact jump and climb timing is not capture-verified. [Quick guide](https://oldschool.runescape.wiki/w/Watchtower/Quick_guide). Fixed in #3796.

## Runs

No run yet.
