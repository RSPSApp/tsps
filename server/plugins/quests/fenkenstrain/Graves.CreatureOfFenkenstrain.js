/**
 * Creature of Fenkenstrain's graves: the body parts dug up, the inscriptions, the memorials and the
 * way down to the Experiment cave, the cavern key and the mausoleum's door, the chest, and the pub's
 * pickled brain. Facts with capture ticks are in docs/quests/creature-of-fenkenstrain.
 */
module.exports = function registerGraves(api, { state, common, guide }) {
  const { STAGE, FIELD } = state;
  const { PAGE, NPC, ITEM, LOC, SEQ, SOUND, held, box, later, hold, release, at } = common;
  const { Animation, Location } = api.core;
  const { startTranscript } = require("../QuestRuntime");

  /**
   * The four graves with a part: where Quest Helper and the capture dig (the tile beside each grave),
   * the grave itself, and its varbit 197 value (ticks 928, 1140, 1153, 1165).
   */
  const PARTS = [
    { dig: [3608, 3490], grave: [3608, 3491], itemId: ITEM.HEAD, field: FIELD.HEAD, result: 1, text: "... and you unearth a decapitated head." },
    { dig: [3503, 3576], grave: [3502, 3576], itemId: ITEM.TORSO, field: FIELD.TORSO, result: 2, text: "... and you unearth a torso." },
    { dig: [3504, 3576], grave: [3504, 3577], itemId: ITEM.ARMS, field: FIELD.ARMS, result: 3, text: "... and you unearth a pair of arms." },
    { dig: [3505, 3576], grave: [3506, 3576], itemId: ITEM.LEGS, field: FIELD.LEGS, result: 4, text: "... and you unearth a pair of legs." },
  ];
  /** Digging takes 6 ticks from "You start digging..." (ticks 928-934; rsprox.net 366, 370). */
  const DIG_TICKS = 6;

  /**
   * Inscriptions. From the capture (the mausoleum, ticks 1137-1163), rsprox.net 366 (3541,3471) and the
   * Wiki (the east graveyard's two and the four round the fairy ring at 3597,3495). The rest are the
   * previous implementation's names, which the Wiki lists for the Haunted Woods without saying which
   * grave carries which: not verified.
   */
  const GRAVE_NAMES = new Map(Object.entries({
    "3502,3576": "Rolomere, 14th Lord of the North Coast",
    "3504,3577": "Rolovanne, 13th Lord of the North Coast",
    "3506,3576": "Rologray, 12th Lord of the North Coast",
    "3541,3471": "Unknown",
    "3572,3527": "Unknown",
    "3576,3526": "Unknown",
    "3608,3491": "Ed Lestwit",
    "3593,3509": "Elena Frey",
    "3585,3497": "Isla Skye",
    "3594,3491": "Marabella Kludge",
    // Unverified (see above).
    "3542,3486": "Unknown",
    "3596,3479": "Kandik Kludge",
    "3588,3472": "Jayna Harrow",
    "3604,3466": "Korvic Frey",
    "3608,3466": "Marcus Harrow",
    "3619,3469": "Anton Hayes",
    "3616,3478": "Serra Alcanthric",
    "3631,3476": "Petrik Corbo",
    "3639,3470": "Jayna Corbo",
    "3629,3483": "Eryn Treforest",
    "3634,3503": "Domin O'Raleigh",
    "3626,3495": "Callum Elding",
  }));

  /** The memorials: the one the star opens, the one on the mausoleum's island, and where each leads. */
  const STAR_MEMORIAL = [3578, 3527];
  const ISLAND_MEMORIAL = [3505, 3571];
  const BELOW_STAR = [3577, 9927, 0];
  const BELOW_ISLAND = [3504, 9969, 0];
  /** The lid moves as the player gets there, and they are down 3 ticks later (ticks 985-988, 1109-1112, 1180-1183). */
  const PUSH_TICKS = 3;
  const BUDGE = "The coffin is incredibly heavy, and does not budge. ";

  const key = (x, y) => `${x},${y}`;
  const tileOf = (location) => [location.getX?.() ?? location.x, location.getY?.() ?? location.y];
  const hasSpade = (player) => common.heldAny(player, ITEM.SPADES);
  const partHeld = (player, part) => part.field === FIELD.HEAD
    ? held(player, ITEM.HEAD) || held(player, ITEM.HEAD_WITH_BRAIN)
    : held(player, part.itemId);

  // ------------------------------------------------------------------------------------------
  // Digging
  // ------------------------------------------------------------------------------------------

  function dig(player, part) {
    if (common.busy(player)) return;
    if (!hasSpade(player)) {
      player.sendMessage("You don't have anything to dig with.");
      return;
    }
    const token = hold(player);
    const sender = player.getPacketSender();
    const finds = part && state.stage(player) === STAGE.PARTS && !partHeld(player, part) && !state.get(player, part.field);
    if (finds) state.set(player, FIELD.DIG_RESULT, part.result);
    player.sendMessage("You start digging...");
    player.performAnimation(new Animation(SEQ.DIG));
    sender.sendSoundEffect(SOUND.DIG, 1, 0);
    sender.sendSoundEffect(SOUND.DIG, 3, 25);
    later(player, DIG_TICKS, () => {
      release(player, token);
      player.performAnimation(new Animation(-1));
      if (!finds) {
        player.sendMessage("... but the grave is empty.");
        return;
      }
      if (player.getInventory().getFreeSlots() < 1) {
        // Ours: no capture digs with a full pack; the part stays in the grave until there is room.
        player.sendMessage("You don't have enough inventory space for what you've found.");
        return;
      }
      player.getInventory().adds(part.itemId, 1);
      const gone = part.field === FIELD.HEAD ? guide.atGrave(player) : null;
      // The box first, the same words in the chat as it is continued (ticks 934-937).
      box(player, part.text, part.itemId, () => {
        player.sendMessage(part.text);
        gone?.();
      });
    });
  }

  function partByDigTile(location) {
    const [x, y] = tileOf(location);
    return PARTS.find(({ dig: [dx, dy] }) => dx === x && dy === y) ?? null;
  }

  function partByGrave(location) {
    const [x, y] = tileOf(location);
    return PARTS.find(({ grave: [gx, gy] }) => gx === x && gy === y) ?? null;
  }

  /** The spade's Dig, standing on a part's tile; anywhere else is someone else's dig (return false). */
  function digWithSpade(event) {
    const { player } = event;
    const location = player.getLocation();
    if (location.getZ() !== 0) return false;
    const part = partByDigTile(location);
    if (!part) return false;
    dig(player, part);
    return true;
  }

  function isQuestGrave(objectId) {
    return objectId === LOC.GRAVE || objectId === LOC.GRAVE_POOR;
  }

  function digGrave(event) {
    const { player, objectId, location } = event;
    if (!isQuestGrave(objectId)) return false;
    dig(player, partByGrave(location));
    return true;
  }

  function spadeOnGrave(event) {
    if (!ITEM.SPADES.includes(event.itemId) || !isQuestGrave(event.objectId)) return false;
    event.handled = true;
    dig(event.player, partByGrave(event.location));
    return true;
  }

  /** "The grave says:" and the inscription, as live words them (three spaces, two after "lies"). */
  function readGrave(event) {
    const { player, objectId, location } = event;
    if (!isQuestGrave(objectId)) return false;
    const name = GRAVE_NAMES.get(key(...tileOf(location))) ?? "Unknown";
    player.sendMessage("The grave says:");
    player.sendMessage(`   'Here lies  ${name} - REST IN PEACE'`);
    return true;
  }

  // ------------------------------------------------------------------------------------------
  // The memorials
  // ------------------------------------------------------------------------------------------

  function openMemorial(player, object, destination) {
    if (common.busy(player)) return;
    const token = hold(player);
    if (object) player.getPacketSender().sendObjectAnimation(object, new Animation(SEQ.CAPSTONE));
    player.getPacketSender().sendSoundEffect(SOUND.SCRAPE, 1, 0);
    later(player, PUSH_TICKS, () => {
      release(player, token);
      player.moveTo(new Location(...destination));
    });
  }

  function pushMemorial(event) {
    const { player, objectId, location, object } = event;
    if (objectId !== LOC.MEMORIAL) return false;
    if (at(location, ...ISLAND_MEMORIAL)) {
      openMemorial(player, object, BELOW_ISLAND);
      return true;
    }
    if (at(location, ...STAR_MEMORIAL) && state.get(player, FIELD.COFFIN)) {
      openMemorial(player, object, BELOW_STAR);
      return true;
    }
    player.sendMessage(BUDGE);
    return true;
  }

  function searchMemorial(event) {
    const { player, objectId, location } = event;
    if (objectId !== LOC.MEMORIAL) return false;
    player.sendMessage(at(location, ...STAR_MEMORIAL)
      ? "You find a depression in the memorial stone in the shape of a six-pointed star."
      : "You find nothing remarkable about the memorial stone.");
    return true;
  }

  /** The star goes into the lid (tick 982): varbit 192, and the amulet in a box. */
  function starOnMemorial(event) {
    const { player, itemId, objectId, location } = event;
    if (itemId !== ITEM.STAR_AMULET || objectId !== LOC.MEMORIAL || !at(location, ...STAR_MEMORIAL)) return false;
    if (state.get(player, FIELD.COFFIN)) return false;
    event.handled = true;
    player.getInventory().deleteNumber(ITEM.STAR_AMULET, 1);
    state.set(player, FIELD.COFFIN, 1);
    box(player, "The star amulet fits exactly into the depression on the coffin lid.", ITEM.STAR_AMULET);
    return true;
  }

  // ------------------------------------------------------------------------------------------
  // The cave: the key, the mausoleum's door, the chest
  // ------------------------------------------------------------------------------------------

  /**
   * The level 51 Experiment drops the cavern key while the quest is under way (Wiki; tick 1042,
   * "Untradeable drop: Cavern key"); no other Experiment, and nobody before or after the quest.
   */
  function cavernKeyDrop(request) {
    if (request.itemId !== ITEM.CAVERN_KEY) return;
    const stage = request.player ? state.stage(request.player) : STAGE.NOT_STARTED;
    request.allowed = request.npcId === NPC.KEY_EXPERIMENT && stage >= STAGE.PARTS && stage < STAGE.COMPLETE
      && !held(request.player, ITEM.CAVERN_KEY) && !state.get(request.player, FIELD.UNLOCKED_CAVERN);
  }

  /**
   * Spared once a key is carried, has been used on the gate, or the quest is done (Wiki, Experiment and
   * Cavern key). Only the Attack option is refused: a combat spell still starts the fight, though no
   * second key drops.
   */
  function spareExperiment(event) {
    const { player, npcId } = event;
    if (npcId !== NPC.KEY_EXPERIMENT || !player) return;
    if (!held(player, ITEM.CAVERN_KEY) && !state.get(player, FIELD.UNLOCKED_CAVERN) && state.stage(player) < STAGE.COMPLETE) return;
    player.sendMessage("You don't have the heart to kill the poor creature again.");
    event.handled = true;
  }

  /**
   * The key goes into the lock each time, from either side (ticks 1081, 1254); the first time also
   * marks the cavern unlocked and both bridges buildable (varbits 199, 4441, 5023).
   */
  function mausoleumDoor(event) {
    const { player, objectId, object } = event;
    if (objectId !== LOC.MAUSOLEUM_DOOR) return false;
    // After the quest the key is no longer needed to open it (Wiki, Cavern key).
    if (state.stage(player) >= STAGE.COMPLETE) {
      player.getPacketSender().sendSoundEffect(SOUND.LOCKED, 1, 0);
      api.emitCustomEvent("door:open", { player, object, handled: false });
      return true;
    }
    if (!held(player, ITEM.CAVERN_KEY)) {
      // Ours: the shed's locked message (Wiki); no capture tries this door without the key.
      player.sendMessage("The door is locked.");
      return true;
    }
    player.getInventory().deleteNumber(ITEM.CAVERN_KEY, 1);
    if (!state.get(player, FIELD.UNLOCKED_CAVERN)) {
      state.set(player, FIELD.UNLOCKED_CAVERN, 1);
      if (!state.get(player, FIELD.BRIDGE_NORTH)) state.set(player, FIELD.BRIDGE_NORTH, 1);
      if (!state.get(player, FIELD.BRIDGE_SOUTH)) state.set(player, FIELD.BRIDGE_SOUTH, 1);
    }
    player.getPacketSender().sendSoundEffect(SOUND.LOCKED, 1, 0);
    // Doors.plugin opens it as a pass-through gate.
    api.emitCustomEvent("door:open", { player, object, handled: false });
    return true;
  }

  /** The chest by the mausoleum's ladder holds another key (tick 1117), and is empty while one is carried (Wiki). */
  function searchChest(event) {
    const { player, objectId } = event;
    if (objectId !== LOC.CHEST_OPEN) return false;
    if (held(player, ITEM.CAVERN_KEY)) {
      player.sendMessage("The chest is empty.");
      return true;
    }
    if (!common.room(player)) return true;
    player.getInventory().adds(ITEM.CAVERN_KEY, 1);
    box(player, "You take a key out of the chest.", ITEM.CAVERN_KEY);
    return true;
  }

  // ------------------------------------------------------------------------------------------
  // The brain and the head
  // ------------------------------------------------------------------------------------------

  /** Taking the jar on the bar is Roavar's sale (ticks 215-246); the jar stays on the bar. */
  function takeBrain(event) {
    if (event.groundItemId !== ITEM.BRAIN) return;
    event.handled = true;
    startTranscript(api, event.player, NPC.ROAVAR, PAGE, "decapitated-head-finding-the-brains");
  }

  /** "I'll buy one, please.": 50 coins for the brain, as the player's line shows (tick 240). */
  function buyBrain(event) {
    if (String(event.text ?? "").toLowerCase() !== "pickled brain" || event.kind === "message") return;
    if (!(event.pages ?? []).some((page) => page.page === PAGE)) return;
    const { player } = event;
    event.handled = true;
    const inventory = player.getInventory();
    if (inventory.getAmount(ITEM.COINS) < 50 || held(player, ITEM.BRAIN) || held(player, ITEM.HEAD_WITH_BRAIN)) {
      event.end = true;
      return;
    }
    const plan = new api.core.Inventory(player).setItems(inventory.getCopiedItems());
    plan.deleted(ITEM.COINS, 50, false);
    if (plan.getAddableAmount(new api.core.Item(ITEM.BRAIN, 1)) < 1) {
      // Ours: no capture buys with a full pack.
      player.sendMessage("You don't have enough inventory space.");
      event.end = true;
      return;
    }
    inventory.deleteNumber(ITEM.COINS, 50);
    inventory.adds(ITEM.BRAIN, 1);
  }

  /** The brain into the head (tick 943). */
  function brainIntoHead(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const ids = new Set([usedItemId, usedWithItemId]);
    if (!ids.has(ITEM.HEAD) || !ids.has(ITEM.BRAIN)) return false;
    event.handled = true;
    player.getInventory().deleteNumber(ITEM.HEAD, 1);
    player.getInventory().deleteNumber(ITEM.BRAIN, 1);
    player.getInventory().adds(ITEM.HEAD_WITH_BRAIN, 1);
    box(player, "You squeeze the pickled brain into the decapitated head.", ITEM.HEAD_WITH_BRAIN);
    return true;
  }

  api.onItemAction("Spade", { Dig: digWithSpade });
  api.onObjectInteraction("Grave", { Dig: digGrave, Read: readGrave });
  api.onItemOnObject(spadeOnGrave, { noted: false });
  api.onObjectInteraction("Memorial", { Push: pushMemorial, Search: searchMemorial });
  api.onItemOnObject(starOnMemorial, { noted: false });
  api.onCustomEvent("npc-drops:quest-item", cavernKeyDrop);
  api.onNpcAttackOption(spareExperiment);
  api.onObjectInteraction("Entrance", { Open: mausoleumDoor });
  api.onObjectInteraction("Chest", { Search: searchChest });
  api.onGroundItemPickup(takeBrain);
  api.onCustomEvent("npc-dialogue:action", buyBrain);
  api.onItemOnItem(brainIntoHead);
};
