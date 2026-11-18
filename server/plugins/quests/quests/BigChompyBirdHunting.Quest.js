/**
 * Big Chompy Bird Hunting (members).
 *
 * The words come from the "Big Chompy Bird Hunting" transcript page; Rantz, Fycie and Bugs are
 * indexed, so this plugin supplies the by-stage variant selector, the prose-condition answers, the
 * start hook, the hand-ins and the quest's own interactions. The stage varp is 293 (chompybird) and
 * the kill counter varp 294.
 *
 * Flow, timings, ids and the lines played at each stage follow the user's rev 242 whole-quest capture
 * (docs/quests/big-chompy-bird-hunting/README.md, which lists the capture facts with their ticks); the
 * Wiki (quest page, Transcript:Big Chompy Bird Hunting, Bloated toad, Chompy bird, Locked Ogre chest)
 * where the capture is silent or disagrees.
 *
 * Units: Hunt.BigChompyBirdHunting.js (bait, birds, carcasses), Chest.BigChompyBirdHunting.js (the
 * rock-weighted chest). Arrow fletching is the Fletching plugin's, Suck on swamp bubbles is
 * SwampBubbles', the cave entrance and exits are world/data/loc-teleports.json rows.
 *
 * Revision 241+ spawns Rantz as the nameless parent 1470; interaction events carry the varbit-resolved
 * content id 14793 / 14794, so all are accepted alongside the historical 4855-4857 ids.
 */
