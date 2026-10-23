/**
 * Fishing Contest (members).
 *
 * Words come from the "Fishing Contest" transcript page:
 *   Austri/Vestri (not indexed)  -> starting-out-speaking-to-vestri-or-austri-to-start-the-quest
 *                                   ...-before-winning / ...-retrieving-another-fishing-pass-from-vestri-or-austri
 *                                   returning-to-vestri-or-austri
 *   Bonzo   -> the-contest-... variants by stage
 *   Morris  -> entering-the-competition-talking-to-morris
 *   others  -> speaking-to-the-other-contestants-* / speaking-to-grandpa-jack
 *
 * Austri and Vestri are not in npc-dialogue-index.json, so their start/hand-in
 * transcripts are replayed from an interaction (as Priest in Peril does for the
 * monks). The plugin supplies the variant selector, the condition answers, the
 * start hook (stage + pass), the win hand-in and the completion action.
 *
 * Bonzo is claimed with a name-specific hook so the Farming plugin's generic
 * "NPC advertises Pay, it must be a gardener" handler (Services.Farming.js) can
 * never swallow his Talk-to again: that used to leave the quest stuck at stage 1.
 * The rest of the contest is owned here too: the wall pipe (route override - the
 * pipe is a wall loc the generic walk-to cannot reach), the red vine worms, the
 * Hemenster contest spots (rod + red vine worms; raw sardine at the willow spot,
 * raw giant carp by the pipes once the garlic has moved the Sinister Stranger)
 * and the tunnel stairs, which only the completed quest unlocks.
 */
