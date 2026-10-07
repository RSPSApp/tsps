/**
 * Ernest the Chicken.
 *
 * Words come from npc-dialogues.json. The "Ernest the Chicken" page mixes the
 * three speakers for the quest, so the variant is chosen by the speaker's cache
 * id:
 *   Veronica 3561, Professor Oddenstein 3562, Ernest 3563.
 *
 * Stages (varp 32): 1 started, 2 Oddenstein told you about the machine parts,
 * 3 complete.
 *
 * Supporting state kept in attributes (the reference's varps 33/34):
 *   ernest-the-chicken.fountain  1 = piranhas poisoned
 *   ernest-the-chicken.levers    the 6-bit basement lever/pulley puzzle
 *
 * Gaps (no dump support, see summary):
 *   - Oddenstein before the quest has no "busy" line; the standard machine
 *     conversation plays.
 *   - Ernest 3563 has no chicken-specific transcript, so he references the
 *     shared "finishing-up" conversation (a wiki infobox artifact).
 *   - The finishing-up conversation ends with two lines spoken by Ernest while
 *     the runtime only renders the clicked NPC, so those two lines are skipped
 *     to keep the branch going (the runtime has no multi-speaker support).
 *   - Lever/door *visuals* are not driven by varbits here (state lives in an
 *     attribute); door access and lever toggling work, the map content is the
 *     human's to add.
 */