module.exports = function registerBigChompyBirdHuntingQuest(api) {
  const { Skill, Item, ItemIdentifiers, NpcIdentifiers, Animation, Graphic, Location, TaskManager, CountdownTask,
    ItemStatementDialogue, Sounds } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Big Chompy Bird Hunting";
  const RANTZ_PAGE = "Rantz";
  const FYCIE_PAGE = "Fycie";
  const BUGS_PAGE = "Bugs";

  const VARP_CHOMPY_BIRD = 293;
  const VARP_CHOMPY_KILLS = 294;
  const VARBIT_SPIT_ROASTER = 1770;
  const VARBIT_CURRENT_HINT_ARROW = 14192;
  const HINT_ARROW_SET = 7;

  const STAGE_STARTED = 5;
  const STAGE_GIVEN_ARROWS = 10;
  const STAGE_KIDS_EXPLAINED_TOADS = 15;
  const STAGE_BELLOWS_TAKEN = 20;
  const STAGE_SHOWN_TOAD = 25;
  const STAGE_WAITING_CHOMPY = 30;
  const STAGE_CHOMPY_MISSED = 35;
  const STAGE_RANTZ_MISSED = 40;
  const STAGE_GIVEN_BOW = 45;
  const STAGE_KILLED_CHOMPY = 50;
  const STAGE_TOLD_TO_COOK = 55;
  const STAGE_CHOMPY_COOKED = 60;
  const STAGE_COMPLETE = 65;

  const START_HOOK = "quest:big-chompy-bird-hunting:start";
  /** "Rantz takes six ogre arrows off you." (Talk-to and item-use variants). */
  const TAKE_ARROWS_MESSAGE_IDS = new Set(["pzg8li", "uvhloX"]);
  /** "Rantz hands over an ogre bow. It's huge! ..." */
  const GIVE_BOW_MESSAGE_ID = "u_dBhh";
  /** Lost-bow reclaim: "You hand over the coins... and Rantz hands over the bow." */
  const RECLAIM_BOW_MESSAGE_ID = "JRiYWE";
  /** Bugs sells a knife and chisel for 10 coins. */
  const BUGS_TOOLS_MESSAGE_ID = "x2E72Z";
  /** Fycie sells 25 feathers for 50 coins. */
  const FYCIE_FEATHERS_MESSAGE_ID = "EA27SG";
  const FYCIE_FEATHER_PRICE = 50;
  const FYCIE_FEATHER_AMOUNT = 25;
  /** "You show the bloated toad to Rantz. He nods with approval." (Talk-to and the toad used on him). */
  const SHOW_TOAD_MESSAGE_IDS = new Set(["rAqfRS", "z8j7q8"]);
  /** "Congratulations! Quest complete!" in handing-the-chompy-to-rantz. */
  const COMPLETE_ACTION_ID = "cmDp4e";

  /** Rantz has more than one cache id but all reach the same transcript pages. */
  const RANTZ_NPC_IDS = new Set([1470, NpcIdentifiers.RANTZ, NpcIdentifiers.RANTZ_2, NpcIdentifiers.RANTZ_3,
    NpcIdentifiers.RANTZ_4, NpcIdentifiers.RANTZ_5, 14794]);
  const FYCIE_NPC_ID = NpcIdentifiers.FYCIE;
  const BUGS_NPC_IDS = new Set([NpcIdentifiers.BUGS, NpcIdentifiers.BUGS_2]);

  const OGRE_ARROW = ItemIdentifiers.OGRE_ARROW;
  const OGRE_BOW = ItemIdentifiers.OGRE_BOW;
  const BLOATED_TOAD = ItemIdentifiers.BLOATED_TOAD;
  const RAW_CHOMPY = ItemIdentifiers.RAW_CHOMPY;
  const SEASONED_CHOMPY = ItemIdentifiers.SEASONED_CHOMPY;
  const COOKED_CHOMPY_IDS = [ItemIdentifiers.COOKED_CHOMPY, ItemIdentifiers.COOKED_CHOMPY_2];
  const OGRE_BELLOWS = ItemIdentifiers.OGRE_BELLOWS;
  const OGRE_BELLOWS_3 = ItemIdentifiers.OGRE_BELLOWS_3_;
  const OGRE_BELLOWS_2 = ItemIdentifiers.OGRE_BELLOWS_2_;
  const OGRE_BELLOWS_1 = ItemIdentifiers.OGRE_BELLOWS_1_;
  /** Wiki (Chompy bird): an ogre bow or comp ogre bow, with ogre arrows or brutal arrows. */
  const CHOMPY_BOWS = new Set([OGRE_BOW, ItemIdentifiers.COMP_OGRE_BOW]);
  const CHOMPY_ARROWS = new Set([OGRE_ARROW, ItemIdentifiers.BRONZE_BRUTAL, ItemIdentifiers.IRON_BRUTAL,
    ItemIdentifiers.STEEL_BRUTAL, ItemIdentifiers.BLACK_BRUTAL, ItemIdentifiers.MITHRIL_BRUTAL,
    ItemIdentifiers.ADAMANT_BRUTAL, ItemIdentifiers.RUNE_BRUTAL]);

  const BELLOWS_STATES = [OGRE_BELLOWS, OGRE_BELLOWS_1, OGRE_BELLOWS_2, OGRE_BELLOWS_3];
  const SWAMP_BUBBLE = api.core.ObjectIdentifiers.SWAMP_BUBBLES;
  const SWAMP_BUBBLE_2 = api.core.ObjectIdentifiers.SWAMP_BUBBLES_2;
  // MULTI_CHOMPYBIRD_SPITROAST_ENTITY has no generated ObjectIdentifiers entry.
  const CHOMPY_SPIT_ROAST = 6895;

  const SWAMP_TOAD = NpcIdentifiers.SWAMP_TOAD;
  const CHOMPY_BIRD = NpcIdentifiers.CHOMPY_BIRD;
  const DEAD_CHOMPY = NpcIdentifiers.CHOMPY_BIRD_2;

  // Animations, graphics and sounds from the capture (README).
  const INFLATE_ANIMATION = 1026;
  const BELLOWS_GRAPHIC = 241;
  const BELLOWS_SOUND = 1455;
  const TOAD_INFLATE_ANIMATION = 1019;
  const EFFECT_DELAY = 30;
  const BELLOWS_GRAPHIC_HEIGHT = 64;
  const PLACE_ANIMATION = 827;
  const PLUCK_ANIMATION = 827;
  const PLUCK_SOUND = 2581;
  const COOK_ANIMATION = 896;
  const COOKED_ANIMATION = 832;
  const SPIT_ROAST_SOUND = 1456;
  const RANTZ_SHOOT_ANIMATION = 1025;
  const RANTZ_ARROW_LAUNCH = 243;
  const RANTZ_ARROW_LAUNCH_HEIGHT = 96;
  const RANTZ_ARROW_TRAVEL = 242;
  const RANTZ_BOW_SOUND = 1452;
  const RANTZ_BOW_SOUND_RANGE = 10;

  /** After the toad is clicked: four ticks to the toad in the pack (ticks 721-725). */
  const INFLATE_TICKS = 4;
  /** After plucking starts: two ticks to the drop (1346-1348). */
  const PLUCK_TICKS = 2;
  /** Each spit-roast step two ticks apart (1472, 1474, 1476). */
  const COOK_STEP_TICKS = 2;
  /** The demonstration from the bird landing (992): 35 at +11, Rantz speaks at +17, shoots at +19, misses at +22. */
  const DEMO_STAGE_TICKS = 11;
  const DEMO_SPEAK_TICKS = 6;
  const DEMO_SHOOT_TICKS = 2;
  const DEMO_MISS_TICKS = 3;
  /** Ours: the stage still moves on if the bird never finishes eating (the capture's ate 4 ticks after the miss). */
  const DEMO_FALLBACK_TICKS = 8;
  /** The clearing's hint arrow lasts 50 ticks (786-836). */
  const BAIT_HINT_TICKS = 50;
  const MAX_BLOATED_TOADS = 3;
  const ESCAPED_TOAD_TICKS = 100;
  const ESCAPED_TOAD_WANDER = 3;
  const PLUCK_HUNTER_XP = 30;

  const BAIT_HINT_TILE = { x: 2636, y: 2966, z: 0, height: 32 };
  const BAIT_CAMERA_LOOK = { x: 2636, y: 2966, height: 25, rate: 7 };
  const BAIT_CAMERA_MOVE = { x: 2639, y: 2956, height: 900, rate: 2 };
  const SPIT_ROAST_TILE = { x: 2630, y: 2990, z: 0 };
  const BOW_RECLAIM_COST = 500;
  const RECLAIM_COIN_STEPS = new Set(["BmgmUE", "Zlt_Rt"]);
  const BUGS_COIN_STEPS = new Set(["71iNkU", "4Q95fX"]);
  const FYCIE_COIN_STEPS = new Set(["CMSJar", "GMF66H"]);

  // Ogre bow show/hat trade uses the bow's kill marks; thresholds and item ids
  // come from cache examines 2978-2995 (Ogre Bowman 30 ... Expert Dragon Archer 4000).
  const CHOMPY_HATS = [
    { label: "ogre bowman", kills: 30, item: 2978 },
    { label: "bowman", kills: 40, item: 2979 },
    { label: "ogre yeoman", kills: 50, item: 2980 },
    { label: "yeoman", kills: 70, item: 2981 },
    { label: "ogre marksman", kills: 95, item: 2982 },
    { label: "marksman", kills: 125, item: 2983 },
    { label: "ogre woodsman", kills: 170, item: 2984 },
    { label: "woodsman", kills: 225, item: 2985 },
    { label: "ogre forester", kills: 300, item: 2986 },
    { label: "forester", kills: 400, item: 2987 },
    { label: "ogre bowmaster", kills: 550, item: 2988 },
    { label: "bowmaster", kills: 700, item: 2989 },
    { label: "ogre expert", kills: 1000, item: 2990 },
    { label: "expert", kills: 1300, item: 2991 },
    { label: "ogre dragon archer", kills: 1700, item: 2992 },
    { label: "dragon archer", kills: 2250, item: 2993 },
    { label: "expert ogre dragon archer", kills: 3000, item: 2994 },
    { label: "expert dragon archer", kills: 4000, item: 2995 },
  ].sort((a, b) => b.label.length - a.label.length);

  const RANTZ_INGREDIENT_ATTRIBUTE = "big-chompy-bird-hunting:rantz-ingredient";
  const BUGS_INGREDIENT_ATTRIBUTE = "big-chompy-bird-hunting:bugs-ingredient";
  const FYCIE_INGREDIENT_ATTRIBUTE = "big-chompy-bird-hunting:fycie-ingredient";
  const BUGS_TOOLS_ATTRIBUTE = "big-chompy-bird-hunting:bugs-tools-bought";
  const FYCIE_FEATHERS_ATTRIBUTE = "big-chompy-bird-hunting:fycie-feathers-bought";
  const CHOMPY_KILLS_ATTRIBUTE = "big-chompy-bird-hunting:chompy-kills";
  const HATS_CLAIMED_ATTRIBUTE = "big-chompy-bird-hunting:hats-claimed";

  /**
   * Each ogre's seasoning: one of a pair, the same every time they are asked (the capture's Rantz says
   * Onion three times, Bugs equa leaves and Fycie tomato twice each; Wiki: "It's different from player
   * to player"). `name` is how the transcript writes it in the refusal and the cooked line.
   */
  const SEASONINGS = {
    rantz: { attribute: RANTZ_INGREDIENT_ATTRIBUTE, choices: [
      { item: ItemIdentifiers.ONION, name: "onion" }, { item: ItemIdentifiers.POTATO, name: "potato" }] },
    fycie: { attribute: FYCIE_INGREDIENT_ATTRIBUTE, choices: [
      { item: ItemIdentifiers.TOMATO, name: "tomato" }, { item: ItemIdentifiers.DOOGLE_LEAVES, name: "doogle leaves" }] },
    bugs: { attribute: BUGS_INGREDIENT_ATTRIBUTE, choices: [
      { item: ItemIdentifiers.EQUA_LEAVES, name: "equa leaves" }, { item: ItemIdentifiers.CABBAGE, name: "cabbage" }] },
  };

  /** The item each captured message box shows (README; the capture draws them in objectbox 193). */
  const MESSAGE_BOX_ITEMS = [
    [/^The ogre shows you a huge but crude bow/, OGRE_BOW],
    [/^Rantz takes six ogre arrows off you\./, OGRE_ARROW],
    [/^You show Rantz the ogre arrow\./, OGRE_ARROW],
    [/^You show the bloated toad to Rantz/, BLOATED_TOAD],
    [/^Rantz hands over an ogre bow\./, OGRE_BOW],
    [/^You show Rantz the freshly plucked chompy carcass\./, RAW_CHOMPY],
    [/^You hand over the cooked chompy bird to Rantz\./, SEASONED_CHOMPY],
    [/^You show Rantz the marks on your bow\./, OGRE_BOW],
  ];

  const page = (p, variant) => ({ page: p, variant });
  const has = (player, itemId, quantity = 1) => player.getInventory().getAmount(itemId) >= quantity;
  const freeSlots = (player) => player.getInventory().getFreeSlots?.() ?? 0;
  const canReceiveFycieFeathers = (player) =>
    player.getInventory().getAddableAmount(new Item(ItemIdentifiers.FEATHER, FYCIE_FEATHER_AMOUNT)) === FYCIE_FEATHER_AMOUNT;
  const hasEquipped = (player, itemId) =>
    (player.getEquipment?.()?.getItems?.() ?? []).some((item) => item?.getId?.() === itemId);
  const hasBow = (player) => has(player, OGRE_BOW) || hasEquipped(player, OGRE_BOW);
  const chompyKills = (player) => Number(player.getAttribute(CHOMPY_KILLS_ATTRIBUTE)) || 0;
  const hatsClaimed = (player) => Number(player.getAttribute(HATS_CLAIMED_ATTRIBUTE)) || 0;
  const hatClaimed = (player, index) => (hatsClaimed(player) & (1 << index)) !== 0;
  const claimableHat = (player) => {
    const kills = chompyKills(player);
    return CHOMPY_HATS.findIndex((hat, index) => kills >= hat.kills && !hatClaimed(player, index));
  };
  const hatForText = (text) => {
    const value = String(text ?? "").toLowerCase();
    return CHOMPY_HATS.find((hat) => value.includes(hat.label));
  };
  const actionFor = (event) => String(event.option ?? event.definition?.getActions?.()?.[event.clickType - 1] ?? "").toLowerCase();
  /** An item box the chat holds until it is continued, as the capture's objectbox (193). */
  const itemBox = (player, itemId, text) => player.getDialogueManager().startDialogues(
    new api.core.DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text)));
  const dropId = (drop) => drop?.itemId ?? drop?.getId?.() ?? drop?.id;
  const dropAmount = (drop) => drop?.amount ?? drop?.getAmount?.() ?? 1;
  const later = (player, ticks, run) => TaskManager.submit(new CountdownTask(player, ticks, () => {
    if (player.isRegistered?.() !== false) run();
  }));

  let quest;
  const hunt = require("./Hunt.BigChompyBirdHunting")(api, {
    onAttracted: handleAttracted,
    onBaitEaten: handleBaitEaten,
    onBirdLeft: handleBirdLeft,
  });
  const chest = require("./Chest.BigChompyBirdHunting")(api, {
    stageOf: (player) => quest.getStage(player),
    onLifted: (player) => {
      if (quest.getStage(player) === STAGE_KIDS_EXPLAINED_TOADS) quest.setStage(player, STAGE_BELLOWS_TAKEN);
    },
  });

  /** The seasoning `who` wants: rolled once per player, then kept. */
  function seasoning(player, who) {
    const { attribute, choices } = SEASONINGS[who];
    const stored = Number(player.getAttribute(attribute)) || 0;
    const known = choices.find((choice) => choice.item === stored);
    if (known) return known;
    const rolled = choices[Math.floor(Math.random() * choices.length)];
    player.setAttribute(attribute, rolled.item);
    return rolled;
  }
  const ogreOf = (npcId) => RANTZ_NPC_IDS.has(npcId) ? "rantz" : BUGS_NPC_IDS.has(npcId) ? "bugs"
    : npcId === FYCIE_NPC_ID ? "fycie" : null;

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return ["<str>I hunted and cooked a seasoned chompy for Rantz.</str>", "", "<col=ff0000>QUEST COMPLETE!</col>"];
    }
    if (stage >= STAGE_CHOMPY_COOKED) return ["Give the <col=800000>seasoned chompy</col> to Rantz."];
    if (stage >= STAGE_TOLD_TO_COOK) return ["Ask <col=800000>Bugs</col> and <col=800000>Fycie</col> which flavours they want,", "then cook the raw chompy on Rantz's spit roast."];
    if (stage >= STAGE_KILLED_CHOMPY) return ["Pluck the dead chompy and show its raw meat to <col=800000>Rantz</col>."];
    if (stage >= STAGE_GIVEN_BOW) return ["Shoot the chompy with the <col=800000>ogre bow</col> and ogre arrows."];
    if (stage >= STAGE_RANTZ_MISSED) return ["Talk to <col=800000>Rantz</col> and ask him to let you use the ogre bow."];
    if (stage >= STAGE_CHOMPY_MISSED) return ["Wait for Rantz to finish shooting at the chompy."];
    if (stage >= STAGE_WAITING_CHOMPY) return ["Wait for the chompy to come to the bait."];
    if (stage >= STAGE_SHOWN_TOAD) return ["Drop a <col=800000>bloated toad</col> in the clearing south of Rantz."];
    if (stage >= STAGE_BELLOWS_TAKEN) return ["Fill the ogre bellows at swamp bubbles, inflate a swamp toad,", "then show the bloated toad to <col=800000>Rantz</col>."];
    if (stage >= STAGE_KIDS_EXPLAINED_TOADS) return ["Open the rock-covered chest in the cave for ogre bellows."];
    if (stage >= STAGE_GIVEN_ARROWS) return ["Ask Rantz how to attract a chompy, then speak to his children."];
    if (stage >= STAGE_STARTED) return ["Make six ogre arrows from achey logs, wolf bones and feathers,", "then give the arrows to <col=800000>Rantz</col>."];
    return ["I can start this quest by talking to <col=800000>Rantz</col> by the eastern coast of the <col=800000>Feldip Hills</col>."];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.COOKING, 1470);
    skills.addExperiences(Skill.RANGED, 735);
    skills.addExperiences(Skill.FLETCHING, 262);
  }

  /** Which transcript variant the clicked NPC plays, by quest stage (capture ticks in the README). */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);

    if (RANTZ_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return page(RANTZ_PAGE, "after-big-chompy-bird-hunting");
      if (stage >= STAGE_CHOMPY_COOKED) return page(PAGE, "handing-the-chompy-to-rantz-or-trying-to-cook-another-raw-chompy");
      if (stage >= STAGE_TOLD_TO_COOK) return page(PAGE, "talking-to-rantz-with-a-raw-chompy-talking-to-rantz-again-before-cooking-the-chompy");
      if (stage >= STAGE_KILLED_CHOMPY && has(player, RAW_CHOMPY)) return page(PAGE, "talking-to-rantz-with-a-raw-chompy");
      if (stage >= STAGE_GIVEN_BOW) {
        if (stage < STAGE_KILLED_CHOMPY && !hasBow(player)) {
          return page(PAGE, "talking-to-rantz-after-he-failed-reclaiming-a-lost-bow");
        }
        return page(PAGE, "talking-to-rantz-after-he-failed-talking-to-rantz-before-hunting-the-chompy");
      }
      if (stage >= STAGE_RANTZ_MISSED) return page(PAGE, "talking-to-rantz-after-he-failed");
      // The bait is down (30) and while Rantz shoots (35): ticks 894, 1010.
      if (stage >= STAGE_WAITING_CHOMPY) return page(PAGE, "placing-the-bloated-toad-talking-to-rantz-after-placing-the-toad");
      if (stage === STAGE_SHOWN_TOAD) return page(PAGE, "returning-to-rantz-with-the-bloated-toad-talking-to-rantz-again");
      if (stage >= STAGE_KIDS_EXPLAINED_TOADS) {
        return page(PAGE, has(player, BLOATED_TOAD)
          ? "returning-to-rantz-with-the-bloated-toad"
          : "using-ogre-arrows-made-by-the-player-on-rantz-returning-to-rantz-without-a-bloated-toad");
      }
      if (stage >= STAGE_GIVEN_ARROWS) return page(PAGE, "using-ogre-arrows-made-by-the-player-on-rantz-returning-to-rantz-without-a-bloated-toad");
      if (stage >= STAGE_STARTED) {
        return page(PAGE, has(player, OGRE_ARROW, 6)
          ? "returning-to-rantz-with-six-or-more-ogre-arrows"
          : "starting-off-returning-to-rantz-without-ogre-arrows");
      }
      return page(PAGE, "starting-off");
    }

    const kid = npcId === FYCIE_NPC_ID ? "fycie" : BUGS_NPC_IDS.has(npcId) ? "bugs" : null;
    if (!kid) return null;
    if (stage >= STAGE_COMPLETE) return page(kid === "fycie" ? FYCIE_PAGE : BUGS_PAGE, "after-big-chompy-bird-hunting");
    if (stage >= STAGE_CHOMPY_COOKED) return page(PAGE, `cooking-the-chompy-talking-to-${kid}`);
    if (stage >= STAGE_TOLD_TO_COOK) return page(PAGE, `talking-to-rantz-with-a-raw-chompy-getting-the-ingredient-order-from-${kid}`);
    // Until the toad is shown both ask about the "fatsy toadies" (ticks 628, 638 at 15 and 657 at 20);
    // from then on they send the player back to Rantz (1150, 1154 at 45).
    if (stage >= STAGE_SHOWN_TOAD) return page(PAGE, `returning-to-rantz-with-the-bloated-toad-talking-to-${kid}`);
    if (stage >= STAGE_GIVEN_ARROWS) return page(PAGE, `using-ogre-arrows-made-by-the-player-on-rantz-talking-to-${kid}`);
    if (stage >= STAGE_STARTED) {
      if (kid === "fycie") {
        return page(PAGE, player.getAttribute(FYCIE_FEATHERS_ATTRIBUTE)
          ? "starting-off-talking-to-fycie-talking-to-fycie-after-buying-her-feathers"
          : "starting-off-talking-to-fycie");
      }
      return page(PAGE, player.getAttribute(BUGS_TOOLS_ATTRIBUTE)
        ? "starting-off-talking-to-bugs-without-a-chisel-and-knife-talking-to-bugs-after-buying-his-chisel-and-knife"
        : "starting-off-talking-to-bugs-without-a-chisel-and-knife");
    }
    return null;
  }

  /** Answer the transcript's prose conditions, scoped to this quest's NPCs and steps. */
  function answerCondition({ player, npcId, text, stepId }) {
    const isOurs = RANTZ_NPC_IDS.has(npcId) || npcId === FYCIE_NPC_ID || BUGS_NPC_IDS.has(npcId);
    if (!isOurs) return null;
    const value = String(text).toLowerCase();
    if (value.includes("more than six ogre arrows not made by themselves")) return false;
    if (value.includes("has less than six ogre arrows")) return !has(player, OGRE_ARROW, 6);
    if (value.includes("has six or more ogre arrows")) return has(player, OGRE_ARROW, 6);
    if (value.includes("using a raw chompy on rantz")) return false;
    if (value.includes("using ogre arrows not made by the player")) return false;
    if (value.includes("missing at least one requirement")) {
      if (!RANTZ_NPC_IDS.has(npcId) || stepId !== "THE8iv") return null;
      const skills = player.getSkillManager();
      return skills.getMaxLevel(Skill.RANGED) < 30
        || skills.getMaxLevel(Skill.COOKING) < 30
        || skills.getMaxLevel(Skill.FLETCHING) < 5;
    }
    if (value.includes("does not have the bow")) return !hasBow(player);
    if (value.includes("has an ogre bow")) return hasBow(player);
    if (value.includes("already claimed all newly claimable hats")) {
      return chompyKills(player) >= 30 && claimableHat(player) < 0;
    }
    if (value.includes("has 0 chompy kills")) return chompyKills(player) === 0;
    if (value.includes("at least one but less than 30 chompy kills")) {
      const kills = chompyKills(player);
      return kills >= 1 && kills < 30;
    }
    if (value.includes("obtained enough chompy kills for a new hat")) return claimableHat(player) >= 0;
    if (value.includes("full inventory at any point now or below")) return freeSlots(player) <= 0;
    if (value.includes("has enough inventory space")) return freeSlots(player) > 0;
    if (value.includes("not claimed the") && value.includes("hat before")) {
      const hat = hatForText(value);
      if (hat) return chompyKills(player) >= hat.kills && !hatClaimed(player, CHOMPY_HATS.indexOf(hat));
    }
    if (value.includes("doesn't have enough coins") || value.includes("has enough coins")) {
      if (!RANTZ_NPC_IDS.has(npcId) || !RECLAIM_COIN_STEPS.has(stepId)) return null;
      return value.includes("doesn't")
        ? !has(player, ItemIdentifiers.COINS, BOW_RECLAIM_COST)
        : has(player, ItemIdentifiers.COINS, BOW_RECLAIM_COST);
    }
    if (value.includes("does not have 10 coins") || value.includes("has 10 coins and inventory space")) {
      if (!BUGS_NPC_IDS.has(npcId) || !BUGS_COIN_STEPS.has(stepId)) return null;
      return value.includes("does not")
        ? !has(player, ItemIdentifiers.COINS, 10)
        : has(player, ItemIdentifiers.COINS, 10) && freeSlots(player) >= 2;
    }
    if (value.includes("does not have 50 coins") || value.includes("has 50 coins and inventory space")) {
      if (npcId !== FYCIE_NPC_ID || !FYCIE_COIN_STEPS.has(stepId)) return null;
      return value.includes("does not")
        ? !has(player, ItemIdentifiers.COINS, FYCIE_FEATHER_PRICE)
        : has(player, ItemIdentifiers.COINS, FYCIE_FEATHER_PRICE) && freeSlots(player) >= 1 && canReceiveFycieFeathers(player);
    }
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!RANTZ_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  /**
   * Bellows on swamp bubbles (Wiki: Ogre bellows, "use the bellows on the swamp bubbles to fill them without
   * delay"; Suck is SwampBubbles'), and the raw chompy on Rantz's spit-roast. Ours: the use's two lines (no
   * capture uses the bellows on the bubbles).
   */
  function handleItemOnObject(event) {
    const { player, objectId } = event;
    const itemId = event.itemId ?? event.item?.getId?.();
    if (objectId === SWAMP_BUBBLE || objectId === SWAMP_BUBBLE_2) {
      if (quest.getStage(player) < STAGE_KIDS_EXPLAINED_TOADS) return;
      if (!BELLOWS_STATES.includes(itemId) || !has(player, itemId)) return;
      event.handled = true;
      if (itemId === OGRE_BELLOWS_3) {
        player.sendMessage("Your ogre bellows are already full of swamp gas.");
        return;
      }
      player.getInventory().deleteNumber(itemId, 1);
      player.getInventory().adds(OGRE_BELLOWS_3, 1);
      player.sendMessage("You fill the ogre bellows with thick swamp gas.");
      return;
    }
    if (objectId === CHOMPY_SPIT_ROAST && itemId === RAW_CHOMPY) {
      const location = event.location ?? event.object?.getLocation?.();
      const x = location?.getX?.() ?? location?.x, y = location?.getY?.() ?? location?.y;
      if (location && (x !== SPIT_ROAST_TILE.x || y !== SPIT_ROAST_TILE.y)) return;
      cookChompy(event);
    }
  }

  const cooking = new WeakMap();

  /**
   * The capture's spit-roast (ticks 1472-1476): "You carefully place the chompy bird on the spit-roast.",
   * the roaster varbit 1, human_cooking and two spit_roast sounds, the raw chompy gone; two ticks later
   * "You add the other ingredients and cook the food." with the varbit at 2; two more and "Eventually the
   * chompy is cooked.", the varbit back to 0, human_pickuptable, the seasonings swapped for the seasoned
   * chompy and an item box naming them (Rantz's, Fycie's, Bugs's, as the transcript's template orders them).
   */
  function cookChompy(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_TOLD_TO_COOK || quest.isComplete(player)) return;
    if (stage >= STAGE_CHOMPY_COOKED && has(player, SEASONED_CHOMPY)) return;
    if (!has(player, RAW_CHOMPY) || cooking.has(player)) return;
    event.handled = true;
    const wanted = [seasoning(player, "rantz"), seasoning(player, "fycie"), seasoning(player, "bugs")];
    if (!wanted.every(({ item }) => has(player, item))) {
      // Both lines of the transcript's refusal ("…without-the-requested-ingredients"); the second is a
      // template there ("[potato/onion]" is the Wiki's either/or), filled with what this player was given.
      player.sendMessage("You don't have all the ingredients yet to cook the chompy bird for the ogre family.");
      const [rantz, fycie, bugs] = wanted.map(({ name }) => name);
      player.sendMessage(`Remember what the Ogre family wanted? Rantz wanted ${rantz}. Fycie wanted ${fycie}. Bugs wanted ${bugs}.`);
      return;
    }
    player.getInventory().deleteNumber(RAW_CHOMPY, 1);
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_SPIT_ROASTER, 1);
    player.sendMessage("You carefully place the chompy bird on the spit-roast.");
    player.performAnimation(new Animation(COOK_ANIMATION));
    sender.sendSound(SPIT_ROAST_SOUND, 255, EFFECT_DELAY);
    sender.sendSound(SPIT_ROAST_SOUND, 255, EFFECT_DELAY);
    const finish = () => {
      if (cooking.get(player) !== finish) return;
      cooking.delete(player);
      for (const { item } of wanted) player.getInventory().deleteNumber(item, 1);
      player.getInventory().adds(SEASONED_CHOMPY, 1);
      if (quest.getStage(player) < STAGE_CHOMPY_COOKED) quest.setStage(player, STAGE_CHOMPY_COOKED);
      sender.sendVarbit(VARBIT_SPIT_ROASTER, 0);
    };
    cooking.set(player, finish);
    later(player, COOK_STEP_TICKS, () => {
      player.sendMessage("You add the other ingredients and cook the food.");
      sender.sendVarbit(VARBIT_SPIT_ROASTER, 2);
      player.performAnimation(new Animation(COOK_ANIMATION));
    });
    later(player, COOK_STEP_TICKS * 2, () => {
      if (cooking.get(player) !== finish) return;
      player.sendMessage("Eventually the chompy is cooked.");
      finish();
      player.performAnimation(new Animation(COOKED_ANIMATION));
      const [rantz, fycie, bugs] = wanted.map(({ name }) => name);
      itemBox(player, SEASONED_CHOMPY,
        `You use the ${rantz}, ${fycie} and the ${bugs} with the chompy bird to make a seasoned chompy.`);
    });
  }

  /** Inflate on a swamp toad (or filled bellows used on one), and Pluck on a carcass. */
  function handleNpcInteraction(event) {
    const npc = event.npc;
    const npcId = event.npcId ?? npc?.getId?.();
    const action = actionFor(event);
    if (npcId === SWAMP_TOAD && action.includes("inflate")) {
      inflateToad(event);
      return;
    }
    if ((npcId === DEAD_CHOMPY || hunt.ownsCarcass(event.player, npc)) && action.includes("pluck")) pluckChompy(event);
  }

  const inflating = new WeakSet();

  /**
   * The capture's inflate (ticks 719-725, 1238-1248): on arrival "Come here toady!", the bellows
   * animation and graphic and sound 1455 (30 client cycles late), the toad's own inflate animation
   * 1019 and "You manage to catch the toad and inflate it with the swamp gas."; four ticks later the
   * toad is gone, the bellows one load lighter and "You add the bloated toad to your inventory.". With
   * three bloated toads already (Wiki: "You can only carry a maximum of three"), one escapes first:
   * "One of your bloated toads manages to escape." and a swamp toad hops out with "Ribbitt!".
   */
  function inflateToad(event) {
    const { player, npc } = event;
    if (!npc?.isRegistered?.() || inflating.has(npc)) return;
    const bellowsState = [OGRE_BELLOWS_1, OGRE_BELLOWS_2, OGRE_BELLOWS_3].find((id) => has(player, id));
    // Ours: without filled bellows (or before the quest gives them) nothing happens, as for any other use.
    if (bellowsState === undefined) return;
    event.handled = true;
    const escapes = player.getInventory().getAmount(BLOATED_TOAD) >= MAX_BLOATED_TOADS;
    // Ours: the old full-pack refusal, kept (no capture inflates with a full pack).
    if (!escapes && freeSlots(player) <= 0) {
      player.sendMessage("You need an empty inventory slot for the bloated toad.");
      return;
    }
    if (escapes) {
      const slot = player.getInventory().getItems().findIndex((item) => item?.getId?.() === BLOATED_TOAD);
      if (slot >= 0) player.getInventory().deleteAtSlot(slot);
      player.sendMessage("One of your bloated toads manages to escape.");
      const at = npc.getLocation();
      const escaped = api.spawnNpc({ id: SWAMP_TOAD, x: at.getX(), y: at.getY(), z: at.getZ(), wanderRadius: ESCAPED_TOAD_WANDER });
      escaped?.forceChat?.("Ribbitt!");
      // Ours: the escaped toad hops off after a while rather than adding to the swamp for good.
      if (escaped) TaskManager.submit(new CountdownTask(escaped, ESCAPED_TOAD_TICKS, () => api.removeNpc(escaped)));
    }
    inflating.add(npc);
    player.setPositionToFace?.(npc.getLocation());
    npc.setPositionToFace?.(player.getLocation());
    player.forceChat("Come here toady!");
    player.performAnimation(new Animation(INFLATE_ANIMATION, EFFECT_DELAY));
    player.performGraphic(new Graphic(BELLOWS_GRAPHIC, EFFECT_DELAY, BELLOWS_GRAPHIC_HEIGHT));
    npc.performAnimation(new Animation(TOAD_INFLATE_ANIMATION, EFFECT_DELAY));
    player.getPacketSender().sendSound(BELLOWS_SOUND, 255, EFFECT_DELAY);
    player.getPacketSender().sendTypedMessage(api.core.ChatType.SPAM, "You manage to catch the toad and inflate it with the swamp gas.");
    later(player, INFLATE_TICKS, () => {
      inflating.delete(npc);
      const state = [OGRE_BELLOWS_1, OGRE_BELLOWS_2, OGRE_BELLOWS_3].find((id) => has(player, id));
      if (state === undefined || !npc.isRegistered() || freeSlots(player) <= 0) return;
      const nextState = state === OGRE_BELLOWS_3 ? OGRE_BELLOWS_2 : state === OGRE_BELLOWS_2 ? OGRE_BELLOWS_1 : OGRE_BELLOWS;
      const slot = player.getInventory().getItems().findIndex((item) => item?.getId?.() === state);
      player.getInventory().setItem(slot, new Item(nextState, 1));
      player.getInventory().adds(BLOATED_TOAD, 1);
      player.getInventory().refreshItems();
      // The swamp comes back to life: the toad respawns as one killed would.
      const respawn = npc.getDefinition?.()?.getRespawn?.() ?? 0;
      api.removeNpc(npc);
      if (respawn > 0) TaskManager.submit(new api.core.NPCRespawnTask(npc, respawn));
      player.getPacketSender().sendTypedMessage(api.core.ChatType.SPAM, "You add the bloated toad to your inventory.");
    });
  }

  /**
   * The capture's pluck (ticks 1344-1348): on arrival "You start plucking the chompy bird.",
   * human_pickupfloor and sound 2581; two ticks later the carcass is gone, the raw chompy and the bones
   * are on its tile, the feathers in the pack (15 there; Wiki: 10-30) and 30 Hunter XP (Wiki: Chompy bird).
   * Ours: feathers that don't fit in the pack land with the rest.
   */
  function pluckChompy(event) {
    const { player, npc } = event;
    event.handled = true;
    if (!player.isRegistered() || player.busy() || !hunt.ownsCarcass(player, npc) ||
        !npc?.isRegistered() || npc.getOwner() !== player || npc.getAttribute?.("chompy:plucking") ||
        npc.getPrivateArea() !== player.getPrivateArea() ||
        !player.getLocation().isWithinDistance(npc.getLocation(), 1)) return;
    npc.setAttribute?.("chompy:plucking", true);
    player.getPacketSender().sendTypedMessage(api.core.ChatType.SPAM, "You start plucking the chompy bird.");
    player.performAnimation(new Animation(PLUCK_ANIMATION));
    player.getPacketSender().sendSound(PLUCK_SOUND);
    later(player, PLUCK_TICKS, () => {
      if (!npc.isRegistered() || !hunt.ownsCarcass(player, npc)) return;
      const at = npc.getLocation().clone();
      hunt.forgetCarcass(npc);
      npc.getPrivateArea()?.detach(npc);
      api.removeNpc(npc);
      // The bird's generated drop table (bones, raw chompy, 10-30 feathers) without the chick, which
      // the pets unit rolls on "chompy:plucked". The feathers go in the pack, the rest on the carcass's tile.
      const drops = [];
      api.emitCustomEvent("npc-drops:roll-table", { player, npc, npcId: CHOMPY_BIRD, drops,
        entryFilter: (entry) => entry.item_id !== ItemIdentifiers.CHOMPY_CHICK });
      const packed = drops.filter((drop) => dropId(drop) === ItemIdentifiers.FEATHER
        && player.getInventory().getAddableAmount(new Item(dropId(drop), dropAmount(drop))) >= dropAmount(drop));
      for (const drop of packed) player.getInventory().add(new Item(dropId(drop), dropAmount(drop)));
      api.emitCustomEvent("npc-drops:place", { player, drops: drops.filter((drop) => !packed.includes(drop)), location: at, npcId: CHOMPY_BIRD });
      if (packed.length) api.emitCustomEvent("npc-drops:report", { player, npcId: CHOMPY_BIRD, drops: packed });
      player.getSkillManager().addExperiences(Skill.HUNTER, PLUCK_HUNTER_XP);
      api.emitCustomEvent("chompy:plucked", { player, npc });
    });
  }

  function hint(player, show) {
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_CURRENT_HINT_ARROW, show ? HINT_ARROW_SET : 0);
    sender.clearHintArrow();
    return sender;
  }

  function nearbyRantz(player) {
    const world = api.core.World;
    const near = world?.getNpcsNear?.(player.getLocation(), 16, player.getPrivateArea?.() ?? null) ?? [];
    return [...near].find((npc) => RANTZ_NPC_IDS.has(npc?.getId?.()));
  }

  /** The demonstration bird Rantz shoots at, and the player it was called down for. */
  const demonstrations = new Map();

  function cancelDemonstration(player) {
    const demo = demonstrations.get(player);
    if (!demo) return;
    demonstrations.delete(player);
    TaskManager.cancelTasks(demo.key);
  }

  /** The demonstration step needs this many ticks after the landing tick (each delay counts from the last). */
  function demoStep(demo, ticks, run) {
    TaskManager.submit(new CountdownTask(demo.key, ticks, () => {
      if (demonstrations.get(demo.player) === demo && demo.player.isRegistered?.() !== false) run();
    }));
  }

  /**
   * The capture's demonstration (ticks 992-1018), from the bird landing: the quest moves to 35 eleven ticks
   * later; six more and Rantz says "Hey, dere's da chompy, I's gonna shoot it." (overhead and in chat); two more
   * and he shoots (ogre_longbow, the ogre arrow launch at height 96, sound 1452 range 10, the ogre arrow at the
   * bird); three more and "Rantz keeps missing the chompy bird..." with his "Grrr...de'ese arrows are rubbish.".
   * The bird eats the bait meanwhile and the quest moves to 40 as the bait goes. No camera moves.
   */
  function startDemonstration(player, npc) {
    if (demonstrations.has(player)) return;
    const demo = { key: {}, player, npc };
    demonstrations.set(player, demo);
    demoStep(demo, DEMO_STAGE_TICKS, () => {
      if (quest.getStage(player) === STAGE_WAITING_CHOMPY) quest.setStage(player, STAGE_CHOMPY_MISSED);
      demoStep(demo, DEMO_SPEAK_TICKS, () => {
        const rantz = nearbyRantz(player);
        rantz?.forceChat?.("Hey, dere's da chompy, I's gonna shoot it.");
        player.sendMessage("Rantz: Hey, dere's da chompy, I's gonna shoot it.");
        demoStep(demo, DEMO_SHOOT_TICKS, () => {
          if (rantz?.isRegistered?.() && npc.isRegistered()) rantzShoots(rantz, npc);
          demoStep(demo, DEMO_MISS_TICKS, () => {
            player.sendMessage("Rantz keeps missing the chompy bird...");
            player.sendMessage("Rantz: Grrr...de'ese arrows are rubbish.");
            rantz?.forceChat?.("Grrr...de'ese arrows are rubbish.");
            demoStep(demo, DEMO_FALLBACK_TICKS, () => demonstrationOver(player));
          });
        });
      });
    });
  }

  function rantzShoots(rantz, npc) {
    rantz.setPositionToFace?.(npc.getLocation());
    rantz.performAnimation(new Animation(RANTZ_SHOOT_ANIMATION));
    rantz.performGraphic(new Graphic(RANTZ_ARROW_LAUNCH, 0, RANTZ_ARROW_LAUNCH_HEIGHT));
    const at = rantz.getLocation();
    Sounds.playAreaSound({ soundId: RANTZ_BOW_SOUND, x: at.getX(), y: at.getY(), level: at.getZ(),
      radius: RANTZ_BOW_SOUND_RANGE, source: rantz });
    // Captured flight: client cycles 41 -> 116, heights 155 -> 146 on the wire (quarter units here), angle 5.
    api.core.Projectile.createProjectile(rantz, npc, RANTZ_ARROW_TRAVEL, 41, 116, 38.75, 36.5)
      .withAngle(5).withProgress(11).sendProjectile();
  }

  function demonstrationOver(player) {
    if (!demonstrations.has(player)) return;
    cancelDemonstration(player);
    const stage = quest.getStage(player);
    if (stage === STAGE_CHOMPY_MISSED || stage === STAGE_WAITING_CHOMPY) quest.setStage(player, STAGE_RANTZ_MISSED);
  }

  function handleAttracted({ player, npc }) {
    const stage = quest.getStage(player);
    if (stage === STAGE_WAITING_CHOMPY && player.getPrivateArea() === npc.getPrivateArea()) {
      startDemonstration(player, npc);
      return;
    }
    // The hunt's bird gets the hint arrow while the quest asks for it (tick 1323; cleared at the kill, 1339).
    if (stage === STAGE_GIVEN_BOW) hint(player, true).sendEntityHint(npc);
  }

  function handleBaitEaten({ player, npc }) {
    const demo = demonstrations.get(player);
    if (demo?.npc === npc && quest.getStage(player) === STAGE_CHOMPY_MISSED) demonstrationOver(player);
  }

  /** Ours: the arrow comes off a bird that flies away unkilled (no capture shows that). */
  function handleBirdLeft({ player }) {
    if (quest.getStage(player) === STAGE_GIVEN_BOW) hint(player, false);
  }

  function incrementChompyKills(player) {
    // Content may count a kill as more than one ("big-chompy-bird-hunting:kill-credit", a league fragment).
    const credit = { player, kills: 1 };
    api.emitCustomEvent?.("big-chompy-bird-hunting:kill-credit", credit);
    const kills = chompyKills(player) + (Number.isSafeInteger(credit.kills) && credit.kills > 1 ? credit.kills : 1);
    player.setAttribute(CHOMPY_KILLS_ATTRIBUTE, kills);
    player.getPacketSender?.().sendConfig?.(VARP_CHOMPY_KILLS, kills);
    return kills;
  }

  function grantHat(player, text) {
    if (quest.getStage(player) < STAGE_COMPLETE || !hasBow(player) || freeSlots(player) <= 0) return;
    const hat = hatForText(text);
    if (!hat) return;
    const index = CHOMPY_HATS.indexOf(hat);
    if (hatClaimed(player, index)) return;
    if (!has(player, hat.item)) {
      player.getInventory().adds(hat.item, 1);
      api.emitCustomEvent("collection-log:obtain", { player, itemId: hat.item, amount: 1 });
    }
    player.setAttribute(HATS_CLAIMED_ATTRIBUTE, hatsClaimed(player) | (1 << index));
    api.emitCustomEvent?.("big-chompy-bird-hunting:hat-claimed", { player, hat: hat.label, kills: chompyKills(player) });
  }

  /**
   * Chompys can only be hurt with an ogre bow or comp ogre bow and ogre or brutal arrows; the refusals are
   * the Wiki's (Transcript:Chompy bird). Ours: before Rantz lends the bow the bird can't be attacked, silently.
   */
  function handleCanAttack(event) {
    const { attacker, target } = event;
    if (!attacker?.isPlayer?.()) return;
    if (hunt.isLeaving(target) || hunt.ownsCarcass(attacker, target)) {
      event.allow = false;
      return;
    }
    if (!hunt.ownsBird(attacker, target)) return;
    if (quest.getStage(attacker) < STAGE_GIVEN_BOW) {
      event.allow = false;
      return;
    }
    const { Equipment, CombatType } = api.core;
    const equipment = attacker.getEquipment?.();
    const weapon = equipment?.get?.(Equipment.WEAPON_SLOT)?.getId?.() ?? -1;
    const arrows = equipment?.get?.(Equipment.AMMUNITION_SLOT)?.getId?.();
    const type = event.method?.type?.();
    if (type === CombatType?.MAGIC) {
      event.allow = false;
      event.message = "Magic simply won't affect this beast!";
    } else if (weapon <= 0) {
      event.allow = false;
      event.message = "You'll need a weapon to try and attack this beast.";
    } else if (type === CombatType?.MELEE) {
      event.allow = false;
      event.message = "The Chompy Bird is too quick for your melee weapon.";
    } else if (!CHOMPY_BOWS.has(weapon) || !CHOMPY_ARROWS.has(arrows)) {
      event.allow = false;
      event.message = "Your ranged weapon isn't powerful enough to hurt the Chompy bird.";
    }
  }

  /**
   * The hunted chompy becomes its carcass where it fell (capture tick 1339: chompy_update_death and the
   * transformation to 1476 on one tick, the quest at 50 and the hint arrow cleared). Wiki: the carcass
   * lasts two minutes; after the quest each kill is "You scratch a notch on your bow for the chompy bird kill.".
   */
  function handleNpcDeath(event) {
    const npcId = event.npcId ?? event.npc?.getId?.();
    if (npcId !== CHOMPY_BIRD) return;
    const player = event.killer;
    if (!player?.isPlayer?.() || !hunt.ownsBird(player, event.npc)) return;
    hunt.removeBird(event.npc);
    const stage = quest.getStage(player);
    if (stage >= STAGE_GIVEN_BOW && stage < STAGE_KILLED_CHOMPY) {
      quest.setStage(player, STAGE_KILLED_CHOMPY);
      hint(player, false);
    }
    if (quest.isComplete(player)) {
      incrementChompyKills(player);
      player.sendMessage("You scratch a notch on your bow for the chompy bird kill.");
    }
    const npc = event.npc;
    event.remains = { ticks: hunt.CARCASS_TICKS + 1, respawnTicks: 0 };
    npc.setNpcTransformationId(DEAD_CHOMPY);
    // Clicks from a distance need hitpoints above 0 to walk to it (Araxxor's corpse does the same).
    npc.setHitpoints?.(1);
    hunt.trackCarcass(npc, player);
  }

  /**
   * A hunted bird drops nothing when it dies (capture tick 1339): its loot comes from the pluck. The kill still
   * rolls the chick (Wiki: Chompy chick), through the pets unit.
   */
  function handleDropClaim(claim) {
    const { killer, npc } = claim;
    if (claim.npcId !== CHOMPY_BIRD || !killer?.isPlayer?.()) return;
    if (!hunt.ownsBird(killer, npc) && !hunt.ownsCarcass(killer, npc)) return;
    claim.handled = true;
    api.emitCustomEvent("chompy:killed", { player: killer, npc });
  }

  /** Drop places bait; Release / Release All let the toads escape instead. */
  function handleItemAction(event) {
    const option = String(event.option ?? "").toLowerCase();
    if (event.itemId !== BLOATED_TOAD) return;
    if (option === "release" || option === "release all") {
      event.handled = true;
      const inventory = event.player.getInventory();
      if (inventory.getItems()[event.slot]?.getId() !== BLOATED_TOAD) return;
      if (option === "release all") {
        for (let slot = 0; slot < inventory.capacity(); slot++) {
          if (inventory.getItems()[slot]?.getId() === BLOATED_TOAD) inventory.deleteAtSlot(slot);
        }
      } else {
        inventory.deleteAtSlot(event.slot);
      }
      event.player.forceChat("Free the fatsy toady!");
      return;
    }
    if (option !== "drop") return;
    const { player } = event;
    const stage = quest.getStage(player);
    event.handled = true;
    if (stage < STAGE_SHOWN_TOAD) {
      player.sendMessage("You're not sure where Rantz told you to place the bloated toad. You decide to wait and ask him where to place it.");
      return;
    }
    if (player.getInventory().getAmount(BLOATED_TOAD) <= 0) return;
    if (!hunt.place(player)) return;
    player.getInventory().deleteNumber(BLOATED_TOAD, 1);
    player.performAnimation(new Animation(PLACE_ANIMATION));
    player.getPacketSender().sendTypedMessage(api.core.ChatType.SPAM, "You carefully place the bloated toad bait.");
    if (stage === STAGE_SHOWN_TOAD) quest.setStage(player, STAGE_WAITING_CHOMPY);
  }

  /** The hats branch of Rantz's post-quest page: the "Can I have a hat please?" answer, past his "show me" line. */
  function hatClaimSteps(steps) {
    const menu = steps.find((step) => step.type === "choice");
    const ask = menu?.options?.find((option) => option.text === "Can I have a hat please?");
    const shown = ask?.steps?.find((step) => step.type === "condition" && /has an ogre bow/i.test(step.text));
    return shown ? [shown] : null;
  }

  /** Items used on Rantz: arrows, the bloated toad, the ogre bow, the raw and cooked chompy. */
  function handleItemOnNpc(event) {
    const npcId = event.npcId ?? event.target?.getId?.();
    if (npcId === SWAMP_TOAD && [OGRE_BELLOWS_1, OGRE_BELLOWS_2, OGRE_BELLOWS_3].includes(event.itemId)) {
      inflateToad({ ...event, npc: event.npc ?? event.target });
      if (inflating.has(event.npc ?? event.target)) event.handled = true;
      return;
    }
    if (!RANTZ_NPC_IDS.has(npcId)) return;
    const { player } = event;
    const stage = quest.getStage(player);
    const play = (variant, from = PAGE) => {
      event.handled = true;
      startTranscript(api, player, npcId, from, variant);
    };
    if (quest.isComplete(player) && COOKED_CHOMPY_IDS.includes(event.itemId)) {
      player.getInventory().deleteNumber(event.itemId, 1);
      play("giving-rantz-a-cooked-chompy", RANTZ_PAGE);
      return;
    }
    if (event.itemId === OGRE_BOW) {
      if (quest.isComplete(player)) {
        // The capture's bow on Rantz after the quest (tick 1643): straight to "You show Rantz the marks on your bow.".
        const request = { player, npc: event.target, npcId, variant: page(RANTZ_PAGE, "after-big-chompy-bird-hunting"),
          select: hatClaimSteps };
        api.emitCustomEvent("npc-dialogue:start", request);
        if (request.handled) event.handled = true;
      } else if (stage >= STAGE_RANTZ_MISSED && stage < STAGE_KILLED_CHOMPY) {
        play("talking-to-rantz-after-he-failed-using-the-ogre-bow-on-rantz");
      }
      return;
    }
    if (event.itemId === BLOATED_TOAD) {
      // Tick 826 at 25: "You show the bloated toad to Rantz." and his "...Is you's gonna stick da chompy?".
      if (stage === STAGE_BELLOWS_TAKEN) play("returning-to-rantz-with-the-bloated-toad-using-the-bloated-toad-on-rantz");
      else if (stage >= STAGE_SHOWN_TOAD && stage < STAGE_COMPLETE) {
        play("returning-to-rantz-with-the-bloated-toad-using-the-bloated-toad-on-rantz-using-another-toad-on-rantz");
      }
      return;
    }
    if (event.itemId === RAW_CHOMPY) {
      if (stage === STAGE_KILLED_CHOMPY) play("talking-to-rantz-with-a-raw-chompy-using-a-raw-chompy-on-rantz");
      else if (stage === STAGE_TOLD_TO_COOK) play("talking-to-rantz-with-a-raw-chompy-talking-to-rantz-again-before-cooking-the-chompy");
      return;
    }
    if (event.itemId !== OGRE_ARROW) return;
    if (stage < STAGE_STARTED) return;
    const variant = stage >= STAGE_GIVEN_ARROWS
      ? "using-ogre-arrows-made-by-the-player-on-rantz-using-ogre-arrows-on-rantz-after-giving-him-some-already"
      : has(player, OGRE_ARROW, 6)
        ? "using-ogre-arrows-made-by-the-player-on-rantz"
        : "starting-off-using-less-than-6-ogre-arrows-on-rantz";
    play(variant);
  }

  /** The bait clearing: hint arrow, camera pan, both released as live does (ticks 786, 809, 836). */
  function showBaitClearing(player) {
    const sender = hint(player, true);
    sender.sendCameraLookAt(BAIT_CAMERA_LOOK.x, BAIT_CAMERA_LOOK.y, BAIT_CAMERA_LOOK.height,
      { rate: BAIT_CAMERA_LOOK.rate, rate2: BAIT_CAMERA_LOOK.rate, heightRelative: false });
    sender.sendCameraMoveTo(BAIT_CAMERA_MOVE.x, BAIT_CAMERA_MOVE.y, BAIT_CAMERA_MOVE.height,
      { rate: BAIT_CAMERA_MOVE.rate, rate2: BAIT_CAMERA_MOVE.rate, heightRelative: false });
    sender.sendPositionalHint(new Location(BAIT_HINT_TILE.x, BAIT_HINT_TILE.y, BAIT_HINT_TILE.z), 2, BAIT_HINT_TILE.height);
    const shown = {};
    baitHints.set(player, shown);
    later(player, BAIT_HINT_TICKS, () => {
      if (baitHints.get(player) !== shown) return;
      baitHints.delete(player);
      hint(player, false);
    });
  }
  const baitHints = new WeakMap();

  /**
   * Stage moves the capture makes on lines (ticks 580, 779, 1373), Rantz's seasoning line, and the bait
   * clearing's camera and arrow on his "Over 'dere creature" line.
   */
  function handleDialogueLine(event) {
    const { player, npcId, text } = event;
    if (!RANTZ_NPC_IDS.has(npcId)) return;
    const stage = quest.getStage(player);
    const value = String(text ?? "");
    if (stage === STAGE_GIVEN_ARROWS && value.startsWith("Dey's fussie eaters just like Rantz.")) {
      event.before = () => {
        if (quest.getStage(player) === STAGE_GIVEN_ARROWS) quest.setStage(player, STAGE_KIDS_EXPLAINED_TOADS);
      };
    } else if (stage === STAGE_BELLOWS_TAKEN && value.startsWith("Yes, I have a 'fatsy toady' for you")) {
      event.before = () => {
        if (quest.getStage(player) === STAGE_BELLOWS_TAKEN && has(player, BLOATED_TOAD)) quest.setStage(player, STAGE_SHOWN_TOAD);
      };
    } else if (value.startsWith("Over 'dere creature, put da toadies over der!")) {
      event.before = () => showBaitClearing(player);
      event.after = () => player.getPacketSender().sendCameraReset();
    } else if (stage === STAGE_KILLED_CHOMPY && value.startsWith("Okay's now you's needs to cook da chompy!")) {
      event.before = () => {
        if (quest.getStage(player) === STAGE_KILLED_CHOMPY) quest.setStage(player, STAGE_TOLD_TO_COOK);
      };
    } else if (value.startsWith("But's we's particular about our chompy yumms.")) {
      // The first request names Onion in the transcript; this player's pick is the one said.
      const wanted = seasoning(player, "rantz");
      loadSeasoningLines(player, npcId);
      event.text = seasoningLines.get(wanted.item) ?? value;
    }
  }

  /** Rantz's two seasoning lines, read once from the transcript's again-before-cooking random. */
  const seasoningLines = new Map();
  function loadSeasoningLines(player, npcId) {
    if (seasoningLines.size) return;
    const harvest = (steps) => {
      for (const option of steps.find((step) => step.type === "random")?.options ?? []) {
        const line = option.steps?.find((step) => step.type === "line")?.text;
        const choice = SEASONINGS.rantz.choices.find(({ name }) => new RegExp(`wants ${name}`, "i").test(String(line)));
        if (choice) seasoningLines.set(choice.item, line);
      }
      return [];
    };
    api.emitCustomEvent("npc-dialogue:start", { player, npcId, select: harvest,
      variant: page(PAGE, "talking-to-rantz-with-a-raw-chompy-talking-to-rantz-again-before-cooking-the-chompy") });
  }

  /** The ogres' random seasoning lines play this player's pick. */
  function handleRandom(draw) {
    const who = ogreOf(draw.npcId);
    if (!who || quest.getStage(draw.player) < STAGE_KILLED_CHOMPY) return;
    const wanted = seasoning(draw.player, who);
    const index = draw.options.findIndex((option) => JSON.stringify(option.steps ?? []).toLowerCase()
      .includes(`wants ${wanted.name}`) || JSON.stringify(option.steps ?? []).toLowerCase().includes(`have ${wanted.name}`));
    if (index >= 0) draw.index = index;
  }

  /**
   * Rantz's post-quest menus as the capture shows them (ticks 1528-1537): the first one is "What are the hats
   * like?", "Can you show me the hats please?", "How many chompies do I have to stick?", "Can I have a hat
   * please?", "Ok, thanks."; after "What are the hats like?" the other one is "How many chompies...", "How do
   * I get a hat?", "Can I have a hat please?", "Can you show me the hats please?", "Ok, thanks."; after "How
   * many..." the first again. The transcript lists all of them in one menu.
   */
  function handleMenu(notice) {
    if (!RANTZ_NPC_IDS.has(notice.npcId) || quest.getStage(notice.player) < STAGE_COMPLETE) return;
    const all = notice.options ?? [];
    const byText = (text, which = 0) => all.filter((option) => option.text === text)[which];
    if (!byText("Can I have a hat please?") || !byText("Can you show me the hats please?")) return;
    // The capture's "What are the hats like?" answer is the transcript's second one (colons, not dots).
    const like = byText("What are the hats like?", 1) ?? byText("What are the hats like?");
    const first = [like, byText("Can you show me the hats please?"), byText("How many chompies do I have to stick?"),
      byText("Can I have a hat please?"), byText("Ok, thanks.")].filter(Boolean);
    const other = [byText("How many chompies do I have to stick?"), byText("How do I get a hat?"),
      byText("Can I have a hat please?"), byText("Can you show me the hats please?"), byText("Ok, thanks.")].filter(Boolean);
    notice.options = notice.via === "other" && notice.chosen === "What are the hats like?" ? other : first;
  }

  /** The item each captured message box shows, and the arrow hand-in's chat echo (tick 543). */
  function messageBox(event) {
    const text = String(event.text ?? "");
    const entry = MESSAGE_BOX_ITEMS.find(([pattern]) => pattern.test(text));
    const hat = /^((?:expert )?(?:ogre )?[a-z ]+?) hat\. \d+ feather/i.exec(text);
    const hatItem = hat && CHOMPY_HATS.find((candidate) => candidate.label === hat[1].toLowerCase())?.item;
    const item = entry?.[1] ?? hatItem;
    if (item) event.box = { items: [item] };
    if (TAKE_ARROWS_MESSAGE_IDS.has(event.stepId)) event.after = () => event.player.sendMessage(text);
  }

  function buyBugsTools(player) {
    if (player.getAttribute(BUGS_TOOLS_ATTRIBUTE)) return;
    if (!has(player, ItemIdentifiers.COINS, 10) || freeSlots(player) < 2) return;
    player.getInventory().deleteNumber(ItemIdentifiers.COINS, 10);
    player.getInventory().adds(ItemIdentifiers.KNIFE, 1);
    player.getInventory().adds(ItemIdentifiers.CHISEL, 1);
    player.setAttribute(BUGS_TOOLS_ATTRIBUTE, 1);
  }

  function buyFycieFeathers(player) {
    if (player.getAttribute(FYCIE_FEATHERS_ATTRIBUTE)) return;
    if (!has(player, ItemIdentifiers.COINS, FYCIE_FEATHER_PRICE) || freeSlots(player) < 1 || !canReceiveFycieFeathers(player)) return;
    player.getInventory().deleteNumber(ItemIdentifiers.COINS, FYCIE_FEATHER_PRICE);
    player.getInventory().adds(ItemIdentifiers.FEATHER, FYCIE_FEATHER_AMOUNT);
    player.setAttribute(FYCIE_FEATHERS_ATTRIBUTE, 1);
  }

  /** The transcript's item hand-outs and hand-ins. */
  function handleAction(event) {
    const { player, npcId, stepId, text } = event;
    const ours = RANTZ_NPC_IDS.has(npcId) || npcId === FYCIE_NPC_ID || BUGS_NPC_IDS.has(npcId);
    if (ours && event.kind === "message") messageBox(event);
    if (RANTZ_NPC_IDS.has(npcId) && /this is the hat for/i.test(String(text ?? ""))) {
      grantHat(player, text);
      return;
    }
    if (BUGS_NPC_IDS.has(npcId) && stepId === BUGS_TOOLS_MESSAGE_ID) {
      buyBugsTools(player);
      return;
    }
    if (npcId === FYCIE_NPC_ID && stepId === FYCIE_FEATHERS_MESSAGE_ID) {
      buyFycieFeathers(player);
      return;
    }
    if (!RANTZ_NPC_IDS.has(npcId)) return;
    if (TAKE_ARROWS_MESSAGE_IDS.has(stepId)) {
      const stage = quest.getStage(player);
      if (stage < STAGE_STARTED || stage >= STAGE_GIVEN_ARROWS || !has(player, OGRE_ARROW, 6)) return;
      player.getInventory().deleteNumber(OGRE_ARROW, 6);
      quest.setStage(player, STAGE_GIVEN_ARROWS);
      return;
    }
    if (SHOW_TOAD_MESSAGE_IDS.has(stepId)) {
      const stage = quest.getStage(player);
      if (stage < STAGE_BELLOWS_TAKEN || stage >= STAGE_SHOWN_TOAD || !has(player, BLOATED_TOAD)) return;
      quest.setStage(player, STAGE_SHOWN_TOAD);
      return;
    }
    if (stepId === GIVE_BOW_MESSAGE_ID) {
      const stage = quest.getStage(player);
      if (stage < STAGE_RANTZ_MISSED || stage >= STAGE_GIVEN_BOW) return;
      if (!hasBow(player)) {
        if (freeSlots(player) <= 0) {
          event.handled = true;
          event.box = null;
          player.sendMessage("You need an empty inventory slot for the ogre bow.");
          return;
        }
        player.getInventory().adds(OGRE_BOW, 1);
      }
      quest.setStage(player, STAGE_GIVEN_BOW);
      return;
    }
    if (stepId === RECLAIM_BOW_MESSAGE_ID) {
      const stage = quest.getStage(player);
      if (stage < STAGE_GIVEN_BOW || stage >= STAGE_KILLED_CHOMPY || hasBow(player)) return;
      if (!has(player, ItemIdentifiers.COINS, BOW_RECLAIM_COST)) return;
      if (freeSlots(player) <= 0) {
        event.handled = true;
        player.sendMessage("You need an empty inventory slot for the ogre bow.");
        return;
      }
      player.getInventory().deleteNumber(ItemIdentifiers.COINS, BOW_RECLAIM_COST);
      player.getInventory().adds(OGRE_BOW, 1);
      return;
    }
    if (stepId === COMPLETE_ACTION_ID) {
      if (quest.getStage(player) < STAGE_CHOMPY_COOKED || quest.isComplete(player)) return;
      if (!has(player, SEASONED_CHOMPY)) return;
      player.getInventory().deleteNumber(SEASONED_CHOMPY, 1);
      quest.complete(player);
    }
  }

  /** Before the quest, the ogre bow's Check kills (Wiki: Ogre bow; capture ticks 1089, 1358). */
  function checkKills(event) {
    if (quest.isComplete(event.player)) return false;
    event.player.sendMessage("You've scratched up no kills yet! You've got to complete the quest first!");
    return true;
  }

  function handleLogin({ player }) {
    // The demonstration is transient: a save made while Rantz shoots goes back to the bait being down.
    if (quest.getStage(player) === STAGE_CHOMPY_MISSED) quest.setStage(player, STAGE_WAITING_CHOMPY);
    player.getPacketSender?.().sendConfig?.(VARP_CHOMPY_KILLS, chompyKills(player));
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    baitHints.delete(player);
    cancelDemonstration(player);
    // A roast in progress finishes rather than eating the raw chompy.
    cooking.get(player)?.();
    hunt.cleanup(player);
  }

  function handleShutdown() { hunt.shutdown(); }

  api.persistAttribute(RANTZ_INGREDIENT_ATTRIBUTE, 0);
  api.persistAttribute(BUGS_INGREDIENT_ATTRIBUTE, 0);
  api.persistAttribute(FYCIE_INGREDIENT_ATTRIBUTE, 0);
  api.persistAttribute(BUGS_TOOLS_ATTRIBUTE, 0);
  api.persistAttribute(FYCIE_FEATHERS_ATTRIBUTE, 0);
  api.persistAttribute(CHOMPY_KILLS_ATTRIBUTE, 0);
  api.persistAttribute(HATS_CLAIMED_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "big_chompy_bird_hunting",
    name: "Big Chompy Bird Hunting",
    varpId: VARP_CHOMPY_BIRD,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    // The capture's scroll (tick 1513): Cooking, Ranged, Fletching, "An Ogre Bow", "Ability to make Ogre Arrows".
    xpRewards: [
      { skillId: Skill.COOKING.getIndex(), amount: 1470, label: "Cooking" },
      { skillId: Skill.RANGED.getIndex(), amount: 735, label: "Ranged" },
      { skillId: Skill.FLETCHING.getIndex(), amount: 262, label: "Fletching" },
    ],
    // The bow is handed over by Rantz at the hunt step, not added again at completion;
    // the completion scroll still shows it as the quest's item reward.
    scrollItemId: OGRE_BOW,
    rewardItemLabel: "An Ogre Bow",
    otherRewards: ["Ability to make Ogre Arrows"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:random", handleRandom);
  api.onCustomEvent("npc-dialogue:menu", handleMenu);
  api.onItemOnObject(handleItemOnObject);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemAction(handleItemAction);
  api.onItemAction("Ogre bow", { "Check kills": checkKills, Check: checkKills });
  api.onObjectInteraction("Locked Ogre chest", { Unlock: chest.unlock });
  api.onObjectInteraction("Unlocked Ogre chest", { Search: chest.search });
  api.onNpcInteraction(handleNpcInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onCustomEvent("npc-drops:claim", handleDropClaim);
  api.onCanAttack(handleCanAttack);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onServerShutdown(handleShutdown);
};