module.exports = function registerFishingContestQuest(api) {
  const {
    Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers,
    Animation, CountdownTask, Item, TaskManager,
  } = api.core;
  const { registerQuest, startTranscript, refreshQuestList } = require("../QuestRuntime");

  const PAGE = "Fishing Contest";
  const VARP_FISHING_CONTEST = 11;

  const STAGE_STARTED = 1;
  const STAGE_COMPETING = 2;
  const STAGE_GARLIC = 3;
  const STAGE_WON = 4;
  const STAGE_COMPLETE = 5;
  const FISHING_LEVEL = 10;
  const ENTRY_FEE = 5;
  const FISHING_ROD_PRICE = 5;
  /** Ticks between starting a cast and landing the contest fish. */
  const CAST_TICKS = 3;
  const FISHING_ANIMATION = 622;

  const START_HOOK = "quest:fishing-contest:start";
  /** Transcript action that ends the "returning to Vestri or Austri" branch. */
  const COMPLETE_ACTION_ID = "VGuVO2";
  /** Bonzo's "you are given the trophy" message after catching the winning carp. */
  const TROPHY_MESSAGE_ID = "jUkdtL";
  /** Vestri/Austri hand over the pass while starting the quest. */
  const PASS_MESSAGE_ID = "DMXLo9";
  /** "Your fishing competition spot is now beside the pipes." after the stranger moves. */
  const MOVE_SPOT_ACTION_ID = "zhYIEx";
  /** "You hand over your catch." when Bonzo takes a regular fish. */
  const REGULAR_FISH_HANDOVER_ID = "S6F2P5";
  /** "You hand over the money and receive a fishing rod." at Grandpa Jack. */
  const ROD_PURCHASE_MESSAGE_ID = "qkk2D3";
  /** "You show Morris your pass." in both Morris transcripts. */
  const MORRIS_SHOWS_PASS_IDS = new Set(["O2HuL5", "VItnPp"]);
  const SPARE_TROPHY_LINE = "I have a spare";

  const DwarfHandlerIds = new Set([NpcIdentifiers.AUSTRI, NpcIdentifiers.VESTRI]);
  const BONZO_NPC_ID = NpcIdentifiers.BONZO;
  const MORRIS_NPC_ID = NpcIdentifiers.MORRIS;

  const FISHING_PASS_ITEM_ID = ItemIdentifiers.FISHING_PASS;
  const FISHING_TROPHY_ITEM_ID = ItemIdentifiers.FISHING_TROPHY;
  const GIANT_CARP_ITEM_ID = ItemIdentifiers.GIANT_CARP;
  const RAW_GIANT_CARP_ITEM_ID = ItemIdentifiers.RAW_GIANT_CARP;
  const RAW_SARDINE_ITEM_ID = ItemIdentifiers.RAW_SARDINE;
  const RED_VINE_WORM_ITEM_ID = ItemIdentifiers.RED_VINE_WORM;
  const FISHING_ROD_ITEM_ID = ItemIdentifiers.FISHING_ROD;
  const PEARL_FISHING_ROD_ITEM_ID = ItemIdentifiers.PEARL_FISHING_ROD;
  const SPADE_ITEM_ID = ItemIdentifiers.SPADE;
  const GARLIC_ITEM_ID = ItemIdentifiers.GARLIC;
  const COINS_ITEM_ID = ItemIdentifiers.COINS;

  const WALL_PIPE_OBJECT_ID = ObjectIdentifiers.WALL_PIPE;
  /** Walkable tile east of the easternmost wall pipe (the field side approach). */
  const PIPE_APPROACH_X = 2639;
  const PIPE_APPROACH_Y = 3446;
  const HEMENSTER_GATE_TILES = new Map([
    [ObjectIdentifiers.GATE_4, { x: 2642, y: 3442 }],
    [ObjectIdentifiers.GATE_5, { x: 2642, y: 3441 }],
  ]);
  const isHemensterGate = (objectId, location) => {
    const tile = HEMENSTER_GATE_TILES.get(objectId);
    return !!tile && location.getZ() === 0 &&
      location.getX() === tile.x && location.getY() === tile.y;
  };
  // The four contest spots. The willow one is the player's, the pipe one the
  // Sinister Stranger's until the garlic moves him; Big Dave and Joshua hold the rest.
  const WILLOW_SPOT_NPC_ID = 4079;
  const PIPE_SPOT_NPC_ID = 4080;
  const BIG_DAVE_SPOT_NPC_ID = 4081;
  const JOSHUA_SPOT_NPC_ID = 4082;
  const HEMENSTER_SPOT_IDS = new Set([
    WILLOW_SPOT_NPC_ID, PIPE_SPOT_NPC_ID, BIG_DAVE_SPOT_NPC_ID, JOSHUA_SPOT_NPC_ID,
  ]);

  /** Shows Morris the pass before the gate stops asking (kept per session). */
  const GATE_ATTRIBUTE = "fishing-contest:gate-pass-shown";
  /** Garlic can go in the pipe before or after paying; the stranger moves on entry. */
  const GARLIC_ATTRIBUTE = "fishing-contest:garlic-in-pipe";

  const page = (variant) => ({ page: PAGE, variant });
  const has = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const fishingLevel = (player) => player.getSkillManager().getCurrentLevel(Skill.FISHING);
  const amount = (player, itemId) => player.getInventory().getAmount(itemId);

  const inHemenster = (location) =>
    location.getZ() === 0 && location.getX() >= 2620 && location.getX() <= 2650 &&
    location.getY() >= 3410 && location.getY() <= 3450;

  const inMcGruborsWood = (location) =>
    location.getZ() === 0 && location.getX() >= 2625 && location.getX() <= 2640 &&
    location.getY() >= 3488 && location.getY() <= 3508;

  /** The White Wolf tunnel stairs on either entrance (surface and underground). */
  const isTunnelStairs = (location) => {
    if (location.getZ() !== 0) return false;
    const x = location.getX();
    const y = location.getY();
    if (x < 2817 || x > 2881) return false;
    const west = x <= 2824;
    const east = x >= 2873;
    if (!west && !east) return false;
    return (y >= 3480 && y <= 3487) || (y >= 9878 && y <= 9885);
  };

  let quest;

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I won the Hemenster Fishing Contest.</str>",
        "<str>The dwarves let me use their tunnel.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_WON) {
      return [
        "I won the contest and should take the <col=800000>trophy</col>",
        "back to Austri or Vestri at White Wolf Mountain.",
      ];
    }
    if (stage >= STAGE_GARLIC) {
      return [
        "The sinister stranger moved away from the pipes.",
        "I should use <col=800000>red vine worms</col> at the pipe fishing spot.",
      ];
    }
    if (stage >= STAGE_COMPETING) {
      return [
        "I am competing at Hemenster.",
        "The sinister stranger still holds the spot by the pipes.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "The dwarves gave me a <col=800000>Fishing pass</col>.",
        "I must win the contest at <col=800000>Hemenster</col>.",
      ];
    }
    return [
      "Speak to <col=800000>Austri or Vestri</col> beside the",
      "White Wolf Mountain tunnel.",
      "",
      "<col=ff0000>Requires level 10 Fishing.</col>",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.FISHING, 2437.5);
  }

  /** Which transcript variant the clicked NPC plays. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === BONZO_NPC_ID) {
      if (stage < STAGE_STARTED) return page("the-contest-fishing-before-entering-the-competition");
      if (stage >= STAGE_WON) return page("the-contest-talking-to-bonzo-after-winning");
      if (stage >= STAGE_COMPETING) return page("the-contest-speaking-to-bonzo-after-catching-a-fish");
      return page("the-contest-speaking-to-bonzo");
    }
    if (npcId === MORRIS_NPC_ID) {
      // The pass-show page is only valid when the player can actually show the pass.
      if (!has(player, FISHING_PASS_ITEM_ID)) {
        return { page: "Morris", variant: "standard-dialogue-entering-the-gate" };
      }
      return page("entering-the-competition-talking-to-morris");
    }
    if (npcId === NpcIdentifiers.SINISTER_STRANGER || npcId === NpcIdentifiers.SINISTER_STRANGER_2) {
      return page("speaking-to-the-other-contestants-sinister-stranger");
    }
    if (npcId === NpcIdentifiers.BIG_DAVE) {
      return page("speaking-to-the-other-contestants-big-dave");
    }
    if (npcId === NpcIdentifiers.JOSHUA) {
      return page("speaking-to-the-other-contestants-joshua");
    }
    if (npcId === NpcIdentifiers.GRANDPA_JACK) return page("speaking-to-grandpa-jack");
    return null;
  }

  /** Answer the page's prose conditions. */
  function answerCondition({ player, npcId, text }) {
    if (!DwarfHandlerIds.has(npcId) && ![BONZO_NPC_ID, MORRIS_NPC_ID, NpcIdentifiers.SINISTER_STRANGER, NpcIdentifiers.SINISTER_STRANGER_2, NpcIdentifiers.BIG_DAVE, NpcIdentifiers.JOSHUA, NpcIdentifiers.GRANDPA_JACK].includes(npcId)) return null;
    const value = String(text).toLowerCase();
    const stage = quest.getStage(player);
    if (value.includes("quest speedrunning world")) return false;
    if (value.includes("does not meet the requirements to begin fishing contest")) {
      return fishingLevel(player) < FISHING_LEVEL;
    }
    if (value.includes("garlic was placed in the pipes")) {
      return player.getAttribute(GARLIC_ATTRIBUTE) === true || stage >= STAGE_GARLIC;
    }
    if (value.includes("regular fish")) return has(player, RAW_SARDINE_ITEM_ID);
    if (value.includes("giant carp")) {
      return has(player, RAW_GIANT_CARP_ITEM_ID) || has(player, GIANT_CARP_ITEM_ID);
    }
    if (value.includes("fishing trophy has been lost")) {
      // After completion the trophy was legitimately handed over, not lost.
      return !quest.isComplete(player) && !has(player, FISHING_TROPHY_ITEM_ID);
    }
    if (value.includes("fishing rod in their inventory")) return hasRodInInventory(player);
    if (value.includes("insufficient coins")) return amount(player, COINS_ITEM_ID) < FISHING_ROD_PRICE;
    if (value.includes("insufficient inventory space")) return player.getInventory().isFull();
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!DwarfHandlerIds.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) >= STAGE_STARTED) return;
    quest.setStage(player, STAGE_STARTED);
  }

  /** The pass is handed over inside the start transcript, after the choice hook. */
  function handlePassMessage({ player, npcId, stepId }) {
    if (!DwarfHandlerIds.has(npcId) || stepId !== PASS_MESSAGE_ID) return;
    if (!has(player, FISHING_PASS_ITEM_ID)) player.getInventory().adds(FISHING_PASS_ITEM_ID, 1);
  }

  /** Vestri/Austri replace a lost pass on the canonical "need another pass" branch. */
  function handleDwarfChoice({ player, npcId, option }) {
    if (!DwarfHandlerIds.has(npcId)) return;
    if (!/need another competition pass/i.test(String(option ?? ""))) return;
    if (!has(player, FISHING_PASS_ITEM_ID)) player.getInventory().adds(FISHING_PASS_ITEM_ID, 1);
  }

  /** Charges Bonzo's entrance fee once; false when the player cannot pay. */
  function chargeEntryFee(player) {
    if (quest.getStage(player) >= STAGE_COMPETING) return true;
    if (amount(player, COINS_ITEM_ID) < ENTRY_FEE) {
      player.sendMessage(`You need ${ENTRY_FEE} coins to enter the competition.`);
      return false;
    }
    player.getInventory().deleteNumber(COINS_ITEM_ID, ENTRY_FEE);
    quest.setStage(player, STAGE_COMPETING);
    return true;
  }

  /** The "I'll enter the competition please." option takes the fee. */
  function handleBonzoChoice({ player, npcId, option }) {
    if (npcId !== BONZO_NPC_ID || !/enter the competition/i.test(String(option ?? ""))) return;
    if (quest.getStage(player) >= STAGE_COMPETING) return;
    if (!chargeEntryFee(player)) return;
    player.sendMessage(`You pay Bonzo ${ENTRY_FEE} coins to enter the competition.`);
  }

  /**
   * Bonzo's right-click Pay option. The wiki "pay option" transcript ends in a
   * "same as above" jump the replay runtime cannot expand, so play its entry
   * branch (announce the spots, move the stranger when the garlic is in) directly
   * after charging - that is where the stranger's reaction lives.
   */
  function handleBonzoPay(event) {
    event.handled = true;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED) {
      startTranscript(api, player, BONZO_NPC_ID, PAGE, "the-contest-fishing-before-entering-the-competition");
      return;
    }
    if (stage >= STAGE_COMPETING) {
      // Re-entry after paying before the garlic: the stranger still has to move.
      if (stage < STAGE_GARLIC && player.getAttribute(GARLIC_ATTRIBUTE)) {
        startTranscript(api, player, BONZO_NPC_ID, PAGE, "the-contest-speaking-to-bonzo", enterContestBranch);
        return;
      }
      startTranscript(api, player, BONZO_NPC_ID, PAGE, "the-contest-speaking-to-bonzo-trying-to-pay-bonzo-during-the-competition");
      return;
    }
    if (!chargeEntryFee(player)) return;
    player.sendMessage(`You pay Bonzo ${ENTRY_FEE} coins to enter the competition.`);
    startTranscript(api, player, BONZO_NPC_ID, PAGE, "the-contest-speaking-to-bonzo", enterContestBranch);
  }

  /** The "I'll enter the competition please." branch: explanation + stranger move. */
  function enterContestBranch(steps) {
    const choice = (steps ?? []).find((step) => step.type === "choice");
    const option = choice?.options?.find((option) => /enter the competition/i.test(option.text));
    return option?.steps ?? steps;
  }

  /** Without a carp the "big fish" hand-over option must not be offered. */
  function withoutWinningOption(steps, player) {
    if (has(player, RAW_GIANT_CARP_ITEM_ID) || has(player, GIANT_CARP_ITEM_ID)) return steps;
    return steps.filter((step) =>
      !(step.type === "choice" && step.options?.some((option) => /big fish/i.test(option.text))));
  }

  /**
   * Normal Bonzo conversation. Bonzo is owned here (not by the shared
   * NpcDialogues Talk-to) so the Farming plugin can never hijack his Pay option.
   */
  function handleBonzoTalk(event) {
    event.handled = true;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage >= STAGE_WON) {
      startTranscript(api, player, BONZO_NPC_ID, PAGE, "the-contest-talking-to-bonzo-after-winning");
      return;
    }
    if (stage >= STAGE_COMPETING) {
      startTranscript(api, player, BONZO_NPC_ID, PAGE, "the-contest-speaking-to-bonzo-after-catching-a-fish",
        (steps) => withoutWinningOption(steps, player));
      return;
    }
    if (stage >= STAGE_STARTED) {
      startTranscript(api, player, BONZO_NPC_ID, PAGE, "the-contest-speaking-to-bonzo");
      return;
    }
    startTranscript(api, player, BONZO_NPC_ID, PAGE, "the-contest-fishing-before-entering-the-competition");
  }

  /** Bonzo's winning message hands over the trophy; the dwarves finish it. */
  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (npcId === BONZO_NPC_ID && stepId === REGULAR_FISH_HANDOVER_ID) {
      player.getInventory().deleteNumber(RAW_SARDINE_ITEM_ID, 1);
      return;
    }
    if (npcId === BONZO_NPC_ID && stepId === MOVE_SPOT_ACTION_ID) {
      // "Your fishing competition spot is now beside the pipes."
      if (quest.getStage(player) < STAGE_GARLIC) quest.setStage(player, STAGE_GARLIC);
      return;
    }
    if (npcId === BONZO_NPC_ID && stepId === TROPHY_MESSAGE_ID) {
      if (quest.getStage(player) >= STAGE_WON) return;
      // Bonzo takes every raw giant carp the player carries.
      const carps = amount(player, RAW_GIANT_CARP_ITEM_ID);
      if (carps > 0) player.getInventory().deleteNumber(RAW_GIANT_CARP_ITEM_ID, carps);
      if (!has(player, FISHING_TROPHY_ITEM_ID)) player.getInventory().adds(FISHING_TROPHY_ITEM_ID, 1);
      quest.setStage(player, STAGE_WON);
      return;
    }
    if (npcId === MORRIS_NPC_ID && MORRIS_SHOWS_PASS_IDS.has(stepId)) {
      if (has(player, FISHING_PASS_ITEM_ID)) player.setAttribute(GATE_ATTRIBUTE, true);
      return;
    }
    if (DwarfHandlerIds.has(npcId) && stepId === COMPLETE_ACTION_ID) {
      if (quest.isComplete(player)) return;
      if (has(player, FISHING_TROPHY_ITEM_ID)) player.getInventory().deleteNumber(FISHING_TROPHY_ITEM_ID, 1);
      quest.complete(player);
    }
  }

  /** Bonzo replaces a lost trophy during the "after winning" chat. */
  function handleLine({ player, npcId, text }) {
    if (npcId !== BONZO_NPC_ID || !String(text ?? "").includes(SPARE_TROPHY_LINE)) return;
    if (quest.getStage(player) < STAGE_WON || quest.isComplete(player)) return;
    if (!has(player, FISHING_TROPHY_ITEM_ID)) player.getInventory().adds(FISHING_TROPHY_ITEM_ID, 1);
  }

  /**
   * Grandpa Jack sells a fishing rod for 5 coins. The transcript only reaches this
   * message after its has-rod, coins and inventory-space guards have passed.
   */
  function handleGrandpaPurchase({ player, npcId, stepId, kind }) {
    if (npcId !== NpcIdentifiers.GRANDPA_JACK || stepId !== ROD_PURCHASE_MESSAGE_ID) return;
    if (kind !== undefined && kind !== "message") return;
    if (amount(player, COINS_ITEM_ID) < FISHING_ROD_PRICE) return;
    if (hasRodInInventory(player) || player.getInventory().isFull()) return;
    player.getInventory().deleteNumber(COINS_ITEM_ID, FISHING_ROD_PRICE);
    player.getInventory().addItem(new Item(FISHING_ROD_ITEM_ID, 1));
  }

  /** Red vine worms: checking the vine or using a spade on it digs one up. */
  function digRedVine(player) {
    if (!has(player, SPADE_ITEM_ID)) {
      player.sendMessage("You need a spade to dig up this vine.");
      return;
    }
    if (player.getInventory().isFull() && !has(player, RED_VINE_WORM_ITEM_ID)) {
      player.getInventory().full();
      return;
    }
    player.sendMessage("You dig in amongst the vines.");
    player.sendMessage("You find a red vine worm.");
    player.getInventory().addItem(new Item(RED_VINE_WORM_ITEM_ID, 1));
  }

  function checkVine(event) {
    if (!inMcGruborsWood(event.object.getLocation())) return false;
    event.handled = true;
    digRedVine(event.player);
  }

  function useSpadeOnVine(event) {
    if (!inMcGruborsWood(event.object.getLocation())) return false;
    event.handled = true;
    digRedVine(event.player);
  }

  /**
   * The wall pipe is a wall loc the generic walk-to cannot reach: the map's wall
   * collision seals the tiles south of the pipes, and the only walkable approach
   * is the open tile east of the easternmost pipe. Route every pipe there, so a
   * click (or garlic use) from anywhere walks up and fires the interaction.
   */
  function routeWallPipe(event) {
    if (event.objectId !== WALL_PIPE_OBJECT_ID) return;
    const location = event.object.getLocation();
    if (!inHemenster(location)) return;
    event.destination = { x: PIPE_APPROACH_X, y: PIPE_APPROACH_Y, z: location.getZ() };
  }

  function searchWallPipe(event) {
    if (event.objectId !== WALL_PIPE_OBJECT_ID || !inHemenster(event.object.getLocation())) return false;
    event.handled = true;
    if (event.player.getAttribute(GARLIC_ATTRIBUTE)) {
      event.player.sendMessage("I shoved some garlic up here.");
      return;
    }
    startTranscript(api, event.player, BONZO_NPC_ID, PAGE, "the-contest-searching-the-wall-pipe");
  }

  function useItemOnWallPipe(event) {
    if (event.objectId !== WALL_PIPE_OBJECT_ID || !inHemenster(event.object.getLocation())) return false;
    event.handled = true;
    const { player } = event;
    if (event.itemId !== GARLIC_ITEM_ID) {
      startTranscript(api, player, BONZO_NPC_ID, PAGE, "the-contest-trying-to-put-anything-but-garlic-into-the-wall-pipe");
      return;
    }
    if (player.getAttribute(GARLIC_ATTRIBUTE)) {
      player.sendMessage("I shoved some garlic up here.");
      return;
    }
    player.getInventory().deleteNumber(GARLIC_ITEM_ID, 1);
    player.setAttribute(GARLIC_ATTRIBUTE, true);
    player.sendMessage("You stash the garlic in the pipe.");
    // Paid players see the stranger move now; the entry dialogue covers those who pay after.
    if (quest.getStage(player) >= STAGE_COMPETING) quest.setStage(player, STAGE_GARLIC);
  }

  const hasRodInInventory = (player) => player.getInventory().contains(FISHING_ROD_ITEM_ID) ||
    player.getInventory().contains(PEARL_FISHING_ROD_ITEM_ID);

  function hasFishingRod(player) {
    const inventory = player.getInventory();
    const equipment = player.getEquipment?.();
    return inventory.contains(FISHING_ROD_ITEM_ID) || inventory.contains(PEARL_FISHING_ROD_ITEM_ID) ||
      (equipment?.contains(FISHING_ROD_ITEM_ID) ?? false) || (equipment?.contains(PEARL_FISHING_ROD_ITEM_ID) ?? false);
  }

  /** One contest cast: animation now, the fish lands a few ticks later. */
  function startContestCast(player, npc, fishId, caughtLine) {
    if (fishingLevel(player) < FISHING_LEVEL) {
      player.sendMessage(`You need a Fishing level of at least ${FISHING_LEVEL} to fish here.`);
      return;
    }
    if (!hasFishingRod(player)) {
      player.sendMessage("You need a fishing rod to fish here.");
      return;
    }
    if (!has(player, RED_VINE_WORM_ITEM_ID)) {
      player.sendMessage("You do not have the required bait.");
      return;
    }
    if (player.getInventory().isFull()) {
      player.getInventory().full();
      return;
    }
    const spot = npc.getLocation().clone();
    player.sendMessage("You begin to fish..");
    player.performAnimation(new Animation(FISHING_ANIMATION));
    TaskManager.submit(new CountdownTask(player, CAST_TICKS, () => {
      if (player.isRegistered?.() === false || player.getHitpoints() <= 0) return;
      if (!player.getLocation().isWithinDistance(spot, 2)) return;
      if (!has(player, RED_VINE_WORM_ITEM_ID)) return;
      if (player.getInventory().isFull()) {
        player.getInventory().full();
        return;
      }
      player.getInventory().deleteNumber(RED_VINE_WORM_ITEM_ID, 1);
      player.getInventory().addItem(new Item(fishId, 1));
      player.sendMessage(caughtLine);
      player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
    }));
  }

  /** Bait at a Hemenster contest spot. */
  function baitHemenster(event) {
    const { player, npc, npcId } = event;
    if (!HEMENSTER_SPOT_IDS.has(npcId)) return false;
    event.handled = true;
    const stage = quest.getStage(player);
    if (stage >= STAGE_WON) {
      player.sendMessage("You have already won the fishing competition! You don't need to catch any more fish here.");
      return;
    }
    if (stage < STAGE_COMPETING) {
      startTranscript(api, player, BONZO_NPC_ID, PAGE, "the-contest-fishing-before-entering-the-competition");
      return;
    }
    if (npcId === BIG_DAVE_SPOT_NPC_ID) {
      startTranscript(api, player, NpcIdentifiers.BIG_DAVE, PAGE, "the-contest-trying-to-fish-in-the-other-spots-big-dave");
      return;
    }
    if (npcId === JOSHUA_SPOT_NPC_ID) {
      startTranscript(api, player, NpcIdentifiers.JOSHUA, PAGE, "the-contest-trying-to-fish-in-the-other-spots-joshua");
      return;
    }
    if (npcId === PIPE_SPOT_NPC_ID && stage < STAGE_GARLIC) {
      startTranscript(api, player, NpcIdentifiers.SINISTER_STRANGER, PAGE, "the-contest-trying-to-fish-in-the-other-spots-sinister-stranger");
      return;
    }
    const carp = npcId === PIPE_SPOT_NPC_ID;
    startContestCast(
      player,
      npc,
      carp ? RAW_GIANT_CARP_ITEM_ID : RAW_SARDINE_ITEM_ID,
      carp ? "You catch a raw giant carp." : "You catch a raw sardine."
    );
  }

  /** Talking your way past Morris is what the gate asks for; the pass itself opens it. */
  function routeHemensterGate(event) {
    const location = event.object.getLocation();
    if (!isHemensterGate(event.objectId, location)) return;
    const { player } = event;
    if (player.getAttribute(GATE_ATTRIBUTE)) return;
    if (player.getLocation().getX() <= location.getX()) return; // already in the field
    if (quest.getStage(player) < STAGE_STARTED || !has(player, FISHING_PASS_ITEM_ID)) return;
    player.setAttribute(GATE_ATTRIBUTE, true);
    startTranscript(api, player, MORRIS_NPC_ID, PAGE, "entering-the-competition-clicking-on-the-gate");
  }

  /**
   * Doors.plugin.js opens the gate on its registered Gate/Open hook after asking
   * through door:toggle. Claim the Hemenster gate only when the pass is missing, so
   * the shared door state cannot let the player through without one.
   */
  function handleHemensterGateToggle(request) {
    if (request.handled) return;
    const { player, objectId } = request;
    const location = request.location ?? request.object?.getLocation?.();
    if (!location || !isHemensterGate(objectId, location)) return;
    // The route handler stops asking once the pass has been shown, and never
    // blocks the field side; leave both cases to Doors so the player can leave.
    if (player.getAttribute(GATE_ATTRIBUTE)) return;
    if (player.getLocation().getX() <= location.getX()) return;
    if (quest.getStage(player) >= STAGE_STARTED && has(player, FISHING_PASS_ITEM_ID)) return;
    request.handled = true;
    if (quest.getStage(player) < STAGE_STARTED) {
      player.sendMessage("You need to start the Fishing Contest quest before entering the competition.");
      return;
    }
    player.sendMessage("You need a fishing pass to enter the competition.");
  }

  /** The tunnel is the quest reward; only a completed quest may use it. */
  function blockTunnelClimb(request) {
    if (quest.isComplete(request.player)) return;
    const location = request.object?.getLocation?.();
    if (!location || !isTunnelStairs(location)) return;
    request.handled = true;
    request.player.sendMessage("The dwarves won't let you use the tunnel until you've won the Fishing Contest.");
  }

  /** Austri/Vestri are not indexed, so replay their transcript by stage. */
  function handleDwarfInteraction(event) {
    if (!DwarfHandlerIds.has(event.npcId)) return;
    const { player } = event;
    const stage = quest.getStage(player);
    event.handled = true;
    if (quest.isComplete(player)) {
      const npcPage = event.npcId === NpcIdentifiers.AUSTRI ? "Austri" : "Vestri";
      startTranscript(api, player, event.npcId, npcPage, "standard-dialogue-after-fishing-contest");
      return;
    }
    if (stage >= STAGE_WON && has(player, FISHING_TROPHY_ITEM_ID)) {
      startTranscript(api, player, event.npcId, PAGE, "returning-to-vestri-or-austri");
      return;
    }
    if (stage >= STAGE_STARTED && !has(player, FISHING_PASS_ITEM_ID)) {
      startTranscript(api, player, event.npcId, PAGE, "starting-out-retrieving-another-fishing-pass-from-vestri-or-austri");
      return;
    }
    if (stage >= STAGE_STARTED) {
      startTranscript(api, player, event.npcId, PAGE, "starting-out-speaking-to-vestri-or-austri-before-winning");
      return;
    }
    startTranscript(api, player, event.npcId, PAGE, "starting-out-speaking-to-vestri-or-austri-to-start-the-quest");
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "fishing_contest",
    name: "Fishing Contest",
    varpId: VARP_FISHING_CONTEST,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.FISHING.getIndex(), amount: 2437.5, label: "Fishing" }],
    // The trophy is handed to the dwarves, not kept: show it on the scroll (scrollItemId)
    // instead of letting complete() grant another one.
    scrollItemId: FISHING_TROPHY_ITEM_ID,
    otherRewards: ["Access to the White Wolf Mountain tunnel"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.persistAttribute(GARLIC_ATTRIBUTE);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:action", handlePassMessage);
  api.onCustomEvent("npc-dialogue:action", handleGrandpaPurchase);
  api.onCustomEvent("npc-dialogue:choice", handleBonzoChoice);
  api.onCustomEvent("npc-dialogue:choice", handleDwarfChoice);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onNpcInteraction(handleDwarfInteraction);
  api.onPlayerLogin(handleLogin);

  // Specific NPC hooks run before the generic ones (Farming's Pay handler, NpcDialogues Talk-to).
  api.onNpcInteraction("Bonzo", { "Talk-to": handleBonzoTalk, Pay: handleBonzoPay });
  api.onNpcInteraction("Fishing spot", { Bait: baitHemenster });

  api.onObjectInteraction("Vine", { Check: checkVine });
  api.onItemOnObject("Spade", "Vine", useSpadeOnVine);
  api.onObjectInteraction("Wall Pipe", { Search: searchWallPipe });
  api.onItemOnObject(useItemOnWallPipe);
  api.onObjectRoute(routeWallPipe);
  api.onObjectRoute(routeHemensterGate);
  api.onCustomEvent("door:toggle", handleHemensterGateToggle);
  api.onCustomEvent("ladders:climb", blockTunnelClimb);
};
