/**
 * Plague City (members).
 *
 * The words come from the "Plague City" transcript page. Edmond, Alrena,
 * Jethick, the Rehnison family, Milli, the Clerk, Bravek and Elena are all
 * indexed, so this plugin selects the variant by stage, answers the prose
 * conditions, completes the quest through Edmond's own action and mixes the
 * hangover cure from the transcript's item recipes.
 *
 * Everything the player sees, moves through or hears follows a complete live run
 * (rsprox capture 20261110T113734-5ab63b4, revision 242; ticks below are that
 * recording's; docs/quests/plague-city/README.md lists them): the message and item boxes, the
 * dig and the pipe and manhole crossings with their fades, the grill pulled with
 * Edmond in an instance, the tick each stage moves on, the two Edmonds the client
 * swaps by varbit and the gas mask kept on in West Ardougne. The Plague City doors
 * are Doors pass-through gates; this plugin decides who may open them (door:toggle).
 *
 * Stages (varp 165): 1 find dwellberries, 2 gas mask, 3 soften the mud, 4-7
 * one to four buckets of water, 8 tunnel open, 9 rope tied, 10 pipe open,
 * 20 shown picture, 21 returned book, 22 spoke to the Rehnisons, 23 spoke to
 * Milli, 24 need clearance, 25 clerk permission, 26 hangover cure, 27 cured
 * Bravek (warrant), 28 freed Elena, 29 complete, 30 read scroll.
 */
