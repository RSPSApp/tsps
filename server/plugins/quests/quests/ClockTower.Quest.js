/**
 * Clock Tower (members).
 *
 * The words come from the "Clock Tower" transcript page; this plugin supplies the
 * variant selector for Brother Kojo, the start hook, the prose-condition answers
 * for the black-cog and white-cog gameplay branches, the cog gathering/placing
 * loop, the rat-poison trough, the cage gates/levers and the completion reward.
 *
 * Stages (varp 10, "cogquest" in the cache varp dump): 1 tasked, 2 one cog
 * placed, 3 two placed, 4 three placed, 5 all four placed, 6 complete. The
 * cooled/blue/black/white/red bits use the reference's cog_bits positions and
 * are kept in the persisted "quest.clock_tower.bits" attribute.
 *
 * Cog mapping (cache loc dump): objects 29-32 are the brokeclockpole_*
 * red/black/white/blue spindles that accept cogs; objects 25-28 are the
 * clockpole_* decoys ("The cog doesn't seem to fit.").
 *
 * Source: https://github.com/LostCityRS/Content/tree/65b754f768b79b941b21b2a1eb3b0d1ecae3cdfe/scripts/quests/quest_cog/scripts
 * Rewards per the OSRS Wiki: 1 Quest point, 500 coins.
 *
 * Gaps: the transcript dump has no post-quest Kojo variant, so a completed
 * player replays "starting-out" (the start hook is guarded); the reference's
 * lever/gate object swaps are not simulated - the cage gates pass the player
 * through and the death-throes gate only opens once the rats are poisoned; the
 * poisoned rats are removed without a death animation roll.
 */
