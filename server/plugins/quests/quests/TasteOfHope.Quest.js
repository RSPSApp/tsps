/**
 * A Taste of Hope (members), Myreque #4.
 *
 * The words come from the "A Taste of Hope" transcript page; this plugin supplies
 * the variant selector and prose-condition answers for Garth, Harpert, the Ver
 * Sinhaza mercenaries, Safalaan, Vertida, Flaygian and Kael, the run of the quest
 * (Ver Sinhaza espionage, Serafina's house potion puzzle, the abomination trap,
 * the Ivandis flail and the Ranis Drakan boss fight) and the rewards.
 *
 * Stages (varp 1736 "myreque_4_main_var", sent to the client as the native
 * myq4 varbit 6396 - see WIRE_STAGES below):
 *   0 unstarted, 1 Garth's tale (start), 5 Safalaan briefed (mercenaries),
 *   10 mercenaries spoken to, 20 Harpert paid (the wall rubble is climbable),
 *   26 spied on Ranis and Vanstrom, 30 reported back (Flaygian next),
 *   35 Flaygian briefed, 45 told about Serafina's house, 75 at Serafina's house,
 *   91 old notes given to Safalaan, 95 the trap, 100 the abomination attacks,
 *   110 met at Old Man Ral's old base, 115 Safalaan heard, 120 Flaygian's notes,
 *   125 notes read, 130 Ivandis flail made, 135 sent to Ver Sinhaza,
 *   145 Ranis' speech, 150 fight, 155 Ranis killed, 160 speech of hope,
 *   165 finishing up, 166 complete.
 * The internal ladder is pinned to the Quest Helper's loadSteps keys and the
 * cache's own myq4 transform tables, so the varbit-driven multi-NPCs and locs
 * (the hideout team appearing at 1, dying at 100 and leaving at 110, Kael at Ver
 * Sinhaza for 135-154, Serafina's house 75-90, the climbable rubble for 20-40,
 * the broken fountain exactly at 75) transform as live OSRS does.
 *
 * Source: OSRS Wiki ("A Taste of Hope", its Quick guide and
 * Transcript:A Taste of Hope), the cache for every id, varbit and transform
 * table, and the Quest Helper plugin's step coordinates.
 *
 * Gaps / approximations:
 * - The Myreque hideouts are not instanced. The north hideout entry warning
 *   (items lost on death) is an area trigger that a "No" answer cancels by
 *   teleporting the player back out; the abomination and Ranis fights are
 *   owner-only NPCs at the canonical tiles rather than instanced copies.
 * - The Ver Sinhaza roof route is wired as click-to-teleport between the vent,
 *   roof and jump-off obstacle tiles; the steam vents do not damage.
 * - Ranis cannot change appearance mid-fight: he keeps his combat form, turns
 *   invulnerable while his vyrewatch are alive, and the enrage phase is only
 *   gated by the final pair dying (the cache's faster enrage form has no
 *   server-side transform hook).
 * - Veliaf Hurtz's canonical Rod of Ivandis hand-over is used in its own
 *   stage 120-134 window: Darkness of Hallowvale and In Aid of the Myreque
 *   yield the shared NPC to this quest's page-qualified transcript variant.
 * - Only the quest's four summoned vyrewatch and Ranis are gated behind the
 *   Ivandis flail / Rod of Ivandis; the city vyrewatch are not (no vampyre
 *   immunity exists in the combat core).
 * - Lvl-2 Enchant uses the standard spell cast with a quest-provided sickle
 *   recipe; an enchant emerald tablet is the canonical alternative.
 * - The epilogue cutscene, Stepping-stone safespot and Ranis' blood bombs/
 *   Blood Barrage are flavour only (narration and a hp-heal at the spy window).
 */
