/**
 * Misthalin Mystery (free-to-play).
 *
 * The words come from the "Misthalin Mystery" transcript page; this plugin supplies
 * the variant selector for Abigale, Hewey, Sid, Tayten, Lacey, Mandy, the Killer and
 * the Shady Figure (all indexed), the prose-condition answers, the start hook, the
 * murder-investigation object/item interactions and the Mandy hand-in that completes
 * the quest.
 *
 * Stages (varp 1535, the OSRS "Misthalin Mystery" varp): 5 accepted, 10 briefed,
 * 20 Sid dead, 25 bucket filled, 30 inside the manor, 35 Tayten dead, 40 note read,
 * 45 painting slashed, 50 ruby room, 55 candles lit, 60 fuse lit, 65 wall blown,
 * 70 Lacey dead, 75 note 2 read, 80 piano solved, 85 emerald room, 90 Mandy "dead",
 * 95 note 3 read, 100 panel revealed, 105 gem panel solved, 110 sapphire room,
 * 115 killer unmasked, 120 Hewey dead, 125 Abigale killed, 130 Mandy waiting,
 * 135 complete.
 *
 * Source: OpenRune content/quest/.../misthalin/MisthalinMystery*.kt pinned in issue
 * #196 (varp `mistmyst_main`, stage values, key/note item flow, 600 Crafting XP,
 * three uncut gems, 1 quest point).
 *
 * Gaps (no instance/interface support in this repo):
 * - the sapphire-room mirror/boss fight is not reproduced; the confrontation,
 *   unmasking and rescue are replayed from the sapphire door in stage order and the
 *   killer's knife is granted at Hewey's death (OpenRune drops it on the floor);
 * - the piano and gem-switch interfaces (cache 554/555) are replaced by chatbox
 *   sequence prompts holding the same D-E-A-D and sapphire-diamond-zenyte-emerald-
 *   onyx-ruby answers;
 * - coloured doors are not physically swapped and only front/interior door crossing
 *   moves the player; the manor objects are otherwise handled in place.
 */