module.exports = function registerClockTowerQuest(api) {
  const {
    Animation,
    Equipment,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
    Location,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const KOJO_NPC_ID = NpcIdentifiers.BROTHER_KOJO; // 3606
  const CAGE_RAT_NPC_IDS = new Set([
    NpcIdentifiers.DUNGEON_RAT_4, // 3607
    NpcIdentifiers.DUNGEON_RAT_5, // 3608
    NpcIdentifiers.DUNGEON_RAT_6, // 3609
  ]);

  const VARP_CLOCK_TOWER = 10; // "cogquest"

  const STAGE_STARTED = 1;
  const STAGE_ONE_PLACED = 2;
  const STAGE_TWO_PLACED = 3;
  const STAGE_THREE_PLACED = 4;
  const STAGE_ALL_PLACED = 5;
  const STAGE_COMPLETE = 6;

  const PAGE = "Clock Tower";
  const START_HOOK = "quest:clock-tower:start";

  const WHITE_COG_ITEM_ID = ItemIdentifiers.WHITE_COG; // 20
  const BLACK_COG_ITEM_ID = ItemIdentifiers.BLACK_COG; // 21
  const BLUE_COG_ITEM_ID = ItemIdentifiers.BLUE_COG; // 22
  const RED_COG_ITEM_ID = ItemIdentifiers.RED_COG; // 23
  const COG_ITEM_IDS = new Set([
    WHITE_COG_ITEM_ID,
    BLACK_COG_ITEM_ID,
    BLUE_COG_ITEM_ID,
    RED_COG_ITEM_ID,
  ]);
  const RAT_POISON_ITEM_ID = ItemIdentifiers.RAT_POISON; // 24
  const BUCKET_OF_WATER_ITEM_ID = ItemIdentifiers.BUCKET_OF_WATER; // 1929
  const BUCKET_ITEM_ID = ItemIdentifiers.BUCKET; // 1925
  const ICE_GLOVES_ITEM_ID = ItemIdentifiers.ICE_GLOVES; // 1580
  const COINS_ITEM_ID = ItemIdentifiers.COINS; // 995

  // Correct cog -> spindle (brokeclockpole_red/black/white/blue, ids 29-32).
  const COG_SPINDLE_BY_ITEM = new Map([
    [RED_COG_ITEM_ID, ObjectIdentifiers.CLOCK_SPINDLE_5], // 29
    [BLACK_COG_ITEM_ID, ObjectIdentifiers.CLOCK_SPINDLE_6], // 30
    [WHITE_COG_ITEM_ID, ObjectIdentifiers.CLOCK_SPINDLE_7], // 31
    [BLUE_COG_ITEM_ID, ObjectIdentifiers.CLOCK_SPINDLE_8], // 32
  ]);
  const COG_SPINDLE_BY_OBJECT = new Map(
    [...COG_SPINDLE_BY_ITEM].map(([itemId, objectId]) => [objectId, itemId])
  );

  const LEVER_OBJECT_IDS = new Set([
    ObjectIdentifiers.LEVER, // 33 ctlevera
    ObjectIdentifiers.LEVER_2, // 34 ctleverb
    ObjectIdentifiers.LEVER_3, // 35 ctlevera2
    ObjectIdentifiers.LEVER_4, // 36 ctleverb2
  ]);
  const RAT_GATE_OBJECT_IDS = new Set([
    ObjectIdentifiers.GATE, // 37 ctratgatea
    ObjectIdentifiers.GATE_2, // 38 ctratgateb
    ObjectIdentifiers.GATE_3, // 39 ctratgatec
  ]);
  const DEATH_THROES_GATE_OBJECT_ID = ObjectIdentifiers.GATE_3; // 39
  const FOOD_TROUGH_OBJECT_ID = ObjectIdentifiers.FOOD_TROUGH; // 40
  const LEVER_ANIMATION_ID = 2141; // human_leverdown

  const BITS_ATTRIBUTE = "quest.clock_tower.bits";
  const BIT_COOLED = 1 << 0;
  const BIT_BLUE = 1 << 1;
  const BIT_BLACK = 1 << 2;
  const BIT_WHITE = 1 << 3;
  const BIT_RED = 1 << 4;
  const BIT_RATS_POISONED = 1 << 5;
  const COG_BIT_BY_ITEM = new Map([
    [BLUE_COG_ITEM_ID, BIT_BLUE],
    [BLACK_COG_ITEM_ID, BIT_BLACK],
    [WHITE_COG_ITEM_ID, BIT_WHITE],
    [RED_COG_ITEM_ID, BIT_RED],
  ]);

  // Condition step ids on the "Clock Tower" page.
  const BLACK_COG_NO_WATER_CONDITION_ID = "kyeI6B";
  const RAT_DOOR_BEFORE_CONDITION_ID = "CZof4l";
  const RAT_TROUGH_CONDITION_ID = "DS6nNq";
  const RAT_DOOR_AFTER_CONDITION_ID = "D5rCfO";
  // Action step ids.
  const BLACK_COG_RECEIVE_ACTION_ID = "PVgrzA";
  const COMPLETE_ACTION_ID = "ihG17v";

  /** Transient branch context for the condition prose (never persisted). */
  const blackCogAction = new WeakMap();
  const whiteCogAction = new WeakMap();
  const ratGateLocation = new WeakMap();

  let quest;

  function bits(player) {
    return Number(player.getAttribute(BITS_ATTRIBUTE)) || 0;
  }

  function hasBit(player, bit) {
    return (bits(player) & bit) !== 0;
  }

  function setBit(player, bit) {
    player.setAttribute(BITS_ATTRIBUTE, bits(player) | bit);
  }

  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;

  function carryingCog(player) {
    for (const itemId of COG_ITEM_IDS) if (held(player, itemId)) return true;
    return false;
  }

  function wearingIceGloves(player) {
    const gloves = player.getEquipment().get(Equipment.HANDS_SLOT);
    return gloves?.getId?.() === ICE_GLOVES_ITEM_ID;
  }

  function questActive(player) {
    return quest.getStage(player) >= STAGE_STARTED && !quest.isComplete(player);
  }

  function cogJournalLine(player, label, itemId) {
    return hasBit(player, COG_BIT_BY_ITEM.get(itemId))
      ? `<str>I have successfully placed the ${label} Cog on its spindle.</str>`
      : `I haven't placed the <col=800000>${label} Cog</col> on its spindle yet.`;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I spoke to Brother Kojo at the Clock Tower South of</str>",
        "<str>Ardougne and agreed to help him repair the clock.</str>",
        "<str>I placed all four cogs successfully on the spindles.</str>",
        "<str>Brother Kojo was grateful for all my help and rewarded me.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_ALL_PLACED) {
      return [
        "<str>I spoke to Brother Kojo at the Clock Tower South of</str>",
        "<str>Ardougne and agreed to help him repair the clock.</str>",
        "<str>I have placed all four cogs successfully on the spindles.</str>",
        "",
        "I should speak to <col=800000>Brother Kojo</col> and claim my reward.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>I spoke to Brother Kojo at the Clock Tower South of</str>",
        "<str>Ardougne and agreed to help him repair the clock.</str>",
        "",
        "To repair the clock I need to find the four coloured cogs",
        "and place them on the four correctly coloured spindles.",
        "",
        cogJournalLine(player, "Blue", BLUE_COG_ITEM_ID),
        cogJournalLine(player, "Black", BLACK_COG_ITEM_ID),
        cogJournalLine(player, "White", WHITE_COG_ITEM_ID),
        cogJournalLine(player, "Red", RED_COG_ITEM_ID),
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Brother Kojo</col>",
      "at the <col=800000>Clock Tower</col>, south of Ardougne.",
    ];
  }

  function grantReward(player) {
    // registerQuest adds the rewardItemId coin; top the stack up to 500.
    player.getInventory().adds(COINS_ITEM_ID, 499);
  }

  /** Which transcript variant Kojo plays, by stage. */
  function selectVariant({ npcId, player }) {
    if (npcId !== KOJO_NPC_ID) return null;
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return "starting-out"; // no post-quest variant in the dump
    if (stage >= STAGE_ALL_PLACED) return "finishing-up";
    if (stage >= STAGE_THREE_PLACED) return "placing-the-cogs-after-placing-three-cogs";
    if (stage >= STAGE_TWO_PLACED) return "placing-the-cogs-after-placing-two-cogs";
    if (stage >= STAGE_ONE_PLACED) return "placing-the-cogs-after-placing-a-cog";
    if (stage >= STAGE_STARTED) return "starting-out-talking-to-brother-kojo-again";
    return "starting-out";
  }

  /** Answer the black-cog and white-cog prose conditions. */
  function answerCondition({ npcId, player, text }) {
    if (npcId !== KOJO_NPC_ID) return null;
    const value = String(text).toLowerCase();
    if (value.includes("does not have a bucket of water or ice gloves equipped")) {
      const action = blackCogAction.get(player);
      return action ? action === "pickup" : !held(player, BUCKET_OF_WATER_ITEM_ID) && !wearingIceGloves(player);
    }
    if (value.includes("has a bucket of water or ice gloves equipped")) {
      const action = blackCogAction.get(player);
      return action ? action === "use" : held(player, BUCKET_OF_WATER_ITEM_ID) || wearingIceGloves(player);
    }
    if (value.includes("trying to open the door before the rats have been poisoned")) {
      return whiteCogAction.get(player) === "door" && !hasBit(player, BIT_RATS_POISONED);
    }
    if (value.includes("using the poison on the food trough")) {
      return whiteCogAction.get(player) === "trough";
    }
    if (value.includes("opening the door after poisoning the rats")) {
      return whiteCogAction.get(player) === "door" && hasBit(player, BIT_RATS_POISONED);
    }
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== KOJO_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) === 0) quest.setStage(player, STAGE_STARTED);
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (stepId === BLACK_COG_RECEIVE_ACTION_ID) {
      blackCogAction.delete(player);
      event.handled = true;
      if (held(player, BUCKET_OF_WATER_ITEM_ID)) {
        player.getInventory().deleteNumber(BUCKET_OF_WATER_ITEM_ID, 1);
        player.getInventory().adds(BUCKET_ITEM_ID, 1);
      }
      setBit(player, BIT_COOLED);
      if (!held(player, BLACK_COG_ITEM_ID)) player.getInventory().adds(BLACK_COG_ITEM_ID, 1);
      return;
    }
    if (stepId === COMPLETE_ACTION_ID) {
      event.handled = true;
      event.end = true;
      if (!quest.isComplete(player) && quest.getStage(player) >= STAGE_ALL_PLACED) {
        quest.complete(player);
      }
    }
  }

  /** The "door after poisoning" branch walks the player through the loose gate. */
  function handleCondition(event) {
    if (event.npcId !== KOJO_NPC_ID || event.stepId !== RAT_DOOR_AFTER_CONDITION_ID) return;
    const location = ratGateLocation.get(event.player);
    ratGateLocation.delete(event.player);
    if (location) stepThrough(event.player, location);
  }

  /** Mirror the player to the tile past the gate (the object tile blocks walking). */
  function stepThrough(player, location) {
    const current = player.getLocation();
    const dx = current.getX() - location.x;
    const dy = current.getY() - location.y;
    const destination =
      Math.abs(dx) >= Math.abs(dy)
        ? new Location(location.x - (dx >= 0 ? 1 : -1), location.y, current.getZ())
        : new Location(location.x, location.y - (dy >= 0 ? 1 : -1), current.getZ());
    player.moveTo(destination);
  }

  function killCageRats() {
    const world = api.getWorld();
    if (!world?.getNpcs) return;
    for (const npc of world.getNpcs()) {
      if (npc && CAGE_RAT_NPC_IDS.has(npc.getId())) api.removeNpc(npc);
    }
  }

  /** Cogs onto their spindle, rat poison onto the trough. */
  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (itemId === RAT_POISON_ITEM_ID && objectId === FOOD_TROUGH_OBJECT_ID) {
      event.handled = true;
      if (!questActive(player) || hasBit(player, BIT_RATS_POISONED)) return;
      player.getInventory().deleteNumber(RAT_POISON_ITEM_ID, 1);
      setBit(player, BIT_RATS_POISONED);
      killCageRats();
      whiteCogAction.set(player, "trough");
      startTranscript(api, player, KOJO_NPC_ID, PAGE, "white-cog");
      return;
    }
    if (!COG_ITEM_IDS.has(itemId)) return;
    event.handled = true;
    const expectedCog = COG_SPINDLE_BY_OBJECT.get(objectId);
    if (expectedCog === undefined || expectedCog !== itemId) {
      player.sendMessage("The cog doesn't seem to fit.");
      return;
    }
    if (!questActive(player)) return;
    if (hasBit(player, COG_BIT_BY_ITEM.get(itemId))) {
      player.sendMessage("You have already placed a cog here.");
      return;
    }
    player.getInventory().deleteNumber(itemId, 1);
    setBit(player, COG_BIT_BY_ITEM.get(itemId));
    player.sendMessage("The cog fits perfectly.");
    const stage = quest.getStage(player);
    if (stage >= STAGE_STARTED && stage < STAGE_ALL_PLACED) {
      quest.setStage(player, stage + 1);
    }
  }

  /** Bucket of water on the red-hot black cog. */
  function handleItemOnGroundItem(event) {
    if (
      event.inventoryItemId !== BUCKET_OF_WATER_ITEM_ID ||
      event.groundItemId !== BLACK_COG_ITEM_ID
    ) {
      return;
    }
    const { player } = event;
    event.handled = true;
    if (!questActive(player) || hasBit(player, BIT_COOLED) || carryingCog(player)) return;
    blackCogAction.set(player, "use");
    startTranscript(api, player, KOJO_NPC_ID, PAGE, "black-cog");
  }

  /** The one-cog limit, the quest gates and the black cog's heat. */
  function handleGroundItemPickup(event) {
    const { player, groundItemId } = event;
    if (!COG_ITEM_IDS.has(groundItemId)) return;
    if (!questActive(player)) {
      event.handled = true;
      player.sendMessage(
        quest.isComplete(player)
          ? "You have already completed this quest."
          : "You must speak to Brother Kojo to begin this quest."
      );
      return;
    }
    if (carryingCog(player)) {
      event.handled = true;
      player.sendMessage("The cogs are too heavy to carry more than one at a time.");
      return;
    }
    if (groundItemId !== BLACK_COG_ITEM_ID || hasBit(player, BIT_COOLED)) return;
    if (wearingIceGloves(player)) {
      setBit(player, BIT_COOLED);
      player.sendMessage("The ice gloves cool down the cog. You can carry it now.");
      return;
    }
    event.handled = true;
    blackCogAction.set(player, "pickup");
    startTranscript(api, player, KOJO_NPC_ID, PAGE, "black-cog");
  }

  /** Levers flip; the cage gates pass through; the west gate needs dead rats. */
  function handleObjectInteraction(event) {
    const { player, objectId, location } = event;
    if (LEVER_OBJECT_IDS.has(objectId)) {
      event.handled = true;
      player.performAnimation(new Animation(LEVER_ANIMATION_ID));
      return;
    }
    if (!RAT_GATE_OBJECT_IDS.has(objectId)) return;
    event.handled = true;
    if (objectId !== DEATH_THROES_GATE_OBJECT_ID) {
      stepThrough(player, location);
      return;
    }
    if (!questActive(player)) return;
    whiteCogAction.set(player, "door");
    ratGateLocation.set(player, location);
    startTranscript(api, player, KOJO_NPC_ID, PAGE, "white-cog");
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  api.persistAttribute(BITS_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "clock_tower",
    name: "Clock Tower",
    varpId: VARP_CLOCK_TOWER,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [],
    rewardItemId: COINS_ITEM_ID,
    rewardItemLabel: "500 Coins",
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnGroundItem(handleItemOnGroundItem);
  api.onGroundItemPickup(handleGroundItemPickup);
  api.onObjectInteraction(handleObjectInteraction);
  api.onPlayerLogin(handleLogin);
};
