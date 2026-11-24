/**
 * Enlightened Journey (members), as the revision 242 capture plays it (rsprox local enlightened-journey, the quest from
 * start to finish and every balloon route after it; docs/quests/enlightened-journey/README.md). The words come from the
 * "Enlightened Journey" transcript page; the post-quest chatter uses the "Auguste" page. This plugin supplies the variant
 * selector for Auguste, the prose-condition answers, the hand-ins, the origami balloons, the sand pit and willow work,
 * the three scenes (../enlightenedjourney/Scenes.EnlightenedJourney.js) and the first flight, played at the balloon
 * controls (BalloonTransport's Controls unit, the "taverley" route).
 *
 * Stages are zep_quest's own values (varbit 2866, varp 912 bits 0-7; client script 4024 case 42, Quest Helper 06da90
 * keys on the same), saved as they are, each set where the capture sets it:
 * 5 "Yes! Sign me up." · 6 "Let me show you!" continued (the balloon diagram opens) · 10 his explanation's last line
 * continued · 20 "Good, you have everything!" · 40 the first experiment's scene ends · 60 the second experiment's last
 * line shows · 70 the sapling and apples handed over · 80 the last material handed in · 90 the basket built (the
 * balloon scene) · 100 landed in Taverley · 200 complete. Saves from before this numbering (compact stages 1-8) are
 * mapped once at login.
 *
 * The material hand-ins also set their own zep_* varbits (2873-2879), cleared at completion as live does; the Entrana
 * basket (zep_multi_basket 2867) and Taverley's Auguste/Assistant Stan (zep_multi_piccard 2868) follow the stage.
 *
 * Rewards per the OSRS Wiki and the capture's scroll: 1 Quest point, 4,000 Firemaking, 3,000 Farming, 2,000 Crafting and
 * 1,500 Woodcutting XP, the bomber jacket and cap, and the balloon transport system.
 *
 * Gaps (each also in the docs page):
 * - Ours: the Crafting-level refusal for a balloon (no source has its words); a sandbag's Empty has no message.
 * - Auguste's sapling is planted by the Farming plugin and grows into an ordinary willow tree (Wiki: Auguste's sapling),
 *   its branches cut as any willow's; the capture bought its branches, so the planting is Wiki-only.
 * - The crash sites past Entrana are calibrated (no recording crashes there).
 */
