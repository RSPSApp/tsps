/**
 * Shadows of Custodia (members).
 *
 * The words come from the "Shadows of Custodia" transcript page. Progress lives
 * in varbit 16632 ("soc", varp 4734 "soc_main", bits 0-5). Evidence: the cache
 * varbit dump (lookup-gameval.ts varbit soc -> 16632 varp=4734 bits=0-5), cs2 4024
 * whose quest case reads get_varbit 16632, and the quest-list script 7856 which
 * treats varbit 16632 >= 24 as complete ("<col=ff00>Shadows of Custodia").
 * The stub's varpId 7916 was a placeholder. The client's Auburndale quest locs
 * are base "null" multi-locs that transform off this same varbit, which pins the
 * stage checkpoints further:
 *   56417 (Plank)      -> 56418 "Plank" (Inspect) at stages 6-9
 *   56422/56423 (Puddle) -> 56420 "Puddle" (Inspect) around the trail
 *   56424 (Bed)        -> 56426 "Bed" (Inspect) at stage 5
 *   56429 (Window)     -> 56430 "Window" (Inspect) at stage 5
 *   56432 (Wall) transforms off varbit 16659 ("soc_wall_state"): 1 Inspect,
 *   2 Reinforce, 3 reinforced.
 *
 * Stages (live checkpoints, matching the RuneLite Quest Helper ShadowsOfCustodia
 * step map and the loc transforms): 0 not started, 2 read the notice board,
 * 4 asked around (Ictus gates this), 5 parents let you search their house (wall inspectable),
 * 6 scratched wall inspected (puddles appear), 8 puddle inspected (plank reachable),
 * 9 wet fabric scrap fished off the plank, 10 scrap shown to the parents,
 * 12 inside the Stalker Den, 14 the boys are back in Auburnvale,
 * 15 reinforcing the wall / Captain Ariadna's willow longbows,
 * 16 both tasks done (the boys are awake), 18 the boys told you about Antos,
 * 20 the strange creatures are dead, 22 Antos brought home, 24 complete.
 *
 * One-shot flags mirror the quest's own varbits in the same varp: 16633 barkeep,
 * 16634 shopkeep, 16635 citizen, 16639 sillyman (Ictus), 16640 wallrepair,
 * 16641 bowsmade (0 none, 1 agreed, 2 handed in), 16644 parents, 16649 plankfound,
 * 16652 preboys chat, 16653 stalkers encountered, 16654 guard captain, 16659 wall
 * state. The fabric-destroyed / creatures-slain / met / spoken flags are private.
 *
 * Source: OSRS Wiki "Shadows of Custodia", quick guide, journal and transcript;
 * stage and varbit checkpoints cross-checked against the cache (transforms, cs2
 * 7856) and the RuneLite Quest Helper ShadowsOfCustodia (pajlada, BSD-2).
 *
 * Rewards per the OSRS Wiki: 2 Quest points, 10,000 Slayer, 4,000 Hunter,
 * 3,000 Fishing and 3,000 Construction experience, and access to the Stalker Den.
 *
 * Gaps: the shared Ladders plugin owns the house ladder, so
 * "helping-around-town-attempting-to-climb-the-ladder" plays by walking the player
 * back down when they reach the upstairs zone during stages 14-15. The parents'
 * "talking-to-them-again-before-talking-to-ictus" and the bartender's repeat branch
 * both end in a wiki "above" jump this server's resolver cannot target on this
 * page (all variants share the "parents" family), so the first conversations
 * replay instead. The wet fabric scrap has no cache actions, so its Inspect
 * flavour variant cannot be triggered;
 * choosing Destroy plays the destroy variant from the drop policy (replacing the
 * shared DestroyItem confirmation) and destroys the scrap. The fishing rod world
 * spawn is registered per-player at the wiki's spawn tile because it is missing
 * from ground-items.json; the hammer spawn is not simulated (the general store
 * sells hammers). Multi-speaker cutscenes (Ariadna's lines inside Antos's rescue
 * conversation) share the speaking NPC's chathead, as startTranscript has no
 * speaker index. The den's injured boy and cave Antos are owner-only spawns; the
 * town Antos from npc-spawns.json keeps the generic line. Den entry and the
 * boys/Antos return moves use the captured fade beats; den entry adds the captured
 * rockslide locs through a private QuestScene. The quest completes at
 * the end of the rescue conversation (its final Ariadna line), which is where the
 * transcript puts her scene, rather than after a separate talk with her.
 */
