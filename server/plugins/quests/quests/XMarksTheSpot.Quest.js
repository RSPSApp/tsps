/** X Marks the Spot. Capture evidence: docs/f2p-coastal-parity.md. */
module.exports = function registerXMarksTheSpotQuest(api) {
  const { Animation, ItemIdentifiers, NpcIdentifiers, WorldDefinition, ItemStatementDialogue, DialogueChainBuilder } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const VEOS_NPC_ID = NpcIdentifiers.VEOS; // 8484, "veos_visible"
  const VEOS_POST_QUEST_NPC_ID = NpcIdentifiers.VEOS_4; // 10723, "veos_visible_amulet"

  const LUMBRIDGE_VISIBILITY = 12151;
  const SARIM_VISIBILITY = 12148;
  const PREVIOUS_DISTANCE_VARBIT = 8064;
  const PREVIOUS_COORD_VARP = 3697;
  const CLUE_TEXT_INTERFACE = 203;
  const MAP_INTERFACE = 267;
  const HOT_COLD_SCRIPT = 6473;
  const COIN_REWARD_VARBIT = 8065;
  const LAMP_REWARD_VARBIT = 8066;
  const CLUE_REWARD_VARBIT = 8258;
  const VARP_X_MARKS = 2111; // "cluequest_main"
  const VARBIT_X_MARKS = 8063; // "cluequest", bits 0-5
  const ZEAH_VISITED_VARBIT = 4897; // "zeah_playerhasvisited"

  const STAGE_FIRST_CLUE = 1;
  const STAGE_SECOND_CLUE = 2;
  const STAGE_THIRD_CLUE = 3;
  const STAGE_FOURTH_CLUE = 4;
  const STAGE_CASKET = 5;
  const STAGE_COMPLETE = 6;

  const TREASURE_SCROLL_1 = ItemIdentifiers.TREASURE_SCROLL; // 23067
  const TREASURE_SCROLL_2 = ItemIdentifiers.TREASURE_SCROLL_2; // 23068
  const MYSTERIOUS_ORB = ItemIdentifiers.MYSTERIOUS_ORB_2; // 23069
  const TREASURE_SCROLL_3 = ItemIdentifiers.TREASURE_SCROLL_3; // 23070
  const ANCIENT_CASKET = ItemIdentifiers.ANCIENT_CASKET; // 23071
  const ANTIQUE_LAMP = ItemIdentifiers.ANTIQUE_LAMP_21; // 23072
  const BEGINNER_SCROLL_BOX = ItemIdentifiers.SCROLL_BOX_BEGINNER_; // 24361
  const SPADE = ItemIdentifiers.SPADE; // 952
  const COINS = ItemIdentifiers.COINS; // 995

  const LAMP_XP = 300;
  const DIG_ANIMATION = 830;

  const PAGE = "X Marks the Spot";
  const FIRST_CLUE_TEXT =
    "Within the town of Lumbridge lives a man named Bob. He walks out of his door and takes 1 step east, 7 steps north, 5 steps west and 1 step south. Once he arrives, he digs a hole and buries his treasure.";
  const CIPHER_TEXT = "ESBZOPS QJH QFO";

  const START_VARIANT_NOT_VISITED = "starting-off-if-the-player-has-not-visited-great-kourend-before";
  const START_VARIANT_VISITED = "starting-off-if-the-player-has-visited-great-kourend-before";
  const RETAKE_SCROLL_VARIANT =
    "starting-off-talking-to-veos-again-if-the-player-previously-did-not-have-inventory-space-for-the-treasure-scroll";
  const LOST_ITEM_VARIANT = "talking-to-veos-after-losing-an-item";
  // "finishing-up" is also a variant on the "Client of Kourend",
  // "Client of Kourend/Historical" and "Dragon Slayer II" pages, all of which the
  // Veos id index lists before X Marks, so it must name its page.
  const FINISHING_VARIANT = { page: PAGE, variant: "finishing-up" };
  const POST_QUEST_VARIANT = "standard-dialogue-at-port-sarim-subsequent-dialogue";
  const CASKET_REFUSAL_VARIANT = "attempting-to-open-the-ancient-casket";
  const LAST_DIG_VARIANT = "digging-the-last-clue";

  const CLUE_VARIANT_BY_STAGE = new Map([
    [STAGE_FIRST_CLUE, "talking-to-veos-after-receiving-the-first-clue"],
    [STAGE_SECOND_CLUE, "talking-to-veos-after-receiving-the-second-clue"],
    [STAGE_THIRD_CLUE, "talking-to-veos-after-receiving-the-third-clue"],
    [STAGE_FOURTH_CLUE, "talking-to-veos-after-receiving-the-fourth-clue"],
  ]);
  const CLUE_ITEM_BY_STAGE = new Map([
    [STAGE_FIRST_CLUE, TREASURE_SCROLL_1],
    [STAGE_SECOND_CLUE, TREASURE_SCROLL_2],
    [STAGE_THIRD_CLUE, MYSTERIOUS_ORB],
    [STAGE_FOURTH_CLUE, TREASURE_SCROLL_3],
  ]);

  // Condition step ids on the "X Marks the Spot" page.
  const NO_SPACE_CONDITION_IDS = new Set(["eWfCON", "mr8wL6", "72KzXR"]);
  // Action/message step ids.
  const RECEIVE_SCROLL_ACTION_ID = "vNA0zu";
  const RECEIVE_SCROLL_MESSAGE_ID = "6c4VUj";
  const LOST_ITEM_MESSAGE_ID = "dwNSh0";
  const HAND_IN_CASKET_MESSAGE_ID = "HSuTNF";
  const COMPLETE_ACTION_ID = "03vD77";

  const AWAITING_SCROLL_ATTRIBUTE = "x-marks-the-spot:awaiting-scroll";
  const ACCEPTED_ATTRIBUTE = "x-marks-the-spot:accepted";
  const HANDED_CASKET_ATTRIBUTE = "x-marks-the-spot:handed-casket";
  const PREVIOUS_DISTANCE_ATTRIBUTE = "x-marks-the-spot:previous-distance";
  const PREVIOUS_COORD_ATTRIBUTE = "x-marks-the-spot:previous-coord";
  const LAMP_USED_ATTRIBUTE = "x-marks-the-spot:lamp-used";
  const CLUE_BOX_STATE_ATTRIBUTE = "x-marks-the-spot:clue-box-state";
  const CLUE_BOX_PENDING = 1;
  const CLUE_BOX_CLAIMED = 2;

  // Wiki Map:X Marks the Spot pins.
  const DIG_SPOTS = new Map([
    [STAGE_FIRST_CLUE, { x: 3230, y: 3210 }],
    [STAGE_SECOND_CLUE, { x: 3203, y: 3212 }],
    [STAGE_THIRD_CLUE, { x: 3108, y: 3264 }],
    [STAGE_FOURTH_CLUE, { x: 3077, y: 3260 }],
  ]);
  const CASKET_DIG_SPOT = { x: 3077, y: 3260 };

  const lampPending = new WeakMap();
  const endings = new WeakSet();

  let quest;

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const banked = (player, itemId) =>
    (player.getBanks?.() ?? []).some((bank) => Number(bank?.getAmount?.(itemId)) > 0);
  const ownsItem = (player, itemId) => held(player, itemId) || banked(player, itemId);
  const clueBoxState = (player) => Number(player.getAttribute(CLUE_BOX_STATE_ATTRIBUTE)) || 0;
  const atPortSarim = (location) => Boolean(location) && location.z === 0 &&
    location.x >= 2950 && location.x <= 3120 && location.y >= 3150 && location.y <= 3350;

  function setClueBoxState(player, state) {
    player.setAttribute(CLUE_BOX_STATE_ATTRIBUTE, state);
    player.getPacketSender().sendVarbit(CLUE_REWARD_VARBIT, state === CLUE_BOX_CLAIMED ? 1 : 0);
  }

  /** Give the beginner box only when the player does not already own one. */
  function grantClueBox(player) {
    const inventory = player.getInventory();
    const before = inventory.getAmount(BEGINNER_SCROLL_BOX);
    if (before > 0 || banked(player, BEGINNER_SCROLL_BOX) || inventory.getFreeSlots() < 1) return false;
    inventory.adds(BEGINNER_SCROLL_BOX, 1);
    return inventory.getAmount(BEGINNER_SCROLL_BOX) > before;
  }

  /** Grant once, or defer until Veos is spoken to again. Claimed is set only on a real grant. */
  function settleClueBox(player) {
    if (clueBoxState(player) === CLUE_BOX_CLAIMED) return false;
    if (grantClueBox(player)) {
      setClueBoxState(player, CLUE_BOX_CLAIMED);
      return true;
    }
    if (clueBoxState(player) !== CLUE_BOX_PENDING) setClueBoxState(player, CLUE_BOX_PENDING);
    return false;
  }

  /** The persisted attribute is authoritative; 8066 is only a mirror. */
  function mirrorLampState(player) {
    const used = Number(player.getAttribute(LAMP_USED_ATTRIBUTE)) === 1;
    player.getPacketSender().sendVarbit(LAMP_REWARD_VARBIT, used ? 1 : 0);
    return used;
  }

  /** A completed save with no state predates this state and was always marked claimed. */
  function syncClueBoxState(player) {
    let state = clueBoxState(player);
    if (state === 0) {
      state = CLUE_BOX_CLAIMED;
      player.setAttribute(CLUE_BOX_STATE_ATTRIBUTE, state);
    }
    player.getPacketSender().sendVarbit(CLUE_REWARD_VARBIT, state === CLUE_BOX_CLAIMED ? 1 : 0);
    return state;
  }

  /** Port Sarim Veos Talk-to after completion: reclaim an unused lamp and settle a pending box. */
  function recoverVeosRewards(player) {
    const used = mirrorLampState(player);
    const inventory = player.getInventory();
    if (!used && !ownsItem(player, ANTIQUE_LAMP) && inventory.getFreeSlots() >= 1) {
      const before = inventory.getAmount(ANTIQUE_LAMP);
      inventory.adds(ANTIQUE_LAMP, 1);
      if (inventory.getAmount(ANTIQUE_LAMP) <= before) return;
    }
    if (syncClueBoxState(player) === CLUE_BOX_PENDING) settleClueBox(player);
  }

  function handleVeosTalk(event) {
    const location = event.location ?? event.npc?.getLocation?.();
    if (event.clickType !== 1 || !atPortSarim(location)) return;
    if (event.npcId !== VEOS_NPC_ID && event.npcId !== VEOS_POST_QUEST_NPC_ID) return;
    if (quest.getStage(event.player) < STAGE_COMPLETE) return;
    recoverVeosRewards(event.player);
  }

  const onTile = (player, tile) => {
    const location = player.getLocation();
    return Math.abs(location.getX() - tile.x) <= 1 && Math.abs(location.getY() - tile.y) <= 1 && location.getZ() === 0;
  };

  function awaitingScroll(player) {
    return Number(player.getAttribute(AWAITING_SCROLL_ATTRIBUTE)) === 1;
  }

  function hasVisitedKourend(player) {
    return (player.getPacketSender().getVarbit?.(ZEAH_VISITED_VARBIT) ?? 0) > 0;
  }

  function isLumbridgeNpc(npc) {
    const location = npc?.getLocation?.();
    return location ? location.getX() >= 3150 : null;
  }

  function wireStage(stage, player) {
    if (stage >= STAGE_COMPLETE) return 8;
    if (stage === STAGE_CASKET) return player.getAttribute(HANDED_CASKET_ATTRIBUTE) ? 7 : 6;
    return stage > 0 ? stage + 1 : player.getAttribute(ACCEPTED_ATTRIBUTE) ? 1 : 0;
  }

  function ensureVeos(player) {
    const stage = quest.getStage(player);
    const sender = player.getPacketSender();
    sender.sendVarbit(LUMBRIDGE_VISIBILITY, stage < STAGE_CASKET ? 2 : 0);
    sender.sendVarbit(SARIM_VISIBILITY, stage >= STAGE_COMPLETE ? 1 : 3);
  }

  // ==========================================================================
  // Stage / item flow
  // ==========================================================================

  function giveStartScroll(player) {
    if (quest.getStage(player) > 0) return;
    if (player.getInventory().getFreeSlots() < 1) return;
    player.getInventory().adds(TREASURE_SCROLL_1, 1);
    player.setAttribute(AWAITING_SCROLL_ATTRIBUTE, 0);
    quest.setStage(player, STAGE_FIRST_CLUE);
    ensureVeos(player);
  }

  /** The scroll/orb Veos hands back for the stage the player is on. */
  function lostItemId(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_CASKET) return TREASURE_SCROLL_3;
    return CLUE_ITEM_BY_STAGE.get(stage) ?? TREASURE_SCROLL_1;
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (npcId !== VEOS_NPC_ID && npcId !== VEOS_POST_QUEST_NPC_ID) return;
    if (stepId === RECEIVE_SCROLL_ACTION_ID) {
      giveStartScroll(player);
      event.text = "Veos has given you a scroll.";
      event.box = { items: [TREASURE_SCROLL_1] };
      return;
    }
    if (stepId === RECEIVE_SCROLL_MESSAGE_ID) {
      giveStartScroll(player);
      event.box = { items: [TREASURE_SCROLL_1] };
      return;
    }
    if (stepId === LOST_ITEM_MESSAGE_ID) {
      const itemId = lostItemId(player);
      const name = itemId === MYSTERIOUS_ORB ? "a mysterious orb" : "a treasure scroll";
      if (!held(player, itemId) && player.getInventory().getFreeSlots() >= 1) {
        player.getInventory().adds(itemId, 1);
      }
      event.text = `Veos has given you ${name}.`;
      event.box = { items: [itemId] };
      return;
    }
    if (stepId === HAND_IN_CASKET_MESSAGE_ID) {
      if (!held(player, ANCIENT_CASKET)) {
        if (player.getAttribute(HANDED_CASKET_ATTRIBUTE)) { event.handled = true; return; }
        event.handled = true; event.end = true; return;
      }
      player.getInventory().deleteNumber(ANCIENT_CASKET, 1);
      player.setAttribute(HANDED_CASKET_ATTRIBUTE, 1);
      quest.setStage(player, STAGE_CASKET);
      event.box = { items: [ANCIENT_CASKET] };
      return;
    }
    if (stepId === "TS1Ekm") { event.box = { items: [ANCIENT_CASKET] }; return; }
    if (stepId === COMPLETE_ACTION_ID) {
      event.handled = true;
      if (quest.getStage(player) === STAGE_CASKET && player.getAttribute(HANDED_CASKET_ATTRIBUTE)) {
        endings.add(player);
        quest.complete(player);
        ensureVeos(player);
        event.end = true;
      }
      return;
    }
  }

  /** Remember a turned-away start so Veos offers the scroll again next time. */
  function handleCondition({ player, npcId, stepId }) {
    if (npcId !== VEOS_NPC_ID && npcId !== VEOS_POST_QUEST_NPC_ID) return;
    if (NO_SPACE_CONDITION_IDS.has(stepId)) {
      player.setAttribute(AWAITING_SCROLL_ATTRIBUTE, 1);
    }
  }

  // ==========================================================================
  // Dialogue
  // ==========================================================================

  function selectVariant({ npcId, player }) {
    if (npcId !== VEOS_NPC_ID && npcId !== VEOS_POST_QUEST_NPC_ID) return null;
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      // Both ids answer, so the dock Veos keeps working until the next login swaps
      // him to the amulet id.
      return POST_QUEST_VARIANT;
    }
    if (stage >= STAGE_CASKET) {
      if (player.getAttribute(HANDED_CASKET_ATTRIBUTE) || held(player, ANCIENT_CASKET)) return FINISHING_VARIANT;
      // A lost casket is re-dug at the fourth clue; Veos only replaces scrolls and orbs.
      return CLUE_VARIANT_BY_STAGE.get(STAGE_FOURTH_CLUE);
    }
    if (stage <= 0) {
      if (awaitingScroll(player)) return RETAKE_SCROLL_VARIANT;
      return hasVisitedKourend(player) ? START_VARIANT_VISITED : START_VARIANT_NOT_VISITED;
    }
    const clueItem = CLUE_ITEM_BY_STAGE.get(stage);
    if (clueItem !== undefined && !held(player, clueItem)) return LOST_ITEM_VARIANT;
    return CLUE_VARIANT_BY_STAGE.get(stage) ?? null;
  }

  function answerCondition({ npcId, npc, player, text }) {
    if (npcId !== VEOS_NPC_ID && npcId !== VEOS_POST_QUEST_NPC_ID) return null;
    const value = String(text).toLowerCase();
    if (value.includes("does not have any free inventory space")) {
      return player.getInventory().getFreeSlots() <= 0;
    }
    if (value.includes("has a free inventory space")) {
      return player.getInventory().getFreeSlots() >= 1;
    }
    if (value.includes("talks to veos in lumbridge")) return isLumbridgeNpc(npc);
    if (value.includes("talks to veos in port sarim")) {
      const lumbridge = isLumbridgeNpc(npc);
      return lumbridge === null ? null : !lumbridge;
    }
    if (value.includes("free-to-play world")) return !WorldDefinition.isMembersWorld();
    if (value.includes("members' world")) return WorldDefinition.isMembersWorld();
    return null;
  }

  /** Fill the wiki's "[player name]" / "[scroll/orb]" placeholders. */
  function fillTranscriptBlanks(request) {
    if (!request?.player || typeof request.text !== "string") return;
    if (request.npcId !== VEOS_NPC_ID && request.npcId !== VEOS_POST_QUEST_NPC_ID) return;
    if (request.text === "Sounds good, what should I do?" && quest.getStage(request.player) === 0) request.before = () => {
      request.player.setAttribute(ACCEPTED_ATTRIBUTE, 1);
      request.player.getPacketSender().sendVarbit(VARBIT_X_MARKS, 1);
      request.player.sendMessage("You've started a new quest: <col=081190>X Marks the Spot</col>");
    };
    if (request.text.startsWith("Take this scroll.") && quest.getStage(request.player) === 0) request.before = () => giveStartScroll(request.player);
    if (request.text.startsWith("You'll probably want a spade")) request.text = "You'll probably want a spade, I find they're pretty much always needed when it comes to hunting treasure. Check the general store if you don't have one.";
    let text = request.text;
    if (text.includes("[player name]")) {
      text = text.replace(/\[player name\]/gi, String(request.player.getUsername()));
    }
    if (text.includes("[scroll/orb]")) {
      text = text.replace(
        /\[scroll\/orb\]/gi,
        lostItemId(request.player) === MYSTERIOUS_ORB ? "orb" : "scroll"
      );
    }
    if (text !== request.text) request.text = text;
  }

  // ==========================================================================
  // Interactions
  // ==========================================================================

  /** Spade right-click Dig on the four wiki spots. */
  function handleDig(event) {
    if (event.itemId !== SPADE) return false;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_FIRST_CLUE || quest.isComplete(player)) return false;

    const spot = DIG_SPOTS.get(stage);
    if (spot && onTile(player, spot) && held(player, CLUE_ITEM_BY_STAGE.get(stage))) {
      event.handled = true;
      player.performAnimation(new Animation(DIG_ANIMATION));
      player.getInventory().deleteNumber(CLUE_ITEM_BY_STAGE.get(stage), 1);
      if (stage < STAGE_FOURTH_CLUE) {
        player.getInventory().adds(CLUE_ITEM_BY_STAGE.get(stage + 1), 1);
        quest.setStage(player, stage + 1);
        ensureVeos(player);
        player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, CLUE_ITEM_BY_STAGE.get(stage + 1), stage === STAGE_SECOND_CLUE ? "You dig up a Mysterious Orb." : "You dig up a Treasure Scroll.")));
        return true;
      }
      player.getInventory().adds(ANCIENT_CASKET, 1);
      quest.setStage(player, STAGE_CASKET);
      ensureVeos(player);
      startTranscript(api, player, VEOS_NPC_ID, PAGE, LAST_DIG_VARIANT);
      return true;
    }
    // Lost casket: dig the pig pen again.
    if (stage === STAGE_CASKET && onTile(player, CASKET_DIG_SPOT) && !held(player, ANCIENT_CASKET)) {
      event.handled = true;
      player.performAnimation(new Animation(DIG_ANIMATION));
      if (player.getInventory().isFull()) { player.sendMessage("You need more inventory space."); return true; }
      player.getInventory().adds(ANCIENT_CASKET, 1);
      startTranscript(api, player, VEOS_NPC_ID, PAGE, LAST_DIG_VARIANT);
      return true;
    }
    return false;
  }

  function claimDig(event) {
    if (event.itemId === SPADE && /dig/i.test(String(event.option)) && handleDig(event)) event.allow = false;
  }

  function handleReadScroll(event) {
    if (![TREASURE_SCROLL_1, TREASURE_SCROLL_2, TREASURE_SCROLL_3].includes(event.itemId) || !held(event.player, event.itemId)) return false;
    const sender = event.player.getPacketSender();
    if (event.itemId === TREASURE_SCROLL_2) sender.sendInterface(MAP_INTERFACE);
    else {
      sender.sendInterface(CLUE_TEXT_INTERFACE);
      sender.sendString(event.itemId === TREASURE_SCROLL_1 ? FIRST_CLUE_TEXT : `The cipher reveals<br>where to dig next:<br><br>${CIPHER_TEXT}`, (CLUE_TEXT_INTERFACE << 16) | 2);
    }
    return true;
  }

  function closeMap({ player }) {
    player.getPacketSender().sendInterfaceRemoval();
  }

  function feelOrb({ player, itemId }) {
    if (itemId !== MYSTERIOUS_ORB || !held(player, MYSTERIOUS_ORB)) return false;
    const location = player.getLocation(), target = DIG_SPOTS.get(STAGE_THIRD_CLUE);
    const distance = Math.max(Math.abs(location.getX() - target.x), Math.abs(location.getY() - target.y));
    const previous = Number(player.getAttribute(PREVIOUS_DISTANCE_ATTRIBUTE)) || 0;
    const previousCoord = Number(player.getAttribute(PREVIOUS_COORD_ATTRIBUTE)) || -1;
    const coord = location.getZ() << 28 | location.getX() << 14 | location.getY();
    // shortcut: unobserved category boundaries follow the standard orb bands; verify with boundary captures.
    const temperature = distance <= 4 ? "incredibly hot" : distance <= 25 ? "very hot" : distance <= 50 ? "hot" : distance <= 90 ? "warm" : distance <= 150 ? "cold" : distance <= 500 ? "very cold" : "incredibly cold";
    const comparison = previousCoord === -1 ? "" : distance < previous ? ", and warmer than last time" : distance > previous ? ", but colder than last time" : ", and the same temperature as last time";
    player.sendMessage(`The orb is ${temperature}${comparison}.`);
    player.setAttribute(PREVIOUS_DISTANCE_ATTRIBUTE, distance);
    player.setAttribute(PREVIOUS_COORD_ATTRIBUTE, coord);
    player.getPacketSender().sendVarbit(PREVIOUS_DISTANCE_VARBIT, distance).sendConfig(PREVIOUS_COORD_VARP, coord).sendClientScript(HOT_COLD_SCRIPT, coord, previousCoord, distance, previous);
    return true;
  }

  function resumeHandIn(event) {
    const { player, npcId } = event;
    if (![VEOS_NPC_ID, VEOS_POST_QUEST_NPC_ID].includes(npcId) || quest.getStage(player) !== STAGE_CASKET || !player.getAttribute(HANDED_CASKET_ATTRIBUTE)) return;
    event.handled = true;
    startTranscript(api, player, npcId, PAGE, "finishing-up", (steps) => steps.slice(6));
  }

  function handleOpenCasket(event) {
    if (event.itemId !== ANCIENT_CASKET) return false;
    const { player } = event;
    if (quest.getStage(player) < STAGE_CASKET || quest.isComplete(player)) return false;
    startTranscript(api, player, VEOS_NPC_ID, PAGE, CASKET_REFUSAL_VARIANT);
    return true;
  }

  /** The quest lamp (23072) rubs through the shared xpreward interface. */
  function handleLampRub(event) {
    if (event.itemId !== ANTIQUE_LAMP) return false;
    const { player, item, slot } = event;
    if (!held(player, ANTIQUE_LAMP) || player.getAttribute(LAMP_USED_ATTRIBUTE)) return false;
    lampPending.set(player, { item, slot });
    api.emitCustomEvent("xpreward:open", {
      player,
      title: "Choose the stat you wish to be advanced!",
      onConfirm: (skill, name) => confirmLamp(player, item, slot, skill, name),
    });
    return true;
  }

  function confirmLamp(player, item, slot, skill, name) {
    if (lampPending.get(player)?.item !== item) return null;
    lampPending.delete(player);
    const inventory = player.getInventory();
    if (inventory.get(slot) !== item) return null;
    const manager = player.getSkillManager();
    const before = manager.getExperience(skill);
    manager.addExperience(skill, LAMP_XP, false);
    if (manager.getExperience(skill) === before) return null;
    inventory.deleteAtSlot(slot, 1);
    player.setAttribute(LAMP_USED_ATTRIBUTE, 1);
    player.getPacketSender().sendVarbit(LAMP_REWARD_VARBIT, 1);
    return `<col=0000ff>Your wish has been granted!</col> You have been awarded ${LAMP_XP} ${name ?? skill.getName()} experience!`;
  }

  // ==========================================================================
  // Login / logout / journal / rewards
  // ==========================================================================

  function handleLogin({ player }) {
    ensureVeos(player);
    if (quest.getStage(player) >= STAGE_COMPLETE) {
      mirrorLampState(player);
      syncClueBoxState(player);
    }
    refreshQuestList(player);
    player.getPacketSender().sendVarbit(PREVIOUS_DISTANCE_VARBIT, Number(player.getAttribute(PREVIOUS_DISTANCE_ATTRIBUTE)) || 0).sendConfig(PREVIOUS_COORD_VARP, Number(player.getAttribute(PREVIOUS_COORD_ATTRIBUTE)) || -1);
  }

  function handleLogout({ player }) {
    endings.delete(player);
    lampPending.delete(player);
  }

  function completedScrollClosed({ player, interfaceId }) {
    if (interfaceId !== 153 || !endings.has(player)) return;
    endings.delete(player);
    startTranscript(api, player, VEOS_POST_QUEST_NPC_ID, PAGE, "finishing-up", (steps) => steps.slice(12,15));
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I met Veos in The Sheared Ram and agreed to help him</str>",
        "<str>hunt for treasure.</str>",
        "",
        "<str>I followed the treasure scroll's clues and dug up the</str>",
        "<str>ancient casket, then gave it to Veos at Port Sarim.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_CASKET) {
      return [
        "<str>I met Veos in The Sheared Ram and agreed to help him</str>",
        "<str>hunt for treasure.</str>",
        "",
        "<str>I followed the treasure scroll's clues and dug up the</str>",
        "<str>ancient casket.</str>",
        "",
        "I should take the <col=800000>ancient casket</col> to <col=800000>Veos</col> at",
        "the northernmost pier in <col=800000>Port Sarim</col>.",
      ];
    }
    if (stage >= STAGE_FIRST_CLUE) {
      const lines = [
        "<str>I met Veos in The Sheared Ram and agreed to help him</str>",
        "<str>hunt for treasure.</str>",
        "",
      ];
      if (stage === STAGE_FIRST_CLUE) {
        lines.push(
          "The first clue says to dig north of the north-westernmost",
          "window of the house attached to <col=800000>Bob's Brilliant Axes</col>."
        );
      } else if (stage === STAGE_SECOND_CLUE) {
        lines.push(
          "The second clue is a map. I should dig behind",
          "<col=800000>Lumbridge Castle</col>, south-west of the kitchen's",
          "large crate."
        );
      } else if (stage === STAGE_THIRD_CLUE) {
        lines.push(
          "The mysterious orb shows how close the next clue is.",
          "The clue is <col=800000>east of Draynor Village</col>, north-west",
          "of the jail and four steps north of the bush near Leela."
        );
      } else {
        lines.push(
          "The cipher reads <col=800000>ESBZOPS QJH QFO</col>, which means",
          "<col=800000>DRAYNOR PIG PEN</col>. I should dig in the centre of",
          "the pig pen north of Draynor market."
        );
      }
      return lines;
    }
    return [
      "I can start this quest by speaking to <col=800000>Veos</col> in",
      "<col=800000>The Sheared Ram</col> in Lumbridge.",
      "",
      "There aren't any requirements for this quest.",
    ];
  }

  function grantReward(player) {
    player.getPacketSender().sendVarbit(COIN_REWARD_VARBIT, 1);
    player.getInventory().adds(COINS, 200);
    if (!ownsItem(player, ANTIQUE_LAMP)) player.getInventory().adds(ANTIQUE_LAMP, 1);
    settleClueBox(player);
  }

  api.persistAttribute(AWAITING_SCROLL_ATTRIBUTE, 0);
  api.persistAttribute(ACCEPTED_ATTRIBUTE, 0);
  api.persistAttribute(HANDED_CASKET_ATTRIBUTE, 0);
  api.persistAttribute(PREVIOUS_DISTANCE_ATTRIBUTE, 0);
  api.persistAttribute(PREVIOUS_COORD_ATTRIBUTE, -1);
  api.persistAttribute(LAMP_USED_ATTRIBUTE, 0);
  api.persistAttribute(CLUE_BOX_STATE_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "x_marks_the_spot",
    name: "X Marks the Spot",
    varpId: VARP_X_MARKS,
    varbitId: VARBIT_X_MARKS,
    varpValue: wireStage,
    startedValue: STAGE_FIRST_CLUE,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    scrollItemId: ANCIENT_CASKET,
    completionJingleId: 154,
    otherRewards: ["An Antique Lamp", "200 Coins", "Ability to receive Clue Scroll", "Boxes", "A Beginner Clue Scroll Box"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcInteraction(resumeHandIn);
  api.onNpcInteraction(handleVeosTalk);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", fillTranscriptBlanks);
  api.onCustomEvent("interface:closed", completedScrollClosed);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCanUseItem(claimDig);
  api.onItemAction("Treasure scroll", { Read: handleReadScroll });
  api.onItemAction("Mysterious orb", { Feel: feelOrb });
  api.onInterfaceActionButton((MAP_INTERFACE << 16) | 6, closeMap);
  api.onItemAction("Ancient casket", { Open: handleOpenCasket });
  api.onItemAction("Antique lamp", { Rub: handleLampRub });
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