module.exports = function registerPlagueCityQuest(api) {
  const {
    Skill, Equipment, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers, Animation, Sound, Sounds, Location,
    ForceMovement, GameObject, CountdownTask, TaskManager, DialogueChainBuilder, NpcDialogue, PlayerDialogue,
    ActionDialogue, StatementDialogue, ItemStatementDialogue,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");

  const PAGE = "Plague City";
  const EDMOND_NPC_ID = NpcIdentifiers.EDMOND_2; // 4256, shown by edmond_top 6204 / edmond_bottom 6205
  const ALRENA_NPC_IDS = new Set([
    NpcIdentifiers.ALRENA,
    NpcIdentifiers.ALRENA_2,
    NpcIdentifiers.ALRENA_3,
  ]);
  const BRAVEK_NPC_IDS = new Set([NpcIdentifiers.BRAVEK, NpcIdentifiers.BRAVEK_2]);
  const CLERK_NPC_IDS = new Set([NpcIdentifiers.CLERK, NpcIdentifiers.CLERK_2]);
  const ELENA_NPC_IDS = new Set([
    NpcIdentifiers.ELENA, // 1102
    NpcIdentifiers.ELENA_2, // 4257
  ]);
  /** Elena in the plague house basement: elenap 6206, shown as 4257 until she is freed. */
  const ELENA_CELL_NPC_IDS = new Set([6206, NpcIdentifiers.ELENA_2]);
  const TED_REHNISON_NPC_ID = NpcIdentifiers.TED_REHNISON; // 4263
  const MARTHA_REHNISON_NPC_ID = NpcIdentifiers.MARTHA_REHNISON; // 4264
  const MILLI_REHNISON_NPC_ID = NpcIdentifiers.MILLI_REHNISON; // 4266
  const JETHICK_NPC_IDS = new Set([
    NpcIdentifiers.JETHICK,
    NpcIdentifiers.JETHICK_2,
    NpcIdentifiers.JETHICK_3,
  ]);
  /** mourner_elena_guard_vis: the two mourners outside the plague house (2539,3273 and 2534,3273). */
  const PLAGUE_HOUSE_MOURNER_NPC_ID = 8975;
  /** mourner_elena_guard (7382) is the spawned multi; 8975 is what it shows. */
  const PLAGUE_HOUSE_MOURNER_IDS = new Set([7382, PLAGUE_HOUSE_MOURNER_NPC_ID]);
  /** Alrena while she mixes the paste (alrena_gasmask_mix) and holds the mask (alrena_gasmask_mask). */
  const ALRENA_MIXING_NPC_ID = 4251;
  const ALRENA_MASK_NPC_ID = 4250;
  /** Bravek gulping the cure (bravek_hangover_cure_anim). */
  const BRAVEK_DRINKING_NPC_ID = 4253;

  const VARP_PLAGUE_CITY = 165;
  const STAGE_FIND_DWELLBERRIES = 1;
  const STAGE_GAS_MASK = 2;
  const STAGE_SOFTEN_MUD = 3;
  const STAGE_WATER_4 = 7;
  const STAGE_TUNNEL_OPEN = 8;
  const STAGE_ROPE_TIED = 9;
  const STAGE_PIPE_OPEN = 10;
  const STAGE_SHOWN_PICTURE = 20;
  const STAGE_RETURNED_BOOK = 21;
  const STAGE_SPOKE_TO_REHNISONS = 22;
  const STAGE_SPOKE_TO_MILLI = 23;
  const STAGE_NEED_CLEARANCE = 24;
  const STAGE_CLERK_PERMISSION = 25;
  const STAGE_NEED_HANGOVER_CURE = 26;
  const STAGE_HAVE_WARRANT = 27;
  const STAGE_FREED_ELENA = 28;
  const STAGE_COMPLETE = 29;
  const STAGE_READ_SCROLL = 30;

  const DWELLBERRIES_ITEM_ID = ItemIdentifiers.DWELLBERRIES;
  const GAS_MASK_ITEM_ID = ItemIdentifiers.GAS_MASK;
  const HANGOVER_CURE_ITEM_ID = ItemIdentifiers.HANGOVER_CURE;
  const WARRANT_ITEM_ID = ItemIdentifiers.WARRANT;
  const ARDOUGNE_SCROLL_ITEM_ID = ItemIdentifiers.ARDOUGNE_TELEPORT_SCROLL;
  const CHOCOLATE_DUST_ITEM_ID = ItemIdentifiers.CHOCOLATE_DUST;
  const BUCKET_OF_MILK_ITEM_ID = ItemIdentifiers.BUCKET_OF_MILK;
  const CHOCOLATEY_MILK_ITEM_ID = ItemIdentifiers.CHOCOLATEY_MILK;
  const SNAPE_GRASS_ITEM_ID = ItemIdentifiers.SNAPE_GRASS;
  const PICTURE_ITEM_ID = ItemIdentifiers.PICTURE;
  const BOOK_ITEM_ID = ItemIdentifiers.BOOK_2;
  const SCRUFFY_NOTE_ITEM_ID = ItemIdentifiers.A_SCRUFFY_NOTE;
  const SMALL_KEY_ITEM_ID = ItemIdentifiers.A_SMALL_KEY;
  /** Tick 883: Edmond takes these as he hands over the scroll (the worn gas mask stays). */
  const COMPLETION_TAKEN_ITEM_IDS = [WARRANT_ITEM_ID, SMALL_KEY_ITEM_ID, SCRUFFY_NOTE_ITEM_ID, PICTURE_ITEM_ID];

  const START_HOOK = "quest:plague-city:start";
  const COMPLETE_ACTION_ID = "aGVmkR";
  const PULL_GRILL_ACTION_ID = "oCU2uO";

  const MUD_MULTILOC_ID = 2532; // cache plaguemudpatch2, varbit 1785: plague_mud 11418 / plague_hole 11417
  const MUD_PATCH_IDS = [MUD_MULTILOC_ID, ObjectIdentifiers.MUD_PATCH_2, ObjectIdentifiers.MUD_PATCH_3, 11417, 11418];
  const GRILL_MULTILOC_ID = 11422; // cache plague_grill, varbit 1787
  const GRILL_IDS = [GRILL_MULTILOC_ID, ObjectIdentifiers.GRILL_4];
  const HOUSE_DOOR_MULTILOC_ID = 37321; // cache plagueelenadoorshut
  const ELENA_GATE_ID = ObjectIdentifiers.DOOR_78; // 2526 elenagateshut
  const GRILL_CHECKED_ATTRIBUTE = "plague-city:grill-checked";
  const KEY_ASKED_ATTRIBUTE = "plague-city:key-asked";
  /** Saves from before stage 27 moved to the cure: the cure was given but no warrant yet. */
  const CURE_GIVEN_ATTRIBUTE = "plague-city:cure-given";
  const SCENE_EXIT_ATTRIBUTE = "plague-city:scene-exit";
  const VARBIT_CAN_SEE_EDMOND_UP_TOP = 1783; // named so; 1 shows edmond_bottom in the sewer
  const VARBIT_ELENA_AT_HOME = 1784;
  const VARBIT_DUG_HOLE = 1785;
  const VARBIT_CHECKED_GRILL = 1786;
  const VARBIT_PIPE = 1787;
  const VARBIT_KEY_ASKED = 9103;

  // Capture 20261110T113734-5ab63b4: animations and sounds.
  const POUR_WATER_ANIMATION = 2283; // farming_pour_water, ticks 160-181
  const WATERING_SOUND = 2446;
  const DIG_ANIMATION = 830; // human_dig, tick 188
  const DIG_SOUND = 1470;
  const PULL_PIPE_ANIMATION = 3192; // pull_on_pipe, ticks 221, 232, 257
  const GRILL_LOCKED_SOUND = 72;
  const ROPE_TIE_ANIMATION = 3191; // rope_tie, tick 242
  const ROPE_ATTACH_SOUND = 1731;
  const LIFT_AND_PULL_ANIMATION = 3187; // player and Edmond, tick 275
  const HANGING_ROPE_LIFT_ANIMATION = 3189;
  const STRAIGHT_ROPE_LIFT_ANIMATION = 3188;
  const PULL_GRILL_SOUND = 1730;
  const PIPE_SQUEEZE_ANIMATION = 3195; // plaguecity_human_doublepipesqueeze, delay 30, tick 316
  const SQUEEZE_SOUND = 2489;
  const MANHOLE_OPEN_SOUND = 75; // as the player comes up in West Ardougne, tick 322
  const MANHOLE_CLIMB_ANIMATION = 827; // human_pickupfloor, tick 332
  const MUD_PILE_CLIMB_ANIMATION = 828; // human_reachforladder, tick 877
  const MILLI_CRY_ANIMATION = 12039; // gnome_cry with her "*sniff*", tick 454
  const LOCKED_SOUND = 2402; // the basement door without the key, tick 762

  const SEWER_LANDING = [2518, 9759, 0]; // tick 191
  const MUD_PILE_TOP = [2566, 3331, 0]; // tick 878
  const PIPE_FOOT = [2514, 9739, 0];
  const PIPE_INSIDE = [2514, 9736, 0]; // the exactmove's end, tick 316
  const WEST_ARDOUGNE_MANHOLE_EXIT = [2529, 3304, 0]; // tick 322
  const MANHOLE_LANDING = [2514, 9739, 0]; // tick 335
  const MANHOLE_TILE = [2529, 3303, 0];
  const REHNISON_STAIRS = { x: 2527, y: 3332 };
  const REHNISON_UPSTAIRS = [2527, 3331, 1]; // tick 446
  const REHNISON_DOWNSTAIRS = [2527, 3331, 0]; // tick 474
  const PLAGUE_HOUSE_STAIRS_DOWN = { x: 2536, y: 3268, z: 0 };
  const PLAGUE_HOUSE_STAIRS_UP = { x: 2536, y: 9671, z: 0 };
  const PLAGUE_HOUSE_BASEMENT = [2537, 9670, 0]; // tick 747
  const PLAGUE_HOUSE_GROUND = [2536, 3271, 0]; // tick 833
  const PLAGUE_HOUSE_FRONT_DOOR = { x: 2540, y: 3273, z: 0 };
  const PLAGUE_HOUSE_DOOR_TILES = [[2540, 3273], [2533, 3272]];

  /** The grill pull plays in a copy of the sewer (rebuild_region from 2496,9728), tick 271. */
  const GRILL_SCENE = {
    sourceChunk: [312, 1216],
    size: 7,
    bounds: [[2496, 2551, 9728, 9783, 0]],
    at: [2514, 9740, 0],
    edmond: [2514, 9741, 0],
    face: [2514, 9738],
    camera: [[2518, 9744, 375], [2511, 9738, 125]],
    cameraRates: { rate: 90, rate2: 90 },
    // The grill (wall decoration) and the tied rope (ground decoration) the copy replaces.
    removed: [[GRILL_MULTILOC_ID, 2514, 9739, 4, 3], [GRILL_MULTILOC_ID, 2514, 9739, 22, 2],
      [GRILL_MULTILOC_ID, 2514, 9740, 22, 2], [GRILL_MULTILOC_ID, 2514, 9741, 22, 2]],
    ropes: [
      { id: ObjectIdentifiers.ROPE_16, x: 2514, y: 9739, animation: HANGING_ROPE_LIFT_ANIMATION }, // hanging_rope_anim
      { id: ObjectIdentifiers.STRAIGHT_ROPE, x: 2514, y: 9740, animation: STRAIGHT_ROPE_LIFT_ANIMATION },
      { id: ObjectIdentifiers.ROPE_14, x: 2514, y: 9741, animation: STRAIGHT_ROPE_LIFT_ANIMATION }, // straight_rope_end_anim
    ],
  };

  /**
   * West Ardougne, where the gas mask stays on (ticks 393, 563). Ours: the boxes follow the
   * city wall by eye (the wall gate is at 2557,3299; the Mourner Headquarters, in East
   * Ardougne, starts at 2541,3319); no capture walks the wall itself.
   */
  const WEST_ARDOUGNE = [[2433, 2557, 3264, 3318], [2433, 2540, 3319, 3340]];
  const KEEP_MASK_ON_MESSAGE = "You should leave your gas mask on while you're in West Ardougne.";

  /** Message steps live OSRS shows in an item box (objectbox 193) with the item it names. */
  const ITEM_BOXES = new Map([
    ["JytUi6", DWELLBERRIES_ITEM_ID], // tick 124
    ["Br9tOd", GAS_MASK_ITEM_ID], // 127
    ["k0c15m", PICTURE_ITEM_ID], // 382
    ["_dk_wV", BOOK_ITEM_ID], // 405
    ["zQse1w", BOOK_ITEM_ID], // 424
    ["nxSgWb", SCRUFFY_NOTE_ITEM_ID], // 649
    ["sY8emd", SCRUFFY_NOTE_ITEM_ID],
    ["Z2OftI", HANGOVER_CURE_ITEM_ID], // 672
    ["Pn2ogc", WARRANT_ITEM_ID], // 682
  ]);
  /** Message steps live OSRS shows in a message box (229). */
  const STATEMENT_BOXES = new Set([
    "GOZhMg", // tick 125
    "LILHam", "X74Wy9", // 518
    "uflJGj", "0kLoiV", // 734
    "Gtrtgc", // 762
  ]);

  const BLACK_CROSS_STEPS = new Set(["LILHam", "X74Wy9"]);
  const ELENA_LOCKED_VARIANT = "freeing-elena-attempting-to-open-the-basement-door-of-the-plague-house-without-the-key";
  const WARRANT_DOOR_VARIANT = "freeing-elena-attempting-to-enter-the-plague-house-with-the-warrant";
  const WARRANT_MOURNER_VARIANT = "freeing-elena-talking-to-mourners-outside-the-plague-house-while-holding-the-warrant";

  let quest;
  const Scenes = createQuestScenes(api, { recoveryAttribute: SCENE_EXIT_ATTRIBUTE });
  const pendingDoors = new WeakMap();
  /** Players mid-dig: the stage moves three ticks after the spade. */
  const digging = new WeakSet();

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  /** Wiki (Bottomless milk bucket): one filled with hangover cure serves Bravek for a single use, as for Skippy. */
  function bottomlessCure(player) {
    const request = { player, type: HANGOVER_CURE_ITEM_ID, holds: false };
    api.emitCustomEvent("bottomless-milk:holds", request);
    return request.holds === true;
  }
  const hasCure = (player) => held(player, HANGOVER_CURE_ITEM_ID) || bottomlessCure(player);
  const wearingGasMask = (player) =>
    player.getEquipment().get(Equipment.HEAD_SLOT)?.getId?.() === GAS_MASK_ITEM_ID;
  const at = (location, x, y, z = 0) =>
    (location?.getX?.() ?? location?.x) === x && (location?.getY?.() ?? location?.y) === y
    && (location?.getZ?.() ?? location?.z ?? 0) === z;
  const tile = ([x, y, z = 0]) => new Location(x, y, z);
  const sound = (player, id) => Sounds.sendSound(player, new Sound(id, 1, 0, 0));
  const later = (player, ticks, fn) => TaskManager.submit(new CountdownTask(player, ticks, fn));
  const statement = (player, text) => StatementDialogue.send(player, text);
  function itemBox(player, itemId, text) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text)));
  }
  /** The fade overlay (174) as live sends it over the dig, the pipe and the manhole. */
  const fadeOut = (player) => Scenes.fade(player, true);
  const fadeIn = (player) => Scenes.fade(player, false);

  function biohazardStarted(player) {
    const request = { player, key: "biohazard", started: false };
    api.emitCustomEvent("quest:is-started", request);
    return request.started === true;
  }

  function inWestArdougne(location) {
    const x = location?.getX?.(), y = location?.getY?.(), z = location?.getZ?.() ?? 0;
    return z === 0 && WEST_ARDOUGNE.some(([minX, maxX, minY, maxY]) => x >= minX && x <= maxX && y >= minY && y <= maxY);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage === 0) {
      return [
        "I can start this quest by speaking to <col=800000>Edmond</col>",
        "behind his house in <col=800000>East Ardougne</col>.",
        "",
        "There are no requirements for this quest.",
      ];
    }
    const lines = ["<str>Edmond asked me to find his missing daughter Elena.</str>", ""];
    if (stage === STAGE_FIND_DWELLBERRIES) {
      lines.push("I need <col=800000>dwellberries</col> so Alrena can make a gas mask.");
    } else if (stage === STAGE_GAS_MASK) {
      lines.push("<str>Alrena made me a gas mask.</str>", "I should speak to <col=800000>Edmond</col>.");
    } else if (stage >= STAGE_SOFTEN_MUD && stage < STAGE_WATER_4) {
      lines.push("I must pour four <col=800000>buckets of water</col> onto the mud patch.");
    } else if (stage === STAGE_WATER_4) {
      lines.push("The soil is soft. I should use a <col=800000>spade</col> on it.");
    } else if (stage === STAGE_TUNNEL_OPEN) {
      lines.push("I reached the sewers. The pipe grill needs a <col=800000>rope</col>.");
    } else if (stage === STAGE_ROPE_TIED) {
      lines.push("The rope is tied. I need <col=800000>Edmond</col> to help pull the grill away.");
    } else if (stage === STAGE_PIPE_OPEN) {
      lines.push("I should wear my gas mask, enter West Ardougne, and find <col=800000>Jethick</col>.");
    } else if (stage === STAGE_SHOWN_PICTURE) {
      lines.push("Jethick gave me a book to return to the <col=800000>Rehnison family</col>.");
    } else if (stage === STAGE_RETURNED_BOOK) {
      lines.push("I should ask <col=800000>Ted or Martha Rehnison</col> about Elena.");
    } else if (stage === STAGE_SPOKE_TO_REHNISONS) {
      lines.push("Their daughter <col=800000>Milli</col> saw what happened. She is upstairs.");
    } else if (stage === STAGE_SPOKE_TO_MILLI) {
      lines.push("I should investigate the plague house in southern West Ardougne.");
    } else if (stage === STAGE_NEED_CLEARANCE) {
      lines.push("I need clearance from <col=800000>Bravek</col> to enter the plague house.");
    } else if (stage === STAGE_CLERK_PERMISSION) {
      lines.push("The clerk has let me in to see <col=800000>Bravek</col>.");
    } else if (stage === STAGE_NEED_HANGOVER_CURE) {
      lines.push("Bravek needs a <col=800000>hangover cure</col> before he can help me.");
    } else if (stage === STAGE_HAVE_WARRANT) {
      lines.push("I have a warrant. I must enter the plague house and free Elena.");
    } else if (stage === STAGE_FREED_ELENA) {
      lines.push("<str>I freed Elena.</str>", "I should return to <col=800000>Edmond</col>.");
    } else if (stage >= STAGE_COMPLETE) {
      lines.push(
        "<str>Edmond rewarded me for rescuing Elena.</str>",
        stage >= STAGE_READ_SCROLL
          ? "<str>I learned the Ardougne Teleport spell.</str>"
          : "I should read Edmond's magic scroll.",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>"
      );
    }
    return lines;
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.MINING, 2425);
    const inventory = player.getInventory();
    for (const itemId of COMPLETION_TAKEN_ITEM_IDS) {
      const amount = inventory.getAmount(itemId);
      if (amount > 0) inventory.deleteNumber(itemId, amount);
    }
  }

  function edmondVariant(stage, player) {
    // Tick 889: holding the scroll, Edmond only thanks the player; the scroll offer is for one who lost it.
    if (stage >= STAGE_READ_SCROLL || (stage >= STAGE_COMPLETE && held(player, ARDOUGNE_SCROLL_ITEM_ID))) {
      return "standard-dialogue-after-plague-city";
    }
    if (stage >= STAGE_COMPLETE) {
      return "after-freeing-elena-edmond-talking-to-edmond-again-before-using-the-ardougne-teleport-scroll";
    }
    if (stage >= STAGE_FREED_ELENA) return "after-freeing-elena-edmond";
    if (stage >= STAGE_PIPE_OPEN) return "entering-west-ardougne-talking-to-edmond-after-unlocking-west-ardougne";
    if (stage === STAGE_ROPE_TIED) {
      return "starting-the-quest-talking-to-edmond-after-tying-the-rope-to-the-grill-on-the-pipe";
    }
    if (stage === STAGE_TUNNEL_OPEN) return "starting-the-quest-talking-to-edmond-in-the-tunnel";
    if (stage === STAGE_WATER_4) return "starting-the-quest-talking-to-edmond-after-pouring-four-buckets-of-water-on-the-mud-patch";
    if (stage === 6) return "starting-the-quest-talking-to-edmond-after-pouring-three-buckets-of-water-on-the-mud-patch";
    if (stage === 5) return "starting-the-quest-talking-to-edmond-after-pouring-two-buckets-of-water-on-the-mud-patch";
    if (stage === 4) return "starting-the-quest-talking-to-edmond-after-pouring-one-bucket-of-water-on-the-mud-patch";
    if (stage === STAGE_SOFTEN_MUD) return "starting-the-quest-talking-to-edmond-before-pouring-water-on-the-mud-patch";
    if (stage === STAGE_GAS_MASK) return "starting-the-quest-talking-to-edmond-after-getting-the-gas-mask";
    if (stage === STAGE_FIND_DWELLBERRIES) return "starting-the-quest-talking-to-edmond-before-getting-dwellberries";
    return "starting-the-quest-talking-to-edmond";
  }

  function alrenaVariant(stage, player) {
    if (stage < STAGE_FIND_DWELLBERRIES) return null;
    if (stage >= STAGE_FREED_ELENA) return "after-freeing-elena-talking-to-alrena-after-freeing-elena";
    if (stage >= STAGE_SHOWN_PICTURE) return "entering-west-ardougne-talking-to-alrena-after-jethick-asks-for-elena-s-picture";
    if (stage >= STAGE_PIPE_OPEN) return "entering-west-ardougne-talking-to-alrena-after-unlocking-west-ardougne";
    if (stage >= STAGE_TUNNEL_OPEN) return "starting-the-quest-talking-to-alrena-after-digging-the-tunnel";
    if (stage === STAGE_WATER_4) return "starting-the-quest-talking-to-alrena-after-pouring-four-buckets-of-water-on-the-mud-patch";
    if (stage >= STAGE_SOFTEN_MUD) return "starting-the-quest-talking-to-alrena-before-pouring-water-on-the-mud-patch";
    if (stage === STAGE_GAS_MASK) return "starting-the-quest-talking-to-alrena-after-getting-the-gas-mask";
    if (held(player, DWELLBERRIES_ITEM_ID)) {
      return "starting-the-quest-talking-to-alrena-after-getting-dwellberries";
    }
    return "starting-the-quest-talking-to-alrena-before-getting-dwellberries";
  }

  /**
   * Live moves the stage to 20 as Jethick recognises the picture, before the book is offered
   * (tick 384), and a player who turned the book down is offered it again (ticks 397-405).
   * The "again" transcript stops before the offer, so until it has one a player without the
   * book hears the first conversation again.
   */
  function jethickVariant(stage, player) {
    if (stage >= STAGE_RETURNED_BOOK) return "finding-elena-talking-to-jethick-after-delivering-the-book";
    if (stage >= STAGE_SHOWN_PICTURE) {
      if (!held(player, BOOK_ITEM_ID)) return "finding-elena-talking-to-jethick-after-getting-elena-s-picture";
      return "finding-elena-talking-to-jethick-after-getting-elena-s-picture-talking-to-jethick-again-before-delivering-the-book";
    }
    if (stage >= STAGE_PIPE_OPEN) {
      if (held(player, PICTURE_ITEM_ID)) {
        return "finding-elena-talking-to-jethick-after-getting-elena-s-picture";
      }
      return "entering-west-ardougne-talking-to-jethick-if-the-player-does-not-have-elena-s-picture";
    }
    return null;
  }

  function rehnisonVariant(stage, afterFreeingVariant) {
    if (stage >= STAGE_FREED_ELENA) return afterFreeingVariant;
    if (stage >= STAGE_SPOKE_TO_MILLI) return "finding-elena-talking-to-ted-rehnison-after-questioning-milli";
    if (stage === STAGE_RETURNED_BOOK || stage === STAGE_SPOKE_TO_REHNISONS) {
      return "finding-elena-talking-to-ted-rehnison";
    }
    return "entering-west-ardougne-talking-to-ted-rehnison-before-getting-the-book-from-jethick";
  }

  /** Bravek: the note is the third talk's (tick 649), the cure moves the stage (672). */
  function bravekVariant(stage, player) {
    if (stage >= STAGE_HAVE_WARRANT || (stage === STAGE_NEED_HANGOVER_CURE && player.getAttribute(CURE_GIVEN_ATTRIBUTE))) {
      if (held(player, WARRANT_ITEM_ID)) return "finding-elena-talking-to-bravek-after-receiving-the-warrant";
      return "finding-elena-talking-to-bravek-before-getting-the-warrant";
    }
    if (stage === STAGE_NEED_HANGOVER_CURE) {
      if (hasCure(player)) return "finding-elena-talking-to-bravek-after-getting-the-hangover-cure";
      return "finding-elena-talking-to-bravek-talking-to-bravek-again-before-getting-the-hangover-cure";
    }
    if (stage === STAGE_CLERK_PERMISSION) return "finding-elena-talking-to-bravek";
    return "finding-elena-attempting-to-open-the-door-to-bravek-before-the-clerk-lets-you-in";
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === EDMOND_NPC_ID) {
      if (stage === STAGE_TUNNEL_OPEN && player.getAttribute(GRILL_CHECKED_ATTRIBUTE)) return "starting-the-quest-talking-to-edmond-after-trying-to-pull-the-grill";
      return edmondVariant(stage, player);
    }
    if (ALRENA_NPC_IDS.has(npcId)) return alrenaVariant(stage, player);
    if (JETHICK_NPC_IDS.has(npcId)) return jethickVariant(stage, player);
    if (npcId === TED_REHNISON_NPC_ID) {
      return rehnisonVariant(stage, "after-freeing-elena-talking-to-ted-rehnison-after-freeing-elena");
    }
    if (npcId === MARTHA_REHNISON_NPC_ID) {
      if (stage >= STAGE_FREED_ELENA) return "after-freeing-elena-talking-to-martha-after-freeing-elena";
      if (stage >= STAGE_SPOKE_TO_MILLI) return "finding-elena-talking-to-martha-rehnison-after-questioning-milli";
      if (stage >= STAGE_RETURNED_BOOK) return "finding-elena-talking-to-martha-rehnison";
      return null;
    }
    if (npcId === MILLI_REHNISON_NPC_ID) {
      if (stage >= STAGE_NEED_CLEARANCE) {
        return "finding-elena-talking-to-milli-rehnison-after-attempting-to-enter-the-plague-house";
      }
      if (stage >= STAGE_SPOKE_TO_REHNISONS) return "finding-elena-talking-to-milli-rehnison";
      return null;
    }
    if (CLERK_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_NEED_HANGOVER_CURE) return "finding-elena-talking-to-clerk-after-meeting-bravek";
      if (stage === STAGE_CLERK_PERMISSION) {
        return "finding-elena-talking-to-the-clerk-after-getting-permission-to-speak-to-bravek";
      }
      if (stage === STAGE_NEED_CLEARANCE) {
        return "finding-elena-talking-to-the-clerk-before-getting-permission-to-speak-to-bravek";
      }
      return "entering-west-ardougne-talking-to-main-clerk-in-west-ardougne";
    }
    if (BRAVEK_NPC_IDS.has(npcId)) return bravekVariant(stage, player);
    if (PLAGUE_HOUSE_MOURNER_IDS.has(npcId) && stage === STAGE_HAVE_WARRANT && held(player, WARRANT_ITEM_ID) && !inPlagueHouse(player)) {
      return WARRANT_MOURNER_VARIANT;
    }
    if (ELENA_NPC_IDS.has(npcId)) {
      // Talk-to only reaches her in the open cell: live answers "I can't reach that!" through the door (tick 775).
      if (stage === STAGE_HAVE_WARRANT && npcId === NpcIdentifiers.ELENA_2) return "freeing-elena-talking-to-elena-after-unlocking-the-basement-door";
      return null;
    }
    return null;
  }

  /**
   * Tick 775: Talk-to on Elena from outside her cell answers "I can't reach that!". Ours: the
   * engine's NPC reach lets a player beside the cell wall talk to her, so the quest refuses it.
   */
  function elenaThroughTheWall(event) {
    const { player, npc } = event;
    if (!player || !npc || !ELENA_CELL_NPC_IDS.has(npc.getId?.())) return;
    const where = npc.getLocation();
    if (where.getY() < 9600 || where.getX() < 2540) return;
    if (player.getLocation().getX() >= 2540) return;
    event.handled = true;
    player.sendMessage("I can't reach that!");
  }

  function answerCondition({ player, npcId, text }) {
    if (![ALRENA_NPC_IDS, JETHICK_NPC_IDS, CLERK_NPC_IDS, BRAVEK_NPC_IDS, ELENA_NPC_IDS].some(ids => ids.has(npcId)) && ![EDMOND_NPC_ID, TED_REHNISON_NPC_ID, MARTHA_REHNISON_NPC_ID, MILLI_REHNISON_NPC_ID].includes(npcId)) return null;
    const value = String(text).toLowerCase();
    const inventory = player.getInventory();
    if (value.includes("already has the gas mask")) return held(player, GAS_MASK_ITEM_ID) || wearingGasMask(player);
    if (value.includes("does not have the gas mask") || value.includes("does not have a gas mask")) {
      return !held(player, GAS_MASK_ITEM_ID) && !wearingGasMask(player);
    }
    if (value.includes("has a gas mask")) return held(player, GAS_MASK_ITEM_ID);
    if (value.includes("has no inventory space")) return inventory.isFull();
    if (value.includes("edmond has not told the player to pour water")) return quest.getStage(player) < STAGE_SOFTEN_MUD;
    if (value.includes("first, second, or third bucket")) return quest.getStage(player) < STAGE_WATER_4;
    if (value.includes("fourth bucket of water")) return quest.getStage(player) >= STAGE_WATER_4;
    if (value.includes("grill has not been removed")) return quest.getStage(player) < STAGE_PIPE_OPEN;
    if (value.includes("not wearing a gas mask")) return !wearingGasMask(player);
    if (value.includes("has not talked to jethick before")) return quest.getStage(player) < STAGE_SHOWN_PICTURE;
    if (value.includes("has talked to jethick before")) return quest.getStage(player) >= STAGE_SHOWN_PICTURE;
    if (value.includes("lost the scruffy note")) return !held(player, SCRUFFY_NOTE_ITEM_ID);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== EDMOND_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_FIND_DWELLBERRIES) quest.setStage(player, STAGE_FIND_DWELLBERRIES);
  }

  function transform(npc, id, revertTicks) {
    if (!npc?.setNpcTransformationId) return;
    npc.setNpcTransformationId(id);
    if (revertTicks) later(npc, revertTicks, () => { if (npc.getNpcTransformationId?.() === id) npc.setNpcTransformationId(-1); });
  }

  /** Message steps shown in the box live uses for them. */
  function boxMessage(event) {
    if (event.kind !== "message") return;
    const itemId = ITEM_BOXES.get(event.stepId);
    if (itemId !== undefined) event.box = { items: [itemId] };
    else if (STATEMENT_BOXES.has(event.stepId)) event.box = { statement: true };
    // Tick 518: live breaks the black cross box after its first sentence.
    if (BLACK_CROSS_STEPS.has(event.stepId)) event.text = "The door won't open.<br>You notice a black cross on the door.";
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (!player) return;
    const stage = quest.getStage(player);
    const inventory = player.getInventory();
    if (ALRENA_NPC_IDS.has(npcId) || npcId === ALRENA_MIXING_NPC_ID || npcId === ALRENA_MASK_NPC_ID) {
      if (stepId === "GOZhMg" && stage === STAGE_FIND_DWELLBERRIES) transform(event.npc, ALRENA_MIXING_NPC_ID);
      // Tick 126: the berries become the mask in the same slot, with the stage.
      if (stepId === "Br9tOd" && stage === STAGE_FIND_DWELLBERRIES && held(player, DWELLBERRIES_ITEM_ID)) {
        inventory.deleteNumber(DWELLBERRIES_ITEM_ID, 1);
        inventory.adds(GAS_MASK_ITEM_ID, 1);
        quest.setStage(player, STAGE_GAS_MASK);
      }
      if (stepId === "jG6mG3" && stage >= STAGE_GAS_MASK && !held(player, GAS_MASK_ITEM_ID) && !wearingGasMask(player) && inventory.getFreeSlots() > 0) inventory.adds(GAS_MASK_ITEM_ID, 1);
    }
    if (npcId === EDMOND_NPC_ID && stepId === PULL_GRILL_ACTION_ID && stage === STAGE_ROPE_TIED) {
      event.handled = true;
      event.end = true;
      pullGrill(player);
      return;
    }
    if (npcId === TED_REHNISON_NPC_ID && stepId === "zQse1w" && stage === STAGE_SHOWN_PICTURE && held(player, BOOK_ITEM_ID)) {
      inventory.deleteNumber(BOOK_ITEM_ID, 1);
      quest.setStage(player, STAGE_RETURNED_BOOK);
      openPendingDoor(player);
    }
    if (BRAVEK_NPC_IDS.has(npcId) && ["nxSgWb", "sY8emd"].includes(stepId) && stage >= STAGE_CLERK_PERMISSION && stage <= STAGE_NEED_HANGOVER_CURE && !held(player, SCRUFFY_NOTE_ITEM_ID) && inventory.getFreeSlots() > 0) {
      inventory.adds(SCRUFFY_NOTE_ITEM_ID, 1);
      if (stage === STAGE_CLERK_PERMISSION) quest.setStage(player, STAGE_NEED_HANGOVER_CURE);
    }
    if (BRAVEK_NPC_IDS.has(npcId) && stepId === "Z2OftI" && stage === STAGE_NEED_HANGOVER_CURE && hasCure(player)) {
      // A loose cure first; otherwise one use of a bottomless milk bucket holding hangover cure.
      if (held(player, HANGOVER_CURE_ITEM_ID)) inventory.deleteNumber(HANGOVER_CURE_ITEM_ID, 1);
      else api.emitCustomEvent("bottomless-milk:spend", { player, type: HANGOVER_CURE_ITEM_ID, spent: false });
      quest.setStage(player, STAGE_HAVE_WARRANT);
      transform(event.npc, BRAVEK_DRINKING_NPC_ID, 3);
    }
    if (BRAVEK_NPC_IDS.has(npcId) && stepId === "Pn2ogc" && !held(player, WARRANT_ITEM_ID) && inventory.getFreeSlots() > 0
      && (stage === STAGE_HAVE_WARRANT || (stage === STAGE_NEED_HANGOVER_CURE && player.getAttribute(CURE_GIVEN_ATTRIBUTE)))) {
      inventory.adds(WARRANT_ITEM_ID, 1);
      if (stage < STAGE_HAVE_WARRANT) quest.setStage(player, STAGE_HAVE_WARRANT);
      player.setAttribute(CURE_GIVEN_ATTRIBUTE, false);
    }
    // Ticks 716-722: with the warrant the door's mourner speaks first; the black cross box is not shown.
    if (stepId === "ZoJIvd" && stage >= STAGE_HAVE_WARRANT) {
      event.handled = true;
      return;
    }
    if (stepId === "uflJGj" && stage === STAGE_HAVE_WARRANT && held(player, WARRANT_ITEM_ID)) sneakIn(player);
    // Ticks 729-734: talking to the mourner, the two of them still talk overhead before the box.
    if (stepId === "0kLoiV" && stage === STAGE_HAVE_WARRANT && held(player, WARRANT_ITEM_ID)) {
      event.handled = true;
      event.end = true;
      mournersConfer(player, () => {
        statement(player, event.text);
        sneakIn(player);
      });
      return;
    }
    if (stepId === "Gtrtgc") sound(player, LOCKED_SOUND);
    // "Jethick gives you a book." The stage moved when he saw the picture.
    if (JETHICK_NPC_IDS.has(npcId) && stepId === "_dk_wV") {
      if (stage === STAGE_SHOWN_PICTURE && !held(player, BOOK_ITEM_ID) && inventory.getFreeSlots() > 0) inventory.adds(BOOK_ITEM_ID, 1);
      boxMessage(event);
      return;
    }
    if (npcId === EDMOND_NPC_ID && stepId === COMPLETE_ACTION_ID) {
      if (quest.getStage(player) >= STAGE_FREED_ELENA && !quest.isComplete(player)) {
        quest.complete(player);
      }
    }
    boxMessage(event);
  }

  function openPendingDoor(player) {
    const object = pendingDoors.get(player);
    pendingDoors.delete(player);
    if (object && player.getLocation().getDistance(object.getLocation()) <= 2) api.emitCustomEvent("door:open", { player, object, handled: false });
  }

  function inPlagueHouse(player) {
    const location = player.getLocation();
    const x = location.getX(), y = location.getY();
    return location.getZ() === 0 && ((x >= 2532 && x <= 2540 && y >= 3264 && y <= 3272) || (y >= 9600 && x >= 2530 && x <= 2545));
  }

  /**
   * Ticks 729-736: once the mourner has turned to the other one, they talk overhead two ticks
   * apart, and with the second line the player slips through the front door (a pass-through door).
   */
  function sneakIn(player) {
    const location = player.getLocation();
    const door = new GameObject(HOUSE_DOOR_MULTILOC_ID, new Location(PLAGUE_HOUSE_FRONT_DOOR.x, PLAGUE_HOUSE_FRONT_DOOR.y, 0), 0, 3);
    const open = () => api.emitCustomEvent("door:open", { player, object: door, handled: false });
    if (at(location, PLAGUE_HOUSE_FRONT_DOOR.x, PLAGUE_HOUSE_FRONT_DOOR.y)) {
      open();
      return;
    }
    // Ours: a player talking to the mourner from beside the doorway walks onto it first.
    player.getMovementQueue().reset().addSteps(new Location(PLAGUE_HOUSE_FRONT_DOOR.x, PLAGUE_HOUSE_FRONT_DOOR.y, 0));
    let ticks = 6;
    const step = () => {
      if (at(player.getLocation(), PLAGUE_HOUSE_FRONT_DOOR.x, PLAGUE_HOUSE_FRONT_DOOR.y)) open();
      else if (--ticks > 0) later(player, 1, step);
    };
    later(player, 1, step);
  }

  /** The mourner by the door turns to the other one and asks; two ticks later the answer (ticks 732, 734). */
  function mournersConfer(player, then) {
    const [byDoor, other] = plagueHouseMourners(player);
    player.getMovementQueue().reset();
    later(player, 2, () => {
      if (byDoor && other) byDoor.setPositionToFace(other.getLocation());
      byDoor?.forceChat("Hey... I've got someone here with a warrant from Bravek, what should we do?");
      later(player, 2, () => {
        if (byDoor && other) other.setPositionToFace(byDoor.getLocation());
        other?.forceChat("Well you can't let them in...");
        then();
      });
    });
  }

  /** The mourners' overheads at the door: the one by the door, then the other one (ticks 732, 734). */
  function plagueHouseMourners(player) {
    const here = player.getLocation();
    const near = [];
    for (const npc of api.core.World.getNpcs()) {
      if (!npc || !PLAGUE_HOUSE_MOURNER_IDS.has(npc.getId?.()) || npc.getLocation().getZ() !== here.getZ()) continue;
      if (npc.getLocation().getDistance(here) <= 10) near.push(npc);
    }
    near.sort((a, b) => a.getLocation().getDistance(here) - b.getLocation().getDistance(here));
    return near;
  }

  function handleLine(event) {
    const { player, npcId, text } = event;
    if (!player) return;
    const stage = quest.getStage(player);
    if (CLERK_NPC_IDS.has(npcId) && text === "I suppose they can come in then. If they keep it short." && stage === STAGE_NEED_CLEARANCE) quest.setStage(player, STAGE_CLERK_PERMISSION);
    if (npcId === EDMOND_NPC_ID && text === "I've already tried digging down to them but the soil is rock hard. You'll need to pour on several buckets of water to soften it up. I reckon four buckets should do it." && stage === STAGE_GAS_MASK) quest.setStage(player, STAGE_SOFTEN_MUD);
    if (ALRENA_NPC_IDS.has(npcId) && String(text).startsWith("There we go, all done.")) transform(event.npc, ALRENA_MASK_NPC_ID, 4);
    if (JETHICK_NPC_IDS.has(npcId) && String(text).startsWith("Ah yes. She came over here to help the plague victims.") && stage === STAGE_PIPE_OPEN) {
      quest.setStage(player, STAGE_SHOWN_PICTURE);
    }
    if ((npcId === MARTHA_REHNISON_NPC_ID || npcId === TED_REHNISON_NPC_ID) && String(text).startsWith("Yes she was staying here") && stage === STAGE_RETURNED_BOOK) {
      quest.setStage(player, STAGE_SPOKE_TO_REHNISONS);
    }
    if (npcId === MILLI_REHNISON_NPC_ID && String(text).startsWith("*sniff*")) event.npc?.performAnimation?.(new Animation(MILLI_CRY_ANIMATION));
    if (npcId === MILLI_REHNISON_NPC_ID && String(text).startsWith("It was the boarded up building") && stage === STAGE_SPOKE_TO_REHNISONS) {
      quest.setStage(player, STAGE_SPOKE_TO_MILLI);
    }
    if (String(text).startsWith("Well you'd need to apply to the head mourner, or I suppose Bravek") && stage === STAGE_SPOKE_TO_MILLI) {
      quest.setStage(player, STAGE_NEED_CLEARANCE);
    }
    if (ELENA_NPC_IDS.has(npcId) && String(text).startsWith("I think there may be one around somewhere.")) {
      player.setAttribute(KEY_ASKED_ATTRIBUTE, true);
      player.getPacketSender().sendVarbit(VARBIT_KEY_ASKED, 1);
    }
    // Tick 798: Elena leaves once the player has heard her out.
    if (ELENA_NPC_IDS.has(npcId) && String(text).startsWith("Go and see my father") && stage === STAGE_HAVE_WARRANT) {
      event.after = () => { if (quest.getStage(player) === STAGE_HAVE_WARRANT) quest.setStage(player, STAGE_FREED_ELENA); };
    }
    if (stage === STAGE_HAVE_WARRANT && event.step?.presentation === "overhead" && /^Mourner/.test(event.step?.speaker ?? "")) {
      const [byDoor, other] = plagueHouseMourners(player);
      const speaker = event.step.speaker === "Mourner" ? byDoor : other;
      if (speaker) event.actors = [speaker];
      if (event.step.speaker === "Mourner" && byDoor && other) byDoor.setPositionToFace(other.getLocation());
      if (event.step.speaker !== "Mourner" && byDoor && other) other.setPositionToFace(byDoor.getLocation());
    }
    handleScrollLine(event);
  }

  /**
   * Wiki (Ardougne teleport scroll): "If a player loses this scroll, they can go back to Edmond." His after-quest
   * transcript ("Do you have any more of those scrolls?" / "Yes, here you go.") has no item step, so the line gives it.
   */
  function handleScrollLine(event) {
    const { player, npcId, text } = event;
    if (npcId !== EDMOND_NPC_ID || text !== "Yes, here you go." || !quest.isComplete(player)) return;
    if (held(player, ARDOUGNE_SCROLL_ITEM_ID)) return;
    const inventory = player.getInventory();
    if (inventory.getFreeSlots() < 1) {
      player.sendMessage("You don't have enough inventory space.");
      return;
    }
    inventory.adds(ARDOUGNE_SCROLL_ITEM_ID, 1);
  }

  function handleDoor(event) {
    const { player, object, objectId, location } = event;
    const stage = quest.getStage(player);
    if (objectId === ObjectIdentifiers.DOOR_80 && at(location, 2530, 3314) && stage < STAGE_CLERK_PERMISSION) {
      event.handled = true;
      startTranscript(api, player, NpcIdentifiers.BRAVEK, PAGE, "finding-elena-attempting-to-open-the-door-to-bravek-before-the-clerk-lets-you-in");
      return;
    }
    if (objectId === ObjectIdentifiers.DOOR_85 && at(location, 2531, 3328)) {
      if (stage >= STAGE_RETURNED_BOOK) return;
      event.handled = true;
      if (stage === STAGE_SHOWN_PICTURE && held(player, BOOK_ITEM_ID)) {
        pendingDoors.set(player, object);
        startTranscript(api, player, TED_REHNISON_NPC_ID, PAGE, "finding-elena-returning-the-book-to-ted-rehnison");
      } else startTranscript(api, player, TED_REHNISON_NPC_ID, PAGE, "entering-west-ardougne-talking-to-ted-rehnison-before-getting-the-book-from-jethick");
      return;
    }
    if (objectId === HOUSE_DOOR_MULTILOC_ID && PLAGUE_HOUSE_DOOR_TILES.some(([x, y]) => at(location, x, y))) {
      // From inside (south of the doors), and once Elena is free, the doors open as doors do (tick 837).
      if (stage >= STAGE_FREED_ELENA || player.getLocation().getY() < location.y) return;
      event.handled = true;
      // Bravek's cure moves the stage before the warrant changes hands: no warrant, no entry.
      if (stage === STAGE_HAVE_WARRANT && held(player, WARRANT_ITEM_ID)) {
        startTranscript(api, player, NpcIdentifiers.MOURNER, PAGE, WARRANT_DOOR_VARIANT);
        return;
      }
      const variant = stage === STAGE_SPOKE_TO_MILLI
        ? "finding-elena-attempting-to-enter-the-plague-house-elena-is-in-first-attempt-after-talking-to-milli-rehnison"
        : "finding-elena-attempting-to-enter-the-plague-house-elena-is-in-attempting-before-talking-to-milli-rehnison-and-subsequent-attempts";
      startTranscript(api, player, NpcIdentifiers.MOURNER, PAGE, variant);
      return;
    }
    if (objectId === ELENA_GATE_ID && at(location, 2539, 9672)) {
      // From inside the cell it opens with no word (ticks 757, 827); from outside it needs the key.
      if (player.getLocation().getX() > location.x) return;
      event.handled = true;
      if (held(player, SMALL_KEY_ITEM_ID)) unlockCell(player, object);
      else if (stage >= STAGE_FREED_ELENA) {
        // Ours: Elena has gone home; the locked door alone, as tick 762 begins.
        statement(player, "The door is locked.");
        sound(player, LOCKED_SOUND);
      } else startTranscript(api, player, NpcIdentifiers.ELENA_2, PAGE, ELENA_LOCKED_VARIANT);
    }
  }

  /** Ticks 752, 788: "You unlock the door." and the gate lets the player through; the key is kept. */
  function unlockCell(player, object) {
    statement(player, "You unlock the door.");
    api.emitCustomEvent("door:open", { player, object, handled: false });
  }

  function useCure(event) {
    if (!BRAVEK_NPC_IDS.has(event.npcId) || quest.getStage(event.player) !== STAGE_NEED_HANGOVER_CURE) return;
    const cure = event.itemId === HANGOVER_CURE_ITEM_ID && held(event.player, HANGOVER_CURE_ITEM_ID);
    const bucket = event.itemId === ItemIdentifiers.BOTTOMLESS_MILK_BUCKET && bottomlessCure(event.player);
    if (!cure && !bucket) return;
    event.handled = true;
    startTranscript(api, event.player, event.npcId, PAGE, "finding-elena-talking-to-bravek-after-getting-the-hangover-cure", undefined, event.npc ?? null);
  }

  /** Ticks 221, 232, 257: the pull, the locked rattle and the box; the first pull at stage 8 is remembered. */
  function openGrill(event) {
    if (!GRILL_IDS.includes(event.objectId) || !at(event.location, 2514, 9739)) return false;
    const { player } = event;
    if (quest.getStage(player) === STAGE_TUNNEL_OPEN && !player.getAttribute(GRILL_CHECKED_ATTRIBUTE)) {
      player.setAttribute(GRILL_CHECKED_ATTRIBUTE, true);
      player.getPacketSender().sendVarbit(VARBIT_CHECKED_GRILL, 1);
    }
    player.performAnimation(new Animation(PULL_PIPE_ANIMATION));
    sound(player, GRILL_LOCKED_SOUND);
    statement(player, "The grill is too secure.<br>You can't pull it off alone.");
    return true;
  }

  function cupboard(event) {
    if (![ObjectIdentifiers.CUPBOARD_16, ObjectIdentifiers.CUPBOARD_17].includes(event.objectId) || !at(event.location, 2574, 3334)) return false;
    const { player, object } = event;
    if (event.option === "search") {
      if (quest.getStage(player) < STAGE_GAS_MASK) return false;
      startTranscript(api, player, NpcIdentifiers.ALRENA, PAGE, "starting-the-quest-searching-the-cupboard");
    } else {
      const id = event.option === "close" ? ObjectIdentifiers.CUPBOARD_16 : ObjectIdentifiers.CUPBOARD_17;
      api.core.ObjectManager.deregister(object, true);
      api.core.ObjectManager.register(new api.core.GameObject(id, object.getLocation().clone(), object.getType(), object.getFace()), true);
    }
    return true;
  }

  /** Tick 742: the key in an item box. */
  function searchBarrel(event) {
    if (event.objectId !== ObjectIdentifiers.BARREL_11 || !at(event.location, 2534, 3268)) return false;
    const { player } = event;
    const inventory = player.getInventory();
    if (quest.getStage(player) === STAGE_HAVE_WARRANT && !held(player, SMALL_KEY_ITEM_ID) && inventory.getFreeSlots() > 0) {
      inventory.adds(SMALL_KEY_ITEM_ID, 1);
      itemBox(player, SMALL_KEY_ITEM_ID, "You find a small key in the barrel.");
    }
    return true;
  }

  function onMudPatch(objectId, location) {
    return MUD_PATCH_IDS.includes(objectId) && (location?.x ?? location?.getX?.()) === 2566
      && (location?.y ?? location?.getY?.()) >= 3331 && (location?.y ?? location?.getY?.()) <= 3333 && (location?.z ?? location?.getZ?.() ?? 0) === 0;
  }

  /** Ticks 160-181: each bucket pours with the animation and sound, in a message box. */
  function pourWater(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_SOFTEN_MUD) {
      player.sendMessage("You see no reason to do that at the moment.");
      return;
    }
    if (stage >= STAGE_WATER_4 || !held(player, ItemIdentifiers.BUCKET_OF_WATER)) return;
    player.getInventory().deleteNumber(ItemIdentifiers.BUCKET_OF_WATER, 1);
    player.getInventory().adds(ItemIdentifiers.BUCKET, 1);
    quest.setStage(player, stage + 1);
    player.performAnimation(new Animation(POUR_WATER_ANIMATION));
    sound(player, WATERING_SOUND);
    statement(player, stage + 1 === STAGE_WATER_4
      ? "You pour water onto the soil.<br>The soil is now soft enough to dig into."
      : "You pour water onto the soil.<br>The soil softens slightly.");
  }

  /**
   * Ticks 188-194: the dig, the fade and the box; three ticks later the player and Edmond are in
   * the sewer, the box shows again over the fade back in, and both go three ticks after that.
   */
  function digTunnel(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_WATER_4) {
      // Ours: the transcript's hard-ground line in the box the soft-ground dig uses.
      statement(player, "You dig the soil... The ground is rather hard.");
      return;
    }
    if (stage > STAGE_WATER_4 || digging.has(player)) return;
    digging.add(player);
    const text = "You dig deep into the soft soil... Suddenly it crumbles away! You fall through into the sewer. Edmond follows you down the hole.";
    player.getMovementQueue().reset().setBlockMovement(true);
    player.performAnimation(new Animation(DIG_ANIMATION));
    sound(player, DIG_SOUND);
    fadeOut(player);
    statement(player, text);
    later(player, 3, () => {
      digging.delete(player);
      quest.setStage(player, STAGE_TUNNEL_OPEN);
      player.moveTo(tile(SEWER_LANDING));
      fadeIn(player);
      statement(player, text);
      later(player, 2, () => player.getMovementQueue().setBlockMovement(false));
    });
  }

  /** Ticks 240-243: the tie and the sound with the stage, then the varbit and the rope's box a tick later. */
  function tieRope(player) {
    if (!player.getAttribute(GRILL_CHECKED_ATTRIBUTE)) {
      startTranscript(api, player, EDMOND_NPC_ID, PAGE, "starting-the-quest-interacting-with-the-pipe-using-rope-on-the-grill-before-trying-to-open-it-first");
      return;
    }
    if (!held(player, ItemIdentifiers.ROPE)) return;
    player.getInventory().deleteNumber(ItemIdentifiers.ROPE, 1);
    player.performAnimation(new Animation(ROPE_TIE_ANIMATION));
    sound(player, ROPE_ATTACH_SOUND);
    quest.setStage(player, STAGE_ROPE_TIED);
    later(player, 1, () => itemBox(player, ItemIdentifiers.ROPE, "You tie the end of the rope to the sewer pipe's grill."));
  }

  function handleItemOnObject(event) {
    const { player, objectId, itemId, location } = event;
    if (itemId === ItemIdentifiers.BUCKET_OF_WATER && onMudPatch(objectId, location)) {
      event.handled = true;
      pourWater(player);
      return;
    }
    if (itemId === ItemIdentifiers.SPADE && onMudPatch(objectId, location) && quest.getStage(player) <= STAGE_WATER_4 && quest.getStage(player) >= STAGE_FIND_DWELLBERRIES) {
      event.handled = true;
      digTunnel(player);
      return;
    }
    if (itemId === ItemIdentifiers.ROPE && GRILL_IDS.includes(objectId) && at(location, 2514, 9739) && quest.getStage(player) === STAGE_TUNNEL_OPEN) {
      event.handled = true;
      tieRope(player);
      return;
    }
    if (itemId === SMALL_KEY_ITEM_ID && objectId === ELENA_GATE_ID && at(location, 2539, 9672) && held(player, SMALL_KEY_ITEM_ID)) {
      event.handled = true;
      const object = event.object ?? new GameObject(ELENA_GATE_ID, new Location(2539, 9672, 0), 0, 2);
      if (player.getLocation().getX() > 2539) api.emitCustomEvent("door:open", { player, object, handled: false });
      else unlockCell(player, object);
    }
  }

  /**
   * The grill pull (ticks 268-304): fade out over an empty box, the scene in a copy of the sewer
   * three ticks later with Edmond behind the player and the tied rope's animated locs, the camera
   * and the fade back in, the pull three ticks after that, Edmond's advice six ticks later, then
   * after the player's answer a fade out and, two ticks on, the real sewer with the pipe open.
   */
  function pullGrill(player) {
    if (Scenes.get(player)) return;
    Scenes.hold(player);
    fadeOut(player);
    player.getMovementQueue().reset().setBlockMovement(true);
    Scenes.later(player, 3, () => {
      const scene = Scenes.open(player, "grill", GRILL_SCENE.bounds, {}, {
        instance: { sourceChunk: GRILL_SCENE.sourceChunk, size: GRILL_SCENE.size }, at: GRILL_SCENE.at, exit: GRILL_SCENE.at,
      });
      player.getMovementQueue().reset().setBlockMovement(true);
      Scenes.face(player, GRILL_SCENE.face);
      const edmond = Scenes.actor(scene, EDMOND_NPC_ID, GRILL_SCENE.edmond, GRILL_SCENE.face);
      const sender = player.getPacketSender();
      const area = scene.area;
      for (const [id, x, y, type, face] of GRILL_SCENE.removed) {
        sender.sendObjectRemoval(new GameObject(id, area.sourceTile(x, y, 0), type, face, area));
      }
      const ropes = GRILL_SCENE.ropes.map((rope) => ({ rope, object: Scenes.loc(scene, { id: rope.id, x: rope.x, y: rope.y, type: 10, face: 2 }) }));
      Scenes.later(scene, 1, () => {
        Scenes.camera(player, ...GRILL_SCENE.camera, GRILL_SCENE.cameraRates);
        fadeIn(player);
      });
      Scenes.later(scene, 4, () => {
        player.performAnimation(new Animation(LIFT_AND_PULL_ANIMATION));
        player.forceChat("1... 2... 3... Pull!");
        edmond?.performAnimation(new Animation(LIFT_AND_PULL_ANIMATION));
        for (const { rope, object } of ropes) sender.sendObjectAnimation(object, new Animation(rope.animation));
        sound(player, PULL_GRILL_SOUND);
      });
      Scenes.later(scene, 10, () => {
        player.performAnimation(new Animation(-1));
        edmond?.performAnimation(new Animation(-1));
        Scenes.face(player, GRILL_SCENE.edmond);
        player.getDialogueManager().startDialogues(new DialogueChainBuilder()
          .add(new NpcDialogue(0, EDMOND_NPC_ID, "Once you're in the city look for a man called Jethick. He's an old friend of the family. Hopefully he can help you."))
          .add(new PlayerDialogue(1, "Alright, thanks I will."))
          .add(new ActionDialogue(2, { execute: () => leaveGrillScene(player) })));
      });
    });
  }

  function leaveGrillScene(player) {
    Scenes.hold(player);
    fadeOut(player);
    Scenes.later(player, 2, () => {
      Scenes.end(player, false);
      if (quest.getStage(player) === STAGE_ROPE_TIED) quest.setStage(player, STAGE_PIPE_OPEN);
      player.moveTo(tile(GRILL_SCENE.at));
      player.getMovementQueue().reset().setBlockMovement(true);
      Scenes.later(player, 1, () => {
        player.getPacketSender().sendInterfaceRemoval();
        fadeIn(player);
        player.getMovementQueue().setBlockMovement(false);
      });
    });
  }

  /**
   * Ticks 314-322: the squeeze up the pipe (an exactmove three tiles in, the animation and sound),
   * the box and fade a tick later, and five ticks after that West Ardougne by the manhole.
   */
  function climbPipe(event) {
    if (event.objectId !== ObjectIdentifiers.PIPE || !at(event.location, 2514, 9737)) return false;
    const { player } = event;
    if (quest.getStage(player) < STAGE_PIPE_OPEN) {
      statement(player, "There is a grill blocking your way.");
      return true;
    }
    if (!wearingGasMask(player)) {
      startTranscript(api, player, EDMOND_NPC_ID, PAGE, "starting-the-quest-interacting-with-the-pipe-climb-up-pipe", (steps) => steps.slice(1));
      return true;
    }
    const text = "You climb up through the sewer pipe.";
    const from = tile(PIPE_FOOT);
    player.getMovementQueue().reset().setBlockMovement(true);
    player.moveTo(tile(PIPE_INSIDE));
    player.setForceMovement(new ForceMovement(from, new Location(0, PIPE_INSIDE[1] - PIPE_FOOT[1], 0), 30, 126, 2, PIPE_SQUEEZE_ANIMATION));
    player.performAnimation(new Animation(PIPE_SQUEEZE_ANIMATION, 30));
    sound(player, SQUEEZE_SOUND);
    later(player, 1, () => {
      player.setForceMovement?.(null);
      fadeOut(player);
      statement(player, text);
    });
    later(player, 6, () => {
      player.moveTo(tile(WEST_ARDOUGNE_MANHOLE_EXIT));
      if (!manholeOpen()) setManhole(true);
      sound(player, MANHOLE_OPEN_SOUND);
      fadeIn(player);
      statement(player, text);
      player.getMovementQueue().setBlockMovement(false);
    });
    return true;
  }

  /**
   * The West Ardougne manhole: open with its cover beside it whenever live shows it (ticks 322,
   * 352, 485, 838), opened by the player coming up the pipe (the manhole sound, tick 322). Ours:
   * Open and Close play the transcript's lines as game messages; no capture opens or shuts it.
   */
  function setManhole(open) {
    const { ObjectManager } = api.core;
    const [x, y, z] = MANHOLE_TILE;
    const hole = new GameObject(open ? ObjectIdentifiers.MANHOLE_3 : ObjectIdentifiers.MANHOLE_4, new Location(x, y, z), 10, 0);
    const cover = new GameObject(ObjectIdentifiers.MANHOLE_COVER, new Location(x, y - 1, z), 10, 0);
    ObjectManager.deregister(hole, true);
    ObjectManager.register(new GameObject(open ? ObjectIdentifiers.MANHOLE_4 : ObjectIdentifiers.MANHOLE_3, new Location(x, y, z), 10, 0), true);
    if (open) ObjectManager.register(cover, true);
    else ObjectManager.deregister(cover, true);
  }

  function manholeOpen() {
    const [x, y, z] = MANHOLE_TILE;
    return api.core.MapObjects.get(ObjectIdentifiers.MANHOLE_4, new Location(x, y, z), null) != null;
  }

  /** Claimed before the generic loc swaps, which would open the hole without its cover. */
  function manholeCover(event) {
    const option = String(event.option ?? "").toLowerCase();
    if (event.objectId === ObjectIdentifiers.MANHOLE_3 && option === "open" && at(event.location, MANHOLE_TILE[0], MANHOLE_TILE[1])) {
      event.handled = true;
      setManhole(true);
      event.player.sendMessage("You pull back the manhole cover.");
    } else if (event.objectId === ObjectIdentifiers.MANHOLE_COVER && option === "close" && at(event.location, MANHOLE_TILE[0], MANHOLE_TILE[1] - 1)) {
      event.handled = true;
      setManhole(false);
      event.player.sendMessage("You close the manhole cover.");
    }
  }

  /** Ticks 332-336 (and 857-861): the reach down, the box and fade, the sewer three ticks later. */
  function climbDownManhole(event) {
    if (!at(event.location, MANHOLE_TILE[0], MANHOLE_TILE[1])) return false;
    const { player } = event;
    const text = "You climb down through the manhole.";
    player.getMovementQueue().reset().setBlockMovement(true);
    player.performAnimation(new Animation(MANHOLE_CLIMB_ANIMATION));
    fadeOut(player);
    statement(player, text);
    later(player, 3, () => {
      player.moveTo(tile(MANHOLE_LANDING));
      fadeIn(player);
      statement(player, text);
      player.getMovementQueue().setBlockMovement(false);
    });
    return true;
  }

  /** Ticks 877-878: the reach, then Edmond's garden a tick later with a filterable message. */
  function climbMudPile(event) {
    if (event.objectId !== ObjectIdentifiers.MUD_PILE_2 || !at(event.location, 2519, 9759)) return false;
    climbTo(event.player, MUD_PILE_TOP, "You climb up the mud pile.");
    return true;
  }

  /** Ours: climbing back down the dug hole mirrors the mud pile, with the transcript's line. */
  function climbDownHole(event) {
    if (!onMudPatch(event.objectId, event.location)) return false;
    climbTo(event.player, SEWER_LANDING, "You climb down into the hole.");
    return true;
  }

  function climbTo(player, destination, message) {
    player.getMovementQueue().reset().setBlockMovement(true);
    player.performAnimation(new Animation(MUD_PILE_CLIMB_ANIMATION));
    later(player, 1, () => {
      player.getPacketSender().sendTypedMessage(api.core.ChatType.SPAM, message);
      player.moveTo(tile(destination));
      player.getMovementQueue().setBlockMovement(false);
    });
  }

  /** Ticks 445-446, 470-474: the Rehnisons' stairs, and the plague house's (745-747, 832-833). */
  function walkStairs(event) {
    const { player, objectId, location } = event;
    let destination = null, message = null;
    if (objectId === ObjectIdentifiers.STAIRS_9 && at(location, REHNISON_STAIRS.x, REHNISON_STAIRS.y, 0)) {
      destination = REHNISON_UPSTAIRS; message = "You walk up the stairs.";
    } else if (objectId === ObjectIdentifiers.STAIRS_10 && at(location, REHNISON_STAIRS.x, REHNISON_STAIRS.y, 1)) {
      destination = REHNISON_DOWNSTAIRS; message = "You walk down the stairs.";
    } else if (objectId === ObjectIdentifiers.SPOOKY_STAIRS && at(location, PLAGUE_HOUSE_STAIRS_DOWN.x, PLAGUE_HOUSE_STAIRS_DOWN.y)) {
      destination = PLAGUE_HOUSE_BASEMENT; message = "You walk down the stairs...";
    } else if (objectId === ObjectIdentifiers.SPOOKY_STAIRS_2 && at(location, PLAGUE_HOUSE_STAIRS_UP.x, PLAGUE_HOUSE_STAIRS_UP.y)) {
      destination = PLAGUE_HOUSE_GROUND; message = "You walk up the stairs...";
    }
    if (!destination) return false;
    player.sendMessage(message);
    player.moveTo(tile(destination));
    return true;
  }

  function claimClimb(request) {
    if (request.handled) return;
    const location = request.object?.getLocation?.();
    const event = { player: request.player, objectId: request.objectId ?? request.object?.getId?.(), location };
    if (walkStairs(event) || (request.objectId === ObjectIdentifiers.MANHOLE_4 && climbDownManhole(event))) request.handled = true;
  }

  function manholeDown(event) {
    return event.objectId === ObjectIdentifiers.MANHOLE_4 && climbDownManhole(event);
  }

  /** Bravek's hangover cure: chocolate dust + milk, then snape grass (ticks 654, 658, item boxes). */
  function handleItemOnItem(event) {
    const ids = [event.usedItemId, event.usedWithItemId];
    const hasPair = (a, b) => ids.includes(a) && ids.includes(b);
    const inventory = event.player.getInventory();
    if (hasPair(CHOCOLATE_DUST_ITEM_ID, BUCKET_OF_MILK_ITEM_ID)) {
      inventory.deleteNumber(CHOCOLATE_DUST_ITEM_ID, 1);
      inventory.deleteNumber(BUCKET_OF_MILK_ITEM_ID, 1);
      inventory.adds(CHOCOLATEY_MILK_ITEM_ID, 1);
      itemBox(event.player, CHOCOLATEY_MILK_ITEM_ID, "You mix the chocolate into the bucket.");
      event.handled = true;
      return;
    }
    if (hasPair(SNAPE_GRASS_ITEM_ID, CHOCOLATEY_MILK_ITEM_ID)) {
      inventory.deleteNumber(SNAPE_GRASS_ITEM_ID, 1);
      inventory.deleteNumber(CHOCOLATEY_MILK_ITEM_ID, 1);
      inventory.adds(HANGOVER_CURE_ITEM_ID, 1);
      itemBox(event.player, HANGOVER_CURE_ITEM_ID, "You mix the snape grass into the bucket.");
      event.handled = true;
    }
  }

  /**
   * The gas mask stays on in West Ardougne (Wiki Gas mask; ticks 392-393, 562-563). Once Biohazard
   * has started its own rule keeps it on, to that quest's end, so only one quest answers.
   */
  function maskMustStay(player) {
    return wearingGasMask(player) && inWestArdougne(player.getLocation()) && !biohazardStarted(player);
  }

  function keepMaskOn(event) {
    if (event.slot !== Equipment.HEAD_SLOT || !maskMustStay(event.player)) return;
    event.allow = false;
    event.player.sendMessage(KEEP_MASK_ON_MESSAGE);
  }

  function keepMaskOnUnequip(event) {
    if (event.item?.getId?.() !== GAS_MASK_ITEM_ID || !maskMustStay(event.player)) return;
    event.allow = false;
    event.player.sendMessage(KEEP_MASK_ON_MESSAGE);
  }

  /**
   * The client's own multis: edmond_top/edmond_bottom by 1783 (1 from the dig to Elena's
   * freeing, ticks 191 and 798), Elena at home by 1784, the dug hole 1785, the grill 1786/1787
   * and the key question 9103 (tick 765).
   */
  function syncObjects({ player, key }) {
    if (key !== undefined && key !== "plague_city") return;
    const stage = quest.getStage(player);
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_DUG_HOLE, stage >= STAGE_TUNNEL_OPEN ? 1 : 0);
    sender.sendVarbit(VARBIT_CAN_SEE_EDMOND_UP_TOP, stage >= STAGE_TUNNEL_OPEN && stage < STAGE_FREED_ELENA ? 1 : 0);
    sender.sendVarbit(VARBIT_ELENA_AT_HOME, stage >= STAGE_FREED_ELENA ? 1 : 0);
    sender.sendVarbit(VARBIT_CHECKED_GRILL, player.getAttribute(GRILL_CHECKED_ATTRIBUTE) ? 1 : 0);
    sender.sendVarbit(VARBIT_PIPE, stage >= STAGE_PIPE_OPEN ? 2 : stage >= STAGE_ROPE_TIED ? 1 : 0);
    sender.sendVarbit(VARBIT_KEY_ASKED, player.getAttribute(KEY_ASKED_ATTRIBUTE) ? 1 : 0);
  }

  function handleLogin({ player }) {
    syncObjects({ player });
    refreshQuestList(player);
  }

  /**
   * Wiki (Ardougne teleport scroll): reading it after the quest teaches the Ardougne Teleport spell and uses the
   * scroll up; any further scroll "will explode on use, converting into ashes" (no line is given for that).
   */
  function readScroll(event) {
    const { player, item, slot } = event;
    if (event.itemId !== ARDOUGNE_SCROLL_ITEM_ID) return false;
    event.handled = true;
    const inventory = player.getInventory();
    if (inventory.get(slot) !== item || !quest.isComplete(player)) return true;
    if (quest.getStage(player) >= STAGE_READ_SCROLL) {
      inventory.setItem(slot, new api.core.Item(ItemIdentifiers.ASHES, 1));
      inventory.refreshItems();
      return true;
    }
    inventory.deleteAtSlot(slot, 1);
    quest.setStage(player, STAGE_READ_SCROLL);
    player.sendMessage("You memorise what is written on the scroll. You can now use the Ardougne Teleport Spell.");
    refreshQuestList(player);
    return true;
  }

  quest = registerQuest(api, {
    key: "plague_city",
    name: "Plague City",
    varpId: VARP_PLAGUE_CITY,
    startedValue: STAGE_FIND_DWELLBERRIES,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.MINING.getIndex(), amount: 2425, label: "Mining" }],
    rewardItemId: ARDOUGNE_SCROLL_ITEM_ID,
    // Tick 883: the scroll shows the gas mask and lists "An Ardougne Teleport Scroll".
    scrollItemId: GAS_MASK_ITEM_ID,
    rewardItemLabel: "An Ardougne Teleport Scroll",
    buildJournal,
    onReward: grantReward,
  });

  api.persistAttribute(GRILL_CHECKED_ATTRIBUTE, false);
  api.persistAttribute(KEY_ASKED_ATTRIBUTE, false);
  api.persistAttribute(CURE_GIVEN_ATTRIBUTE, false);
  api.onCustomEvent("quest:stage-changed", syncObjects);
  api.onCustomEvent("door:toggle", handleDoor);
  api.onCustomEvent("ladders:climb", claimClimb);
  api.onObjectInteraction("Grill", { Open: openGrill });
  api.onObjectInteraction("Pipe", { "Climb-up": climbPipe });
  api.onObjectInteraction("Manhole", { "Climb-down": manholeDown });
  api.onBeforeObjectInteraction(manholeCover);
  api.onObjectInteraction("Mud pile", { Climb: climbMudPile });
  api.onObjectInteraction("Dug hole", { "Climb-down": climbDownHole });
  api.onObjectInteraction("Stairs", { "Walk-up": walkStairs, "Walk-down": walkStairs });
  api.onObjectInteraction("Spooky stairs", { "Walk-up": walkStairs, "Walk-down": walkStairs });
  api.onObjectInteraction("Cupboard", { Open: cupboard, Close: cupboard, Search: cupboard });
  api.onObjectInteraction("Barrel", { Search: searchBarrel });
  api.onItemOnObject(handleItemOnObject);
  api.onItemOnNpc(useCure);
  api.onCanEquip(keepMaskOn);
  api.onCanUnequip(keepMaskOnUnequip);
  api.onBeforeNpcInteraction(elenaThroughTheWall);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onItemOnItem(handleItemOnItem);
  api.onItemAction("Ardougne teleport scroll", { Read: readScroll });
  api.onPlayerLogin(handleLogin);
};
