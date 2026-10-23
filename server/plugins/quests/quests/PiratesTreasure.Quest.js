/** Pirate's Treasure. Capture evidence: docs/f2p-coastal-parity.md. */
module.exports = function registerPiratesTreasureQuest(api) {
  const { Equipment, Location, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers, GameObject, Animation, Task, TaskManager, CountdownTask, TemplatedInstanceArea, StatementDialogue } = api.core;
  const { registerQuest, startTranscript } = require("../QuestRuntime");

  const FRANK_NPC_ID = NpcIdentifiers.REDBEARD_FRANK;
  const WYDIN_NPC_ID = NpcIdentifiers.WYDIN;
  const LUTHAS_NPC_ID = NpcIdentifiers.LUTHAS;
  const BARTENDER_NPC_ID = NpcIdentifiers.BARTENDER_6;
  const GARDENER_NPC_ID = NpcIdentifiers.GARDENER_3;
  const CUSTOMS_OFFICER_IDS = new Set([
    NpcIdentifiers.CUSTOMS_OFFICER,
    NpcIdentifiers.CUSTOMS_OFFICER_2,
  ]);

  const VARP_PIRATES_TREASURE = 71;
  const STAGE_STARTED = 1;
  const STAGE_KEY = 2;
  const STAGE_NOTE = 3;
  const STAGE_COMPLETE = 4;

  const RUM_ITEM_ID = ItemIdentifiers.KARAMJAN_RUM;
  const KEY_ITEM_ID = ItemIdentifiers.CHEST_KEY;
  const MESSAGE_ITEM_ID = ItemIdentifiers.PIRATE_MESSAGE;
  const CASKET_ITEM_ID = ItemIdentifiers.CASKET_3;
  const NOTE_INTERFACE = 222;
  const BANANA_ITEM_ID = ItemIdentifiers.BANANA;
  const APRON_ITEM_ID = ItemIdentifiers.WHITE_APRON;
  const SPADE_ITEM_ID = ItemIdentifiers.SPADE;
  const COINS_ITEM_ID = ItemIdentifiers.COINS;
  const RING_ITEM_ID = ItemIdentifiers.GOLD_RING;
  const EMERALD_ITEM_ID = ItemIdentifiers.EMERALD;

  const PLANTATION_CRATE_ID = ObjectIdentifiers.CRATE_15;
  const STORE_CRATE_ID = ObjectIdentifiers.CRATE_14;
  const STOCK_ROOM_DOOR_ID = ObjectIdentifiers.DOOR_56;
  const CHEST_ID = ObjectIdentifiers.CHEST_4;
  const OPEN_CHEST_ID = 2080; // piratechestopen, cache241/capture.
  const CHEST_TILE = new Location(3219, 3396, 1);
  const CHEST_OPEN_SOUND = 52;
  const TREASURE_TILE = { x: 2999, y: 3383, z: 0 };
  const GARDENER_TILE = { x: 2997, y: 3382, z: 0 };
  const STOCK_ROOM_DOOR_TILE = { x: 3012, y: 3204 };
  const STORE_CRATE_TILE = { x: 3009, y: 3207 };
  // The ship's deck at each end (rsprox captures 1434, 1653); the gangplank leads ashore.
  const PORT_SARIM_LANDING = new Location(3032, 3217, 1);
  const MUSA_POINT_LANDING = new Location(2956, 3143, 1);
  /** The voyage, as captured: the ship at sea (map chunk 3064,3208 plane 1) under ship_journey. */
  const SHIP_AT_SEA_CHUNK = { sourceChunkX: 3064 >> 3, sourceChunkY: 3208 >> 3, sourcePlane: 1, rotation: 0 };
  const SHIP_JOURNEY_INTERFACE = 299;
  const SHIP_JOURNEY_SCRIPT = 1131;
  const TO_KARAMJA_ROUTE = 4;
  const TO_PORT_SARIM_ROUTE = 5;
  const SHIP_JOURNEY_TICKS = 9;
  const SEA_SONG = 147;
  const SAILING_JINGLE = 172;
  const TOPLEVEL = 161;
  /** Side tabs the voyage closes (combat to magic, logout to music), with the group each gets back. */
  const VOYAGE_TABS = [[77, 320], [78, 629], [79, 149], [80, 387], [86, 182], [87, 116], [88, 216], [89, 239]];
  const COMBAT_TAB = 76;
  const PRAYER_TAB = 81;
  const MAGIC_TAB = 82;
  const PANDEMONIUM_LANDING = new Location(3069, 2987, 0); // Pandemonium.Quest.js landing tile.
  const FARE = 30;
  const GARDENER_SHOUT = "First moles, now this! Take this, vandal!";

  const EMPLOYMENT_ATTRIBUTE = "pirates-treasure.employment";
  const BANANA_ATTRIBUTE = "pirates-treasure.bananas";
  const RUM_ATTRIBUTE = "pirates-treasure.rum";
  const DUG_ATTRIBUTE = "pirates-treasure.dug";

  const START_HOOK = "quest:pirate-s-treasure:start";
  const EMPLOYMENT_CHOICE = "Could you offer me employment on your plantation?";
  /** "If the player has a white apron:" - the branch that hires the player. */
  const WYDIN_HIRE_CONDITION_ID = "06RiCk";
  /** "If the player has enough coins:" under the bartender's rum option. */
  const BARTENDER_RUM_COINS_ID = "HEeY2G";
  /** "The customs officer confiscates your rum." (three pages). */
  const RUM_CONFISCATE_STEP_IDS = new Set(["JN4f2Q", "pUSUQY", "et2BjU", "CO6KKg", "pNZxTm"]);
  /** "30 coins" actions on the two Luthas payment pages. */
  const PAYMENT_STEP_IDS = new Set(["76-Dox", "1YHx0E"]);
  const RECLAIM_KEY_STEP_ID = "0m95Tl";
  /** "Frank happily takes the rum... and hands you a key." */
  const RUM_HANDIN_STEP_ID = "Uy0FFQ";
  /** Seamen/Tobias "The player is transported to Karamja." action steps. */
  const SAIL_TO_KARAMJA_STEP_IDS = new Set(["0dBZni", "ZZHN0-", "oJnbxR", "aCDRxJ"]);
  /** Tobias's after-Pandemonium "The player is then transported to the Pandemonium." step. */
  const SAIL_TO_PANDEMONIUM_STEP_ID = "yrFrGT";
  /** Their "If the player does not have enough coins" conditions. */
  const SAIL_FARE_CONDITION_IDS = new Set(["4EHa7z", "PWA2Z3", "FUAwJK"]);
  /** Customs officer payment steps: fare 30, 15 with Karamja gloves, free with Charos. */
  const SAIL_BACK_FARES = new Map([
    ["QF4lwJ", 30],
    ["ThyZB7", 15],
    ["upG45P", 0],
  ]);

  let quest;
  /** The stock-room door click's tile, captured before the walk lands on the door. */
  const doorOrigins = new WeakMap();
  /** The gardener each player's last dig spawned; a WeakMap so a lost NPC never sticks. */
  const gardenerByPlayer = new WeakMap();
  const digging = new WeakSet();
  const sailing = new WeakSet();
  const openingChests = new WeakMap();

  const attr = (player, key) => Number(player.getAttribute(key)) || 0;
  const setAttr = (player, key, value) => player.setAttribute(key, value);
  const hasItem = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const isEmployed = (player, bit) => (attr(player, EMPLOYMENT_ATTRIBUTE) & bit) !== 0;
  const hasApron = (player) => hasItem(player, APRON_ITEM_ID) || wearingApron(player);
  const wearingApron = (player) =>
    player.getEquipment().get(Equipment.BODY_SLOT)?.getId?.() === APRON_ITEM_ID;

  function giveItem(player, itemId, message) {
    if (hasItem(player, itemId)) return true;
    if (player.getInventory().isFull()) {
      player.sendMessage("You need more inventory space.");
      return false;
    }
    player.getInventory().adds(itemId, 1);
    if (message) player.sendMessage(message);
    return true;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I found Redbeard Frank's buried treasure.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage === STAGE_NOTE) {
      return [
        "The pirate message points to an <col=800000>X in Falador Park</col>.",
        "I should bring a <col=800000>spade</col>.",
      ];
    }
    if (stage === STAGE_KEY) {
      return [
        "Frank gave me a key for a chest upstairs in",
        "the <col=800000>Blue Moon Inn in Varrock</col>.",
      ];
    }
    if (stage === STAGE_STARTED) {
      return [
        "I must smuggle <col=800000>Karamjan rum</col> to Redbeard Frank.",
        "Luthas's banana crate is shipped to Wydin's shop.",
      ];
    }
    return [
      "I can start this quest by speaking to",
      "<col=800000>Redbeard Frank</col> at Port Sarim.",
    ];
  }


  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);

    if (npcId === FRANK_NPC_ID) {
      if (stage >= STAGE_COMPLETE) {
        return { page: "Redbeard Frank", variant: "after-pirate-s-treasure" };
      }
      if (stage === STAGE_KEY) {
        if (hasItem(player, KEY_ITEM_ID) || hasItem(player, MESSAGE_ITEM_ID)) return null;
        return { page: "Pirate's Treasure", variant: "delivering-the-rum-reclaiming-the-key" };
      }
      if (stage === STAGE_NOTE) return null;
      if (stage === STAGE_STARTED) {
        return hasItem(player, RUM_ITEM_ID)
          ? { page: "Pirate's Treasure", variant: "delivering-the-rum-talking-to-redbeard-frank" }
          : { page: "Pirate's Treasure", variant: "getting-started-talking-to-redbeard-frank-again" };
      }
      return { page: "Pirate's Treasure", variant: "getting-started-talking-to-redbeard-frank" };
    }

    if (npcId === WYDIN_NPC_ID) {
      if (isEmployed(player, 2)) {
        return { page: "Pirate's Treasure", variant: "retrieving-the-rum-talking-to-wydin-after-getting-the-job" };
      }
      if (stage >= STAGE_STARTED) {
        return { page: "Pirate's Treasure", variant: "retrieving-the-rum-talking-to-wydin" };
      }
      return null;
    }

    if (npcId === LUTHAS_NPC_ID) {
      if (isEmployed(player, 1)) {
        return attr(player, BANANA_ATTRIBUTE) >= 10
          ? { page: "Pirate's Treasure", variant: "visiting-karamja-talking-to-luthas-after-filling-up-the-crate" }
          : { page: "Luthas", variant: "standard-dialogue-after-accepting-his-task" };
      }
      if (stage >= STAGE_STARTED) {
        return { page: "Pirate's Treasure", variant: "visiting-karamja-talking-to-luthas" };
      }
      return null;
    }

    if (CUSTOMS_OFFICER_IDS.has(npcId)) {
      return stage >= STAGE_COMPLETE
        ? { page: "Customs officer", variant: "standard-dialogue-after-completing-pirate-s-treasure" }
        : { page: "Customs officer", variant: "standard-dialogue-before-completing-pirate-s-treasure" };
    }

    return null;
  }

  function answerCondition({ npcId, player, text, stepId }) {
    const value = String(text).toLowerCase();

    if (npcId === FRANK_NPC_ID) {
      if (stepId === "6py1j9" || stepId === "WbtA4m" || value.includes("completed rum deal")) return false;
      if (stepId === "I3U8bt" || value.includes("does not have the rum")) return !hasItem(player, RUM_ITEM_ID);
    }

    if (npcId === WYDIN_NPC_ID) {
      if (value.includes("white apron is not equipped")) return !wearingApron(player);
      if (value.includes("does not have a white apron")) return !hasApron(player);
      if (value.includes("has a white apron")) return hasApron(player);
    }

    if (CUSTOMS_OFFICER_IDS.has(npcId)) {
      if (value.includes("does not have karamjan rum")) return !hasItem(player, RUM_ITEM_ID);
      if (value.includes("has karamjan rum")) return hasItem(player, RUM_ITEM_ID);
      if (stepId === "l2iXlt" || stepId === "o99Ow0" || value.includes("does not have enough coins")) {
        return player.getInventory().getAmount(COINS_ITEM_ID) < 30;
      }
      if (stepId === "GGmLiT" || value.includes("has 30 coins")) {
        return player.getInventory().getAmount(COINS_ITEM_ID) >= 30;
      }
      if (value.includes("karamja gloves") || value.includes("ring of charos")) return false;
    }

    if (SAIL_FARE_CONDITION_IDS.has(stepId)) {
      return player.getInventory().getAmount(COINS_ITEM_ID) < FARE;
    }

    if (npcId === BARTENDER_NPC_ID) {
      const coins = player.getInventory().getAmount(COINS_ITEM_ID);
      if (stepId === BARTENDER_RUM_COINS_ID) return coins >= 27;
      if (stepId === "MPrKD-") return coins < 27;
      if (stepId === "ruDy4d") return coins >= 3;
      if (stepId === "CYuhhY") return coins < 3;
    }

    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== FRANK_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) >= STAGE_STARTED) return;
    quest.setStage(player, STAGE_STARTED);
  }

  function handleChoice({ player, npcId, option }) {
    if (npcId === LUTHAS_NPC_ID && option === EMPLOYMENT_CHOICE) {
      setAttr(player, EMPLOYMENT_ATTRIBUTE, attr(player, EMPLOYMENT_ATTRIBUTE) | 1);
    }
  }

  function handleConditionMet({ player, npcId, stepId }) {
    if (npcId === WYDIN_NPC_ID && stepId === WYDIN_HIRE_CONDITION_ID) {
      setAttr(player, EMPLOYMENT_ATTRIBUTE, attr(player, EMPLOYMENT_ATTRIBUTE) | 2);
    }
    if (npcId === BARTENDER_NPC_ID && stepId === BARTENDER_RUM_COINS_ID) {
      buyRum(player);
    }
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (npcId === WYDIN_NPC_ID && stepId === "2MkvlZ") {
      event.handled = true;
      startTranscript(api, player, WYDIN_NPC_ID, "Pirate's Treasure", "retrieving-the-rum-talking-to-wydin", (steps) => steps[1].options[3].steps);
      return;
    }
    if (npcId === FRANK_NPC_ID && stepId === RUM_HANDIN_STEP_ID) {
      event.box = { items: [RUM_ITEM_ID, KEY_ITEM_ID] };
      if (quest.getStage(player) === STAGE_STARTED && hasItem(player, RUM_ITEM_ID)) {
        player.getInventory().deleteNumber(RUM_ITEM_ID, 1);
        giveItem(player, KEY_ITEM_ID);
        quest.setStage(player, STAGE_KEY);
      }
      return;
    }
    if (npcId === FRANK_NPC_ID && stepId === RECLAIM_KEY_STEP_ID) {
      giveItem(player, KEY_ITEM_ID);
      event.handled = true;
      return;
    }
    if (npcId === LUTHAS_NPC_ID && PAYMENT_STEP_IDS.has(stepId)) {
      payForBananas(player);
      event.handled = true;
      return;
    }
    if (CUSTOMS_OFFICER_IDS.has(npcId) && RUM_CONFISCATE_STEP_IDS.has(stepId)) {
      if (event.text) player.sendMessage(String(event.text));
      if (hasItem(player, RUM_ITEM_ID)) player.getInventory().deleteNumber(RUM_ITEM_ID, 1);
      setAttr(player, RUM_ATTRIBUTE, 0);
      event.handled = true;
      return;
    }
    if (SAIL_TO_KARAMJA_STEP_IDS.has(stepId)) {
      sailToKaramja(player);
      event.handled = true;
      return;
    }
    if (stepId === SAIL_TO_PANDEMONIUM_STEP_ID) {
      sailToPandemonium(player);
      event.handled = true;
      return;
    }
    const returnFare = SAIL_BACK_FARES.get(stepId);
    if (returnFare !== undefined) {
      sailToPortSarim(player, returnFare);
      event.handled = true;
    }
  }

  function handleItemOnNpc(event) {
    if (event.itemId !== RUM_ITEM_ID) return;
    if ((event.npcId ?? event.target?.getId?.()) !== FRANK_NPC_ID) return;
    const { player } = event;
    if (quest.getStage(player) !== STAGE_STARTED || !hasItem(player, RUM_ITEM_ID)) return;
    startTranscript(api, player, FRANK_NPC_ID, "Pirate's Treasure", "delivering-the-rum-talking-to-redbeard-frank");
    event.handled = true;
  }

  function handleItemOnObject(event) {
    const { objectId, itemId } = event;
    if (objectId === PLANTATION_CRATE_ID && itemId === BANANA_ITEM_ID) {
      packBanana(event.player);
      event.handled = true;
      return;
    }
    if (objectId === PLANTATION_CRATE_ID && itemId === RUM_ITEM_ID) {
      stashRum(event.player);
      event.handled = true;
      return;
    }
    if (objectId === CHEST_ID && itemId === KEY_ITEM_ID) {
      unlockChest(event.player);
      event.handled = true;
    }
  }

  function handleObjectInteraction(event) {
    const option = String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "").toLowerCase();
    const { player, objectId } = event;

    if (objectId === PLANTATION_CRATE_ID) {
      if (option.includes("search")) {
        searchPlantationCrate(player);
        event.handled = true;
      } else if (option.includes("fill")) {
        fillCrate(player);
        event.handled = true;
      }
      return;
    }
    if (objectId === STORE_CRATE_ID && option.includes("search")) {
      searchStoreCrate(player);
      event.handled = true;
      return;
    }
    if (objectId === STOCK_ROOM_DOOR_ID && option.includes("open")) {
      useStockRoomDoor(player, event.location);
      event.handled = true;
      return;
    }
    if (objectId === CHEST_ID && option.includes("open")) {
      player.sendMessage(
        "The chest is locked.",
      );
      event.handled = true;
    }
  }

  function handleItemAction(event) {
    const option = String(event.option ?? "").toLowerCase();
    const { player } = event;
    if (!hasItem(player, event.itemId)) return;
    if (event.itemId === MESSAGE_ITEM_ID && option === "read") {
      if (quest.getStage(player) === STAGE_KEY) quest.setStage(player, STAGE_NOTE);
      const packet = player.getPacketSender();
      packet.sendInterface(NOTE_INTERFACE);
      for (let child = 1; child <= 11; child++) packet.sendString(child === 5
        ? "Visit the city of the White Knights. In the park," : child === 6
          ? "Saradomin points to the X which marks the spot." : "", (NOTE_INTERFACE << 16) | child);
      event.handled = true;
    }
    if (event.itemId === CASKET_ITEM_ID && option === "open") {
      const needed = hasItem(player, COINS_ITEM_ID) ? 2 : 3;
      if (player.getInventory().getFreeSlots() + 1 < needed) {
        player.sendMessage("You need more inventory space.");
      } else {
        player.getInventory().deleteNumber(CASKET_ITEM_ID, 1);
        player.getInventory().adds(COINS_ITEM_ID, 450);
        player.getInventory().adds(RING_ITEM_ID, 1);
        player.getInventory().adds(EMERALD_ITEM_ID, 1);
        player.sendMessage("You open the casket, and find One-Eyed Hector's treasure.");
      }
      event.handled = true;
    }
  }

  /**
   * Barrows registers its Spade "Dig" hook before this quest's item-action hook and
   * always swallows the click, so the treasure dig is resolved from the can-use
   * gate, which runs before any item-action hook.
   */
  function handleCanUseItem(event) {
    if (event.itemId !== SPADE_ITEM_ID || !/dig/i.test(String(event.option ?? ""))) return;
    if (!digForTreasure(event.player)) return;
    event.allow = false;
  }

  quest = registerQuest(api, {
    key: "pirates_treasure",
    name: "Pirate's Treasure",
    varpId: VARP_PIRATES_TREASURE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    rewardItemId: CASKET_ITEM_ID,
    scrollItemId: CASKET_ITEM_ID,
    completionJingleId: 153,
    rewardItemLabel: "One-Eyed Hector's Treasure",
    buildJournal,
  });

  api.persistAttribute(EMPLOYMENT_ATTRIBUTE);
  api.persistAttribute(BANANA_ATTRIBUTE);
  api.persistAttribute(RUM_ATTRIBUTE);
  api.persistAttribute(DUG_ATTRIBUTE);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:condition", handleConditionMet);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnObject(handleItemOnObject);
  api.onObjectInteraction(handleObjectInteraction);
  api.onObjectRoute(handleObjectRoute);
  api.onItemAction(handleItemAction);
  api.onCanUseItem(handleCanUseItem);
  // After Pandemonium (varbit 18314) the boats' Travel becomes "Musa Point" and "The Pandemonium".
  api.onNpcsInteraction(["Seaman Thresnor", "Seaman Lorris", "Captain Tobias"], {
    Travel: travelToKaramja, "Musa Point": travelToKaramja, "The Pandemonium": travelToPandemonium,
  });
  api.onNpcInteraction("Customs officer", {
    Travel: travelToPortSarim, "Port Sarim": travelToPortSarim, "The Pandemonium": travelFromKaramjaToPandemonium,
  });
  api.onPlayerLogout(cleanupGardener);
  function buyRum(player) {
    const inventory = player.getInventory();
    if (inventory.getAmount(COINS_ITEM_ID) < 27) return;
    if (!giveItem(player, RUM_ITEM_ID, "You buy a bottle of rum.")) return;
    inventory.deleteNumber(COINS_ITEM_ID, 27);
  }

  /** Takes `fare` coins, or reports the shortfall so the caller can refuse passage. */
  function payFare(player, fare) {
    if (fare <= 0) return true;
    const inventory = player.getInventory();
    if (inventory.getAmount(COINS_ITEM_ID) < fare) return false;
    inventory.deleteNumber(COINS_ITEM_ID, fare);
    return true;
  }

  function sailToKaramja(player) {
    if (sailing.has(player)) return;
    if (!payFare(player, FARE)) {
      player.sendMessage("You don't have enough coins to pay for passage.");
      return;
    }
    voyage(player, MUSA_POINT_LANDING, TO_KARAMJA_ROUTE, "The ship arrives at Karamja.", FARE);
  }

  function sailToPortSarim(player, fare = FARE) {
    if (sailing.has(player)) return false;
    if (!payFare(player, fare)) {
      player.sendMessage(`You do not have enough coins to pay passage, you need ${fare}.`);
      return false;
    }
    voyage(player, PORT_SARIM_LANDING, TO_PORT_SARIM_ROUTE, "The ship arrives at Port Sarim.", fare);
    return true;
  }

  function sailToPandemonium(player) {
    if (sailing.has(player)) return;
    if (!payFare(player, FARE)) {
      player.sendMessage("You don't have enough coins to pay for passage.");
      return;
    }
    sail(player, PANDEMONIUM_LANDING, "the Pandemonium", FARE);
  }

  function travelToKaramja({ player }) {
    sailToKaramja(player);
  }

  function travelToPandemonium({ player }) {
    sailToPandemonium(player);
  }

  /** The customs officer searches anyone leaving Karamja with rum mid-quest. */
  function searchedForRum({ player, npc }) {
    if (!hasItem(player, RUM_ITEM_ID) || quest.getStage(player) >= STAGE_COMPLETE) return false;
    startTranscript(api, player, npc?.getId?.() || NpcIdentifiers.CUSTOMS_OFFICER, "Customs officer", "standard-dialogue-before-completing-pirate-s-treasure");
    return true;
  }

  function travelToPortSarim(event) {
    if (!searchedForRum(event)) sailToPortSarim(event.player);
  }

  function travelFromKaramjaToPandemonium(event) {
    if (!searchedForRum(event)) sailToPandemonium(event.player);
  }

  function sail(player, destination, port, fare) {
    sailing.add(player);
    if (fare > 0) player.sendMessage(`You pay the boarding charge of ${fare} coins.`);
    player.sendMessage(`You board the ship and sail to ${port}.`);
    const task = new Task(5, player, false);
    task.execute = () => {
      task.stop(); sailing.delete(player);
      if (player.isRegistered?.() !== false) player.moveTo(destination);
    };
    TaskManager.submit(task);
  }

  /** The ship at sea: one chunk, the player alone on it until the ship arrives. */
  class ShipAtSea extends TemplatedInstanceArea {
    constructor(player, destination) {
      super(1, 1);
      this.owner = player;
      this.destination = destination;
      this.setChunk(0, 0, 0, SHIP_AT_SEA_CHUNK);
    }
    canTeleport() { return false; }
    canAttack() { return false; }
    postLeave(mobile, logout) {
      if (mobile === this.owner) {
        TaskManager.cancelTasks(this);
        if (sailing.has(mobile)) arrive(mobile, this, logout);
      }
      super.postLeave(mobile, logout);
    }
  }

  /** As captured: pay, the ship at sea under ship_journey with the side tabs closed, then the deck nine ticks later. */
  function voyage(player, destination, route, arrival, fare) {
    sailing.add(player);
    if (fare > 0) player.sendMessage(`You pay ${fare} coins and board the ship.`);
    const ship = new ShipAtSea(player, destination);
    player.getDialogueManager().reset();
    player.getMovementQueue().reset().setBlockMovement(true);
    player.setUntargetable(true);
    player.moveTo(ship.tile(0, 0, 0));
    ship.enter(player);
    const sender = player.getPacketSender();
    sender.sendSong(SEA_SONG).sendJingle(SAILING_JINGLE, 0)
      .sendInterface(SHIP_JOURNEY_INTERFACE).sendClientScript(SHIP_JOURNEY_SCRIPT, route);
    for (const slot of [COMBAT_TAB, PRAYER_TAB, MAGIC_TAB, ...VOYAGE_TABS.map(([tab]) => tab)]) {
      sender.closeSubInterface((TOPLEVEL << 16) | slot);
    }
    TaskManager.submit(new CountdownTask(ship, SHIP_JOURNEY_TICKS, () => {
      arrive(player, ship, false);
      ship.leave(player, false);
      StatementDialogue.send(player, arrival);
    }));
  }

  function arrive(player, ship, logout) {
    sailing.delete(player);
    player.moveTo(ship.destination);
    player.getMovementQueue().setBlockMovement(false);
    player.setUntargetable(false);
    if (logout) return;
    const sender = player.getPacketSender();
    sender.sendTabInterface(0, 593);
    sender.sendTabInterface(5, 541);
    sender.sendTabInterface(6, player.getSpellbook().getInterfaceId());
    for (const [slot, group] of VOYAGE_TABS) sender.sendTabInterface(slot, group);
    player.getInventory().refreshItems();
    player.getEquipment().refreshItems();
    sender.sendInterfaceRemoval();
  }

  function payForBananas(player) {
    if (attr(player, BANANA_ATTRIBUTE) < 10) return;
    player.getInventory().adds(COINS_ITEM_ID, 30);
    setAttr(player, BANANA_ATTRIBUTE, 0);
    if (attr(player, RUM_ATTRIBUTE) === 1) setAttr(player, RUM_ATTRIBUTE, 2);
  }

  function packBanana(player) {
    const stored = attr(player, BANANA_ATTRIBUTE);
    if (stored >= 10) {
      player.sendMessage("The crate is already full.");
      return;
    }
    if (!hasItem(player, BANANA_ITEM_ID)) return;
    player.getInventory().deleteNumber(BANANA_ITEM_ID, 1);
    setAttr(player, BANANA_ATTRIBUTE, stored + 1);
    player.sendMessage("You pack a banana into the crate.");
  }

  function fillCrate(player) {
    const stored = attr(player, BANANA_ATTRIBUTE);
    if (stored >= 10) {
      player.sendMessage("The crate is already full.");
      return;
    }
    const carried = player.getInventory().getAmount(BANANA_ITEM_ID);
    if (carried <= 0) {
      player.sendMessage("You have no bananas to pack.");
      return;
    }
    const packed = Math.min(carried, 10 - stored);
    player.getInventory().deleteNumber(BANANA_ITEM_ID, packed);
    setAttr(player, BANANA_ATTRIBUTE, stored + packed);
    StatementDialogue.send(player, "You pack all your bananas into the crate.");
  }

  function stashRum(player) {
    if (quest.getStage(player) !== STAGE_STARTED) return;
    if (attr(player, RUM_ATTRIBUTE) >= 1) {
      player.sendMessage("There's already some rum in here...");
      return;
    }
    if (!hasItem(player, RUM_ITEM_ID)) return;
    player.getInventory().deleteNumber(RUM_ITEM_ID, 1);
    setAttr(player, RUM_ATTRIBUTE, 1);
    StatementDialogue.send(player, "You stash the rum in the crate.");
  }

  function searchPlantationCrate(player) {
    const bananas = attr(player, BANANA_ATTRIBUTE), rum = attr(player, RUM_ATTRIBUTE) === 1;
    if (rum && bananas === 0) player.sendMessage("There is some rum in here, although with no bananas to cover it. It is a little obvious.");
    else player.sendMessage(bananas >= 10 ? "The crate is full of bananas." : `The crate has ${bananas} banana${bananas === 1 ? "" : "s"} inside.`);
    if (rum && bananas > 0) player.sendMessage("There is also some rum stashed in here too.");
  }

  function searchStoreCrate(player) {
    if (!isEmployed(player, 2)) { player.sendMessage("Wydin won't let you into the stock room."); return; }
    if (!wearingApron(player)) { player.sendMessage("You need to put your white apron on first."); return; }
    player.sendMessage("There are a lot of bananas in the crate.");
    if (attr(player, RUM_ATTRIBUTE) >= 2 && giveItem(player, RUM_ITEM_ID)) {
      setAttr(player, RUM_ATTRIBUTE, 0);
      player.sendMessage("You find your bottle of rum in amongst the bananas.");
    }
    api.sendMultiChatboxPrompt(player, "Do you want to take a banana?", "Yes.", () => {
      if (player.getInventory().isFull()) { player.sendMessage("You need more inventory space."); return; }
      player.getInventory().adds(BANANA_ITEM_ID, 1); player.sendMessage("You take a banana.");
    }, "No.", () => {});
  }

  /**
   * A closed stock-room door blocks the collision map, so opening it steps the player
   * to the far side by hand. The click's origin tile decides which side that is: the
   * walk to the door ends standing on the door itself, which is neither side.
   */
  function useStockRoomDoor(player, location) {
    const origin = doorOrigins.get(player);
    doorOrigins.delete(player);
    const originX = origin ? origin.x : player.getLocation().getX();
    const entering = originX > location.x;
    if (entering && (!isEmployed(player, 2) || !wearingApron(player))) {
      startTranscript(api, player, WYDIN_NPC_ID, "Pirate's Treasure", !isEmployed(player, 2)
        ? "retrieving-the-rum-trying-to-open-the-door-in-the-food-store-before-getting-the-job"
        : "retrieving-the-rum-trying-to-open-the-door-after-getting-the-job-while-not-wearing-a-white-apron");
      return;
    }
    player.moveTo(new Location(location.x + (entering ? -1 : 1), location.y, location.z ?? player.getLocation().getZ()));
  }

  /**
   * The same closed door breaks the crate's route from the shop, so a crate click that
   * starts inside the shop is stepped through the door first, then walked to the crate.
   */
  function handleObjectRoute(event) {
    if (event.objectId === STOCK_ROOM_DOOR_ID) {
      doorOrigins.set(event.player, event.sourceLocation);
      return;
    }
    if (event.objectId !== STORE_CRATE_ID) return;
    const { player, sourceLocation } = event;
    const x = STOCK_ROOM_DOOR_TILE.x;
    const y = STOCK_ROOM_DOOR_TILE.y;
    const inShop = sourceLocation.x >= x && sourceLocation.x <= x + 5
      && sourceLocation.y >= y - 3 && sourceLocation.y <= y + 4;
    if (!inShop || !isEmployed(player, 2) || !wearingApron(player)) return;
    const z = player.getLocation().getZ();
    player.moveTo(new Location(x - 1, y, z));
    event.destination = { x: STORE_CRATE_TILE.x + 1, y: STORE_CRATE_TILE.y, z };
  }

  function closeChest(player) {
    const closed = openingChests.get(player);
    if (!closed) return;
    openingChests.delete(player);
    player.getPacketSender().sendObject(closed).sendVarbit(12393, 0);
    player.getMovementQueue().setBlockMovement(false);
  }

  function unlockChest(player) {
    if (openingChests.has(player)) return;
    if (quest.getStage(player) !== STAGE_KEY || !hasItem(player, KEY_ITEM_ID)) {
      player.sendMessage("The chest is locked.");
      return;
    }
    const closed = new GameObject(CHEST_ID, CHEST_TILE, 10, 0, player.getPrivateArea());
    const opened = new GameObject(OPEN_CHEST_ID, CHEST_TILE, 10, 0, player.getPrivateArea());
    openingChests.set(player, closed);
    player.sendMessage("You unlock the chest.");
    player.sendMessage("All that's in the chest is a message...");
    player.getMovementQueue().setBlockMovement(true);
    player.getPacketSender().sendObject(opened).sendVarbit(12393, 1).sendSoundEffect(CHEST_OPEN_SOUND);
    const task = new Task(4, player, false);
    task.execute = () => {
      task.stop();
      if (!openingChests.has(player)) return;
      closeChest(player);
      if (!hasItem(player, KEY_ITEM_ID) || quest.getStage(player) !== STAGE_KEY) return;
      player.getInventory().deleteNumber(KEY_ITEM_ID, 1);
      giveItem(player, MESSAGE_ITEM_ID);
      player.sendMessage("You take the message from the chest.");
    };
    TaskManager.submit(task);
  }

  function digForTreasure(player) {
    if (quest.getStage(player) !== STAGE_NOTE) return false;
    const position = player.getLocation();
    const distance = Math.max(
      Math.abs(position.getX() - TREASURE_TILE.x),
      Math.abs(position.getY() - TREASURE_TILE.y),
    );
    if (distance > 1 || position.getZ() !== TREASURE_TILE.z) return false;
    if (digging.has(player)) return true;
    player.performAnimation(new Animation(830));
    // The first dig only wakes the gardener; the casket is on the second (Wiki).
    if (!attr(player, DUG_ATTRIBUTE)) {
      setAttr(player, DUG_ATTRIBUTE, 1);
      spawnGardener(player);
      return true;
    }
    // Blocked only while the gardener is alive and on the player; a skipped or dead
    // gardener (or a player who relogged away from one) must never block completion.
    if (gardenerThreatens(player)) {
      player.sendMessage("I can't dig up anything with him attacking me!");
      return true;
    }
    if (player.getInventory().isFull()) { player.sendMessage("You need more inventory space."); return true; }
    player.sendMessage("You dig a hole in the ground...");
    digging.add(player);
    const task = new Task(4, player, false);
    task.execute = () => {
      task.stop(); digging.delete(player);
      if (quest.getStage(player) !== STAGE_NOTE || player.isRegistered?.() === false) return;
      if (player.getInventory().isFull()) { player.sendMessage("You need more inventory space."); return; }
      player.sendMessage("and find a little chest of treasure.");
      quest.complete(player);
    };
    TaskManager.submit(task);
    return true;
  }

  function spawnGardener(player) {
    const npc = api.spawnNpc({
      id: GARDENER_NPC_ID,
      ...GARDENER_TILE,
      owner: player,
      ownerOnly: true,
      wanderRadius: 0,
    });
    if (!npc) return;
    npc.__skipDefaultRespawn = true;
    npc.forceChat(GARDENER_SHOUT);
    player.getPacketSender().sendEntityHint(npc);
    npc.getCombat().attack(player);
    gardenerByPlayer.set(player, npc);
  }

  function cleanupGardener({ player }) {
    closeChest(player); sailing.delete(player);
    const npc = gardenerByPlayer.get(player);
    if (npc) api.removeNpc(npc);
    gardenerByPlayer.delete(player);
    digging.delete(player);
  }

  function gardenerThreatens(player) {
    const npc = gardenerByPlayer.get(player);
    if (!npc) return false;
    const registered = typeof npc.isRegistered !== "function" || npc.isRegistered();
    if (!registered || npc.getHitpoints() <= 0) {
      gardenerByPlayer.delete(player);
      player.getPacketSender().sendEntityHintRemoval();
      return false;
    }
    return npc.getLocation().isWithinDistance(player.getLocation(), 8);
  }
};
