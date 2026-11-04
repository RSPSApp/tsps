/**
 * Enlightened Journey (members).
 *
 * The words come from the "Enlightened Journey" transcript page; the post-quest
 * chatter uses the "Auguste" page. This plugin supplies the variant selector for
 * Auguste (all four cache ids), the prose-condition answers, the material hand-in
 * side effects, the origami balloon crafts, the sand pit/basket frame work and the
 * first flight, played at the balloon controls (BalloonTransport's Controls unit, the
 * "taverley" route), with the transcript's crash sites.
 *
 * The stage numbers below are durable plugin stages. nativeProgress maps them to
 * the native cache phases; see docs/quests/native-quest-state-a.md.
 *
 * Stages (varbit 2866 "zep_quest", varp 912 bits 0-7 - see below): 1 accepted,
 * 2 first experiment done (origami balloon handed over), 3 second experiment done
 * (two papyrus and a sack of potatoes taken), 4 Auguste's sapling handed over
 * (gathering the real balloon materials), 5 basket built on the frame, 6 Auguste
 * assembled the balloon (ready to fly), 7 landed in Taverley, 8 complete.
 *
 * Varbit evidence: `lookup-gameval varbit zep` -> "2866 zep_quest varp=912
 * bits=0-7"; client script 4024 (the quest-journal varp map) case 42 returns
 * GET_VARBIT 2866, and RuneLite's Quest.java lists ENLIGHTENED_JOURNEY(42) while
 * QuestVarbits maps it to ZEP_QUEST. The stub's varp 7921 was a placeholder. The
 * sibling bits of varp 912 (zep_multi_basket 2867, zep_multi_piccard 2868) drive
 * the Entrana basket/balloon locs and the Taverley Auguste/Stan multi-NPC; this
 * plugin mirrors them at the beats the objects change.
 *
 * Rewards per the OSRS Wiki: 1 Quest point, 2,000 Crafting, 3,000 Farming,
 * 1,500 Woodcutting and 4,000 Firemaking XP, the bomber jacket and cap, and the
 * balloon transport system. (The issue text said 2 QP; the Wiki says 1.)
 *
 * The flight: choosing a "fly" option takes the 10 logs (from the inventory or log
 * storage, as chosen) and flies the balloon controls' three screens. A landing on
 * Taverley's target moves the quest to stage 7. A bail over Entrana lands there; a
 * crash loses the logs and keeps the balloon (stage 6, Wiki): on Entrana from the first
 * screen, at sea from the second (Auguste's lines, then the plank swims the player to
 * Entrana) and in the woods from the third (the dirt leads out east of Falador). A
 * logout at the controls loses the logs.
 *
 * Gaps/approximations:
 * - No recording of the quest flight exists: the Taverley screens are transcribed from
 *   the Wiki's Balloon path images, and the crash sites' tiles are calibrated.
 * - The "balloon construction diagram" open_interface has no cache interface; the
 *   step is owned silently and the surrounding dialogue explains the design.
 * - The post-quest balloon transport interface (Auguste's "Do you want to use
 *   the balloon?") is not implemented; only the Taverley->Entrana return leg in
 *   the completion chat teleports.
 * - Auguste's sapling uses this plugin's own growth clock (4h, then 6 branches
 *   per 30min; the agent:advance-time event moves it) rather than the Farming
 *   plugin, which only knows the standard willow seed crops.
 * - Cutscenes (the burning experiments, Moe's flash mob) are words only; no
 *   NPCs are spawned or animated.
 * - Item noted-form checks use the noted item ids; the "bomber jacket or cap has
 *   been lost" reclaim option is hidden (not implemented).
 *
 * Source: https://oldschool.runescape.wiki/w/Enlightened_Journey (requirements,
 * rewards, walkthrough) and its transcript.
 */
