/**
 * Sheep Herder (members).
 *
 * The words come from the "Sheep Herder", "Councillor Halgrive", "Doctor Orbon"
 * and "Farmer Brumty" transcript pages; all four speakers are indexed. This plugin
 * selects the variant by stage, answers the prose conditions, runs the start hook,
 * grants the poisoned sheep feed, sells the protective suit through the buy-branch
 * choice, and drives the herding loop: prod each coloured sheep into the pen, feed
 * it, then burn its bones in the incinerator.
 *
 * Stages (varp 60): 1 needs protective clothing, 2 disposing the sheep, 3 complete.
 * The per-sheep progress (0 loose / 1 penned / 2 bones / 6 burnt) is kept in the
 * persisted "quest.sheep_herder.disposal" attribute (varp 61 is bit-packed in the
 * reference). The coloured sheep are spawned owner-only when the player enters the
 * farm zone.
 *
 * Gaps (no dump/index support): the enclosure gate/door objects are handled by id
 * (166/167); the reference's temporary object state and NPC movement simulation
 * are not reproduced; the mourner-outfit and Song of the Elves dialogue branches
 * are not selected.
 */
module.exports = function registerSheepHerderQuest(api) {
  const {
    Skill,
    Equipment,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
  } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const HALGRIVE_NPC_IDS = new Set([
    NpcIdentifiers.COUNCILLOR_HALGRIVE,
    NpcIdentifiers.COUNCILLOR_HALGRIVE_2,
    NpcIdentifiers.COUNCILLOR_HALGRIVE_3,
    NpcIdentifiers.COUNCILLOR_HALGRIVE_4,
  ]);
  const ORBON_NPC_ID = NpcIdentifiers.DOCTOR_ORBON;
  const BRUMTY_NPC_ID = NpcIdentifiers.FARMER_BRUMTY;

  const VARP_SHEEP_HERDER = 60;
  const STAGE_STARTED = 1;
  const STAGE_DISPOSING = 2;
  const STAGE_COMPLETE = 3;

  const FEED_ITEM_ID = ItemIdentifiers.SHEEP_FEED;
  const PROD_ITEM_ID = ItemIdentifiers.CATTLEPROD;
  const JACKET_ITEM_ID = ItemIdentifiers.PLAGUE_JACKET;
  const TROUSERS_ITEM_ID = ItemIdentifiers.PLAGUE_TROUSERS;
  const COINS_ITEM_ID = ItemIdentifiers.COINS;
  const COST = 100;

  const INCINERATOR_LOC_ID = ObjectIdentifiers.INCINERATOR; // 165
  const GATE_LOC_IDS = new Set([ObjectIdentifiers.GATE_14, ObjectIdentifiers.GATE_15]); // 166,167

  const START_HOOK = "quest:sheep-herder:start";
  const START_FEED_STEP_ID = "4mmYvE";
  const LOST_FEED_STEP_ID = "RZpIEQ";
  const COMPLETE_ACTION_ID = "CTPMIp";
  const DOCTOR_BUY_STEP_ID = "GU1VZY";

  const DISPOSAL_ATTRIBUTE = "quest.sheep_herder.disposal";

  const SHEEP = [
    {
      npcId: NpcIdentifiers.RED_SHEEP,
      name: "Red Sheep",
      bones: ItemIdentifiers.SHEEP_BONES_1_, // red bones (280)
      start: { x: 2605, y: 3343, z: 0 },
      pen: { x: 2596, y: 3362, z: 0 },
    },
    {
      npcId: NpcIdentifiers.GREEN_SHEEP,
      name: "Green Sheep",
      bones: ItemIdentifiers.SHEEP_BONES_2_, // green bones (281)
      start: { x: 2616, y: 3348, z: 0 },
      pen: { x: 2597, y: 3363, z: 0 },
    },
    {
      npcId: NpcIdentifiers.BLUE_SHEEP,
      name: "Blue Sheep",
      bones: ItemIdentifiers.SHEEP_BONES_3_, // blue bones (282)
      start: { x: 2612, y: 3371, z: 0 },
      pen: { x: 2597, y: 3360, z: 0 },
    },
    {
      npcId: NpcIdentifiers.YELLOW_SHEEP,
      name: "Yellow Sheep",
      bones: ItemIdentifiers.SHEEP_BONES_4_, // yellow bones (283)
      start: { x: 2583, y: 3374, z: 0 },
      pen: { x: 2596, y: 3359, z: 0 },
    },
  ];
  const SHEEP_BY_NPC = new Map(SHEEP.map((sheep) => [sheep.npcId, sheep]));
  const BONES_BY_ITEM = new Map(SHEEP.map((sheep) => [sheep.bones, sheep]));

  const FARM_ZONE = {
    minX: 2576,
    maxX: 2624,
    minY: 3336,
    maxY: 3380,
    levels: [0],
  };

  let quest;
  const sheepByPlayer = new Map();

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull()
        ? 0
        : 28;
  }

  function progress(player, index) {
    const value = Number(player.getAttribute(DISPOSAL_ATTRIBUTE)) || 0;
    return (value >>> (index * 3)) & 0x7;
  }

  function setProgress(player, index, value) {
    const shift = index * 3;
    const current = Number(player.getAttribute(DISPOSAL_ATTRIBUTE)) || 0;
    const next = (current & ~(0x7 << shift)) | ((value & 0x7) << shift);
    player.setAttribute(DISPOSAL_ATTRIBUTE, next);
  }

  function allSheepDisposed(player) {
    return SHEEP.every((_, index) => progress(player, index) === 6);
  }

  function hasSuit(player) {
    return held(player, JACKET_ITEM_ID) && held(player, TROUSERS_ITEM_ID);
  }

  function wearingSuit(player) {
    const equipment = player.getEquipment();
    return (
      equipment.get(Equipment.BODY_SLOT)?.getId?.() === JACKET_ITEM_ID &&
      equipment.get(Equipment.LEG_SLOT)?.getId?.() === TROUSERS_ITEM_ID
    );
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage <= 0) {
      return [
        "I can start this quest by speaking to <col=800000>Councillor Halgrive</col>",
        "outside the church near the East Ardougne zoo.",
      ];
    }
    const lines = [
      "<str>Councillor Halgrive asked me to dispose of four diseased sheep.</str>",
      "<str>He gave me poisoned sheep feed.</str>",
      "",
    ];
    if (stage === STAGE_STARTED) {
      lines.push("I need to buy protective clothing from <col=800000>Doctor Orbon</col> for 100 coins.");
      return lines;
    }
    lines.push("I must equip the plague suit and cattleprod, herd each sheep into the pen, poison it, and burn its bones.");
    SHEEP.forEach((sheep, index) => {
      const value = progress(player, index);
      lines.push(
        value === 6
          ? `<str>${sheep.name}'s remains have been incinerated.</str>`
          : value === 2
            ? `${sheep.name}'s bones must be burned in the <col=800000>incinerator</col>.`
            : value === 1
              ? `${sheep.name} is in the pen and must be given <col=800000>sheep feed</col>.`
              : `${sheep.name} must be herded into the enclosure.`
      );
    });
    if (stage >= STAGE_COMPLETE) {
      lines.push("", "<str>I disposed of all four sheep and claimed Halgrive's reward.</str>", "", "<col=ff0000>QUEST COMPLETE!</col>");
    }
    return lines;
  }

  function grantReward(player) {
    player.getInventory().adds(COINS_ITEM_ID, 3099);
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (HALGRIVE_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return "standard-dialogue-after-sheep-herder";
      if (stage >= STAGE_DISPOSING) {
        return allSheepDisposed(player)
          ? "finishing-up-talking-to-councillor-halgrive-after-burning-all-bones"
          : "starting-out-talking-to-councillor-halgrive-after-getting-the-gear";
      }
      if (stage >= STAGE_STARTED) {
        return "starting-out-talking-to-councillor-halgrive-talking-to-councillor-halgrive-again";
      }
      return "starting-out-talking-to-councillor-halgrive";
    }
    if (npcId === ORBON_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return "standard-dialogue-after-song-of-the-elves";
      if (stage >= STAGE_DISPOSING) return "starting-out-talking-to-doctor-orbon-talking-to-doctor-orbon-again";
      if (stage >= STAGE_STARTED) return "starting-out-talking-to-doctor-orbon";
      return "standard-dialogue-before-song-of-the-elves";
    }
    if (npcId === BRUMTY_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return "after-the-completion-of-sheep-herder";
      if (stage >= STAGE_STARTED) return "herding-the-sheep-talking-to-farmer-brumty";
      return "starting-out-talking-to-farmer-brunty";
    }
    return null;
  }

  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    const coins = player.getInventory().getAmount(COINS_ITEM_ID);
    if (value.includes("lost the sheep feed")) return !held(player, FEED_ITEM_ID);
    if (value.includes("still has the sheep feed")) return held(player, FEED_ITEM_ID);
    if (value.includes("not 2 free inventory spaces")) return coins >= COST && freeSlots(player) < 2;
    if (value.includes("2 free inventory spaces")) return coins >= COST && freeSlots(player) >= 2;
    if (
      value.includes("doesn't have 100 coins") ||
      value.includes("does not have the 100 coins") ||
      value.includes("does not have 100 coins")
    ) {
      return coins < COST;
    }
    if (value.includes("has 100 coins")) return coins >= COST;
    if (value.includes("does not have the gear")) return !hasSuit(player);
    if (value.includes("has the gear in their inventory")) return hasSuit(player);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!HALGRIVE_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  /** Buying the plague suit happens when the "100 coins + 2 slots" branch runs. */
  function handleDoctorPurchase(event) {
    if (event.npcId !== ORBON_NPC_ID || event.stepId !== DOCTOR_BUY_STEP_ID) return;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || quest.isComplete(player)) return;
    if (hasSuit(player)) {
      if (stage === STAGE_STARTED) quest.setStage(player, STAGE_DISPOSING);
      return;
    }
    const missing = [JACKET_ITEM_ID, TROUSERS_ITEM_ID].filter((itemId) => !held(player, itemId));
    if (player.getInventory().getAmount(COINS_ITEM_ID) < COST || freeSlots(player) < missing.length) return;
    player.getInventory().deleteNumber(COINS_ITEM_ID, COST);
    for (const itemId of missing) player.getInventory().adds(itemId, 1);
    if (stage === STAGE_STARTED) quest.setStage(player, STAGE_DISPOSING);
  }

  /** The start branch's poisoned-feed message and the lost-feed top-up. */
  function handleAction(event) {
    if (event.stepId === COMPLETE_ACTION_ID) {
      if (!event.player || quest.isComplete(event.player)) return;
      if (!allSheepDisposed(event.player)) return;
      clearSheep(event.player);
      quest.complete(event.player);
      event.handled = true;
      event.end = true;
      return;
    }
    if (event.stepId === START_FEED_STEP_ID || event.stepId === LOST_FEED_STEP_ID) {
      if (!HALGRIVE_NPC_IDS.has(event.npcId)) return;
      if (!held(event.player, FEED_ITEM_ID)) event.player.getInventory().adds(FEED_ITEM_ID, 1);
    }
  }

  function trackedFor(player, index) {
    return sheepByPlayer.get(player)?.get(index);
  }

  function setTracked(player, index, npc) {
    const tracked = sheepByPlayer.get(player) ?? new Map();
    if (npc) tracked.set(index, npc);
    else tracked.delete(index);
    if (tracked.size === 0) sheepByPlayer.delete(player);
    else sheepByPlayer.set(player, tracked);
  }

  function spawnSheep(player, index, inPen) {
    const sheep = SHEEP[index];
    const existing = trackedFor(player, index);
    if (existing) api.removeNpc(existing);
    const tile = inPen ? sheep.pen : sheep.start;
    const npc = api.spawnNpc({
      id: sheep.npcId,
      x: tile.x,
      y: tile.y,
      z: tile.z,
      wanderRadius: inPen ? 1 : 3,
      owner: player,
      ownerOnly: true,
    });
    if (npc) setTracked(player, index, npc);
  }

  function ensureSheep(player) {
    if (quest.getStage(player) !== STAGE_DISPOSING) return;
    SHEEP.forEach((_, index) => {
      const value = progress(player, index);
      if (value === 2 || value === 6) {
        const existing = trackedFor(player, index);
        if (existing) {
          api.removeNpc(existing);
          setTracked(player, index, null);
        }
        return;
      }
      if (!trackedFor(player, index)) spawnSheep(player, index, value === 1);
    });
  }

  function clearSheep(player) {
    const tracked = sheepByPlayer.get(player);
    if (tracked) for (const npc of tracked.values()) api.removeNpc(npc);
    sheepByPlayer.delete(player);
  }

  function isPlayersSheep(player, index, npc) {
    const tracked = trackedFor(player, index);
    return Boolean(tracked && npc && tracked.getId?.() === npc.getId?.());
  }

  /** Prod a penned sheep with the cattleprod while wearing the suit. */
  function handleNpcInteraction(event) {
    const index = SHEEP.findIndex((sheep) => sheep.npcId === event.npcId);
    if (index === -1) return;
    const action = (event.definition?.getActions?.() ?? [])[event.clickType - 1];
    if (String(action).toLowerCase() !== "prod") return;
    const { player } = event;
    if (!isPlayersSheep(player, index, event.npc)) return;
    event.handled = true;
    if (quest.getStage(player) !== STAGE_DISPOSING) {
      player.sendMessage("You have no reason to interfere with this sheep.");
      return;
    }
    if (!wearingSuit(player)) {
      player.sendMessage("You need to wear the full protective plague suit.");
      return;
    }
    if (player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.() !== PROD_ITEM_ID) {
      player.sendMessage("You need to equip the cattleprod first.");
      return;
    }
    if (progress(player, index) !== 0) {
      player.sendMessage("This sheep is already in the enclosure.");
      return;
    }
    setProgress(player, index, 1);
    spawnSheep(player, index, true);
    player.sendMessage("The sheep obligingly jumps over the gate and into the enclosure!");
  }

  /** Poison the penned sheep and collect its bones. */
  function handleItemOnNpc(event) {
    if (event.itemId !== FEED_ITEM_ID) return;
    const index = SHEEP.findIndex((sheep) => sheep.npcId === event.target?.getId?.());
    if (index === -1) return;
    const { player } = event;
    if (!isPlayersSheep(player, index, event.target)) return;
    event.handled = true;
    if (progress(player, index) !== 1) {
      player.sendMessage("The sheep must be safely inside the enclosure first.");
      return;
    }
    if (freeSlots(player) < 1) {
      player.sendMessage("You need a free inventory space for the sheep's remains.");
      return;
    }
    setProgress(player, index, 2);
    api.removeNpc(event.target);
    setTracked(player, index, null);
    player.getInventory().adds(SHEEP[index].bones, 1);
    player.sendMessage("The sheep eats the poisoned feed and collapses. You collect its remains.");
  }

  /** Burn the collected bones in the incinerator. */
  function handleItemOnObject(event) {
    if (event.objectId !== INCINERATOR_LOC_ID) return;
    const sheep = BONES_BY_ITEM.get(event.itemId);
    if (!sheep) return;
    const index = SHEEP.indexOf(sheep);
    const { player } = event;
    event.handled = true;
    if (progress(player, index) !== 2) return;
    player.getInventory().deleteNumber(event.itemId, 1);
    setProgress(player, index, 6);
    player.sendMessage("You put the remains into the incinerator. They burn to dust.");
  }

  /** The enclosure gate refuses entry without the suit. */
  function handleObjectInteraction(event) {
    if (!GATE_LOC_IDS.has(event.objectId)) return;
    const { player, location } = event;
    const entering = player.getLocation().getX() <= location.x;
    if (entering && !wearingSuit(player)) {
      event.handled = true;
      player.sendMessage("You cannot enter without protective clothing.");
      return;
    }
    event.handled = true;
    player.moveTo(new api.core.Location(location.x + (entering ? 1 : -1), location.y, location.z));
  }

  function handleZoneEnter({ player }) {
    if (player?.isPlayerBot?.() === true) return;
    ensureSheep(player);
  }

  function handleLogout({ player }) {
    if (player) clearSheep(player);
  }

  function handleLogin({ player }) {
    ensureSheep(player);
    refreshQuestList(player);
  }

  api.persistAttribute(DISPOSAL_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "sheep_herder",
    name: "Sheep Herder",
    varpId: VARP_SHEEP_HERDER,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 4,
    rewardItemId: COINS_ITEM_ID,
    rewardItemLabel: "3,100 Coins",
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleDoctorPurchase);
  api.onNpcInteraction(handleNpcInteraction);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onObjectInteraction(handleObjectInteraction);
  api.onZoneEnter(FARM_ZONE, handleZoneEnter);
  api.onPlayerLogout(handleLogout);
  api.onPlayerLogin(handleLogin);
};
