/**
 * The Ascent of Arceuus (members).
 *
 * The words come from the "The Ascent of Arceuus" transcript page; this plugin
 * supplies the variant selectors for Mori, Councillor Andrews, the Tower Mages,
 * Asteros Arceuus, the three Tasakaal and Lord Trobin Arceuus, the requirements
 * gate, the Tower of Magic soul fight, the ancient-grave tracking trail, the
 * trapped soul, the Dark Altar device and the completion.
 *
 * Stage (varbit 7856 "arcquest", varp 2071 "arcquest_main" bits 0-5; the stub's
 * varp 7900 is a placeholder). The stage values are the cache multi-loc
 * checkpoints, confirmed by reading every varbit-loc transform table in the
 * maps and the quest NPC transforms:
 *   0 not started
 *   1 accepted the search from Mori
 *   2 told Councillor Andrews (Kourend Castle)
 *   3 Mori sent me to Lord Arceuus in the Tower of Magic
 *   4 entered the Tower (5 Tormented Souls, action l8anSu)
 *   5 souls dealt with, Asteros upstairs
 *   6 Asteros sent me to the Tasakaal at Mount Karuulm
 *   7 the Tasakaal are talking (transient)
 *   8 task given: free the trapped soul (grave opens; 34602 at 1347,3736
 *     resolves to 33578 "Ancient Grave" Inspect from value 8)
 *   9 grave inspected, tracks found (trail objects 34621-34625 resolve to
 *     their Inspect children from value 9)
 *  10 the trapped soul has jumped out
 *  11 trapped soul freed
 *  12 Tasakaal revealed the device (Dark Altar rocks 34626/34627 resolve to
 *     33593/33595 Inspect from value 12; device location in varbit 7865)
 *  13 device smashed, Asteros waiting to thank me, Lord Trobin talkable
 *     (entranced Lord Trobin NPC 8624 disappears at 13)
 *  14 complete (Mori's post-quest id 8502 first appears at 14; the world
 *     Mori 7208 stops resolving from stage 6)
 * Other cache evidence: the pond object 34601 at 1700,3742 shows Dead Body
 * (0), Thana (1-5) and the Bright crystal (6+), matching stage 6.
 *
 * Wiki requirements: Client of Kourend (with X Marks the Spot) and 12 Hunter
 * (not boostable). Kourend favour was removed on 10 January 2024, so none is
 * required or rewarded. Rewards: 1 Quest point, 2,000 coins, 1,500 Hunter,
 * 500 Runecraft and the A Dark Disposition page for Kharedst's memoirs.
 *
 * Source: OSRS Wiki "The Ascent of Arceuus", its quick guide and transcript;
 * cache ids from the generated identifiers and the cache's varbit-loc tables.
 *
 * Gaps/approximations:
 *  - the tracking segment is six Inspect clicks on the trail's Tree stump /
 *    Bush / Plant multi-locs (34621-34625), each revealing the next footprint
 *    varbit (7859-7864); OSRS picks the stops in path order and the last one
 *    is the hiding plant, which this does not enforce. The per-stop search
 *    messages are not in the transcript, so a short neutral line is sent.
 *  - the device rock is picked at random (varbit 7865); inspecting the other
 *    three rocks does nothing (no transcript text exists for a failed search).
 *  - the Tormented Soul fight is five owner-only spawns (8512/8513) placed in
 *    the tower when the Tower Mage lets you in; the kill count is persisted so
 *    a relog resumes rather than resets.
 *  - the tower doors (33570/33572) are unhandled by Doors.plugin (their open
 *    variants have no actions), so this plugin passes the player through them
 *    once inside the quest (stage >= 4). Before that, the door click starts the
 *    Tower Mage's entry prompt once Mori has sent the player there (stage 3);
 *    earlier stages are refused.
 *  - the world Mori (7208) resolves to her named variant 8501 only while the
 *    stage varbit is 0-5; the separate world spawn 7375 transforms to post-quest
 *    Mori 8502 at stage 14.
 *  - Lord Trobin is only owner-spawned at stage >= 13 (his talkable id 8505);
 *    the entranced id 8504 seen during the quest is the canonical world NPC.
 *    Andrews and Asteros use their canonical world transforms (11152/10889).
 *  - Mount Karuulm travel uses the shared 34359 elevator and 34514 cave-exit
 *    loc-teleport rows; the plugin itself does not move the player there.
 *  - a lost A Dark Disposition page is replaced by Lord Trobin's canonical
 *    lost-page branch only before varbit 7917 records it in the memoir.
 *  - the "ghost busting" overhead shouts are not played; a Tower Mage talked
 *    to during the fight says the one-line ghost-busting variant instead.
 */