module.exports = function registerEnlightenedJourneyQuest(api) {
  const { giveReward } = require("../QuestRuntime");
  const {
    Animation,
    ChatType,
    Equipment,
    Graphic,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
    Location,
    Skill,
    TaskManager,
    CountdownTask,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, questStartMessage, QUEST_POINTS_ATTRIBUTE } =
    require("../QuestRuntime");
  const { createScenes } = require("../enlightenedjourney/Scenes.EnlightenedJourney");

  const PAGE = "Enlightened Journey";
  const AUGUSTE_PAGE = "Auguste";
  const START_HOOK = "quest:enlightened-journey:start";
  const QUEST_KEY = "enlightened_journey";

  // registerQuest writes varpId only when varbitId is unset; the stage lives in
  // the varbit so the other zep_* bits in varp 912 survive.
  const VARP_ENLIGHTENED_JOURNEY = 912;
  const VARBIT_ZEP_QUEST = 2866;
  const VARBIT_ZEP_MULTI_BASKET = 2867; // 0 frame, 2 the balloon (Entrana locs); the capture never sends 1
  const VARBIT_ZEP_MULTI_PICCARD = 2868; // 1 Auguste, 2 Assistant Stan (Taverley multi)
  /** The material hand-ins' own bits (capture ticks 755-850), cleared at completion (tick 2122). */
  const VARBIT = Object.freeze({
    RED_DYE: 2873, // zep_rdye
    YELLOW_DYE: 2874, // zep_ydye
    SANDBAGS: 2875, // zep_sandbags
    SILK: 2876, // zep_silk
    BOWL: 2878, // zep_bowl
    BOTH_DYES: 2879, // zep_alldye
  });
  /** Set once Auguste's first post-quest talk on Entrana has explained the enterprise (capture tick 2983). */
  const VARBIT_ZEP_RETURN_CHECK = 2886;

  const STAGE = Object.freeze({
    NONE: 0,
    ACCEPTED: 5,
    DIAGRAM: 6,
    EXPLAINED: 10,
    MATERIALS: 20,
    FIRST_EXPERIMENT: 40,
    SECOND_EXPERIMENT: 60,
    GATHERING: 70,
    HANDED_IN: 80,
    BALLOON_READY: 90,
    LANDED: 100,
    COMPLETE: 200,
  });

  const AUGUSTE_NPC_IDS = new Set([
    NpcIdentifiers.AUGUSTE, // 4715, Entrana
    NpcIdentifiers.AUGUSTE_2, // 4716, cutscene
    NpcIdentifiers.AUGUSTE_3, // 4717, crash site
    NpcIdentifiers.AUGUSTE_4, // 4718, crash landing
  ]);
  const AUGUSTE_CUTSCENE = NpcIdentifiers.AUGUSTE_2;

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
  const TINDERBOX = ItemIdentifiers.TINDERBOX;
  /**
   * Dye -> the origami balloon it makes, the colour word, and the balloon's set-off spotanim (zep_<colour>_balloon_setoff)
   * and burning projectile (zep_<colour>_balloon_on_fire). The Wiki (Origami balloon) names the dyes and balloons; the
   * capture dyes blue (tick 2541, "You dye the origami balloon blue.", 10 Crafting XP) and lights it (tick 2583); the other
   * colours' words follow the same message.
   */
  const DYED_BALLOONS = [
    { dye: ItemIdentifiers.YELLOW_DYE, balloon: ItemIdentifiers.YELLOW_BALLOON, colour: "yellow", setOff: 883, onFire: 885 },
    { dye: ItemIdentifiers.BLUE_DYE, balloon: ItemIdentifiers.BLUE_BALLOON, colour: "blue", setOff: 886, onFire: 888 },
    { dye: ItemIdentifiers.RED_DYE, balloon: ItemIdentifiers.RED_BALLOON, colour: "red", setOff: 889, onFire: 891 },
    { dye: ItemIdentifiers.ORANGE_DYE, balloon: ItemIdentifiers.ORANGE_BALLOON, colour: "orange", setOff: 892, onFire: 894 },
    { dye: ItemIdentifiers.GREEN_DYE, balloon: ItemIdentifiers.GREEN_BALLOON, colour: "green", setOff: 895, onFire: 897 },
    { dye: ItemIdentifiers.PURPLE_DYE, balloon: ItemIdentifiers.PURPLE_BALLOON, colour: "purple", setOff: 898, onFire: 900 },
    { dye: ItemIdentifiers.PINK_DYE, balloon: ItemIdentifiers.PINK_BALLOON, colour: "pink", setOff: 901, onFire: 903 },
    { dye: ItemIdentifiers.BLACK_DYE, balloon: ItemIdentifiers.BLACK_BALLOON, colour: "black", setOff: 904, onFire: 906 },
  ];
  const DYED_BALLOON_IDS = new Set(DYED_BALLOONS.map(({ balloon }) => balloon));
  /** The plain origami balloon released with a tinderbox (Wiki): the test balloon's own spotanims. */
  const PLAIN_BALLOON = { balloon: ORIGAMI_BALLOON, setOff: 880, onFire: 882 };
  const AUGUSTES_SAPLING = ItemIdentifiers.AUGUSTES_SAPLING;
  const APPLES = ItemIdentifiers.APPLES_5_; // "Apples(5)", the basket of apples
  const WILLOW_BRANCH = ItemIdentifiers.WILLOW_BRANCH;
  const LOGS = ItemIdentifiers.LOGS;
  const COINS = ItemIdentifiers.COINS;
  const EMPTY_SACK = ItemIdentifiers.EMPTY_SACK;
  const BOMBER_JACKET = ItemIdentifiers.BOMBER_JACKET;
  const BOMBER_CAP = ItemIdentifiers.BOMBER_CAP;
  const CAP_AND_GOGGLES = ItemIdentifiers.CAP_AND_GOGGLES;
  const GNOME_GOGGLES = ItemIdentifiers.GNOME_GOGGLES;

  /** Capture ticks 446, 484, 2541, 2583. */
  const ANIM_MAKING_BALLOON = 5140; // zep_making_balloon
  const ANIM_SET_OFF = 5142; // zep_set_off_balloon
  const ANIM_FILL_SANDBAG = 5155; // zep_fill_sandbag (tick 799)
  const SOUND_CONSTRUCT = 3248; // zep_construct
  const SOUND_FLOAT = 3245; // zep_balloon_float
  const SOUND_SAND = 2584; // sand_bucket
  const ORIGAMI_CRAFTING_XP = 35;
  const DYE_CRAFTING_XP = 10;
  const RELEASE_FIREMAKING_XP = 20;

  // The Entrana basket is a multi-loc: 19133 transforms on varbit 2867 to the
  // metal frame (19132) / balloon. Item-on-object sees the map loc id.
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
  /** 2 once the saved stage is zep_quest's own value; older saves held compact stages 1-8. */
  const NUMBERING_ATTRIBUTE = "quest.enlightened_journey.numbering";
  const RETURN_CHECK_ATTRIBUTE = "quest.enlightened_journey.return_check";
  const NATIVE_NUMBERING = 2;
  const BIT_RED_DYE = 1 << 0;
  const BIT_YELLOW_DYE = 1 << 1;
  const BIT_SANDBAGS = 1 << 2;
  const BIT_SILK = 1 << 3;
  const BIT_BOWL = 1 << 4;
  const BIT_SAPLING_GIVEN = 1 << 5;
  const FLAG_VARBITS = [
    [BIT_RED_DYE, VARBIT.RED_DYE],
    [BIT_YELLOW_DYE, VARBIT.YELLOW_DYE],
    [BIT_SANDBAGS, VARBIT.SANDBAGS],
    [BIT_SILK, VARBIT.SILK],
    [BIT_BOWL, VARBIT.BOWL],
  ];

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
  const FLIGHT_LOGS = 10;
  const MAX_FLIGHT_WEIGHT = 40; // kg (Wiki)
  const GRAMS_PER_KG = 1000;
  const PICCARD_AUGUSTE = 1; // zep_multi_piccard: Auguste at Taverley
  const PICCARD_STAN = 2; // zep_multi_piccard: Assistant Stan at Taverley
  /** zep_multi_piccard turns to Stan three ticks after the first flight back lands on Entrana (capture ticks 2250, 2253). */
  const STAN_AFTER_LANDING = 3;

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

  /** Lines whose continue moves the quest on (the capture's ticks), matched on the transcript's words. */
  const LINES = Object.freeze({
    EXPLAINED: "You're the adventurer, you should know! Think of logical places, like, churches; they have tons of candles.",
    MATERIALS_CONFIRMED: "Good, you have everything! Now, I need you to create an origami balloon.",
    FIRST_EXPERIMENT: "Wonderful! I'll take that, and we'll conduct our first experiment.",
    FIRST_EXPERIMENT_LINES: [
      "That was perfect. My hypothesis was right!",
      "One more test. Then we shall proceed.",
      "We shall meekly go! No...no...it needs to sound grander. We shall cautiously go...",
    ],
    FIRST_EXPERIMENT_END: "We're doomed.",
    SECOND_EXPERIMENT: "Commendable. If I may have those, I will construct this experiment.",
    SECOND_EXPERIMENT_OVERHEAD: "Destroy the floating thing!",
    SECOND_EXPERIMENT_END: "Well, that went down like a lead balloon.",
    SAPLING: "Here you go. Now be very careful not to lose it!",
    SAPLING_REPLACED: "Here you go. Now be very careful not to lose it again!",
    YELLOW_DYE: "Ah, wonderful, yellow dye. Thank you.",
    RED_DYE: "Red dye! Thank you.",
    SANDBAGS: "Sandbags, thank you. This will allow us to change height.",
    SILK: "Silk for the balloon, thank you.",
    BOWL: "Ah the bowl. This will be used to hold the fuel while it heats the air in the balloon.",
    BASKET: "Great! Let me just put it all together and we'll be ready for lift off! Speak to me again in a moment.",
    ENTRANA_SEARCH: "Weapons are not allowed on Entrana. I must search you first.",
    RETURN_INTRO: "I have also hired assistants to watch over the balloons at each new location we go to. They will help you get where you want to go.",
  });

  let quest;

  // --------------------------------------------------------------------------
  // Small helpers
  // --------------------------------------------------------------------------

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const stageOf = (player) => quest.getStage(player);

  function flags(player) {
    return Number(player.getAttribute(FLAGS_ATTRIBUTE)) || 0;
  }

  function hasFlag(player, bit) {
    return (flags(player) & bit) !== 0;
  }

  function setFlag(player, bit) {
    player.setAttribute(FLAGS_ATTRIBUTE, flags(player) | bit);
    sendMaterialVarbits(player);
  }

  /** The hand-ins' zep_* bits, as live has them: each material's own, and zep_alldye once both dyes are in. */
  function sendMaterialVarbits(player) {
    const sender = player.getPacketSender();
    const value = quest.isComplete(player) ? 0 : flags(player);
    for (const [bit, varbit] of FLAG_VARBITS) sender.sendVarbit(varbit, (value & bit) !== 0 ? 1 : 0);
    const both = (value & (BIT_RED_DYE | BIT_YELLOW_DYE)) === (BIT_RED_DYE | BIT_YELLOW_DYE);
    sender.sendVarbit(VARBIT.BOTH_DYES, both ? 1 : 0);
  }

  function setStage(player, stage) {
    player.setAttribute(NUMBERING_ATTRIBUTE, NATIVE_NUMBERING);
    quest.setStage(player, stage);
  }

  /** Moves the quest to `stage` unless it is there or past it already. */
  function advance(player, stage) {
    if (stageOf(player) < stage) setStage(player, stage);
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
    const all = BIT_RED_DYE | BIT_YELLOW_DYE | BIT_SANDBAGS | BIT_SILK | BIT_BOWL;
    return (value & all) === all;
  }

  /** In the inventory, worn or banked: what Auguste's "has been lost" means for the bomber jacket and cap. */
  function owns(player, itemId) {
    if (held(player, itemId)) return true;
    if (player.getEquipment().getItems().some((item) => item?.getId?.() === itemId)) return true;
    return player.getBanks().some((bank) => bank?.contains?.(itemId));
  }

  const capOwned = (player) => owns(player, BOMBER_CAP) || owns(player, CAP_AND_GOGGLES);
  const jacketOwned = (player) => owns(player, BOMBER_JACKET);

  function wearing(player, itemId) {
    return player.getEquipment().getItems().some((item) => item?.getId?.() === itemId);
  }

  // --------------------------------------------------------------------------
  // Stage numbering: zep_quest's own values; older saves are mapped once
  // --------------------------------------------------------------------------

  /**
   * Compact stages 1-8 (before this numbering) -> zep_quest: started (20, as the old numbering sent it: a balloon may
   * already be made from the materials), first experiment (40),
   * second (60), gathering (70, or 80 with everything handed in), basket built or balloon ready (90), landed (100),
   * complete (200).
   */
  function migrateStage(player) {
    if (player.getAttribute(NUMBERING_ATTRIBUTE) === NATIVE_NUMBERING) return;
    const old = stageOf(player);
    if (old > 0 && old <= 8) {
      const native = [0, STAGE.MATERIALS, STAGE.FIRST_EXPERIMENT, STAGE.SECOND_EXPERIMENT,
        allMaterialsHanded(player) ? STAGE.HANDED_IN : STAGE.GATHERING, STAGE.BALLOON_READY, STAGE.BALLOON_READY,
        STAGE.LANDED, STAGE.COMPLETE][old];
      player.setAttribute(quest.stageKey, native);
    }
    player.setAttribute(NUMBERING_ATTRIBUTE, NATIVE_NUMBERING);
  }

  // --------------------------------------------------------------------------
  // Transcript selection and prose conditions
  // --------------------------------------------------------------------------

  /** Which transcript variant Auguste plays, by stage. */
  function selectVariant({ npcId, player }) {
    if (!AUGUSTE_NPC_IDS.has(npcId)) return null;
    // Auguste at a crash site talks about the crash, never a flight from there.
    const scene = Object.values(CRASH_SCENES).find((entry) => entry.npcId === npcId);
    if (scene) return { page: PAGE, variant: scene.variant };
    const stage = stageOf(player);
    if (stage >= STAGE.COMPLETE) {
      if (nearTaverley(player)) {
        return {
          page: PAGE,
          variant: "landing-in-taverley-talking-to-auguste-again-before-he-is-replaced-with-assistant-stan",
        };
      }
      // His first talk on Entrana after the quest explains the enterprise, once (zep_return_check, tick 2983).
      return player.getAttribute(RETURN_CHECK_ATTRIBUTE)
        ? { page: AUGUSTE_PAGE, variant: "subsequent-dialogues-after-enlightened-journey" }
        : { page: AUGUSTE_PAGE, variant: "initial-dialogue-after-enlightened-journey" };
    }
    if (stage >= STAGE.LANDED) return { page: PAGE, variant: "landing-in-taverley-talking-to-auguste" };
    if (stage >= STAGE.BALLOON_READY) return { page: PAGE, variant: "getting-ready-for-first-flight" };
    if (stage >= STAGE.HANDED_IN) {
      return {
        page: PAGE,
        variant: saplingRecord(player)
          ? "preparing-for-the-expedition-talking-to-him-after-planting-his-sapling-and-handing-in-all-the-ingredients"
          : "preparing-for-the-expedition-talking-to-him-before-planting-his-sapling-but-after-delivering-all-the-required-materials",
      };
    }
    if (stage >= STAGE.GATHERING) {
      return {
        page: PAGE,
        variant: saplingRecord(player)
          ? "preparing-for-the-expedition-talking-to-him-after-planting-his-sapling"
          : "preparing-for-the-expedition",
      };
    }
    // The sapling's "not two free slots" line ends the talk at 60; he gives it when there is room.
    if (stage >= STAGE.SECOND_EXPERIMENT) return { page: PAGE, variant: "talking-to-him-after-the-second-experiment" };
    if (stage >= STAGE.FIRST_EXPERIMENT) return { page: PAGE, variant: "second-experiment" };
    if (stage >= STAGE.MATERIALS) {
      for (const dyed of DYED_BALLOON_IDS) {
        if (held(player, dyed)) {
          return { page: PAGE, variant: "making-the-origami-balloon-giving-auguste-a-dyed-origami-balloon" };
        }
      }
      if (held(player, ORIGAMI_BALLOON)) return { page: PAGE, variant: "showing-auguste-the-finished-origami-balloon" };
      // With the raw materials still in hand he only repeats how; anything short of them (a structure made, say)
      // asks first, as live did at tick 459 with the structure, a candle and two papyrus.
      return {
        page: PAGE,
        variant: hasTestMaterials(player)
          ? "returning-to-auguste-talking-to-auguste-with-the-required-materials-before-making-an-origami-balloon"
          : "returning-to-auguste-talking-to-auguste-after-losing-the-required-materials-before-finishing-origami-balloon",
      };
    }
    if (stage >= STAGE.EXPLAINED) return { page: PAGE, variant: "returning-to-auguste" };
    // Accepted, or the diagram seen: his explanation (capture tick 279).
    if (stage >= STAGE.ACCEPTED) return { page: PAGE, variant: "talking-to-auguste-a-second-time" };
    // The requirements condition (c0LchB) lives in this variant and refuses the start for anyone who misses them.
    return { page: PAGE, variant: "starting-off" };
  }

  /**
   * The "all the materials are finally handed in" prose is judged after the thank-you line it follows has been
   * continued, when that hand-in is already flagged; `offering` still counts it for a check made before.
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
    if (potatoes && candle && low && !wool) return "You need more papyrus and a ball of wool."; // a2qEIY (tick 464)
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

  /** Answer the wiki's prose conditions for the Enlightened Journey and Auguste pages. */
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
      case "bhVUCf": // second experiment: two papyrus and a sack of potatoes
        return held(player, POTATOES) && held(player, PAPYRUS, EXPERIMENT_TWO_PAPYRUS);
      case "_OGIzV": // neither
        return !held(player, POTATOES) && !held(player, PAPYRUS, EXPERIMENT_TWO_PAPYRUS);
      case "e-wFDO":
        return !held(player, POTATOES);
      case "iBZETA":
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
        return hasFlightFuel(player) && held(player, TINDERBOX);
      case "z2wZOR":
        return !held(player, TINDERBOX);
      case "Kjqrcm":
        return !hasFlightFuel(player);
      case "2DszCS":
        return inventory.getFreeSlots() >= 2;
      case "M-nwQB":
        return inventory.getFreeSlots() < 2;
      case "y5hUFB":
        return hasContraband(player);
      case "r4ZOdj":
        return !hasContraband(player);
      // The Auguste page's replacements (Wiki: the cap "if lost on death, a replacement can be claimed from Auguste").
      case "bOybQz": // the cap not lost
        return capOwned(player);
      case "y_diUp": // lost, no room
        return !capOwned(player) && inventory.getFreeSlots() < 1;
      case "oNjpBD": // lost: here it is
        return !capOwned(player) && inventory.getFreeSlots() >= 1;
      case "h866A5": // the jacket not lost
        return jacketOwned(player);
      case "Fio1A8":
        return !jacketOwned(player) && inventory.getFreeSlots() < 1;
      case "w_NjLo":
        return !jacketOwned(player) && inventory.getFreeSlots() >= 1;
      // Combining the cap and gnome goggles (Wiki: Bomber cap).
      case "B0DDku":
        return wearing(player, BOMBER_CAP) || wearing(player, GNOME_GOGGLES);
      case "JXgB5W":
        return false; // the two become one, so there is always room
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
      return quest.isComplete(player) && (!capOwned(player) || !jacketOwned(player));
    }
    if (prose.includes("has a bomber cap and gnome goggles")) {
      return owns(player, BOMBER_CAP) && owns(player, GNOME_GOGGLES) &&
        (held(player, BOMBER_CAP) || wearing(player, BOMBER_CAP)) &&
        (held(player, GNOME_GOGGLES) || wearing(player, GNOME_GOGGLES));
    }
    return null;
  }

  // --------------------------------------------------------------------------
  // Dialogue side effects
  // --------------------------------------------------------------------------

  function handleStartHook({ player, npcId, hook }) {
    if (!AUGUSTE_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (stageOf(player) !== STAGE.NONE || !meetsRequirements(player)) return;
    // A started-from-scratch run after ::quest reset must not inherit the old
    // hand-ins or a planted sapling from a previous playthrough.
    player.setAttribute(FLAGS_ATTRIBUTE, 0);
    player.setAttribute(SAPLING_ATTRIBUTE, null);
    setStage(player, STAGE.ACCEPTED);
    sendMaterialVarbits(player);
    // "You've started a new quest" comes with zep_quest 5, before Auguste's "Wonderful!" (capture tick 255).
    player.sendMessage(questStartMessage(player, quest.name));
  }

  /** Takes `amount` of `itemId` if the player still has it: a hand-in made as its thank-you is continued. */
  function take(player, itemId, amount = 1) {
    if (!held(player, itemId, amount)) return false;
    player.getInventory().deleteNumber(itemId, amount);
    return true;
  }

  /**
   * A material taken and its bit set once the player continues Auguste's thank-you (capture: yellow dye's bit at tick
   * 755 as "Red dye!" shows, red and zep_alldye at 757, silk at 769, the bowl at 774, the sandbags and zep_quest 80 at 850).
   */
  function handIn(request, itemId, amount, bit) {
    request.after = () => {
      const { player } = request;
      if (hasFlag(player, bit) || !take(player, itemId, amount)) return;
      setFlag(player, bit);
      if (allMaterialsHanded(player)) advance(player, STAGE.HANDED_IN);
    };
  }

  /** The words that move the quest on, the scenes' lines, and the material check's rewrite. */
  function handleLine(event) {
    const { player, text } = event;
    if (!AUGUSTE_NPC_IDS.has(event.npcId)) return;
    if (materialCheck.has(player)) {
      if (text === MATERIAL_CHECK_FIRST_LINE) {
        const replacement = materialCheck.get(player);
        if (replacement) {
          event.text = replacement;
          return; // keep the marker so the second line is dropped
        }
        materialCheck.delete(player); // "none" case: both original lines are correct
        return;
      }
      if (text === MATERIAL_CHECK_SECOND_LINE) {
        if (materialCheck.get(player)) event.skip = true;
        materialCheck.delete(player);
        return;
      }
    }
    const stage = stageOf(player);
    switch (text) {
      case LINES.EXPLAINED:
        event.after = () => advance(player, STAGE.EXPLAINED);
        return;
      case LINES.MATERIALS_CONFIRMED:
        event.after = () => advance(player, STAGE.MATERIALS);
        return;
      case LINES.FIRST_EXPERIMENT:
        if (stage === STAGE.MATERIALS && held(player, ORIGAMI_BALLOON)) Scenes.firstExperiment(event);
        return;
      case LINES.FIRST_EXPERIMENT_END:
        Scenes.firstExperimentEnds(event);
        return;
      case LINES.SECOND_EXPERIMENT:
        if (stage === STAGE.FIRST_EXPERIMENT) Scenes.secondExperiment(event);
        return;
      case LINES.SECOND_EXPERIMENT_OVERHEAD:
        // The scene's peasant shouts it, with two more (capture ticks 578-590); the transcript's one line is dropped.
        if (Scenes.isPlaying(player)) event.skip = true;
        return;
      case LINES.SECOND_EXPERIMENT_END:
        Scenes.secondExperimentEnds(event);
        return;
      case LINES.SAPLING:
        // The sapling and apples come with zep_quest 70 as the line is continued (capture tick 639).
        event.after = () => {
          if (hasFlag(player, BIT_SAPLING_GIVEN) || player.getInventory().getFreeSlots() < 2) return;
          player.getInventory().adds(AUGUSTES_SAPLING, 1);
          player.getInventory().adds(APPLES, 1);
          setFlag(player, BIT_SAPLING_GIVEN);
          advance(player, STAGE.GATHERING);
        };
        return;
      case LINES.SAPLING_REPLACED:
        event.after = () => {
          if (player.getInventory().getFreeSlots() < 1 || !take(player, COINS, SAPLING_REPLACEMENT_COST)) return;
          player.getInventory().adds(AUGUSTES_SAPLING, 1);
        };
        return;
      case LINES.YELLOW_DYE:
        handIn(event, YELLOW_DYE, 1, BIT_YELLOW_DYE);
        return;
      case LINES.RED_DYE:
        handIn(event, RED_DYE, 1, BIT_RED_DYE);
        return;
      case LINES.SANDBAGS:
        handIn(event, SANDBAG, REQUIRED_SANDBAGS, BIT_SANDBAGS);
        return;
      case LINES.SILK:
        handIn(event, SILK, REQUIRED_SILK, BIT_SILK);
        return;
      case LINES.BOWL:
        handIn(event, BOWL, 1, BIT_BOWL);
        return;
      case LINES.BASKET:
        if (stage === STAGE.HANDED_IN) Scenes.basket(event);
        return;
      case LINES.RETURN_INTRO:
        // zep_return_check comes as the line is continued (capture tick 2983).
        event.after = () => {
          player.setAttribute(RETURN_CHECK_ATTRIBUTE, 1);
          player.getPacketSender().sendVarbit(VARBIT_ZEP_RETURN_CHECK, 1);
        };
        return;
      case LINES.ENTRANA_SEARCH:
        // Taverley's "Yes.": live opens the balloon map; the search is the Entrana trip's (capture ticks 2218-2245).
        if (stage >= STAGE.COMPLETE && nearTaverley(player)) event.skip = true;
        return;
      default:
        break;
    }
    // The cutscene Auguste speaks the first experiment's lines with his own head (capture tick 509).
    if (LINES.FIRST_EXPERIMENT_LINES.includes(text) && Scenes.isPlaying(player)) event.speakerId = AUGUSTE_CUTSCENE;
  }

  /** Storage owns eligibility: ten unnoted inventory logs OR ten stored logs, never a mix. */
  function hasFlightFuel(player) {
    const request = { player, station: FLIGHT_STATION, logs: FLIGHT_LOGS, canPay: held(player, LOGS, FLIGHT_LOGS) };
    api.emitCustomEvent("balloon-transport:can-pay", request);
    return request.canPay === true;
  }

  /** The same requirements when an offered flight is committed, before any fuel is taken. */
  function canStartFlight(player) {
    if (stageOf(player) !== STAGE.BALLOON_READY) return false;
    let refusal = null;
    if (hasFollower(player)) refusal = "You need to put your pet into your inventory before the flight.";
    else if (carriedWeight(player) > MAX_FLIGHT_WEIGHT) refusal = "You have too much weight in your bag. You may only bring 40kg of weight.";
    else if (!held(player, TINDERBOX)) refusal = "You need a tinderbox.";
    else if (!hasFlightFuel(player)) refusal = "You don't have enough logs. You need ten normal logs.";
    if (refusal) player.sendMessage(refusal);
    return refusal === null;
  }

  /** The log storage's saved preference (BalloonTransport), or null while none is set. */
  function logPreference(player) {
    const request = { player, preference: null };
    api.emitCustomEvent("balloon-transport:preference", request);
    return request.preference;
  }

  function setLogPreference(player, preference) {
    api.emitCustomEvent("balloon-transport:set-preference", { player, preference });
  }

  /** The ten logs onto Auguste's fire, from `source`: the balloon controls fly to Taverley. */
  function startFlight(player, source) {
    if (!canStartFlight(player)) return;
    const at = player.getLocation();
    const origin = new Location(at.getX(), at.getY(), at.getZ());
    api.emitCustomEvent("balloon-transport:quest-flight", {
      player, station: FLIGHT_STATION, logs: FLIGHT_LOGS, source,
      canStart: () => origin.equals(player.getLocation()) && canStartFlight(player),
    });
  }

  /** Landed on Taverley's target: Auguste is there, and the quest moves on (capture tick 2099). */
  function flightLanded({ player, station }) {
    if (station !== FLIGHT_STATION || stageOf(player) !== STAGE.BALLOON_READY) return;
    player.getPacketSender().sendVarbit(VARBIT_ZEP_MULTI_PICCARD, PICCARD_AUGUSTE);
    setStage(player, STAGE.LANDED);
  }

  /** Crashed past Entrana: Auguste's words at the sea or woods crash site (the transcript). */
  function flightCrashed({ player, station, site }) {
    if (station !== FLIGHT_STATION || stageOf(player) !== STAGE.BALLOON_READY) return;
    const scene = CRASH_SCENES[site];
    if (scene) startTranscript(api, player, scene.npcId, PAGE, scene.variant);
  }

  /**
   * The first trip after the quest from Taverley lands on Entrana: Assistant Stan keeps Taverley's balloon from then
   * on, three ticks after the landing (capture ticks 2250, 2253).
   */
  function passengerArrived({ player, station, origin }) {
    if (station !== "entrana" || origin?.station !== FLIGHT_STATION || !quest.isComplete(player)) return;
    if (player.getAttribute(STAN_ATTRIBUTE)) return;
    player.setAttribute(STAN_ATTRIBUTE, 1);
    TaskManager.submit(new CountdownTask(player, STAN_AFTER_LANDING, () => {
      if (player.isRegistered?.() === false) return;
      player.getPacketSender().sendVarbit(VARBIT_ZEP_MULTI_PICCARD, PICCARD_STAN);
    }));
  }

  /** The plank at the sea crash site swims the player back to Entrana. */
  function usePlank(event) {
    if (event.objectId !== PLANK) return false;
    startTranscript(api, event.player, NpcIdentifiers.AUGUSTE_3, PAGE, `${CRASH_SCENES.ocean.variant}-using-the-plank-to-return-to-land`);
    return true;
  }

  /** The dirt at the woods crash site leads out, east of Falador. */
  function leaveCrashSite(event) {
    if (event.objectId !== CRASH_SITE_EXIT) return false;
    startTranscript(api, event.player, NpcIdentifiers.AUGUSTE_4, PAGE, `${CRASH_SCENES.woods.variant}-leaving-the-crash-site`);
    return true;
  }

  /** zep_if_balloon_blueprint: what "Let me show you!" opens, as its continue sets zep_quest 6 (capture tick 262). */
  function showDiagram(player) {
    advance(player, STAGE.DIAGRAM);
    const group = api.core.CacheDefinitions.getInterfaceId("zep_if_balloon_blueprint");
    if (group != null) player.getPacketSender().sendInterface(group);
  }

  /** Stage directions and messages on the Enlightened Journey and Auguste pages. */
  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (!AUGUSTE_NPC_IDS.has(npcId)) return;
    switch (stepId) {
      case "0rJowj": // open the balloon construction diagram
      case "2FO9r5": // the same on the Auguste page
        // The chat closes and the diagram stays open: an ended conversation would close it too.
        event.handled = true;
        event.wait = () => showDiagram(player);
        return;
      case "BBeDtT": // the first flight's log question: asked only while no preference is set
        if (!logPreference(player)) return;
        event.handled = true;
        event.end = true;
        // The source by the preference (or "Use logs from inventory / storage" when both can pay), a tick on as
        // live asks it (capture ticks 1996-1997, 1638-1640).
        TaskManager.submit(new CountdownTask(player, 1, () => {
          if (player.isRegistered?.() === false) return;
          api.emitCustomEvent("balloon-transport:choose-source", {
            player, station: FLIGHT_STATION, logs: FLIGHT_LOGS, go: (source) => startFlight(player, source),
          });
        }));
        return;
      case "JiMggG": // the first experiment's scene (Scenes.firstExperiment)
      case "_ZdYV3": // end of cutscene
      case "1JQEmc": // the second experiment's scene (Scenes.secondExperiment)
        event.handled = true;
        return;
      case "Sk2xez": // the balloon put together: the basket scene (Scenes.basket); live shows no message
        event.handled = true;
        event.end = true;
        return;
      case "_G1qps": // "Take logs from my inventory first.": saved, then the flight
      case "XJPKij": // "Ask me..." then "Use logs from inventory"
        event.handled = true;
        event.end = true;
        setLogPreference(player, stepId === "_G1qps" ? "inventory" : "ask");
        startFlight(player, "inventory");
        return;
      case "UrzuZs": // "Take logs from storage first."
      case "RS5ufp": // "Ask me..." then "Use logs from storage"
        event.handled = true;
        event.end = true;
        setLogPreference(player, stepId === "UrzuZs" ? "storage" : "ask");
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
      case "LQAzz1": // Taverley's "Yes.": the balloon map, as at any station (capture tick 2218)
        event.handled = true;
        event.end = true;
        api.emitCustomEvent("balloon-transport:open-map", { player, npcId: NpcIdentifiers.AUGUSTE });
        return;
      case "NUo2gd": // the Wiki's "takes the balloon transport system back to Entrana": the map's Entrana trip does it
        event.handled = true;
        event.end = true;
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

  /** The replacements and the cap-and-goggles, as the Auguste page's branches choose them. */
  function handleCondition(event) {
    const { player, npcId, stepId } = event;
    if (!AUGUSTE_NPC_IDS.has(npcId)) return;
    const inventory = player.getInventory();
    switch (stepId) {
      case "oNjpBD":
        if (!capOwned(player) && inventory.getFreeSlots() >= 1) inventory.adds(BOMBER_CAP, 1);
        return;
      case "w_NjLo":
        if (!jacketOwned(player) && inventory.getFreeSlots() >= 1) inventory.adds(BOMBER_JACKET, 1);
        return;
      default:
        return;
    }
  }

  const HOW_TO_MAKE = "How do you make the origami balloon?";
  const LOST_ITEMS = "I lost some items, what do I need again?";

  /**
   * "I lost some items, what do I need again?": his material check for what is carried now, after the player's line
   * (capture tick 463: a structure made, two papyrus, the candle and the potatoes -> "You need more papyrus and a ball
   * of wool."). The transcript's option only jumps "above" to the Returning section's differently worded option, which
   * the runner cannot find, so the words are played here, as that section has them.
   */
  function sayLostItems(player) {
    const { DialogueChainBuilder, NpcDialogue, PlayerDialogue } = api.core;
    const line = materialCheckLine(player);
    const chain = new DialogueChainBuilder();
    chain.add(new PlayerDialogue(0, LOST_ITEMS));
    const words = line ? [line] : [MATERIAL_CHECK_FIRST_LINE, MATERIAL_CHECK_SECOND_LINE];
    words.forEach((words, index) => chain.add(new NpcDialogue(index + 1, NpcIdentifiers.AUGUSTE, words)));
    player.getDialogueManager().startDialogues(chain);
  }

  /** The origami balloon menu's two options (zep_quest 20), and the cap and goggles. */
  function handleChoice(event) {
    const { player, npcId } = event;
    if (!AUGUSTE_NPC_IDS.has(npcId)) return;
    if (stageOf(player) === STAGE.MATERIALS && (event.option === HOW_TO_MAKE || event.option === LOST_ITEMS)) {
      event.end = true;
      // The player's line and his three (capture ticks 470-473), as the Returning section words them.
      if (event.option === HOW_TO_MAKE) {
        startTranscript(api, player, NpcIdentifiers.AUGUSTE, PAGE,
          "returning-to-auguste-talking-to-auguste-with-the-required-materials-before-making-an-origami-balloon");
      } else {
        sayLostItems(player);
      }
      return;
    }
    if (event.option !== "Could you combine my cap and goggles?") return;
    if (wearing(player, BOMBER_CAP) || wearing(player, GNOME_GOGGLES)) return;
    if (!held(player, BOMBER_CAP) || !held(player, GNOME_GOGGLES)) return;
    player.getInventory().deleteNumber(BOMBER_CAP, 1);
    player.getInventory().deleteNumber(GNOME_GOGGLES, 1);
    player.getInventory().adds(CAP_AND_GOGGLES, 1);
  }

  // --------------------------------------------------------------------------
  // Items, objects and NPCs
  // --------------------------------------------------------------------------

  const started = (player) => stageOf(player) >= STAGE.ACCEPTED;

  /** The capture's crafting beat: the message, zep_making_balloon and zep_construct (ticks 446, 484). */
  function crafted(player, message) {
    player.sendMessage(message);
    player.performAnimation(new Animation(ANIM_MAKING_BALLOON));
    player.getPacketSender().sendSoundEffect(SOUND_CONSTRUCT, 1, 0, 0);
  }

  /** Ours: no source words the refusal (the Wiki gives the level, 36 boostable). */
  function canCraftBalloon(player) {
    if (player.getSkillManager().getCurrentLevel(Skill.CRAFTING) >= CRAFTING_REQUIREMENT) return true;
    player.sendMessage(`You need a Crafting level of ${CRAFTING_REQUIREMENT} to make an origami balloon.`);
    return false;
  }

  /**
   * Papyrus on wool makes the structure; an unlit candle finishes the balloon (35 Crafting XP); a dye colours it (10 Crafting XP); a tinderbox lets a balloon go (20 Firemaking XP).
   */
  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = [usedItemId, usedWithItemId];
    const has = (id) => pair.includes(id);
    if (has(PAPYRUS) && has(BALL_OF_WOOL)) {
      if (!started(player)) return;
      event.handled = true;
      if (!held(player, PAPYRUS) || !held(player, BALL_OF_WOOL) || !canCraftBalloon(player)) return;
      player.getInventory().deleteNumber(PAPYRUS, 1);
      player.getInventory().deleteNumber(BALL_OF_WOOL, 1);
      player.getInventory().adds(BALLOON_STRUCTURE, 1);
      crafted(player, "You create the origami balloon structure.");
      return;
    }
    if (has(BALLOON_STRUCTURE) && (has(CANDLE) || has(BLACK_CANDLE))) {
      if (!started(player)) return;
      event.handled = true;
      if (!held(player, BALLOON_STRUCTURE) || !canCraftBalloon(player)) return;
      const candleId = has(CANDLE) ? CANDLE : BLACK_CANDLE;
      if (!held(player, candleId)) return;
      player.getInventory().deleteNumber(candleId, 1);
      player.getInventory().deleteNumber(BALLOON_STRUCTURE, 1);
      player.getInventory().adds(ORIGAMI_BALLOON, 1);
      // The balloon, its message and the XP come together (capture ticks 484 and 2538).
      crafted(player, "You create an origami balloon.");
      player.getSkillManager().addExperience(Skill.CRAFTING, ORIGAMI_CRAFTING_XP);
      return;
    }
    const dyed = DYED_BALLOONS.find(({ dye }) => has(dye));
    if (dyed && has(ORIGAMI_BALLOON)) {
      event.handled = true;
      if (!held(player, ORIGAMI_BALLOON) || !held(player, dyed.dye)) return;
      player.getInventory().deleteNumber(dyed.dye, 1);
      player.getInventory().deleteNumber(ORIGAMI_BALLOON, 1);
      player.getInventory().adds(dyed.balloon, 1);
      player.sendMessage(`You dye the origami balloon ${dyed.colour}.`);
      player.getSkillManager().addExperience(Skill.CRAFTING, DYE_CRAFTING_XP);
      return;
    }
    const released = has(TINDERBOX) && (DYED_BALLOONS.find(({ balloon }) => has(balloon)) ?? (has(ORIGAMI_BALLOON) ? PLAIN_BALLOON : null));
    if (released) {
      event.handled = true;
      release(player, released);
    }
  }

  /**
   * "You light the origami balloon.": zep_set_off_balloon, the colour's spotanim and zep_balloon_float five cycles on,
   * the balloon gone; three ticks later it burns, flying south from two tiles off to eight (capture tick 2583-2586).
   */
  function release(player, { balloon, setOff, onFire }) {
    if (!held(player, balloon)) return;
    player.getInventory().deleteNumber(balloon, 1);
    player.sendMessage("You light the origami balloon.");
    player.performAnimation(new Animation(ANIM_SET_OFF));
    player.performGraphic(Graphic.delayed(setOff, 5, 0));
    player.getPacketSender().sendSoundEffect(SOUND_FLOAT, 1, 5, 0);
    player.getSkillManager().addExperience(Skill.FIREMAKING, RELEASE_FIREMAKING_XP);
    const at = player.getLocation();
    const from = new Location(at.getX(), at.getY() - 2, at.getZ());
    const to = new Location(at.getX(), at.getY() - 8, at.getZ());
    TaskManager.submit(new CountdownTask(player, 3, () => {
      if (player.isRegistered?.() === false) return;
      // map_projanim_v2 (capture tick 2586): heights printed four times the packet's.
      player.getPacketSender().sendProjectile(from, to, 0, 300, onFire, 0, 100 / 4, null, 0, 3, 98);
    }));
  }

  /**
   * Split on the cap and goggles: the bomber cap and the gnome goggles again (Wiki: Bomber cap, "right click and choose
   * split"). Ours: no source gives a message or the full-inventory refusal, so a full pack keeps it whole.
   */
  function splitCap({ player, slot }) {
    const inventory = player.getInventory();
    if (inventory.getItems()[slot]?.getId?.() !== CAP_AND_GOGGLES) return false;
    if (inventory.getFreeSlots() < 1) return true;
    inventory.deleteNumber(CAP_AND_GOGGLES, 1);
    inventory.adds(BOMBER_CAP, 1);
    inventory.adds(GNOME_GOGGLES, 1);
    return true;
  }

  /** A sandbag's Empty: the sack back. Ours: no source gives a message. */
  function emptySandbag({ player, slot }) {
    const item = player.getInventory().getItems()[slot];
    if (item?.getId?.() !== SANDBAG) return false;
    player.getInventory().deleteNumber(SANDBAG, 1);
    player.getInventory().adds(EMPTY_SACK, 1);
    return true;
  }

  /** Empty sacks into sandbags, one a click; willow branches onto the basket frame. */
  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (itemId === EMPTY_SACK && SAND_PIT_OBJECT_IDS.has(objectId)) {
      if (!started(player)) return;
      event.handled = true;
      const slot = event.itemSlot;
      const inventory = player.getInventory();
      const at = Number.isInteger(slot) && inventory.getItems()[slot]?.getId?.() === EMPTY_SACK ? slot : inventory.getSlotForItemId(EMPTY_SACK);
      if (at < 0) return;
      inventory.setItem(at, new api.core.Item(SANDBAG, 1)).refreshItems();
      // Capture ticks 799-825: a spam line, zep_fill_sandbag and sand_bucket per sack.
      player.getPacketSender().sendTypedMessage(ChatType.SPAM, "You fill the bag with sand.");
      player.performAnimation(new Animation(ANIM_FILL_SANDBAG));
      player.getPacketSender().sendSoundEffect(SOUND_SAND, 1, 0, 0);
      return;
    }
    if (itemId !== WILLOW_BRANCH || !BASKET_FRAME_OBJECT_IDS.has(objectId)) return;
    // Wiki: the 12 branches may be bought ("buy from the Grand Exchange, or plant a willow
    // sapling") - the capture bought them (tick 1190); what the basket needs is everything handed to Auguste.
    if (stageOf(player) !== STAGE.HANDED_IN) return;
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
    // Auguste's "Great! Let me just put it all together..." (capture tick 1458); its continue plays the basket scene.
    startTranscript(api, player, NpcIdentifiers.AUGUSTE, PAGE, "making-the-basket-frame");
  }

  /** The basket scene's beat: the twelve branches go and zep_quest is 90 (capture tick 1463). */
  function buildBasket(player) {
    if (stageOf(player) !== STAGE.HANDED_IN || !take(player, WILLOW_BRANCH, REQUIRED_BRANCHES)) return false;
    setStage(player, STAGE.BALLOON_READY);
    return true;
  }

  /**
   * Auguste's sapling in a tree patch: the Farming plugin plants it as a willow (Wiki: Auguste's sapling). Its own
   * planting line gives way to the transcript's two ("Enlightened Journey" transcript, planting the sapling), said as the
   * sapling takes root, and the record the after-planting talk keys on is kept (Auguste's "hasn't been planted"
   * branches; he gives no more saplings).
   */
  function saplingPlantRules(rules) {
    if (rules.seedId === AUGUSTES_SAPLING) rules.line = "";
  }

  function saplingPlanted({ player, seedId, patch }) {
    if (seedId !== AUGUSTES_SAPLING) return;
    player.setAttribute(SAPLING_ATTRIBUTE, { x: patch.x, y: patch.y, z: patch.z, plantedAt: Date.now() });
    startTranscript(api, player, NpcIdentifiers.AUGUSTE, PAGE, "preparing-for-the-expedition-planting-the-sapling");
  }

  /**
   * Before issue 6636 the sapling was "planted" into this plugin's own record and nothing grew on the patch. Such a
   * record (it has `branchesAt`) is dropped at login, and while the basket still needs branches the sapling comes back
   * to the inventory to be planted for real; with no free slot the record waits for a later login. Ours: no source;
   * nothing is said.
   */
  function migrateSapling(player) {
    const record = saplingRecord(player);
    if (!record || record.branchesAt === undefined) return;
    const giveBack = stageOf(player) < STAGE.BALLOON_READY && !owns(player, AUGUSTES_SAPLING);
    if (giveBack && player.getInventory().getFreeSlots() < 1) return;
    player.setAttribute(SAPLING_ATTRIBUTE, null);
    if (giveBack) player.getInventory().adds(AUGUSTES_SAPLING, 1);
  }

  /** A willow branch on Auguste points at the frame on the platform. */
  function handleItemOnNpc(event) {
    const { player, npcId, itemId } = event;
    if (!AUGUSTE_NPC_IDS.has(npcId) || itemId !== WILLOW_BRANCH) return;
    if (stageOf(player) !== STAGE.HANDED_IN) return;
    event.handled = true;
    startTranscript(
      api,
      player,
      npcId,
      PAGE,
      "preparing-for-the-expedition-talking-to-him-after-planting-his-sapling-and-handing-in-all-the-ingredients-using-a-willow-branch-on-auguste"
    );
  }

  /**
   * The basket/balloon locs (varbit 2867), the Taverley Auguste/Stan multi (2868), the hand-ins' bits and
   * zep_return_check are not quest stages; recompute them after login and after the bootstrap re-sends shared varps.
   */
  function sendWorldVarbits({ player }) {
    const stage = stageOf(player);
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_ZEP_MULTI_BASKET, stage >= STAGE.BALLOON_READY ? 2 : 0);
    const piccard = stage < STAGE.LANDED ? 0
      : quest.isComplete(player) && player.getAttribute(STAN_ATTRIBUTE) ? PICCARD_STAN : PICCARD_AUGUSTE;
    sender.sendVarbit(VARBIT_ZEP_MULTI_PICCARD, piccard);
    sendMaterialVarbits(player);
    sender.sendVarbit(VARBIT_ZEP_RETURN_CHECK, player.getAttribute(RETURN_CHECK_ATTRIBUTE) ? 1 : 0);
  }

  function handleLogin({ player }) {
    migrateStage(player);
    migrateSapling(player);
    refreshQuestList(player);
    sendWorldVarbits({ player });
  }

  // --------------------------------------------------------------------------
  // Journal and reward
  // --------------------------------------------------------------------------

  const str = (text) => `<str>${text}`;
  const blue = (text) => `<col=000080>${text}`;
  const red = (text) => `<col=800000>${text}`;

  /** The journal as live writes it at each stage (capture ticks 272-1864); what no capture shows is marked Ours. */
  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage < STAGE.ACCEPTED) {
      // Ours: the start page is not recorded.
      return [
        `I can start this quest by talking to ${red("Auguste")}${blue(" on ")}${red("Entrana")}${blue(".")}`,
        "",
        blue(`I need ${QUEST_POINT_REQUIREMENT} Quest points, level ${FIREMAKING_REQUIREMENT} Firemaking,`),
        blue(`level ${FARMING_REQUIREMENT} Farming and level ${CRAFTING_REQUIREMENT} Crafting.`),
      ];
    }
    const lines = [str("I have agreed to help Auguste build an air balloon. I have no"), str("idea what he's talking about.")];
    if (stage < STAGE.EXPLAINED) {
      lines.push(blue("Auguste showed me his design, but I want him to explain it"), blue("further."));
      return lines;
    }
    lines.push(
      str("Auguste thinks if he pumps hot air into a sack it will rise and"),
      str("take us along with it. But we're going to run some tests first."),
      str("Thank goodness.")
    );
    if (stage < STAGE.MATERIALS) {
      const line = (has, words) => (has ? str(words) : words);
      lines.push(
        blue("Auguste needs the following items for his experiments:"),
        line(held(player, PAPYRUS, TEST_PAPYRUS), "3 Papyrus sheets"),
        line(held(player, BALL_OF_WOOL), "1 Ball of wool"),
        line(held(player, POTATOES), "1 Full sack of potatoes"),
        line(hasUnlitCandle(player), "1 Unlit candle")
      );
      return lines;
    }
    lines.push(
      str("I gathered all the materials Auguste required: three sheets of"),
      str("papyrus, a ball of wool, a full sack of potatoes and one unlit"),
      str("candle.")
    );
    if (stage < STAGE.FIRST_EXPERIMENT) {
      lines.push(
        blue("I need to make the first test balloon with the ball of wool, a"),
        blue("sheet of papyrus and an unlit candle and then give it to"),
        blue("Auguste.")
      );
      return lines;
    }
    lines.push(
      str("I made an origami balloon. Auguste said I could make these"),
      str("any time I want if I have the materials."),
      str("Auguste conducted the first experiment. There was an awful"),
      str("lot of fire.")
    );
    if (stage < STAGE.SECOND_EXPERIMENT) {
      lines.push(blue("I need to give Auguste two sheets of papyrus and a full sack"), blue("of potatoes."));
      return lines;
    }
    lines.push(str("Auguste conducted the second experiment. A flash mob"), str("appeared. They seem to have a grudge against science."));
    if (stage < STAGE.GATHERING) {
      lines.push(blue("I need to speak to Auguste to find out what materials he"), blue("needs for the final balloon."));
      return lines;
    }
    if (stage < STAGE.BALLOON_READY) {
      // Each one struck once handed in or carried (tick 837: the eight sandbags carried, not yet handed in).
      const item = (bit, itemId, amount, words) => (hasFlag(player, bit) || held(player, itemId, amount) ? str(words) : words);
      lines.push(
        "Auguste needs:",
        item(BIT_YELLOW_DYE, YELLOW_DYE, 1, "1 Yellow Dye"),
        item(BIT_RED_DYE, RED_DYE, 1, "1 Red Dye"),
        item(BIT_SILK, SILK, REQUIRED_SILK, "10 Pieces of Silk"),
        item(BIT_BOWL, BOWL, 1, "1 Bowl"),
        item(BIT_SANDBAGS, SANDBAG, REQUIRED_SANDBAGS, "8 Sandbags"),
        "For the basket on the platform:",
        `${red(String(REQUIRED_BRANCHES))} ${blue("willow branches")}`
      );
      return lines;
    }
    lines.push(
      str("I gave Auguste all the supplies and made the basket for the"),
      str("balloon. The balloon is all made and looks impressive! Let's"),
      str("hope it doesn't end the way the experiments did.")
    );
    if (stage < STAGE.LANDED) {
      lines.push(blue("I should speak to Auguste and hear the flight rules. Then we"), blue("can take off."));
      return lines;
    }
    // Ours from here: the landed and completed pages are not recorded.
    if (stage < STAGE.COMPLETE) {
      lines.push(blue("We landed safely in Taverley. I should speak to Auguste."));
      return lines;
    }
    lines.push(str("We landed safely in Taverley, and Auguste gave me a bomber"), str("jacket and cap."), "", red("QUEST COMPLETE!"));
    return lines;
  }

  /**
   * The bomber cap with the XP (the jacket is rewardItemId); zep_quest 200 clears the hand-ins' bits with the reward
   * (capture tick 2122).
   */
  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.CRAFTING, 2000);
    skills.addExperiences(Skill.FARMING, 3000);
    skills.addExperiences(Skill.WOODCUTTING, 1500);
    skills.addExperiences(Skill.FIREMAKING, 4000);
    giveReward(player, BOMBER_CAP, 1);
    sendMaterialVarbits(player);
  }

  /** Before the quest is done, Fly on Auguste answers as live (capture ticks 277, 2112). */
  function flyEarly(event) {
    const { player } = event;
    // Registered for the name "Auguste": Entrana's and the Taverley multinpc (zep_multi_piccard) as he shows.
    if (quest.isComplete(player)) return false;
    player.sendMessage("You should speak to Auguste first.");
    return true;
  }

  function handleLogout({ player }) {
    Scenes.logout(player);
  }

  /** Any stage written another way (::quest) is zep_quest's numbering too. */
  function stageChanged({ player, key }) {
    if (key === QUEST_KEY) player.setAttribute(NUMBERING_ATTRIBUTE, NATIVE_NUMBERING);
  }

  api.persistAttribute(FLAGS_ATTRIBUTE);
  api.persistAttribute(SAPLING_ATTRIBUTE);
  api.persistAttribute(STAN_ATTRIBUTE, 0);
  api.persistAttribute(NUMBERING_ATTRIBUTE, 0);
  api.persistAttribute(RETURN_CHECK_ATTRIBUTE, 0);

  const Scenes = createScenes(api, {
    onFirstDone(player) {
      // Capture tick 528: zep_quest 40 and the balloon gone as the copy closes.
      // A balloon dropped meanwhile: no experiment, it plays again at 20.
      if (stageOf(player) !== STAGE.MATERIALS || !take(player, ORIGAMI_BALLOON)) return;
      setStage(player, STAGE.FIRST_EXPERIMENT);
    },
    onSecondDone(player) {
      // Capture tick 592: zep_quest 60 with the two papyrus and the potatoes gone.
      if (stageOf(player) !== STAGE.FIRST_EXPERIMENT) return;
      if (!held(player, POTATOES) || !held(player, PAPYRUS, EXPERIMENT_TWO_PAPYRUS)) return;
      take(player, PAPYRUS, EXPERIMENT_TWO_PAPYRUS);
      take(player, POTATOES);
      setStage(player, STAGE.SECOND_EXPERIMENT);
    },
    onBasketBuilt: buildBasket,
  });

  quest = registerQuest(api, {
    key: QUEST_KEY,
    name: "Enlightened Journey",
    varpId: VARP_ENLIGHTENED_JOURNEY,
    varbitId: VARBIT_ZEP_QUEST,
    startedValue: STAGE.ACCEPTED,
    completionValue: STAGE.COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.FIREMAKING.getIndex(), amount: 4000, label: "Firemaking" },
      { skillId: Skill.FARMING.getIndex(), amount: 3000, label: "Farming" },
      { skillId: Skill.CRAFTING.getIndex(), amount: 2000, label: "Crafting" },
      { skillId: Skill.WOODCUTTING.getIndex(), amount: 1500, label: "Woodcutting" },
    ],
    rewardItemId: BOMBER_JACKET,
    rewardItemLabel: "Bomber jacket and cap",
    otherRewards: ["Balloon Transport Access"],
    // The scroll as live words it (capture tick 2122): the cap's model, no line for the jacket and cap.
    rewardText: ["1 Quest Point", "4,000 Firemaking XP", "3,000 Farming XP", "2,000 Crafting XP", "1,500 Woodcutting XP", "Balloon Transport Access"],
    scrollItemId: BOMBER_CAP,
    scrollItemPosition: [76, 128],
    buildJournal,
    onReward: grantReward,
  });
  quest.stageKey = `quest.${QUEST_KEY}.stage`;

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("quest:stage-changed", stageChanged);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnNpc(handleItemOnNpc, { noted: false });
  api.onItemAction("Sandbag", { Empty: emptySandbag });
  api.onItemAction("Cap and goggles", { Split: splitCap });
  api.onNpcInteraction("Auguste", { Fly: flyEarly });
  api.onObjectInteraction("Plank", { Use: usePlank });
  api.onObjectInteraction("Dirt", { Leave: leaveCrashSite });
  api.onCustomEvent("balloon-transport:flight-landed", flightLanded);
  api.onCustomEvent("balloon-transport:flight-crashed", flightCrashed);
  api.onCustomEvent("balloon-transport:passenger-arrival", passengerArrived);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onCustomEvent("player:bootstrap-complete", sendWorldVarbits);
  api.onCustomEvent("farming:plant-rules", saplingPlantRules);
  api.onCustomEvent("farming:planted", saplingPlanted);
};