module.exports = function registerTasteOfHopeQuest(api) {
  const {
    Area,
    Boundary,
    CountdownTask,
    Equipment,
    Item,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    Skill,
    TaskManager,
    TeleportHandler,
    TeleportType,
  } = api.core;
  const { registerQuest, startTranscript, refreshQuestList } = require("../QuestRuntime");

  const PAGE = "A Taste of Hope";

  const VARP_TASTE_OF_HOPE = 1736; // myreque_4_main_var
  const VARBIT_TASTE_OF_HOPE = 6396; // myq4 (bits 0-8)
  const VARBIT_SERAFINA_BOOK = 6397; // myq4_serafina_book (the old diary)
  const VARBIT_VELIAF_ROD = 6398; // myq4_veliaf_rod
  const VARBIT_XP_TOME = 6399; // myq4_xp_reward (chapters read)

  // ---------------------------------------------------------------------------
  // Stage ladder
  // ---------------------------------------------------------------------------

  const STAGE_UNSTARTED = 0;
  const STAGE_STARTED = 1;
  const STAGE_SAW_SAFALAAN = 5;
  const STAGE_MERCS_SPOKEN = 10;
  const STAGE_HARPERT_PAID = 20;
  const STAGE_SPIED = 26;
  const STAGE_REPORTED = 30;
  const STAGE_FLAYGIAN = 35;
  const STAGE_HOUSE_DIRECTED = 45;
  const STAGE_AT_HOUSE = 75;
  const STAGE_NOTES_DELIVERED = 91;
  const STAGE_TRAP = 95;
  const STAGE_ABOMINATION = 100;
  const STAGE_ABANDONED = 110;
  const STAGE_NEW_BASE = 115;
  const STAGE_NOTES_RECEIVED = 120;
  const STAGE_NOTES_READ = 125;
  const STAGE_FLAIL = 130;
  const STAGE_SENT_TO_RANIS = 135;
  const STAGE_SPEECH = 145;
  const STAGE_FIGHT = 150;
  const STAGE_RANIS_DEAD = 155;
  const STAGE_SPEECH_DONE = 160;
  const STAGE_FINISHING = 165;
  const STAGE_COMPLETE = 166;

  // Internal stages are not the cache's native myq4 values. Each maps to the
  // Quest Helper loadSteps key (and cache transform window) for the same point
  // in the route, so the varbit-driven NPCs and locs advance with the player.
  const WIRE_STAGES = new Map([
    [STAGE_UNSTARTED, 0], // QH talkToGarth
    [STAGE_STARTED, 15], // QH enter the base and talk to Safalaan
    [STAGE_SAW_SAFALAAN, 20], // QH climb the rubble
    [STAGE_MERCS_SPOKEN, 30], // QH talk to Harpert
    [STAGE_HARPERT_PAID, 40], // QH spy route: climb the rubble again, then the theatre roof
    [STAGE_SPIED, 45], // QH return to Safalaan
    [STAGE_REPORTED, 55], // QH talk to Flaygian
    [STAGE_FLAYGIAN, 65], // QH talk to Safalaan again
    [STAGE_HOUSE_DIRECTED, 75], // QH Serafina's house
    [STAGE_NOTES_DELIVERED, 90], // QH start the abomination fight
    [STAGE_TRAP, 95],
    [STAGE_ABOMINATION, 100],
    [STAGE_ABANDONED, 110],
    [STAGE_NEW_BASE, 115],
    [STAGE_NOTES_RECEIVED, 120],
    [STAGE_NOTES_READ, 125],
    [STAGE_FLAIL, 130],
    [STAGE_SENT_TO_RANIS, 135],
    [STAGE_SPEECH, 140],
    [STAGE_FIGHT, 140],
    [STAGE_RANIS_DEAD, 145], // QH talk to Kael again; static 8319 stays visible
    [STAGE_SPEECH_DONE, 150],
    [STAGE_FINISHING, 160],
    [STAGE_COMPLETE, 165],
  ]);

  /** Stage 75 covers the whole Serafina puzzle; the wire follows its sub-state. */
  function serafinaWireStage(player) {
    if (hasBit(player, BIT_NOTES_GIVEN)) return 90;
    if (hasBit(player, BIT_NOTES_TAKEN) || hasBit(player, BIT_DOOR_OPEN)) return 85;
    if (hasBit(player, BIT_POTION_CHECKED)) return 82;
    if (hasBit(player, BIT_HOUSE_MET)) return 80;
    return 75;
  }

  function wireStage(stage, player) {
    if (stage === STAGE_AT_HOUSE) return serafinaWireStage(player);
    return WIRE_STAGES.get(stage) ?? (stage | 0);
  }

  function syncSerafinaWire(player) {
    player.getPacketSender().sendVarbit(
      VARBIT_TASTE_OF_HOPE,
      wireStage(quest.getStage(player), player)
    );
  }

  // ---------------------------------------------------------------------------
  // NPCs (cache gameval names in comments; many have no generated identifier)
  // ---------------------------------------------------------------------------

  const GARTH_IDS = new Set([8206, 8207, 15833]); // myq4_garth / _cutscene / _vis
  const HARPERT_IDS = new Set([8212, 15834]); // myq4_harpert / _vis
  const MERCENARY_IDS = new Set([8213, 8214, 8215, 8308, 8309, 8310]);
  const SAFALAAN_IDS = new Set([
    NpcIdentifiers.SAFALAAN_HALLOW, // 3775
    8216, // myq4_safalaan_visible
    8217, 8218, 8219, // cutscene / hurt / hurt_op
    15893, 15894, 15895, 15896, 15897, 15898,
    8311, // myq4_safalaan_basement (Serafina's house, varbit-gated 75-90)
    8312, // myq4_safalaan_new_hideout (myq5-gated)
    6160, // north hideout multi (myq3_safalaan_visible)
  ]);
  const HIDE_SAFALAAN_HURT = 8219;
  const SAFALAAN_HOUSE_NPC_ID = 8311;
  const SAFALAAN_NEW_BASE_NPC_ID = 8312;
  const VERTIDA_IDS = new Set([
    3773, // north hideout multi
    NpcIdentifiers.VERTIDA_SEFALATIS, // 8220
    8221, 8222, 8223,
    8313, // myq4_vertida_new_hideout
  ]);
  const FLAYGIAN_IDS = new Set([8224, 8225]); // myq4_flaygian_visible / _cutscene
  const KAEL_IDS = new Set([8230, 8231, 8232, 8233, 8317, 8318, 8319]);
  const VELIAF_IDS = new Set([
    NpcIdentifiers.VELIAF_HURTZ, // 989
    NpcIdentifiers.VELIAF_HURTZ_2, // 5048
    15879,
    15885,
  ]);
  const RANIS_FIGHT_IDS = new Set([8244, 8245, 8246, 8247, 8248]);
  const VYREWATCH_FIGHT_IDS = new Set([8256, 8257, 8258, 8259]);
  const ABOMINATION_IDS = new Set([8260, 8261, 8262]);
  const RANIS_HUMAN_NPC_ID = 8241;
  const VERTIDA_NPC_ID = NpcIdentifiers.VERTIDA_SEFALATIS; // 8220
  const VYREWATCH_GUARD_NPC_ID = 8251; // myq4_bank_guard
  const PROP_NPC_ID = 8211; // myq4_citizen, the host for message-only transcripts
  // myq4_harpert_vis, the content id the myq6 multi resolves 8212 to: it has no
  // npc-dialogue-index entry, so the variant selector is never consulted for it.
  const HARPERT_CONTENT_NPC_ID = 15834;

  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------

  const COINS_ITEM_ID = ItemIdentifiers.COINS; // 995
  const VIAL_ITEM_ID = ItemIdentifiers.VIAL; // 229
  const VIAL_OF_WATER_ITEM_ID = ItemIdentifiers.VIAL_OF_WATER; // 227
  const PESTLE_AND_MORTAR_IDS = new Set([ItemIdentifiers.PESTLE_AND_MORTAR, ItemIdentifiers.PESTLE_AND_MORTAR_2, 15247]); // 233/234
  const EMERALD_IDS = new Set([ItemIdentifiers.EMERALD, 1606, 6896, 16308]); // 1605
  const CHISEL_ITEM_ID = ItemIdentifiers.CHISEL; // 1755
  const ENCHANT_EMERALD_TABLET_ITEM_ID = 8017; // Enchant emerald or jade (QH POH_TABLET_ENCHANTEMERALD)
  const SILVER_SICKLE_B_ITEM_ID = ItemIdentifiers.SILVER_SICKLE_B_; // 2963
  const ROD_OF_IVANDIS_ITEM_IDS = new Set([7639, 7640, 7641, 7642, 7643, 7644, 7645, 7646, 7647, 7648]);
  const MYSTERIOUS_HERB_ITEM_ID = ItemIdentifiers.MYSTERIOUS_HERB; // 22402
  const MYSTERIOUS_MEAT_ITEM_ID = ItemIdentifiers.MYSTERIOUS_MEAT; // 22403
  const MYSTERIOUS_CRUSHED_MEAT_ITEM_ID = ItemIdentifiers.MYSTERIOUS_CRUSHED_MEAT; // 22404
  const VIAL_OF_BLOOD_ITEM_ID = ItemIdentifiers.VIAL_OF_BLOOD; // 22405
  const UNFINISHED_BLOOD_POTION_ITEM_ID = ItemIdentifiers.UNFINISHED_BLOOD_POTION; // 22406
  const BLOOD_POTION_ITEM_ID = ItemIdentifiers.BLOOD_POTION; // 22407
  const UNFINISHED_POTION_ITEM_ID = ItemIdentifiers.UNFINISHED_POTION_5; // 22408
  const POTION_ITEM_ID = ItemIdentifiers.POTION_4; // 22409
  const OLD_NOTES_ITEM_ID = ItemIdentifiers.OLD_NOTES_29; // 22410
  const OLD_DIARY_ITEM_ID = ItemIdentifiers.OLD_DIARY; // 22411
  const FLAYGIANS_NOTES_ITEM_ID = ItemIdentifiers.FLAYGIANS_NOTES; // 22413
  const CHAIN_ITEM_ID = ItemIdentifiers.CHAIN; // 22414
  const TOME_OF_EXPERIENCE_ITEM_ID = ItemIdentifiers.TOME_OF_EXPERIENCE; // 22415
  const EMERALD_SICKLE_B_ITEM_ID = ItemIdentifiers.EMERALD_SICKLE_B_; // 22433
  const ENCHANTED_EMERALD_SICKLE_B_ITEM_ID = ItemIdentifiers.ENCHANTED_EMERALD_SICKLE_B_; // 22435
  const IVANDIS_FLAIL_ITEM_ID = ItemIdentifiers.IVANDIS_FLAIL; // 22398
  const DRAKANS_MEDALLION_ITEM_ID = ItemIdentifiers.DRAKANS_MEDALLION; // 22400

  // ---------------------------------------------------------------------------
  // Objects (all myq4_*; placed by the cache maps)
  // ---------------------------------------------------------------------------

  const SPY_WINDOW_ID = 32548; // Window, Look-through
  const RUBBLE_OP_ID = 32549; // Rubble, Climb-up
  const RUBBLE_MULTI_ID = 32650; // null -> 32549/32550 by the stage varbit
  const VENT_ID = 32551; // Vent, Climb-up
  const ROOF_JUMP_ID = 32553; // Roof, Jump-off
  const ROOF_UP_ID = 32554; // Roof, Climb-up
  const ROOF_DOWN_ID = 32555; // Roof, Climb-down
  const FOUNTAIN_OP_ID = 32557; // Broken Fountain, Inspect
  const FOUNTAIN_MULTI_ID = 32651; // null -> 32557/32558 by the stage varbit
  const SERAFINA_BED_ID = 32559; // Bed, Search
  const SERAFINA_STAIRS_DOWN_ID = 32560; // Stairs, Climb-down
  const SERAFINA_STAIRS_UP_ID = 32561; // Stairs, Climb-up
  const SERAFINA_DOOR_ID = 32562; // Door, Open
  const SERAFINA_DOOR_OPEN_ID = 32563; // the open door
  const HERB_BARREL_ID = 32564; // Barrel, Search
  const MEAT_CRATE_ID = 32567; // Crate, Search
  const VIAL_CRATE_ID = 32566; // Crate, Search
  const PESTLE_CRATE_ID = 32568; // Crate, Search
  const EMPTY_CONTAINER_IDS = new Set([32565, 32569, 32570, 32571]); // searched crates/barrels
  const CHEST_CLOSED_ID = 32572; // Chest, Open
  const CHEST_OPEN_ID = 32573; // Chest, Search
  const SICKLE_CRATE_ID = 32575; // Crate, Search (Old Man Ral's base)
  const CHAIN_CRATE_ID = 32576; // Crate, Search (Old Man Ral's base)
  const RAL_TRAPDOOR_OPEN_ID = 32578; // Trapdoor, Climb-down

  // ---------------------------------------------------------------------------
  // Tiles
  // ---------------------------------------------------------------------------

  const WALL_TOP_TILE = { x: 3642, y: 3207, z: 1 };
  const HOUSE_STAIRS_LANDING = { x: 3593, y: 9670, z: 0 };
  const SERAFINA_HOUSE_TILE = { x: 3594, y: 9674, z: 0 };
  const NEW_BASE_TILE = { x: 3600, y: 9615, z: 0 };
  const VERTIDA_NEW_BASE_TILE = { x: 3599, y: 9611, z: 0 };
  const KAEL_NEW_BASE_TILE = { x: 3594, y: 9613, z: 0 };
  const ABOMINATION_TILE = { x: 3627, y: 9645, z: 0 };
  const VER_SINHAZA_TELEPORT = { x: 3649, y: 3230, z: 0 };
  const RANIS_TILE = { x: 3649, y: 3227, z: 0 };
  const RANIS_PLAYER_TILE = { x: 3649, y: 3234, z: 0 };
  const HIDEOUT_SURFACE_TILE = { x: 3639, y: 3251, z: 0 };

  // ---------------------------------------------------------------------------
  // Persisted sub-state
  // ---------------------------------------------------------------------------

  const BITS_ATTRIBUTE = "quest.taste_of_hope.bits";
  const BIT_HERB_TAKEN = 1 << 0;
  const BIT_MEAT_TAKEN = 1 << 1;
  const BIT_VIAL_TAKEN = 1 << 2;
  const BIT_PESTLE_TAKEN = 1 << 3;
  const BIT_DIARY_TAKEN = 1 << 4;
  const BIT_HOUSE_MET = 1 << 5;
  const BIT_POTION_CHECKED = 1 << 6;
  const BIT_DOOR_OPEN = 1 << 7;
  const BIT_BLOOD_VIAL = 1 << 8;
  const BIT_NOTES_TAKEN = 1 << 9;
  const BIT_NOTES_GIVEN = 1 << 10;
  const BIT_NOTES_RECEIVED = 1 << 11;
  const BIT_NOTES_READ = 1 << 12;
  const BIT_ASKED_ROD = 1 << 13;
  const BIT_ROD_CLAIMED = 1 << 14;
  const BIT_FLAIL_CREATED = 1 << 15;
  const BIT_SICKLE_TAKEN = 1 << 16;
  const BIT_CHAIN_TAKEN = 1 << 17;

  const TOME_ATTRIBUTE = "quest.taste_of_hope.tome";
  // Boss fights survive a server restart (the world is not instanced): the hp
  // reached and Ranis' phase are kept, and the login hook respawns from them.
  const ABOMINATION_HP_ATTRIBUTE = "quest.taste_of_hope.abomination.hp";
  const RANIS_HP_ATTRIBUTE = "quest.taste_of_hope.ranis.hp";
  const RANIS_PHASE_ATTRIBUTE = "quest.taste_of_hope.ranis.phase";

  const START_HOOK = "quest:taste-of-hope:start";

  let quest;
  const spawnedByPlayer = new Map();
  const fightByPlayer = new Map();
  const warningPending = new WeakSet();
  const flailPurchasePending = new WeakSet();
  const lastImmuneMessage = new WeakMap();

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull()
        ? 0
        : 28;
  }

  function give(player, itemId, amount = 1) {
    if (freeSlots(player) < 1) {
      player.sendMessage("You don't have enough inventory space.");
      return false;
    }
    player.getInventory().adds(itemId, amount);
    return true;
  }

  function forceGive(player, itemId, amount = 1) {
    const inventory = player.getInventory();
    if (typeof inventory.forceAdd === "function" && inventory.isFull()) {
      inventory.forceAdd(player, new Item(itemId, amount));
      return;
    }
    inventory.adds(itemId, amount);
  }

  function bits(player) {
    return Number(player.getAttribute(BITS_ATTRIBUTE)) || 0;
  }

  function hasBit(player, bit) {
    return (bits(player) & bit) !== 0;
  }

  function setBit(player, bit) {
    if (hasBit(player, bit)) return;
    player.setAttribute(BITS_ATTRIBUTE, bits(player) | bit);
  }

  function attributeNumber(player, key) {
    return Number(player.getAttribute(key)) || 0;
  }

  function hasRod(player) {
    for (const itemId of ROD_OF_IVANDIS_ITEM_IDS) {
      if (held(player, itemId)) return true;
    }
    return false;
  }

  function needsVeliafRod(player) {
    const stage = quest.getStage(player);
    return stage >= STAGE_NOTES_RECEIVED && stage < STAGE_SENT_TO_RANIS &&
      hasBit(player, BIT_ASKED_ROD) && !hasRod(player) && !hasBit(player, BIT_ROD_CLAIMED);
  }

  function answerVeliafRodNeed(request) {
    if (!request?.player) return;
    request.needsRod = needsVeliafRod(request.player);
  }

  function deleteRod(player) {
    for (const itemId of ROD_OF_IVANDIS_ITEM_IDS) {
      if (held(player, itemId)) {
        player.getInventory().deleteNumber(itemId, 1);
        return;
      }
    }
  }

  function wearingWeapon(player, itemId) {
    return player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.() === itemId;
  }

  function wearingFlail(player) {
    return wearingWeapon(player, IVANDIS_FLAIL_ITEM_ID);
  }

  function wearingFlailOrRod(player) {
    if (wearingFlail(player)) return true;
    return ROD_OF_IVANDIS_ITEM_IDS.has(player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.());
  }

  /** The flail counts when created, carried or wielded (the hand-ins check it). */
  function hasFlail(player) {
    if (hasBit(player, BIT_FLAIL_CREATED) || held(player, IVANDIS_FLAIL_ITEM_ID)) return true;
    return player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.() === IVANDIS_FLAIL_ITEM_ID;
  }

  function advance(player, stage) {
    if (quest.getStage(player) >= stage) return;
    quest.setStage(player, stage);
    applyStageSpawns(player);
  }

  function teleport(player, tile) {
    player.moveTo(new Location(tile.x, tile.y, tile.z));
  }

  function narrate(player, lines) {
    for (const line of lines) player.sendMessage(line);
  }

  function healToFull(player) {
    const skills = player.getSkillManager();
    skills.setCurrentLevel(Skill.HITPOINTS, skills.getMaxLevel(Skill.HITPOINTS));
    skills.setCurrentLevel(Skill.PRAYER, skills.getMaxLevel(Skill.PRAYER));
    player.setRunEnergy(100);
  }

  function syncTome(player) {
    player.getPacketSender().sendVarbit(VARBIT_XP_TOME, Math.min(3, attributeNumber(player, TOME_ATTRIBUTE)));
    player.getPacketSender().sendVarbit(VARBIT_SERAFINA_BOOK, hasBit(player, BIT_DIARY_TAKEN) ? 1 : 0);
    player.getPacketSender().sendVarbit(VARBIT_VELIAF_ROD, hasBit(player, BIT_ROD_CLAIMED) ? 1 : 0);
  }

  function requirementsMet(player) {
    if (!questComplete(player, "darkness_of_hallowvale")) return false;
    const skills = player.getSkillManager();
    return (
      skills.getMaxLevel(Skill.CRAFTING) >= 48 &&
      skills.getMaxLevel(Skill.AGILITY) >= 45 &&
      skills.getMaxLevel(Skill.ATTACK) >= 40 &&
      skills.getMaxLevel(Skill.HERBLORE) >= 40 &&
      skills.getMaxLevel(Skill.SLAYER) >= 38
    );
  }

  function questComplete(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent?.("quest:is-complete", request);
    return request.complete === true;
  }

  // ---------------------------------------------------------------------------
  // Quest spawns (owner-only actors the world does not place)
  // ---------------------------------------------------------------------------

  function spawnKey(player, key, npcId, tile) {
    if (!player || player.isPlayerBot?.() === true) return null;
    let map = spawnedByPlayer.get(player);
    if (!map) {
      map = new Map();
      spawnedByPlayer.set(player, map);
    }
    const existing = map.get(key);
    if (existing) {
      if (
        existing.getId?.() === npcId &&
        existing.getLocation?.().equals?.(new Location(tile.x, tile.y, tile.z))
      ) {
        return existing;
      }
      api.removeNpc(existing);
      map.delete(key);
    }
    const npc = api.spawnNpc({
      id: npcId,
      x: tile.x,
      y: tile.y,
      z: tile.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) map.set(key, npc);
    return npc;
  }

  function despawnKey(player, key) {
    const map = spawnedByPlayer.get(player);
    const npc = map?.get(key);
    if (!npc) return;
    api.removeNpc(npc);
    map.delete(key);
  }

  function despawnAll(player) {
    const map = spawnedByPlayer.get(player);
    if (!map) return;
    for (const npc of map.values()) api.removeNpc(npc);
    map.clear();
    spawnedByPlayer.delete(player);
  }

  /** Drops one NPC from the tracked map (it died on its own). */
  function forgetSpawn(player, npc) {
    const map = spawnedByPlayer.get(player);
    if (!map) return;
    for (const [key, tracked] of map) {
      if (tracked === npc) {
        map.delete(key);
        break;
      }
    }
  }

  /** Keeps exactly the quest NPCs the current stage needs present. */
  function applyStageSpawns(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    const stage = quest.getStage(player);
    // The old base under Old Man Ral: Safalaan for the epilogue, and Vertida for
    // the pre- and post-quest flail reclaim (her page outlives completion).
    if (stage >= STAGE_ABANDONED && stage < STAGE_COMPLETE) {
      spawnKey(player, "safalaan_base", 8216, NEW_BASE_TILE);
    } else {
      despawnKey(player, "safalaan_base");
    }
    // Vertida's page outlives the quest: the post-quest flail reclaim needs her.
    if (stage >= STAGE_ABANDONED) {
      spawnKey(player, "vertida_base", VERTIDA_NPC_ID, VERTIDA_NEW_BASE_TILE);
    } else {
      despawnKey(player, "vertida_base");
    }
    // Kael: at the old base while the weapon is made, at Ver Sinhaza for the
    // fight (the static 8319 covers that side), and back for post-quest medallions.
    if ((stage >= STAGE_ABANDONED && stage < STAGE_SENT_TO_RANIS) || stage >= STAGE_COMPLETE) {
      spawnKey(player, "kael_base", 8230, KAEL_NEW_BASE_TILE);
    } else {
      despawnKey(player, "kael_base");
    }
    if (stage === STAGE_ABOMINATION) {
      ensureAbomination(player);
    } else {
      despawnKey(player, "abomination");
    }
    if (stage === STAGE_FIGHT || stage === STAGE_RANIS_DEAD) {
      ensureRanisFight(player);
    } else {
      clearRanisFight(player);
    }
  }

  // ---------------------------------------------------------------------------
  // Journal
  // ---------------------------------------------------------------------------

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I spied on Ranis Drakan and Vanstrom Klause at Ver Sinhaza, and</str>",
        "<str>found the trap they set for the Myreque. I survived the</str>",
        "<str>abomination and helped make the Ivandis flail.</str>",
        "",
        "<str>I killed Ranis Drakan at Ver Sinhaza and gave the people of</str>",
        "<str>Meiyerditch a taste of hope. The Myreque prevail.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage <= STAGE_UNSTARTED) {
      return [
        "I can start this quest by speaking to <col=800000>Garth</col> outside the",
        "Theatre of Blood in <col=800000>Ver Sinhaza</col>.",
        "",
        "I need to have completed <col=800000>Darkness of Hallowvale</col>.",
      ];
    }
    const lines = [];
    if (stage < STAGE_SPIED) {
      lines.push("<str>Safalaan asked me to investigate Ver Sinhaza.</str>");
      if (stage < STAGE_MERCS_SPOKEN) {
        lines.push("I should talk to the <col=800000>mercenaries</col> near the theatre.");
      } else if (stage < STAGE_HARPERT_PAID) {
        lines.push("I should climb the rubble by the bank - Harpert can distract the guard.");
      } else {
        lines.push("I should climb the rubble and spy on Ranis and Vanstrom.");
      }
      return lines;
    }
    if (stage < STAGE_REPORTED) {
      return ["I saw Ranis and Vanstrom with Lady Verzik. I should report to <col=800000>Safalaan</col>."];
    }
    if (stage < STAGE_FLAYGIAN) {
      return ["Safalaan wants to know what <col=800000>Flaygian</col> has found in the haemalchemy book."];
    }
    if (stage < STAGE_HOUSE_DIRECTED) {
      return ["Flaygian thinks Serafina found a weapon against the vampyres. I should tell Safalaan."];
    }
    if (stage < STAGE_AT_HOUSE) {
      return [
        "Safalaan says Serafina once lived in sector four of Meiyerditch,",
        "south of the broken fountain. I should meet him there.",
      ];
    }
    if (stage < STAGE_NOTES_DELIVERED) {
      lines.push("At Serafina's house, Safalaan and I found a locked door.");
      if (held(player, OLD_NOTES_ITEM_ID)) {
        lines.push("I have some <col=800000>old notes</col> from the chest; I should show them to Safalaan.");
      } else if (hasBit(player, BIT_POTION_CHECKED)) {
        lines.push("A potion of blood may open the door.");
      } else {
        lines.push("I should search the crates and make a potion for the door.");
      }
      return lines;
    }
    if (stage < STAGE_ABOMINATION) {
      return ["Safalaan and I were tricked - the notes were bait. I should return to the hideout."];
    }
    if (stage < STAGE_ABANDONED) {
      return ["An abomination attacked the hideout! I must kill it."];
    }
    if (stage < STAGE_NOTES_RECEIVED) {
      return ["The hideout is lost. I should speak to <col=800000>Safalaan</col> in the old base under Old Man Ral's house."];
    }
    if (stage < STAGE_FLAIL) {
      lines.push("I am making the <col=800000>Ivandis flail</col> from Flaygian's notes:");
      lines.push("a rod of Ivandis, an enchanted emerald sickle and a chain.");
      return lines;
    }
    if (stage < STAGE_SENT_TO_RANIS) {
      return ["I made the <col=800000>Ivandis flail</col>. I should tell Safalaan."];
    }
    if (stage < STAGE_SPEECH_DONE) {
      return ["Ranis Drakan is at Ver Sinhaza. I should meet <col=800000>Kael</col> there and strike."];
    }
    if (stage < STAGE_FINISHING) {
      return ["Ranis Drakan is dead. I should return to Safalaan in the old base."];
    }
    return ["I should speak to <col=800000>Safalaan</col> to finish the quest."];
  }

  function grantReward(player) {
    // The quest's experience comes from the tome, not automatic XP.
    if (!held(player, TOME_OF_EXPERIENCE_ITEM_ID)) forceGive(player, TOME_OF_EXPERIENCE_ITEM_ID, 1);
    if (!held(player, DRAKANS_MEDALLION_ITEM_ID)) forceGive(player, DRAKANS_MEDALLION_ITEM_ID, 1);
    applyStageSpawns(player);
  }

  // ---------------------------------------------------------------------------
  // Dialogue: variant selection
  // ---------------------------------------------------------------------------

  function nearTile(player, tile, radius) {
    const location = player.getLocation?.();
    if (!location) return false;
    return (
      Math.max(Math.abs(location.getX() - tile.x), Math.abs(location.getY() - tile.y)) <= radius
    );
  }

  function npcNear(npc, tile, radius) {
    const location = npc?.getLocation?.();
    if (!location) return false;
    return Math.max(Math.abs(location.getX() - tile.x), Math.abs(location.getY() - tile.y)) <= radius;
  }

  function safalaanHouseVariant(player) {
    if (hasBit(player, BIT_NOTES_GIVEN)) {
      return "the-myth-of-serafina-talking-to-safalaan-after-obtaining-the-old-notes-talking-to-safalaan-after-giving-him-the-old-notes";
    }
    if (held(player, OLD_NOTES_ITEM_ID)) {
      return "the-myth-of-serafina-talking-to-safalaan-after-obtaining-the-old-notes";
    }
    if (!hasBit(player, BIT_HOUSE_MET)) {
      setBit(player, BIT_HOUSE_MET);
      syncSerafinaWire(player);
      return "the-myth-of-serafina-talking-to-safalaan";
    }
    if (hasBit(player, BIT_DOOR_OPEN)) {
      return "the-myth-of-serafina-talking-to-safalaan-again-if-the-blood-potion-has-been-made-and-was-used-on-the-door";
    }
    if (held(player, BLOOD_POTION_ITEM_ID)) {
      return "the-myth-of-serafina-talking-to-safalaan-again-if-the-blood-potion-has-been-made-but-not-used-on-the-door";
    }
    if (held(player, UNFINISHED_BLOOD_POTION_ITEM_ID)) {
      return "the-myth-of-serafina-talking-to-safalaan-again-if-the-blood-potion-has-been-partially-made";
    }
    if (held(player, VIAL_OF_BLOOD_ITEM_ID)) {
      return "the-myth-of-serafina-talking-to-safalaan-again-after-getting-the-vial-of-blood";
    }
    if (hasBit(player, BIT_BLOOD_VIAL)) {
      return "the-myth-of-serafina-talking-to-safalaan-again-after-losing-the-vial-of-blood";
    }
    if (hasBit(player, BIT_POTION_CHECKED)) {
      return held(player, VIAL_ITEM_ID)
        ? "the-myth-of-serafina-talking-to-safalaan-again-after-using-the-potion-on-the-door"
        : "the-myth-of-serafina-talking-to-safalaan-again-if-the-player-did-not-have-an-empty-vial";
    }
    if (held(player, POTION_ITEM_ID)) {
      return "the-myth-of-serafina-talking-to-safalaan-again-after-making-the-potion-but-before-checking-the-door";
    }
    if (held(player, UNFINISHED_POTION_ITEM_ID)) {
      return "the-myth-of-serafina-talking-to-safalaan-again-after-making-the-unfinished-potion-but-before-checking-the-door";
    }
    if (held(player, MYSTERIOUS_MEAT_ITEM_ID)) {
      return "the-myth-of-serafina-talking-to-safalaan-again-after-finding-the-mysterious-meat-but-before-checking-the-door";
    }
    if (held(player, MYSTERIOUS_HERB_ITEM_ID)) {
      return "the-myth-of-serafina-talking-to-safalaan-again-after-finding-the-mysterious-herb-but-before-checking-the-door";
    }
    return "the-myth-of-serafina-talking-to-safalaan-again-before-finding-any-ingredients-or-checking-the-door";
  }

  function safalaanNorthVariant(player, stage) {
    if (stage >= STAGE_STARTED && stage < STAGE_SAW_SAFALAAN) {
      quest.setStage(player, STAGE_SAW_SAFALAAN);
      return "starting-out-talking-to-safalaan";
    }
    if (stage >= STAGE_SAW_SAFALAAN && stage < STAGE_SPIED) {
      return "starting-out-talking-to-safalaan-talking-to-safalaan-again";
    }
    if (stage >= STAGE_SPIED && stage < STAGE_REPORTED) {
      quest.setStage(player, STAGE_REPORTED);
      return "vampyric-espionage-reporting-back-to-safalaan";
    }
    if (stage >= STAGE_FLAYGIAN && stage < STAGE_HOUSE_DIRECTED) {
      quest.setStage(player, STAGE_HOUSE_DIRECTED);
      return "vampyric-espionage-talking-to-safalaan";
    }
    if (stage >= STAGE_HOUSE_DIRECTED && stage < STAGE_AT_HOUSE) {
      return "vampyric-espionage-talking-to-safalaan-talking-to-safalaan-again";
    }
    if (stage >= STAGE_AT_HOUSE && stage < STAGE_NOTES_DELIVERED) {
      // Safalaan is at the house; the north copy still answers with directions.
      return "vampyric-espionage-talking-to-safalaan-talking-to-safalaan-again";
    }
    if (stage >= STAGE_NOTES_DELIVERED && stage < STAGE_ABOMINATION) {
      quest.setStage(player, STAGE_TRAP);
      return "it-s-a-trap-talking-to-safalaan";
    }
    return null;
  }

  function safalaanNewBaseVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) return null;
    if (stage >= STAGE_ABANDONED && stage < STAGE_NEW_BASE) {
      quest.setStage(player, STAGE_NEW_BASE);
      return "the-legendary-weapon-talking-to-safalaan";
    }
    if (stage >= STAGE_SENT_TO_RANIS && stage < STAGE_RANIS_DEAD) {
      return "the-legendary-weapon-talking-to-safalaan-again-2";
    }
    if (stage >= STAGE_RANIS_DEAD && stage < STAGE_COMPLETE) {
      quest.setStage(player, STAGE_FINISHING);
      return "finishing-up-returning-to-safalaan";
    }
    if (stage >= STAGE_FLAIL && hasFlail(player)) {
      quest.setStage(player, STAGE_SENT_TO_RANIS);
      return "the-legendary-weapon-talking-to-safalaan-after-creating-the-ivandis-flail";
    }
    return "the-legendary-weapon-talking-to-safalaan-again";
  }

  function vertidaVariant(player, stage, atNewBase) {
    if (!atNewBase) {
      if (stage >= STAGE_NOTES_DELIVERED && stage < STAGE_ABANDONED) {
        return "it-s-a-trap-talking-to-vertida";
      }
      return null;
    }
    if (stage >= STAGE_ABANDONED && stage < STAGE_NEW_BASE) {
      return "the-legendary-weapon-talking-to-vertida";
    }
    if (stage >= STAGE_NEW_BASE && stage < STAGE_NOTES_RECEIVED && !held(player, FLAYGIANS_NOTES_ITEM_ID)) {
      return "the-legendary-weapon-talking-to-vertida-after-talking-to-safalaan";
    }
    if (stage >= STAGE_SENT_TO_RANIS && stage < STAGE_RANIS_DEAD) {
      return "the-legendary-weapon-talking-to-vertida-2";
    }
    if (stage >= STAGE_RANIS_DEAD) {
      return "finishing-up-talking-to-vertida";
    }
    if (hasBit(player, BIT_NOTES_READ) || held(player, FLAYGIANS_NOTES_ITEM_ID)) {
      if (hasFlail(player)) {
        return "the-legendary-weapon-talking-to-vertida-after-talking-to-safalaan-after-creating-the-ivandis-flail";
      }
      return "the-legendary-weapon-talking-to-vertida-after-talking-to-safalaan-after-reading-flaygian-s-notes";
    }
    return null;
  }

  function kaelVariant(stage) {
    if (stage >= STAGE_ABANDONED && stage < STAGE_FLAIL) {
      return "the-legendary-weapon-talking-to-kael";
    }
    if (stage >= STAGE_FLAIL && stage < STAGE_SENT_TO_RANIS) {
      return "the-legendary-weapon-talking-to-kael-after-talking-to-safalaan";
    }
    if (stage >= STAGE_SENT_TO_RANIS && stage < STAGE_RANIS_DEAD) {
      return "the-taste-of-hope-talking-to-kael";
    }
    if (stage >= STAGE_RANIS_DEAD && stage < STAGE_COMPLETE) {
      return "finishing-up";
    }
    if (stage >= STAGE_COMPLETE) {
      return "finishing-up-talking-to-kael";
    }
    return null;
  }

  function selectVariant({ npcId, player, npc }) {
    if (!player) return null;
    const stage = quest.getStage(player);
    if (GARTH_IDS.has(npcId)) {
      return stage === STAGE_UNSTARTED ? "starting-out-talking-to-garth" : null;
    }
    if (MERCENARY_IDS.has(npcId)) {
      if (stage >= STAGE_SAW_SAFALAAN && stage < STAGE_MERCS_SPOKEN) {
        quest.setStage(player, STAGE_MERCS_SPOKEN);
        return "vampyric-espionage-talking-to-the-mercenaries";
      }
      if (stage >= STAGE_MERCS_SPOKEN && stage < STAGE_SPIED) {
        return "vampyric-espionage-talking-to-the-mercenaries-talking-to-the-mercenaries-again";
      }
      return null;
    }
    if (HARPERT_IDS.has(npcId)) {
      if (stage >= STAGE_MERCS_SPOKEN && stage < STAGE_HARPERT_PAID) {
        return "vampyric-espionage-talking-to-harpert";
      }
      if (stage >= STAGE_HARPERT_PAID && stage < STAGE_SPIED) {
        return "vampyric-espionage-talking-to-harpert-talking-to-harper-after-giving-him-1-000-coins";
      }
      return null;
    }
    if (SAFALAAN_IDS.has(npcId)) {
      if (npcNear(npc, SERAFINA_HOUSE_TILE, 6)) {
        return safalaanHouseVariant(player);
      }
      if (npcNear(npc, NEW_BASE_TILE, 6) || npcId === SAFALAAN_NEW_BASE_NPC_ID) {
        return safalaanNewBaseVariant(player, stage);
      }
      return safalaanNorthVariant(player, stage);
    }
    if (VERTIDA_IDS.has(npcId)) {
      const atNewBase = npcNear(npc, VERTIDA_NEW_BASE_TILE, 6) || stage >= STAGE_ABANDONED;
      return vertidaVariant(player, stage, atNewBase);
    }
    if (FLAYGIAN_IDS.has(npcId)) {
      if (stage >= STAGE_REPORTED && stage < STAGE_FLAYGIAN) {
        quest.setStage(player, STAGE_FLAYGIAN);
        return "vampyric-espionage-talking-to-flaygian";
      }
      if (stage >= STAGE_FLAYGIAN && stage < STAGE_ABOMINATION) {
        return "vampyric-espionage-talking-to-flaygian-again";
      }
      return null;
    }
    if (KAEL_IDS.has(npcId)) {
      return kaelVariant(stage);
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Dialogue: prose conditions
  // ---------------------------------------------------------------------------

  function answerCondition({ player, text, pages }) {
    if (Array.isArray(pages) && pages.length > 0 && !pages.some((entry) => entry?.page === PAGE)) {
      return null;
    }
    const value = String(text ?? "").toLowerCase();
    if (value.includes("doesn't have 1000 coins")) return !held(player, COINS_ITEM_ID, 1000);
    if (value.includes("does not have an empty vial")) return !held(player, VIAL_ITEM_ID);
    if (value.includes("doesn't have inventory space")) return freeSlots(player) < 1;
    if (value.includes("has inventory space")) return freeSlots(player) >= 1;
    if (value.includes("does not have the rod of ivandis")) return !hasRod(player);
    if (value.includes("doesn't have the rod of ivandis")) {
      return !hasRod(player) && !hasBit(player, BIT_ROD_CLAIMED);
    }
    if (value.includes("has the rod of ivandis")) return hasRod(player);
    if (value.includes("has one free inventory space")) return freeSlots(player) >= 1;
    if (value.includes("has no free inventory space")) return freeSlots(player) < 1;
    if (value.includes("already have one in the inventory")) return hasRod(player);
    if (value.includes("already claimed one from veliaf")) return hasBit(player, BIT_ROD_CLAIMED);
    if (value.includes("inventory is full")) return freeSlots(player) < 1;
    if (value.includes("has enough coins")) return held(player, COINS_ITEM_ID, 20000);
    if (value.includes("doesn't have enough coins")) return !held(player, COINS_ITEM_ID, 20000);
    return null;
  }

  // ---------------------------------------------------------------------------
  // Dialogue: choices
  // ---------------------------------------------------------------------------

  /**
   * The canonical post-quest reclaim: Vertida sells another Ivandis flail to a
   * player who has none to hand. The flail counts as held when it is carried or
   * wielded, so only a destroyed or banked flail needs buying again. Sins of
   * the Father owns the same old-base Vertida and asks this before taking the
   * talk for itself.
   */
  function flailReclaimNeeded(player) {
    if (!quest.isComplete(player)) return false;
    if (held(player, IVANDIS_FLAIL_ITEM_ID)) return false;
    return player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.() !== IVANDIS_FLAIL_ITEM_ID;
  }

  /** The canonical purchase prompt's "Yes." is the only step that hands over a flail. */
  function buyAnotherFlail(player) {
    if (!held(player, COINS_ITEM_ID, 20000)) {
      player.sendMessage("You need 20,000 coins to buy another flail.");
      return;
    }
    if (!give(player, IVANDIS_FLAIL_ITEM_ID, 1)) return;
    player.getInventory().deleteNumber(COINS_ITEM_ID, 20000);
    narrate(player, ["You buy an Ivandis flail from Vertida."]);
  }

  /** Answers Sins of the Father's question about the post-quest flail reclaim. */
  function handleFlailReclaimRequest(request) {
    if (!request?.player) return;
    request.needed = flailReclaimNeeded(request.player);
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (!player) return;
    const text = String(option ?? "");
    if (flailPurchasePending.has(player)) {
      flailPurchasePending.delete(player);
      if (text === "Yes." && VERTIDA_IDS.has(npcId)) buyAnotherFlail(player);
      return;
    }
    if (warningPending.has(player) && (text === "Yes." || text === "No.")) {
      warningPending.delete(player);
      if (text === "No.") {
        teleport(player, HIDEOUT_SURFACE_TILE);
        player.sendMessage("You decide not to enter the hideout.");
      }
      return;
    }
    if (text === "I'm ready.") {
      if (!KAEL_IDS.has(npcId)) return;
      const stage = quest.getStage(player);
      if (stage < STAGE_SENT_TO_RANIS || stage >= STAGE_FIGHT) return;
      quest.setStage(player, STAGE_SPEECH);
      defer(player, () => {
        teleport(player, RANIS_PLAYER_TILE);
        startTranscript(api, player, RANIS_HUMAN_NPC_ID, PAGE, "the-taste-of-hope-ranis-speech");
      });
      return;
    }
    if (text === "I need the Rod of Ivandis.") {
      if (!VERTIDA_IDS.has(npcId)) return;
      setBit(player, BIT_ASKED_ROD);
      return;
    }
    if (text === "I need another flail" || text === "I need another flail.") {
      if (!VERTIDA_IDS.has(npcId)) return;
      const stage = quest.getStage(player);
      if (stage < STAGE_SENT_TO_RANIS && !quest.isComplete(player)) return;
      // The transcript asks again ("Buy an Ivandis Flail for 20,000 coins?")
      // before any coins or item move, so defer the purchase to its Yes.
      flailPurchasePending.add(player);
      return;
    }
    if (text === "Do you have another Drakan's medallion?") {
      // The transcript's branch is a wiki gap (a "missing" step), so Kael's
      // hand-out is done here.
      if (!KAEL_IDS.has(npcId) || !quest.isComplete(player)) return;
      if (held(player, DRAKANS_MEDALLION_ITEM_ID)) {
        player.sendMessage("You already have one.");
        return;
      }
      if (freeSlots(player) < 1) {
        player.sendMessage("You don't have enough inventory space.");
        return;
      }
      give(player, DRAKANS_MEDALLION_ITEM_ID, 1);
      narrate(player, ["Kael hands you another Drakan's medallion."]);
      return;
    }
  }

  function defer(player, action) {
    if (!CountdownTask || !TaskManager) {
      action();
      return;
    }
    TaskManager.submit(
      new CountdownTask(player, 1, () => {
        if (player.isRegistered?.() === false) return;
        action();
      })
    );
  }

  // The canonical Veliaf transcript has no action step for the hand-over; the
  // nested "one free inventory space" condition is the point at which he gives it.
  function handleDialogueCondition(event) {
    const { player, stepId } = event;
    if (!player || stepId !== "J8N5DP") return;
    const stage = quest.getStage(player);
    if (stage < STAGE_NOTES_RECEIVED || stage >= STAGE_SENT_TO_RANIS) return;
    if (hasRod(player) || hasBit(player, BIT_ROD_CLAIMED)) return;
    if (!give(player, ItemIdentifiers.ROD_OF_IVANDIS_10_, 1)) return;
    setBit(player, BIT_ROD_CLAIMED);
    syncTome(player);
    narrate(player, ["Veliaf hands you the Rod of Ivandis."]);
  }

  // ---------------------------------------------------------------------------
  // Dialogue: stage directions (actions and message steps)
  // ---------------------------------------------------------------------------

  const IGNORED_ACTION_IDS = new Set([
    "xPW9OM", // Vanstrom faces east
    "eDw67j", // the abomination attacks (cutscene narration)
    "772aOb",
    "-uzoYw",
    "DBeIxc",
    "4RaLGn",
    "ul84ZV",
    "PRrMZY", // Safalaan weakens the abomination (the fight is already spawned)
    "EBKOIp", // Ranis' corpse cutscene
  ]);

  function handleAction(event) {
    const { player, stepId, kind } = event;
    if (!player || !stepId) return;
    if (IGNORED_ACTION_IDS.has(stepId)) return;
    switch (stepId) {
      case "O2i4uQ": // Garth's tale ends with Vanstrom and Ranis entering the theatre
        event.handled = true;
        if (quest.getStage(player) !== STAGE_UNSTARTED) return;
        if (!requirementsMet(player)) {
          player.sendMessage(
            "You need Darkness of Hallowvale and 48 Crafting, 45 Agility, 40 Attack, 40 Herblore and 38 Slayer to start this quest."
          );
          return;
        }
        quest.setStage(player, STAGE_STARTED);
        narrate(player, [
          "As Garth talks, you watch Vanstrom Klause and Ranis Drakan arrive at Ver Sinhaza and enter the Theatre of Blood.",
          "You should tell Safalaan about this.",
        ]);
        return;
      case "Sf4pJy": // the spy cutscene ends
        event.handled = true;
        healToFull(player);
        advance(player, STAGE_SPIED);
        return;
      case "lZWjHD": // receive: Vial of blood
        if (held(player, VIAL_ITEM_ID)) player.getInventory().deleteNumber(VIAL_ITEM_ID, 1);
        if (!held(player, VIAL_OF_BLOOD_ITEM_ID)) give(player, VIAL_OF_BLOOD_ITEM_ID, 1);
        setBit(player, BIT_BLOOD_VIAL);
        return;
      case "u67nbM": // message: You give Harpert 1,000 coins
        if (kind !== "message") return;
        if (quest.getStage(player) < STAGE_HARPERT_PAID && held(player, COINS_ITEM_ID, 1000)) {
          player.getInventory().deleteNumber(COINS_ITEM_ID, 1000);
          advance(player, STAGE_HARPERT_PAID);
        }
        return;
      case "3rZqGF": // message: You climb up the wall while the vampyre is distracted
        if (kind !== "message") return;
        teleport(player, WALL_TOP_TILE);
        return;
      case "doCEET": // the player agrees to enter the hideout
        warningPending.delete(player);
        return;
      case "e8_lm1": // message: the second vial of blood (lost-vial branch)
        if (kind !== "message") return;
        if (!held(player, VIAL_OF_BLOOD_ITEM_ID)) give(player, VIAL_OF_BLOOD_ITEM_ID, 1);
        if (held(player, VIAL_ITEM_ID)) player.getInventory().deleteNumber(VIAL_ITEM_ID, 1);
        setBit(player, BIT_BLOOD_VIAL);
        return;
      case "1jhUsU": // message: You take some old notes from the chest
        if (kind !== "message") return;
        if (!hasBit(player, BIT_NOTES_TAKEN) && !held(player, OLD_NOTES_ITEM_ID)) {
          if (!give(player, OLD_NOTES_ITEM_ID, 1)) return;
          setBit(player, BIT_NOTES_TAKEN);
          syncSerafinaWire(player);
        }
        return;
      case "nIsw3D": // message: You give the notes to Safalaan
        if (kind !== "message") return;
        if (held(player, OLD_NOTES_ITEM_ID)) player.getInventory().deleteNumber(OLD_NOTES_ITEM_ID, 1);
        setBit(player, BIT_NOTES_GIVEN);
        advance(player, STAGE_NOTES_DELIVERED);
        return;
      case "n2DGut": // message: Vertida gives you some notes
        if (kind !== "message") return;
        if (!held(player, FLAYGIANS_NOTES_ITEM_ID) && freeSlots(player) >= 1) {
          player.getInventory().adds(FLAYGIANS_NOTES_ITEM_ID, 1);
          setBit(player, BIT_NOTES_RECEIVED);
          advance(player, STAGE_NOTES_RECEIVED);
        }
        return;
      case "8he9JR": // message: Kael shows you Ranis Drakan's medallion
        if (kind !== "message") return;
        if (!held(player, DRAKANS_MEDALLION_ITEM_ID)) give(player, DRAKANS_MEDALLION_ITEM_ID, 1);
        return;
      case "GRRtbS": // Ranis turns into his vampyre form
        event.handled = true;
        quest.setStage(player, STAGE_FIGHT);
        ensureRanisFight(player);
        return;
      case "4unz2S": // Congratulations! Quest complete!
        event.handled = true;
        event.end = true;
        player.sendMessage("Congratulations! Quest complete!");
        if (!quest.isComplete(player)) quest.complete(player);
        return;
      default:
        return;
    }
  }

  function handleLine(event) {
    const { player, npcId, text } = event;
    if (!player || typeof text !== "string") return;
    if (text.includes("He used us as bait")) {
      if (!SAFALAAN_IDS.has(npcId)) return;
      const stage = quest.getStage(player);
      if (stage < STAGE_TRAP || stage >= STAGE_ABOMINATION) return;
      quest.setStage(player, STAGE_ABOMINATION);
      event.after = () =>
        defer(player, () => {
          startTranscript(api, player, VERTIDA_NPC_ID, PAGE, "it-s-a-trap-attack-of-the-abomination");
          ensureAbomination(player);
        });
      return;
    }
    if (text.includes("we'll let you get off")) {
      if (!SAFALAAN_IDS.has(npcId)) return;
      if (quest.getStage(player) < STAGE_FINISHING) return;
      event.after = () =>
        defer(player, () => {
          startTranscript(api, player, NpcIdentifiers.VANESCULA_DRAKAN_5, PAGE, "finishing-up-epilogue");
        });
      return;
    }
    if (text.includes("Myreque prevail!") && quest.getStage(player) === STAGE_RANIS_DEAD) {
      quest.setStage(player, STAGE_SPEECH_DONE);
    }
  }

  // ---------------------------------------------------------------------------
  // The abomination (hideout trap)
  // ---------------------------------------------------------------------------

  function ensureAbomination(player) {
    if (quest.getStage(player) !== STAGE_ABOMINATION) return;
    const npc = spawnKey(player, "abomination", 8262, ABOMINATION_TILE);
    const saved = attributeNumber(player, ABOMINATION_HP_ATTRIBUTE);
    if (npc && saved > 0 && npc.getHitpoints?.() > saved) npc.setHitpoints(saved);
  }

  function handleAbominationDeath(player, npc) {
    forgetSpawn(player, npc);
    api.removeNpc(npc);
    player.setAttribute(ABOMINATION_HP_ATTRIBUTE, 0);
    if (quest.getStage(player) !== STAGE_ABOMINATION) return;
    quest.setStage(player, STAGE_ABANDONED);
    defer(player, () =>
      startTranscript(api, player, VERTIDA_NPC_ID, PAGE, "it-s-a-trap-the-abomination-s-death")
    );
  }

  // ---------------------------------------------------------------------------
  // Ranis Drakan (boss fight)
  // ---------------------------------------------------------------------------

  function fightState(player) {
    let state = fightByPlayer.get(player);
    if (!state) {
      state = { ranis: null, phase: 0, vyrewatch: new Set() };
      fightByPlayer.set(player, state);
    }
    return state;
  }

  function clearRanisFight(player) {
    const state = fightByPlayer.get(player);
    if (!state) return;
    if (state.ranis) api.removeNpc(state.ranis);
    for (const npc of state.vyrewatch) api.removeNpc(npc);
    fightByPlayer.delete(player);
  }

  function ensureRanisFight(player) {
    const stage = quest.getStage(player);
    if (stage !== STAGE_FIGHT && stage !== STAGE_RANIS_DEAD) return;
    if (stage === STAGE_RANIS_DEAD) return;
    const state = fightState(player);
    const savedPhase = attributeNumber(player, RANIS_PHASE_ATTRIBUTE);
    if (state.ranis && state.ranis.isRegistered?.() !== false && (state.ranis.getHitpoints?.() ?? 1) > 0) {
      return;
    }
    clearRanisFight(player);
    const fresh = fightState(player);
    fresh.phase = savedPhase;
    fresh.ranis = spawnKey(player, "ranis", 8244, RANIS_TILE);
    fresh.ranis?.setMultiCombat?.(true);
    const savedHp = attributeNumber(player, RANIS_HP_ATTRIBUTE);
    if (fresh.ranis && savedHp > 0 && fresh.ranis.getHitpoints?.() > savedHp) {
      fresh.ranis.setHitpoints(savedHp);
    }
    if (savedPhase === 1 || savedPhase === 3) {
      spawnVyrewatchPair(
        player,
        savedPhase === 1 ? [8256, 8257] : [8258, 8259],
        [
          { x: RANIS_TILE.x - 1, y: RANIS_TILE.y, z: 0 },
          { x: RANIS_TILE.x + 1, y: RANIS_TILE.y, z: 0 },
        ]
      );
    }
  }

  function spawnVyrewatchPair(player, ids, tiles) {
    const state = fightState(player);
    const spawned = [];
    for (let index = 0; index < ids.length; index++) {
      const npc = spawnKey(player, `ranis_vyre_${ids[index]}`, ids[index], tiles[index]);
      if (npc) {
        // The fight is multi-way in OSRS; without it single-combat rules stop the
        // player switching from Ranis to his vyrewatch (the phase never ends).
        npc.setMultiCombat?.(true);
        state.vyrewatch.add(npc);
        spawned.push(npc);
      }
    }
    return spawned;
  }

  function phaseOne(player) {
    const state = fightState(player);
    if (state.phase !== 0) return;
    state.phase = 1;
    spawnVyrewatchPair(player, [8256, 8257], [
      { x: RANIS_TILE.x - 1, y: RANIS_TILE.y, z: 0 },
      { x: RANIS_TILE.x + 1, y: RANIS_TILE.y, z: 0 },
    ]);
    defer(player, () =>
      startTranscript(
        api,
        player,
        RANIS_HUMAN_NPC_ID,
        PAGE,
        "the-taste-of-hope-the-fight-with-ranis-after-reaching-65-of-his-health"
      )
    );
  }

  function phaseThree(player) {
    const state = fightState(player);
    if (state.phase !== 2) return;
    state.phase = 3;
    spawnVyrewatchPair(player, [8258, 8259], [
      { x: RANIS_TILE.x - 1, y: RANIS_TILE.y, z: 0 },
      { x: RANIS_TILE.x + 1, y: RANIS_TILE.y, z: 0 },
    ]);
    defer(player, () =>
      startTranscript(
        api,
        player,
        RANIS_HUMAN_NPC_ID,
        PAGE,
        "the-taste-of-hope-the-fight-with-ranis-after-reaching-25-of-his-health"
      )
    );
  }

  function immune(player) {
    const now = Date.now();
    if ((lastImmuneMessage.get(player) ?? 0) > now - 1500) return;
    lastImmuneMessage.set(player, now);
    player.sendMessage("Your weapon cannot harm the vyrewatch - only the Ivandis flail or Rod of Ivandis can.");
  }

  function zeroHit(hit) {
    for (const part of hit.getHits?.() ?? []) part.setDamage(0);
    hit.updateTotalDamage?.();
  }

  function handleNpcHitModify(event) {
    const { npc, hit } = event;
    if (!npc || !hit) return;
    const attacker = hit.getAttacker?.();
    if (attacker?.isPlayer?.() !== true) return;
    const player = attacker.getAsPlayer();
    const npcId = npc.getId?.();
    if (ABOMINATION_IDS.has(npcId)) {
      const after = (npc.getHitpoints?.() ?? 0) - (hit.getTotalDamage?.() ?? 0);
      player.setAttribute(ABOMINATION_HP_ATTRIBUTE, Math.max(0, after));
      return;
    }
    const isRanis = RANIS_FIGHT_IDS.has(npcId);
    const isFightVyre = VYREWATCH_FIGHT_IDS.has(npcId);
    if (!isRanis && !isFightVyre) return;
    if (isRanis) {
      if (!wearingFlail(player)) {
        zeroHit(hit);
        player.sendMessage("Ranis can only be harmed by the Ivandis flail.");
        return;
      }
    } else if (!wearingFlailOrRod(player)) {
      zeroHit(hit);
      immune(player);
      return;
    }
    if (!isRanis) return;
    const current = fightState(player);
    if (current.ranis !== npc) current.ranis = npc;
    if (current.phase === 1 || current.phase === 3) {
      zeroHit(hit);
      player.sendMessage("Ranis is airborne - deal with his vyrewatch first!");
      return;
    }
    const max = npc.getMaxHitpoints?.() ?? 400;
    const after = (npc.getHitpoints?.() ?? max) - (hit.getTotalDamage?.() ?? 0);
    player.setAttribute(RANIS_HP_ATTRIBUTE, Math.max(0, after));
    player.setAttribute(RANIS_PHASE_ATTRIBUTE, current.phase);
    if (current.phase === 0 && after <= max * 0.65) {
      phaseOne(player);
    } else if (current.phase === 2 && after <= max * 0.25) {
      phaseThree(player);
    }
  }

  function handleVyrewatchDeath(player, npc) {
    const state = fightByPlayer.get(player);
    if (state && state.vyrewatch.has(npc)) {
      state.vyrewatch.delete(npc);
      forgetSpawn(player, npc);
      if (state.vyrewatch.size === 0 && state.phase === 1) {
        state.phase = 2;
        defer(player, () =>
          startTranscript(
            api,
            player,
            RANIS_HUMAN_NPC_ID,
            PAGE,
            "the-taste-of-hope-the-fight-with-ranis-after-killing-a-vyrewatch"
          )
        );
      } else if (state.vyrewatch.size === 0 && state.phase === 3) {
        state.phase = 4;
        defer(player, () =>
          startTranscript(
            api,
            player,
            RANIS_HUMAN_NPC_ID,
            PAGE,
            "the-taste-of-hope-the-fight-with-ranis-after-killing-the-final-vyrewatch"
          )
        );
      }
      return;
    }
  }

  function handleRanisDeath(player, npc) {
    const state = fightByPlayer.get(player);
    if (state?.ranis !== npc) return;
    clearRanisFight(player);
    player.setAttribute(RANIS_HP_ATTRIBUTE, 0);
    player.setAttribute(RANIS_PHASE_ATTRIBUTE, 0);
    if (quest.getStage(player) !== STAGE_FIGHT) return;
    quest.setStage(player, STAGE_RANIS_DEAD);
    defer(player, () => {
      startTranscript(api, player, RANIS_HUMAN_NPC_ID, PAGE, "the-taste-of-hope-a-speech-of-hope");
    });
  }

  function handleNpcDeath(event) {
    const killer = event.killer;
    if (!killer || killer.isPlayer?.() !== true) return;
    const player = killer;
    const npc = event.npc;
    if (ABOMINATION_IDS.has(event.npcId)) {
      handleAbominationDeath(player, npc);
      return;
    }
    if (VYREWATCH_FIGHT_IDS.has(event.npcId)) {
      handleVyrewatchDeath(player, npc);
      return;
    }
    if (RANIS_FIGHT_IDS.has(event.npcId)) {
      handleRanisDeath(player, npc);
    }
  }

  // ---------------------------------------------------------------------------
  // Objects: the rooftop route, the house and the crates
  // ---------------------------------------------------------------------------

  /** Searches a container. `repeatable` containers (the potion ingredients) hand one out each time. */
  function searchCrate(event, bit, itemId, foundMessage, emptyMessage, repeatable = false) {
    const { player } = event;
    event.handled = true;
    if (!repeatable && hasBit(player, bit)) {
      player.sendMessage(emptyMessage);
      return;
    }
    if (!give(player, itemId, 1)) return;
    setBit(player, bit);
    player.sendMessage(foundMessage);
  }

  function climbWall(event) {
    const { player } = event;
    event.handled = true;
    const stage = quest.getStage(player);
    if (stage < STAGE_SAW_SAFALAAN) {
      player.sendMessage("You have no reason to climb up there.");
      return;
    }
    if (stage < STAGE_HARPERT_PAID) {
      startTranscript(api, player, VYREWATCH_GUARD_NPC_ID, PAGE, "vampyric-espionage-attempting-to-climb-up-the-rubble-near-the-bank");
      return;
    }
    if (stage >= STAGE_HOUSE_DIRECTED) {
      player.sendMessage("There is nothing up there for you now.");
      return;
    }
    startTranscript(api, player, HARPERT_CONTENT_NPC_ID, PAGE, "vampyric-espionage-attempting-to-climb-up-the-rubble-near-the-bank-after-paying-harpert");
  }

  function lookThroughWindow(event) {
    const { player } = event;
    event.handled = true;
    const stage = quest.getStage(player);
    if (stage < STAGE_MERCS_SPOKEN) {
      player.sendMessage("You can't see much through the dusty glass.");
      return;
    }
    startTranscript(api, player, RANIS_HUMAN_NPC_ID, PAGE, "vampyric-espionage-spying-on-ranis-and-vanstrom");
  }

  function openSerafinaDoor(event) {
    const { player } = event;
    event.handled = true;
    if (hasBit(player, BIT_DOOR_OPEN)) {
      // Standing on the door tile counts as inside: the doorway blocks walking
      // through (the loc never swaps), so the door teleport is the only way out.
      const inside = player.getLocation().getY() >= 9680;
      teleport(player, { x: 3596, y: inside ? 9678 : 9682, z: 0 });
      return;
    }
    player.sendMessage("The door is locked firm. There is some writing carved into it, but it is hard to read.");
  }

  function handleObjectInteraction(event) {
    const { player, objectId, definition } = event;
    if (!player) return;
    const resolvedId = definition?.id ?? objectId;
    if (objectId === SPY_WINDOW_ID) {
      lookThroughWindow(event);
      return;
    }
    if (resolvedId === FOUNTAIN_OP_ID || objectId === FOUNTAIN_OP_ID) {
      // The map only resolves the fountain to its inspectable form (32557) at
      // stage 75, when Safalaan has pointed it out.
      if (quest.getStage(player) >= STAGE_AT_HOUSE) {
        event.handled = true;
        startTranscript(api, player, PROP_NPC_ID, PAGE, "the-myth-of-serafina-inspecting-the-broken-fountain");
      }
      return;
    }
    if (objectId === RUBBLE_MULTI_ID || objectId === RUBBLE_OP_ID || resolvedId === RUBBLE_OP_ID) {
      climbWall(event);
      return;
    }
    if (objectId === VENT_ID && event.clickType === 1) {
      event.handled = true;
      const location = player.getLocation();
      teleport(player, { x: location.getX(), y: location.getY(), z: Math.min(3, location.getZ() + 1) });
      return;
    }
    if (objectId === ROOF_JUMP_ID && event.clickType === 1) {
      event.handled = true;
      const location = player.getLocation();
      teleport(player, { x: location.getX(), y: location.getY(), z: Math.max(0, location.getZ() - 1) });
      return;
    }
    if (objectId === ROOF_UP_ID && event.clickType === 1) {
      event.handled = true;
      const location = player.getLocation();
      teleport(player, { x: location.getX(), y: location.getY(), z: Math.min(3, location.getZ() + 1) });
      return;
    }
    if (objectId === ROOF_DOWN_ID && event.clickType === 1) {
      event.handled = true;
      const location = player.getLocation();
      teleport(player, { x: location.getX(), y: location.getY(), z: Math.max(0, location.getZ() - 1) });
      return;
    }
    if (objectId === SERAFINA_DOOR_ID) {
      openSerafinaDoor(event);
      return;
    }
    if (objectId === HERB_BARREL_ID) {
      searchCrate(
        event,
        BIT_HERB_TAKEN,
        MYSTERIOUS_HERB_ITEM_ID,
        "You search the barrel and find a mysterious herb.",
        "The barrel holds nothing but dust.",
        true
      );
      return;
    }
    if (objectId === MEAT_CRATE_ID) {
      searchCrate(
        event,
        BIT_MEAT_TAKEN,
        MYSTERIOUS_MEAT_ITEM_ID,
        "You search the crate and find some mysterious meat.",
        "The crate is empty.",
        true
      );
      return;
    }
    if (objectId === VIAL_CRATE_ID) {
      searchCrate(event, BIT_VIAL_TAKEN, VIAL_ITEM_ID, "You find an empty vial.", "The crate is empty.", true);
      return;
    }
    if (objectId === PESTLE_CRATE_ID) {
      searchCrate(
        event,
        BIT_PESTLE_TAKEN,
        ItemIdentifiers.PESTLE_AND_MORTAR,
        "You find a pestle and mortar.",
        "The crate is empty.",
        true
      );
      return;
    }
    if (EMPTY_CONTAINER_IDS.has(objectId)) {
      event.handled = true;
      player.sendMessage("There is nothing useful in there.");
      return;
    }
    if (objectId === CHEST_CLOSED_ID) {
      event.handled = true;
      if (hasBit(player, BIT_NOTES_TAKEN)) {
        player.sendMessage("The chest is empty.");
        return;
      }
      if (!hasBit(player, BIT_DOOR_OPEN)) {
        player.sendMessage("The chest is behind the locked door.");
        return;
      }
      startTranscript(api, player, PROP_NPC_ID, PAGE, "the-myth-of-serafina-searching-the-chest");
      return;
    }
    if (objectId === CHEST_OPEN_ID) {
      event.handled = true;
      player.sendMessage("The chest is empty.");
      return;
    }
    if (objectId === SERAFINA_BED_ID) {
      event.handled = true;
      if (hasBit(player, BIT_DIARY_TAKEN)) {
        player.sendMessage("There is nothing else in the bed.");
        return;
      }
      if (!give(player, OLD_DIARY_ITEM_ID, 1)) return;
      setBit(player, BIT_DIARY_TAKEN);
      syncTome(player);
      player.sendMessage("You find an old diary tucked under the mattress.");
      return;
    }
    if (objectId === SICKLE_CRATE_ID) {
      searchCrate(
        event,
        BIT_SICKLE_TAKEN,
        SILVER_SICKLE_B_ITEM_ID,
        "You find a silver sickle (b).",
        "The crate is empty."
      );
      return;
    }
    if (objectId === CHAIN_CRATE_ID) {
      searchCrate(event, BIT_CHAIN_TAKEN, CHAIN_ITEM_ID, "You find a length of chain.", "The crate is empty.");
    }
  }

  // ---------------------------------------------------------------------------
  // Objects: item use
  // ---------------------------------------------------------------------------

  function handleItemOnObject(event) {
    const { player, itemId, objectId, definition } = event;
    if (!player) return;
    const resolvedId = definition?.id ?? objectId;
    const fountain = objectId === FOUNTAIN_MULTI_ID || objectId === FOUNTAIN_OP_ID || resolvedId === FOUNTAIN_OP_ID;
    if (fountain && itemId === VIAL_ITEM_ID) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_HOUSE_DIRECTED) {
        player.sendMessage("The fountain is bone dry.");
        return;
      }
      player.getInventory().deleteNumber(VIAL_ITEM_ID, 1);
      player.getInventory().adds(VIAL_OF_WATER_ITEM_ID, 1);
      player.sendMessage("You fill the vial with water from the fountain.");
      return;
    }
    if (objectId === SERAFINA_DOOR_ID && itemId === POTION_ITEM_ID) {
      event.handled = true;
      player.getInventory().deleteNumber(POTION_ITEM_ID, 1);
      setBit(player, BIT_POTION_CHECKED);
      syncSerafinaWire(player);
      narrate(player, [
        "You pour the potion over the door. The liquid sinks into the wood.",
        "Faint writing appears: \"Blood is the price of victory.\"",
      ]);
      return;
    }
    if (objectId === SERAFINA_DOOR_ID && itemId === BLOOD_POTION_ITEM_ID) {
      event.handled = true;
      player.getInventory().deleteNumber(BLOOD_POTION_ITEM_ID, 1);
      setBit(player, BIT_POTION_CHECKED);
      setBit(player, BIT_DOOR_OPEN);
      syncSerafinaWire(player);
      player.sendMessage("You pour the blood potion over the door. It swings open.");
      return;
    }
  }

  // ---------------------------------------------------------------------------
  // Items: combining the flail, the tome and the medallion
  // ---------------------------------------------------------------------------

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    if (!player) return;
    const pair = new Set([usedItemId, usedWithItemId]);
    const hasPestle = [...PESTLE_AND_MORTAR_IDS].some((id) => pair.has(id));
    if (pair.has(MYSTERIOUS_MEAT_ITEM_ID) && hasPestle) {
      event.handled = true;
      if (held(player, MYSTERIOUS_CRUSHED_MEAT_ITEM_ID)) return;
      player.getInventory().deleteNumber(MYSTERIOUS_MEAT_ITEM_ID, 1);
      player.getInventory().adds(MYSTERIOUS_CRUSHED_MEAT_ITEM_ID, 1);
      player.sendMessage("You grind the mysterious meat into a paste with the pestle and mortar.");
      return;
    }
    if (pair.has(MYSTERIOUS_HERB_ITEM_ID) && pair.has(VIAL_OF_WATER_ITEM_ID)) {
      event.handled = true;
      player.getInventory().deleteNumber(MYSTERIOUS_HERB_ITEM_ID, 1);
      player.getInventory().deleteNumber(VIAL_OF_WATER_ITEM_ID, 1);
      player.getInventory().adds(UNFINISHED_POTION_ITEM_ID, 1);
      player.sendMessage("You mix the mysterious herb into the vial of water.");
      return;
    }
    if (pair.has(MYSTERIOUS_HERB_ITEM_ID) && pair.has(VIAL_OF_BLOOD_ITEM_ID)) {
      event.handled = true;
      player.getInventory().deleteNumber(MYSTERIOUS_HERB_ITEM_ID, 1);
      player.getInventory().deleteNumber(VIAL_OF_BLOOD_ITEM_ID, 1);
      player.getInventory().adds(UNFINISHED_BLOOD_POTION_ITEM_ID, 1);
      player.sendMessage("You mix the mysterious herb into the vial of blood.");
      return;
    }
    if (pair.has(MYSTERIOUS_CRUSHED_MEAT_ITEM_ID) && pair.has(UNFINISHED_POTION_ITEM_ID)) {
      event.handled = true;
      player.getInventory().deleteNumber(MYSTERIOUS_CRUSHED_MEAT_ITEM_ID, 1);
      player.getInventory().deleteNumber(UNFINISHED_POTION_ITEM_ID, 1);
      player.getInventory().adds(POTION_ITEM_ID, 1);
      player.sendMessage("You add the crushed meat to the unfinished potion.");
      return;
    }
    if (pair.has(MYSTERIOUS_CRUSHED_MEAT_ITEM_ID) && pair.has(UNFINISHED_BLOOD_POTION_ITEM_ID)) {
      event.handled = true;
      player.getInventory().deleteNumber(MYSTERIOUS_CRUSHED_MEAT_ITEM_ID, 1);
      player.getInventory().deleteNumber(UNFINISHED_BLOOD_POTION_ITEM_ID, 1);
      player.getInventory().adds(BLOOD_POTION_ITEM_ID, 1);
      player.sendMessage("You add the crushed meat to the unfinished blood potion.");
      return;
    }
    if (pair.has(SILVER_SICKLE_B_ITEM_ID) && [...EMERALD_IDS].some((id) => pair.has(id))) {
      const emerald = [...EMERALD_IDS].find((id) => pair.has(id));
      event.handled = true;
      if (!held(player, CHISEL_ITEM_ID)) {
        player.sendMessage("You need a chisel to attach the emerald.");
        return;
      }
      if (held(player, EMERALD_SICKLE_B_ITEM_ID)) {
        player.sendMessage("You already have an emerald sickle (b).");
        return;
      }
      player.getInventory().deleteNumber(emerald, 1);
      player.getInventory().deleteNumber(SILVER_SICKLE_B_ITEM_ID, 1);
      player.getInventory().adds(EMERALD_SICKLE_B_ITEM_ID, 1);
      player.sendMessage("You use the chisel to attach the emerald to the silver sickle.");
      return;
    }
    if (pair.has(EMERALD_SICKLE_B_ITEM_ID) && pair.has(ENCHANT_EMERALD_TABLET_ITEM_ID)) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_NOTES_READ) {
        player.sendMessage("You have no reason to enchant this yet.");
        return;
      }
      player.getInventory().deleteNumber(ENCHANT_EMERALD_TABLET_ITEM_ID, 1);
      player.getInventory().deleteNumber(EMERALD_SICKLE_B_ITEM_ID, 1);
      player.getInventory().adds(ENCHANTED_EMERALD_SICKLE_B_ITEM_ID, 1);
      player.sendMessage("You enchant the emerald sickle with the tablet.");
      return;
    }
    if (pair.has(CHAIN_ITEM_ID) && (pair.has(ENCHANTED_EMERALD_SICKLE_B_ITEM_ID) || hasRodInPair(pair))) {
      event.handled = true;
      if (!held(player, ENCHANTED_EMERALD_SICKLE_B_ITEM_ID) || !held(player, CHAIN_ITEM_ID) || !hasRod(player)) {
        player.sendMessage("You need the chain, an enchanted emerald sickle (b) and the Rod of Ivandis.");
        return;
      }
      player.getInventory().deleteNumber(CHAIN_ITEM_ID, 1);
      player.getInventory().deleteNumber(ENCHANTED_EMERALD_SICKLE_B_ITEM_ID, 1);
      deleteRod(player);
      player.getInventory().adds(IVANDIS_FLAIL_ITEM_ID, 1);
      setBit(player, BIT_FLAIL_CREATED);
      advance(player, STAGE_FLAIL);
      narrate(player, [
        "You join the enchanted sickle to the rod with the chain.",
        "You have created the Ivandis flail.",
      ]);
    }
  }

  function provideSickleEnchantRecipe(request) {
    if (request.itemId !== EMERALD_SICKLE_B_ITEM_ID || request.spellName !== "Lvl-2 Enchant") return;
    if (quest.getStage(request.player) < STAGE_NOTES_READ) {
      request.declined = true;
      request.message = "You have no reason to enchant this yet.";
      return;
    }
    request.resultId = ENCHANTED_EMERALD_SICKLE_B_ITEM_ID;
    request.message = "As you cast Lvl-2 Enchant, the sickle vibrates and glows.";
  }

  function hasRodInPair(pair) {
    for (const itemId of ROD_OF_IVANDIS_ITEM_IDS) {
      if (pair.has(itemId)) return true;
    }
    return false;
  }

  const NOTES_TEXT = [
    "I have been translating the Haemalchemy book. Vampyre immunities come from two factors: mundane weapons barely scratch them, so a silver weapon is needed, and stronger vampyres dodge any predictable attack.",
    "To overcome that, a weapon must strike unpredictably: a flail. Three parts: a shaft, a head and a chain. The Rod of Ivandis will make a good shaft, a reinforced silver sickle - an emerald enchantment - the head, and any sturdy chain will join them.",
  ];

  function readFlaygiansNotes(event) {
    const { player } = event;
    if (event.itemId !== FLAYGIANS_NOTES_ITEM_ID) return false;
    narrate(player, NOTES_TEXT);
    if (!hasBit(player, BIT_NOTES_READ)) {
      setBit(player, BIT_NOTES_READ);
      advance(player, STAGE_NOTES_READ);
    }
    return true;
  }

  function readOldNotes(event) {
    if (event.itemId !== OLD_NOTES_ITEM_ID) return false;
    event.player.sendMessage("The notes are a rambling mess. You can make neither head nor tail of them.");
    return true;
  }

  function readOldDiary(event) {
    if (event.itemId !== OLD_DIARY_ITEM_ID) return false;
    narrate(event.player, [
      "The diary belonged to Serafina. It ends with her walking into the Theatre of Blood for her brother's sake.",
    ]);
    return true;
  }

  function readTome(event) {
    const { player, item, slot } = event;
    if (event.itemId !== TOME_OF_EXPERIENCE_ITEM_ID) return false;
    const used = attributeNumber(player, TOME_ATTRIBUTE);
    if (used >= 3) {
      player.sendMessage("The tome's pages are all blank.");
      return true;
    }
    api.emitCustomEvent("xpreward:open", {
      player,
      minLevel: 35,
      title: "Choose the stat you wish to be advanced!",
      onConfirm: (skill, name) => {
        const skills = player.getSkillManager();
        const before = skills.getExperience(skill);
        skills.addExperience(skill, 2500, false);
        if (skills.getExperience(skill) === before) return null;
        const chapters = attributeNumber(player, TOME_ATTRIBUTE) + 1;
        player.setAttribute(TOME_ATTRIBUTE, chapters);
        syncTome(player);
        if (chapters >= 3 && player.getInventory().get(slot) === item) {
          player.getInventory().deleteAtSlot(slot, 1);
          player.sendMessage("The book crumbles into a dust cloud of knowledge.");
        }
        return `You read a fascinating chapter and earn experience! You have been awarded 2,500 ${name ?? skill.getName()} experience!`;
      },
    });
    return true;
  }

  function teleportMedallion(event) {
    if (event.itemId !== DRAKANS_MEDALLION_ITEM_ID) return false;
    const { player } = event;
    const destination = new Location(VER_SINHAZA_TELEPORT.x, VER_SINHAZA_TELEPORT.y, VER_SINHAZA_TELEPORT.z);
    if (!TeleportHandler.checkReqs(player, destination, 20)) return true;
    TeleportHandler.teleport(player, destination, TeleportType.NORMAL, false);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Harpert: claimed by name because his live content id is not indexed
  // ---------------------------------------------------------------------------

  function talkVeliafRod(event) {
    const { player, npcId } = event;
    if (!VELIAF_IDS.has(npcId)) return false;
    if (!needsVeliafRod(player)) return false;
    startTranscript(api, player, npcId, PAGE, "the-legendary-weapon-talking-to-veliaf");
    return true;
  }

  function restartRanisSpeech(event) {
    const { player } = event;
    if (!player || quest.getStage(player) !== STAGE_RANIS_DEAD) return false;
    startTranscript(api, player, RANIS_HUMAN_NPC_ID, PAGE, "the-taste-of-hope-a-speech-of-hope");
    return true;
  }

  function talkHarpert(event) {
    const { player, definition } = event;
    if (definition?.getName?.() !== "Harpert") return false;
    const stage = quest.getStage(player);
    if (stage >= STAGE_MERCS_SPOKEN && stage < STAGE_HARPERT_PAID) {
      startTranscript(api, player, HARPERT_CONTENT_NPC_ID, PAGE, "vampyric-espionage-talking-to-harpert");
      return true;
    }
    if (stage >= STAGE_HARPERT_PAID && stage < STAGE_SPIED) {
      startTranscript(
        api,
        player,
        HARPERT_CONTENT_NPC_ID,
        PAGE,
        "vampyric-espionage-talking-to-harpert-talking-to-harper-after-giving-him-1-000-coins"
      );
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Ladders: the house stairs carry the arrival stage
  // ---------------------------------------------------------------------------

  function claimLadder(request) {
    if (request.handled || !request.player) return;
    const objectId = request.objectId ?? request.object?.getId?.();
    const definitionId = request.object?.getDefinition?.()?.getId?.();
    const id = objectId ?? definitionId;
    if (id !== SERAFINA_STAIRS_DOWN_ID && id !== SERAFINA_STAIRS_UP_ID) return;
    const stage = quest.getStage(request.player);
    if (id === SERAFINA_STAIRS_DOWN_ID && stage >= STAGE_HOUSE_DIRECTED && stage < STAGE_AT_HOUSE) {
      request.handled = true;
      quest.setStage(request.player, STAGE_AT_HOUSE);
      teleport(request.player, HOUSE_STAIRS_LANDING);
    }
  }

  // ---------------------------------------------------------------------------
  // The hideout entry warning (the trap is an instance in OSRS)
  // ---------------------------------------------------------------------------

  const HIDEOUT_BOUNDS = new Boundary(3615, 3648, 9595, 9660, 0);

  class HideoutWarningArea extends Area {
    postEnter(character) {
      if (!character?.isPlayer?.()) return;
      const player = character.getAsPlayer();
      if (player.isPlayerBot?.() === true) return;
      const stage = quest.getStage(player);
      if (stage < STAGE_NOTES_DELIVERED || stage >= STAGE_ABOMINATION) return;
      warningPending.add(player);
      defer(player, () => {
        if (quest.getStage(player) < STAGE_NOTES_DELIVERED) return;
        startTranscript(api, player, PROP_NPC_ID, PAGE, "it-s-a-trap-attempting-to-enter-the-hideout");
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Session lifecycle
  // ---------------------------------------------------------------------------

  function handleLogin({ player }) {
    refreshQuestList(player);
    applyStageSpawns(player);
    syncTome(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    despawnAll(player);
    fightByPlayer.delete(player);
  }

  /** A reset (::quest reset sets the stage to 0) must clear the side bits, or a replay reads them. */
  function resetQuestState(player) {
    for (const attribute of [
      BITS_ATTRIBUTE,
      ABOMINATION_HP_ATTRIBUTE,
      RANIS_HP_ATTRIBUTE,
      RANIS_PHASE_ATTRIBUTE,
    ]) {
      player.setAttribute(attribute, 0);
    }
    despawnAll(player);
  }

  function handleStageChanged({ player, key, stage }) {
    if (!player || key !== "taste_of_hope") return;
    if ((stage | 0) <= STAGE_UNSTARTED) resetQuestState(player);
    applyStageSpawns(player);
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  for (const attribute of [
    BITS_ATTRIBUTE,
    TOME_ATTRIBUTE,
    ABOMINATION_HP_ATTRIBUTE,
    RANIS_HP_ATTRIBUTE,
    RANIS_PHASE_ATTRIBUTE,
  ]) {
    api.persistAttribute(attribute);
  }

  quest = registerQuest(api, {
    key: "taste_of_hope",
    name: "A Taste of Hope",
    varpId: VARP_TASTE_OF_HOPE,
    varbitId: VARBIT_TASTE_OF_HOPE,
    // The wire is the native myq4 value (the Quest Helper's step keys and the
    // cache's NPC transform windows), not the internal stage.
    varbitValue(stage, player) {
      return wireStage(stage, player);
    },
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    scrollItemId: TOME_OF_EXPERIENCE_ITEM_ID,
    rewardItemLabel: "Ivandis flail, Drakan's medallion and Tome of Experience",
    otherRewards: ["The Ivandis flail can harm the vyrewatch", "Darkmeyer access (later)"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:condition", handleDialogueCondition);
  api.onCustomEvent("taste-of-hope:needs-veliaf-rod", answerVeliafRodNeed);
  api.onCustomEvent("taste-of-hope:flail-reclaim", handleFlailReclaimRequest);
  api.onNpcInteraction("Veliaf Hurtz", { "Talk-to": talkVeliafRod });
  api.onNpcInteraction("Harpert", { "Talk-to": talkHarpert });
  api.onNpcInteraction("Kael Forshaw", { "Talk-to": restartRanisSpeech });
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
  api.onCustomEvent("ladders:climb", claimLadder);
  api.onNpcHitModify(handleNpcHitModify);
  api.onNpcDeath(handleNpcDeath);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnItem(handleItemOnItem);
  api.onCustomEvent("magic:enchant-item-recipe", provideSickleEnchantRecipe);
  api.onItemAction("Flaygian's notes", { Read: readFlaygiansNotes });
  api.onItemAction("Old notes", { Read: readOldNotes });
  api.onItemAction("Old diary", { Read: readOldDiary });
  api.onItemAction("Tome of Experience", { Read: readTome });
  api.onItemAction("Drakan's medallion", { Teleport: teleportMedallion });
  api.registerArea(new HideoutWarningArea([HIDEOUT_BOUNDS]));
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
