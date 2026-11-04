# Recipe for Disaster: opening feast

The Cook accepts the four ingredients and awards the opening quest point before the
player enters the dining room. First entry then plays the complete imported
`chef-surprise-the-lumbridge-secret-council` transcript: introductions, Awowogei's
interruption, the Mysterious Old Man taking the Duke away, Evil Bob taking Osman
(or Selim), the player's entrance, the Culinaromancer's attacks, and Aris's
`TEMPUS CESSIT` spell and frozen-room handoff.

Sources:

- [OSRS Wiki opening guide](https://oldschool.runescape.wiki/w/Recipe_for_Disaster/Another_Cook%27s_Quest)
  and [canonical transcript](https://oldschool.runescape.wiki/w/Transcript:Recipe_for_Disaster/Another_Cook%27s_Quest).
- [Pinned Quest Helper RFDStart](https://github.com/Zoinkwiz/quest-helper/blob/06da90f982518a093f2fe1c9cfac5547fa7053d3/src/main/java/com/questhelper/helpers/quests/recipefordisaster/RFDStart.java)
  maps native1850=2 to entering the dining room and records2→3 after it.
- Active `osrs-241_2026-10-20` cache: region29:83 upper banquet layout and the
  existing NPC seat exports; loc12308 hides the chest before1850=3, and12354
  shows the finale portal only at1850=4. All rescues reach4; completion is5.

`recipe-for-disaster:feast-pending` is set when a new ingredient handover succeeds.
The previous implementation never played or marked the feast. Unmarked internal-stage4
saves with no rescue or finale progress recover that pending entry on login, Cook
retalk or dining-door use. Login recovery precedes frozen-room routing and council
spawning. Accounts with any recorded rescue, subquest stage, legacy briefing/recipe
state or finale progress keep that progress and their existing rescue access. The
classifier reads existing state without initializing recipes or rewriting progress.
The native projection is2 while pending,3 in the frozen room,4
when all rescue flags are set, and5 after completion. Ingredients, opening point,
rescue rewards and finale rewards retain their existing earning boundaries.

While the feast is pending, Cook retalk uses the canonical pre-entry invitation.
Closing that reminder or reloading a saved handoff keeps the invitation. After
the feast, and for historical saves with rescue progress, his existing time-bubble
conversation remains available.

The scene uses the existing private QuestScenes lifecycle and exact named
transcript playback. Actors, door changes and timed work belong to the player.
New actors pass a native NPC visibility update before their first overhead line.
Close, logout, death, leaving the area or replacing the dialogue aborts the scene;
the final fade rechecks the same owner/activity before marking the persisted
`recipe-for-disaster:feast-seen` flag and clearing the pending flag. A cancelled or
replaced final fade cannot mark the feast seen. Seen saves never recover another
pending feast, even if all eight rescues are still untouched.
A retry replays the feast without consuming ingredients or granting another point.

Cache model checks establish the specific freeze/frozen pairs:

| Actor | Freeze / frozen | Cache prefix |
|---|---|---|
| Mountain Dwarf |3376 /3377|`100_dwarf`|
| Pirate Pete |3373 /3374|`100_pirate`|
| Wartface |3388 /3389|`100_gobtwo`|
| Bentnoze |3384 /3385|`100_gob`|
| Lumbridge Guide |3361 /3362|`100_guide`|
| Evil Dave |3367 /3368|`100_dave`|
| Sir Amik |3370 /3371|`100_sir`|
| Awowogei |3392 /3393|`100_monkey`|
| Skrach |3380 /3381|`100_ogre`|
| Culinaromancer |3364 /3365|`100_cul`|

Each pair matches that actor's seated-idle skeleton in the active cache. Human
teleport714, cast811, kick423, bow858, Panic2105, walking819 and Aris freeze3397
match the human rig. Evil Bob uses the teleport graphic without a human sequence.
The effects are cache `teleport_casting`111 and `100_rings_spot`601. The white
flash uses the existing fade overlay174/script948; its colour/transparency
arguments follow the pinned cache script. Frozen rescue actors retain their
existing IDs with native base-animation overrides, preserving their interactions.

The native regressions use actual Player/NPC/PrivateArea/DialogueManager,
TaskManager, PlayerSession and ClientConnection inputs. They cover both spymasters,
full dialogue and overhead playback, encoded NPC_INFO, effects/frozen poses,
private visibility, native Close, death, PlayerSave reload, stale final callbacks,
replacement prompts, reward guards, repeat entry and historical progress.
The synthetic `rfd-opening-pre-feast-save.json` fixture was produced through the
original quest's native ingredient handover and normal PlayerSave JSON codec. It
has the real pre-change shape: stage4, zero rescues, one opening point, consumed
ingredients and no feast flags. Tests load it through the same codec in the
kitchen and frozen room, cancel/retry the recovered scene, then save/reload its
completed zero-rescue state. Separate controls preserve every saved RFD progress
byte across all eight subquests, legacy bits, recipes, auxiliary and finale state.
Collect is the existing Grand Exchange collection box: native visible loc12309
resolves its parent12308 and uses op3 (`Bank, null, Collect, Buy-food, Buy-items`).
The exact name/action hook matches the sole active-cache `Chest` with `Collect`.

This is functional scene coverage, not a live World/browser visual playthrough.
The available RSProx552 recording starts after the feast and cannot establish its
camera or frame timing. Unsupported camera pans are omitted. Reading follows
native dialogue Continue; short fades/actor transitions and transient staging use
the existing scene mechanisms and real room layout. Exact cinematic camera,
transient tile and frame parity remain unmeasured. No generated dialogue or other
exported JSON is modified.
