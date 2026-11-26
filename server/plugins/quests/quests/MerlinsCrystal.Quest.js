/**
 * Merlin's Crystal (members).
 *
 * Built against a whole run of the quest on live: the user's RSProx capture MerlinsCrystal.bin
 * (revision 242), with two more revision 242 runs up to the Lady of the Lake's test (local 1001800,
 * 1001994: the bread on the first visit, the wrong incantation). docs/quests/merlins-crystal/README.md
 * lists the facts and their ticks. Spoken lines come from the "Merlin's Crystal" transcript page and the
 * knights' own pages; messages are the Wiki's, sent as the capture sends them (game message or
 * message box).
 *
 * Stages (varp 14 arthur): 1 started, 2 Gawain named Morgan Le Faye, 3 Lancelot named the
 * Catherby deliveries, 4 Morgan told the ritual, 5 Thrantax weakened the crystal, 6 Merlin freed,
 * 7 complete.
 *
 * Route: Quest Helper pinned at
 * https://github.com/Zoinkwiz/quest-helper/blob/06da90f982518a093f2fe1c9cfac5547fa7053d3/src/main/java/com/questhelper/helpers/quests/merlinscrystal/MerlinsCrystal.java
 */
module.exports = function registerMerlinsCrystalQuest(api) {
  const {
    ItemIdentifiers: I,
    NpcIdentifiers: N,
    ObjectIdentifiers: O,
    Equipment,
    Location,
    ObjectManager,
    CountdownTask,
    TaskManager,
    HitDamage,
    HitMask,
    Animation,
    Graphic,
    MultiChatboxPrompt,
  } = api.core;
  const {
    registerQuest, refreshQuestList, startTranscript, questStartMessage, getRegisteredQuests, loadTranscripts, giveReward,
  } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");

  const PAGE = "Merlin's Crystal";
  const VARP_ARTHUR = 14;

  const STAGE_STARTED = 1;
  const STAGE_SPOKEN_GAWAIN = 2;
  const STAGE_SPOKEN_LANCELOT = 3;
  const STAGE_SPOKEN_MORGAN = 4;
  const STAGE_EXCALIBUR_BOUND = 5;
  const STAGE_MERLIN_FREED = 6;
  const STAGE_COMPLETE = 7;

  const START_HOOK = "quest:merlin-s-crystal:start";

  // Saved progress live keeps server side (no varbit moves for any of it in the capture).
  const READ_INCANTATION_ATTRIBUTE = "quest.merlin-s-crystal:read-incantation";
  const LADY_TEST_ATTRIBUTE = "quest.merlin-s-crystal:lady-s-test";
  const BEGGAR_ASKED_ATTRIBUTE = "quest.merlin-s-crystal:beggar-asked";
  const BEGGAR_DONE_ATTRIBUTE = "quest.merlin-s-crystal:beggar-rewarded";
  const HIVE_REPELLED_ATTRIBUTE = "quest.merlin-s-crystal:hive-repelled";
  const CRATE_EXIT_ATTRIBUTE = "quest.merlin-s-crystal:crate-exit";
  // Heard the candle maker's terms: his next talk asks for the wax (tick 1338), until he hands over a candle
  // (local 1001994: his opening line again for the second candle).
  const CANDLE_ASKED_ATTRIBUTE = "quest.merlin-s-crystal:candle-asked";

  // --- Ids -----------------------------------------------------------------------------------------
  const ARTHUR_IDS = new Set([N.KING_ARTHUR, N.ARTHUR, N.KING_ARTHUR_2, N.KING_ARTHUR_3]);
  const MORDRED_NPC_ID = N.SIR_MORDRED; // 3527
  const MORGAN_NPC_ID = N.MORGAN_LE_FAYE; // 3528
  const MORGAN_IDS = new Set([N.MORGAN_LE_FAYE, N.MORGAN_LE_FAYE_2]);
  const MERLIN_NPC_ID = N.MERLIN; // 3529
  const THRANTAX_NPC_ID = N.THRANTAX_THE_MIGHTY; // 3518
  const LADY_NPC_ID = N.THE_LADY_OF_THE_LAKE; // 3530
  const BEGGAR_NPC_ID = N.BEGGAR; // 3532 lake_beggar
  const CANDLE_MAKER_NPC_ID = N.CANDLE_MAKER; // 3199
  const ARHEIN_NPC_ID = N.ARHEIN; // 3200

  /** Camelot's knights (the capture's ids, ticks 447-624) and their pages' variant names. */
  const KNIGHTS = new Map([
    [N.SIR_LANCELOT, "sir-lancelot"], [N.SIR_LANCELOT_2, "sir-lancelot"],
    [N.SIR_GAWAIN, "sir-gawain"], [N.SIR_GAWAIN_3, "sir-gawain"],
    [N.SIR_KAY, "sir-kay"], [N.SIR_KAY_3, "sir-kay"],
    [N.SIR_BEDIVERE, "sir-bedivere"],
    [N.SIR_TRISTRAM, "sir-tristram"],
    [N.SIR_PELLEAS, "sir-pelleas"], [N.SIR_PELLEAS_3, "sir-pelleas"],
    [N.SIR_LUCAN, "sir-lucan"],
    [N.SIR_PALOMEDES, "sir-palomedes"],
  ]);
  const KNIGHT_PAGES = {
    "sir-lancelot": "Sir Lancelot", "sir-gawain": "Sir Gawain", "sir-kay": "Sir Kay", "sir-bedivere": "Sir Bedivere",
    "sir-tristram": "Sir Tristram", "sir-pelleas": "Sir Pelleas", "sir-lucan": "Sir Lucan", "sir-palomedes": "Sir Palomedes",
  };

  const CATHERBY_CRATE_OBJECT_ID = O.CRATE_2; // 63 merlincrate_empty
  const GIANT_CRYSTAL_OBJECT_ID = O.GIANT_CRYSTAL; // 62 merlins_crystal
  const CHAOS_ALTAR_OBJECT_ID = O.CHAOS_ALTAR; // 61 thrantaxaltar
  const BEEHIVE_OBJECT_ID = O.BEEHIVE; // 68 merlin_beehive
  const JEWELLERS_DOOR_OBJECT_ID = O.DOOR_5; // 59 jewellersdoor, Port Sarim 3016,3246
  /** Keep Le Faye's front doors (lefayeunopenabledoorl/r), on 2763,3401-3402 with the keep to the east. */
  const KEEP_FRONT_DOOR_IDS = new Set([O.LARGE_DOOR, O.LARGE_DOOR_2]); // 71, 72
  const KEEP_FRONT_DOOR_X = 2763;
  const MERLIN_WORKSHOP_DOOR_OBJECT_ID = O.DOOR_4; // 24 merlinworkshop
  const MERLIN_WORKSHOP_DOOR_TILE = { x: 2764, y: 3503, z: 1 };

  const EXCALIBUR_ITEM_ID = I.EXCALIBUR; // 35
  const COINS_ITEM_ID = I.COINS;
  const BLACK_CANDLE_ITEM_ID = I.BLACK_CANDLE; // 38 unlit_black_candle
  const LIT_BLACK_CANDLE_ITEM_ID = I.LIT_BLACK_CANDLE; // 32
  const BUCKET_OF_WAX_ITEM_ID = I.BUCKET_OF_WAX; // 30
  const BAT_BONES_ITEM_ID = I.BAT_BONES; // 530
  const BREAD_ITEM_ID = I.BREAD;
  const HAMMER_ITEM_ID = I.HAMMER;
  const BUCKET_ITEM_ID = I.BUCKET;
  const INSECT_REPELLENT_ITEM_ID = I.INSECT_REPELLENT;
  const BEEKEEPER_ITEM_IDS = [I.BEEKEEPERS_HAT, I.BEEKEEPERS_TOP, I.BEEKEEPERS_LEGS, I.BEEKEEPERS_GLOVES, I.BEEKEEPERS_BOOTS];

  // --- Capture facts -------------------------------------------------------------------------------
  const SEQ_CLIMB_INTO_CRATE = 827; // human_pickupfloor, delay 10 (tick 926)
  const SEQ_SMASH = 390; // human_sword_slash (tick 2053)
  const SOUND_SMASH = 2656; // mine
  const GFX_SMOKEPUFF = 86; // Morgan (height 124, ticks 1080, 1153) and Thrantax (height 0, tick 1948)
  const MORGAN_PUFF_HEIGHT = 124;
  const SOUND_SMOKEPUFF = 1930; // with Thrantax (tick 1948)
  const SOUND_SMOKEPUFF_RANGE = 10;
  /** Thrantax stays this long after the wrong words (local 1001994 ticks 17490-17522). */
  const THRANTAX_ANGRY_TICKS = 32;

  // The crate: a one-chunk copy of 2776,9848 while the player rides (rebuild_region, tick 928).
  const CRATE_SOURCE_CHUNK = [2776 >> 3, 9848 >> 3];
  const CRATE_RIDE_TILE = [2777, 9849, 0];
  const CRATE_RIDE_BOUNDS = [[2776, 2783, 9848, 9855, 0]];
  const CRATE_START_TILE = [2801, 3443, 0]; // where the player climbed in (tick 928)
  const KEEP_ARRIVAL_TILE = new Location(2778, 3401, 0); // tick 966
  const CRATE_FADE_IN_TICKS = 2; // the copy and the fade in, two ticks after Yes (926 -> 928)
  const CRATE_OUT_FADE_CYCLES = 15; // the fade before the keep (tick 965)
  const CRATE_OUT_MOVE_TICKS = 1; // the move to the keep (966)
  const CRATE_OUT_BOX_TICKS = 5; // "You climb out of the crate." with everything back (971)

  const MORDRED_ROOM = { minX: 2762, maxX: 2777, minY: 3395, maxY: 3410, levels: [2] };
  const MORGAN_TILE = { x: 2770, y: 3403, z: 2 }; // tick 1080
  const MORDRED_BODY_TICKS = 2; // Mordred and Morgan go together after "You kill Mordred." (1087 -> 1089)

  const RITUAL_TILE = new Location(2780, 3515, 0); // Thrantax's tile (ticks 1948, local 1001800, 1001994)
  const RITUAL_TILE_RADIUS = 1;
  const RITUAL_STEP_TILE = new Location(2778, 3515, 0); // the player steps two tiles west (1945-1946)
  const RITUAL_SPIRIT_TICKS = 3; // the drop at 1945, the spirit at 1948
  const INCANTATION = "Snarthon Candtrick Termanto";
  const WRONG_INCANTATIONS = ["Snarthtrick Candanto Termon", "Snarthanto Candon Termtrick"];

  const GIANT_CRYSTAL_TILE = new Location(2767, 3493, 2);

  const BEGGAR_TILE = { x: 3016, y: 3247, z: 0 }; // ticks 1600, 1617
  const JEWELLERS_DOOR_TILE = { x: 3016, y: 3246, z: 0 };
  const SARIM_SHOP_ZONE = { minX: 3008, maxX: 3024, minY: 3240, maxY: 3256, levels: [0] };
  const CAMELOT_TOWER_ZONE = { minX: 2764, maxX: 2771, minY: 3489, maxY: 3496, levels: [2] };

  // --- Dialogue keys (text, not step ids: the dumper's ids follow the page) -----------------------
  const HIDE_PROMPT = "Would you like to hide inside the crate?";
  const CLIMB_OUT_PROMPT = "Would you like to get back out of the crate?";
  const CLIMB_OUT_TEXT = "You climb out of the crate.";
  const MORGAN_APPEARS_TEXT = "Morgan Le Faye appears.";
  const MORGAN_VANISHES_TEXT = "Morgan Le Faye vanishes.";
  const MORDRED_KILLED_TEXT = "You kill Mordred.";
  const MORDRED_ATTACKS_TEXT = "Sir Mordred attacks.";
  const MORGAN_RITUAL_LINE = "Then you will need the sword Excalibur with which the spell was bound in order to shatter the crystal.";
  const MORGAN_OPTIONS = ["So where can I find Excalibur?", "OK I will do all that.", "What are the magic words?"];
  const BREAD_GIVEN_TEXT = "You give the bread to the beggar.";
  const BEGGAR_TURNS_TEXT = "The beggar has turned into the Lady of the Lake!";
  const EXCALIBUR_GIVEN_LINE = "Here is Excalibur, guard it well.";
  const LADY_TEST_OPTION = "I seek the sword Excalibur.";
  const LADY_TEST_LINE = "First I need you to travel to Port Sarim. Then go to the upstairs room of the jeweller's shop there.";
  const ALTAR_TEXT = "You find a small inscription at the bottom of the altar. It reads: 'Snarthon Candtrick Termanto'.";
  const SPIRIT_APPEARS_TEXT = "Suddenly a mighty spirit appears!";
  const THRANTAX_DEED_LINE = "The deed is done. Thou mayst now shatter Merlin's crystal with Excalibur, and I can once more rest. Begone! And leave me once more in peace.";
  const THRANTAX_ROAR = "GRAAAAAARGH!";
  const THRANTAX_ATTACKS_TEXT = "Thrantax the Mighty destroys the black candle and attacks";
  const INCANTATION_ORDER_TEXT = "(The following options may appear in any order)";
  const CRYSTAL_SHATTERS_TEXT = "... and it shatters under the force of Excalibur!";
  const MERLIN_FREED_TEXT = "You have set Merlin free. Now talk to King Arthur.";
  const CANDLE_EXCHANGE_ACTION = "a black candle";
  const QUEST_COMPLETE_ACTION = "Congratulations! Quest complete!";
  const CRYSTAL_ALREADY_FREED = "You have already freed Merlin from the giant crystal."; // Wiki: Giant crystal; tick 2263
  const KEEP_DOOR_LOCKED = "The door is securely locked. You will have to find another way in."; // tick 1264
  const WORKSHOP_DOOR_SHUT = "The door won't open."; // tick 2185
  /** The page's {{mes}} lines: game messages. Every other message step of the page is a message box. */
  const GAME_MESSAGES = new Set([
    MORDRED_KILLED_TEXT,
    "You can sense a powerful presence here...",
    "You attempt to smash the crystal...",
    "...but your weapon didn't do any damage at all.",
    "...but hammering it had absolutely no effect.",
    "...but it seems to be protected by a dark force",
    CRYSTAL_SHATTERS_TEXT,
  ]);
  /** Narration the capture never shows (the Wiki's stage directions, not messages). */
  const SILENT_ACTIONS = new Set([MORGAN_APPEARS_TEXT, INCANTATION_ORDER_TEXT]);

  // Beehive (Wiki Transcript:Beehive, revision as cached in the PR): item boxes.
  const HIVE_REPELLENT_BOX = "You pour insect repellent on the beehive. You see bees leaving the hive.";
  const HIVE_REPELLENT_AGAIN_BOX = "You pour insect repellent on the beehive again. The bees have already left.";
  const HIVE_TRY_BOX = "You try to get some wax from the beehive...";
  const HIVE_FILLED_BOX = "You succeed in filling your bucket! Meanwhile, the bees fly back to the hive as the repellent wears off.";
  const HIVE_ATTIRE_BOX = "Your protective attire lets you fill the bucket despite the angry bees!";
  const HIVE_STING = "Bees fly out of the hive and sting you!";
  const HIVE_STING_HINT = "Maybe you can find something to drive them away briefly.";
  const HIVE_STING_DAMAGE = 2;

  let quest;
  const Scenes = createQuestScenes(api, { onEnd: crateRideEnded, recoveryAttribute: CRATE_EXIT_ATTRIBUTE });

  const inventory = (player) => player.getInventory();
  const has = (player, itemId) => inventory(player).getAmount(itemId) > 0;
  const banked = (player, itemId) => {
    const banks = player.getBanks?.() ?? (player.getBank ? [player.getBank()] : []);
    return banks.some((bank) => Number(bank?.getAmount?.(itemId) ?? 0) > 0);
  };
  const wielded = (player, itemId) => player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.() === itemId;
  /** Excalibur in the inventory, the weapon slot or the bank. */
  const ownsExcalibur = (player) => has(player, EXCALIBUR_ITEM_ID) || wielded(player, EXCALIBUR_ITEM_ID) || banked(player, EXCALIBUR_ITEM_ID);
  /** The sword on the player (inventory or weapon slot); a banked sword does not count. */
  const carriesExcalibur = (player) => has(player, EXCALIBUR_ITEM_ID) || wielded(player, EXCALIBUR_ITEM_ID);
  /**
   * The sword the crystal is struck with: Smash swings the wielded weapon (the capture wields Excalibur
   * first, tick 2047; the page's "...but your weapon didn't do any damage at all."), Excalibur used on the
   * crystal (the Wiki's walkthrough) is the sword itself.
   */
  const smashingWith = new WeakMap();
  const strikesWithExcalibur = (player) => smashingWith.get(player) === "use" ? carriesExcalibur(player) : wielded(player, EXCALIBUR_ITEM_ID);
  const stageOf = (player) => quest.getStage(player);
  /** A door event's tile is a Location or a plain { x, y, z }. */
  const coords = (at) => (typeof at?.getX === "function" ? { x: at.getX(), y: at.getY(), z: at.getZ() } : at ?? null);
  const atTile = (location, tile) => {
    const at = coords(location);
    return !!at && at.x === tile.x && at.y === tile.y && at.z === tile.z;
  };
  const inZone = (location, zone) => location.getX() >= zone.minX && location.getX() <= zone.maxX
    && location.getY() >= zone.minY && location.getY() <= zone.maxY && zone.levels.includes(location.getZ());
  const chatOpen = (player) => player.getDialogueManager?.()?.isActive?.() === true || !!MultiChatboxPrompt?.getPending?.(player);
  const registered = (mobile) => mobile?.isRegistered?.() !== false;
  const puff = (player, tile, height = 0) => player.getPacketSender().sendGlobalGraphic(Graphic.atHeight(GFX_SMOKEPUFF, height), tile);

  function advanceTo(player, stage) {
    if (stageOf(player) < stage) quest.setStage(player, stage);
  }

  /** Runs `callback` once the player's chatbox has shut (checked each tick); never for a logged-out player. */
  function whenChatCloses(player, callback, key = player) {
    TaskManager.submit(new CountdownTask(key, 1, () => {
      if (player.isRegistered?.() === false) return;
      if (chatOpen(player)) return whenChatCloses(player, callback, key);
      callback();
    }));
  }

  // ==================================================================================================
  // Journal (captured at ticks 437, 668, 781, 1495, 1674, 1981 and 2067; journalAsSent)
  // ==================================================================================================

  const JOURNAL_STARTED = [
    "<str>I spoke to King Arthur and he said I would be worthy of",
    "<str><str>becoming a Knight of the Round Table if I could free <str>Merlin",
    "<str>from a giant crystal that he has been trapped in.",
  ];
  const JOURNAL_GAWAIN_DONE = ["<str>Gawain told me it was the work of Morgan Le Faye."];
  const JOURNAL_LANCELOT_DONE = [
    "<str>I told Lancelot of Gawain's suspicions, and he told me <str>that",
    "<str>Mordred's Fortress is not completely impenetratable.",
  ];
  const JOURNAL_MORGAN_DONE = [
    "<str>I stowed away in a shipment of candles and reached the",
    "<str><str>Stronghold of Sir Mordred, and bested him in combat.",
    "<str>In return for sparing her son, Morgan Le Faye told me how I",
    "<str>could break the spell that had imprisoned Merlin.",
  ];
  const JOURNAL_THRANTAX_DONE = [
    "<str>I summoned the Spirit Thrantax and forced him to aid me <str>in",
    "<str>breaking Morgan Le Fayes curse upon Merlin. He used <str>his",
    "<str>magic to weaken the crystal so that a blow from <str>Excalibur",
    "<str>would be able to shatter it for good.",
  ];

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    // The overview's start sentence (Ours: as the journal had it before the capture).
    if (stage < STAGE_STARTED) return ["I can start this quest by speaking to <col=800000>King Arthur</col>", "in Camelot Castle."];
    const lines = [...JOURNAL_STARTED];
    if (stage === STAGE_STARTED) {
      return [
        ...lines, "",
        "<col=000080>I should ask the <col=800000>other Knights<col=000080> if they have any <col=800000>advice <col=000080>for me",
        "<col=000080>on how I should go about doing this.",
      ];
    }
    if (stage === STAGE_SPOKEN_GAWAIN) {
      return [
        ...lines,
        "<col=800000>Gawain<col=000080> thinks this was the work of <col=800000>Morgan Le Faye<col=000080> who <col=000080>lives in",
        "<col=000080>an <col=800000>impenetrable fortress<col=000080> south of here full of <col=800000>renegade",
        "<col=800000>knights<col=000080> led by the evil <col=800000>Sir Mordred",
      ];
    }
    lines.push(...JOURNAL_GAWAIN_DONE, ...JOURNAL_LANCELOT_DONE);
    if (stage === STAGE_SPOKEN_LANCELOT) {
      return [...lines, "<col=000080>There might be a way to enter with a <col=800000>delivery by sea<col=000080>..."];
    }
    lines.push(...JOURNAL_MORGAN_DONE);
    if (stage === STAGE_SPOKEN_MORGAN) {
      return [
        ...lines,
        "<col=000080>I need to summon the spirit <col=800000>Thrantax<col=000080> at a <col=800000>magic symbol <col=000080>as",
        "<col=000080>close to the Crystal as I can possibly find.",
        "<col=000080>To bind <col=800000>Thrantax<col=000080> to my will I will need the following:",
        "<col=000080>Some <col=800000>magic words<col=000080> from a <col=800000>Chaos Altar",
        "<col=000080>A <col=800000>lit Black Candle",
        carriesExcalibur(player)
          ? "<str>I have the Holy Sword Excalibur with me"
          : "<col=000080>The <col=800000>Holy Sword Excalibur<col=000080> from the <col=800000>Lady of the Lake",
        // Ours: every captured snapshot had the bones on the player; the unstruck line follows the sword's.
        has(player, BAT_BONES_ITEM_ID) ? "<str>I have some bat bones with me" : "<col=000080>Some <col=800000>bat bones",
      ];
    }
    if (stage === STAGE_EXCALIBUR_BOUND) {
      return [
        ...lines,
        "<str>I need to summon the spirit <str>Thrantax<str> at a <str>magic symbol <str>as",
        "<str>close to the Crystal as I can possibly find.",
        ...JOURNAL_THRANTAX_DONE,
        "<col=000080>I should free <col=800000>Merlin<col=000080> by using <col=800000>Excalibur<col=000080> on the <col=800000>crystal",
      ];
    }
    lines.push(
      "<str>I need to summon the spirit <str>Thrantax<col=000080> at a <str>magic symbol <str>as",
      "<str><col=000080>close to the Crystal as I can possibly find.",
      ...JOURNAL_THRANTAX_DONE,
      "<str>I freed Merlin by shattering the Crystal that trapped him",
    );
    if (stage === STAGE_MERLIN_FREED) {
      return [
        ...lines,
        "<col=000080>Now that <col=800000>Merlin<col=000080> is freed I should speak to <col=800000>King Arthur<col=000080> to <col=000080>claim",
        "<col=000080>my <col=800000>reward<col=000080> and become a <col=800000>Knight of the Round Table",
      ];
    }
    // Ours: the completed journal is not captured.
    return [
      ...lines,
      "<str>Now that Merlin is freed I should speak to King Arthur to <str>claim",
      "<str>my reward and become a Knight of the Round Table",
      "",
      "<col=ff0000>QUEST COMPLETE!",
    ];
  }

  // ==================================================================================================
  // Who says what
  // ==================================================================================================

  /** Variants the knights' pages have, by stage: the quest page's sections, then their own pages after. */
  const KNIGHT_STAGE_VARIANTS = (slug) => [
    `investigating-merlin-s-entrapment-${slug}`,
    `investigating-keep-le-faye-${slug}`,
    `searching-for-excalibur-asking-the-knights-${slug}`,
  ];

  function variantExists(page, variant) {
    return Array.isArray(loadTranscripts(api)?.[page]?.variants?.[variant]);
  }

  /**
   * Stage 1 the entrapment questions; 2-3 the keep (Pelleas, Bedivere and Palomedes at stage 3, ticks
   * 573-604); 4-6 Excalibur (Palomedes at 4, tick 1631; Gawain at 6, tick 1689, as the Wiki's trivia
   * says). A knight with no section for a stage keeps the one before (Lancelot has no Excalibur one).
   */
  function knightVariant(slug, stage) {
    const [entrapment, keep, search] = KNIGHT_STAGE_VARIANTS(slug);
    if (stage >= STAGE_SPOKEN_MORGAN && variantExists(PAGE, search)) return search;
    if (stage >= STAGE_SPOKEN_GAWAIN && variantExists(PAGE, keep)) return keep;
    return entrapment;
  }

  /** After the quest the knights' own pages: after King's Ransom that quest's lines where they have them. */
  function knightAfterQuest(slug, player) {
    const page = KNIGHT_PAGES[slug];
    const kingsRansom = getRegisteredQuests().findLast((entry) => entry.key === "kings_ransom");
    if (kingsRansom?.isComplete(player)) {
      for (const variant of ["standard-dialogue-after-completing-king-s-ransom", "after-king-s-ransom"]) {
        if (variantExists(page, variant)) return { page, variant };
      }
    }
    // Gawain's page has no "after Merlin's Crystal" section of its own; the capture plays its
    // "after Merlin's Crystal and Holy Grail" one with Holy Grail not started (tick 2242).
    for (const variant of [
      "standard-dialogue-after-completing-merlin-s-crystal",
      "after-merlin-s-crystal",
      "standard-dialogue-after-completing-merlin-s-crystal-and-holy-grail",
    ]) {
      if (variantExists(page, variant)) return { page, variant };
    }
    return null;
  }

  function arthurVariant(stage) {
    if (stage >= STAGE_MERLIN_FREED) return "finishing-up";
    if (stage >= STAGE_STARTED) return "starting-off-subsequent-dialogue";
    return "starting-off";
  }

  /** Lady of the Lake: her test while the sword is still to be won (stages 4-5); lost before the crystal, again. */
  function ladyTestOpen(player) {
    const stage = stageOf(player);
    return stage >= STAGE_SPOKEN_MORGAN && stage < STAGE_MERLIN_FREED;
  }

  function beggarTestPending(player) {
    if (!ladyTestOpen(player) || ownsExcalibur(player)) return false;
    return player.getAttribute(LADY_TEST_ATTRIBUTE) === true && player.getAttribute(BEGGAR_DONE_ATTRIBUTE) !== true;
  }

  function selectVariant({ npcId, player, npc }) {
    const stage = stageOf(player);
    if (ARTHUR_IDS.has(npcId)) {
      if (quest.isComplete(player)) return { page: "King Arthur", variant: "standard-dialogue-after-completing-merlin-s-crystal" };
      return { page: PAGE, variant: arthurVariant(stage) };
    }
    const slug = KNIGHTS.get(npcId);
    if (slug) {
      if (quest.isComplete(player)) return knightAfterQuest(slug, player);
      // Before the start the knights belong to their own pages.
      return stage < STAGE_STARTED ? null : { page: PAGE, variant: knightVariant(slug, stage) };
    }
    if (MORGAN_IDS.has(npcId)) {
      // Only our own Morgan (King's Ransom has hers); she pleads again while Mordred is spared.
      if (!morganOf(player) || morganOf(player) !== npc) return null;
      return { page: PAGE, variant: "inside-keep-le-faye-defeating-sir-mordred" };
    }
    if (npcId === MORDRED_NPC_ID) {
      if (stage !== STAGE_SPOKEN_LANCELOT) return null;
      return { page: PAGE, variant: "inside-keep-le-faye-encountering-sir-mordred" };
    }
    if (npcId === MERLIN_NPC_ID) {
      // Only the Merlin freed from the crystal (ours, owner-only); the workshop's belongs to Holy Grail.
      if (!npc || smashScenes.get(player)?.merlin !== npc) return null;
      return { page: PAGE, variant: "smashing-talking-to-merlin-again" };
    }
    if (npcId === CANDLE_MAKER_NPC_ID) {
      // The black candle only while the ritual's items are gathered (the capture, stage 4, ticks 1338-1356).
      if (stage !== STAGE_SPOKEN_MORGAN) return null;
      return {
        page: PAGE,
        variant: player.getAttribute(CANDLE_ASKED_ATTRIBUTE) === true
          ? "obtaining-the-black-candle-returning-to-the-candle-maker"
          : "obtaining-the-black-candle-talking-to-the-candle-maker",
      };
    }
    if (npcId === ARHEIN_NPC_ID) {
      return stage === STAGE_SPOKEN_LANCELOT ? { page: PAGE, variant: "infiltrating-the-keep-talking-to-arhein" } : null;
    }
    if (npcId === LADY_NPC_ID) {
      if (quest.isComplete(player)) return { page: "The Lady of the Lake", variant: "after-completing-merlin-s-crystal" };
      // The Lady who was the beggar says only her test's end.
      if (beggarScenes.get(player)?.lady === npc) return null;
      return ladyTestOpen(player) ? { page: PAGE, variant: "searching-for-excalibur-the-lady-of-the-lake" } : null;
    }
    if (npcId === BEGGAR_NPC_ID) {
      if (!npc || beggarScenes.get(player)?.beggar !== npc) return null;
      return { page: PAGE, variant: "searching-for-excalibur-talking-to-the-beggar-again-if-they-were-not-given-bread-initially" };
    }
    if (npcId === THRANTAX_NPC_ID) return null;
    return null;
  }

  /** The page's prose conditions. */
  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    const stage = stageOf(player);
    if (value.includes("does not have the bucket of wax")) return !has(player, BUCKET_OF_WAX_ITEM_ID);
    if (value.includes("has the bucket of wax")) return has(player, BUCKET_OF_WAX_ITEM_ID);
    if (value.includes("has no bread")) return !has(player, BREAD_ITEM_ID);
    if (value.includes("has bread")) return has(player, BREAD_ITEM_ID);
    if (value.includes("does not have excalibur in their bank or inventory")) return !ownsExcalibur(player);
    if (value.includes("has excalibur in their bank or inventory")) return ownsExcalibur(player);
    if (value.includes("does not have at least 500 coins")) return inventory(player).getAmount(COINS_ITEM_ID) < 500;
    if (value.includes("has at least 500 coins")) return inventory(player).getAmount(COINS_ITEM_ID) >= 500;
    if (value.includes("doesn't have excalibur but has a hammer")) return !strikesWithExcalibur(player) && has(player, HAMMER_ITEM_ID);
    // The page lists the plain branch first; keep it from swallowing the hammer one.
    if (value.includes("doesn't have excalibur")) return !strikesWithExcalibur(player) && !has(player, HAMMER_ITEM_ID);
    if (value.includes("excalibur but doesn't have thrantax")) return strikesWithExcalibur(player) && stage < STAGE_EXCALIBUR_BOUND;
    if (value.includes("excalibur and thrantax")) return strikesWithExcalibur(player) && stage >= STAGE_EXCALIBUR_BOUND;
    return null;
  }

  /** Yes to King Arthur: the stage, then "You've started a new quest" (tick 423). */
  function handleStartHook({ player, npcId, hook }) {
    if (!ARTHUR_IDS.has(npcId) || hook !== START_HOOK) return;
    if (stageOf(player) >= STAGE_STARTED) return;
    quest.setStage(player, STAGE_STARTED);
    player.sendMessage(questStartMessage(player, PAGE));
  }

  /**
   * Live leaves the option just asked out of Morgan's menu when it comes back (ticks 1216-1229); the
   * incantations come in a new order each time (ticks 1953, local 1001994 17478); the Lady keeps
   * her test to herself while the player has the sword (tick 1340).
   */
  function shapeMenu(notice) {
    const { player, npcId } = notice ?? {};
    if (!player) return;
    const options = Array.isArray(notice.options) ? notice.options : [];
    const texts = options.map((option) => option.text);
    if (npcId === THRANTAX_NPC_ID && texts.includes(INCANTATION)) {
      const shuffled = [...options];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      notice.options = shuffled;
      return;
    }
    // "No." to getting out asks again (the page's {{tact|above}}, which the export leaves as an empty menu;
    // ticks 956-965 show the same menu again).
    if (npcId === ARHEIN_NPC_ID && notice.prompt === CLIMB_OUT_PROMPT && options.length === 0) {
      const earlier = (notice.history ?? []).find((menu) => menu.step?.prompt === CLIMB_OUT_PROMPT && (menu.step.options ?? []).length);
      if (earlier) notice.options = earlier.step.options;
      return;
    }
    if (MORGAN_IDS.has(npcId) && texts.includes(MORGAN_OPTIONS[1]) && notice.chosen && texts.includes(notice.chosen)) {
      notice.options = options.filter((option) => option.text !== notice.chosen);
      return;
    }
    if (npcId === LADY_NPC_ID && texts.includes(LADY_TEST_OPTION) && ownsExcalibur(player)) {
      notice.options = options.filter((option) => option.text !== LADY_TEST_OPTION);
    }
  }

  function handleChoice({ player, npcId, option, prompt }) {
    const text = String(option ?? "");
    if (npcId === ARHEIN_NPC_ID && prompt === HIDE_PROMPT && text === "Yes.") return climbIntoCrate(player);
    if (npcId === ARHEIN_NPC_ID && prompt === CLIMB_OUT_PROMPT && text === "Yes.") return climbOutOfCrate(player);
    // Gawain names Morgan on his line (tick 649: varp 14 -> 2 after "She lives in her stronghold...");
    // the choice itself only starts the answer.
    if (npcId === LADY_NPC_ID && text === LADY_TEST_OPTION) {
      // Her test, set again for a sword lost before the crystal (ticks 1351-1362).
      player.setAttribute(LADY_TEST_ATTRIBUTE, true);
      player.setAttribute(BEGGAR_ASKED_ATTRIBUTE, false);
      player.setAttribute(BEGGAR_DONE_ATTRIBUTE, false);
    }
  }

  /** Lines whose continue moves the quest on, as the capture's ticks show. */
  function handleLine(event) {
    const { player, step } = event;
    if (!player || !step) return;
    const text = String(event.text ?? "");
    const speaker = step.speaker ?? event.definition?.getName?.();
    if (speaker === "Sir Gawain" && text.startsWith("She lives in her stronghold to the south of here")) {
      // varp 14 1 -> 2 as the line is continued (tick 649).
      event.after = () => advanceTo(player, STAGE_SPOKEN_GAWAIN);
      return;
    }
    if (speaker === "Sir Lancelot" && text.startsWith("There are two ways in that I know of")) {
      // 2 -> 3 as the line shows (tick 731, the same tick as the line).
      advanceTo(player, STAGE_SPOKEN_LANCELOT);
      return;
    }
    if (speaker === "Morgan Le Faye" && text === MORGAN_RITUAL_LINE) {
      event.after = () => {
        advanceTo(player, STAGE_SPOKEN_MORGAN);
        const fight = fights.get(player);
        if (fight) fight.told = true;
      };
      return;
    }
    if (speaker === "The Lady of the Lake" && text === EXCALIBUR_GIVEN_LINE) {
      event.after = () => giveExcalibur(player);
      return;
    }
    if (speaker === "Merlin" && text === "Thank you! Thank you! Thank you!") {
      const scene = smashScenes.get(player);
      if (scene?.merlin) event.npc = scene.merlin;
      return;
    }
    if (speaker === "Thrantax the Mighty" && text === THRANTAX_DEED_LINE) {
      // varp 14 4 -> 5 the tick before the line shows (1967 -> 1968); he goes once it is continued.
      advanceTo(player, STAGE_EXCALIBUR_BOUND);
      event.after = () => removeThrantax(player);
      return;
    }
    if (speaker === "Thrantax the Mighty" && text === THRANTAX_ROAR && rituals.get(player)?.wrong === true) {
      event.after = () => thrantaxAttacks(player);
      return;
    }
    if (typeof step.player === "string" && WRONG_INCANTATIONS.some((words) => words.startsWith(text.replace(/\.\.\.$/, "")))) {
      const ritual = rituals.get(player);
      if (ritual && WRONG_INCANTATIONS.includes(ritual.chosen ?? "")) ritual.wrong = true;
    }
    if (speaker === "The Lady of the Lake" && text === LADY_TEST_LINE) {
      player.setAttribute(LADY_TEST_ATTRIBUTE, true);
    }
  }

  function handleAction(event) {
    const { player, npcId } = event;
    if (!player) return;
    const text = String(event.text ?? "");
    if (event.kind === "message") {
      if (event.step?.type !== "message" || !isOwnPage(event)) return;
      if (!GAME_MESSAGES.has(text)) event.box = { ...(event.box ?? {}), statement: true };
      return messageStep(event, text);
    }
    if (npcId === LADY_NPC_ID && event.action === "receive" && text === "Excalibur") {
      event.handled = true;
      return ladyReclaim(player);
    }
    if (!isOwnPage(event)) return;
    if (SILENT_ACTIONS.has(text)) {
      event.handled = true;
      return;
    }
    if (text === MORDRED_ATTACKS_TEXT) {
      event.handled = true;
      const mordred = event.npc;
      if (mordred && registered(mordred)) TaskManager.submit(new CountdownTask(mordred, 1, () => mordred.getCombat().attack(player)));
      return;
    }
    if (text === THRANTAX_ATTACKS_TEXT) {
      // The candle goes and he comes for the player once his roar is continued (handleLine).
      event.handled = true;
      return;
    }
    if (event.action === CANDLE_EXCHANGE_ACTION || text === CANDLE_EXCHANGE_ACTION) {
      event.handled = true;
      if (npcId !== CANDLE_MAKER_NPC_ID || !has(player, BUCKET_OF_WAX_ITEM_ID)) return;
      inventory(player).deleteNumber(BUCKET_OF_WAX_ITEM_ID, 1);
      // The wax's slot takes the candle (tick 1357).
      inventory(player).adds(BLACK_CANDLE_ITEM_ID, 1);
      player.setAttribute(CANDLE_ASKED_ATTRIBUTE, false);
      return;
    }
    if (text === QUEST_COMPLETE_ACTION && ARTHUR_IDS.has(npcId)) {
      event.handled = true;
      if (!quest.isComplete(player)) quest.complete(player);
      showCrystal(player);
    }
  }

  function isOwnPage(event) {
    return (event.pages ?? []).some((entry) => entry?.page === PAGE) || event.playing?.page === PAGE;
  }

  /** The page's message steps: boxes and game messages, and what each one starts or ends. */
  function messageStep(event, text) {
    const { player } = event;
    switch (text) {
      case CLIMB_OUT_TEXT:
        // Everything is back as the box shows, five ticks after Yes (965 -> 971).
        event.box.delayTicks = CRATE_OUT_BOX_TICKS;
        return;
      case MORGAN_VANISHES_TEXT:
        morganVanishes(player);
        return;
      case MORDRED_KILLED_TEXT:
        killMordred(player);
        return;
      case BREAD_GIVEN_TEXT:
        // The bread goes as the box is continued (tick 1635).
        event.after = () => { if (has(player, BREAD_ITEM_ID)) inventory(player).deleteNumber(BREAD_ITEM_ID, 1); };
        return;
      case BEGGAR_TURNS_TEXT:
        beggarTurns(player);
        return;
      case ALTAR_TEXT:
        // Finishing the box is what counts (Wiki, Merlin's Crystal: "Finishing this dialogue is required").
        event.after = () => player.setAttribute(READ_INCANTATION_ATTRIBUTE, true);
        return;
      case SPIRIT_APPEARS_TEXT:
        return;
      case CRYSTAL_SHATTERS_TEXT:
        shatterCrystal(player);
        return;
      case MERLIN_FREED_TEXT:
        event.after = () => endSmash(player);
        return;
      default:
    }
  }

  // ==================================================================================================
  // The crate to Keep Le Faye (ticks 854-971)
  // ==================================================================================================

  function hideInCatherbyCrate(event) {
    if (event.objectId !== CATHERBY_CRATE_OBJECT_ID) return false;
    const { player } = event;
    const stage = stageOf(player);
    // Lancelot's tip opens the crates; the Wiki's way back into the keep after it (bat bones outside).
    if (stage < STAGE_SPOKEN_LANCELOT || stage >= STAGE_COMPLETE) return false;
    startTranscript(api, player, ARHEIN_NPC_ID, PAGE, "infiltrating-the-keep-hiding-in-arhein-s-crate");
    return true;
  }

  /** Yes: the climb and the fade out, then the crate (a copy of an empty chunk) two ticks later. */
  function climbIntoCrate(player) {
    player.performAnimation(new Animation(SEQ_CLIMB_INTO_CRATE, 10));
    Scenes.fade(player, true);
    player.getMovementQueue().reset().setBlockMovement(true);
    Scenes.later(player, CRATE_FADE_IN_TICKS, () => {
      Scenes.open(player, "crate", CRATE_RIDE_BOUNDS, { process: () => crateGuard(player) }, {
        instance: { sourceChunk: CRATE_SOURCE_CHUNK, size: 1 },
        at: CRATE_RIDE_TILE,
        exit: CRATE_START_TILE,
      });
      // cutscene_status, the minimap and the hidden menus (tick 928).
      Scenes.controls(player, true, true);
      Scenes.hideTabs(player);
      Scenes.fade(player, false);
    });
  }

  /** Yes to getting out: the fade (15 cycles), the keep a tick later, everything back with the box. */
  function climbOutOfCrate(player) {
    Scenes.fade(player, true, CRATE_OUT_FADE_CYCLES);
    const scene = Scenes.get(player);
    if (scene) scene.arriving = true;
    Scenes.later(player, CRATE_OUT_MOVE_TICKS, () => {
      Scenes.end(player, false, { release: false });
      player.moveTo(KEEP_ARRIVAL_TILE.clone());
    });
    Scenes.later(player, CRATE_OUT_BOX_TICKS, () => {
      Scenes.controls(player, false);
      player.getPacketSender().sendCameraReset();
      Scenes.restoreTabs(player);
      Scenes.fade(player, false);
    });
  }

  /** A ride whose chat has gone (a closed chatbox) puts the player back by the crates (Ours). */
  function crateGuard(player) {
    const scene = Scenes.get(player);
    if (!scene || scene.arriving || scene.leaving || chatOpen(player)) return;
    scene.leaving = true;
    Scenes.later(player, 1, () => {
      if (Scenes.get(player) !== scene) return;
      Scenes.end(player, false);
      player.moveTo(new Location(...CRATE_START_TILE));
      Scenes.restoreTabs(player);
      Scenes.closeFade(player);
    });
  }

  function crateRideEnded(player, scene, logout) {
    if (logout || scene?.arriving) return;
    Scenes.restoreTabs(player);
  }

  // ==================================================================================================
  // Sir Mordred and Morgan Le Faye (ticks 1046-1229)
  // ==================================================================================================

  /** player -> { mordred, morgan, told, killed } while Morgan pleads for her son. */
  const fights = new Map();
  const morganOf = (player) => fights.get(player)?.morgan ?? null;

  /** Mordred -> the players his mother pleads with: they and he don't fight meanwhile (others are not held). */
  const pleading = new WeakMap();
  const pleadsWith = (npc, player) => pleading.get(npc)?.has(player) === true;

  /**
   * Mordred's last hit leaves him on 0 (headbar fill 0, ticks 1079, 1145, 1215) and Morgan appears
   * beside him, the player turning to her. Only for a player who came for Morgan (stage 3); otherwise
   * he dies as anyone does (Ours: the Wiki's King's Ransom note).
   */
  function mordredFalls(event) {
    const npc = event.npc;
    if (npc?.getId?.() !== MORDRED_NPC_ID) return;
    // The player whose hit it was (the death task's last damager), not the top damager of a shared fight.
    const player = npc.getCombat?.().getLastDamager?.() ?? npc.getCombat?.().getKiller?.(false);
    if (!player?.isPlayer?.() || stageOf(player) !== STAGE_SPOKEN_LANCELOT) return;
    const fight = fights.get(player);
    if (fight?.killing && fight.mordred === npc) return; // "No. He deserves to die."
    event.preventDeath = true;
    npc.setHitpointsLocked?.(false);
    npc.hitpoints = 1; // Ours: one hitpoint rather than none, so nothing else treats him as dead
    // A hit already on its way while she pleads with this player changes nothing.
    if (pleadsWith(npc, player)) return;
    stopFighting(player, npc);
    removeMorgan(player);
    const tile = morganTile(player, npc);
    const morgan = api.spawnNpc({ ...tile, id: MORGAN_NPC_ID, owner: player, ownerOnly: true, wanderRadius: 0 });
    if (!morgan) return;
    morgan.__skipDefaultRespawn = true;
    morgan.setPositionToFace(player.getLocation());
    puff(player, morgan.getLocation(), MORGAN_PUFF_HEIGHT);
    player.setPositionToFace(morgan.getLocation());
    if (!pleading.has(npc)) pleading.set(npc, new Set());
    pleading.get(npc).add(player);
    fights.set(player, { mordred: npc, morgan, told: false, killing: false });
    startTranscript(api, player, MORGAN_NPC_ID, PAGE, "inside-keep-le-faye-defeating-sir-mordred", null, morgan);
    // Walking away mid-plea: Mordred is whole again and Morgan wanders about (Wiki, Sir Mordred).
    whenChatCloses(player, () => {
      const last = releaseMordred(npc, player);
      const current = fights.get(player);
      if (current?.morgan !== morgan || current.killing) return;
      if (last) healMordred(npc);
      if (registered(morgan)) morgan.getMovementCoordinator().setRadius(3);
    }, morgan);
  }

  /** The fight stops both ways as she appears: his swings in the air and the player's attack (Ours: live's hold). */
  function stopFighting(player, npc) {
    api.core.HitQueue?.dropHitsFrom?.(npc);
    npc.getCombat().reset();
    npc.getCombat().setUnderAttack?.(null);
    npc.setMobileInteraction?.(null);
    npc.getMovementQueue().reset().setBlockMovement(true);
    npc.setPositionToFace(null);
    if (player.getCombat?.().getTarget?.() === npc) player.getCombat().reset();
    player.getMovementQueue?.().reset?.();
  }

  /** This player's plea is over; true when it was the last one, and he is free again. */
  function releaseMordred(npc, player) {
    const players = pleading.get(npc);
    players?.delete(player);
    if (players?.size) return false;
    pleading.delete(npc);
    if (registered(npc)) npc.getMovementQueue().setBlockMovement(false);
    return true;
  }

  /** The player Morgan pleads with and her son don't fight while she does. */
  function pleaHoldsTheFight(event) {
    const { attacker, target } = event;
    if (pleadsWith(attacker, target) || pleadsWith(target, attacker)) {
      event.allow = false;
    }
  }

  /**
   * Beside him on 2770,3403 (ticks 1080, 1146, 1208, the player each time on 2769,3402); Ours: the next
   * tile round him when the player stands there.
   */
  function morganTile(player, mordred) {
    const here = player.getLocation();
    const m = mordred.getLocation();
    const candidates = [[MORGAN_TILE.x, MORGAN_TILE.y], [m.getX() + 1, m.getY()], [m.getX() - 1, m.getY()],
      [m.getX(), m.getY() + 1], [m.getX() + 1, m.getY() + 1], [m.getX() - 1, m.getY() + 1]];
    const [x, y] = candidates.find(([cx, cy]) => !(cx === here.getX() && cy === here.getY())
      && !(cx === m.getX() && cy === m.getY())) ?? candidates[0];
    return { x, y, z: MORGAN_TILE.z };
  }

  function healMordred(mordred) {
    if (!registered(mordred) || mordred.isDyingFunction?.() === true) return;
    mordred.hitpoints = mordred.getMaxHitpoints();
  }

  function removeMorgan(player) {
    const fight = fights.get(player);
    if (!fight) return;
    if (registered(fight.morgan)) api.removeNpc(fight.morgan);
    fights.delete(player);
  }

  /** "Morgan Le Faye vanishes." in a puff of smoke; the son she saved is whole again (ticks 1153, 1229). */
  function morganVanishes(player) {
    const fight = fights.get(player);
    if (!fight) return;
    if (registered(fight.morgan)) puff(player, fight.morgan.getLocation(), MORGAN_PUFF_HEIGHT);
    if (releaseMordred(fight.mordred, player)) healMordred(fight.mordred);
    removeMorgan(player);
  }

  /** "You kill Mordred.": his death as any NPC's, and Morgan goes with his body (1087 -> 1089). */
  function killMordred(player) {
    const fight = fights.get(player);
    if (!fight) return;
    fight.killing = true;
    const { mordred, morgan } = fight;
    releaseMordred(mordred, player);
    if (registered(mordred) && mordred.isDyingFunction?.() !== true) mordred.setHitpoints(0);
    TaskManager.submit(new CountdownTask(morgan, MORDRED_BODY_TICKS, () => {
      if (fights.get(player) === fight) removeMorgan(player);
    }));
  }

  function leftMordredsRoom(player) {
    if (!fights.has(player) || inZone(player.getLocation(), MORDRED_ROOM)) return;
    const fight = fights.get(player);
    if (releaseMordred(fight.mordred, player)) healMordred(fight.mordred);
    removeMorgan(player);
  }

  // ==================================================================================================
  // The Lady of the Lake's test (ticks 1597-1642)
  // ==================================================================================================

  /** player -> { beggar, lady } while the test plays at the jeweller's door. */
  const beggarScenes = new Map();

  function spawnBeggar(player) {
    const current = beggarScenes.get(player);
    if (current?.beggar && registered(current.beggar)) return current.beggar;
    const beggar = api.spawnNpc({ ...BEGGAR_TILE, id: BEGGAR_NPC_ID, owner: player, ownerOnly: true, wanderRadius: 0 });
    if (!beggar) return null;
    beggar.__skipDefaultRespawn = true;
    beggar.setPositionToFace(player.getLocation());
    beggarScenes.set(player, { beggar, lady: null });
    return beggar;
  }

  function clearBeggar(player) {
    const scene = beggarScenes.get(player);
    if (!scene) return;
    for (const npc of [scene.beggar, scene.lady]) if (registered(npc)) api.removeNpc(npc);
    beggarScenes.delete(player);
  }

  /**
   * Opening the jeweller's door during the test: the first time the beggar steps up and pleads (the
   * door stays shut, tick 1600) and is gone when the talk ends (1603); after that the door opens and
   * he waits there to be talked to (1617).
   */
  function jewellersDoor(request) {
    if (request.handled) return;
    const objectId = request.objectId ?? request.object?.getId?.();
    if (objectId !== JEWELLERS_DOOR_OBJECT_ID) return;
    const at = request.location ?? request.object?.getLocation?.();
    if (!at || !atTile(at, JEWELLERS_DOOR_TILE)) return;
    const { player } = request;
    if (!player || !beggarTestPending(player)) return;
    request.handled = true;
    if (player.getAttribute(BEGGAR_ASKED_ATTRIBUTE) === true) {
      // Live opens the door and the player stays on its tile with the beggar beside them (tick 1617);
      // Ours: the door stays shut, so he can't end up on the other side of it from the player.
      const waiting = spawnBeggar(player);
      if (waiting) player.setPositionToFace(waiting.getLocation());
      return;
    }
    const beggar = spawnBeggar(player);
    if (!beggar) return;
    player.setAttribute(BEGGAR_ASKED_ATTRIBUTE, true);
    player.setPositionToFace(beggar.getLocation());
    startTranscript(api, player, BEGGAR_NPC_ID, PAGE, "searching-for-excalibur-attempting-to-enter-the-jewellery-shop", null, beggar);
    whenChatCloses(player, () => {
      const scene = beggarScenes.get(player);
      if (scene?.beggar === beggar && !scene.lady) clearBeggar(player);
    }, beggar);
  }

  /** The beggar becomes the Lady on her box (tick 1637), on his tile and facing the player. */
  function beggarTurns(player) {
    const scene = beggarScenes.get(player);
    if (!scene?.beggar) return;
    const tile = scene.beggar.getLocation().clone();
    if (registered(scene.beggar)) api.removeNpc(scene.beggar);
    scene.beggar = null;
    const lady = api.spawnNpc({ id: LADY_NPC_ID, x: tile.getX(), y: tile.getY(), z: tile.getZ(), owner: player, ownerOnly: true, wanderRadius: 0 });
    if (!lady) return;
    lady.__skipDefaultRespawn = true;
    lady.setPositionToFace(player.getLocation());
    scene.lady = lady;
    // Gone with the talk, whichever way it ends.
    whenChatCloses(player, () => { if (beggarScenes.get(player) === scene) clearBeggar(player); }, lady);
  }

  /** "Here is Excalibur, guard it well.": the sword as the line is continued, and she is gone (1642). */
  function giveExcalibur(player) {
    player.setAttribute(BEGGAR_DONE_ATTRIBUTE, true);
    if (!ownsExcalibur(player)) {
      // The bread's slot (taken a box earlier) holds it; a fuller bag drops it at the player's feet.
      giveReward(player, EXCALIBUR_ITEM_ID, 1);
    }
    clearBeggar(player);
  }

  /** Lost after the quest: 500 coins on her own page (Wiki, Excalibur), the sword in the coins' place. */
  function ladyReclaim(player) {
    if (ownsExcalibur(player) || inventory(player).getAmount(COINS_ITEM_ID) < 500) return;
    const coinsLeft = inventory(player).getAmount(COINS_ITEM_ID) > 500;
    if (coinsLeft && inventory(player).getFreeSlots() < 1) {
      // Ours: no source shows a full bag here; the coins stay and she asks again next time.
      player.sendMessage("You don't have enough inventory space.");
      return;
    }
    inventory(player).deleteNumber(COINS_ITEM_ID, 500);
    inventory(player).adds(EXCALIBUR_ITEM_ID, 1);
  }

  // ==================================================================================================
  // The ritual (ticks 1836-1958; the wrong words: local 1001994 ticks 17468-17522)
  // ==================================================================================================

  /** player -> { thrantax, chosen, wrong } */
  const rituals = new Map();

  function checkChaosAltar(event) {
    if (event.objectId !== CHAOS_ALTAR_OBJECT_ID) return false;
    const { player } = event;
    const stage = stageOf(player);
    if (stage < STAGE_SPOKEN_MORGAN || stage >= STAGE_EXCALIBUR_BOUND) return false;
    startTranscript(api, player, THRANTAX_NPC_ID, PAGE, "searching-the-altar-for-the-spell");
    return true;
  }

  function onRitualTile(location) {
    return location.getZ() === RITUAL_TILE.getZ()
      && Math.abs(location.getX() - RITUAL_TILE.getX()) <= RITUAL_TILE_RADIUS
      && Math.abs(location.getY() - RITUAL_TILE.getY()) <= RITUAL_TILE_RADIUS;
  }

  /**
   * Bat bones dropped on the symbol: without the words or the lit candle the page's lines (the bones
   * stay); with both the player steps back two tiles and Thrantax appears in a puff of smoke three ticks
   * after the drop. The bones are not dropped (no inventory change, tick 1945).
   */
  function batBonesOnCircle(event) {
    if (event.itemId !== BAT_BONES_ITEM_ID) return;
    const { player } = event;
    if (stageOf(player) !== STAGE_SPOKEN_MORGAN || !onRitualTile(player.getLocation())) return;
    // While he is there the bones drop as any item (Ours: the two recorded drops then, local 1001994 tick 17496
    // and 1001800 tick 23238, were both off the symbol).
    if (rituals.has(player)) return;
    if (player.getAttribute(READ_INCANTATION_ATTRIBUTE) !== true) {
      event.handled = true;
      startTranscript(api, player, THRANTAX_NPC_ID, PAGE,
        "performing-the-ritual-dropping-bat-bones-on-the-ritual-circle-with-a-lit-black-candle-without-having-read-the-incantation");
      return;
    }
    if (!has(player, LIT_BLACK_CANDLE_ITEM_ID)) {
      event.handled = true;
      startTranscript(api, player, THRANTAX_NPC_ID, PAGE,
        "performing-the-ritual-dropping-bat-bones-on-the-ritual-circle-without-a-lit-black-candle");
      return;
    }
    event.handled = true;
    const ritual = { thrantax: null, chosen: null, wrong: false };
    rituals.set(player, ritual);
    // Two walking steps west (1945-1946), as Scenes.walk heads for a tile.
    player.getMovementQueue().reset().addCheckpoint(RITUAL_STEP_TILE.clone());
    TaskManager.submit(new CountdownTask(player, RITUAL_SPIRIT_TICKS, () => {
      if (rituals.get(player) !== ritual || player.isRegistered?.() === false) return;
      const thrantax = api.spawnNpc({
        id: THRANTAX_NPC_ID, x: RITUAL_TILE.getX(), y: RITUAL_TILE.getY(), z: RITUAL_TILE.getZ(),
        owner: player, ownerOnly: true, wanderRadius: 0,
      });
      if (!thrantax) return void rituals.delete(player);
      thrantax.__skipDefaultRespawn = true;
      // He comes facing south (spawnangle, tick 1948) and stays so while bound.
      thrantax.setPositionToFace(RITUAL_TILE.clone().add(0, -1));
      ritual.thrantax = thrantax;
      puff(player, RITUAL_TILE, 0);
      player.getPacketSender().sendAreaSound(SOUND_SMOKEPUFF, RITUAL_TILE.getX(), RITUAL_TILE.getY(), 0, 1, 0, SOUND_SMOKEPUFF_RANGE);
      player.setPositionToFace(RITUAL_TILE);
      startTranscript(api, player, THRANTAX_NPC_ID, PAGE,
        "performing-the-ritual-dropping-bat-bones-on-the-ritual-circle-with-a-lit-black-candle-after-reading-the-incantation",
        null, thrantax);
      // A summoning walked out of (live: the box closed by a drop, local 1001800 tick 23238) leaves him a while, then he goes.
      whenChatCloses(player, () => {
        if (rituals.get(player) !== ritual || ritual.wrong) return;
        TaskManager.submit(new CountdownTask(thrantax, THRANTAX_ANGRY_TICKS, () => {
          if (rituals.get(player) === ritual && !ritual.wrong) removeThrantax(player);
        }));
      }, thrantax);
    }));
  }

  function noteIncantation({ player, npcId, option }) {
    if (npcId !== THRANTAX_NPC_ID) return;
    const ritual = rituals.get(player);
    if (!ritual) return;
    ritual.chosen = String(option ?? "");
    ritual.wrong = WRONG_INCANTATIONS.includes(ritual.chosen);
  }

  /** The wrong words: the lit candle goes and Thrantax comes for the player, then leaves (1001994). */
  function thrantaxAttacks(player) {
    const ritual = rituals.get(player);
    if (has(player, LIT_BLACK_CANDLE_ITEM_ID)) inventory(player).deleteNumber(LIT_BLACK_CANDLE_ITEM_ID, 1);
    const thrantax = ritual?.thrantax;
    if (!thrantax || !registered(thrantax)) return;
    thrantax.getCombat().attack(player);
    TaskManager.submit(new CountdownTask(thrantax, THRANTAX_ANGRY_TICKS, () => {
      if (rituals.get(player) === ritual) removeThrantax(player);
    }));
  }

  function removeThrantax(player) {
    const ritual = rituals.get(player);
    if (!ritual) return;
    rituals.delete(player);
    if (registered(ritual.thrantax)) api.removeNpc(ritual.thrantax);
  }

  // ==================================================================================================
  // The crystal (ticks 2052-2059, 2263)
  // ==================================================================================================

  /** player -> { merlin } while the freed Merlin thanks the player. */
  const smashScenes = new Map();

  function smashCrystal(player, how = "smash") {
    smashingWith.set(player, how);
    if (quest.isComplete(player)) {
      player.sendMessage(CRYSTAL_ALREADY_FREED);
      return;
    }
    if (stageOf(player) >= STAGE_MERLIN_FREED) return;
    startTranscript(api, player, MERLIN_NPC_ID, PAGE, "smashing");
  }

  function smashGiantCrystal(event) {
    if (event.objectId !== GIANT_CRYSTAL_OBJECT_ID) return false;
    smashCrystal(event.player);
    return true;
  }

  function excaliburOnCrystal(event) {
    if (event.objectId !== undefined && event.objectId !== GIANT_CRYSTAL_OBJECT_ID) return false;
    smashCrystal(event.player, "use");
    return true;
  }

  /** "... and it shatters": the stage, the swing, the crystal gone and Merlin in its place, facing the player. */
  function shatterCrystal(player) {
    advanceTo(player, STAGE_MERLIN_FREED);
    player.performAnimation(new Animation(SEQ_SMASH));
    player.getPacketSender().sendSound(SOUND_SMASH, 0, 0);
    player.setPositionToFace(GIANT_CRYSTAL_TILE);
    hideCrystal(player);
    endSmash(player);
    const merlin = api.spawnNpc({
      id: MERLIN_NPC_ID, x: GIANT_CRYSTAL_TILE.getX(), y: GIANT_CRYSTAL_TILE.getY(), z: GIANT_CRYSTAL_TILE.getZ(),
      owner: player, ownerOnly: true, wanderRadius: 0,
    });
    if (!merlin) return;
    merlin.__skipDefaultRespawn = true;
    merlin.setPositionToFace(GIANT_CRYSTAL_TILE.clone().add(0, -1));
    TaskManager.submit(new CountdownTask(merlin, 1, () => { if (registered(merlin)) merlin.setPositionToFace(player.getLocation()); }));
    smashScenes.set(player, { merlin });
    // Gone once his box closes, however it closes.
    whenChatCloses(player, () => { if (smashScenes.get(player)?.merlin === merlin) endSmash(player); }, merlin);
  }

  function endSmash(player) {
    const scene = smashScenes.get(player);
    if (!scene) return;
    smashScenes.delete(player);
    if (registered(scene.merlin)) api.removeNpc(scene.merlin);
  }

  /** The crystal is gone while Merlin is free (loc_del, tick 2053) and back after the quest (Wiki, Giant crystal). */
  function hideCrystal(player) {
    ObjectManager.hideMapObjectFor(player, GIANT_CRYSTAL_OBJECT_ID, GIANT_CRYSTAL_TILE);
  }

  function showCrystal(player) {
    ObjectManager.showMapObjectFor(player, GIANT_CRYSTAL_OBJECT_ID, GIANT_CRYSTAL_TILE);
  }

  function ensureCrystal(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    if (stageOf(player) === STAGE_MERLIN_FREED) hideCrystal(player);
    else showCrystal(player);
  }

  // ==================================================================================================
  // Doors, the beehive and the candle
  // ==================================================================================================

  /**
   * Keep Le Faye's front doors: from outside they stay shut (tick 1264), the way in is the Catherby
   * crates; from inside they open (tick 1254, Doors.plugin's pass-through doors).
   */
  function keepFrontDoor(request) {
    if (request.handled) return;
    const objectId = request.objectId ?? request.object?.getId?.();
    if (!KEEP_FRONT_DOOR_IDS.has(objectId)) return;
    const at = coords(request.location ?? request.object?.getLocation?.());
    if (!at || at.x !== KEEP_FRONT_DOOR_X || at.y < 3401 || at.y > 3402 || at.z !== 0) return;
    if (request.player.getLocation().getX() > KEEP_FRONT_DOOR_X) return;
    request.handled = true;
    messageBox(request.player, KEEP_DOOR_LOCKED);
  }

  /** Merlin's workshop stays shut until Holy Grail lets the player in (tick 2185, quest complete). */
  function merlinWorkshopDoor(request) {
    if (request.handled) return;
    const objectId = request.objectId ?? request.object?.getId?.();
    if (objectId !== MERLIN_WORKSHOP_DOOR_OBJECT_ID) return;
    if (!atTile(request.location ?? request.object?.getLocation?.(), MERLIN_WORKSHOP_DOOR_TILE)) return;
    const holyGrail = getRegisteredQuests().findLast((entry) => entry.key === "holy_grail");
    if (holyGrail?.isStarted(request.player)) return;
    request.handled = true;
    request.player.sendMessage(WORKSHOP_DOOR_SHUT);
  }

  /** Full Beekeeper's outfit: the bees can't stop the player (Wiki, Beehive changes 11 October 2022). */
  function wearingBeekeeperOutfit(player) {
    const items = player.getEquipment?.()?.getItems?.() ?? [];
    return BEEKEEPER_ITEM_IDS.every((id) => items.some((item) => item?.getId?.() === id));
  }

  function messageBox(player, text) {
    const { DialogueChainBuilder, StatementDialogue } = api.core;
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
  }

  function itemBox(player, itemId, text, next) {
    const { DialogueChainBuilder, ItemStatementDialogue, ActionDialogue } = api.core;
    const chain = new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text));
    if (next) chain.add(new ActionDialogue(1, { execute: next }));
    player.getDialogueManager().startDialogues(chain);
  }

  /** Wiki Transcript:Beehive, "Take-from" and a bucket used on the hive. */
  function collectWax(player) {
    if (!has(player, BUCKET_ITEM_ID)) {
      // Ours: the transcript has no line for a hive taken from without a bucket.
      player.sendMessage("You need an empty bucket to collect the wax.");
      return true;
    }
    if (wearingBeekeeperOutfit(player)) {
      fillBucket(player);
      itemBox(player, BUCKET_OF_WAX_ITEM_ID, HIVE_ATTIRE_BOX);
      return true;
    }
    if (player.getAttribute(HIVE_REPELLED_ATTRIBUTE) !== true) {
      player.sendMessage(HIVE_STING);
      player.getCombat().getHitQueue().addPendingDamage([new HitDamage(HIVE_STING_DAMAGE, HitMask.RED)]);
      player.sendMessage(HIVE_STING_HINT);
      api.emitCustomEvent("bees:stung", { player });
      return true;
    }
    itemBox(player, BUCKET_ITEM_ID, HIVE_TRY_BOX, () => {
      if (!has(player, BUCKET_ITEM_ID) || player.getAttribute(HIVE_REPELLED_ATTRIBUTE) !== true) {
        player.getDialogueManager().reset?.();
        return;
      }
      fillBucket(player);
      player.setAttribute(HIVE_REPELLED_ATTRIBUTE, false);
      itemBox(player, BUCKET_OF_WAX_ITEM_ID, HIVE_FILLED_BOX);
    });
    return true;
  }

  /** The wax in the bucket's own slot. */
  function fillBucket(player) {
    const slot = inventory(player).getItems().findIndex((item) => item?.getId?.() === BUCKET_ITEM_ID);
    if (slot < 0) return;
    inventory(player).setItem(slot, new api.core.Item(BUCKET_OF_WAX_ITEM_ID, 1));
    inventory(player).refreshItems?.();
  }

  /** The repellent is not used up (Wiki, Insect repellent: it must be used on the hive each time). */
  function repellentOnHive(event) {
    if (event.objectId !== BEEHIVE_OBJECT_ID) return false;
    const { player } = event;
    const again = player.getAttribute(HIVE_REPELLED_ATTRIBUTE) === true;
    player.setAttribute(HIVE_REPELLED_ATTRIBUTE, true);
    itemBox(player, INSECT_REPELLENT_ITEM_ID, again ? HIVE_REPELLENT_AGAIN_BOX : HIVE_REPELLENT_BOX);
    return true;
  }

  function bucketOnHive(event) {
    if (event.objectId !== BEEHIVE_OBJECT_ID) return false;
    return collectWax(event.player);
  }

  function takeFromHive(event) {
    if (event.objectId !== BEEHIVE_OBJECT_ID) return false;
    return collectWax(event.player);
  }

  /** The candle is lit in its slot, with no message (tick 1937). */
  function lightBlackCandle(event) {
    const { player } = event;
    const items = inventory(player).getItems();
    const slot = items.findIndex((item) => item?.getId?.() === BLACK_CANDLE_ITEM_ID);
    if (slot < 0) return;
    inventory(player).setItem?.(slot, new api.core.Item(LIT_BLACK_CANDLE_ITEM_ID, 1));
    inventory(player).refreshItems?.();
  }

  /** The candle maker's first talk counts once heard (his second, tick 1338: "Have you got any wax yet?"). */
  function noteCandleTalk(event) {
    if (event.npcId !== CANDLE_MAKER_NPC_ID || !isOwnPage(event)) return;
    if (String(event.text ?? "") === "IF you can bring me a bucket FULL of wax.") {
      event.after = () => event.player.setAttribute(CANDLE_ASKED_ATTRIBUTE, true);
    }
  }

  // ==================================================================================================
  // World state
  // ==================================================================================================

  function handleTowerEnter({ player }) {
    ensureCrystal(player);
  }

  function handleShopZoneLeave({ player }) {
    const scene = beggarScenes.get(player);
    if (scene && !chatOpen(player)) clearBeggar(player);
  }

  function handleLogin({ player }) {
    ensureCrystal(player);
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    const fight = fights.get(player);
    if (fight) {
      if (releaseMordred(fight.mordred, player)) healMordred(fight.mordred);
    }
    removeMorgan(player);
    clearBeggar(player);
    removeThrantax(player);
    endSmash(player);
  }

  // The 3 November 2026 update's quest XP (Wiki: Update:Quest Month Kick Off, TFA Tweaks & More), paid on completion
  // (tick 2097: 1,000 Firemaking XP); held back for a completion not played through (experience: false).
  const COMPLETION_XP = [[api.core.Skill.FIREMAKING, 1000, "Firemaking"]];
  function grantCompletionXp(player, _quest, options = {}) {
    if (options.experience === false) return;
    for (const [skill, amount] of COMPLETION_XP) player.getSkillManager().addExperiences(skill, amount);
  }

  quest = registerQuest(api, {
    key: "merlins_crystal",
    name: "Merlin's Crystal",
    varpId: VARP_ARTHUR,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 6,
    xpRewards: COMPLETION_XP.map(([skill, amount, label]) => ({ skillId: skill.getIndex(), amount, label })),
    // The scroll (tick 2097): 6 Quest Points, 1,000 Firemaking XP, Excalibur, with the sword's model.
    scrollItemId: EXCALIBUR_ITEM_ID,
    rewardItemLabel: "Excalibur",
    buildJournal,
    journalAsSent: true,
    onReward: grantCompletionXp,
  });

  api.persistAttribute(READ_INCANTATION_ATTRIBUTE, false);
  api.persistAttribute(LADY_TEST_ATTRIBUTE, false);
  api.persistAttribute(BEGGAR_ASKED_ATTRIBUTE, false);
  api.persistAttribute(BEGGAR_DONE_ATTRIBUTE, false);
  api.persistAttribute(HIVE_REPELLED_ATTRIBUTE, false);
  api.persistAttribute(CANDLE_ASKED_ATTRIBUTE, false);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:menu", shapeMenu);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:choice", noteIncantation);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:line", noteCandleTalk);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("door:toggle", jewellersDoor);
  api.onCustomEvent("door:toggle", keepFrontDoor);
  api.onCustomEvent("door:toggle", merlinWorkshopDoor);
  api.onObjectInteraction("Crate", { "Hide-in": hideInCatherbyCrate });
  api.onObjectInteraction("Giant crystal", { Smash: smashGiantCrystal });
  api.onObjectInteraction("Chaos altar", { Check: checkChaosAltar });
  api.onObjectInteraction("Beehive", { "Take-from": takeFromHive });
  api.onItemOnObject("Excalibur", "Giant crystal", excaliburOnCrystal);
  api.onItemOnObject("Insect repellent", "Beehive", repellentOnHive, { noted: false });
  api.onItemOnObject("Bucket", "Beehive", bucketOnHive, { noted: false });
  api.onItemOnItem("Tinderbox", "Black candle", lightBlackCandle, { noted: false });
  api.onItemDropPolicy(batBonesOnCircle);
  api.onNpcBeforeDeath(mordredFalls);
  api.onCanAttack(pleaHoldsTheFight);
  api.onZoneEnter(CAMELOT_TOWER_ZONE, handleTowerEnter);
  api.onZoneExit(SARIM_SHOP_ZONE, handleShopZoneLeave);
  api.onZoneExit(MORDRED_ROOM, ({ player }) => leftMordredsRoom(player));
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onPlayerDisconnect(handleLogout);
};