module.exports = function registerShadowsOfCustodiaQuest(api) {
  const { Item, ItemIdentifiers, Location, NpcIdentifiers, ObjectIdentifiers, Skill } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");

  const PAGE = "Shadows of Custodia";
  const START_HOOK = "quest:shadows-of-custodia:start";

  // Varp 4734 "soc_main"; stage in varbit 16632 "soc" (bits 0-5).
  const VARP_SHADOWS_OF_CUSTODIA = 4734;
  const STAGE_VARBIT = 16632;

  // The quest's own progress varbits in the same varp (lookup-gameval.ts varbit soc).
  const BARKEEP_VARBIT = 16633;
  const SHOPKEEP_VARBIT = 16634;
  const CITIZEN_VARBIT = 16635;
  const SILLYMAN_VARBIT = 16639;
  const WALLREPAIR_VARBIT = 16640;
  const BOWSMADE_VARBIT = 16641;
  const PARENTS_VARBIT = 16644;
  const PLANK_FOUND_VARBIT = 16649;
  const PREBOYS_CHAT_VARBIT = 16652;
  const STALKERS_VARBIT = 16653;
  const GUARD_CAPTAIN_VARBIT = 16654;
  const WALL_STATE_VARBIT = 16659;

  const STAGE_NOT_STARTED = 0;
  const STAGE_STARTED = 2;
  const STAGE_ASKED_AROUND = 4;
  const STAGE_HOUSE_SEARCH = 5;
  const STAGE_WALL_INSPECTED = 6;
  const STAGE_PUDDLE_INSPECTED = 8;
  const STAGE_FABRIC_FOUND = 9;
  const STAGE_MOUNTAINS = 10;
  const STAGE_DEN = 12;
  const STAGE_BOYS_RETURNED = 14;
  const STAGE_TASKS = 15;
  const STAGE_TASKS_DONE = 16;
  const STAGE_BOYS_TALKED = 18;
  const STAGE_CREATURES = 20;
  const STAGE_ANTOS_RETURNED = 22;
  const STAGE_COMPLETE = 24;

  // Private progress bits (persisted), plus the varbits that mirror them.
  const FLAGS_ATTRIBUTE = "quest.shadows_of_custodia.flags";
  const BOWS_ATTRIBUTE = "quest.shadows_of_custodia.bows";

  const BARKEEP_BIT = 1 << 0;
  const SHOPKEEP_BIT = 1 << 1;
  const CITIZEN_BIT = 1 << 2;
  const SILLYMAN_BIT = 1 << 3;
  const WALL_REPAIR_BIT = 1 << 4;
  const PARENTS_BIT = 1 << 5;
  const PLANK_FOUND_BIT = 1 << 6;
  const FABRIC_DESTROYED_BIT = 1 << 7;
  const STALKERS_BIT = 1 << 8;
  const GUARD_CAPTAIN_BIT = 1 << 9;
  const PREBOYS_CHAT_BIT = 1 << 10;
  const CREATURES_SLAIN_BIT = 1 << 11;
  const ARIADNA_MET_BIT = 1 << 12;

  const FLAG_VARBITS = new Map([
    [BARKEEP_BIT, BARKEEP_VARBIT],
    [SHOPKEEP_BIT, SHOPKEEP_VARBIT],
    [CITIZEN_BIT, CITIZEN_VARBIT],
    [SILLYMAN_BIT, SILLYMAN_VARBIT],
    [WALL_REPAIR_BIT, WALLREPAIR_VARBIT],
    [PARENTS_BIT, PARENTS_VARBIT],
    [PLANK_FOUND_BIT, PLANK_FOUND_VARBIT],
    [STALKERS_BIT, STALKERS_VARBIT],
    [GUARD_CAPTAIN_BIT, GUARD_CAPTAIN_VARBIT],
    [PREBOYS_CHAT_BIT, PREBOYS_CHAT_VARBIT],
  ]);

  const MARCUS_NPC_ID = NpcIdentifiers.MARCUS; // 14208
  const ANTOS_NPC_ID = NpcIdentifiers.ANTOS; // 14209, the cave Antos
  const ICTUS_NPC_ID = NpcIdentifiers.ICTUS; // 14212
  const AEMILIA_NPC_ID = NpcIdentifiers.AEMILIA; // 14213
  const FRANCIS_NPC_ID = NpcIdentifiers.FRANCIS_2; // 14214
  const INJURED_BOY_NPC_ID = NpcIdentifiers.INJURED_BOY; // 14215, the den spawn
  const SHAS_NPC_ID = NpcIdentifiers.SHAS; // 14216
  const ARIADNA_NPC_ID = NpcIdentifiers.CAPTAIN_ARIADNA; // 14218
  const ETZ_NPC_ID = NpcIdentifiers.ETZ; // 14219
  const SHOPKEEPER_NPC_ID = NpcIdentifiers.SHOPKEEPER_8; // 14656
  const BARTENDER_NPC_ID = NpcIdentifiers.BARTENDER_18; // 14660
  const STRANGE_CREATURE_NPC_ID = NpcIdentifiers.STRANGE_CREATURE_7; // 14706

  const PARENT_NPC_IDS = new Set([AEMILIA_NPC_ID, FRANCIS_NPC_ID]);
  const BOY_NPC_IDS = new Set([
    SHAS_NPC_ID,
    ETZ_NPC_ID,
    INJURED_BOY_NPC_ID,
    NpcIdentifiers.INJURED_BOY_2,
    14217, // soc_injured_person_intown
    14220, // soc_etz_multi
  ]);

  const NOTICE_BOARD_OBJECT_ID = ObjectIdentifiers.NOTICE_BOARD_7; // 56416 at (1396,3356)
  const CAVE_ENTER_OBJECT_ID = ObjectIdentifiers.CAVE_118; // 56439 at (1295,3373)
  const CAVE_EXIT_OBJECT_ID = ObjectIdentifiers.CAVE_119; // 56440 at (1295,9768)
  // Base "null" multi-locs (no generated identifier): the client clicks the
  // varbit-selected transform, the server resolves back to these.
  const PLANK_OBJECT_ID = 56417; // -> 56418 "Plank" Inspect at stages 6-9
  const PUDDLE_OBJECT_IDS = new Set([56422, 56423]); // -> 56420 "Puddle" Inspect
  // Varbit 16659 transforms the hidden base 56432 through 56434/56433/56435/56436;
  // the visible state (not the base) is what the client clicks.
  const WALL_OBJECT_IDS = new Set([56432, 56433, 56434, 56435, 56436]);

  const WET_FABRIC_SCRAP_ITEM_ID = ItemIdentifiers.WET_FABRIC_SCRAP; // 30936
  const MAPLE_LOGS_ITEM_ID = ItemIdentifiers.MAPLE_LOGS; // 1517
  const WILLOW_LONGBOW_ITEM_ID = ItemIdentifiers.WILLOW_LONGBOW; // 847
  const HAMMER_ITEM_ID = ItemIdentifiers.HAMMER; // 2347
  const FISHING_ROD_ITEM_ID = ItemIdentifiers.FISHING_ROD; // 307
  const FISHING_ROD_ITEM_IDS = new Set([
    FISHING_ROD_ITEM_ID,
    ItemIdentifiers.FLY_FISHING_ROD, // 309
    ItemIdentifiers.OILY_FISHING_ROD, // 1585
  ]);
  const WALL_LOG_COST = 4;
  const LONG_BOW_COST = 4;

  const DEN_LANDING = { x: 1296, y: 9767, z: 0 };
  const CAVE_MOUTH = { x: 1295, y: 3376, z: 0 };
  const INJURED_BOY_TILE = { x: 1298, y: 9757, z: 0 };
  const ANTOS_TILE = { x: 1337, y: 9753, z: 0 };
  const CREATURE_TILES = [
    { x: 1331, y: 9757 },
    { x: 1328, y: 9753 },
    { x: 1331, y: 9749 },
  ];
  const AUBURNVALE_LANDING = { x: 1381, y: 3359, z: 0 };
  const ARIADNA_LANDING = { x: 1369, y: 3344, z: 0 };
  const LADDER_LANDING = { x: 1380, y: 3357, z: 0 };
  // Wiki spawn point for the quest fishing rod (Fishing rod item spawns).
  const ROD_SPAWN_TILE = { x: 1331, y: 3330, z: 0 };

  // The Stalker Den is map regions 5272/5273/5016 (x 1216-1343, y 9728-9855).
  const DEN_ZONE = { minX: 1216, maxX: 1343, minY: 9728, maxY: 9855, levels: [0] };
  const UPSTAIRS_ZONE = { minX: 1378, maxX: 1383, minY: 3357, maxY: 3360, levels: [1] };

  const SLAYER_REQUIREMENT = 54;
  const FISHING_REQUIREMENT = 45;
  const CONSTRUCTION_REQUIREMENT = 41;
  const HUNTER_REQUIREMENT = 36;

  /** Owner-only den spawns keyed by role, and the creature fight bookkeeping. */
  const denNpcs = new WeakMap(); // player -> { boy, antos }
  const creatureSpawns = new WeakMap(); // player -> Set<npc>
  const creatureOwners = new WeakMap(); // npc -> player

  const Scenes = createQuestScenes(api);
  let quest;

  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;

  function isQuestPage(pages) {
    return Array.isArray(pages) && pages.some((page) => page?.page === PAGE);
  }

  function flags(player) {
    return Number(player.getAttribute(FLAGS_ATTRIBUTE)) || 0;
  }

  function hasFlag(player, bit) {
    return (flags(player) & bit) !== 0;
  }

  function setFlag(player, bit) {
    if (hasFlag(player, bit)) return;
    player.setAttribute(FLAGS_ATTRIBUTE, flags(player) | bit);
    const varbit = FLAG_VARBITS.get(bit);
    if (varbit !== undefined) player.getPacketSender().sendVarbit(varbit, 1);
  }

  function bowsMade(player) {
    return Number(player.getAttribute(BOWS_ATTRIBUTE)) || 0;
  }

  function setBowsMade(player, value) {
    if (bowsMade(player) === value) return;
    player.setAttribute(BOWS_ATTRIBUTE, value);
    player.getPacketSender().sendVarbit(BOWSMADE_VARBIT, value);
  }

  function hasFourLongbows(player) {
    return held(player, WILLOW_LONGBOW_ITEM_ID, LONG_BOW_COST);
  }

  /** Captured: once wall and guard bow tasks are both done, the boys are awake. */
  function syncTasksDone(player) {
    if (hasFlag(player, WALL_REPAIR_BIT) && hasFlag(player, GUARD_CAPTAIN_BIT) &&
        quest.getStage(player) < STAGE_TASKS_DONE) {
      quest.setStage(player, STAGE_TASKS_DONE);
    }
  }

  function wallState(player) {
    if (hasFlag(player, WALL_REPAIR_BIT)) return 3;
    const stage = quest.getStage(player);
    if (stage >= STAGE_TASKS) return 2;
    if (stage >= STAGE_FABRIC_FOUND) return 0;
    if (stage >= STAGE_HOUSE_SEARCH) return 1;
    return 0;
  }

  function syncProgressVarbits(player) {
    const sender = player.getPacketSender();
    const bits = flags(player);
    for (const [bit, varbit] of FLAG_VARBITS) {
      sender.sendVarbit(varbit, (bits & bit) !== 0 ? 1 : 0);
    }
    sender.sendVarbit(BOWSMADE_VARBIT, bowsMade(player));
    sender.sendVarbit(WALL_STATE_VARBIT, wallState(player));
  }

  function meetsRequirements(player) {
    const skills = player.getSkillManager();
    const childrenOfTheSun = { player, key: "children_of_the_sun", complete: false };
    api.emitCustomEvent("quest:is-complete", childrenOfTheSun);
    return (
      childrenOfTheSun.complete === true &&
      skills.getMaxLevel(Skill.SLAYER) >= SLAYER_REQUIREMENT &&
      skills.getMaxLevel(Skill.FISHING) >= FISHING_REQUIREMENT &&
      skills.getMaxLevel(Skill.CONSTRUCTION) >= CONSTRUCTION_REQUIREMENT &&
      skills.getMaxLevel(Skill.HUNTER) >= HUNTER_REQUIREMENT
    );
  }

  // ==========================================================================
  // Variant selection
  // ==========================================================================

  function selectVariant({ npcId, player }) {
    if (npcId === MARCUS_NPC_ID) return selectMarcus(player);
    if (npcId === ICTUS_NPC_ID) return selectIctus(player);
    if (npcId === BARTENDER_NPC_ID) return selectBartender(player);
    if (npcId === SHOPKEEPER_NPC_ID) return selectShopkeeper(player);
    if (PARENT_NPC_IDS.has(npcId)) return selectParents(player);
    if (npcId === ARIADNA_NPC_ID) return selectAriadna(player);
    if (BOY_NPC_IDS.has(npcId)) return selectBoys(player);
    return null;
  }

  function selectMarcus(player) {
    const stage = quest.getStage(player);
    if (stage === STAGE_NOT_STARTED) return null; // the pub's flat standard dialogue
    if (quest.isComplete(player)) return "post-quest-dialogue-talking-to-marcus";
    if (stage >= STAGE_TASKS) return "helping-around-town-talking-to-marcus";
    return hasFlag(player, CITIZEN_BIT)
      ? "parents-anguish-talking-to-marcus-talking-to-marcus-again"
      : "parents-anguish-talking-to-marcus";
  }

  function selectIctus(player) {
    if (quest.isComplete(player)) return "post-quest-dialogue-talking-to-ictus";
    // The dump has no pre-quest Ictus page, so the first quest chat plays for it too.
    return hasFlag(player, SILLYMAN_BIT)
      ? "parents-anguish-talking-to-ictus-talking-to-ictus-again"
      : "parents-anguish-talking-to-ictus";
  }

  function selectBartender(player) {
    if (quest.getStage(player) === STAGE_NOT_STARTED) return null;
    // After the missing-people chat the pub's own page (and its shop) returns;
    // the dump's repeat branch jumps "above" in a way this server cannot target.
    if (hasFlag(player, BARKEEP_BIT)) return null;
    return "parents-anguish-talking-to-the-bartender";
  }

  function selectShopkeeper(player) {
    if (quest.getStage(player) === STAGE_NOT_STARTED) return null;
    // Back to the general store's own page so its shop option keeps working.
    if (hasFlag(player, SHOPKEEP_BIT)) return null;
    return "parents-anguish-talking-to-the-shopkeeper";
  }

  function selectParents(player) {
    const stage = quest.getStage(player);
    if (stage === STAGE_NOT_STARTED) return null; // "before-starting-shadows-of-custodia"
    if (quest.isComplete(player)) return "post-quest-dialogue-talking-to-aemilia-or-francis";
    if (stage >= STAGE_BOYS_TALKED) return "rescuing-antos-talking-to-aemilia-or-francis";
    if (stage >= STAGE_BOYS_RETURNED) return "helping-around-town-talking-to-aemilia-or-francis";
    if (stage >= STAGE_MOUNTAINS) return "parents-anguish-talking-to-aemilia-or-francis-again";
    if (stage >= STAGE_FABRIC_FOUND) {
      return "parents-anguish-talking-to-aemilia-or-francis-after-finding-the-fabric";
    }
    if (stage >= STAGE_WALL_INSPECTED) {
      return "parents-anguish-talking-to-aemilia-or-francis-talking-to-them-again-after-finding-the-scratches-puddles";
    }
    if (hasFlag(player, PARENTS_BIT)) {
      return "parents-anguish-talking-to-aemilia-or-francis-talking-to-them-again-after-talking-to-ictus";
    }
    // Until they trust the player the first conversation replays; it carries the
    // Ictus conditions itself, so a refused player just talks again to get in.
    return "parents-anguish-talking-to-aemilia-or-francis";
  }

  function selectAriadna(player) {
    const stage = quest.getStage(player);
    if (stage === STAGE_NOT_STARTED) return null; // her flat standard dialogue
    if (quest.isComplete(player)) return "post-quest-dialogue-talking-to-captain-ariadna";
    if (stage >= STAGE_BOYS_TALKED) return "rescuing-antos-talking-to-captain-ariadna";
    if (stage >= STAGE_BOYS_RETURNED) {
      // Handing the bows in overrides the "still fetching them" reminder.
      if (bowsMade(player) >= 2) {
        return "helping-around-town-talking-to-captain-ariadna-talking-to-her-again";
      }
      if (hasFourLongbows(player)) {
        return "helping-around-town-talking-to-captain-ariadna-talking-to-her-again";
      }
      if (bowsMade(player) >= 1) {
        return "helping-around-town-talking-to-captain-ariadna-without-all-four-longbows";
      }
      return "helping-around-town-talking-to-captain-ariadna";
    }
    if (stage >= STAGE_PUDDLE_INSPECTED) {
      return "parents-anguish-talking-to-aemilia-or-francis-talking-to-ariadna-again-after-inspecting-puddles";
    }
    return hasFlag(player, ARIADNA_MET_BIT)
      ? "parents-anguish-talking-to-captain-ariadna-talking-to-ariadna-again"
      : "parents-anguish-talking-to-captain-ariadna";
  }

  function selectBoys(player) {
    const stage = quest.getStage(player);
    if (quest.isComplete(player)) return "post-quest-dialogue-talking-to-shas-or-etz";
    if (stage >= STAGE_BOYS_TALKED) {
      return "rescuing-antos-talking-to-etz-or-shas-talking-to-them-again";
    }
    if (stage >= STAGE_TASKS_DONE) return "rescuing-antos-talking-to-etz-or-shas";
    if (stage >= STAGE_MOUNTAINS && stage < STAGE_BOYS_RETURNED) return "parents-anguish-talking-to-etz";
    // Stages 14-15 and before: either the boys are resting or the ladder is in
    // the way, so the "come back later" line is the closest the dump has.
    return "helping-around-town-attempting-to-climb-the-ladder";
  }

  // ==========================================================================
  // Prose conditions
  // ==========================================================================

  function answerCondition(event) {
    if (!isQuestPage(event.pages)) return null;
    const { player, stepId } = event;
    switch (stepId) {
      case "Mh6NHP": // notice board: not started
        return quest.getStage(player) === STAGE_NOT_STARTED;
      case "XMeGOU": // notice board: started
        return quest.getStage(player) !== STAGE_NOT_STARTED;
      case "d2x19D": // bartender: first conversation
        return !hasFlag(player, BARKEEP_BIT);
      case "dnZSt6": // bartender: repeat
        return hasFlag(player, BARKEEP_BIT);
      case "sE-Xte": // shopkeeper: first conversation
        return !hasFlag(player, SHOPKEEP_BIT);
      case "SzvahS": // shopkeeper: repeat
        return hasFlag(player, SHOPKEEP_BIT);
      case "crIEJs": // parents: not talked to Ictus
        return !hasFlag(player, SILLYMAN_BIT);
      case "dfjxEe": // parents: talked to Ictus
        return hasFlag(player, SILLYMAN_BIT);
      case "VUkRy-": // parents: nothing found yet
        return !hasFlag(player, PLANK_FOUND_BIT);
      case "JAMzez": // parents: found the scrap and still have it
        return hasFlag(player, PLANK_FOUND_BIT) && held(player, WET_FABRIC_SCRAP_ITEM_ID);
      case "3Zcn7L": // parents: found and destroyed the scrap
        // The only ways to lose the scrap are this plugin's destroy route, so a
        // found-but-missing scrap is treated as destroyed rather than a dead end.
        return hasFlag(player, FABRIC_DESTROYED_BIT) ||
          (hasFlag(player, PLANK_FOUND_BIT) && !held(player, WET_FABRIC_SCRAP_ITEM_ID));
      case "SVrFyl": // parents: wall reinforced, captain not yet told
        return hasFlag(player, WALL_REPAIR_BIT) && !hasFlag(player, GUARD_CAPTAIN_BIT);
      case "nKSjoK": // parents: captain not talked to
      case "Qf3QS8":
      case "tt_IHB":
        return !hasFlag(player, GUARD_CAPTAIN_BIT);
      case "YHJ4xt": // parents: wall not reinforced, captain not told
        return !hasFlag(player, WALL_REPAIR_BIT) && !hasFlag(player, GUARD_CAPTAIN_BIT);
      case "1fB80N": // parents: wall not reinforced, captain told
        return !hasFlag(player, WALL_REPAIR_BIT) && hasFlag(player, GUARD_CAPTAIN_BIT);
      case "WTjypu": // parents: agreed to get longbows
      case "xSlkKw":
        return bowsMade(player) >= 1;
      case "ozNjKq": // parents: all tasks finished
        return hasFlag(player, WALL_REPAIR_BIT) && hasFlag(player, GUARD_CAPTAIN_BIT);
      case "7Ufx1r": // Ariadna: not enough longbows
        return !hasFourLongbows(player);
      case "RfYDW_": // Ariadna: enough longbows
        return hasFourLongbows(player);
      case "JwwoQ8": // parents: boys not talked to yet
      case "jnCLDv": // Ariadna: boys not talked to yet
        return !hasFlag(player, PREBOYS_CHAT_BIT);
      case "TvxADb": // parents: boys talked to
      case "B3lvui": // Ariadna: boys talked to
        return hasFlag(player, PREBOYS_CHAT_BIT);
      default:
        return null;
    }
  }

  /** Side effects of the chosen condition branch. */
  function handleConditionChosen(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;
    switch (stepId) {
      case "dfjxEe": // the parents trust the player and allow the search
        setFlag(player, PARENTS_BIT);
        if (quest.getStage(player) < STAGE_HOUSE_SEARCH) {
          quest.setStage(player, STAGE_HOUSE_SEARCH);
        }
        syncProgressVarbits(player);
        return;
      case "JAMzez": // the scrap was recognised; head for the mountains
      case "3Zcn7L":
        if (quest.getStage(player) < STAGE_MOUNTAINS) quest.setStage(player, STAGE_MOUNTAINS);
        return;
      case "SVrFyl": // the wall-task chat opens the helping phase
      case "YHJ4xt":
      case "1fB80N":
        if (quest.getStage(player) < STAGE_TASKS) {
          quest.setStage(player, STAGE_TASKS);
          syncProgressVarbits(player);
        }
        return;
      case "ozNjKq": // wall reinforced and captain told: the boys are awake
        if (quest.getStage(player) < STAGE_TASKS_DONE) {
          quest.setStage(player, STAGE_TASKS_DONE);
        }
        return;
      case "7Ufx1r": // the captain asked for four willow longbows
      case "RfYDW_":
        setFlag(player, GUARD_CAPTAIN_BIT);
        if (bowsMade(player) < 1) setBowsMade(player, 1);
        return;
      default:
        return;
    }
  }

  /** Scene directions and item hand-ins carried by message/action steps. */
  function handleAction(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;
    switch (stepId) {
      case "ceSMzY": // hooked a bit of fabric off the plank
        event.handled = true;
        if (event.text) player.sendMessage(String(event.text));
        if (!held(player, WET_FABRIC_SCRAP_ITEM_ID)) {
          player.getInventory().adds(WET_FABRIC_SCRAP_ITEM_ID, 1);
        }
        setFlag(player, PLANK_FOUND_BIT);
        if (quest.getStage(player) < STAGE_FABRIC_FOUND) {
          quest.setStage(player, STAGE_FABRIC_FOUND);
        }
        return;
      case "Z1OThu": // the destroy narrative ends; the scrap is gone
        event.handled = true;
        event.end = true;
        if (held(player, WET_FABRIC_SCRAP_ITEM_ID)) {
          player.getInventory().deleteNumber(WET_FABRIC_SCRAP_ITEM_ID, 1);
        }
        setFlag(player, FABRIC_DESTROYED_BIT);
        return;
      case "I09FpK": // carried the boys back to Auburnvale
        event.handled = true;
        if (event.text) player.sendMessage(String(event.text));
        removeDenNpc(player, "boy");
        Scenes.fade(player, true);
        Scenes.later(player, 2, () => {
          player.moveTo(new Location(AUBURNVALE_LANDING.x, AUBURNVALE_LANDING.y, AUBURNVALE_LANDING.z));
          if (quest.getStage(player) < STAGE_BOYS_RETURNED) quest.setStage(player, STAGE_BOYS_RETURNED);
          syncProgressVarbits(player);
          Scenes.fade(player, false);
          Scenes.later(player, 2, () => Scenes.closeFade(player));
        });
        return;
      case "atm-AZ": // handed the four longbows to Ariadna
      case "c3igWy":
        event.handled = true;
        // The hand-in action is the durable source of the guard-captain flag.
        // The transcript condition is not a reliable completion hook in the
        // shipped dialogue runner, so keep this idempotent and recover old
        // saves that already show bowsMade=2 but lost the flag.
        if (quest.getStage(player) < STAGE_TASKS) return;
        if (bowsMade(player) < 2 && hasFourLongbows(player)) {
          if (event.text) player.sendMessage(String(event.text));
          player.getInventory().deleteNumber(WILLOW_LONGBOW_ITEM_ID, LONG_BOW_COST);
          setBowsMade(player, 2);
        }
        if (bowsMade(player) >= 2) {
          setFlag(player, GUARD_CAPTAIN_BIT);
          syncProgressVarbits(player);
          syncTasksDone(player);
        }
        return;
      case "d0esGd": // carried Antos back to Auburnvale
        event.handled = true;
        if (event.text) player.sendMessage(String(event.text));
        removeDenNpc(player, "antos");
        // The Ariadna continuation in this same transcript completes on stage 22;
        // write it before the fade so the final captured line can complete once.
        if (quest.getStage(player) < STAGE_ANTOS_RETURNED) quest.setStage(player, STAGE_ANTOS_RETURNED);
        Scenes.fade(player, true);
        Scenes.later(player, 2, () => {
          player.moveTo(new Location(ARIADNA_LANDING.x, ARIADNA_LANDING.y, ARIADNA_LANDING.z));
          Scenes.fade(player, false);
          Scenes.later(player, 2, () => Scenes.closeFade(player));
        });
        return;
      default:
        return;
    }
  }

  /** First-line flags and the rescue conversation's cutscene beats. */
  function handleDialogueLine(event) {
    const { player, npcId } = event;
    const text = String(event.text ?? "");
    const started = quest.getStage(player) >= STAGE_STARTED;
    if (started && npcId === ICTUS_NPC_ID && !hasFlag(player, SILLYMAN_BIT)) {
      setFlag(player, SILLYMAN_BIT);
      // Captured: Ictus completes the "ask around" step; the shopkeeper is optional.
      if (quest.getStage(player) < STAGE_ASKED_AROUND) quest.setStage(player, STAGE_ASKED_AROUND);
      return;
    }
    if (started && npcId === MARCUS_NPC_ID && !hasFlag(player, CITIZEN_BIT)) {
      setFlag(player, CITIZEN_BIT);
      return;
    }
    if (started && npcId === BARTENDER_NPC_ID && !hasFlag(player, BARKEEP_BIT)) {
      setFlag(player, BARKEEP_BIT);
      return;
    }
    if (started && npcId === SHOPKEEPER_NPC_ID && !hasFlag(player, SHOPKEEP_BIT)) {
      setFlag(player, SHOPKEEP_BIT);
      return;
    }
    if (started && npcId === ARIADNA_NPC_ID && !hasFlag(player, ARIADNA_MET_BIT)) {
      setFlag(player, ARIADNA_MET_BIT);
      return;
    }
    if (
      BOY_NPC_IDS.has(npcId) &&
      quest.getStage(player) === STAGE_TASKS_DONE &&
      !hasFlag(player, PREBOYS_CHAT_BIT)
    ) {
      setFlag(player, PREBOYS_CHAT_BIT);
      quest.setStage(player, STAGE_BOYS_TALKED);
      return;
    }
    if (
      npcId === ANTOS_NPC_ID &&
      quest.getStage(player) >= STAGE_BOYS_TALKED &&
      quest.getStage(player) < STAGE_COMPLETE &&
      !hasFlag(player, STALKERS_BIT)
    ) {
      if (/behind\.\.\. you/i.test(text)) {
        setFlag(player, STALKERS_BIT);
        spawnCreatures(player);
      }
      return;
    }
    if (
      npcId === ANTOS_NPC_ID &&
      quest.getStage(player) === STAGE_ANTOS_RETURNED &&
      /all the best, traveller/i.test(text) &&
      !quest.isComplete(player)
    ) {
      quest.complete(player);
    }
  }

  function handleStartHook({ player, hook }) {
    if (hook !== START_HOOK) return;
    if (quest.getStage(player) !== STAGE_NOT_STARTED) return;
    if (!meetsRequirements(player)) {
      player.sendMessage("You do not meet all of the requirements to start Shadows of Custodia.");
      return;
    }
    quest.setStage(player, STAGE_STARTED);
  }

  // ==========================================================================
  // Object interactions
  // ==========================================================================

  function interactionAction(event) {
    const { clickType, definition } = event;
    return String(definition?.getInteractions?.()?.[clickType - 1] ?? "");
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    const action = interactionAction(event);
    const stage = quest.getStage(player);

    if (objectId === NOTICE_BOARD_OBJECT_ID) {
      if (action !== "Check") return;
      event.handled = true;
      startTranscript(api, player, AEMILIA_NPC_ID, PAGE, "parents-anguish-reading-the-noticeboard");
      return;
    }
    if (objectId === PLANK_OBJECT_ID) {
      if (action !== "Inspect") return;
      event.handled = true;
      startTranscript(
        api,
        player,
        AEMILIA_NPC_ID,
        PAGE,
        stage >= STAGE_FABRIC_FOUND
          ? "parents-anguish-finding-the-fabric-reinspecting-the-plank"
          : "parents-anguish-finding-the-fabric-inspecting-the-plank"
      );
      return;
    }
    if (PUDDLE_OBJECT_IDS.has(objectId)) {
      if (action !== "Inspect") return;
      event.handled = true;
      startTranscript(api, player, AEMILIA_NPC_ID, PAGE, "parents-anguish-finding-the-fabric-inspecting-a-puddle");
      if (stage < STAGE_PUDDLE_INSPECTED) quest.setStage(player, STAGE_PUDDLE_INSPECTED);
      return;
    }
    if (WALL_OBJECT_IDS.has(objectId)) {
      if (action === "Inspect") {
        event.handled = true;
        startTranscript(api, player, AEMILIA_NPC_ID, PAGE, "parents-anguish-finding-the-fabric-inspecting-the-wall");
        if (stage < STAGE_WALL_INSPECTED) quest.setStage(player, STAGE_WALL_INSPECTED);
        return;
      }
      if (action === "Reinforce") {
        event.handled = true;
        // Quest Helper only exposes Reinforce once the boys are home (stage 15).
        if (stage < STAGE_TASKS) {
          startTranscript(api, player, AEMILIA_NPC_ID, PAGE, "parents-anguish-finding-the-fabric-inspecting-the-wall");
          if (stage < STAGE_WALL_INSPECTED) quest.setStage(player, STAGE_WALL_INSPECTED);
          return;
        }
        reinforceWall(player);
        return;
      }
      return;
    }
    if (objectId === CAVE_ENTER_OBJECT_ID) {
      if (action !== "Enter") return;
      event.handled = true;
      enterDen(player, stage);
      return;
    }
    if (objectId === CAVE_EXIT_OBJECT_ID) {
      if (action !== "Exit") return;
      event.handled = true;
      player.moveTo(new Location(CAVE_MOUTH.x, CAVE_MOUTH.y, CAVE_MOUTH.z));
      return;
    }
  }

  function reinforceWall(player) {
    const hasLogs = held(player, MAPLE_LOGS_ITEM_ID, WALL_LOG_COST);
    const hasHammer = held(player, HAMMER_ITEM_ID, 1);
    if (!hasLogs || !hasHammer) {
      startTranscript(
        api,
        player,
        AEMILIA_NPC_ID,
        PAGE,
        hasLogs
          ? "helping-around-town-reinforcing-the-wall-without-a-hammer-even-with-logs"
          : "helping-around-town-reinforcing-the-wall-without-enough-logs"
      );
      return;
    }
    player.getInventory().deleteNumber(MAPLE_LOGS_ITEM_ID, WALL_LOG_COST);
    setFlag(player, WALL_REPAIR_BIT);
    syncProgressVarbits(player);
    syncTasksDone(player);
    startTranscript(api, player, AEMILIA_NPC_ID, PAGE, "helping-around-town-reinforcing-the-wall");
  }

  /** Fishing rod onto the plank hooks the wet fabric scrap. */
  function handleItemOnObject(event) {
    const { player, objectId, itemId } = event;
    if (objectId !== PLANK_OBJECT_ID || !FISHING_ROD_ITEM_IDS.has(itemId)) return;
    event.handled = true;
    const stage = quest.getStage(player);
    if (stage < STAGE_WALL_INSPECTED) return;
    if (stage >= STAGE_FABRIC_FOUND) {
      startTranscript(api, player, AEMILIA_NPC_ID, PAGE, "parents-anguish-finding-the-fabric-reinspecting-the-plank");
      return;
    }
    if (player.getInventory().getFreeSlots() < 1) {
      player.sendMessage("You need more inventory space.");
      return;
    }
    startTranscript(api, player, AEMILIA_NPC_ID, PAGE, "parents-anguish-finding-the-fabric-using-a-fishing-rod-on-the-plank");
  }

  /**
   * The scrap's Destroy option routes through the shared drop policy. Playing the
   * destroy variant replaces the DestroyItem confirmation (it runs first); the
   * scrape is removed by the variant's own action step instead.
   */
  function handleItemDropPolicy(event) {
    const { player, itemId } = event;
    if (itemId !== WET_FABRIC_SCRAP_ITEM_ID) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_FABRIC_FOUND || stage >= STAGE_COMPLETE) return;
    if (hasFlag(player, FABRIC_DESTROYED_BIT)) return;
    if (!held(player, WET_FABRIC_SCRAP_ITEM_ID)) return;
    event.handled = true;
    event.dropToGround = false;
    startTranscript(api, player, AEMILIA_NPC_ID, PAGE, "parents-anguish-finding-the-fabric-destroying-the-wet-fabric-scrap");
  }

  // ==========================================================================
  // Antos, the strange creatures and the den spawns
  // ==========================================================================

  function handleAntosTalk(event) {
    const { player, npcId } = event;
    if (npcId !== ANTOS_NPC_ID) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_BOYS_TALKED || quest.isComplete(player)) return false;
    if (hasFlag(player, CREATURES_SLAIN_BIT)) {
      startTranscript(api, player, ANTOS_NPC_ID, PAGE, "rescuing-antos-talking-to-antos-after-killing-the-strange-creatures");
      return true;
    }
    startTranscript(api, player, ANTOS_NPC_ID, PAGE, "rescuing-antos-talking-to-antos");
    return true;
  }

  function spawnCreatures(player) {
    if (creatureSpawns.has(player)) return;
    const list = new Set();
    creatureSpawns.set(player, list);
    for (const tile of CREATURE_TILES) {
      const npc = api.spawnNpc({
        id: STRANGE_CREATURE_NPC_ID,
        x: tile.x,
        y: tile.y,
        z: 0,
        wanderRadius: 0,
        owner: player,
        ownerOnly: true,
      });
      if (npc) {
        attachToDenScene(player, npc);
        list.add(npc);
        creatureOwners.set(npc, player);
      }
    }
  }

  function handleNpcDeath(event) {
    const owner = creatureOwners.get(event.npc);
    if (!owner) return;
    creatureOwners.delete(event.npc);
    const list = creatureSpawns.get(owner);
    if (list) list.delete(event.npc);
    if (!list || list.size > 0) return;
    creatureSpawns.delete(owner);
    setFlag(owner, CREATURES_SLAIN_BIT);
    if (quest.getStage(owner) < STAGE_CREATURES) quest.setStage(owner, STAGE_CREATURES);
  }

  /** Owner-only den actors must join the private scene area or they are hidden. */
  function attachToDenScene(player, npc) {
    const scene = Scenes.get(player);
    if (npc && scene?.area) scene.area.add(npc);
    return npc;
  }

  /** Wait for the private area's queued NPC removal, then spawn world den actors once. */
  function resyncDenAfterScene(player, attempts = 6) {
    if (!player?.isRegistered?.()) return;
    const tracked = denNpcs.get(player);
    const pending = tracked && [tracked.boy, tracked.antos].some(npc => npc?.isRegistered?.());
    if (pending && attempts > 0) {
      Scenes.later(player, 1, () => resyncDenAfterScene(player, attempts - 1));
      return;
    }
    denNpcs.delete(player);
    syncDenNpcs(player);
  }

  function syncDenNpcs(player) {
    const stage = quest.getStage(player);
    const tracked = denNpcs.get(player) ?? { boy: null, antos: null };
    denNpcs.set(player, tracked);

    const wantBoy = stage >= STAGE_MOUNTAINS && stage < STAGE_BOYS_RETURNED;
    if (wantBoy && (!tracked.boy || tracked.boy.isRegistered?.() === false)) {
      tracked.boy = attachToDenScene(player, api.spawnNpc({
        id: INJURED_BOY_NPC_ID,
        x: INJURED_BOY_TILE.x,
        y: INJURED_BOY_TILE.y,
        z: INJURED_BOY_TILE.z,
        wanderRadius: 0,
        owner: player,
        ownerOnly: true,
      }));
    } else if (!wantBoy && tracked.boy) {
      api.removeNpc(tracked.boy);
      tracked.boy = null;
    }

    const wantAntos = stage >= STAGE_BOYS_TALKED && !quest.isComplete(player);
    if (wantAntos && (!tracked.antos || tracked.antos.isRegistered?.() === false)) {
      tracked.antos = attachToDenScene(player, api.spawnNpc({
        id: ANTOS_NPC_ID,
        x: ANTOS_TILE.x,
        y: ANTOS_TILE.y,
        z: ANTOS_TILE.z,
        wanderRadius: 0,
        owner: player,
        ownerOnly: true,
      }));
    } else if (!wantAntos && tracked.antos) {
      api.removeNpc(tracked.antos);
      tracked.antos = null;
    }

    // A relog mid-fight leaves no creatures in the world; bring them back.
    if (
      stage >= STAGE_BOYS_TALKED &&
      !quest.isComplete(player) &&
      hasFlag(player, STALKERS_BIT) &&
      !hasFlag(player, CREATURES_SLAIN_BIT) &&
      !creatureSpawns.has(player)
    ) {
      spawnCreatures(player);
    }
  }

  function removeDenNpc(player, key) {
    const tracked = denNpcs.get(player);
    if (!tracked || !tracked[key]) return;
    api.removeNpc(tracked[key]);
    tracked[key] = null;
  }

  function clearPlayerSpawns(player) {
    removeDenNpc(player, "boy");
    removeDenNpc(player, "antos");
    denNpcs.delete(player);
    const creatures = creatureSpawns.get(player);
    if (creatures) {
      for (const npc of creatures) {
        creatureOwners.delete(npc);
        api.removeNpc(npc);
      }
      creatureSpawns.delete(player);
    }
  }

  // ==========================================================================
  // Zones, login and the rod spawn
  // ==========================================================================

  function enterDen(player, stage) {
    Scenes.controls(player, true, true);
    Scenes.fade(player, true);
    Scenes.later(player, 2, () => {
      if (!Scenes.get(player)) {
        const scene = Scenes.open(player, "custodia-den", [[1216, 1343, 9728, 9855, 0]]);
        for (const [id, x, y, face] of [
          [57645, 1286, 9744, 3], [57645, 1289, 9744, 0], [57642, 1288, 9745, 3],
          [11426, 1299, 9744, 0], [11426, 1301, 9745, 3], [57643, 1299, 9746, 1],
          [57642, 1301, 9744, 1], [11426, 1287, 9743, 1], [11426, 1285, 9742, 0],
          [57643, 1287, 9742, 2],
        ]) Scenes.loc(scene, { id, x, y, z: 0, face });
      }
      player.moveTo(new Location(DEN_LANDING.x, DEN_LANDING.y, DEN_LANDING.z));
      if (stage >= STAGE_MOUNTAINS && stage < STAGE_DEN) quest.setStage(player, STAGE_DEN);
      Scenes.fade(player, false);
      Scenes.later(player, 2, () => {
        Scenes.closeFade(player);
        // The captured den transition ends with the fade-in. Keeping this private
        // scene alive blocked the normal path and hid owner-only den NPCs.
        Scenes.end(player, false);
        Scenes.later(player, 1, () => resyncDenAfterScene(player));
      });
    });
  }

  function handleDenZoneEnter({ player }) {
    if (!player || player.isPlayerBot?.() === true) return;
    const stage = quest.getStage(player);
    if (stage >= STAGE_MOUNTAINS && stage < STAGE_DEN) quest.setStage(player, STAGE_DEN);
    syncDenNpcs(player);
  }

  function handleUpstairsZoneEnter({ player }) {
    if (!player || player.isPlayerBot?.() === true) return;
    const stage = quest.getStage(player);
    if (stage !== STAGE_BOYS_RETURNED && stage !== STAGE_TASKS) return;
    player.moveTo(new Location(LADDER_LANDING.x, LADDER_LANDING.y, LADDER_LANDING.z));
    startTranscript(api, player, AEMILIA_NPC_ID, PAGE, "helping-around-town-attempting-to-climb-the-ladder");
  }

  function ensureRodSpawn(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_MOUNTAINS) return;
    const manager = api.getItemOnGroundManager?.();
    if (!manager?.registerLocation || !manager?.getGroundItem) return;
    const position = new Location(ROD_SPAWN_TILE.x, ROD_SPAWN_TILE.y, ROD_SPAWN_TILE.z);
    if (manager.getGroundItem(player.getUsername(), FISHING_ROD_ITEM_ID, position, null)) return;
    manager.registerLocation(player, new Item(FISHING_ROD_ITEM_ID, 1), position);
  }

  function handleLogin({ player }) {
    if (!player || player.isPlayerBot?.() === true) return;
    syncProgressVarbits(player);
    ensureRodSpawn(player);
    const location = player.getLocation();
    if (
      location.getZ() === 0 &&
      location.getX() >= DEN_ZONE.minX &&
      location.getX() <= DEN_ZONE.maxX &&
      location.getY() >= DEN_ZONE.minY &&
      location.getY() <= DEN_ZONE.maxY
    ) {
      syncDenNpcs(player);
    }
    refreshQuestList(player);
  }

  function handleBootstrap({ player }) {
    syncProgressVarbits(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    Scenes.end(player, true);
    clearPlayerSpawns(player);
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    const history = [
      "<str>I read the notice board in the Auburn Pub and offered to help find</str>",
      "<str>Auburnvale's missing people.</str>",
      "<str>I followed a trail of strange puddles from the missing boys' house to</str>",
      "<str>the Custodia Pass and brought the two boys home from a cave there.</str>",
      "<str>I reinforced the wall of their house, armed the guard with longbows and</str>",
      "<str>rescued Antos from the strange creatures in the Stalker Den.</str>",
    ];
    if (stage >= STAGE_COMPLETE) {
      return [...history, "", "<col=ff0000>QUEST COMPLETE!</col>"];
    }
    if (stage >= STAGE_ANTOS_RETURNED) {
      return [...history, "", "I brought Antos back to Auburnvale."];
    }
    if (stage >= STAGE_CREATURES) {
      return [...history, "", "I should speak to <col=800000>Antos</col> again now the creatures are dead."];
    }
    if (stage >= STAGE_BOYS_TALKED) {
      return [
        ...history,
        "",
        "The boys told me that <col=800000>Antos</col> is still in the cave.",
        "I should rescue him from the strange creatures.",
      ];
    }
    if (stage >= STAGE_TASKS_DONE) {
      return [
        ...history,
        "",
        "Both tasks are done, so Etz and Shas should be well enough to talk.",
        "They are upstairs in their parents' house.",
      ];
    }
    if (stage >= STAGE_TASKS) {
      const lines = [...history, ""];
      lines.push(
        hasFlag(player, WALL_REPAIR_BIT)
          ? "<str>I have reinforced the scratched wall of the boys' house.</str>"
          : "I need to reinforce the scratched wall with four maple logs and a hammer."
      );
      if (bowsMade(player) >= 2) {
        lines.push("<str>I gave Captain Ariadna the four willow longbows.</str>");
      } else if (bowsMade(player) >= 1) {
        lines.push("I should bring Captain Ariadna four willow longbows.");
      } else {
        lines.push("I should speak to <col=800000>Captain Ariadna</col> by the town gates.");
      }
      return lines;
    }
    if (stage >= STAGE_BOYS_RETURNED) {
      return [
        ...history,
        "",
        "The boys need rest before I can ask them what happened.",
        "Their parents asked me to reinforce the wall and tell Captain Ariadna.",
      ];
    }
    if (stage >= STAGE_DEN) {
      return [...history, "", "I found the boys in a cave in the Custodia Pass."];
    }
    if (stage >= STAGE_MOUNTAINS) {
      return [...history, "", "The puddle trail leads towards the mountains in the Custodia Pass."];
    }
    if (stage >= STAGE_FABRIC_FOUND) {
      return [...history, "", "I should show the wet fabric scrap to <col=800000>Aemilia</col> and <col=800000>Francis</col>."];
    }
    if (stage >= STAGE_PUDDLE_INSPECTED) {
      return [...history, "", "I followed the puddles to the river; something is caught on a plank."];
    }
    if (stage >= STAGE_WALL_INSPECTED) {
      return [...history, "", "The scratches on the wall lead away in a trail of strange puddles."];
    }
    if (stage >= STAGE_HOUSE_SEARCH) {
      return [...history, "", "Their parents let me search the house; I should look at the wall outside."];
    }
    if (stage >= STAGE_ASKED_AROUND) {
      return [...history, "", "I should speak to <col=800000>Aemilia</col> and <col=800000>Francis</col>, the missing boys' parents."];
    }
    if (stage >= STAGE_STARTED) {
      return [...history, "", "I should ask the townsfolk what they know about the disappearances."];
    }
    return [
      "I can start this quest by reading the <col=800000>Notice Board</col>",
      "in the Auburn Pub in Auburnvale.",
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.SLAYER, 10000);
    skills.addExperiences(Skill.HUNTER, 4000);
    skills.addExperiences(Skill.FISHING, 3000);
    skills.addExperiences(Skill.CONSTRUCTION, 3000);
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  api.persistAttribute(FLAGS_ATTRIBUTE);
  api.persistAttribute(BOWS_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "shadows_of_custodia",
    name: "Shadows of Custodia",
    varpId: VARP_SHADOWS_OF_CUSTODIA,
    varbitId: STAGE_VARBIT,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.SLAYER.getIndex(), amount: 10000, label: "Slayer" },
      { skillId: Skill.HUNTER.getIndex(), amount: 4000, label: "Hunter" },
      { skillId: Skill.FISHING.getIndex(), amount: 3000, label: "Fishing" },
      { skillId: Skill.CONSTRUCTION.getIndex(), amount: 3000, label: "Construction" },
    ],
    otherRewards: ["Access to the Stalker Den dungeon, home of the custodian stalkers"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:condition", handleConditionChosen);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onNpcInteraction("Antos", { "Talk-to": handleAntosTalk });
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject);
  api.onItemDropPolicy(handleItemDropPolicy);
  api.onNpcDeath(handleNpcDeath);
  api.onZoneEnter(DEN_ZONE, handleDenZoneEnter);
  api.onZoneEnter(UPSTAIRS_ZONE, handleUpstairsZoneEnter);
  api.onPlayerLogin(handleLogin);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
  api.onPlayerLogout(handleLogout);
};
