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
 * Source: pinned Quest Helper `clocktower/ClockTower.java` and the OSRS Wiki.
 * Rewards per the OSRS Wiki: 1 Quest point, 500 coins.
 *
 * Lever A/B transform 33->35 and 34->36 (cache ids, QH's CTLEVERA2 check).
 * The death-throes gate 39 is removed through the world object API once the
 * player reads the post-poison condition; gates 37/38 stay with Doors.
 */
module.exports = function registerClockTowerQuest(api) {
  const {
    Animation,
    CountdownTask,
    Equipment,
    GameObject,
    Item,
    ItemIdentifiers,
    MapObjects,
    NpcIdentifiers,
    ObjectIdentifiers,
    ObjectManager,
    Location,
    TaskManager,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const KOJO_NPC_ID = NpcIdentifiers.BROTHER_KOJO; // 3606
  const CAGE_RAT_NPC_IDS = new Set([
    NpcIdentifiers.DUNGEON_RAT_4, // 3607
    NpcIdentifiers.DUNGEON_RAT_5, // 3608
    NpcIdentifiers.DUNGEON_RAT_6, // 3609
  ]);
  const RAT_RESPAWN_TICKS = 25; // Wiki: dungeon rat respawn time 25 ticks.
  const RAT_RESPAWN_KEY = new Object();
  const RAT_DEATH_KEY = new Object();
  const dyingCageRats = new Set();

  const VARP_CLOCK_TOWER = 10; // "cogquest"

  const STAGE_STARTED = 1;
  const STAGE_ONE_PLACED = 2;
  const STAGE_TWO_PLACED = 3;
  const STAGE_THREE_PLACED = 4;
  const STAGE_ALL_PLACED = 5;
  const STAGE_COMPLETE = 6;
  // Cache DB row 14 column 19: native getState completes at varp 10 >= 8.
  const WIRE_COMPLETE = 8;

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
  const JUG_OF_WATER_ITEM_ID = ItemIdentifiers.JUG_OF_WATER; // 1937
  const JUG_ITEM_ID = ItemIdentifiers.JUG; // 1935
  const WATER_CONTAINERS = new Map([
    [BUCKET_OF_WATER_ITEM_ID, BUCKET_ITEM_ID],
    [JUG_OF_WATER_ITEM_ID, JUG_ITEM_ID],
  ]);
  const ICE_GLOVES_ITEM_ID = ItemIdentifiers.ICE_GLOVES; // 1580
  const SMITHS_GLOVES_I_ITEM_ID = ItemIdentifiers.SMITHS_GLOVES_I_; // 27031
  const COINS_ITEM_ID = ItemIdentifiers.COINS; // 995
  const SEXTANT_ITEM_ID = ItemIdentifiers.SEXTANT; // 2574
  const WATCH_ITEM_ID = ItemIdentifiers.WATCH; // 2575
  const CHART_ITEM_ID = ItemIdentifiers.CHART; // 2576

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
  const DEATH_THROES_GATE_OBJECT_ID = ObjectIdentifiers.GATE_3; // 39
  const FOOD_TROUGH_OBJECT_ID = ObjectIdentifiers.FOOD_TROUGH; // 40
  const PUSH_WALL_OBJECT_ID = ObjectIdentifiers.WALL_5; // 1597 "Wall" Push
  const PUSH_WALL_TILE = { x: 2575, y: 9631, z: 0 };
  const WHITE_COG_EXIT_LADDER_ID = 17385; // "Ladder" Climb-up at 2575,9655
  const WHITE_COG_EXIT_LADDER_TILE = { x: 2575, y: 9655, z: 0 };
  const WHITE_COG_SURFACE_TILE = { x: 2575, y: 3255, z: 0 }; // open Trapdoor 100, walkable
  const CANONICAL_TROUGH_TILE = { x: 2586, y: 9654, z: 0 }; // Food trough 40, 2x1 origin
  const LEVER_ANIMATION_ID = 2141;
  const LEVER_TILES = new Map([
    [ObjectIdentifiers.LEVER, { x: 2591, y: 9661, z: 0 }],
    [ObjectIdentifiers.LEVER_2, { x: 2593, y: 9661, z: 0 }],
  ]);
  const LEVER_TRANSFORMS = new Map([
    [ObjectIdentifiers.LEVER, ObjectIdentifiers.LEVER_3], // 33 -> 35
    [ObjectIdentifiers.LEVER_2, ObjectIdentifiers.LEVER_4], // 34 -> 36
  ]);

  const BITS_ATTRIBUTE = "quest.clock_tower.bits";
  const BIT_COOLED = 1 << 0;
  const BIT_BLUE = 1 << 1;
  const BIT_BLACK = 1 << 2;
  const BIT_WHITE = 1 << 3;
  const BIT_RED = 1 << 4;
  const BIT_RATS_POISONED = 1 << 5;
  const BIT_LEVER_A = 1 << 6; // preserved value; old saves mean lever A pulled
  const BIT_LEVER_B = 1 << 7;
  const LEVER_BIT_BY_ID = new Map([
    [ObjectIdentifiers.LEVER, BIT_LEVER_A],
    [ObjectIdentifiers.LEVER_3, BIT_LEVER_A],
    [ObjectIdentifiers.LEVER_2, BIT_LEVER_B],
    [ObjectIdentifiers.LEVER_4, BIT_LEVER_B],
  ]);
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
  const WATCH_RECEIVE_ACTION_ID = "-2P78v";
  const COMPLETE_ACTION_ID = "ihG17v";

  /** Transient branch context for the condition prose (never persisted). */
  const whiteCogAction = new WeakMap();
  const ratGateLocation = new WeakMap();
  const blackCogGroundItem = new WeakMap();

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
    const id = gloves?.getId?.();
    return id === ICE_GLOVES_ITEM_ID || id === SMITHS_GLOVES_I_ITEM_ID;
  }

  function waterContainer(player) {
    for (const [waterId, emptyId] of WATER_CONTAINERS) {
      if (held(player, waterId)) return { waterId, emptyId };
    }
    return null;
  }

  /** The cooled cog is an extra item; the emptied container keeps its own slot. */
  function hasBlackCogSpace(player) {
    if (player.getInventory().getFreeSlots() > 0) return true;
    player.getInventory().full();
    return false;
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
    // The whole 500-coin stack is handed over once. forceAdd merges into an
    // existing coin stack or drops it at the reward tile when the bag is full.
    player.getInventory().forceAdd(player, new Item(COINS_ITEM_ID, 500));
  }

  /** Which transcript variant Kojo plays, by stage. */
  function selectVariant({ npcId, player }) {
    if (npcId !== KOJO_NPC_ID) return null;
    const stage = quest.getStage(player);
    // The watch is a separate Brother Kojo route that shares the NPC page.
    if (!questActive(player) && !held(player, WATCH_ITEM_ID) &&
        held(player, SEXTANT_ITEM_ID) && held(player, CHART_ITEM_ID)) {
      return { page: "Brother Kojo", variant: "with-a-chart-and-sextant-in-the-inventory" };
    }
    if (stage >= STAGE_COMPLETE) return { page: "Brother Kojo", variant: "after-clock-tower" };
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
      return !waterContainer(player) && !wearingIceGloves(player);
    }
    if (value.includes("has a bucket of water or ice gloves equipped")) {
      return waterContainer(player) !== null || wearingIceGloves(player);
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
      const groundItem = blackCogGroundItem.get(player);
      blackCogGroundItem.delete(player);
      event.handled = true;
      const inventory = player.getInventory();
      const container = waterContainer(player);
      if (container) {
        inventory.deleteNumber(container.waterId, 1);
        inventory.adds(container.emptyId, 1);
      }
      setBit(player, BIT_COOLED);
      if (!held(player, BLACK_COG_ITEM_ID)) inventory.adds(BLACK_COG_ITEM_ID, 1);
      if (groundItem && held(player, BLACK_COG_ITEM_ID)) {
        api.getItemOnGroundManager().deregister(groundItem);
      }
      return;
    }
    if (stepId === WATCH_RECEIVE_ACTION_ID) {
      event.handled = true;
      if (held(player, WATCH_ITEM_ID)) return;
      const inventory = player.getInventory();
      if (inventory.getFreeSlots() <= 0) inventory.full();
      else inventory.adds(WATCH_ITEM_ID, 1);
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

  /** The "door after poisoning" branch removes the unhinged gate for natural passage. */
  function handleCondition(event) {
    if (event.npcId !== KOJO_NPC_ID || event.stepId !== RAT_DOOR_AFTER_CONDITION_ID) return;
    const location = ratGateLocation.get(event.player);
    ratGateLocation.delete(event.player);
    if (location) removeDeathThroesGate(location);
  }

  function removeDeathThroesGate(location) {
    const at = new Location(location.x, location.y, location.z);
    const gate = MapObjects.get(DEATH_THROES_GATE_OBJECT_ID, at, null);
    if (gate) ObjectManager.deregister(gate, true);
  }

  function transformLever(baseId, replacementId, location) {
    const at = new Location(location.x, location.y, location.z);
    const base = MapObjects.get(baseId, at, null);
    if (!base) return;
    const type = base.getType();
    const face = base.getFace();
    ObjectManager.deregister(base, true);
    if (!MapObjects.get(replacementId, at, null)) {
      ObjectManager.register(new GameObject(replacementId, at, type, face, null), true);
    }
  }

  /** Replays durable lever states onto the world objects after login. */
  function syncLeverTransforms(player) {
    const value = bits(player);
    for (const [baseId, replacementId] of LEVER_TRANSFORMS) {
      const tile = LEVER_TILES.get(baseId);
      const bit = LEVER_BIT_BY_ID.get(baseId);
      if (tile && bit && (value & bit)) transformLever(baseId, replacementId, tile);
    }
  }

  function killCageRats() {
    const world = api.getWorld();
    if (!world?.getNpcs) return;
    const doomed = [];
    for (const npc of [...world.getNpcs()]) {
      if (!npc || !CAGE_RAT_NPC_IDS.has(npc.getId()) || dyingCageRats.has(npc)) continue;
      dyingCageRats.add(npc);
      const location = npc.getLocation();
      const definition = npc.getCurrentDefinition?.() ?? npc.getDefinition?.();
      const deathAnim = definition?.getDeathAnim?.() ?? 0;
      if (deathAnim > 0) npc.performAnimation?.(new Animation(deathAnim));
      npc.getMovementQueue?.()?.setBlockMovement?.(true);
      npc.getMovementQueue?.()?.reset?.();
      npc.getCombat?.()?.reset?.();
      doomed.push({
        npc,
        id: npc.getId(),
        x: location.getX(),
        y: location.getY(),
        z: location.getZ(),
        deathTicks: Math.max(1, definition?.getDeathTicks?.() ?? 2),
      });
    }
    if (!doomed.length) return;
    const remove = () => {
      for (const rat of doomed) {
        api.removeNpc(rat.npc);
        dyingCageRats.delete(rat.npc);
      }
    };
    const deathTicks = Math.max(...doomed.map(rat => rat.deathTicks));
    TaskManager.submit(new CountdownTask(RAT_DEATH_KEY, deathTicks, () => {
      remove();
      const respawnTicks = Math.max(0, RAT_RESPAWN_TICKS - deathTicks);
      const respawn = () => {
        for (const rat of doomed) {
          api.spawnNpc({ id: rat.id, x: rat.x, y: rat.y, z: rat.z, wanderRadius: 0 });
        }
      };
      if (respawnTicks > 0) TaskManager.submit(new CountdownTask(RAT_RESPAWN_KEY, respawnTicks, respawn));
      else respawn();
    }));
  }

  /** Cogs onto their spindle, rat poison onto the trough. */
  function isCanonicalTrough(location) {
    return !!location &&
      location.z === CANONICAL_TROUGH_TILE.z &&
      location.y === CANONICAL_TROUGH_TILE.y &&
      (location.x === CANONICAL_TROUGH_TILE.x || location.x === CANONICAL_TROUGH_TILE.x + 1);
  }

  /** QH checks the shared transformed lever object CTLEVERA2 (35), not a player bit. */
  function canonicalLeverIsUp() {
    return MapObjects.get(
      ObjectIdentifiers.LEVER_3,
      new Location(2591, 9661, 0),
      null
    ) !== null;
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId, location } = event;
    if (itemId === RAT_POISON_ITEM_ID && objectId === FOOD_TROUGH_OBJECT_ID) {
      if (!isCanonicalTrough(location)) return;
      event.handled = true;
      if (!questActive(player) || hasBit(player, BIT_RATS_POISONED)) return;
      if (!canonicalLeverIsUp()) {
        player.sendMessage("The rat cage is still closed. Pull the lever first.");
        return;
      }
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
    if (!WATER_CONTAINERS.has(event.inventoryItemId) || event.groundItemId !== BLACK_COG_ITEM_ID) {
      return;
    }
    const { player } = event;
    event.handled = true;
    if (!questActive(player) || hasBit(player, BIT_COOLED) || carryingCog(player)) return;
    if (!hasBlackCogSpace(player)) return;
    const manager = api.getItemOnGroundManager();
    const location = new Location(event.location.x, event.location.y, event.location.z);
    const groundItem = manager.getGroundItem(
      player.getUsername(),
      BLACK_COG_ITEM_ID,
      location,
      player.getPrivateArea?.() ?? null
    );
    if (groundItem) blackCogGroundItem.set(player, groundItem);
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
    if (!hasBlackCogSpace(player)) return;
    blackCogGroundItem.set(player, event.groundItem);
    startTranscript(api, player, KOJO_NPC_ID, PAGE, "black-cog");
  }

  /** Levers transform; ordinary cage gates stay with Doors; gate 39 needs dead rats. */
  function handleObjectInteraction(event) {
    const { player, objectId, location } = event;
    if (
      objectId === WHITE_COG_EXIT_LADDER_ID &&
      location &&
      location.x === WHITE_COG_EXIT_LADDER_TILE.x &&
      location.y === WHITE_COG_EXIT_LADDER_TILE.y &&
      location.z === WHITE_COG_EXIT_LADDER_TILE.z
    ) {
      event.handled = true;
      api.emitCustomEvent("ladders:climbUp", {
        player,
        destination: new Location(WHITE_COG_SURFACE_TILE.x, WHITE_COG_SURFACE_TILE.y, WHITE_COG_SURFACE_TILE.z),
      });
      return;
    }
    if (
      objectId === PUSH_WALL_OBJECT_ID &&
      location &&
      location.x === PUSH_WALL_TILE.x &&
      location.y === PUSH_WALL_TILE.y &&
      location.z === PUSH_WALL_TILE.z
    ) {
      event.handled = true;
      const here = player.getLocation();
      const x = here.getX() >= PUSH_WALL_TILE.x ? PUSH_WALL_TILE.x - 1 : PUSH_WALL_TILE.x + 1;
      player.moveTo(new Location(x, PUSH_WALL_TILE.y, here.getZ()));
      return;
    }
    if (LEVER_OBJECT_IDS.has(objectId)) {
      event.handled = true;
      player.performAnimation(new Animation(LEVER_ANIMATION_ID));
      const bit = LEVER_BIT_BY_ID.get(objectId);
      if (bit) setBit(player, bit);
      const replacement = LEVER_TRANSFORMS.get(objectId);
      if (replacement && location) {
        transformLever(objectId, replacement, new Location(location.x, location.y, location.z));
      }
      return;
    }
    // Gates 37/38 are ordinary Open gates owned by Doors; only the unhinged
    // death-throes gate 39 is quest dialogue.
    if (objectId !== DEATH_THROES_GATE_OBJECT_ID) return;
    event.handled = true;
    if (!questActive(player)) return;
    whiteCogAction.set(player, "door");
    ratGateLocation.set(player, location);
    startTranscript(api, player, KOJO_NPC_ID, PAGE, "white-cog");
  }

  function handleLogin({ player }) {
    syncLeverTransforms(player);
    refreshQuestList(player);
  }

  function handleBootstrap({ player }) {
    syncLeverTransforms(player);
  }

  api.persistAttribute(BITS_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "clock_tower",
    name: "Clock Tower",
    varpId: VARP_CLOCK_TOWER,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    // Durable saves stay on stage 6; the native wire needs value 8.
    varpValue(stage) {
      return stage >= STAGE_COMPLETE ? WIRE_COMPLETE : stage;
    },
    questPoints: 1,
    xpRewards: [],
    rewardItemLabel: "500 Coins",
    scrollItemId: COINS_ITEM_ID,
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
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
};