module.exports = function registerEnlightenedJourneyQuest(api) {
  const {
    Equipment,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectDefinition,
    ObjectIdentifiers,
    Location,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, QUEST_POINTS_ATTRIBUTE } =
    require("../QuestRuntime");

  const PAGE = "Enlightened Journey";
  const AUGUSTE_PAGE = "Auguste";
  const START_HOOK = "quest:enlightened-journey:start";

  // registerQuest writes varpId only when varbitId is unset; the stage lives in
  // the varbit so the other zep_* bits in varp 912 survive.
  const VARP_ENLIGHTENED_JOURNEY = 912;
  const VARBIT_ZEP_QUEST = 2866;
  const VARBIT_ZEP_MULTI_BASKET = 2867; // 0 frame, 1 basket, 2 balloon (Entrana locs)
  const VARBIT_ZEP_MULTI_PICCARD = 2868; // 1 Auguste, 2 Assistant Stan (Taverley multi)

  const STAGE_STARTED = 1;
  const STAGE_FIRST_EXPERIMENT = 2;
  const STAGE_SECOND_EXPERIMENT = 3;
  const STAGE_MATERIALS = 4;
  const STAGE_BASKET_BUILT = 5;
  const STAGE_BALLOON_READY = 6;
  const STAGE_LANDED = 7;
  const STAGE_COMPLETE = 8;

  const AUGUSTE_NPC_IDS = new Set([
    NpcIdentifiers.AUGUSTE, // 4715, Entrana
    NpcIdentifiers.AUGUSTE_2, // 4716, cutscene
    NpcIdentifiers.AUGUSTE_3, // 4717, crash site
    NpcIdentifiers.AUGUSTE_4, // 4718, crash landing
  ]);

  const PAPYRUS = ItemIdentifiers.PAPYRUS;
  const PAPYRUS_NOTED = ItemIdentifiers.PAPYRUS_2;
  const BALL_OF_WOOL = ItemIdentifiers.BALL_OF_WOOL;
  const BALL_OF_WOOL_NOTED = ItemIdentifiers.BALL_OF_WOOL_2;
  const POTATOES = ItemIdentifiers.POTATOES_10_; // sack of potatoes
  const POTATOES_NOTED = ItemIdentifiers.POTATOES_10__2;
  const CANDLE = ItemIdentifiers.CANDLE; // unlit
  const CANDLE_NOTED = ItemIdentifiers.CANDLE_2;
  const BLACK_CANDLE = ItemIdentifiers.BLACK_CANDLE;
  const RED_DYE = ItemIdentifiers.RED_DYE;
  const YELLOW_DYE = ItemIdentifiers.YELLOW_DYE;
  const SANDBAG = ItemIdentifiers.SANDBAG;
  const SILK = ItemIdentifiers.SILK;
  const SILK_NOTED = ItemIdentifiers.SILK_2;
  const BOWL = ItemIdentifiers.BOWL;
  const BOWL_NOTED = ItemIdentifiers.BOWL_2;
  const UNFIRED_BOWL_ITEM = ItemIdentifiers.UNFIRED_BOWL;
  const BALLOON_STRUCTURE = ItemIdentifiers.BALLOON_STRUCTURE;
  const ORIGAMI_BALLOON = ItemIdentifiers.ORIGAMI_BALLOON;
  const DYED_BALLOON_IDS = new Set([
    ItemIdentifiers.YELLOW_BALLOON,
    ItemIdentifiers.BLUE_BALLOON,
    ItemIdentifiers.RED_BALLOON,
    ItemIdentifiers.ORANGE_BALLOON,
    ItemIdentifiers.GREEN_BALLOON,
    ItemIdentifiers.PURPLE_BALLOON,
    ItemIdentifiers.PINK_BALLOON,
    ItemIdentifiers.BLACK_BALLOON,
  ]);
  const AUGUSTES_SAPLING = ItemIdentifiers.AUGUSTES_SAPLING;
  const APPLES = ItemIdentifiers.APPLES_5_; // "Apples(5)", the basket of apples
  const WILLOW_BRANCH = ItemIdentifiers.WILLOW_BRANCH;
  const SECATEURS = ItemIdentifiers.SECATEURS;
  const LOGS = ItemIdentifiers.LOGS;
  const TINDERBOX = ItemIdentifiers.TINDERBOX;
  const COINS = ItemIdentifiers.COINS;
  const EMPTY_SACK = ItemIdentifiers.EMPTY_SACK;
  const BOMBER_JACKET = ItemIdentifiers.BOMBER_JACKET;
  const BOMBER_CAP = ItemIdentifiers.BOMBER_CAP;

  // The Entrana basket is a multi-loc: 19133 transforms on varbit 2867 to the
  // metal frame (19132) / basket (19128). Item-on-object sees the map loc id.
  const BASKET_FRAME_OBJECT_IDS = new Set([
    ObjectIdentifiers.BASKET_7, // 19132 metal frame child
    19133, // zep_multi_basket_entrana (no generated identifier)
  ]);
  const SAND_PIT_OBJECT_IDS = new Set([
    ObjectIdentifiers.SAND_PIT, // 36563 Yanille
    ObjectIdentifiers.SAND_PIT_2, // 14890 Entrana
    ObjectIdentifiers.SAND_PIT_3, // 37391
    ObjectIdentifiers.SAND_PIT_4, // 37392
    ObjectIdentifiers.SAND_PIT_5, // 50733 Zanaris
  ]);

  const FLAGS_ATTRIBUTE = "quest.enlightened_journey.flags";
  const SAPLING_ATTRIBUTE = "quest.enlightened_journey.sapling";
  /** Set once Auguste has flown the player back to Entrana: Assistant Stan keeps Taverley's balloon. */
  const STAN_ATTRIBUTE = "quest.enlightened_journey.taverley_stan";
  const BIT_RED_DYE = 1 << 0;
  const BIT_YELLOW_DYE = 1 << 1;
  const BIT_SANDBAGS = 1 << 2;
  const BIT_SILK = 1 << 3;
  const BIT_BOWL = 1 << 4;
  const BIT_SAPLING_GIVEN = 1 << 5;

  const WILLOW_GROWTH_MS = 4 * 60 * 60 * 1000; // wiki: a willow tree takes 4h
  const BRANCH_REGROW_MS = 30 * 60 * 1000; // then branches every 30min, 6 at a time
  const SAPLING_REPLACEMENT_COST = 30000;

  // Requirement levels (OSRS Wiki; all boostable, checked at the current level).
  const QUEST_POINT_REQUIREMENT = 20;
  const FIREMAKING_REQUIREMENT = 20;
  const FARMING_REQUIREMENT = 30;
  const CRAFTING_REQUIREMENT = 36;

  const TEST_PAPYRUS = 3;
  const EXPERIMENT_TWO_PAPYRUS = 2;
  const REQUIRED_SANDBAGS = 8;
  const REQUIRED_SILK = 10;
  const REQUIRED_BRANCHES = 12;
  const BRANCHES_PER_CUT = 6;
  const FLIGHT_LOGS = 10;
  const MAX_FLIGHT_WEIGHT = 40; // kg (Wiki)
  const GRAMS_PER_KG = 1000;
  const PICCARD_AUGUSTE = 1; // zep_multi_piccard: Auguste at Taverley
  const PICCARD_STAN = 2; // zep_multi_piccard: Assistant Stan at Taverley

  const TAVERLEY_LANDING = new Location(2938, 3421, 0);
  const ENTRANA_ARRIVAL = new Location(2808, 3354, 0);
  /** Where the woods crash site's dirt comes out (the balloon routes' "falador" crash site). */
  const FALADOR_EAST = new Location(3058, 3374, 0);
  /** The balloon controls' route the quest flies (plugins/world/data/balloon-routes.json). */
  const FLIGHT_STATION = "taverley";
  /** Past Entrana a crash comes down at sea (screen 2) or in the woods (screen 3), with Auguste. */
  const FAILING = "getting-ready-for-first-flight-failing-on-the";
  const CRASH_SCENES = {
    ocean: { npcId: NpcIdentifiers.AUGUSTE_3, variant: `${FAILING}-second-stage` },
    woods: { npcId: NpcIdentifiers.AUGUSTE_4, variant: `${FAILING}-final-stage` },
  };
  const PLANK = ObjectIdentifiers.PLANK_13; // zep_plank, the sea crash site's way out
  const CRASH_SITE_EXIT = ObjectIdentifiers.DIRT; // zep_dirt_exit, the woods crash site's
  const TAVERLEY_RADIUS = 20;

  const CONTRABAND_SLOTS = [
    Equipment.HEAD_SLOT,
    Equipment.WEAPON_SLOT,
    Equipment.BODY_SLOT,
    Equipment.SHIELD_SLOT,
    Equipment.LEG_SLOT,
  ];

  let quest;

  // --------------------------------------------------------------------------
  // Small helpers
  // --------------------------------------------------------------------------

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;

  function flags(player) {
    return Number(player.getAttribute(FLAGS_ATTRIBUTE)) || 0;
  }

  function hasFlag(player, bit) {
    return (flags(player) & bit) !== 0;
  }

  function setFlag(player, bit) {
    player.setAttribute(FLAGS_ATTRIBUTE, flags(player) | bit);
  }

  function hasUnlitCandle(player) {
    return held(player, CANDLE) || held(player, BLACK_CANDLE);
  }

  function meetsRequirements(player) {
    const skills = player.getSkillManager();
    return (
      (Number(player.getAttribute(QUEST_POINTS_ATTRIBUTE)) || 0) >= QUEST_POINT_REQUIREMENT &&
      skills.getCurrentLevel(Skill.FIREMAKING) >= FIREMAKING_REQUIREMENT &&
      skills.getCurrentLevel(Skill.FARMING) >= FARMING_REQUIREMENT &&
      skills.getCurrentLevel(Skill.CRAFTING) >= CRAFTING_REQUIREMENT
    );
  }

  function hasTestMaterials(player) {
    return (
      held(player, POTATOES) &&
      hasUnlitCandle(player) &&
      held(player, BALL_OF_WOOL) &&
      held(player, PAPYRUS, TEST_PAPYRUS)
    );
  }

  function hasNotedTestMaterials(player) {
    return (
      held(player, POTATOES_NOTED) &&
      held(player, CANDLE_NOTED) &&
      held(player, BALL_OF_WOOL_NOTED) &&
      held(player, PAPYRUS_NOTED, TEST_PAPYRUS)
    );
  }

  function saplingRecord(player) {
    return player.getAttribute(SAPLING_ATTRIBUTE) || null;
  }

  function hasFollower(player) {
    const world = api.getWorld();
    if (!world?.getNpcs) return false;
    for (const npc of world.getNpcs()) {
      if (npc?.isPet?.() === true && npc.getOwner?.() === player) return true;
    }
    return false;
  }

  /**
   * Inventory + worn weight in kg, as the equipment stats tab adds it up: the cache's weights are
   * grams, and a stack counts once.
   */
  function carriedWeight(player) {
    let grams = 0;
    for (const item of [
      ...player.getInventory().getItems(),
      ...player.getEquipment().getItems(),
    ]) {
      if (item?.getId?.() > 0 && (item.getAmount?.() ?? 0) > 0) {
        grams += Number(item.getDefinition().getWeight()) || 0;
      }
    }
    return grams / GRAMS_PER_KG;
  }

  function hasContraband(player) {
    const equipment = player.getEquipment();
    return CONTRABAND_SLOTS.some((slot) => (equipment.get(slot)?.getId?.() ?? -1) > 0);
  }

  function nearTaverley(player) {
    const location = player.getLocation();
    return (
      location.getZ() === TAVERLEY_LANDING.getZ() &&
      Math.max(
        Math.abs(location.getX() - TAVERLEY_LANDING.getX()),
        Math.abs(location.getY() - TAVERLEY_LANDING.getY())
      ) <= TAVERLEY_RADIUS
    );
  }

  function allMaterialsHanded(player) {
    const value = flags(player);
    const dyes = (BIT_RED_DYE | BIT_YELLOW_DYE) & value;
    return (
      dyes === (BIT_RED_DYE | BIT_YELLOW_DYE) &&
      (value & (BIT_SANDBAGS | BIT_SILK | BIT_BOWL)) === (BIT_SANDBAGS | BIT_SILK | BIT_BOWL)
    );
  }

  // --------------------------------------------------------------------------
  // Transcript selection and prose conditions
  // --------------------------------------------------------------------------

  /** Which transcript variant Auguste plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    if (!AUGUSTE_NPC_IDS.has(npcId)) return null;
    // Auguste at a crash site talks about the crash, never a flight from there.
    const scene = Object.values(CRASH_SCENES).find((entry) => entry.npcId === npcId);
    if (scene) return { page: PAGE, variant: scene.variant };
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return nearTaverley(player)
        ? {
            page: PAGE,
            variant:
              "landing-in-taverley-talking-to-auguste-again-before-he-is-replaced-with-assistant-stan",
          }
        : { page: AUGUSTE_PAGE, variant: "subsequent-dialogues-after-enlightened-journey" };
    }
    if (stage >= STAGE_LANDED) {
      return { page: PAGE, variant: "landing-in-taverley-talking-to-auguste" };
    }
    if (stage >= STAGE_BALLOON_READY) {
      return { page: PAGE, variant: "getting-ready-for-first-flight" };
    }
    if (stage >= STAGE_BASKET_BUILT) {
      return { page: PAGE, variant: "making-the-basket-frame" };
    }
    if (stage >= STAGE_MATERIALS) {
      if (allMaterialsHanded(player)) {
        return {
          page: PAGE,
          variant: saplingRecord(player)
            ? "preparing-for-the-expedition-talking-to-him-after-planting-his-sapling-and-handing-in-all-the-ingredients"
            : "preparing-for-the-expedition-talking-to-him-before-planting-his-sapling-but-after-delivering-all-the-required-materials",
        };
      }
      return {
        page: PAGE,
        variant: saplingRecord(player)
          ? "preparing-for-the-expedition-talking-to-him-after-planting-his-sapling"
          : "preparing-for-the-expedition",
      };
    }
    if (stage >= STAGE_SECOND_EXPERIMENT) {
      return { page: PAGE, variant: "talking-to-him-after-the-second-experiment" };
    }
    if (stage >= STAGE_FIRST_EXPERIMENT) {
      return { page: PAGE, variant: "second-experiment" };
    }
    if (stage < STAGE_STARTED) {
      // The requirements condition (c0LchB) lives in this variant and refuses
      // the start for anyone who misses them.
      return { page: PAGE, variant: "starting-off" };
    }
    // Stage 1: the explanation until the player carries something, then the
    // material check tree; a crafted test balloon jumps straight to the hand-in.
    for (const dyed of DYED_BALLOON_IDS) {
      if (held(player, dyed)) {
        return { page: PAGE, variant: "making-the-origami-balloon-giving-auguste-a-dyed-origami-balloon" };
      }
    }
    if (held(player, ORIGAMI_BALLOON)) {
      return { page: PAGE, variant: "showing-auguste-the-finished-origami-balloon" };
    }
    if (held(player, BALLOON_STRUCTURE)) {
      return {
        page: PAGE,
        variant: hasUnlitCandle(player)
          ? "returning-to-auguste-talking-to-auguste-with-the-required-materials-before-making-an-origami-balloon"
          : "returning-to-auguste-talking-to-auguste-after-losing-the-required-materials-before-finishing-origami-balloon",
      };
    }
    if (
      held(player, POTATOES) ||
      hasUnlitCandle(player) ||
      held(player, BALL_OF_WOOL) ||
      held(player, PAPYRUS)
    ) {
      return { page: PAGE, variant: "returning-to-auguste" };
    }
    return { page: PAGE, variant: "talking-to-auguste-a-second-time" };
  }

  /**
   * The "all the materials are finally handed in" prose runs during flatten, before
   * the branch's hand-in side effect, so it reads the flags plus the hand-in being
   * offered now (both dyes / yellow / red / sandbags / silk / bowl branch).
   */
  function handedAfter(value, offering) {
    const red = (value & BIT_RED_DYE) !== 0 || offering === "red" || offering === "both";
    const yellow = (value & BIT_YELLOW_DYE) !== 0 || offering === "yellow" || offering === "both";
    const sandbags = (value & BIT_SANDBAGS) !== 0 || offering === "sandbags";
    const silk = (value & BIT_SILK) !== 0 || offering === "silk";
    const bowl = (value & BIT_BOWL) !== 0 || offering === "bowl";
    return { red, yellow, sandbags, silk, bowl };
  }

  function allHanded(value, offering) {
    const state = handedAfter(value, offering);
    return state.red && state.yellow && state.sandbags && state.silk && state.bowl;
  }

  /**
   * The "returning-to-auguste" material check is one linear run of wiki action
   * steps, not a condition chain, so only the first (z6RQyn, "none of the
   * materials") would ever play. These predicates pick the branch the player's
   * inventory matches and handleLine rewrites the first line to its words; the
   * second line is skipped. Order and text are the dump's.
   */
  const MATERIAL_CHECK_FIRST_LINE = "You don't seem to have any of the materials.";
  const MATERIAL_CHECK_SECOND_LINE =
    "You need a ball of wool, three sheets of papyrus, an unlit candle, and a full sack of potatoes.";
  const MATERIAL_CHECK_STEP_IDS = new Set([
    "z6RQyn",
    "-UmZ63",
    "5cwqWQ",
    "a2qEIY",
    "bgfFnU",
    "ttK5jE",
    "JZix1q",
    "pZQt5d",
    "jiG0jf",
    "bX_rGF",
    "wAEHdD",
    "IWdusE",
    "g2Pkk7",
    "vzelP9",
    "uXESbf",
    "jB3Ip-",
    "FREc6N",
    "t8v67i",
  ]);
  const materialCheck = new WeakMap(); // player -> the matching branch's line, or null for "none"

  function materialCheckLine(player) {
    const potatoes = held(player, POTATOES);
    const candle = hasUnlitCandle(player);
    const wool = held(player, BALL_OF_WOOL);
    const papyrus = player.getInventory().getAmount(PAPYRUS);
    const three = papyrus >= 3;
    const oneOrTwo = papyrus >= 1 && papyrus <= 2;
    const low = papyrus <= 2;
    if (!potatoes && !candle && !wool && papyrus === 0) return null; // z6RQyn itself
    if (potatoes && candle && wool && low) return "You need more papyrus."; // -UmZ63
    if (potatoes && candle && three && !wool) return "You need a ball of wool."; // 5cwqWQ
    if (potatoes && candle && low && !wool) return "You need more papyrus and a ball of wool."; // a2qEIY
    if (potatoes && three && wool && !candle) return "You need an unlit candle."; // bgfFnU
    if (potatoes && oneOrTwo && wool && !candle) return "You need papyrus and an unlit candle."; // ttK5jE -> GIKiks
    if (candle && three && wool && !potatoes) return "You need a full sack of potatoes."; // JZix1q -> sNnyeN
    if (candle && oneOrTwo && wool && !potatoes) {
      return "You need more papyrus and a full sack of potatoes."; // pZQt5d -> occzct
    }
    if (potatoes && three && !candle && !wool) return "You need a ball of wool and an unlit candle."; // jiG0jf
    if (potatoes && wool && !candle && low) return "You need papyrus and an unlit candle."; // bX_rGF -> GIKiks
    if (candle && three && !potatoes && !wool) {
      return "You need a ball of wool and a full sack of potatoes."; // wAEHdD
    }
    if (candle && wool && !potatoes && low) {
      return "You need more papyrus and a full sack of potatoes."; // IWdusE -> occzct
    }
    if (wool && !potatoes && !candle && low) {
      return "You need more papyrus, a full sack of potatoes, and an unlit candle."; // g2Pkk7 -> k3Az9D
    }
    if (three && wool && !potatoes && !candle) {
      return "You need an unlit candle and a full sack of potatoes."; // vzelP9
    }
    if (potatoes && !candle && !wool && low) {
      return "You need a ball of wool, an unlit candle, and papyrus."; // uXESbf
    }
    if (candle && !potatoes && !wool && low) {
      return "You need a ball of wool, papyrus, and a full sack of potatoes."; // jB3Ip-
    }
    if (!potatoes && !candle && !wool && oneOrTwo) {
      return "You need more papyrus, a full sack of potatoes, and an unlit candle."; // FREc6N -> k3Az9D
    }
    return "You need a ball of wool, an unlit candle, and a full sack of potatoes."; // t8v67i
  }

  /** Swap the "none of the materials" line for the branch the inventory matches. */
  function handleLine(event) {
    const { player } = event;
    if (!AUGUSTE_NPC_IDS.has(event.npcId) || !materialCheck.has(player)) return;
    if (event.text === MATERIAL_CHECK_FIRST_LINE) {
      const replacement = materialCheck.get(player);
      if (replacement) {
        event.text = replacement;
        return; // keep the marker so the second line is dropped
      }
      materialCheck.delete(player); // "none" case: both original lines are correct
      return;
    }
    if (event.text === MATERIAL_CHECK_SECOND_LINE) {
      if (materialCheck.get(player)) event.skip = true;
      materialCheck.delete(player);
    }
  }

  /** Answer the wiki's prose conditions for the Enlightened Journey page. */
  function answerCondition({ npcId, player, stepId, text }) {
    if (!AUGUSTE_NPC_IDS.has(npcId)) return null;
    const inventory = player.getInventory();
    const value = flags(player);
    switch (stepId) {
      case "c0LchB": // without the requirements
        return !meetsRequirements(player);
      case "rCPuDJ": // has all the test materials
        return hasTestMaterials(player);
      case "8VDUe9": // has them in noted form
        return hasNotedTestMaterials(player);
      case "HqA8Gq": // second experiment: two papyrus and a sack of potatoes
        return held(player, POTATOES) && held(player, PAPYRUS, EXPERIMENT_TWO_PAPYRUS);
      case "y8uuFQ":
        return !held(player, POTATOES) && !held(player, PAPYRUS, EXPERIMENT_TWO_PAPYRUS);
      case "NbTsCS":
        return !held(player, POTATOES);
      case "YB6Lup":
        return !held(player, PAPYRUS, EXPERIMENT_TWO_PAPYRUS);
      case "gxuWQU": // sapling + basket of apples handout
        return !hasFlag(player, BIT_SAPLING_GIVEN) && inventory.getFreeSlots() >= 2;
      case "j8tHw1":
        return !hasFlag(player, BIT_SAPLING_GIVEN) && inventory.getFreeSlots() < 2;
      case "2_FjSs":
        return held(player, RED_DYE) && held(player, YELLOW_DYE);
      case "ONkEG7":
        return held(player, YELLOW_DYE) && !held(player, RED_DYE);
      case "tLaQYR":
        return held(player, RED_DYE) && !held(player, YELLOW_DYE);
      case "nP0BFo":
        return (
          !held(player, RED_DYE) &&
          !held(player, YELLOW_DYE) &&
          (value & (BIT_RED_DYE | BIT_YELLOW_DYE)) === 0
        );
      case "jNUi7l":
        return !held(player, RED_DYE) && (value & BIT_YELLOW_DYE) !== 0;
      case "tV-rCx":
        return !held(player, YELLOW_DYE) && (value & BIT_RED_DYE) !== 0;
      case "PVHUCg": // only-yellow branch: red not handed in yet
        return (value & BIT_RED_DYE) === 0;
      case "OGBDtg": // only-red branch: yellow not handed in yet
        return (value & BIT_YELLOW_DYE) === 0;
      case "KCORxa":
        return allHanded(value, "both");
      case "ltShnW":
        return !allHanded(value, "both");
      case "z-fS6X":
        return allHanded(value, "yellow");
      case "Qt5SsF":
        return !allHanded(value, "yellow");
      case "xtOk6w":
        return allHanded(value, "red");
      case "UZueD-":
        return !allHanded(value, "red");
      case "KNd89K":
        return held(player, SANDBAG, REQUIRED_SANDBAGS);
      case "ty-ocK":
        return allHanded(value, "sandbags");
      case "ID2g2e":
        return !allHanded(value, "sandbags");
      case "UITbMi":
        return !held(player, SANDBAG, REQUIRED_SANDBAGS);
      case "2WwGtt":
        return held(player, SILK_NOTED, REQUIRED_SILK);
      case "Ce6dky":
        return held(player, SILK, REQUIRED_SILK);
      case "mkBxOa":
        return allHanded(value, "silk");
      case "jn7GNV":
        return !allHanded(value, "silk");
      case "IjQl8E":
        return !held(player, SILK, REQUIRED_SILK);
      case "80uM5R":
        return held(player, BOWL_NOTED);
      case "9EWfX7":
        return held(player, UNFIRED_BOWL_ITEM);
      case "sf6qdG":
        return held(player, BOWL);
      case "ILKLjD":
        return allHanded(value, "bowl");
      case "tvIsTj":
        return !allHanded(value, "bowl");
      case "_jqWMv":
        return !held(player, BOWL);
      case "j60R6_":
        return held(player, AUGUSTES_SAPLING);
      case "kuyqhV":
        return player.getBanks().some((bank) => bank?.contains?.(AUGUSTES_SAPLING));
      case "KYWowe":
        return !held(player, AUGUSTES_SAPLING) &&
          !player.getBanks().some((bank) => bank?.contains?.(AUGUSTES_SAPLING)) &&
          !held(player, COINS, SAPLING_REPLACEMENT_COST);
      case "SDC5qf":
        return !held(player, AUGUSTES_SAPLING) &&
          !player.getBanks().some((bank) => bank?.contains?.(AUGUSTES_SAPLING)) &&
          held(player, COINS, SAPLING_REPLACEMENT_COST) &&
          inventory.getFreeSlots() < 1;
      case "m-HkIL":
        return !held(player, AUGUSTES_SAPLING) &&
          !player.getBanks().some((bank) => bank?.contains?.(AUGUSTES_SAPLING)) &&
          held(player, COINS, SAPLING_REPLACEMENT_COST) &&
          inventory.getFreeSlots() >= 1;
      case "eett8T":
        return hasFollower(player);
      case "G1OzvY":
        return carriedWeight(player) > MAX_FLIGHT_WEIGHT;
      case "pgRm3-":
        return held(player, LOGS, FLIGHT_LOGS) && held(player, TINDERBOX);
      case "z2wZOR":
        return !held(player, TINDERBOX);
      case "Kjqrcm":
        return !held(player, LOGS, FLIGHT_LOGS);
      case "2DszCS":
        return inventory.getFreeSlots() >= 2;
      case "M-nwQB":
        return inventory.getFreeSlots() < 2;
      case "y5hUFB":
        return hasContraband(player);
      case "r4ZOdj":
        return !hasContraband(player);
      default:
        break;
    }
    // Option-level conditions carry no step id; match their wiki prose.
    const prose = String(text ?? "").toLowerCase();
    if (prose.includes("does not have all of the required materials")) {
      return !hasTestMaterials(player);
    }
    if (prose.includes("has not handed in both dyes")) {
      return !(value & BIT_RED_DYE) || !(value & BIT_YELLOW_DYE);
    }
    if (prose.includes("has not handed in 8 sandbags")) {
      return (value & BIT_SANDBAGS) === 0;
    }
    if (prose.includes("has not handed in 10 silk")) {
      return (value & BIT_SILK) === 0;
    }
    if (prose.includes("has not handed in a bowl")) {
      return (value & BIT_BOWL) === 0;
    }
    if (prose.includes("hasn't been planted") || prose.includes("has not been planted")) {
      return !saplingRecord(player);
    }
    if (prose.includes("bomber jacket or cap has been lost")) {
      return false; // reclaim dialogue is not implemented
    }
    return null;
  }

  // --------------------------------------------------------------------------
  // Dialogue side effects
  // --------------------------------------------------------------------------

  function handleStartHook({ player, npcId, hook }) {
    if (!AUGUSTE_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) !== 0 || !meetsRequirements(player)) return;
    // A started-from-scratch run after ::quest reset must not inherit the old
    // hand-ins or a planted sapling from a previous playthrough.
    player.setAttribute(FLAGS_ATTRIBUTE, 0);
    player.setAttribute(SAPLING_ATTRIBUTE, null);
    quest.setStage(player, STAGE_STARTED);
  }

  /** The chosen condition branch's hand-in side effects. */
  function handleCondition(event) {
    const { player, npcId, stepId } = event;
    if (!AUGUSTE_NPC_IDS.has(npcId)) return;
    switch (stepId) {
      case "2_FjSs":
        player.getInventory().deleteNumber(RED_DYE, 1);
        player.getInventory().deleteNumber(YELLOW_DYE, 1);
        setFlag(player, BIT_RED_DYE | BIT_YELLOW_DYE);
        return;
      case "ONkEG7":
        player.getInventory().deleteNumber(YELLOW_DYE, 1);
        setFlag(player, BIT_YELLOW_DYE);
        return;
      case "tLaQYR":
        player.getInventory().deleteNumber(RED_DYE, 1);
        setFlag(player, BIT_RED_DYE);
        return;
      case "KNd89K":
        if (!held(player, SANDBAG, REQUIRED_SANDBAGS)) return;
        player.getInventory().deleteNumber(SANDBAG, REQUIRED_SANDBAGS);
        setFlag(player, BIT_SANDBAGS);
        return;
      case "Ce6dky":
        if (!held(player, SILK, REQUIRED_SILK)) return;
        player.getInventory().deleteNumber(SILK, REQUIRED_SILK);
        setFlag(player, BIT_SILK);
        return;
      case "sf6qdG":
        if (!held(player, BOWL)) return;
        player.getInventory().deleteNumber(BOWL, 1);
        setFlag(player, BIT_BOWL);
        return;
      case "HqA8Gq": // second experiment takes two papyrus and the potatoes
        if (!held(player, POTATOES) || !held(player, PAPYRUS, EXPERIMENT_TWO_PAPYRUS)) return;
        player.getInventory().deleteNumber(PAPYRUS, EXPERIMENT_TWO_PAPYRUS);
        player.getInventory().deleteNumber(POTATOES, 1);
        if (quest.getStage(player) < STAGE_SECOND_EXPERIMENT) {
          quest.setStage(player, STAGE_SECOND_EXPERIMENT);
        }
        return;
      case "gxuWQU": // sapling and basket of apples handout
        if (hasFlag(player, BIT_SAPLING_GIVEN) || player.getInventory().getFreeSlots() < 2) return;
        player.getInventory().adds(AUGUSTES_SAPLING, 1);
        player.getInventory().adds(APPLES, 1);
        setFlag(player, BIT_SAPLING_GIVEN);
        if (quest.getStage(player) < STAGE_MATERIALS) {
          quest.setStage(player, STAGE_MATERIALS);
        }
        return;
      case "m-HkIL": // 30,000gp sapling replacement
        if (!held(player, COINS, SAPLING_REPLACEMENT_COST)) return;
        player.getInventory().deleteNumber(COINS, SAPLING_REPLACEMENT_COST);
        player.getInventory().adds(AUGUSTES_SAPLING, 1);
        return;
      default:
        return;
    }
  }

  /** The ten logs onto Auguste's fire, from `source`: the balloon controls fly to Taverley. */
  function startFlight(player, source) {
    if (quest.getStage(player) !== STAGE_BALLOON_READY) return;
    if (!held(player, LOGS, FLIGHT_LOGS) || !held(player, TINDERBOX)) return;
    api.emitCustomEvent("balloon-transport:quest-flight", { player, station: FLIGHT_STATION, logs: FLIGHT_LOGS, source });
  }

  /** Landed on Taverley's target: Auguste is there, and the quest moves on. */
  function flightLanded({ player, station }) {
    if (station !== FLIGHT_STATION || quest.getStage(player) !== STAGE_BALLOON_READY) return;
    player.getPacketSender().sendVarbit(VARBIT_ZEP_MULTI_PICCARD, PICCARD_AUGUSTE);
    quest.setStage(player, STAGE_LANDED);
  }

  /** Crashed past Entrana: Auguste's words at the sea or woods crash site (the transcript). */
  function flightCrashed({ player, station, site }) {
    if (station !== FLIGHT_STATION || quest.getStage(player) !== STAGE_BALLOON_READY) return;
    const scene = CRASH_SCENES[site];
    if (scene) startTranscript(api, player, scene.npcId, PAGE, scene.variant);
  }

  /** The plank at the sea crash site swims the player back to Entrana. */
  function usePlank(event) {
    if (event.objectId !== PLANK) return false;
    startTranscript(api, event.player, NpcIdentifiers.AUGUSTE_3, PAGE, `${CRASH_SCENES.ocean.variant}-using-the-plank-to-return-to-land`);
  }

  /** The dirt at the woods crash site leads out, east of Falador. */
  function leaveCrashSite(event) {
    if (event.objectId !== CRASH_SITE_EXIT) return false;
    startTranscript(api, event.player, NpcIdentifiers.AUGUSTE_4, PAGE, `${CRASH_SCENES.woods.variant}-leaving-the-crash-site`);
  }

  /** Stage directions and messages on the Enlightened Journey page. */
  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (!AUGUSTE_NPC_IDS.has(npcId)) return;
    switch (stepId) {
      case "0rJowj": // open the construction diagram - no such interface here
        event.handled = true;
        return;
      case "JiMggG": // Auguste takes the origami balloon for the first experiment
        event.handled = true;
        player.getInventory().deleteNumber(ORIGAMI_BALLOON, 1);
        if (quest.getStage(player) < STAGE_FIRST_EXPERIMENT) {
          quest.setStage(player, STAGE_FIRST_EXPERIMENT);
        }
        return;
      case "_ZdYV3": // end of cutscene
        event.handled = true;
        return;
      case "MqDt3v": // second experiment cutscene
        event.handled = true;
        if (quest.getStage(player) < STAGE_SECOND_EXPERIMENT) {
          quest.setStage(player, STAGE_SECOND_EXPERIMENT);
        }
        return;
      case "Sk2xez": // Auguste assembles the balloon on the platform
        event.handled = true;
        player.getPacketSender().sendVarbit(VARBIT_ZEP_MULTI_BASKET, 2);
        player.sendMessage("The balloon is constructed and waiting for departure.");
        if (quest.getStage(player) < STAGE_BALLOON_READY) {
          quest.setStage(player, STAGE_BALLOON_READY);
        }
        return;
      case "_G1qps":
      case "XJPKij": // open_interface "Balloon transport flying", logs from the inventory
        event.handled = true;
        event.end = true;
        startFlight(player, "inventory");
        return;
      case "UrzuZs":
      case "RS5ufp": // the same, logs from storage
        event.handled = true;
        event.end = true;
        startFlight(player, "storage");
        return;
      case "vxF1CK":
      case "hBVZFm": // "The balloon crashes." - the controls already said it
        event.handled = true;
        return;
      case "o9tHqW": // fade out to the player climbing back onto land (Entrana, per the Wiki's plank)
        event.handled = true;
        player.moveTo(ENTRANA_ARRIVAL);
        return;
      case "NWvWY2": // fade out to the player outside Falador's eastern wall
        event.handled = true;
        player.moveTo(FALADOR_EAST);
        return;
      case "kV2c6g": // Quest complete!
        event.handled = true;
        event.end = true;
        if (!quest.isComplete(player)) quest.complete(player);
        return;
      case "LQAzz1": // searched before boarding back to Entrana
        event.handled = true;
        player.sendMessage("You are quickly searched.");
        return;
      case "NUo2gd": // post-quest travel back to Entrana
        event.handled = true;
        event.end = true;
        player.moveTo(ENTRANA_ARRIVAL);
        // Auguste bases himself in Entrana from here ("I will base my operations in Entrana");
        // Assistant Stan keeps the Taverley balloon.
        player.setAttribute(STAN_ATTRIBUTE, 1);
        player.getPacketSender().sendVarbit(VARBIT_ZEP_MULTI_PICCARD, PICCARD_STAN);
        return;
      default:
        // The linear "With ..." material-check run: remember the matching branch
        // so handleLine can play its words instead of the first branch's.
        if (MATERIAL_CHECK_STEP_IDS.has(stepId)) {
          materialCheck.set(player, materialCheckLine(player));
        }
        return;
    }
  }

  // --------------------------------------------------------------------------
  // Items, objects and NPCs
  // --------------------------------------------------------------------------

  /** Papyrus on wool makes the structure; an unlit candle finishes the balloon. */
  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = [usedItemId, usedWithItemId];
    if (pair.includes(PAPYRUS) && pair.includes(BALL_OF_WOOL)) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_STARTED) return;
      if (!held(player, PAPYRUS) || !held(player, BALL_OF_WOOL)) return;
      player.getInventory().deleteNumber(PAPYRUS, 1);
      player.getInventory().deleteNumber(BALL_OF_WOOL, 1);
      player.getInventory().adds(BALLOON_STRUCTURE, 1);
      startTranscript(
        api,
        player,
        NpcIdentifiers.AUGUSTE,
        PAGE,
        "making-the-origami-balloon-using-papyrus-on-the-ball-of-wool"
      );
      return;
    }
    if (pair.includes(BALLOON_STRUCTURE) && (pair.includes(CANDLE) || pair.includes(BLACK_CANDLE))) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_STARTED || !held(player, BALLOON_STRUCTURE)) return;
      if (player.getSkillManager().getCurrentLevel(Skill.CRAFTING) < CRAFTING_REQUIREMENT) {
        player.sendMessage(
          `You need a Crafting level of ${CRAFTING_REQUIREMENT} to add the heat source.`
        );
        return;
      }
      const candleId = pair.includes(CANDLE) ? CANDLE : BLACK_CANDLE;
      player.getInventory().deleteNumber(candleId, 1);
      player.getInventory().deleteNumber(BALLOON_STRUCTURE, 1);
      player.getInventory().adds(ORIGAMI_BALLOON, 1);
      startTranscript(
        api,
        player,
        NpcIdentifiers.AUGUSTE,
        PAGE,
        "making-the-origami-balloon-using-the-unlit-candle-on-the-balloon-structure"
      );
    }
  }

  /** Empty sacks into sandbags; sapling onto a patch; secateurs onto the grown tree. */
  function handleItemOnObject(event) {
    const { player, itemId, objectId, location } = event;
    if (itemId === EMPTY_SACK && SAND_PIT_OBJECT_IDS.has(objectId)) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_STARTED) return;
      player.getInventory().deleteNumber(EMPTY_SACK, 1);
      player.getInventory().adds(SANDBAG, 1);
      player.sendMessage("You fill the sack with sand.");
      return;
    }
    if (itemId === AUGUSTES_SAPLING && isTreePatch(event)) {
      event.handled = true;
      if (!hasFlag(player, BIT_SAPLING_GIVEN) || saplingRecord(player)) return;
      if (!held(player, AUGUSTES_SAPLING)) return;
      const now = Date.now();
      player.getInventory().deleteNumber(AUGUSTES_SAPLING, 1);
      player.setAttribute(SAPLING_ATTRIBUTE, {
        x: location.x,
        y: location.y,
        z: location.z,
        plantedAt: now,
        branchesAt: now + WILLOW_GROWTH_MS,
        nextBranchesAt: now + WILLOW_GROWTH_MS,
      });
      startTranscript(api, player, NpcIdentifiers.AUGUSTE, PAGE, "preparing-for-the-expedition-planting-the-sapling");
      return;
    }
    if (itemId === SECATEURS && cutSaplingBranches(player, location)) {
      event.handled = true;
      return;
    }
    if (itemId !== WILLOW_BRANCH || !BASKET_FRAME_OBJECT_IDS.has(objectId)) return;
    if (quest.getStage(player) !== STAGE_MATERIALS || !saplingRecord(player)) return;
    event.handled = true;
    if (!held(player, WILLOW_BRANCH, REQUIRED_BRANCHES)) {
      startTranscript(
        api,
        player,
        NpcIdentifiers.AUGUSTE,
        PAGE,
        "preparing-for-the-expedition-talking-to-him-after-planting-his-sapling-and-handing-in-all-the-ingredients-using-a-willow-branch-on-the-basket-frame-with-less-than-12-of-them"
      );
      return;
    }
    player.getInventory().deleteNumber(WILLOW_BRANCH, REQUIRED_BRANCHES);
    player.getPacketSender().sendVarbit(VARBIT_ZEP_MULTI_BASKET, 1);
    quest.setStage(player, STAGE_BASKET_BUILT);
  }

  /** Secateurs on the planted patch, once the willow has grown. */
  function cutSaplingBranches(player, location) {
    const record = saplingRecord(player);
    if (!record || location.z !== record.z) return false;
    if (Math.max(Math.abs(location.x - record.x), Math.abs(location.y - record.y)) > 1) return false;
    if (!held(player, SECATEURS)) return false;
    const now = Date.now();
    if (now < record.branchesAt) {
      player.sendMessage("The willow tree has not finished growing yet.");
      return true;
    }
    if (now < (record.nextBranchesAt ?? record.branchesAt)) {
      player.sendMessage("There are no branches ready to cut yet.");
      return true;
    }
    const amount = Math.min(BRANCHES_PER_CUT, player.getInventory().getFreeSlots());
    if (amount <= 0) {
      player.sendMessage("You don't have enough inventory space.");
      return true;
    }
    player.getInventory().adds(WILLOW_BRANCH, amount);
    record.nextBranchesAt = now + BRANCH_REGROW_MS;
    player.setAttribute(SAPLING_ATTRIBUTE, record);
    player.sendMessage(`You cut ${amount === 1 ? "a willow branch" : `${amount} willow branches`} from the tree.`);
    return true;
  }

  function isTreePatch(event) {
    const id = event.object?.getId?.() ?? event.objectId;
    const name = ObjectDefinition.forPlayer(id, event.player)?.getName?.() ?? "";
    return name.toLowerCase() === "tree patch";
  }

  /** A willow branch on Auguste points at the frame on the platform. */
  function handleItemOnNpc(event) {
    const { player, npcId, itemId } = event;
    if (!AUGUSTE_NPC_IDS.has(npcId) || itemId !== WILLOW_BRANCH) return;
    if (!allMaterialsHanded(player) || !saplingRecord(player)) return;
    event.handled = true;
    startTranscript(
      api,
      player,
      npcId,
      PAGE,
      "preparing-for-the-expedition-talking-to-him-after-planting-his-sapling-and-handing-in-all-the-ingredients-using-a-willow-branch-on-auguste"
    );
  }

  /** The MCP/agent time-skip moves the sapling's growth clock. */
  function advanceTime(event) {
    const record = event.player ? saplingRecord(event.player) : null;
    if (!record) return;
    record.plantedAt -= event.ms;
    record.branchesAt -= event.ms;
    record.nextBranchesAt -= event.ms;
    event.player.setAttribute(SAPLING_ATTRIBUTE, record);
    event.handledBy.push("EnlightenedJourney");
  }

  /**
   * The basket/balloon locs (varbit 2867) and the Taverley Auguste/Stan multi
   * (varbit 2868) are not quest stages; recompute them from the stage after login
   * and after the bootstrap re-sends shared varps.
   */
  function sendWorldVarbits({ player }) {
    const stage = quest.getStage(player);
    const basket =
      stage >= STAGE_BALLOON_READY ? 2 : stage >= STAGE_BASKET_BUILT ? 1 : 0;
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_ZEP_MULTI_BASKET, basket);
    const piccard = stage < STAGE_LANDED ? 0
      : quest.isComplete(player) && player.getAttribute(STAN_ATTRIBUTE) ? PICCARD_STAN : PICCARD_AUGUSTE;
    sender.sendVarbit(VARBIT_ZEP_MULTI_PICCARD, piccard);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    sendWorldVarbits({ player });
  }

  // --------------------------------------------------------------------------
  // Journal and reward
  // --------------------------------------------------------------------------

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    const value = flags(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I helped Auguste of Entrana build his hot air balloon.</str>",
        "<str>We flew from Entrana and landed safely in Taverley, and he</str>",
        "<str>rewarded me with a bomber jacket and cap.</str>",
        "",
        "I have access to the balloon transport system.",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_LANDED) {
      return [
        "We landed safely in <col=800000>Taverley</col>.",
        "I should speak to <col=800000>Auguste</col> about my reward.",
      ];
    }
    if (stage >= STAGE_BALLOON_READY) {
      return [
        "The balloon is built and waiting on the platform.",
        "To fly it I need <col=800000>10 normal logs</col> and a",
        "<col=800000>tinderbox</col>, weigh under 40kg and have no pet out.",
      ];
    }
    if (stage >= STAGE_BASKET_BUILT) {
      return [
        "I have woven the willow branches into the basket.",
        "I should speak to <col=800000>Auguste</col> so he can",
        "assemble the finished balloon.",
      ];
    }
    if (stage >= STAGE_MATERIALS) {
      const mark = (bit) => (value & bit ? "<str>" : "");
      const end = (bit) => (value & bit ? "</str>" : "");
      const record = saplingRecord(player);
      return [
        "Auguste is building a real balloon. I need to bring him:",
        `${mark(BIT_YELLOW_DYE)}Yellow dye${end(BIT_YELLOW_DYE)}`,
        `${mark(BIT_RED_DYE)}Red dye${end(BIT_RED_DYE)}`,
        `${mark(BIT_SILK)}Ten pieces of silk${end(BIT_SILK)}`,
        `${mark(BIT_BOWL)}A clay bowl${end(BIT_BOWL)}`,
        `${mark(BIT_SANDBAGS)}Eight sandbags${end(BIT_SANDBAGS)}`,
        record
          ? "I have planted Auguste's sapling; cut 12 willow branches with secateurs."
          : "I need to plant Auguste's sapling in a tree patch.",
      ];
    }
    if (stage >= STAGE_SECOND_EXPERIMENT) {
      return [
        "Both of Auguste's experiments are done.",
        "I should speak to him about building the real balloon.",
      ];
    }
    if (stage >= STAGE_FIRST_EXPERIMENT) {
      return [
        "I gave Auguste a plain origami balloon and we watched it burn.",
        "He wants a second experiment: two more papyrus and a sack of potatoes.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      const inventory = player.getInventory();
      const line = (itemId, amount, label) =>
        inventory.getAmount(itemId) >= amount ? `<str>${label}</str>` : label;
      return [
        "Auguste asked me to help test his balloon design.",
        "I need to bring him:",
        line(PAPYRUS, TEST_PAPYRUS, "Three sheets of papyrus"),
        line(BALL_OF_WOOL, 1, "A ball of wool"),
        line(POTATOES, 1, "A full sack of potatoes"),
        hasUnlitCandle(player) ? "<str>An unlit candle</str>" : "An unlit candle",
        "",
        "Then use papyrus on the wool and a candle on the structure.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Auguste</col>",
      "on <col=800000>Entrana</col>.",
      "",
      `I need ${QUEST_POINT_REQUIREMENT} Quest points, ${FIREMAKING_REQUIREMENT} Firemaking,`,
      `${FARMING_REQUIREMENT} Farming and ${CRAFTING_REQUIREMENT} Crafting.`,
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.CRAFTING, 2000);
    skills.addExperiences(Skill.FARMING, 3000);
    skills.addExperiences(Skill.WOODCUTTING, 1500);
    skills.addExperiences(Skill.FIREMAKING, 4000);
    player.getInventory().adds(BOMBER_CAP, 1);
  }

  api.persistAttribute(FLAGS_ATTRIBUTE);
  api.persistAttribute(SAPLING_ATTRIBUTE);
  api.persistAttribute(STAN_ATTRIBUTE, 0);

  // QH 06da90's zep_quest experiment/build/flight phases; cache DB completes at 200.
  // The saved stage remains the plugin's compact phase for balloon callbacks and old saves.
  function nativeProgress(stage) {
    const phases = [0, 20, 40, 60, 70, 80, 90, 100, 200];
    return phases[Math.max(0, Math.min(stage, STAGE_COMPLETE))];
  }

  quest = registerQuest(api, {
    key: "enlightened_journey",
    name: "Enlightened Journey",
    varpId: VARP_ENLIGHTENED_JOURNEY,
    varbitId: VARBIT_ZEP_QUEST,
    varbitValue: nativeProgress,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.CRAFTING.getIndex(), amount: 2000, label: "Crafting" },
      { skillId: Skill.FARMING.getIndex(), amount: 3000, label: "Farming" },
      { skillId: Skill.WOODCUTTING.getIndex(), amount: 1500, label: "Woodcutting" },
      { skillId: Skill.FIREMAKING.getIndex(), amount: 4000, label: "Firemaking" },
    ],
    rewardItemId: BOMBER_JACKET,
    rewardItemLabel: "Bomber jacket and cap",
    otherRewards: ["Access to the balloon transport system"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnNpc(handleItemOnNpc, { noted: false });
  api.onObjectInteraction("Plank", { Use: usePlank });
  api.onObjectInteraction("Dirt", { Leave: leaveCrashSite });
  api.onCustomEvent("balloon-transport:flight-landed", flightLanded);
  api.onCustomEvent("balloon-transport:flight-crashed", flightCrashed);
  api.onPlayerLogin(handleLogin);
  api.onCustomEvent("player:bootstrap-complete", sendWorldVarbits);
  api.onCustomEvent("agent:advance-time", advanceTime);
};