module.exports = function registerMisthalinMysteryQuest(api) {
  const { Skill, Location, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, startTranscript, refreshQuestList } = require("../QuestRuntime");

  const PAGE = "Misthalin Mystery";

  const ABIGALE_NPC_IDS = new Set([
    NpcIdentifiers.ABIGALE,
    NpcIdentifiers.ABIGALE_2,
    NpcIdentifiers.ABIGALE_3,
  ]);
  const HEWEY_NPC_IDS = new Set([NpcIdentifiers.HEWEY, NpcIdentifiers.HEWEY_2]);
  const KILLER_NPC_IDS = new Set([
    NpcIdentifiers.KILLER,
    NpcIdentifiers.KILLER_2,
    NpcIdentifiers.SHADY_FIGURE,
  ]);
  const MANDY_NPC_IDS = new Set([
    NpcIdentifiers.MANDY,
    NpcIdentifiers.MANDY_2,
    NpcIdentifiers.MANDY_3,
  ]);
  const SID_NPC_IDS = new Set([NpcIdentifiers.SID, NpcIdentifiers.SID_2]);
  const LACEY_NPC_ID = NpcIdentifiers.LACEY;
  const TAYTEN_NPC_ID = NpcIdentifiers.TAYTEN;
  const MANDY_NPC_ID = NpcIdentifiers.MANDY_2; // 7630, the survivor outside the manor.

  const VARP_MISTHALIN_MYSTERY = 1535;
  const STAGE_STARTED = 5;
  const STAGE_BRIEFED = 10;
  const STAGE_SID_DEAD = 20;
  const STAGE_BUCKET_FILLED = 25;
  const STAGE_INSIDE_MANOR = 30;
  const STAGE_TAYTEN_DEAD = 35;
  const STAGE_NOTE1_READ = 40;
  const STAGE_PAINTING_SLASHED = 45;
  const STAGE_RUBY_ROOM_OPEN = 50;
  const STAGE_CANDLES_LIT = 55;
  const STAGE_FUSE_LIT = 60;
  const STAGE_WALL_BLOWN = 65;
  const STAGE_LACEY_DEAD = 70;
  const STAGE_NOTE2_READ = 75;
  const STAGE_PIANO_SOLVED = 80;
  const STAGE_EMERALD_ROOM_OPEN = 85;
  const STAGE_MANDY_DEAD = 90;
  const STAGE_NOTE3_READ = 95;
  const STAGE_PANEL_REVEALED = 100;
  const STAGE_GEM_PANEL_SOLVED = 105;
  const STAGE_SAPPHIRE_ROOM_OPEN = 110;
  const STAGE_BOSS_BEATEN = 115;
  const STAGE_HEWEY_DEAD = 120;
  const STAGE_ABIGALE_KILLED = 125;
  const STAGE_MANDY_WAITING = 130;
  const STAGE_COMPLETE = 135;

  const MANOR_KEY_ITEM_ID = ItemIdentifiers.MANOR_KEY_2; // 21052
  const RUBY_KEY_ITEM_ID = ItemIdentifiers.RUBY_KEY_2; // 21053
  const EMERALD_KEY_ITEM_ID = ItemIdentifiers.EMERALD_KEY_2; // 21054
  const SAPPHIRE_KEY_ITEM_ID = ItemIdentifiers.SAPPHIRE_KEY_2; // 21055
  const NOTE1_ITEM_ID = ItemIdentifiers.NOTES_5; // 21056, library note
  const NOTE2_ITEM_ID = ItemIdentifiers.NOTES_6; // 21057, outside note
  const NOTE3_ITEM_ID = ItemIdentifiers.NOTES_7; // 21058, kitchen note
  const KILLER_KNIFE_ITEM_ID = ItemIdentifiers.KILLERS_KNIFE_2; // 21059
  const BUCKET_ITEM_ID = ItemIdentifiers.BUCKET;
  const BUCKET_OF_WATER_ITEM_ID = ItemIdentifiers.BUCKET_OF_WATER;
  const KNIFE_ITEM_ID = ItemIdentifiers.KNIFE;
  const TINDERBOX_ITEM_ID = ItemIdentifiers.TINDERBOX;

  const COLOURED_KEY_ITEM_IDS = new Set([
    RUBY_KEY_ITEM_ID,
    EMERALD_KEY_ITEM_ID,
    SAPPHIRE_KEY_ITEM_ID,
  ]);

  const WATER_BARREL_LOC_IDS = new Set([
    ObjectIdentifiers.A_BARREL_OF_RAINWATER_2, // 30124
    ObjectIdentifiers.BARREL_138, // 30123, emptied barrel
  ]);
  const FRONT_DOOR_LOC_IDS = new Set([
    ObjectIdentifiers.LARGE_DOOR_94, // 30110
    ObjectIdentifiers.LARGE_DOOR_95, // 30111
  ]);
  const BOAT_LOC_IDS = new Set([
    ObjectIdentifiers.ROWBOAT_9, // 30108, Lumbridge shore
    ObjectIdentifiers.ROWBOAT_10, // 30109, island
  ]);
  const LOCKED_DOOR_LOC_IDS = new Set([
    ObjectIdentifiers.DOOR_555, // 30113, jade
    ObjectIdentifiers.DOOR_556, // 30114, opal
    ObjectIdentifiers.DOOR_557, // 30115, dragonstone
  ]);
  const PAINTING_LOC_IDS = new Set([
    ObjectIdentifiers.PAINTING_22, // 30125, unslashed
    ObjectIdentifiers.PAINTING_23, // 30126, slashed
  ]);
  const WRONG_PAINTING_LOC_IDS = new Set([
    ObjectIdentifiers.PAINTING_24,
    ObjectIdentifiers.PAINTING_25,
    ObjectIdentifiers.PAINTING_26,
    ObjectIdentifiers.PAINTING_27,
    ObjectIdentifiers.PORTRAIT_11,
  ]);
  const CANDLE_LOC_IDS = new Set([
    ObjectIdentifiers.UNLIT_CANDLE, // 30129
    ObjectIdentifiers.CANDLE_2, // 30130, lit
  ]);
  const FIREPLACE_LOC_IDS = new Set([
    ObjectIdentifiers.FIREPLACE_24, // 30136
    ObjectIdentifiers.FIREPLACE_25, // 30137
    ObjectIdentifiers.FIREPLACE_26, // 30138
  ]);
  const PIANO_LOC_IDS = new Set([
    ObjectIdentifiers.PIANO_9, // 30134
    ObjectIdentifiers.PIANO_10, // 30135
  ]);
  const DAMAGED_WALL_LOC_IDS = new Set([
    ObjectIdentifiers.DAMAGED_WALL_4, // 30131, climbs at 1647/1648
    ObjectIdentifiers.DAMAGED_WALL_5,
    ObjectIdentifiers.DAMAGED_WALL_6,
  ]);
  const DOOR_KEY_BY_LOC = new Map([
    [ObjectIdentifiers.DOOR_558, RUBY_KEY_ITEM_ID], // 30116
    [ObjectIdentifiers.DOOR_559, EMERALD_KEY_ITEM_ID], // 30117
    [ObjectIdentifiers.DOOR_561, SAPPHIRE_KEY_ITEM_ID], // 30119
  ]);

  const NOTE_LINES = new Map([
    [
      NOTE1_ITEM_ID,
      [
        "Isn't murder just a work of art?",
        "Beautiful, yet haunting, like the blade of a knife.",
        "As we wander through the valley of death.",
      ],
    ],
    [
      NOTE2_ITEM_ID,
      ["It's like music to my ears!", "The glorious sounds, spelling out your fate!"],
    ],
    [
      NOTE3_ITEM_ID,
      [
        "Hear at first these words.",
        "Each murder you witness helplessly from start to end.",
        "As you fail to solve the final letters of this quiz.",
        "Razor sharp like a gemstone is the blade of my knife.",
        "The last sound you hear will be your scream's echo.",
        "Heed that I will have the final word in this thriller.",
      ],
    ],
  ]);
  const NOTE_READ_STAGES = new Map([
    [NOTE1_ITEM_ID, [STAGE_TAYTEN_DEAD, STAGE_NOTE1_READ]],
    [NOTE2_ITEM_ID, [STAGE_LACEY_DEAD, STAGE_NOTE2_READ]],
    [NOTE3_ITEM_ID, [STAGE_MANDY_DEAD, STAGE_NOTE3_READ]],
  ]);

  const PIANO_ORDER = ["D", "E", "A", "D"];
  const PIANO_PRIMARY = ["D", "E", "A", "B"];
  const PIANO_SECONDARY = ["C", "F", "G"];
  const GEM_ORDER = ["Sapphire", "Diamond", "Zenyte", "Emerald", "Onyx", "Ruby"];
  const GEM_PRIMARY = ["Sapphire", "Diamond", "Zenyte", "Emerald"];
  const GEM_SECONDARY = ["Onyx", "Ruby"];
  const MORE_LABEL = "More...";
  const BACK_LABEL = "Back...";

  let quest;
  const mandyByPlayer = new Map();
  const litCandlesByPlayer = new Map();
  const pianoProgressByPlayer = new Map();
  const gemProgressByPlayer = new Map();

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull()
        ? 0
        : 28;
  }

  function grantItem(player, itemId) {
    if (held(player, itemId)) return;
    if (freeSlots(player) < 1) return;
    player.getInventory().adds(itemId, 1);
  }

  function hasAnyColouredKey(player) {
    for (const key of COLOURED_KEY_ITEM_IDS) {
      if (held(player, key)) return true;
    }
    return false;
  }

  function hasAnyNote(player) {
    return (
      held(player, NOTE1_ITEM_ID) || held(player, NOTE2_ITEM_ID) || held(player, NOTE3_ITEM_ID)
    );
  }

  /** Move the player one tile past a wall-straight door, from their current side. */
  function crossDoor(player, location) {
    const position = player.getLocation();
    const dx = position.getX() - location.x;
    const dy = position.getY() - location.y;
    let stepX = 0;
    let stepY = 0;
    if (Math.abs(dx) >= Math.abs(dy)) stepX = dx >= 0 ? 1 : -1;
    else stepY = dy >= 0 ? 1 : -1;
    player.moveTo(new Location(location.x - stepX, location.y - stepY, location.z ?? position.getZ()));
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage <= 0) {
      return [
        "I can start this quest by speaking to <col=800000>Abigale</col>",
        "by the shore in <col=800000>Lumbridge Swamp</col>.",
        "",
        "There are no requirements for this quest.",
      ];
    }
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Abigale and her friends were attacked in a manor on an island off</str>",
        "<str>the coast of Lumbridge Swamp.</str>",
        "<str>I took the boat to the island and solved the killer's riddles.</str>",
        "<str>I unmasked Abigale and Hewey and helped Mandy defeat them.</str>",
        "",
        "I was rewarded with an <col=800000>uncut ruby</col>, an <col=800000>uncut emerald</col>",
        "and an <col=800000>uncut sapphire</col>, plus <col=800000>600 Crafting XP</col>.",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    const lines = [
      "<str>Abigale and her friends were attacked in a manor on an island</str>",
      "<str>off the coast of Lumbridge Swamp.</str>",
      "",
    ];
    if (stage < STAGE_SID_DEAD) {
      lines.push("I agreed to take the <col=800000>boat</col> from the south-eastern shore to the island.");
      return lines;
    }
    lines.push("<str>I saw the killer murder Sid at the water barrel.</str>");
    if (stage < STAGE_INSIDE_MANOR) {
      lines.push("I need to find a way into the <col=800000>manor</col>.");
      return lines;
    }
    lines.push("<str>I entered the manor and found the first clues left by the killer.</str>");
    if (stage < STAGE_WALL_BLOWN) {
      lines.push("I must solve the <col=800000>riddles</col> hidden around the manor.");
      return lines;
    }
    lines.push("<str>I followed the killer's clues through the manor.</str>");
    if (stage < STAGE_HEWEY_DEAD) {
      lines.push("I must confront the <col=800000>killer</col> in the sapphire room.");
      return lines;
    }
    lines.push("<str>The killer was Abigale, helped by Hewey. Hewey is dead.</str>");
    if (stage < STAGE_MANDY_WAITING) {
      lines.push("I should take Hewey's <col=800000>knife</col> and defeat Abigale.");
      return lines;
    }
    lines.push("<str>With Mandy's help I defeated Abigale and Hewey.</str>");
    lines.push("I should meet <col=800000>Mandy</col> outside the manor.");
    return lines;
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 600);
    player.getInventory().adds(ItemIdentifiers.UNCUT_EMERALD, 1);
    player.getInventory().adds(ItemIdentifiers.UNCUT_SAPPHIRE, 1);
  }

  /** Which transcript variant each speaker plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (ABIGALE_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_HEWEY_DEAD) return "showdown-defeating-the-killer";
      if (stage >= STAGE_BRIEFED) {
        return "starting-out-talking-to-abigale-or-hewey-talking-to-abigale-or-hewey-again";
      }
      return "starting-out-talking-to-abigale-or-hewey";
    }
    if (HEWEY_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_HEWEY_DEAD) return "showdown-defeating-the-killer";
      if (stage >= STAGE_BRIEFED) {
        return "starting-out-talking-to-abigale-or-hewey-talking-to-abigale-or-hewey-again";
      }
      return "starting-out-talking-to-abigale-or-hewey";
    }
    if (SID_NPC_IDS.has(npcId)) {
      return stage >= STAGE_BRIEFED && stage < STAGE_BUCKET_FILLED
        ? "arriving-to-the-manor-sid-s-demise"
        : null;
    }
    if (npcId === TAYTEN_NPC_ID) {
      return stage >= STAGE_INSIDE_MANOR && stage <= STAGE_TAYTEN_DEAD
        ? "arriving-to-the-manor-tayten-s-demise"
        : null;
    }
    if (npcId === LACEY_NPC_ID) {
      return stage >= STAGE_FUSE_LIT && stage <= STAGE_LACEY_DEAD
        ? "the-second-riddle-run-in-with-lacey"
        : null;
    }
    if (MANDY_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return "finishing-up-talking-to-mandy-again";
      if (stage >= STAGE_MANDY_WAITING) return "finishing-up";
      if (stage >= STAGE_EMERALD_ROOM_OPEN && stage < STAGE_MANDY_DEAD) {
        return "the-third-riddle-mandy-in-the-kitchen";
      }
      return null;
    }
    if (KILLER_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_BRIEFED && stage < STAGE_BUCKET_FILLED) {
        return "arriving-to-the-manor-sid-s-demise";
      }
      if (stage >= STAGE_FUSE_LIT && stage <= STAGE_LACEY_DEAD) {
        return "the-second-riddle-run-in-with-lacey";
      }
      if (stage >= STAGE_SAPPHIRE_ROOM_OPEN && stage < STAGE_BOSS_BEATEN) {
        return "showdown-confronting-the-killer";
      }
      if (stage >= STAGE_BOSS_BEATEN && stage < STAGE_HEWEY_DEAD) {
        return "showdown-when-the-killer-takes-damage";
      }
      if (stage >= STAGE_HEWEY_DEAD && stage < STAGE_ABIGALE_KILLED) {
        return "showdown-defeating-the-killer";
      }
      return null;
    }
    return null;
  }

  /** Answer the page's prose conditions. `stepId` disambiguates repeated wording. */
  function answerCondition({ player, text, stepId }) {
    const value = String(text).toLowerCase();
    const inventory = player.getInventory();
    const has = (itemId) => inventory.getAmount(itemId) > 0;
    if (value.includes("insufficient inventory space")) return freeSlots(player) < 3;
    if (value.includes("at least three inventory spaces")) return freeSlots(player) >= 3;
    if (value.includes("no inventory space")) return inventory.isFull();
    if (value.includes("does not have inventory space")) return inventory.isFull();
    if (value.includes("space but already has a bucket")) {
      return !inventory.isFull() && has(BUCKET_ITEM_ID);
    }
    if (value.includes("does not have the manor key")) return !has(MANOR_KEY_ITEM_ID);
    if (value.includes("has the manor key")) return has(MANOR_KEY_ITEM_ID);
    if (value.includes("has inventory space")) return !inventory.isFull();
    if (value.includes("already has the key")) {
      if (stepId === "jv36xs") return has(MANOR_KEY_ITEM_ID);
      if (stepId === "rqIawh") return has(SAPPHIRE_KEY_ITEM_ID);
      return has(MANOR_KEY_ITEM_ID) || has(SAPPHIRE_KEY_ITEM_ID);
    }
    if (value.includes("already has the note")) {
      if (stepId === "cUhUGo") return has(NOTE1_ITEM_ID);
      if (stepId === "cTwCFK") return has(NOTE2_ITEM_ID);
      if (stepId === "2iN6Be") return has(NOTE3_ITEM_ID);
      return hasAnyNote(player);
    }
    if (value.includes("already has a knife")) return has(KNIFE_ITEM_ID);
    if (value.includes("already has the ruby key")) return has(RUBY_KEY_ITEM_ID);
    if (value.includes("does not have the necessary key")) return !hasAnyColouredKey(player);
    if (value.includes("has the necessary key")) return hasAnyColouredKey(player);
    if (value.includes("already has a tinderbox")) return has(TINDERBOX_ITEM_ID);
    if (value.includes("before getting the note")) return quest.getStage(player) < STAGE_LACEY_DEAD;
    if (value.includes("before reading the note")) return quest.getStage(player) < STAGE_NOTE2_READ;
    if (value.includes("already found the key")) return has(EMERALD_KEY_ITEM_ID);
    if (value.includes("code was incorrect")) return quest.getStage(player) < STAGE_GEM_PANEL_SOLVED;
    if (value.includes("code was correct")) return quest.getStage(player) >= STAGE_GEM_PANEL_SOLVED;
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (hook !== "quest:misthalin-mystery:start") return;
    if (!ABIGALE_NPC_IDS.has(npcId) && !HEWEY_NPC_IDS.has(npcId)) return;
    if (quest.getStage(player) < STAGE_BRIEFED) quest.setStage(player, STAGE_BRIEFED);
  }

  function ensureKillerKnife(player) {
    if (held(player, KILLER_KNIFE_ITEM_ID)) return true;
    if (freeSlots(player) < 1) {
      startTranscript(
        api,
        player,
        NpcIdentifiers.KILLER,
        PAGE,
        "showdown-defeating-the-killer-taking-the-killer-s-knife-with-a-full-inventory"
      );
      return false;
    }
    player.getInventory().adds(KILLER_KNIFE_ITEM_ID, 1);
    return true;
  }

  /**
   * The transcript message/action ids that carry an item or a stage side effect.
   * Stage transitions that gate further interactions are set in the object handlers
   * so a closed dialogue can never strand the player, the grants happen here.
   */
  function handleAction(event) {
    const { player, stepId } = event;
    if (stepId === "7jM3EA") {
      if (quest.getStage(player) >= STAGE_MANDY_WAITING && !quest.isComplete(player)) {
        quest.complete(player);
      }
      event.handled = true;
      event.end = true;
      return;
    }
    if (stepId === "p7I0Im") {
      grantItem(player, MANOR_KEY_ITEM_ID);
      return;
    }
    if (stepId === "-D_iey") {
      grantItem(player, NOTE1_ITEM_ID);
      return;
    }
    if (stepId === "Qund0e") {
      grantItem(player, NOTE2_ITEM_ID);
      return;
    }
    if (stepId === "w3FghJ") {
      grantItem(player, NOTE3_ITEM_ID);
      return;
    }
    if (stepId === "ySyaiG") {
      grantItem(player, KNIFE_ITEM_ID);
      return;
    }
    if (stepId === "kJcYsv") {
      grantItem(player, TINDERBOX_ITEM_ID);
      return;
    }
    if (stepId === "AyZSfz") {
      grantItem(player, RUBY_KEY_ITEM_ID);
      return;
    }
    if (stepId === "Wh5PPN") {
      grantItem(player, EMERALD_KEY_ITEM_ID);
      return;
    }
    if (stepId === "AvBeLS") {
      grantItem(player, SAPPHIRE_KEY_ITEM_ID);
      return;
    }
    if (stepId === "i5vdZV") {
      for (const key of COLOURED_KEY_ITEM_IDS) {
        if (!held(player, key)) continue;
        player.getInventory().deleteNumber(key, 1);
        if (key === RUBY_KEY_ITEM_ID && quest.getStage(player) < STAGE_RUBY_ROOM_OPEN) {
          quest.setStage(player, STAGE_RUBY_ROOM_OPEN);
        }
        if (key === EMERALD_KEY_ITEM_ID && quest.getStage(player) < STAGE_EMERALD_ROOM_OPEN) {
          quest.setStage(player, STAGE_EMERALD_ROOM_OPEN);
        }
        if (key === SAPPHIRE_KEY_ITEM_ID && quest.getStage(player) < STAGE_SAPPHIRE_ROOM_OPEN) {
          quest.setStage(player, STAGE_SAPPHIRE_ROOM_OPEN);
        }
        break;
      }
      return;
    }
    if (stepId === "6KwKGJ" && quest.getStage(player) < STAGE_FUSE_LIT) {
      quest.setStage(player, STAGE_FUSE_LIT);
      return;
    }
    if (stepId === "6p6UXM" && quest.getStage(player) < STAGE_PANEL_REVEALED) {
      quest.setStage(player, STAGE_PANEL_REVEALED);
      return;
    }
    if (stepId === "YSPZnz") {
      if (quest.getStage(player) < STAGE_HEWEY_DEAD) quest.setStage(player, STAGE_HEWEY_DEAD);
      if (
        quest.getStage(player) < STAGE_ABIGALE_KILLED &&
        !held(player, KILLER_KNIFE_ITEM_ID) &&
        freeSlots(player) >= 1
      ) {
        player.getInventory().adds(KILLER_KNIFE_ITEM_ID, 1);
      }
      return;
    }
    if (stepId === "DWcgf8" && quest.getStage(player) < STAGE_ABIGALE_KILLED) {
      quest.setStage(player, STAGE_ABIGALE_KILLED);
      return;
    }
    if (stepId === "zBqqmI") {
      if (quest.getStage(player) < STAGE_MANDY_WAITING) {
        quest.setStage(player, STAGE_MANDY_WAITING);
        ensureMandy(player);
      }
      return;
    }
    if (stepId === "JzkmeZ" && held(player, KILLER_KNIFE_ITEM_ID)) {
      player.getInventory().deleteNumber(KILLER_KNIFE_ITEM_ID, 1);
    }
  }

  // ==========================================================================
  // Object interactions
  // ==========================================================================

  function boardRowboat(event) {
    const { player, objectId } = event;
    if (objectId === ObjectIdentifiers.ROWBOAT_9) {
      if (quest.getStage(player) < STAGE_BRIEFED) {
        startTranscript(
          api,
          player,
          NpcIdentifiers.ABIGALE,
          PAGE,
          "starting-out-trying-to-use-the-rowboat-before-starting-the-quest"
        );
        return;
      }
      startTranscript(api, player, NpcIdentifiers.ABIGALE, PAGE, "starting-out-board-rowboat-to-the-island");
      player.moveTo(new Location(1637, 4802, 0));
      return;
    }
    if (objectId === ObjectIdentifiers.ROWBOAT_10) {
      startTranscript(api, player, NpcIdentifiers.ABIGALE, PAGE, "starting-out-board-rowboat-to-lumbridge-swamp");
      player.moveTo(new Location(3240, 3142, 0));
    }
  }

  function searchBarrel(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_SID_DEAD) {
      startTranscript(api, player, NpcIdentifiers.SID, PAGE, "arriving-to-the-manor-sid-s-demise");
      quest.setStage(player, STAGE_SID_DEAD);
      return;
    }
    if (stage === STAGE_SID_DEAD) {
      startTranscript(
        api,
        player,
        NpcIdentifiers.SID,
        PAGE,
        "arriving-to-the-manor-searching-the-barrel-of-rainwater-search-the-barrel-without-emptying-it"
      );
      return;
    }
    startTranscript(
      api,
      player,
      NpcIdentifiers.SID,
      PAGE,
      "arriving-to-the-manor-searching-the-barrel-of-rainwater-searching-the-drained-barrel"
    );
  }

  function fillBucket(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_SID_DEAD) {
      startTranscript(api, player, NpcIdentifiers.SID, PAGE, "arriving-to-the-manor-sid-s-demise");
      quest.setStage(player, STAGE_SID_DEAD);
      return;
    }
    if (stage !== STAGE_SID_DEAD) {
      player.sendMessage("You have already filled the bucket.");
      return;
    }
    player.getInventory().deleteNumber(BUCKET_ITEM_ID, 1);
    player.getInventory().adds(BUCKET_OF_WATER_ITEM_ID, 1);
    startTranscript(
      api,
      player,
      NpcIdentifiers.SID,
      PAGE,
      "arriving-to-the-manor-searching-the-barrel-of-rainwater-use-bucket-with-the-barrel"
    );
    quest.setStage(player, STAGE_BUCKET_FILLED);
  }

  function enterManor(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_INSIDE_MANOR) {
      startTranscript(api, player, NpcIdentifiers.KILLER, PAGE, "arriving-to-the-manor-entering-the-manor");
      if (!held(player, MANOR_KEY_ITEM_ID)) return;
      player.getInventory().deleteNumber(MANOR_KEY_ITEM_ID, 1);
      quest.setStage(player, STAGE_INSIDE_MANOR);
    }
    crossDoor(player, event.location);
  }

  function colouredDoor(event, requiredKeyId, unlockedAt) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < unlockedAt) {
      if (!held(player, requiredKeyId)) {
        player.sendMessage("The door is securely locked.");
        return;
      }
      startTranscript(
        api,
        player,
        NpcIdentifiers.KILLER,
        PAGE,
        "the-first-riddle-opening-colourful-handle-doors"
      );
      crossDoor(player, event.location);
      return;
    }
    if (requiredKeyId === RUBY_KEY_ITEM_ID && stage === STAGE_FUSE_LIT) {
      quest.setStage(player, STAGE_WALL_BLOWN);
      player.sendMessage("You hear a muffled explosion as the damaged wall gives way.");
      return;
    }
    crossDoor(player, event.location);
  }

  function taytenDoor(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_INSIDE_MANOR) {
      player.sendMessage("The door is securely locked.");
      return;
    }
    if (stage === STAGE_INSIDE_MANOR) {
      startTranscript(api, player, NpcIdentifiers.TAYTEN, PAGE, "arriving-to-the-manor-tayten-s-demise");
      quest.setStage(player, STAGE_TAYTEN_DEAD);
      return;
    }
    crossDoor(player, event.location);
  }

  function diamondDoor(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_EMERALD_ROOM_OPEN) {
      player.sendMessage("The door is securely locked.");
      return;
    }
    if (stage < STAGE_MANDY_DEAD) {
      startTranscript(
        api,
        player,
        NpcIdentifiers.MANDY,
        PAGE,
        "the-third-riddle-mandy-in-the-kitchen"
      );
      quest.setStage(player, STAGE_MANDY_DEAD);
      return;
    }
    crossDoor(player, event.location);
  }

  function sapphireDoor(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_SAPPHIRE_ROOM_OPEN) {
      if (!held(player, SAPPHIRE_KEY_ITEM_ID)) {
        player.sendMessage("The door is securely locked.");
        return;
      }
      startTranscript(
        api,
        player,
        NpcIdentifiers.KILLER,
        PAGE,
        "the-first-riddle-opening-colourful-handle-doors"
      );
      crossDoor(player, event.location);
      return;
    }
    if (stage < STAGE_BOSS_BEATEN) {
      startTranscript(api, player, NpcIdentifiers.KILLER, PAGE, "showdown-confronting-the-killer");
      quest.setStage(player, STAGE_BOSS_BEATEN);
      return;
    }
    if (stage < STAGE_HEWEY_DEAD) {
      startTranscript(api, player, NpcIdentifiers.KILLER, PAGE, "showdown-defeating-the-killer");
      quest.setStage(player, STAGE_HEWEY_DEAD);
      ensureKillerKnife(player);
      return;
    }
    if (stage < STAGE_ABIGALE_KILLED) {
      if (!ensureKillerKnife(player)) return;
      startTranscript(
        api,
        player,
        NpcIdentifiers.KILLER,
        PAGE,
        "showdown-fighting-abigale-fight-abigale-while-wielding-the-killer-s-knife"
      );
      quest.setStage(player, STAGE_ABIGALE_KILLED);
      return;
    }
    if (stage < STAGE_MANDY_WAITING) {
      startTranscript(api, player, NpcIdentifiers.MANDY, PAGE, "showdown-leaving-the-manor");
      quest.setStage(player, STAGE_MANDY_WAITING);
      if (held(player, KILLER_KNIFE_ITEM_ID)) {
        player.getInventory().deleteNumber(KILLER_KNIFE_ITEM_ID, 1);
      }
      ensureMandy(player);
    }
    crossDoor(player, event.location);
  }

  function takeTool(event, variant) {
    startTranscript(api, event.player, NpcIdentifiers.KILLER, PAGE, variant);
  }

  function takeBucket(event) {
    const { player } = event;
    if (held(player, BUCKET_ITEM_ID) || freeSlots(player) < 1) {
      startTranscript(
        api,
        player,
        NpcIdentifiers.KILLER,
        PAGE,
        "arriving-to-the-manor-taking-the-bucket"
      );
      return;
    }
    player.getInventory().adds(BUCKET_ITEM_ID, 1);
    player.sendMessage("You take the bucket.");
  }

  function takeClue(event, requiredStage, npcId, variant) {
    const { player } = event;
    if (quest.getStage(player) < requiredStage) {
      player.sendMessage("There's nothing here.");
      return;
    }
    startTranscript(api, player, npcId, PAGE, variant);
  }

  function searchPainting(event) {
    const { player, objectId } = event;
    const stage = quest.getStage(player);
    if (PAINTING_LOC_IDS.has(objectId) && stage >= STAGE_PAINTING_SLASHED) {
      startTranscript(
        api,
        player,
        NpcIdentifiers.KILLER,
        PAGE,
        "the-first-riddle-searching-the-slashed-painting"
      );
      return;
    }
    startTranscript(
      api,
      player,
      NpcIdentifiers.KILLER,
      PAGE,
      "the-first-riddle-slashing-the-wrong-painting"
    );
  }

  function slashPainting(event) {
    const { player, objectId } = event;
    if (objectId === ObjectIdentifiers.PAINTING_22 && quest.getStage(player) === STAGE_NOTE1_READ) {
      startTranscript(
        api,
        player,
        NpcIdentifiers.KILLER,
        PAGE,
        "the-first-riddle-slashing-the-painting"
      );
      quest.setStage(player, STAGE_PAINTING_SLASHED);
      return;
    }
    startTranscript(
      api,
      player,
      NpcIdentifiers.KILLER,
      PAGE,
      "the-first-riddle-slashing-the-wrong-painting"
    );
  }

  function lightCandle(event) {
    const { player, location } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_RUBY_ROOM_OPEN) {
      player.sendMessage("You have no reason to light this candle.");
      return;
    }
    if (stage > STAGE_RUBY_ROOM_OPEN) {
      player.sendMessage("You have already lit this candle.");
      return;
    }
    const lit = litCandlesByPlayer.get(player) ?? new Set();
    const tile = `${location.x},${location.y}`;
    if (lit.has(tile)) {
      player.sendMessage("You have already lit this candle.");
      return;
    }
    lit.add(tile);
    litCandlesByPlayer.set(player, lit);
    if (lit.size >= 4) {
      if (stage === STAGE_RUBY_ROOM_OPEN) quest.setStage(player, STAGE_CANDLES_LIT);
      startTranscript(
        api,
        player,
        NpcIdentifiers.KILLER,
        PAGE,
        "the-first-riddle-lighting-the-last-candle"
      );
      return;
    }
    startTranscript(api, player, NpcIdentifiers.KILLER, PAGE, "the-first-riddle-lighting-a-candle");
  }

  function lightFuse(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_CANDLES_LIT) {
      startTranscript(
        api,
        player,
        NpcIdentifiers.KILLER,
        PAGE,
        "the-first-riddle-attempting-to-light-the-fuse-while-the-candles-are-unlit"
      );
      return;
    }
    if (stage >= STAGE_FUSE_LIT) {
      startTranscript(
        api,
        player,
        NpcIdentifiers.KILLER,
        PAGE,
        "the-first-riddle-attempting-to-light-the-fuse-after-it-has-been-lit"
      );
      return;
    }
    startTranscript(
      api,
      player,
      NpcIdentifiers.KILLER,
      PAGE,
      "the-first-riddle-attempting-to-light-the-fuse-once-the-candles-are-lit"
    );
    quest.setStage(player, STAGE_FUSE_LIT);
  }

  function climbWall(event) {
    const { player } = event;
    if (quest.getStage(player) < STAGE_WALL_BLOWN) {
      player.sendMessage("The wall hasn't been damaged enough to climb.");
      return;
    }
    const position = player.getLocation();
    const x = position.getX() <= 1647 ? 1648 : 1647;
    player.moveTo(new Location(x, 4829, position.getZ()));
  }

  function observeTree(event) {
    const { player } = event;
    if (quest.getStage(player) === STAGE_WALL_BLOWN) {
      startTranscript(api, player, LACEY_NPC_ID, PAGE, "the-second-riddle-run-in-with-lacey");
      quest.setStage(player, STAGE_LACEY_DEAD);
      return;
    }
    startTranscript(
      api,
      player,
      LACEY_NPC_ID,
      PAGE,
      "the-second-riddle-observing-tree-after-lacey-is-killed"
    );
  }

  function playPiano(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage >= STAGE_PIANO_SOLVED) {
      startTranscript(
        api,
        player,
        NpcIdentifiers.MANDY,
        PAGE,
        "the-second-riddle-playing-the-piano-searching-the-piano-after-unlocking-it"
      );
      return;
    }
    if (stage < STAGE_NOTE2_READ) {
      startTranscript(
        api,
        player,
        NpcIdentifiers.MANDY,
        PAGE,
        "the-second-riddle-playing-the-piano"
      );
      return;
    }
    openPianoPrompt(player);
  }

  function searchFireplace(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage === STAGE_PANEL_REVEALED) {
      player.sendMessage(
        "You find a panel of switches inside the hidden compartment. Each switch is crafted from a different gemstone."
      );
      openGemPrompt(player);
      return;
    }
    if (stage >= STAGE_GEM_PANEL_SOLVED) {
      startTranscript(
        api,
        player,
        NpcIdentifiers.MANDY,
        PAGE,
        "the-third-riddle-searching-the-fireplace-after-solving-the-riddle"
      );
      return;
    }
    player.sendMessage("You find nothing of interest.");
  }

  function handleObjectInteraction(event) {
    const { objectId } = event;
    if (BOAT_LOC_IDS.has(objectId)) {
      event.handled = true;
      boardRowboat(event);
      return;
    }
    if (WATER_BARREL_LOC_IDS.has(objectId)) {
      event.handled = true;
      searchBarrel(event);
      return;
    }
    if (FRONT_DOOR_LOC_IDS.has(objectId)) {
      event.handled = true;
      enterManor(event);
      return;
    }
    if (objectId === ObjectIdentifiers.DOOR_554) {
      event.handled = true;
      taytenDoor(event);
      return;
    }
    if (LOCKED_DOOR_LOC_IDS.has(objectId)) {
      event.handled = true;
      event.player.sendMessage("The door is securely locked.");
      return;
    }
    if (objectId === ObjectIdentifiers.DOOR_560) {
      event.handled = true;
      diamondDoor(event);
      return;
    }
    if (objectId === ObjectIdentifiers.DOOR_561) {
      event.handled = true;
      sapphireDoor(event);
      return;
    }
    if (objectId === ObjectIdentifiers.DOOR_558) {
      event.handled = true;
      colouredDoor(event, RUBY_KEY_ITEM_ID, STAGE_RUBY_ROOM_OPEN);
      return;
    }
    if (objectId === ObjectIdentifiers.DOOR_559) {
      event.handled = true;
      colouredDoor(event, EMERALD_KEY_ITEM_ID, STAGE_EMERALD_ROOM_OPEN);
      return;
    }
    if (objectId === ObjectIdentifiers.NOTE_3) {
      event.handled = true;
      takeClue(event, STAGE_TAYTEN_DEAD, NpcIdentifiers.TAYTEN, "arriving-to-the-manor-taking-the-note");
      return;
    }
    if (objectId === ObjectIdentifiers.NOTE_4) {
      event.handled = true;
      takeClue(event, STAGE_LACEY_DEAD, LACEY_NPC_ID, "the-second-riddle-taking-the-note");
      return;
    }
    if (objectId === ObjectIdentifiers.NOTE_5) {
      event.handled = true;
      takeClue(event, STAGE_MANDY_DEAD, NpcIdentifiers.MANDY, "the-third-riddle-taking-the-note");
      return;
    }
    if (objectId === ObjectIdentifiers.TABLE_258) {
      event.handled = true;
      takeTool(event, "arriving-to-the-manor-taking-the-knife-from-the-table");
      return;
    }
    if (objectId === ObjectIdentifiers.SHELVES_92) {
      event.handled = true;
      takeTool(event, "the-first-riddle-taking-a-tinderbox-from-the-shelves");
      return;
    }
    if (objectId === ObjectIdentifiers.COL_FF9040_BUCKET_COL) {
      event.handled = true;
      takeBucket(event);
      return;
    }
    if (objectId === ObjectIdentifiers.STAIRCASE_164) {
      event.handled = true;
      startTranscript(
        api,
        event.player,
        NpcIdentifiers.KILLER,
        PAGE,
        "arriving-to-the-manor-climbing-the-staircase"
      );
      return;
    }
    if (PAINTING_LOC_IDS.has(objectId) || WRONG_PAINTING_LOC_IDS.has(objectId)) {
      event.handled = true;
      searchPainting(event);
      return;
    }
    if (PIANO_LOC_IDS.has(objectId)) {
      event.handled = true;
      playPiano(event);
      return;
    }
    if (FIREPLACE_LOC_IDS.has(objectId)) {
      event.handled = true;
      searchFireplace(event);
      return;
    }
    if (DAMAGED_WALL_LOC_IDS.has(objectId)) {
      event.handled = true;
      climbWall(event);
      return;
    }
    if (objectId === ObjectIdentifiers.DEAD_TREE_26) {
      event.handled = true;
      observeTree(event);
    }
  }

  function handleItemOnObject(event) {
    if (event.itemId === BUCKET_ITEM_ID) {
      if (!WATER_BARREL_LOC_IDS.has(event.objectId)) return;
      event.handled = true;
      fillBucket(event);
      return;
    }
    if (event.itemId === KNIFE_ITEM_ID) {
      if (PAINTING_LOC_IDS.has(event.objectId) || WRONG_PAINTING_LOC_IDS.has(event.objectId)) {
        event.handled = true;
        slashPainting(event);
        return;
      }
      if (FIREPLACE_LOC_IDS.has(event.objectId)) {
        event.handled = true;
        if (quest.getStage(event.player) !== STAGE_NOTE3_READ) {
          event.player.sendMessage("You have no reason to do that.");
          return;
        }
        startTranscript(
          api,
          event.player,
          NpcIdentifiers.MANDY,
          PAGE,
          "the-third-riddle-using-a-knife-on-the-fireplace"
        );
        quest.setStage(event.player, STAGE_PANEL_REVEALED);
      }
      return;
    }
    if (event.itemId === TINDERBOX_ITEM_ID) {
      if (CANDLE_LOC_IDS.has(event.objectId)) {
        event.handled = true;
        lightCandle(event);
        return;
      }
      if (event.objectId === ObjectIdentifiers.BARREL_139) {
        event.handled = true;
        lightFuse(event);
      }
      return;
    }
    if (!COLOURED_KEY_ITEM_IDS.has(event.itemId)) return;
    const requiredKey = DOOR_KEY_BY_LOC.get(event.objectId);
    if (!requiredKey) return;
    event.handled = true;
    if (event.itemId !== requiredKey) {
      startTranscript(
        api,
        event.player,
        NpcIdentifiers.KILLER,
        PAGE,
        "the-first-riddle-opening-colourful-handle-doors-using-the-wrong-key-on-a-coloured-handle-door"
      );
      return;
    }
    if (event.objectId === ObjectIdentifiers.DOOR_561) {
      sapphireDoor(event);
      return;
    }
    const unlockedAt =
      requiredKey === RUBY_KEY_ITEM_ID ? STAGE_RUBY_ROOM_OPEN : STAGE_EMERALD_ROOM_OPEN;
    colouredDoor(event, requiredKey, unlockedAt);
  }

  function handleItemAction(event) {
    const lines = NOTE_LINES.get(event.itemId);
    if (!lines) return;
    if (event.option && !/read/i.test(event.option)) return;
    event.handled = true;
    for (const line of lines) event.player.sendMessage(line);
    const [readableAt, readStage] = NOTE_READ_STAGES.get(event.itemId);
    if (quest.getStage(event.player) === readableAt) {
      quest.setStage(event.player, readStage);
    }
  }

  // ==========================================================================
  // Puzzles
  // ==========================================================================

  function promptPairs(options, onPick) {
    const pairs = [];
    for (const option of options) pairs.push(option, () => onPick(option));
    return pairs;
  }

  function openPianoPrompt(player) {
    api.sendMultiChatboxPrompt(
      player,
      "Which key do you press?",
      ...promptPairs([...PIANO_PRIMARY, MORE_LABEL], (choice) => {
        if (choice === MORE_LABEL) {
          api.sendMultiChatboxPrompt(
            player,
            "Which key do you press?",
            ...promptPairs([...PIANO_SECONDARY, BACK_LABEL], (note) => {
              if (note === BACK_LABEL) openPianoPrompt(player);
              else playPianoNote(player, note);
            })
          );
          return;
        }
        playPianoNote(player, choice);
      })
    );
  }

  function playPianoNote(player, note) {
    const article = "AEF".includes(note) ? "an" : "a";
    player.sendMessage(`You play ${article} ${note}.`);
    const progress = `${pianoProgressByPlayer.get(player) ?? ""}${note}`;
    const answer = PIANO_ORDER.join("");
    if (!answer.startsWith(progress)) {
      pianoProgressByPlayer.delete(player);
      player.sendMessage("There is a clicking sound as the lock on the piano's compartment resets.");
      return;
    }
    if (progress === answer) {
      pianoProgressByPlayer.delete(player);
      quest.setStage(player, STAGE_PIANO_SOLVED);
      startTranscript(
        api,
        player,
        NpcIdentifiers.MANDY,
        PAGE,
        "the-second-riddle-playing-the-piano-after-playing-the-correct-sequence"
      );
      return;
    }
    pianoProgressByPlayer.set(player, progress);
    openPianoPrompt(player);
  }

  function openGemPrompt(player) {
    api.sendMultiChatboxPrompt(
      player,
      "Which switch do you flip?",
      ...promptPairs([...GEM_PRIMARY, MORE_LABEL], (choice) => {
        if (choice === MORE_LABEL) {
          api.sendMultiChatboxPrompt(
            player,
            "Which switch do you flip?",
            ...promptPairs([...GEM_SECONDARY, BACK_LABEL], (gem) => {
              if (gem === BACK_LABEL) openGemPrompt(player);
              else flipGem(player, gem);
            })
          );
          return;
        }
        flipGem(player, choice);
      })
    );
  }

  function flipGem(player, gem) {
    player.sendMessage(`You flip the ${gem.toLowerCase()} switch.`);
    const progress = (gemProgressByPlayer.get(player) ?? 0) + 1;
    if (GEM_ORDER[progress - 1] !== gem) {
      gemProgressByPlayer.delete(player);
      startTranscript(
        api,
        player,
        NpcIdentifiers.KILLER,
        PAGE,
        "the-third-riddle-entering-a-code"
      );
      return;
    }
    if (progress === GEM_ORDER.length) {
      gemProgressByPlayer.delete(player);
      quest.setStage(player, STAGE_GEM_PANEL_SOLVED);
      startTranscript(
        api,
        player,
        NpcIdentifiers.KILLER,
        PAGE,
        "the-third-riddle-entering-a-code"
      );
      return;
    }
    gemProgressByPlayer.set(player, progress);
    openGemPrompt(player);
  }

  // ==========================================================================
  // Mandy (owner-only post-quest spawn) and session lifecycle
  // ==========================================================================

  function ensureMandy(player) {
    if (quest.getStage(player) < STAGE_MANDY_WAITING || mandyByPlayer.has(player)) return;
    const npc = api.spawnNpc({
      id: MANDY_NPC_ID,
      x: 1637,
      y: 4823,
      z: 0,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) mandyByPlayer.set(player, npc);
  }

  function handleLogout({ player }) {
    if (!player) return;
    const mandy = mandyByPlayer.get(player);
    if (mandy) api.removeNpc(mandy);
    mandyByPlayer.delete(player);
    litCandlesByPlayer.delete(player);
    pianoProgressByPlayer.delete(player);
    gemProgressByPlayer.delete(player);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    ensureMandy(player);
  }

  quest = registerQuest(api, {
    key: "misthalin_mystery",
    name: "Misthalin Mystery",
    varpId: VARP_MISTHALIN_MYSTERY,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.CRAFTING.getIndex(), amount: 600, label: "Crafting" }],
    rewardItemId: ItemIdentifiers.UNCUT_RUBY,
    rewardItemLabel: "Uncut ruby, uncut emerald and uncut sapphire",
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemAction(handleItemAction);
  api.onPlayerLogout(handleLogout);
  api.onPlayerLogin(handleLogin);
};
