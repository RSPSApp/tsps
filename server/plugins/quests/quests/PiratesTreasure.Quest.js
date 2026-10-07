/**
 * Pirate's Treasure.
 *
 * Words come from npc-dialogues.json. This plugin supplies the variant selector
 * for Redbeard Frank (3643), Wydin (2890), Luthas (3647), the Karamja bartender
 * (1314) and the customs officer (14984/14985), the prose-condition answers, the
 * start hook, the rum/key/coin hand-ins and the crate/door/chest/dig interactions.
 *
 * Stages (varp 71): 1 started, 2 key, 3 note, 4 complete.
 *
 * Supporting state, kept in attributes (the reference's varps 72-74):
 *   employment bit 1 = Luthas's banana job, bit 2 = Wydin's shop job
 *   bananas = how many bananas are in the plantation crate
 *   rum = 0 none, 1 hidden in the crate, 2 shipped to Wydin's stock room
 *
 * Gaps (no dump support, see summary): Frank while carrying the key/message or
 * the note; the gardener that attacks during the dig (needs a spawn); banana and
 * apron sources; the shop options on Wydin's dialogue.
 */
module.exports = function registerPiratesTreasureQuest(api) {
  const { Equipment, Location, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest } = require("../QuestRuntime");

  const FRANK_NPC_ID = NpcIdentifiers.REDBEARD_FRANK;
  const WYDIN_NPC_ID = NpcIdentifiers.WYDIN;
  const LUTHAS_NPC_ID = NpcIdentifiers.LUTHAS;
  const BARTENDER_NPC_ID = NpcIdentifiers.BARTENDER_6;
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
  const TREASURE_TILE = { x: 2999, y: 3383, z: 0 };

  const EMPLOYMENT_ATTRIBUTE = "pirates-treasure.employment";
  const BANANA_ATTRIBUTE = "pirates-treasure.bananas";
  const RUM_ATTRIBUTE = "pirates-treasure.rum";

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

  let quest;

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

  function reward(player) {
    player.getInventory().adds(COINS_ITEM_ID, 450);
    player.getInventory().adds(RING_ITEM_ID, 1);
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
      if (stepId === "l2iXlt" || value.includes("does not have enough coins")) {
        return player.getInventory().getAmount(COINS_ITEM_ID) < 30;
      }
      if (stepId === "GGmLiT" || value.includes("has 30 coins")) {
        return player.getInventory().getAmount(COINS_ITEM_ID) >= 30;
      }
      if (value.includes("karamja gloves") || value.includes("ring of charos")) return false;
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
    if (npcId === FRANK_NPC_ID && stepId === RUM_HANDIN_STEP_ID) {
      if (event.text) player.sendMessage(String(event.text));
      if (hasItem(player, RUM_ITEM_ID)) {
        player.getInventory().deleteNumber(RUM_ITEM_ID, 1);
        giveItem(player, KEY_ITEM_ID);
        quest.setStage(player, STAGE_KEY);
      }
      event.handled = true;
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
    }
  }

  function handleItemOnNpc(event) {
    if (event.itemId !== RUM_ITEM_ID) return;
    if (event.target?.getId?.() !== FRANK_NPC_ID) return;
    const { player } = event;
    if (quest.getStage(player) !== STAGE_STARTED || !hasItem(player, RUM_ITEM_ID)) return;
    player.getInventory().deleteNumber(RUM_ITEM_ID, 1);
    giveItem(player, KEY_ITEM_ID, "Frank happily takes the rum... and hands you a key.");
    quest.setStage(player, STAGE_KEY);
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
        quest.getStage(player) === STAGE_KEY ? "The chest is locked." : "The chest is empty.",
      );
      event.handled = true;
    }
  }

  function handleItemAction(event) {
    const option = String(event.option ?? "").toLowerCase();
    if (event.itemId === MESSAGE_ITEM_ID && option.includes("read")) {
      if (quest.getStage(event.player) === STAGE_KEY) quest.setStage(event.player, STAGE_NOTE);
      event.player.sendMessage("Visit the city of the White Knights.");
      event.player.sendMessage("In the park, Saradomin points to the X that marks the spot.");
      event.handled = true;
      return;
    }
    if (event.itemId === SPADE_ITEM_ID && option.includes("dig") && digForTreasure(event.player)) {
      event.handled = true;
    }
  }

  quest = registerQuest(api, {
    key: "pirates_treasure",
    name: "Pirate's Treasure",
    varpId: VARP_PIRATES_TREASURE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    rewardItemId: EMERALD_ITEM_ID,
    rewardItemLabel: "An Emerald",
    otherRewards: ["450 Coins", "A Gold ring"],
    buildJournal,
    onReward: reward,
  });

  api.persistAttribute(EMPLOYMENT_ATTRIBUTE);
  api.persistAttribute(BANANA_ATTRIBUTE);
  api.persistAttribute(RUM_ATTRIBUTE);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:condition", handleConditionMet);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnObject(handleItemOnObject);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemAction(handleItemAction);
  function buyRum(player) {
    const inventory = player.getInventory();
    if (inventory.getAmount(COINS_ITEM_ID) < 27) return;
    if (!giveItem(player, RUM_ITEM_ID, "You buy a bottle of rum.")) return;
    inventory.deleteNumber(COINS_ITEM_ID, 27);
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
    player.sendMessage("You pack all your bananas into the crate.");
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
    player.sendMessage("You stash the rum in the crate.");
  }

  function searchPlantationCrate(player) {
    const bananas = attr(player, BANANA_ATTRIBUTE);
    player.sendMessage(
      bananas >= 10
        ? "The crate is full of bananas."
        : `The crate has ${bananas} banana${bananas === 1 ? "" : "s"} inside.`,
    );
    if (attr(player, RUM_ATTRIBUTE) === 1) {
      player.sendMessage("There is also some rum stashed in here too.");
    }
  }

  function searchStoreCrate(player) {
    if (!isEmployed(player, 2)) {
      player.sendMessage("Wydin won't let you into the stock room.");
      return;
    }
    if (attr(player, RUM_ATTRIBUTE) < 2) {
      player.sendMessage("You find only bananas.");
      return;
    }
    if (hasItem(player, RUM_ITEM_ID) || giveItem(player, RUM_ITEM_ID)) {
      setAttr(player, RUM_ATTRIBUTE, 0);
      player.sendMessage("There are a lot of bananas in the crate.");
      player.sendMessage("You find your bottle of rum in amongst the bananas.");
    }
  }

  function useStockRoomDoor(player, location) {
    const position = player.getLocation();
    const entering = position.getX() > location.x;
    if (entering && !isEmployed(player, 2)) {
      player.sendMessage("Wydin won't let you into the stock room.");
      return;
    }
    player.moveTo(new Location(location.x + (entering ? -1 : 1), position.getY(), location.z ?? position.getZ()));
  }

  function unlockChest(player) {
    if (quest.getStage(player) !== STAGE_KEY || !hasItem(player, KEY_ITEM_ID)) {
      player.sendMessage("The chest is locked.");
      return;
    }
    player.getInventory().deleteNumber(KEY_ITEM_ID, 1);
    giveItem(player, MESSAGE_ITEM_ID);
    player.sendMessage("You unlock the chest.");
    player.sendMessage("All that's in the chest is a message...");
    player.sendMessage("You take the message from the chest.");
  }

  function digForTreasure(player) {
    if (quest.getStage(player) !== STAGE_NOTE) return false;
    const position = player.getLocation();
    const distance = Math.max(
      Math.abs(position.getX() - TREASURE_TILE.x),
      Math.abs(position.getY() - TREASURE_TILE.y),
    );
    if (distance > 1 || position.getZ() !== TREASURE_TILE.z) return false;
    player.sendMessage("You dig a hole in the ground...");
    player.sendMessage("and find a little chest of treasure.");
    quest.complete(player);
    return true;
  }
};