module.exports = function registerErnestTheChickenQuest(api) {
  const { Location, HitDamage, HitMask, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest } = require("../QuestRuntime");

  const VERONICA_NPC_ID = NpcIdentifiers.VERONICA;
  const ODDENSTEIN_NPC_ID = NpcIdentifiers.PROFESSOR_ODDENSTEIN;
  const ERNEST_NPC_ID = NpcIdentifiers.ERNEST;

  const VARP_ERNEST = 32;
  const VARP_LEVERS = 33;
  const STAGE_STARTED = 1;
  const STAGE_ODDENSTEIN = 2;
  const STAGE_COMPLETE = 3;

  const GAUGE = ItemIdentifiers.PRESSURE_GAUGE;
  const FISH_FOOD = ItemIdentifiers.FISH_FOOD;
  const POISON = ItemIdentifiers.POISON;
  const POISONED_FOOD = ItemIdentifiers.POISONED_FISH_FOOD;
  const KEY = ItemIdentifiers.KEY;
  const TUBE = ItemIdentifiers.RUBBER_TUBE;
  const OIL_CAN = ItemIdentifiers.OIL_CAN;
  const SPADE = ItemIdentifiers.SPADE;
  const COINS = ItemIdentifiers.COINS;

  const COMPOST = ObjectIdentifiers.COMPOST_HEAP;
  const FOUNTAIN = ObjectIdentifiers.FOUNTAIN;
  const CLOSET_DOOR = ObjectIdentifiers.DOOR_14;
  const LADDER_UP = ObjectIdentifiers.LADDER_5;
  const LADDER_DOWN = ObjectIdentifiers.LADDER_6;
  const BOOKCASES = [ObjectIdentifiers.BOOKCASE, ObjectIdentifiers.BOOKCASE_2];

  /**
   * The basement lever/pulley puzzle. Base lever objects 146-151 are named "null"
   * in the cache (the identifier generator skips nameless entries), so they stay
   * literals; their named "Lever A".."Lever F" variants have generated members.
   * Array index is the puzzle bit (0 = A).
   */
  const PUZZLE_LEVER_IDS = [
    [146, ObjectIdentifiers.LEVER_A, ObjectIdentifiers.LEVER_A_2],
    [147, ObjectIdentifiers.LEVER_B, ObjectIdentifiers.LEVER_B_2],
    [148, ObjectIdentifiers.LEVER_C, ObjectIdentifiers.LEVER_C_2],
    [149, ObjectIdentifiers.LEVER_D, ObjectIdentifiers.LEVER_D_2],
    [150, ObjectIdentifiers.LEVER_E, ObjectIdentifiers.LEVER_E_2],
    [151, ObjectIdentifiers.LEVER_F, ObjectIdentifiers.LEVER_F_2],
  ];

  /** Puzzle doors 137-145 are nameless in the cache; 11450 is DOOR_274. */
  const DOORS = [
    137,
    138,
    139,
    140,
    141,
    142,
    143,
    144,
    145,
    ObjectIdentifiers.DOOR_274,
  ];

  /** Door tiles, in the reference's door order, used to map a click to a state. */
  const DOOR_TILES = [
    [3105, 9765],
    [3100, 9765],
    [3105, 9760],
    [3100, 9760],
    [3100, 9755],
    [3102, 9763],
    [3097, 9763],
    [3108, 9758],
    [3102, 9758],
  ];

  const LEVER_IDS = new Map();
  for (let index = 0; index < PUZZLE_LEVER_IDS.length; index++) {
    for (const leverId of PUZZLE_LEVER_IDS[index]) LEVER_IDS.set(leverId, index);
  }

  const FOUNTAIN_ATTRIBUTE = "ernest-the-chicken.fountain";
  const LEVERS_ATTRIBUTE = "ernest-the-chicken.levers";
  const START_HOOK = "quest:ernest-the-chicken:start";
  /** "Congratulations! Quest complete!" on the shared finishing-up page. */
  const COMPLETE_ACTION_ID = "2wle32";

  const PAGE_VERONICA = "Veronica";
  const PAGE_ODDENSTEIN = "Professor Oddenstein";
  const PAGE_ERNEST = "Ernest the Chicken";

  /** "Veronica" page variants. */
  const VERONICA_PRE_QUEST_VARIANT = "standard-dialogue-pre-quest";
  const VERONICA_POST_QUEST_VARIANT = "standard-dialogue-post-quest";
  const VERONICA_STARTING_VARIANT = "starting-off-veronica-during-quest";
  const VERONICA_FINDING_OUT_VARIANT =
    "the-mad-scientist-veronica-during-quest-after-finding-out-about-ernest";

  /** "Ernest the Chicken" page variants (the quest page mixes the three speakers). */
  const ODDENSTEIN_START_VARIANT = "the-mad-scientist";
  const ODDENSTEIN_BEFORE_PARTS_VARIANT = "the-mad-scientist-before-returning-any-parts";
  const ODDENSTEIN_RETURN_GAUGE_VARIANT = "returning-the-parts-the-pressure-gauge";
  const ODDENSTEIN_RETURN_TUBE_VARIANT = "returning-the-parts-the-rubber-tube";
  const ODDENSTEIN_RETURN_OIL_VARIANT = "returning-the-parts-the-oil-can";
  const ODDENSTEIN_RETURN_TUBE_GAUGE_VARIANT =
    "returning-the-parts-the-rubber-tube-and-pressure-gauge";
  const ODDENSTEIN_RETURN_TUBE_OIL_VARIANT = "returning-the-parts-the-rubber-tube-and-oil-can";
  const ODDENSTEIN_RETURN_GAUGE_OIL_VARIANT =
    "returning-the-parts-the-pressure-gauge-and-oil-can";
  const FINISHING_UP_VARIANT = "finishing-up";

  /** "Professor Oddenstein" page variants. */
  const ODDENSTEIN_STANDARD_VARIANT = "standard-dialogue";
  const ODDENSTEIN_AFTER_VARIANT = "after-ernest-the-chicken";

  /** "I'm looking for a guy called Ernest." choice on the mad-scientist page. */
  const FIND_ERNEST_OPTION = "I'm looking for a guy called Ernest.";

  let quest;

  const hasItem = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const hasAllParts = (player) => hasItem(player, GAUGE) && hasItem(player, TUBE) && hasItem(player, OIL_CAN);

  const attr = (player, key) => Number(player.getAttribute(key)) || 0;
  const setAttr = (player, key, value) => player.setAttribute(key, value);

  /** The 9 puzzle doors opened by the 6 lever bits (copied from the reference). */
  function getErnestPuzzleDoorStates(bits) {
    const [a, b, c, d, e, f] = [0, 1, 2, 3, 4, 5].map((index) => (bits & (1 << index)) !== 0);
    return [
      !a && !b && d && e && f,
      !b && d && f,
      a && b && d,
      d,
      !e && f,
      !a && !b && c && d && !e && f,
      !b && d && !f,
      a && b && !c && !d && !e && !f,
      (!c && d) || (!a && !b && c && d && !e && f),
    ];
  }

  function buildJournal(player, quest) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I repaired the machine and Ernest is human again.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_ODDENSTEIN) {
      return [
        "Professor Oddenstein needs a <col=800000>pressure gauge</col>,",
        "<col=800000>rubber tube</col> and <col=800000>oil can</col> to restore Ernest.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "I should search Draynor Manor for Ernest",
        "and speak to <col=800000>Professor Oddenstein</col> upstairs.",
      ];
    }
    return [
      "I can start this quest by speaking to",
      "<col=800000>Veronica</col> outside Draynor Manor.",
    ];
  }

  /** Teleport the player to the far side of a door/bookcase they clicked. */
  function crossDoor(player, tile) {
    const position = player.getLocation();
    const z = tile.z ?? position.getZ();
    const dx = position.getX() - tile.x;
    const dy = position.getY() - tile.y;
    let x = position.getX();
    let y = position.getY();
    if (Math.abs(dx) > Math.abs(dy)) x = tile.x - Math.sign(dx);
    else y = tile.y - Math.sign(dy);
    player.moveTo(new Location(x, y, z));
  }

  function syncLevers(player, bits) {
    setAttr(player, LEVERS_ATTRIBUTE, bits & 0x3f);
    player.getPacketSender().sendConfig(VARP_LEVERS, bits & 0x3f);
  }

  function bite(player, message) {
    if (message) player.sendMessage(message);
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(1, HitMask.RED)]);
  }

  function searchCompost(player) {
    player.sendMessage("You find nothing but rotting vegetables. Perhaps a spade would help.");
  }

  function digCompost(player) {
    if (hasItem(player, KEY)) {
      player.sendMessage("You find nothing else.");
      return;
    }
    if (player.getInventory().isFull()) {
      player.sendMessage("You need a free inventory slot.");
      return;
    }
    player.getInventory().adds(KEY, 1);
    player.sendMessage("You dig up a small key.");
  }

  function searchFountain(player) {
    if (hasItem(player, GAUGE)) {
      player.sendMessage("There is nothing else in the fountain.");
      return;
    }
    if (attr(player, FOUNTAIN_ATTRIBUTE) !== 1) {
      bite(player, "The piranhas bite your hand!");
      return;
    }
    if (player.getInventory().isFull()) {
      player.sendMessage("You need a free inventory slot.");
      return;
    }
    player.getInventory().adds(GAUGE, 1);
    player.sendMessage("You retrieve the pressure gauge from the fountain.");
  }

  function useFishFoodOnFountain(player) {
    player.getInventory().deleteNumber(FISH_FOOD, 1);
    player.sendMessage("You pour the fish food into the fountain.");
    player.sendMessage("The piranhas start eating the food...");
    player.sendMessage("Now they seem hungrier than ever!");
  }

  function usePoisonedFoodOnFountain(player) {
    if (attr(player, FOUNTAIN_ATTRIBUTE) === 1) return;
    player.getInventory().deleteNumber(POISONED_FOOD, 1);
    setAttr(player, FOUNTAIN_ATTRIBUTE, 1);
    player.sendMessage("You pour the poisoned fish food into the fountain.");
    player.sendMessage("The piranhas start eating the food...");
    player.sendMessage("... then die and float to the surface.");
  }

  function poisonFishFood(player) {
    if (!hasItem(player, POISON) || !hasItem(player, FISH_FOOD)) return;
    player.getInventory().deleteNumber(FISH_FOOD, 1);
    player.getInventory().deleteNumber(POISON, 1);
    player.getInventory().adds(POISONED_FOOD, 1);
    player.sendMessage("You poison the fish food.");
  }

  function searchBookcase(player, tile) {
    player.sendMessage("You pull a book and the bookcase swings aside.");
    player.moveTo(new Location(tile.x + (player.getLocation().getX() < tile.x ? 1 : -1), player.getLocation().getY(), tile.z ?? player.getLocation().getZ()));
  }

  function openClosetDoor(player, tile) {
    if (!hasItem(player, KEY)) {
      player.sendMessage("The door is locked.");
      return;
    }
    crossDoor(player, tile);
  }

  function useLever(player, index) {
    const bits = attr(player, LEVERS_ATTRIBUTE) ^ (1 << index);
    syncLevers(player, bits);
    player.sendMessage(
      `You pull lever ${String.fromCharCode(65 + index)} ${(bits & (1 << index)) !== 0 ? "down" : "up"}.`
    );
  }

  function usePuzzleDoor(player, tile) {
    const index = DOOR_TILES.findIndex(([x, y]) => x === tile.x && y === tile.y);
    const states = getErnestPuzzleDoorStates(attr(player, LEVERS_ATTRIBUTE));
    if (index < 0 || !states[index]) {
      player.sendMessage("The door is locked firmly in place.");
      return;
    }
    crossDoor(player, tile);
  }

  function reward(player) {
    player.getInventory().adds(COINS, 300);
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);

    if (npcId === VERONICA_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return { page: PAGE_VERONICA, variant: VERONICA_POST_QUEST_VARIANT };
      if (stage >= STAGE_ODDENSTEIN) {
        return { page: PAGE_ERNEST, variant: VERONICA_FINDING_OUT_VARIANT };
      }
      if (stage >= STAGE_STARTED) {
        return { page: PAGE_ERNEST, variant: VERONICA_STARTING_VARIANT };
      }
      return { page: PAGE_VERONICA, variant: VERONICA_PRE_QUEST_VARIANT };
    }

    if (npcId === ODDENSTEIN_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return { page: PAGE_ODDENSTEIN, variant: ODDENSTEIN_AFTER_VARIANT };
      if (stage === STAGE_STARTED) return { page: PAGE_ERNEST, variant: ODDENSTEIN_START_VARIANT };
      if (stage >= STAGE_ODDENSTEIN) {
        const gauge = hasItem(player, GAUGE);
        const tube = hasItem(player, TUBE);
        const oil = hasItem(player, OIL_CAN);
        if (gauge && tube && oil) return { page: PAGE_ERNEST, variant: FINISHING_UP_VARIANT };
        if (tube && gauge) return { page: PAGE_ERNEST, variant: ODDENSTEIN_RETURN_TUBE_GAUGE_VARIANT };
        if (tube && oil) return { page: PAGE_ERNEST, variant: ODDENSTEIN_RETURN_TUBE_OIL_VARIANT };
        if (gauge && oil) return { page: PAGE_ERNEST, variant: ODDENSTEIN_RETURN_GAUGE_OIL_VARIANT };
        if (gauge) return { page: PAGE_ERNEST, variant: ODDENSTEIN_RETURN_GAUGE_VARIANT };
        if (tube) return { page: PAGE_ERNEST, variant: ODDENSTEIN_RETURN_TUBE_VARIANT };
        if (oil) return { page: PAGE_ERNEST, variant: ODDENSTEIN_RETURN_OIL_VARIANT };
        return { page: PAGE_ERNEST, variant: ODDENSTEIN_BEFORE_PARTS_VARIANT };
      }
      return { page: PAGE_ODDENSTEIN, variant: ODDENSTEIN_STANDARD_VARIANT };
    }

    if (npcId === ERNEST_NPC_ID) {
      // No chicken-specific transcript in the dump; the wiki infobox lists
      // Ernest on the shared finishing-up conversation.
      return { page: PAGE_ERNEST, variant: FINISHING_UP_VARIANT };
    }

    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== VERONICA_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) >= STAGE_STARTED) return;
    quest.setStage(player, STAGE_STARTED);
  }

  // The dump carries no hook for learning about the parts, so advance the
  // stage when the player commits to finding Ernest.
  function handleOddensteinChoice({ player, npcId, option }) {
    if (npcId !== ODDENSTEIN_NPC_ID) return;
    if (option !== FIND_ERNEST_OPTION) return;
    if (quest.getStage(player) >= STAGE_ODDENSTEIN) return;
    quest.setStage(player, STAGE_ODDENSTEIN);
  }

  function handleAction(event) {
    const { player, step } = event;

    // The runtime cannot render a `line` whose speaker is not the clicked
    // NPC, so consume Ernest's two lines in finishing-up to keep the branch
    // alive instead of showing "conversation unavailable".
    if (step?.type === "line" && step.speaker === "Ernest") {
      event.handled = true;
      return;
    }

    if (event.stepId !== COMPLETE_ACTION_ID) return;
    if (!hasAllParts(player)) return;
    player.getInventory().deleteNumber(GAUGE, 1);
    player.getInventory().deleteNumber(TUBE, 1);
    player.getInventory().deleteNumber(OIL_CAN, 1);
    quest.complete(player);
    event.handled = true;
    event.end = true;
  }

  function handleItemOnItem(event) {
    const ids = [event.usedItemId, event.usedWithItemId];
    if (!ids.includes(POISON) || !ids.includes(FISH_FOOD)) return;
    poisonFishFood(event.player);
    event.handled = true;
  }

  function handleItemOnObject(event) {
    const { player, objectId, itemId } = event;
    if (objectId === COMPOST && itemId === SPADE) {
      digCompost(player);
      event.handled = true;
      return;
    }
    if (objectId === CLOSET_DOOR && itemId === KEY) {
      crossDoor(player, event.location);
      event.handled = true;
      return;
    }
    if (objectId === FOUNTAIN) {
      if (itemId === FISH_FOOD) {
        useFishFoodOnFountain(player);
        event.handled = true;
      } else if (itemId === POISONED_FOOD) {
        usePoisonedFoodOnFountain(player);
        event.handled = true;
      } else {
        player.sendMessage("Something in the water bites you.");
        player.sendMessage("Ow!");
        event.handled = true;
      }
    }
  }

  function handleObjectInteraction(event) {
    const option = String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "").toLowerCase();
    const { player, objectId, location } = event;

    if (LEVER_IDS.has(objectId)) {
      useLever(player, LEVER_IDS.get(objectId));
      event.handled = true;
      return;
    }
    if (DOORS.includes(objectId)) {
      usePuzzleDoor(player, location);
      event.handled = true;
      return;
    }
    if (objectId === COMPOST && option.includes("search")) {
      searchCompost(player);
      event.handled = true;
      return;
    }
    if (objectId === FOUNTAIN && option.includes("search")) {
      searchFountain(player);
      event.handled = true;
      return;
    }
    if (objectId === CLOSET_DOOR && option.includes("open")) {
      openClosetDoor(player, location);
      event.handled = true;
      return;
    }
    if (BOOKCASES.includes(objectId) && option.includes("search")) {
      searchBookcase(player, location);
      event.handled = true;
      return;
    }
    if (objectId === LADDER_DOWN && option.includes("climb")) {
      syncLevers(player, 0);
      player.moveTo(new Location(3117, 9754, 0));
      event.handled = true;
      return;
    }
    if (objectId === LADDER_UP && option.includes("climb")) {
      syncLevers(player, 0);
      player.moveTo(new Location(3092, 3362, 0));
      event.handled = true;
    }
  }

  quest = registerQuest(api, {
    key: "ernest_the_chicken",
    name: "Ernest the Chicken",
    varpId: VARP_ERNEST,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 4,
    scrollItemId: COINS,
    rewardItemLabel: "300 Coins",
    buildJournal,
    onReward: reward,
  });

  api.persistAttribute(FOUNTAIN_ATTRIBUTE);
  api.persistAttribute(LEVERS_ATTRIBUTE);

  api.onNpcDialogueVariant(selectVariant);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleOddensteinChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnObject(handleItemOnObject);
  api.onObjectInteraction(handleObjectInteraction);
};