module.exports = function registerAscentOfArceuusQuest(api) {
  const {
    Location,
    Skill,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "The Ascent of Arceuus";
  const START_HOOK = "quest:the-ascent-of-arceuus:start";
  const CLIENT_OF_KOUREND_KEY = "client_of_kourend";
  const AKD_KEY = "a_kingdom_divided";
  // A Kingdom Divided's Lord Arceuus favour window owns the shared Tasakaal.
  const AKD_STAGE_MEETING = 122;
  const AKD_STAGE_ACCORD = 138;

  // Varp 2071 "arcquest_main" (scripts/lookup-gameval.ts varbit arcquest).
  const VARP_ARCEUUS_QUESTS = 2071;
  const VARBIT_STAGE = 7856; // "arcquest", bits 0-5
  const VARBIT_DEVICE_LOCATION = 7865; // "arcquest_device_location", bits 14-15
  const TRAIL_VARBITS = [7859, 7860, 7861, 7862, 7863, 7864]; // "arcquest_hunting_trail_1..6"

  const STAGE_STARTED = 1;
  const STAGE_ANDREWS = 2;
  const STAGE_MORI_RETURNED = 3;
  const STAGE_TOWER = 4;
  const STAGE_SOULS_CLEARED = 5;
  const STAGE_ASTEROS = 6;
  const STAGE_TASAKAAL = 7;
  const STAGE_GRAVE = 8;
  const STAGE_TRACKING = 9;
  const STAGE_SOUL_FOUND = 10;
  const STAGE_SOUL_FREED = 11;
  const STAGE_DEVICE = 12;
  const STAGE_DEVICE_DESTROYED = 13;
  const STAGE_COMPLETE = 14;

  const HUNTER_REQUIREMENT = 12;
  const TRAIL_STEPS = TRAIL_VARBITS.length;
  const SOUL_COUNT = 5;

  // Condition step ids on the "The Ascent of Arceuus" page.
  const NO_REQUIREMENTS_CONDITION_ID = "N4RBsP";
  const HAS_REQUIREMENTS_CONDITION_ID = "1lc8lO";
  // Action/message step ids.
  const ENTER_TOWER_ACTION_ID = "l8anSu";
  const ENTER_TOWER_VARIANT = "a-death-entering-the-tower-of-magic";
  const DEVICE_SMASH_MESSAGE_ID = "mMumh3";
  const COMPLETE_ACTION_ID = "vkpouM";
  const NON_QUEST_ACTION_ID = "3FLk-6";

  const MORI_PRE_QUEST_NPC_ID = NpcIdentifiers.MORI; // 8501, from world parent 7208
  const MORI_POST_QUEST_NPC_ID = NpcIdentifiers.MORI_2; // 8502, from world parent 7375
  const MORI_NPC_IDS = new Set([MORI_PRE_QUEST_NPC_ID, MORI_POST_QUEST_NPC_ID]);
  const ANDREWS_NPC_IDS = new Set([
    NpcIdentifiers.COUNCILLOR_ANDREWS, // 10926
    NpcIdentifiers.COUNCILLOR_ANDREWS_2, // 11152
  ]);
  const TOWER_MAGE_NPC_IDS = new Set([
    NpcIdentifiers.TOWER_MAGE, // 7052, at the doors
    NpcIdentifiers.TOWER_MAGE_2, // 8507
    NpcIdentifiers.TOWER_MAGE_3, // 8508
    NpcIdentifiers.TOWER_MAGE_4, // 8509
    NpcIdentifiers.TOWER_MAGE_5, // 8510
    NpcIdentifiers.TOWER_MAGE_6, // 8511
  ]);
  const ASTEROS_NPC_IDS = new Set([
    NpcIdentifiers.ASTEROS_ARCEUUS, // 10889
    NpcIdentifiers.ASTEROS_ARCEUUS_2, // 10978
    NpcIdentifiers.ASTEROS_ARCEUUS_3, // 10979
  ]);
  const TASAKAAL_NPC_IDS = new Set([
    NpcIdentifiers.KAAL_KET_JOR, // 8602
    NpcIdentifiers.KAAL_MEJ_SAN, // 8603
    NpcIdentifiers.KAAL_XIL_DAR, // 8604
  ]);
  const LORD_TROBIN_NPC_IDS = new Set([
    NpcIdentifiers.LORD_TROBIN_ARCEUUS, // 8504, entranced (not spawned here)
    NpcIdentifiers.LORD_TROBIN_ARCEUUS_2, // 8505
    NpcIdentifiers.LORD_TROBIN_ARCEUUS_3, // 10961
    NpcIdentifiers.LORD_TROBIN_ARCEUUS_4, // 10962
  ]);
  const TORMENTED_SOUL_NPC_IDS = new Set([
    NpcIdentifiers.TORMENTED_SOUL, // 8512
    NpcIdentifiers.TORMENTED_SOUL_2, // 8513
  ]);
  const TRAPPED_SOUL_NPC_ID = NpcIdentifiers.TRAPPED_SOUL; // 8514

  const TROBIN_NPC_ID = NpcIdentifiers.LORD_TROBIN_ARCEUUS_2;
  const KAAL_XIL_DAR_NPC_ID = NpcIdentifiers.KAAL_XIL_DAR;
  const TOWER_MAGE_NPC_ID = NpcIdentifiers.TOWER_MAGE; // 7052, guards the tower doors

  const COINS_ITEM_ID = ItemIdentifiers.COINS; // 995
  const DARK_DISPOSITION_ITEM_ID = ItemIdentifiers.A_DARK_DISPOSITION; // 21770
  const MEMOIRS_ITEM_IDS = new Set([
    ItemIdentifiers.KHAREDSTS_MEMOIRS, // 21760
    ItemIdentifiers.KHAREDSTS_MEMOIRS_2, // 21761
  ]);
  const MEMOIRS_ITEM_ID = ItemIdentifiers.KHAREDSTS_MEMOIRS; // 21760
  const MEMOIR_ARC_TELEPORT_VARBIT = 7917; // kourend_diary_arc_teleport
  const MEMOIR_PAGE_ATTRIBUTE = "quest.the_ascent_of_arceuus.memoir-page";
  const LOST_PAGE_VARIANT = "if-the-player-lost-the-memoir-page-before-using-it-on-the-memoir";
  const LOST_PAGE_GIFT_LINE = "Thank you for helping our people. Please accept these gifts, they are the least you deserve.";

  // Tower doors (Door 33570/33572 at 1596,3819-3820): no open variant, so the
  // shared Doors plugin leaves them alone.
  const TOWER_DOOR_IDS = new Set([
    ObjectIdentifiers.DOOR_574, // 33570
    ObjectIdentifiers.DOOR_576, // 33572
  ]);

  // Quest multi-locs (cache parents, not named by ObjectIdentifiers; the click
  // carries the parent id while event.definition is the varbit-resolved child).
  const GRAVE_MULTILOC = 34602; // -> 33579 closed / 33578 Inspect (stage 8-11)
  const TRAIL_MULTILOC_IDS = new Set([34621, 34622, 34623, 34624, 34625]);
  // Cache gameval ids 34621 stump, 34622 bush, 34623 plant, 34624 plant2,
  // 34625 final plant. These are the QH inspectTrack1..6 route tiles, using the
  // 2x2 objects' cache origins (QH markers sit inside their footprints).
  const TRAIL_STOPS = [
    { id: 34622, x: 1335, y: 3743 }, // QH track 1 bush
    { id: 34623, x: 1317, y: 3750 }, // QH track 2 plant
    { id: 34623, x: 1305, y: 3750 }, // QH track 3 plant
    { id: 34621, x: 1287, y: 3750 }, // QH track 4 tree stump (marker 1288,3751)
    { id: 34624, x: 1285, y: 3737 }, // QH track 5 plant2 (marker 1286,3738)
    { id: 34625, x: 1281, y: 3725 }, // QH track 6 final plant (marker 1282,3726)
  ];
  const ROCKS_MULTILOC_IDS = new Set([
    34626, // -> Rocks 33594/33593, Inspect from stage 12
    34627, // -> Rocks 33596/33595
  ]);

  const TOWER_ZONE = { minX: 1568, maxX: 1600, minY: 3804, maxY: 3840, levels: [0, 1] };
  const TOWER_INTERIOR = { x: 1589, y: 3819 };
  const TROBIN_TILE = { x: 1577, y: 3821 };
  const TRAPPED_SOUL_TILE = { x: 1281, y: 3724 };
  const SOUL_SPAWNS = [
    { x: 1580, y: 3815 },
    { x: 1582, y: 3825 },
    { x: 1585, y: 3812 },
    { x: 1587, y: 3827 },
    { x: 1590, y: 3816 },
  ];
  // The four placed Dark Altar rocks; varbit 7865 picks which holds the device.
  const DEVICE_ROCK_TILES = [
    { x: 1706, y: 3888 }, // 34626
    { x: 1713, y: 3892 }, // 34626
    { x: 1713, y: 3875 }, // 34627
    { x: 1722, y: 3881 }, // 34627
  ];

  const TRAIL_ATTRIBUTE = "quest.the_ascent_of_arceuus.trail";
  const SOULS_ATTRIBUTE = "quest.the_ascent_of_arceuus.souls";
  const DEVICE_ATTRIBUTE = "quest.the_ascent_of_arceuus.device";

  let quest;
  const trackedNpcs = new Map();

  function questComplete(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function clientOfKourendComplete(player) {
    return questComplete(player, CLIENT_OF_KOUREND_KEY);
  }

  function questStage(player, key) {
    const request = { player, key, stage: null };
    api.emitCustomEvent("quest:get-stage", request);
    if (Number.isFinite(request.stage)) return request.stage | 0;
    return Number(player.getAttribute(`quest.${key}.stage`)) || 0;
  }

  function bankHasItem(player, itemId) {
    if (typeof player.getBanks === "function") {
      const banks = player.getBanks() ?? [];
      if (banks.some((bank) => bank?.getAmount?.(itemId) > 0)) return true;
    }
    return (player.getBank?.()?.getAmount?.(itemId) ?? 0) > 0;
  }

  function ownsItem(player, itemId) {
    return player.getInventory().getAmount(itemId) > 0 || bankHasItem(player, itemId);
  }

  /** Grants an item the way QuestRuntime does: a full bag drops it, never loses it. */
  function grantItem(player, itemId, amount = 1) {
    const inventory = player.getInventory();
    if (inventory.isFull()) inventory.forceAdd(player, new api.core.Item(itemId, amount));
    else inventory.adds(itemId, amount);
  }

  function pageAddedToMemoir(player) {
    return Number(player.getAttribute(MEMOIR_PAGE_ATTRIBUTE)) === 1 ||
      (player.getPacketSender().getVarbit(MEMOIR_ARC_TELEPORT_VARBIT) ?? 0) !== 0;
  }

  function pageAwaitingPickup(player) {
    const username = player.getUsername();
    return api.core.World.getItems().some((groundItem) =>
      !groundItem.isPendingRemoval() &&
      groundItem.getOwner() === username &&
      groundItem.getItem().getId() === DARK_DISPOSITION_ITEM_ID
    );
  }

  /** The canonical lost-page branch applies only before the page is added to the memoir. */
  function lostPagePending(player) {
    return quest.getStage(player) >= STAGE_COMPLETE &&
      !ownsItem(player, DARK_DISPOSITION_ITEM_ID) &&
      !pageAwaitingPickup(player) &&
      ownsItem(player, MEMOIRS_ITEM_ID) &&
      !pageAddedToMemoir(player);
  }

  function meetsRequirements(player) {
    return clientOfKourendComplete(player) &&
      player.getSkillManager().getMaxLevel(Skill.HUNTER) >= HUNTER_REQUIREMENT;
  }

  function trailProgress(player) {
    return Number(player.getAttribute(TRAIL_ATTRIBUTE)) || 0;
  }

  function soulsKilled(player) {
    return Number(player.getAttribute(SOULS_ATTRIBUTE)) || 0;
  }

  function deviceLocation(player) {
    const value = Number(player.getAttribute(DEVICE_ATTRIBUTE));
    return Number.isInteger(value) && value >= 0 && value < DEVICE_ROCK_TILES.length ? value : 0;
  }

  function setTrailVarbits(player, progress) {
    const sender = player.getPacketSender();
    for (let index = 0; index < TRAIL_VARBITS.length; index++) {
      sender.sendVarbit(TRAIL_VARBITS[index], index < progress ? 1 : 0);
    }
  }

  function trailVarbitCount(player) {
    if (quest.isComplete(player) || quest.getStage(player) < STAGE_TRACKING) return 0;
    return Math.min(TRAIL_VARBITS.length, trailProgress(player) + 1);
  }

  function syncVarbits(player) {
    setTrailVarbits(player, trailVarbitCount(player));
    if (quest.getStage(player) >= STAGE_DEVICE) {
      player.getPacketSender().sendVarbit(VARBIT_DEVICE_LOCATION, deviceLocation(player));
    }
    if (Number(player.getAttribute(MEMOIR_PAGE_ATTRIBUTE)) === 1) {
      player.getPacketSender().sendVarbit(MEMOIR_ARC_TELEPORT_VARBIT, 1);
    }
  }

  // ==========================================================================
  // NPC spawns (all owner-only; Arceuus/Castle NPCs are not in npc-spawns.json)
  // ==========================================================================

  function ensureTracked(player, key, definition) {
    const tracked = trackedNpcs.get(player) ?? new Map();
    trackedNpcs.set(player, tracked);
    if (tracked.get(key)) return tracked.get(key);
    const npc = api.spawnNpc({ ...definition, owner: player, ownerOnly: true });
    if (npc) tracked.set(key, npc);
    return npc;
  }

  function removeTracked(player, key) {
    const tracked = trackedNpcs.get(player);
    const npc = tracked?.get(key);
    if (!npc) return;
    api.removeNpc(npc);
    tracked.delete(key);
  }

  function removeSouls(player) {
    const tracked = trackedNpcs.get(player);
    if (!tracked) return;
    for (const key of [...tracked.keys()]) {
      if (key.startsWith("soul-")) removeTracked(player, key);
    }
  }

  function clearNpcs(player) {
    const tracked = trackedNpcs.get(player);
    if (!tracked) return;
    for (const npc of tracked.values()) api.removeNpc(npc);
    trackedNpcs.delete(player);
  }

  function spawnSouls(player) {
    const killed = soulsKilled(player);
    for (let index = killed; index < SOUL_COUNT; index++) {
      ensureTracked(player, `soul-${index}`, {
        id: index % 2 === 0 ? NpcIdentifiers.TORMENTED_SOUL : NpcIdentifiers.TORMENTED_SOUL_2,
        ...SOUL_SPAWNS[index],
        z: 0,
        wanderRadius: 0,
      });
    }
  }

  /** Keeps the owner-only quest NPCs in step with the stage. */
  function syncNpcs(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    const stage = quest.getStage(player);
    // The placed 7375 parent becomes canonical post-quest Mori 8502 at stage 14.
    if (stage >= STAGE_DEVICE_DESTROYED) {
      ensureTracked(player, "trobin", { id: TROBIN_NPC_ID, ...TROBIN_TILE, z: 1, wanderRadius: 0 });
    } else {
      removeTracked(player, "trobin");
    }
    if (stage === STAGE_TOWER) spawnSouls(player);
    else removeSouls(player);
    if (stage === STAGE_SOUL_FOUND) {
      ensureTracked(player, "trapped", { id: TRAPPED_SOUL_NPC_ID, ...TRAPPED_SOUL_TILE, z: 0, wanderRadius: 0 });
    } else {
      removeTracked(player, "trapped");
    }
  }

  // ==========================================================================
  // Dialogue variants and conditions
  // ==========================================================================

  function selectMoriVariant(stage, player) {
    if (stage <= 0) return "a-death-talking-to-mori";
    if (stage === STAGE_STARTED) return "a-death-talking-to-mori-talking-to-mori-again";
    if (stage === STAGE_ANDREWS) return "a-death-returning-to-mori";
    if (stage >= STAGE_COMPLETE) {
      return questComplete(player, AKD_KEY)
        ? "standard-dialogue-after-a-kingdom-divided"
        : "standard-dialogue-after-the-ascent-of-arceuus";
    }
    return "a-death-returning-to-mori-talking-to-mori-again";
  }

  function selectTowerMageVariant(stage) {
    if (stage === STAGE_MORI_RETURNED) return ENTER_TOWER_VARIANT;
    if (stage === STAGE_TOWER) return "a-death-entering-the-tower-of-magic-ghost-busting";
    if (stage === STAGE_SOULS_CLEARED) return "a-death-entering-the-tower-of-magic-post-ghost-bust";
    if (stage >= STAGE_ASTEROS) return "after-the-ascent-of-arceuus";
    return null;
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (MORI_NPC_IDS.has(npcId)) return selectMoriVariant(stage, player);
    if (ANDREWS_NPC_IDS.has(npcId)) {
      if (stage === STAGE_STARTED) return "a-death-talking-to-councillor-andrews";
      if (stage === STAGE_ANDREWS) return "a-death-talking-to-councillor-andrews-talking-to-councillor-andrews-again";
      return null;
    }
    if (TOWER_MAGE_NPC_IDS.has(npcId)) return selectTowerMageVariant(stage);
    if (ASTEROS_NPC_IDS.has(npcId)) {
      if (stage === STAGE_SOULS_CLEARED) return "a-death-talking-to-asteros-arceuus";
      if (stage >= STAGE_ASTEROS && stage <= STAGE_DEVICE) {
        return "a-death-talking-to-asteros-arceuus-talking-to-asteros-again";
      }
      if (stage === STAGE_DEVICE_DESTROYED) return "finishing-up-talking-to-asteros";
      return null;
    }
    if (TASAKAAL_NPC_IDS.has(npcId)) {
      // A Kingdom Divided's meeting-to-accord window owns the shared Tasakaal.
      const akdStage = questStage(player, AKD_KEY);
      if (stage >= STAGE_DEVICE && akdStage >= AKD_STAGE_MEETING && akdStage < AKD_STAGE_ACCORD) return null;
      if (stage === STAGE_ASTEROS || stage === STAGE_TASAKAAL) return "the-tasakaal-first-encounter";
      if (stage > STAGE_TASAKAAL && stage <= STAGE_SOUL_FOUND) {
        return "the-tasakaal-first-encounter-talking-to-the-tasakaal-again";
      }
      if (stage === STAGE_SOUL_FREED) {
        return "the-tasakaal-returning-to-the-tasakaal-after-freeing-the-trapped-soul";
      }
      if (stage >= STAGE_DEVICE && stage < STAGE_COMPLETE) {
        return "the-tasakaal-returning-to-the-tasakaal-after-freeing-the-trapped-soul-talking-to-the-tasakaal-again";
      }
      if (stage >= STAGE_COMPLETE) {
        if (npcId === KAAL_XIL_DAR_NPC_ID) {
          // A Kingdom Divided has its own post-quest line for Kaal-Xil-Dar and
          // owns him only in its 122-137 window, so the Ascent yields it there.
          return questComplete(player, AKD_KEY)
            ? "after-a-kingdom-divided"
            : "after-the-ascent-of-arceuus";
        }
        return "the-tasakaal-returning-to-the-tasakaal-after-freeing-the-trapped-soul-talking-to-the-tasakaal-again";
      }
      return null;
    }
    if (LORD_TROBIN_NPC_IDS.has(npcId)) {
      if (stage === STAGE_DEVICE_DESTROYED) return "finishing-up-talking-to-lord-arceuus";
      if (lostPagePending(player)) return LOST_PAGE_VARIANT;
      return null;
    }
    return null;
  }

  function answerCondition({ npcId, player, stepId }) {
    if (!MORI_NPC_IDS.has(npcId)) return null;
    if (stepId === NO_REQUIREMENTS_CONDITION_ID) return !meetsRequirements(player);
    if (stepId === HAS_REQUIREMENTS_CONDITION_ID) return meetsRequirements(player);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (hook !== START_HOOK || !MORI_NPC_IDS.has(npcId)) return;
    if (quest.getStage(player) === 0 && meetsRequirements(player)) {
      quest.setStage(player, STAGE_STARTED);
    }
  }

  function handleDialogueChoice({ npcId, player, option }) {
    if (!ANDREWS_NPC_IDS.has(npcId)) return;
    if (option === "There's been a death in Arceuus." && quest.getStage(player) === STAGE_STARTED) {
      quest.setStage(player, STAGE_ANDREWS);
    }
  }

  /** Stage hops that are only scripted as dialogue lines, keyed off the wiki text. */
  function handleDialogueLine(event) {
    const { player, npcId, text } = event;
    if (!player || typeof text !== "string") return;
    const stage = quest.getStage(player);
    if (MORI_NPC_IDS.has(npcId) && stage === STAGE_ANDREWS &&
        text === "He'll be in the Tower of Magic, north west of here.") {
      quest.setStage(player, STAGE_MORI_RETURNED);
      return;
    }
    if (ASTEROS_NPC_IDS.has(npcId) && stage === STAGE_SOULS_CLEARED &&
        text === "Thank you friend. You'll find Mount Karuulm on the other side of Lovakengj. Please hurry.") {
      quest.setStage(player, STAGE_ASTEROS);
      syncNpcs(player);
      return;
    }
    if (LORD_TROBIN_NPC_IDS.has(npcId) && text === LOST_PAGE_GIFT_LINE && lostPagePending(player)) {
      grantItem(player, DARK_DISPOSITION_ITEM_ID);
      return;
    }
    if (!TASAKAAL_NPC_IDS.has(npcId)) return;
    if (stage === STAGE_ASTEROS && text === "Human.") {
      quest.setStage(player, STAGE_TASAKAAL);
      return;
    }
    if (stage === STAGE_TASAKAAL && text === "Free this soul. In return, we will provide our help.") {
      quest.setStage(player, STAGE_GRAVE);
      return;
    }
    if (stage === STAGE_SOUL_FREED && text === "Find it. Destroy it.") {
      player.setAttribute(DEVICE_ATTRIBUTE, Math.floor(Math.random() * DEVICE_ROCK_TILES.length));
      quest.setStage(player, STAGE_DEVICE);
      syncVarbits(player);
      syncNpcs(player);
    }
  }

  // ==========================================================================
  // Quest actions
  // ==========================================================================

  function enterTower(player) {
    if (quest.getStage(player) !== STAGE_MORI_RETURNED) return;
    player.setAttribute(SOULS_ATTRIBUTE, 0);
    player.moveTo(new Location(TOWER_INTERIOR.x, TOWER_INTERIOR.y, 0));
    quest.setStage(player, STAGE_TOWER);
    syncNpcs(player);
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (stepId === ENTER_TOWER_ACTION_ID && TOWER_MAGE_NPC_IDS.has(npcId)) {
      event.handled = true;
      enterTower(player);
      return;
    }
    if (stepId === DEVICE_SMASH_MESSAGE_ID && TASAKAAL_NPC_IDS.has(npcId)) {
      // Leave the event unhandled so the wiki smash message plays.
      if (quest.getStage(player) === STAGE_DEVICE) {
        quest.setStage(player, STAGE_DEVICE_DESTROYED);
        syncNpcs(player);
      }
      return;
    }
    if (stepId === COMPLETE_ACTION_ID && LORD_TROBIN_NPC_IDS.has(npcId)) {
      event.handled = true;
      if (quest.getStage(player) === STAGE_DEVICE_DESTROYED && !quest.isComplete(player)) {
        quest.complete(player);
        syncNpcs(player);
        syncVarbits(player); // clears the trail footprint varbits at stage 14
      }
      return;
    }
    if (stepId === NON_QUEST_ACTION_ID && LORD_TROBIN_NPC_IDS.has(npcId)) {
      event.handled = true;
      event.end = true;
    }
  }

  // ==========================================================================
  // Objects
  // ==========================================================================

  /** Mirror the player to the tile past a door tile (the object blocks walking). */
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

  function inspectGrave(event) {
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) !== STAGE_GRAVE) return;
    player.setAttribute(TRAIL_ATTRIBUTE, 0);
    setTrailVarbits(player, 1); // the grave itself reveals the first footprints
    quest.setStage(player, STAGE_TRACKING);
    player.sendMessage("You inspect the grave and find tracks leading away.");
  }

  function inspectTrail(event) {
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) !== STAGE_TRACKING) return;
    const progress = trailProgress(player);
    if (progress >= TRAIL_STEPS) return;
    const expected = TRAIL_STOPS[progress];
    const location = event.location;
    if (!expected || event.objectId !== expected.id ||
        location.x !== expected.x || location.y !== expected.y) return;
    const next = progress + 1;
    player.setAttribute(TRAIL_ATTRIBUTE, next);
    setTrailVarbits(player, Math.min(TRAIL_VARBITS.length, next + 1));
    if (next < TRAIL_STEPS) {
      player.sendMessage("You search around and spot more tracks.");
      return;
    }
    quest.setStage(player, STAGE_SOUL_FOUND);
    syncNpcs(player);
    player.sendMessage("A trapped soul that was lurking in the plants jumps out and attacks you!");
  }

  function usePageOnMemoirs(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = new Set([usedItemId, usedWithItemId]);
    if (!pair.has(DARK_DISPOSITION_ITEM_ID) || ![usedItemId, usedWithItemId].some((id) => MEMOIRS_ITEM_IDS.has(id))) return;
    if (pageAddedToMemoir(player)) return;
    event.handled = true;
    player.getInventory().deleteNumber(DARK_DISPOSITION_ITEM_ID, 1);
    player.setAttribute(MEMOIR_PAGE_ATTRIBUTE, 1);
    player.getPacketSender().sendVarbit(MEMOIR_ARC_TELEPORT_VARBIT, 1);
    player.sendMessage("You add an entry to Kharedst's Memoirs.");
  }

  function inspectRocks(event) {
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) !== STAGE_DEVICE) return;
    const target = DEVICE_ROCK_TILES[deviceLocation(player)];
    const location = event.location;
    if (location.x === target.x && location.y === target.y) {
      startTranscript(api, player, KAAL_XIL_DAR_NPC_ID, PAGE, "the-tasakaal-smashing-the-device");
      return;
    }
    player.sendMessage("You inspect the rocks but find nothing unusual.");
  }

  function passDoor(event) {
    const { player } = event;
    event.handled = true;
    const stage = quest.getStage(player);
    if (stage >= STAGE_TOWER) {
      stepThrough(player, event.location);
      return;
    }
    if (stage === STAGE_MORI_RETURNED) {
      // The Tower Mage guards the door; clicking it starts their entry prompt.
      api.emitCustomEvent("npc-dialogue:start", {
        player, npcId: TOWER_MAGE_NPC_ID, variant: ENTER_TOWER_VARIANT,
      });
      return;
    }
    player.sendMessage("The Tower of Magic is off limits.");
  }

  function handleObjectInteraction(event) {
    if (event.clickType !== 1) return;
    const objectId = event.objectId;
    if (objectId === GRAVE_MULTILOC) {
      inspectGrave(event);
      return;
    }
    if (TRAIL_MULTILOC_IDS.has(objectId)) {
      inspectTrail(event);
      return;
    }
    if (ROCKS_MULTILOC_IDS.has(objectId)) {
      inspectRocks(event);
      return;
    }
    if (TOWER_DOOR_IDS.has(objectId)) passDoor(event);
  }

  // ==========================================================================
  // Deaths, login and journal
  // ==========================================================================

  function handleNpcDeath(event) {
    const player = event.killer?.isPlayer?.() ? event.killer : null;
    if (!player) return;
    if (event.npcId === TRAPPED_SOUL_NPC_ID) {
      if (quest.getStage(player) !== STAGE_SOUL_FOUND) return;
      removeTracked(player, "trapped");
      quest.setStage(player, STAGE_SOUL_FREED);
      syncNpcs(player);
      return;
    }
    if (!TORMENTED_SOUL_NPC_IDS.has(event.npcId) || quest.getStage(player) !== STAGE_TOWER) return;
    const tracked = trackedNpcs.get(player);
    if (tracked) {
      let matched = false;
      for (const [key, npc] of tracked) {
        if (npc === event.npc) {
          tracked.delete(key);
          matched = true;
          break;
        }
      }
      if (!matched) {
        const key = [...tracked.keys()].find((entry) => entry.startsWith("soul-"));
        if (key) tracked.delete(key);
      }
    }
    const killed = soulsKilled(player) + 1;
    player.setAttribute(SOULS_ATTRIBUTE, killed);
    if (killed >= SOUL_COUNT) {
      removeSouls(player);
      quest.setStage(player, STAGE_SOULS_CLEARED);
      syncNpcs(player);
    }
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Thana, a citizen of Arceuus, died when the Dark Altar</str>",
        "<str>failed. I helped the Tasakaal free a trapped soul and they</str>",
        "<str>revealed a device was redirecting the Altar's power.</str>",
        "<str>I destroyed it and saved the people of Arceuus.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage <= 0) {
      return [
        "I can start this quest by speaking to <col=800000>Mori</col> in",
        "<col=800000>Arceuus</col>.",
        "",
        "I must have completed <col=800000>Client of Kourend</col> and",
        "have level 12 <col=800000>Hunter</col>.",
      ];
    }
    const lines = [
      "<str>Mori's friend Thana has died in Arceuus, something that</str>",
      "<str>should be impossible for her immortal people.</str>",
      "",
    ];
    if (stage === STAGE_STARTED) {
      lines.push("I should let <col=800000>Councillor Andrews</col> in",
        "<col=800000>Kourend Castle</col> know what has happened.");
    } else if (stage === STAGE_ANDREWS) {
      lines.push("<str>The Council won't help. I should tell Mori.</str>");
      lines.push("", "I should speak to <col=800000>Mori</col> again.");
    } else if (stage === STAGE_MORI_RETURNED) {
      lines.push("<str>The Council won't help.</str>");
      lines.push("", "Mori suggested speaking to <col=800000>Lord Arceuus</col>",
        "in the <col=800000>Tower of Magic</col>.");
    } else if (stage === STAGE_TOWER) {
      lines.push("I entered the <col=800000>Tower of Magic</col>. I should",
        "deal with the <col=800000>tormented souls</col> and head upstairs.");
    } else if (stage === STAGE_SOULS_CLEARED) {
      lines.push("The tormented souls are dealt with. I should speak to",
        "<col=800000>Asteros Arceuus</col> upstairs.");
    } else if (stage === STAGE_ASTEROS) {
      lines.push("Asteros asked me to find the <col=800000>Tasakaal</col> at",
        "<col=800000>Mount Karuulm</col>.");
    } else if (stage <= STAGE_GRAVE) {
      lines.push("The <col=800000>Tasakaal</col> will help Arceuus if I free a",
        "<col=800000>trapped soul</col> from a grave by the Battlefront.");
    } else if (stage === STAGE_TRACKING) {
      lines.push("I found tracks at the <col=800000>ancient grave</col>.",
        "I should follow them.");
    } else if (stage === STAGE_SOUL_FOUND) {
      lines.push("A <col=800000>trapped soul</col> jumped out of the plants.",
        "I should free it.");
    } else if (stage === STAGE_SOUL_FREED) {
      lines.push("I freed the trapped soul. I should return to the",
        "<col=800000>Tasakaal</col>.");
    } else if (stage === STAGE_DEVICE) {
      lines.push("The <col=800000>Tasakaal</col> found that a device is",
        "redirecting the <col=800000>Dark Altar's</col> power. I should",
        "find and destroy it.");
    } else {
      lines.push("I destroyed the device. I should tell <col=800000>Asteros</col>,",
        "then speak to <col=800000>Lord Trobin Arceuus</col>.");
    }
    return lines;
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.HUNTER, 1500);
    skills.addExperiences(Skill.RUNECRAFTING, 500);
    player.getInventory().adds(COINS_ITEM_ID, 2000);
  }

  function handleLogin({ player }) {
    syncNpcs(player);
    syncVarbits(player);
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    clearNpcs(player);
  }

  function handleZoneEnter({ player }) {
    syncNpcs(player);
  }

  function handleBootstrap({ player }) {
    syncVarbits(player);
  }

  api.persistAttribute(TRAIL_ATTRIBUTE);
  api.persistAttribute(SOULS_ATTRIBUTE);
  api.persistAttribute(DEVICE_ATTRIBUTE);
  api.persistAttribute(MEMOIR_PAGE_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "the_ascent_of_arceuus",
    name: "The Ascent of Arceuus",
    varpId: VARP_ARCEUUS_QUESTS,
    varbitId: VARBIT_STAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.HUNTER.getIndex(), amount: 1500, label: "Hunter" },
      { skillId: Skill.RUNECRAFTING.getIndex(), amount: 500, label: "Runecraft" },
    ],
    rewardItemId: DARK_DISPOSITION_ITEM_ID,
    rewardItemLabel: "A Dark Disposition",
    otherRewards: [
      "2,000 Coins",
      "Ability to recolour the graceful outfit in Arceuus colours",
      "Access to the Trapped Soul in the Nightmare Zone",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:choice", handleDialogueChoice);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnItem(usePageOnMemoirs);
  api.onNpcDeath(handleNpcDeath);
  api.onZoneEnter(TOWER_ZONE, handleZoneEnter);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
