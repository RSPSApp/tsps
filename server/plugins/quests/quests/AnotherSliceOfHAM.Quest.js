/**
 * Another Slice of H.A.M. (members).
 *
 * The words come from the "Another Slice of H.A.M." transcript page; this plugin
 * supplies the variant selection for every quest NPC, the dig/clean/hand-in loop
 * for the six artefacts, the Goblin Village sniper fight, the kidnapped-Zanik
 * tunnel escort and the Sigmund railway fight that completes the quest.
 *
 * Stage varbit: 3550 "slice_quest" (varp 997, bits 0-10). Evidence: cs2 script
 * 4024 (the quest list's quest-id -> progress map) case 1 (quest DB row id 1)
 * reads varbit 3550; dbTable 0 row 1 is "Another Slice of H.A.M." in every string
 * column and its completion column 19 holds 11. The cache also keys NPC
 * multilocs to this varbit, which pins the stage meanings:
 *   6282 Ambassador Alvijar (next to Ur-tag) -> 5177 at values 8-10
 *   6283 Ambassador Alvijar (station)        -> 5177 at value 11
 *   5183 Tegdak (city party)                 -> 5182 at value 11
 *   6278/6279 sergeants (swamp surface)      -> 5161/5162 at values 8-9
 *   6280/6281 sergeants (swamp caves)        -> 5161/5162 at value 9
 * and varbit 3557 "slice_zanik_at_dig" turns the placeholder 6284 into Zanik
 * 5184 at the dig at value 1. 3551-3556 "slice_artifact_1..6" drive the six
 * dig-spot multilocs (23290/23293/23296/23534/23301/23304: 0 artefact, 1 hole).
 *
 * Stages (varbit 3550): 1 started, 2 digging (tools in hand), 3 six artefacts
 * handed in (Zanik at the dig, mace to the scribe), 4 scribe sent us to the
 * goblin generals, 5 teleported to Goblin Village (before the generals' cutscene),
 * 6 the ambush cutscene is over (snipers alive), 7 H.A.M. archer and mage dead,
 * 8 Sigmund kidnapped Zanik (sergeants at the Lumbridge Swamp, Alvijar back in the
 * city), 9 in the swamp tunnel and then the railway showdown until the prayer
 * breaks (cave sergeants visible), 10 the ancient mace special has landed (untie
 * Zanik), 11 complete (the cache DB's own completion value).
 *
 * Rewards per the OSRS Wiki: 1 Quest point, 3,000 Mining and 3,000 Prayer XP,
 * the ancient mace, the ability to buy Goblin Village teleport spheres and free
 * access to the Dorgesh-Kaan - Keldagrim train.
 *
 * Requirements per the Quick guide: 15 Attack, 25 Prayer and Death to the
 * Dorgeshuun, The Giant Dwarf and The Dig Site complete (the transcript only has
 * a generic "doesn't have the requirements" condition, answered from these).
 *
 * Sources: OSRS Wiki "Another Slice of H.A.M.", its Quick guide and Transcript;
 * the cache for every id, varbit, transform and placement.
 * Tunnel checkpoints: Quest Helper 06da90f982518a093f2fe1c9cfac5547fa7053d3,
 * helpers/quests/anothersliceofham/AnotherSliceOfHam.java (guardsPassed/guardEngaged).
 *
 * Gaps / approximations:
 *  - Cutscenes replay as transcript lines on one chathead; there is no camera and
 *    no instance. The village fight uses the quest's own outpost map (objects
 *    23320-23533 around 2440,5415): the generals' cutscene teleports there, the
 *    two H.A.M. members stand on its tower (z=2, ladder 23531/23532) with its
 *    hiding crate (23533), and the finish teleports back to the real village.
 *  - Zanik has no follower system here: "following" is varbit 3557, and she is
 *    hidden again once the Goblin Village teleport fires.
 *  - The tunnel patrol uses an inferred two-tick checkpoint, pending a live
 *    timing capture. Hiding, the passed guard and sergeant combat gate the ladder.
 *  - Sigmund has no prayer immunity (combat core): his first hit while the
 *    player carries the ancient mace replays his "overcoming Saradomin's
 *    protection" line, then he fights normally.
 *  - Oldak's static spawn row carries a stale id (2303 is lotg_grubfoot_at_entrance
 *    in this cache); the plugin spawns the real Oldak (11384) one tile west,
 *    owner-only, so his quest dialogue exists. Everything else about the quest
 *    spawns owner-only around the player.
 *  - Dropping an unclean artefact rolls it back (spot varbit reset) instead of
 *    spawning a ground item. The cleaning tables are the cache's "Sample table"
 *    objects (23526/23527), the only tables in the station; the Varrock Museum
 *    "Specimen table" (24556) is a different object.
 *  - The new swamp hole (23282) has no click options in the cache, so walking
 *    onto the tile beside the cave rope drops the player in (once, then again on
 *    a later approach) and the tunnel ladder climbs back out.
 *  - There is no post-quest Ur-tag variant, so a generic greeting is replayed.
 */
module.exports = function registerAnotherSliceOfHAMQuest(api) {
  const {
    Equipment,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Another Slice of H.A.M.";
  const START_HOOK = "quest:another-slice-of-h-a-m:start";

  // ==========================================================================
  // Varbits / stages / attribute keys
  // ==========================================================================

  const VARP_SLICE = 997; // "slice_quest" parent, bits 0-10 carry the stage
  const VARBIT_STAGE = 3550; // slice_quest
  const ARTIFACT_VARBITS = [3551, 3552, 3553, 3554, 3555, 3556]; // slice_artifact_1..6
  const VARBIT_ZANIK_AT_DIG = 3557; // slice_zanik_at_dig
  const VARBIT_HIDING = 3558; // slice_hiding
  const VARBIT_RECEIVED_MACE = 3564; // slice_received_mace

  const STAGE_STARTED = 1;
  const STAGE_DIGGING = 2;
  const STAGE_ARTEFACTS = 3;
  const STAGE_SCRIBE = 4;
  const STAGE_VILLAGE = 5;
  const STAGE_AMBUSH = 6; // the Goblin Village ambush cutscene is over, snipers alive
  const STAGE_SNIPERS_DEAD = 7;
  const STAGE_KIDNAPPED = 8;
  const STAGE_TUNNEL = 9;
  const STAGE_RAILWAY = 10;
  const STAGE_COMPLETE = 11;

  const SPOTS_ATTRIBUTE = "quest.another_slice_of_ham.spots"; // bitmask of dug spots
  const HANDED_IN_ATTRIBUTE = "quest.another_slice_of_ham.handed-in";
  const DELIVERED_ATTRIBUTE = "quest.another_slice_of_ham.delivered"; // bitmask of spots handed to Tegdak
  const ZANIK_AT_DIG_ATTRIBUTE = "quest.another_slice_of_ham.zanik-at-dig";
  const MACE_ATTRIBUTE = "quest.another_slice_of_ham.received-mace";
  const SPECIAL_ATTRIBUTE = "quest.another_slice_of_ham.mace-special-used";
  const SIGMUND_EXPOSED_ATTRIBUTE = "quest.another_slice_of_ham.sigmund-exposed";
  const ZANIK_UNTIED_ATTRIBUTE = "quest.another_slice_of_ham.zanik-untied";
  const TRAIN_AGREEMENT_ATTRIBUTE = "quest.another_slice_of_ham.train-agreement";
  const TRAIN_OPEN_ATTRIBUTE = "quest.another_slice_of_ham.train-open";
  const SNIPERS_ATTRIBUTE = "quest.another_slice_of_ham.snipers-dead"; // bit 1 archer, bit 2 mage
  const ESCORT_ATTRIBUTE = "quest.another_slice_of_ham.escort"; // sergeants following
  const SEPARATED_ATTRIBUTE = "quest.another_slice_of_ham.sergeants-separated";
  const GUARDS_ENGAGED_ATTRIBUTE = "quest.another_slice_of_ham.guards-engaged";
  const HIDING_ATTRIBUTE = "another-slice-of-ham:hiding";
  const PATROL_PASSED_ATTRIBUTE = "another-slice-of-ham:patrol-passed";
  const GUARD_DEFEATED_ATTRIBUTE = "another-slice-of-ham:guard-defeated";

  // ==========================================================================
  // Npc ids (content ids: the cache transform resolution the dialogue index uses)
  // ==========================================================================

  const UR_TAG_NPC_IDS = new Set([
    NpcIdentifiers.UR_TAG, // 2315
    NpcIdentifiers.UR_TAG_2, // 5156
    NpcIdentifiers.UR_TAG_3, // 5326
  ]);
  const AMBASSADOR_ALVIJAR_NPC_ID = NpcIdentifiers.AMBASSADOR_ALVIJAR; // 5177
  const TEGDAK_NPC_ID = NpcIdentifiers.TEGDAK; // 5182
  const GOBLIN_SCRIBE_NPC_ID = NpcIdentifiers.GOBLIN_SCRIBE; // 2302
  const ZANIK_SLICE_NPC_ID = NpcIdentifiers.ZANIK_16; // 5184
  const OLDAK_NPC_ID = NpcIdentifiers.OLDAK_3; // 11384
  const GENERAL_NPC_IDS = new Set([
    NpcIdentifiers.GENERAL_BENTNOZE, // 669
    NpcIdentifiers.GENERAL_WARTFACE, // 670
  ]);
  const SERGEANT_NPC_IDS = new Set([
    NpcIdentifiers.SERGEANT_MOSSFISTS, // 5161
    NpcIdentifiers.SERGEANT_SLIMETOES, // 5162
  ]);
  const BUILDER_NPC_IDS = new Set([
    NpcIdentifiers.BUILDER, // 5178
    NpcIdentifiers.BUILDER_2, // 5179
    NpcIdentifiers.BUILDER_3, // 5180
    NpcIdentifiers.BUILDER_4, // 5181
  ]);
  const GUARD_NPC_ID = NpcIdentifiers.GUARD_86; // 5141
  const HAM_ARCHER_NPC_ID = NpcIdentifiers.H_A_M_ARCHER; // 5157
  const HAM_MAGE_NPC_ID = NpcIdentifiers.H_A_M_MAGE; // 5158
  const SIGMUND_NPC_ID = NpcIdentifiers.SIGMUND_8; // 5142

  // ==========================================================================
  // Item ids
  // ==========================================================================

  const TROWEL_ITEM_ID = ItemIdentifiers.TROWEL; // 676
  const SPECIMEN_BRUSH_ITEM_ID = ItemIdentifiers.SPECIMEN_BRUSH; // 670
  const COINS_ITEM_ID = ItemIdentifiers.COINS; // 995
  const GOBLIN_VILLAGE_SPHERE_ITEM_ID = ItemIdentifiers.GOBLIN_VILLAGE_SPHERE; // 11060
  const ANCIENT_MACE_ITEM_ID = ItemIdentifiers.ANCIENT_MACE; // 11061

  // The six dig spots, in slice_artifact_1..6 order. Sources: cache item names
  // (11048 slice_artifact_1_clean ... 11059 slice_artifact_6_dirty) and the
  // hotspot multilocs 23290/23293/23296/23534/23301/23304 on varbits 3551-3556.
  const DIG_SPOTS = [
    {
      objectId: 23290, // nameless slice_artifact_hotspot_01 parent
      varbit: ARTIFACT_VARBITS[0],
      bit: 1 << 0,
      dirty: ItemIdentifiers.ARTEFACT, // 11049 -> armour shard
      clean: ItemIdentifiers.ARMOUR_SHARD, // 11048
      conditionId: "MN6jwN",
    },
    {
      objectId: 23293, // slice_artifact_hotspot_02 parent
      varbit: ARTIFACT_VARBITS[1],
      bit: 1 << 1,
      dirty: ItemIdentifiers.ARTEFACT_4, // 11055 -> shield fragment
      clean: ItemIdentifiers.SHIELD_FRAGMENT, // 11054
      conditionId: "BbDvSB",
    },
    {
      objectId: 23296, // slice_artifact_hotspot_03 parent
      varbit: ARTIFACT_VARBITS[2],
      bit: 1 << 2,
      dirty: ItemIdentifiers.ARTEFACT_3, // 11053 -> helmet fragment
      clean: ItemIdentifiers.HELMET_FRAGMENT, // 11052
      conditionId: "X2Dw2s",
    },
    {
      objectId: 23534, // slice_artifact_hotspot_04 parent
      varbit: ARTIFACT_VARBITS[3],
      bit: 1 << 3,
      dirty: ItemIdentifiers.ARTEFACT_5, // 11057 -> sword fragment
      clean: ItemIdentifiers.SWORD_FRAGMENT, // 11056
      conditionId: "KX4iC8",
    },
    {
      objectId: 23301, // slice_artifact_hotspot_05 parent
      varbit: ARTIFACT_VARBITS[4],
      bit: 1 << 4,
      dirty: ItemIdentifiers.ARTEFACT_2, // 11051 -> axe head
      clean: ItemIdentifiers.AXE_HEAD, // 11050
      conditionId: "AaJqrV",
    },
    {
      objectId: 23304, // slice_artifact_hotspot_06 parent
      varbit: ARTIFACT_VARBITS[5],
      bit: 1 << 5,
      dirty: ItemIdentifiers.ARTEFACT_6, // 11059 -> mace
      clean: ItemIdentifiers.MACE, // 11058
      conditionId: "-jSaii",
    },
  ];
  const DIG_SPOT_BY_OBJECT = new Map(DIG_SPOTS.map((spot) => [spot.objectId, spot]));
  const DIG_SPOT_BY_DIRTY = new Map(DIG_SPOTS.map((spot) => [spot.dirty, spot]));
  const DIG_SPOT_BY_CLEAN = new Map(DIG_SPOTS.map((spot) => [spot.clean, spot]));
  const DIG_SPOT_BY_HAND_IN = new Map(DIG_SPOTS.map((spot) => [spot.conditionId, spot]));

  // ==========================================================================
  // Object ids
  // ==========================================================================

  const DOORWAY_CITY_OBJECT_ID = ObjectIdentifiers.DOORWAY_17; // 23052 city -> station
  const DOORWAY_TUNNEL_GOBLIN_OBJECT_ID = ObjectIdentifiers.DOORWAY_18; // 23285
  const DOORWAY_TUNNEL_DWARF_OBJECT_ID = ObjectIdentifiers.DOORWAY_19; // 23286
  const DOORWAY_TUNNEL_FAR_OBJECT_ID = ObjectIdentifiers.DOORWAY_20; // 23287
  const SAMPLE_TABLE_OBJECT_IDS = new Set([
    ObjectIdentifiers.SAMPLE_TABLE, // 23526
    ObjectIdentifiers.SAMPLE_TABLE_2, // 23527
  ]);
  const TIED_ZANIK_OBJECT_ID = ObjectIdentifiers.COL_FFFF00_ZANIK_COL; // 23284
  const LADDER_TO_RAILWAY_OBJECT_ID = ObjectIdentifiers.LADDER_306; // 23376
  const LADDER_TO_CAVES_OBJECT_ID = ObjectIdentifiers.LADDER_307; // 23377
  const LADDER_TOWER_UP_OBJECT_ID = ObjectIdentifiers.LADDER_309; // 23531
  const LADDER_TOWER_DOWN_OBJECT_ID = ObjectIdentifiers.LADDER_310; // 23532
  const LADDER_TRAIN_OBJECT_ID = ObjectIdentifiers.LADDER_308; // 23504
  const HIDING_CRATE_OBJECT_ID = ObjectIdentifiers.CRATE_204; // 23283, slice_stealth_crate_stacked

  // ==========================================================================
  // Tiles
  // ==========================================================================

  const STATION_LANDING = new Location(2513, 5556, 0);
  const STATION_BOTTOM = new Location(2512, 5533, 0);
  const CITY_LANDING = new Location(2696, 5277, 1);
  const VILLAGE_LANDING = new Location(2955, 3507, 0);
  const INSTANCE_LANDING = new Location(2445, 5425, 0);
  const TOWER_LANDING = new Location(2443, 5417, 2);
  const TUNNEL_LANDING = new Location(2396, 5553, 0);
  const CAVE_LANDING = new Location(3172, 9569, 0);
  const RAILWAY_LANDING = new Location(2538, 5515, 0);
  const SIGMUND_TILE = { x: 2540, y: 5511 };
  const OLDAK_TILE = { x: 2702, y: 5366 };
  const TOWER_TILES = [
    { x: 2440, y: 5418 },
    { x: 2447, y: 5418 },
  ];
  const GENERAL_TILES = [
    { x: 2443, y: 5424 },
    { x: 2445, y: 5424 },
  ];
  const SERGEANT_TILES = [
    { x: 2395, y: 5554 },
    { x: 2397, y: 5554 },
  ];
  const GUARD_TILES = [
    { x: 2402, y: 5538 },
    { x: 2405, y: 5536 },
    { x: 2412, y: 5536 },
  ];
  // Quest Helper's SLICE_HIDING, guardsPassed and lureHamMember checkpoints.
  const HIDING_TILE = new Location(2407, 5538, 0);
  const PASSED_GUARD_TILE = new Location(2397, 5551, 0);
  const SERGEANT_FIGHT_TILE = new Location(2411, 5536, 0);

  // The crate approach must remain reachable before the patrol passes. Detection
  // starts in the final guard's lure stretch, east of the marked crate.
  const CAVE_HOLE_ZONE = { minX: 3170, maxX: 3173, minY: 9566, maxY: 9570, levels: [0] };
  const GUARD_CORRIDOR_ZONE = { minX: 2410, maxX: 2416, minY: 5524, maxY: 5539, levels: [0] };

  // ==========================================================================
  // Condition step ids (transcript page)
  // ==========================================================================

  const START_REQUIREMENT_CONDITION_ID = "Ws5v82";
  const NO_TROWEL_CONDITION_ID = "kwsK4j";
  const NO_TROWEL_SPACE_CONDITION_ID = "eFC54U";
  const TROWEL_SPACE_CONDITION_ID = "dhKgeo";
  const NO_BRUSH_CONDITION_ID = "f2Mdf8";
  const NO_BRUSH_SPACE_CONDITION_ID = "KeYJKb";
  const BRUSH_SPACE_CONDITION_ID = "5fNq2K";
  const UNCLEAN_NO_BRUSH_CONDITION_ID = "qbL4Lo";
  const UNCLEAN_NO_SPACE_CONDITION_ID = "FVoDCv";
  const UNCLEAN_SPACE_CONDITION_ID = "5mdxLQ";
  const NO_TROWEL_AGAIN_CONDITION_ID = "N8rI8b";
  const NO_BRUSH_AGAIN_CONDITION_ID = "LAyrwg";
  const SIXTH_HAND_IN_CONDITION_IDS = new Set([
    "VUBFDh", "mehvOR", "wIvaR9", "thmn78", "RshbWX", "qizxJZ",
  ]);
  const ANOTHER_ARTEFACT_CONDITION_IDS = new Set([
    "drj_Ct", "EzyaLd", "8XmMFB", "FMhHwW", "MUqdG8", "7Bzulj",
  ]);
  const NO_ARTEFACT_CONDITION_IDS = new Set([
    "n_Z8Dm", "G9kn3b", "SbGs5Q", "C-Ng9o", "ByO6L6", "E3jGqc",
  ]);
  const LOST_MACE_CONDITION_ID = "XUDGNK";
  const NO_COINS_CONDITION_ID = "j-3x-s";
  const HAS_COINS_CONDITION_ID = "F1JORu";

  // ==========================================================================
  // Action / message step ids
  // ==========================================================================

  const OLDAK_SPHERE_ACTION_ID = "swS9lx";
  const OLDAK_TELEPORT_ACTION_ID = "Tp-DHz";
  const OLDAK_RETURN_TELEPORT_ACTION_ID = "Si-z0r";
  const VILLAGE_CUTSCENE_END_ACTION_ID = "0MCjvB";
  const KIDNAP_CUTSCENE_END_ACTION_ID = "oG2C9L";
  const PAY_COINS_ACTION_ID = "iF8XSH";
  const RECEIVE_MACE_ACTION_ID = "DXR-dR";
  const UNTIE_ZANIK_ACTION_ID = "VcaIcO";
  const TRAIN_OPENING_ACTION_ID = "09Lek1";
  const COMPLETE_ACTION_ID = "jiiizC";
  const ANCIENT_MACE_SPECIAL_ID = "ancient_mace";

  // ==========================================================================
  // Quest state helpers
  // ==========================================================================

  let quest;

  /** Transient hand-in choice for the current Tegdak conversation (never persisted). */
  const pendingHandIn = new WeakMap();
  /** Players just placed in the cave landing, so the hole does not re-trigger. */
  const armedCaveReturn = new WeakSet();
  /** Tracked per-player owner-only spawns, keyed by role. */
  const trackedNpcs = new WeakMap();
  const patrolTasks = new WeakMap();

  function stageOf(player) {
    return quest.getStage(player);
  }

  function setStage(player, value) {
    if (quest.getStage(player) !== value) quest.setStage(player, value);
  }

  function hasItem(player, itemId, amount = 1) {
    return player.getInventory().getAmount(itemId) >= amount;
  }

  function addItem(player, itemId) {
    player.getInventory().adds(itemId, 1);
  }

  function hasTrowel(player) {
    return hasItem(player, TROWEL_ITEM_ID);
  }

  function hasBrush(player) {
    return hasItem(player, SPECIMEN_BRUSH_ITEM_ID);
  }

  function heldCleanSpot(player) {
    for (const spot of DIG_SPOTS) if (hasItem(player, spot.clean)) return spot;
    return null;
  }

  function heldDirtySpot(player) {
    for (const spot of DIG_SPOTS) if (hasItem(player, spot.dirty)) return spot;
    return null;
  }

  function dugSpots(player) {
    return Number(player.getAttribute(SPOTS_ATTRIBUTE)) || 0;
  }

  function handedIn(player) {
    return Number(player.getAttribute(HANDED_IN_ATTRIBUTE)) || 0;
  }

  /**
   * Bitmask of the artefacts Tegdak has taken. Saves written before the mask existed only
   * carry the count (the mask loads as its 0 default), so it is recovered as the first N
   * spots; the order is cosmetic there.
   */
  function deliveredSpots(player) {
    const mask = Number(player.getAttribute(DELIVERED_ATTRIBUTE)) || 0;
    if (mask !== 0 || handedIn(player) === 0) return mask;
    const count = Math.min(handedIn(player), DIG_SPOTS.length);
    let legacy = 0;
    for (let index = 0; index < count; index++) legacy |= DIG_SPOTS[index].bit;
    return legacy;
  }

  function snipersDead(player) {
    return Number(player.getAttribute(SNIPERS_ATTRIBUTE)) || 0;
  }

  function escortOf(player) {
    return Number(player.getAttribute(ESCORT_ATTRIBUTE)) || 0;
  }

  function hasAncientMace(player) {
    if (hasItem(player, ANCIENT_MACE_ITEM_ID)) return true;
    return equippedAncientMace(player);
  }

  function equippedAncientMace(player) {
    const weapon = player.getEquipment()?.get?.(Equipment.WEAPON_SLOT);
    return weapon?.getId?.() === ANCIENT_MACE_ITEM_ID;
  }

  /** Favour of the War God: the ancient mace must have launched its special at Sigmund. */
  function isAncientMaceSpecial(hit) {
    const method = hit?.getCombatMethod?.();
    const maceMethod = api.core.CombatSpecial?.getById?.(ANCIENT_MACE_SPECIAL_ID)?.getCombatMethod?.() ?? null;
    // The armed flag clears as soon as the swing has queued its hit (Combat.executeAttack);
    // the launched special is what the hit retains, so it identifies the mace's special.
    if (!method || !maceMethod) return false;
    return method === maceMethod;
  }

  function specialUsed(player) {
    return player.getAttribute(SPECIAL_ATTRIBUTE) === true;
  }

  function sigmundExposed(player) {
    return player.getAttribute(SIGMUND_EXPOSED_ATTRIBUTE) === true;
  }

  /**
   * The railway showdown: stage 9 once the descent exposed Sigmund, then stage 10 after the
   * mace special. A stage-9 player who has been exposed is past the tunnel and goes straight
   * back to the railway.
   */
  function inShowdown(player) {
    const stage = stageOf(player);
    return stage === STAGE_RAILWAY || (stage === STAGE_TUNNEL && sigmundExposed(player));
  }

  function zanikUntied(player) {
    return player.getAttribute(ZANIK_UNTIED_ATTRIBUTE) === true;
  }

  function trainOpen(player) {
    return player.getAttribute(TRAIN_OPEN_ATTRIBUTE) === true;
  }

  function trainAgreed(player) {
    // Saves made before the agreement attribute existed are already past the
    // start dialogue, so their stage is the durable half of the same fact.
    return player.getAttribute(TRAIN_AGREEMENT_ATTRIBUTE) === true || stageOf(player) >= STAGE_STARTED;
  }

  /** A blocked hit must read as a zero hitsplat, including multi-hit specials. */
  function zeroHit(hit) {
    if (!hit) return;
    if (typeof hit.setTotalDamage === "function") {
      hit.setTotalDamage(0);
      return;
    }
    for (const part of hit.getHits?.() ?? []) part.setDamage?.(0);
    hit.updateTotalDamage?.();
  }

  const lastProtectionLine = new WeakMap();
  const prayerBlockedNotified = new WeakSet();
  const maceHinted = new WeakSet();

  /** Sigmund calls on Saradomin for each attack style until the mace special lands. */
  function showProtectionLine(player, combatType) {
    const { CombatType } = api.core;
    const style = combatType === CombatType.MAGIC ? "magic"
      : combatType === CombatType.RANGED ? "ranged" : "melee";
    if (lastProtectionLine.get(player) === style) return;
    lastProtectionLine.set(player, style);
    startTranscript(api, player, SIGMUND_NPC_ID, PAGE,
      `climbing-down-to-the-railway-if-sigmund-is-attacked-with-${style}`);
  }

  function questComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  /** The wiki Quick guide requirements: 15 Attack, 25 Prayer and three quests. */
  function meetsRequirements(player) {
    const skills = player.getSkillManager();
    return (
      skills.getMaxLevel(Skill.ATTACK) >= 15 &&
      skills.getMaxLevel(Skill.PRAYER) >= 25 &&
      questComplete(player, "death_to_the_dorgeshuun") &&
      questComplete(player, "giant_dwarf") &&
      questComplete(player, "the_dig_site")
    );
  }

  function setZanikAtDig(player, value) {
    player.setAttribute(ZANIK_AT_DIG_ATTRIBUTE, value === true);
    player.getPacketSender().sendVarbit(VARBIT_ZANIK_AT_DIG, value ? 1 : 0);
  }

  function markMaceReceived(player) {
    player.setAttribute(MACE_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(VARBIT_RECEIVED_MACE, 1);
  }

  function giveAncientMace(player) {
    if (!hasAncientMace(player)) {
      if (player.getInventory().isFull()) {
        player.sendMessage("You need free inventory space for the ancient mace.");
        return false;
      }
      addItem(player, ANCIENT_MACE_ITEM_ID);
      if (!hasAncientMace(player)) return false;
    }
    markMaceReceived(player);
    return true;
  }

  function reclaimMace(player) {
    if (stageOf(player) < STAGE_KIDNAPPED || hasAncientMace(player)) return;
    const inventory = player.getInventory();
    const coins = inventory.getAmount(COINS_ITEM_ID);
    if (coins < 1000) return;
    if (inventory.isFull() && coins !== 1000) {
      player.sendMessage("You need free inventory space for the ancient mace.");
      return;
    }
    // Keep payment and delivery together: the following transcript action can be interrupted.
    inventory.deleteNumber(COINS_ITEM_ID, 1000);
    if (!giveAncientMace(player)) inventory.adds(COINS_ITEM_ID, 1000);
  }

  /** Re-sends every quest varbit that login scripts can clobber. */
  function syncQuestVarbits(player) {
    const sender = player.getPacketSender();
    const spots = dugSpots(player);
    const delivered = deliveredSpots(player);
    for (let index = 0; index < ARTIFACT_VARBITS.length; index++) {
      // slice_artifact_N: 0 undug, 1 dug, 2 handed to Tegdak (Quest Helper reads 2).
      const value = (delivered >> index) & 1 ? 2 : (spots >> index) & 1 ? 1 : 0;
      sender.sendVarbit(ARTIFACT_VARBITS[index], value);
    }
    sender.sendVarbit(VARBIT_ZANIK_AT_DIG, player.getAttribute(ZANIK_AT_DIG_ATTRIBUTE) === true ? 1 : 0);
    sender.sendVarbit(VARBIT_RECEIVED_MACE, player.getAttribute(MACE_ATTRIBUTE) === true ? 1 : 0);
    sender.sendVarbit(VARBIT_HIDING, player.getAttribute(HIDING_ATTRIBUTE) === true ? 1 : 0);
  }

  // ==========================================================================
  // Tracked per-player spawns
  // ==========================================================================

  function tracked(player) {
    let map = trackedNpcs.get(player);
    if (!map) {
      map = new Map();
      trackedNpcs.set(player, map);
    }
    return map;
  }

  function spawnTracked(player, key, definition) {
    const existing = tracked(player).get(key);
    if (existing && existing.isRegistered() !== false) return existing;
    const npc = api.spawnNpc({ ...definition, owner: player, ownerOnly: true });
    if (npc) tracked(player).set(key, npc);
    return npc;
  }

  function despawnTracked(player, key) {
    const npc = tracked(player).get(key);
    if (npc) {
      api.removeNpc(npc);
      tracked(player).delete(key);
    }
  }

  function forgetTracked(player, key) {
    tracked(player).delete(key);
  }

  function spawnSnipers(player) {
    if (snipersDead(player) & 1) despawnTracked(player, "archer");
    else spawnTracked(player, "archer", { id: HAM_ARCHER_NPC_ID, ...TOWER_TILES[0], z: 2, wanderRadius: 0 });
    if (snipersDead(player) & 2) despawnTracked(player, "mage");
    else spawnTracked(player, "mage", { id: HAM_MAGE_NPC_ID, ...TOWER_TILES[1], z: 2, wanderRadius: 0 });
  }

  function returnToAmbush(player) {
    player.moveTo(INSTANCE_LANDING);
    spawnSnipers(player);
    player.sendMessage("Kill the two H.A.M. members on the tower.");
  }

  function spawnInstanceGenerals(player) {
    spawnTracked(player, "wartface", { id: NpcIdentifiers.GENERAL_WARTFACE, ...GENERAL_TILES[0], z: 0, wanderRadius: 0 });
    spawnTracked(player, "bentnoze", { id: NpcIdentifiers.GENERAL_BENTNOZE, ...GENERAL_TILES[1], z: 0, wanderRadius: 0 });
  }

  function clearInstance(player) {
    for (const key of ["archer", "mage", "wartface", "bentnoze"]) despawnTracked(player, key);
  }

  function spawnTunnelNpcs(player) {
    spawnTracked(player, "mossfists", { id: NpcIdentifiers.SERGEANT_MOSSFISTS, ...SERGEANT_TILES[0], z: 0, wanderRadius: 0 });
    spawnTracked(player, "slimetoes", { id: NpcIdentifiers.SERGEANT_SLIMETOES, ...SERGEANT_TILES[1], z: 0, wanderRadius: 0 });
    const passed = player.getAttribute(PATROL_PASSED_ATTRIBUTE) === true;
    const firstGuard = spawnTracked(player, "guard-1", { id: GUARD_NPC_ID, ...GUARD_TILES[0], z: 0, wanderRadius: 0 });
    if (passed) firstGuard?.moveTo(PASSED_GUARD_TILE);
    spawnTracked(player, "guard-2", { id: GUARD_NPC_ID, ...GUARD_TILES[1], z: 0, wanderRadius: 0 });
    if (player.getAttribute(GUARD_DEFEATED_ATTRIBUTE) !== true) {
      spawnTracked(player, "guard-3", { id: GUARD_NPC_ID, ...GUARD_TILES[2], z: 0, wanderRadius: 0 });
    }
    if (player.getAttribute(ESCORT_ATTRIBUTE) === undefined) player.setAttribute(ESCORT_ATTRIBUTE, 2);
    if (player.getAttribute(GUARDS_ENGAGED_ATTRIBUTE) === true) engageGuard(player);
    else followSergeants(player);
  }

  function clearTunnel(player) {
    patrolTasks.get(player)?.stop();
    patrolTasks.delete(player);
    for (const key of ["mossfists", "slimetoes", "guard-1", "guard-2", "guard-3"]) despawnTracked(player, key);
  }

  function followSergeants(player) {
    if (player.getAttribute(GUARDS_ENGAGED_ATTRIBUTE) === true) return;
    const escort = escortOf(player);
    tracked(player).get("mossfists")?.setFollowing?.(escort === 2 ? player : null);
    tracked(player).get("slimetoes")?.setFollowing?.(escort > 0 ? player : null);
  }

  function engageGuard(player) {
    if (player.getAttribute(GUARD_DEFEATED_ATTRIBUTE) === true) return;
    const guard = tracked(player).get("guard-3");
    const sergeant = tracked(player).get(escortOf(player) === 2 ? "mossfists" : "slimetoes");
    if (!guard || !sergeant) return;
    sergeant.moveTo(SERGEANT_FIGHT_TILE);
    sergeant.setMultiCombat(true);
    guard.setMultiCombat(true);
    sergeant.getCombat().attack(guard);
    guard.getCombat().attack(sergeant);
    player.setAttribute(GUARDS_ENGAGED_ATTRIBUTE, true);
  }

  function hideBehindCrate(player) {
    if (stageOf(player) !== STAGE_TUNNEL) return;
    player.moveTo(HIDING_TILE);
    player.setAttribute(HIDING_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(VARBIT_HIDING, 1);
    if (player.getAttribute(PATROL_PASSED_ATTRIBUTE) === true || patrolTasks.has(player)) return;
    const { CountdownTask, TaskManager } = api.core;
    // shortcut: this patrol checkpoint takes two ticks; calibrate its traversal from a live capture.
    const task = new CountdownTask(player, 2, () => {
      if (patrolTasks.get(player) !== task) return;
      patrolTasks.delete(player);
      if (!player.isRegistered() || stageOf(player) !== STAGE_TUNNEL ||
          player.getAttribute(HIDING_ATTRIBUTE) !== true || !player.getLocation().equals(HIDING_TILE)) return;
      tracked(player).get("guard-1")?.moveTo(PASSED_GUARD_TILE);
      player.setAttribute(PATROL_PASSED_ATTRIBUTE, true);
    });
    patrolTasks.set(player, task);
    TaskManager.submit(task);
  }

  function caughtInTunnel(player, variant) {
    clearTunnel(player);
    for (const key of [HIDING_ATTRIBUTE, PATROL_PASSED_ATTRIBUTE, GUARDS_ENGAGED_ATTRIBUTE, GUARD_DEFEATED_ATTRIBUTE]) {
      player.setAttribute(key, false);
    }
    player.setAttribute(ESCORT_ATTRIBUTE, 2);
    player.setAttribute(SEPARATED_ATTRIBUTE, false);
    player.getPacketSender().sendVarbit(VARBIT_HIDING, 0);
    startTranscript(api, player, GUARD_NPC_ID, PAGE, variant);
    player.moveTo(CAVE_LANDING);
    armedCaveReturn.add(player);
  }

  function spawnSigmund(player) {
    spawnTracked(player, "sigmund", { id: SIGMUND_NPC_ID, ...SIGMUND_TILE, z: 0, wanderRadius: 0 });
  }

  function spawnOldak(player) {
    spawnTracked(player, "oldak", { id: OLDAK_NPC_ID, ...OLDAK_TILE, z: 0, wanderRadius: 0 });
  }

  // ==========================================================================
  // Talk-to handlers
  // ==========================================================================

  function talkUrTag(event) {
    const { player, npcId } = event;
    if (!UR_TAG_NPC_IDS.has(npcId)) return false;
    const stage = stageOf(player);
    if (stage === 0) {
      // Ur-tag is shared with the earlier Dorgeshuun quests; only claim him once
      // this quest can actually be started.
      if (!meetsRequirements(player)) return false;
      startTranscript(api, player, npcId, PAGE, "starting-off-talking-to-ur-tag-or-ambassador-alivjar");
      return;
    }
    if (stage < STAGE_ARTEFACTS) {
      startTranscript(api, player, npcId, PAGE, "starting-off-talking-to-ambassador-alvijar-talking-to-ur-tag-after-starting-the-quest");
      return;
    }
    startTranscript(api, player, npcId, PAGE, "the-goblin-scribe-talking-to-ur-tag");
  }

  function talkAlvijar(event) {
    const { player, npcId } = event;
    if (npcId !== AMBASSADOR_ALVIJAR_NPC_ID) return false;
    const stage = stageOf(player);
    if (stage === 0) {
      if (!meetsRequirements(player)) return false;
      startTranscript(api, player, npcId, PAGE, "starting-off-talking-to-ur-tag-or-ambassador-alivjar");
      return;
    }
    if (stage < STAGE_ARTEFACTS) {
      startTranscript(api, player, npcId, PAGE, "starting-off-talking-to-ambassador-alvijar-talking-to-ambassador-alvijar-after-starting-the-quest");
      return;
    }
    if (stage >= STAGE_KIDNAPPED && stage < STAGE_COMPLETE) {
      startTranscript(api, player, npcId, PAGE, "upon-defeating-the-two-h-a-m-members-talking-to-ambassador-alvijar");
      return;
    }
    startTranscript(api, player, npcId, PAGE, "the-goblin-scribe-talking-to-ambassador-alvijar");
  }

  function talkTegdak(event) {
    const { player, npcId } = event;
    if (npcId !== TEGDAK_NPC_ID) return false;
    const stage = stageOf(player);
    if (stage === 0) return false; // Transcript:Tegdak's own standard dialogue
    if (stage === STAGE_STARTED) {
      startTranscript(api, player, npcId, PAGE, "the-archaeological-dig-talking-to-tegdak");
      return;
    }
    if (stage === STAGE_DIGGING) {
      const clean = heldCleanSpot(player);
      if (clean) {
        pendingHandIn.set(player, clean);
        startTranscript(api, player, npcId, PAGE, "the-archaeological-dig-talking-to-tegdak-with-an-artefact");
        return;
      }
      pendingHandIn.delete(player);
      if (heldDirtySpot(player)) {
        startTranscript(api, player, npcId, PAGE, "the-archaeological-dig-talking-to-tegdak-with-an-unclean-artefact");
        return;
      }
      startTranscript(api, player, npcId, PAGE, handedIn(player) > 0
        ? "the-archaeological-dig-talking-to-tegdak-with-an-artefact-talking-to-tegdak-without-any-artefacts-and-delivering-at-least-one"
        : "the-archaeological-dig-talking-to-tegdak-talking-to-tegdak-without-any-artefacts-and-not-delivering-any-before");
      return;
    }
    if (stage === STAGE_ARTEFACTS) {
      startTranscript(api, player, npcId, PAGE, "the-archaeological-dig-talking-to-tegdak-after-handing-in-all-six-artefacts");
      return;
    }
    startTranscript(api, player, npcId, PAGE, "the-goblin-scribe-talking-to-tegdak");
  }

  function talkZanik(event) {
    const { player, npcId } = event;
    if (npcId !== ZANIK_SLICE_NPC_ID) return false;
    const stage = stageOf(player);
    if (stage === STAGE_ARTEFACTS) {
      startTranscript(api, player, npcId, PAGE, "the-goblin-scribe-talking-to-zanik");
      return;
    }
    if (stage >= STAGE_SCRIBE && stage < STAGE_VILLAGE) {
      startTranscript(api, player, npcId, PAGE, "the-goblin-scribe-talking-to-zanik-2");
      return;
    }
    return false;
  }

  function talkScribe(event) {
    const { player, npcId } = event;
    if (npcId !== GOBLIN_SCRIBE_NPC_ID) return false;
    const stage = stageOf(player);
    if (stage === STAGE_ARTEFACTS) {
      startTranscript(api, player, npcId, PAGE, "the-goblin-scribe-talking-to-the-goblin-scribe-with-zanik");
      return;
    }
    if (stage === STAGE_SCRIBE) {
      startTranscript(api, player, npcId, PAGE, "the-goblin-scribe-talking-to-the-goblin-scribe-with-zanik-talking-to-the-goblin-scribe-again");
      return;
    }
    return false;
  }

  function talkOldak(event) {
    const { player, npcId } = event;
    if (npcId !== OLDAK_NPC_ID) return false;
    const stage = stageOf(player);
    if (stage === STAGE_SCRIBE) {
      startTranscript(api, player, npcId, PAGE, "talking-to-oldak");
      return;
    }
    if (stage >= STAGE_VILLAGE && stage <= STAGE_SNIPERS_DEAD) {
      startTranscript(api, player, npcId, PAGE, "talking-to-oldak-returning-to-oldak-again");
      return;
    }
    return false;
  }

  function talkBuilder(event) {
    const { player, npcId } = event;
    if (!BUILDER_NPC_IDS.has(npcId)) return false;
    startTranscript(api, player, npcId, PAGE, "the-archaeological-dig-the-builders");
  }

  function talkGeneral(event) {
    const { player, npcId } = event;
    if (!GENERAL_NPC_IDS.has(npcId)) return false;
    const stage = stageOf(player);
    if (stage === STAGE_VILLAGE) {
      player.moveTo(INSTANCE_LANDING);
      startTranscript(api, player, npcId, PAGE, "the-goblin-generals");
      return;
    }
    if (stage === STAGE_AMBUSH) {
      // The cutscene has played; a player who died or left the tower goes back to it.
      returnToAmbush(player);
      return;
    }
    if (stage === STAGE_SNIPERS_DEAD) {
      startTranscript(api, player, npcId, PAGE, "upon-defeating-the-two-h-a-m-members");
      return;
    }
    if (stage >= STAGE_KIDNAPPED) {
      startTranscript(api, player, npcId, PAGE, "upon-defeating-the-two-h-a-m-members-talking-to-the-generals");
      return;
    }
    return false;
  }

  function talkSergeant(event) {
    const { player, npcId } = event;
    if (!SERGEANT_NPC_IDS.has(npcId)) return false;
    const stage = stageOf(player);
    if (stage === STAGE_KIDNAPPED) {
      startTranscript(api, player, npcId, PAGE, "talking-to-the-sergeants-in-the-lumbridge-swamp");
      return;
    }
    if (stage !== STAGE_TUNNEL) return false;
    const location = player.getLocation();
    if (location.getY() >= 9000) {
      startTranscript(api, player, npcId, PAGE, "talking-to-the-sergeants-in-the-lumbridge-swamp-talking-to-the-sergeants-in-the-lumbridge-swamp-caves");
      return;
    }
    if (location.getX() < 2600 && location.getY() < 6000) {
      if (player.getAttribute(GUARDS_ENGAGED_ATTRIBUTE) === true) {
        startTranscript(api, player, npcId, PAGE, "the-distraction-talking-to-either-of-the-sergeants-while-they-are-fighting-the-guards");
        return;
      }
      startTranscript(api, player, npcId, PAGE, player.getAttribute(SEPARATED_ATTRIBUTE) === true
        ? "the-under-underground-coordinating-with-the-sergeants-with-one-sergeant"
        : "the-under-underground-coordinating-with-the-sergeants-with-both-sergeants");
      return;
    }
    startTranscript(api, player, npcId, PAGE, "talking-to-the-sergeants-in-the-lumbridge-swamp-talking-to-the-sergeants-on-the-surface-after-talking-to-them-in-the-cave");
  }

  function talkSigmund(event) {
    const { player, npcId } = event;
    if (npcId !== SIGMUND_NPC_ID) return false;
    const stage = stageOf(player);
    if (stage !== STAGE_TUNNEL && stage !== STAGE_RAILWAY) return false;
    if (!sigmundExposed(player)) {
      // The railway descent cutscene is the canonical exposure; replay it if a
      // client/relog dropped the player into the fight without it.
      player.setAttribute(SIGMUND_EXPOSED_ATTRIBUTE, true);
      startTranscript(api, player, npcId, PAGE, "climbing-down-to-the-railway");
      return true;
    }
    if (!specialUsed(player)) {
      player.sendMessage("Sigmund is protected by Saradomin. Use the ancient mace's special attack to break his prayer.");
      return true;
    }
    player.sendMessage("Sigmund is beaten. Untie Zanik before the train arrives.");
    return true;
  }

  function talkHamMember(event) {
    const { player, npcId } = event;
    if (npcId !== HAM_ARCHER_NPC_ID && npcId !== HAM_MAGE_NPC_ID) return false;
    const stage = stageOf(player);
    if (stage !== STAGE_AMBUSH && stage !== STAGE_SNIPERS_DEAD) return false;
    player.sendMessage("The H.A.M. member is too busy fighting the goblins to talk.");
    return true;
  }

  // ==========================================================================
  // NPC dialogue conditions
  // ==========================================================================

  function answerCondition(event) {
    const { player, npcId, stepId } = event;
    switch (stepId) {
      case START_REQUIREMENT_CONDITION_ID:
        if (!UR_TAG_NPC_IDS.has(npcId) && npcId !== AMBASSADOR_ALVIJAR_NPC_ID) return null;
        return !meetsRequirements(player);
      case NO_TROWEL_CONDITION_ID:
      case NO_TROWEL_AGAIN_CONDITION_ID:
        return npcId === TEGDAK_NPC_ID ? !hasTrowel(player) : null;
      case NO_BRUSH_CONDITION_ID:
      case NO_BRUSH_AGAIN_CONDITION_ID:
      case UNCLEAN_NO_BRUSH_CONDITION_ID:
        return npcId === TEGDAK_NPC_ID ? !hasBrush(player) : null;
      case NO_TROWEL_SPACE_CONDITION_ID:
      case NO_BRUSH_SPACE_CONDITION_ID:
      case UNCLEAN_NO_SPACE_CONDITION_ID:
        return npcId === TEGDAK_NPC_ID ? player.getInventory().isFull() : null;
      case TROWEL_SPACE_CONDITION_ID:
      case BRUSH_SPACE_CONDITION_ID:
      case UNCLEAN_SPACE_CONDITION_ID:
        return npcId === TEGDAK_NPC_ID ? !player.getInventory().isFull() : null;
      case LOST_MACE_CONDITION_ID:
        return GENERAL_NPC_IDS.has(npcId) ? !hasAncientMace(player) : null;
      case NO_COINS_CONDITION_ID:
        return GENERAL_NPC_IDS.has(npcId) ? !hasItem(player, COINS_ITEM_ID, 1000) : null;
      case HAS_COINS_CONDITION_ID:
        return GENERAL_NPC_IDS.has(npcId) ? hasItem(player, COINS_ITEM_ID, 1000) : null;
      default:
        break;
    }
    if (npcId !== TEGDAK_NPC_ID) return null;
    if (SIXTH_HAND_IN_CONDITION_IDS.has(stepId)) return handedIn(player) >= DIG_SPOTS.length;
    if (ANOTHER_ARTEFACT_CONDITION_IDS.has(stepId)) return false;
    if (NO_ARTEFACT_CONDITION_IDS.has(stepId)) return true;
    const spot = DIG_SPOT_BY_HAND_IN.get(stepId);
    if (spot) return pendingHandIn.get(player)?.conditionId === stepId;
    return null;
  }

  /** Grants and item hand-ins that the transcript branch alone cannot state. */
  function handleConditionChosen(event) {
    const { player, npcId, stepId } = event;
    if (npcId !== TEGDAK_NPC_ID || stageOf(player) !== STAGE_DIGGING) return;
    switch (stepId) {
      case TROWEL_SPACE_CONDITION_ID:
        if (!hasTrowel(player)) addItem(player, TROWEL_ITEM_ID);
        return;
      case BRUSH_SPACE_CONDITION_ID:
      case UNCLEAN_SPACE_CONDITION_ID:
        if (!hasBrush(player)) addItem(player, SPECIMEN_BRUSH_ITEM_ID);
        return;
      default:
        break;
    }
    if (SIXTH_HAND_IN_CONDITION_IDS.has(stepId)) {
      if (handedIn(player) < DIG_SPOTS.length) return;
      setZanikAtDig(player, true);
      setStage(player, STAGE_ARTEFACTS);
      return;
    }
    const spot = DIG_SPOT_BY_HAND_IN.get(stepId);
    if (spot && pendingHandIn.get(player)?.conditionId === stepId) {
      pendingHandIn.delete(player);
      if (hasItem(player, spot.clean)) {
        const delivered = deliveredSpots(player);
        const count = handedIn(player);
        player.getInventory().deleteNumber(spot.clean, 1);
        player.setAttribute(HANDED_IN_ATTRIBUTE, count + 1);
        player.setAttribute(DELIVERED_ATTRIBUTE, delivered | spot.bit);
        player.getPacketSender().sendVarbit(spot.varbit, 2);
      }
    }
  }

  // ==========================================================================
  // Transcript action / line hooks
  // ==========================================================================

  function handleStartHook(event) {
    const { player, npcId, hook } = event;
    if (hook !== START_HOOK) return;
    if (!UR_TAG_NPC_IDS.has(npcId) && npcId !== AMBASSADOR_ALVIJAR_NPC_ID) return;
    if (!meetsRequirements(player)) return;
    if (stageOf(player) === 0) {
      setStage(player, STAGE_STARTED);
      // Objective 1: the start conversation is the train agreement; the line
      // itself is only declared open in the completion transcript.
      player.setAttribute(TRAIN_AGREEMENT_ATTRIBUTE, true);
      player.setAttribute(SIGMUND_EXPOSED_ATTRIBUTE, false);
      player.setAttribute(ZANIK_UNTIED_ATTRIBUTE, false);
      player.setAttribute(TRAIN_OPEN_ATTRIBUTE, false);
    }
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    switch (stepId) {
      case OLDAK_SPHERE_ACTION_ID:
        if (npcId !== OLDAK_NPC_ID || stageOf(player) !== STAGE_SCRIBE) return;
        if (!hasItem(player, GOBLIN_VILLAGE_SPHERE_ITEM_ID)) addItem(player, GOBLIN_VILLAGE_SPHERE_ITEM_ID);
        return;
      case OLDAK_TELEPORT_ACTION_ID:
        if (npcId !== OLDAK_NPC_ID || stageOf(player) !== STAGE_SCRIBE) return;
        if (hasItem(player, GOBLIN_VILLAGE_SPHERE_ITEM_ID)) player.getInventory().deleteNumber(GOBLIN_VILLAGE_SPHERE_ITEM_ID, 1);
        setZanikAtDig(player, false);
        player.moveTo(VILLAGE_LANDING);
        setStage(player, STAGE_VILLAGE);
        return;
      case OLDAK_RETURN_TELEPORT_ACTION_ID:
        if (npcId !== OLDAK_NPC_ID || stageOf(player) < STAGE_VILLAGE || stageOf(player) >= STAGE_KIDNAPPED) return;
        player.moveTo(VILLAGE_LANDING);
        return;
      case VILLAGE_CUTSCENE_END_ACTION_ID:
        if (!GENERAL_NPC_IDS.has(npcId) || stageOf(player) !== STAGE_VILLAGE) return;
        setStage(player, STAGE_AMBUSH);
        spawnSnipers(player);
        player.sendMessage("Kill the two H.A.M. members on the tower.");
        return;
      case KIDNAP_CUTSCENE_END_ACTION_ID:
        if (!GENERAL_NPC_IDS.has(npcId) || stageOf(player) !== STAGE_SNIPERS_DEAD) return;
        if (!giveAncientMace(player)) return;
        setStage(player, STAGE_KIDNAPPED);
        clearInstance(player);
        player.moveTo(VILLAGE_LANDING);
        player.sendMessage("The generals sent two sergeants to the Lumbridge Swamp Caves.");
        return;
      case PAY_COINS_ACTION_ID:
        if (!GENERAL_NPC_IDS.has(npcId) || stageOf(player) < STAGE_KIDNAPPED || stageOf(player) >= STAGE_COMPLETE) return;
        reclaimMace(player);
        return;
      case RECEIVE_MACE_ACTION_ID:
        if (!GENERAL_NPC_IDS.has(npcId) || stageOf(player) < STAGE_KIDNAPPED || stageOf(player) >= STAGE_COMPLETE) return;
        // PAY_COINS_ACTION_ID already delivered it atomically; replaying this is not a free reclaim.
        return;
      case UNTIE_ZANIK_ACTION_ID:
        if (npcId !== SIGMUND_NPC_ID || stageOf(player) !== STAGE_RAILWAY) return;
        if (!sigmundExposed(player) || !specialUsed(player)) {
          event.handled = true;
          player.sendMessage("Sigmund still holds Zanik. Defeat him first.");
          return;
        }
        player.setAttribute(ZANIK_UNTIED_ATTRIBUTE, true);
        return;
      case TRAIN_OPENING_ACTION_ID:
        if (npcId !== SIGMUND_NPC_ID || stageOf(player) !== STAGE_RAILWAY) return;
        if (!zanikUntied(player)) return;
        player.setAttribute(TRAIN_OPEN_ATTRIBUTE, true);
        return;
      case COMPLETE_ACTION_ID:
        if (npcId !== SIGMUND_NPC_ID) return;
        event.handled = true;
        // The three objectives must be finished in order: the train agreement
        // started the quest, then Sigmund was exposed and beaten only after the
        // ancient mace special stripped his prayer. Zanik must be untied and the
        // line declared open before the scroll can fire.
        if (stageOf(player) !== STAGE_RAILWAY || !trainAgreed(player) || !sigmundExposed(player) ||
            !specialUsed(player) || !zanikUntied(player) || !trainOpen(player)) {
          player.sendMessage("You still have to defeat Sigmund and untie Zanik before the train arrives.");
          return;
        }
        if (!quest.isComplete(player)) quest.complete(player);
        return;
      default:
        return;
    }
  }

  function handleLine(event) {
    const { player, npcId, text } = event;
    const line = String(text ?? "");
    if (npcId === TEGDAK_NPC_ID && line.startsWith("Here, take this trowel")) {
      if (stageOf(player) !== STAGE_STARTED) return;
      if (!hasTrowel(player)) addItem(player, TROWEL_ITEM_ID);
      if (!hasBrush(player)) addItem(player, SPECIMEN_BRUSH_ITEM_ID);
      setStage(player, STAGE_DIGGING);
      return;
    }
    if (npcId === GOBLIN_SCRIBE_NPC_ID && line.startsWith("I'd rather not travel")) {
      if (stageOf(player) === STAGE_ARTEFACTS) setStage(player, STAGE_SCRIBE);
      return;
    }
    if (SERGEANT_NPC_IDS.has(npcId) && line.startsWith("Grubfoot say pink robe man")) {
      if (stageOf(player) === STAGE_KIDNAPPED) setStage(player, STAGE_TUNNEL);
    }
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (!SERGEANT_NPC_IDS.has(npcId)) return;
    if (stageOf(player) < STAGE_KIDNAPPED || stageOf(player) > STAGE_TUNNEL) return;
    switch (option) {
      case "Both of you follow me":
        player.setAttribute(ESCORT_ATTRIBUTE, 2);
        player.setAttribute(SEPARATED_ATTRIBUTE, false);
        followSergeants(player);
        return;
      case "One of you wait here":
        player.setAttribute(ESCORT_ATTRIBUTE, 1);
        player.setAttribute(SEPARATED_ATTRIBUTE, true);
        followSergeants(player);
        return;
      case "Both of you wait here":
        player.setAttribute(ESCORT_ATTRIBUTE, 0);
        player.setAttribute(SEPARATED_ATTRIBUTE, true);
        followSergeants(player);
        return;
      case "Wait here":
        player.setAttribute(ESCORT_ATTRIBUTE, 0);
        followSergeants(player);
        return;
      case "Follow me":
        player.setAttribute(ESCORT_ATTRIBUTE, 1);
        followSergeants(player);
        return;
      default:
        return;
    }
  }

  // ==========================================================================
  // Digging, cleaning, hand-in items
  // ==========================================================================

  function digSpot(player, spot) {
    if (stageOf(player) !== STAGE_DIGGING) return;
    if (dugSpots(player) & spot.bit) {
      player.sendMessage("There is nothing more to dig here.");
      return;
    }
    if (player.getInventory().isFull()) {
      player.sendMessage("You need more inventory space to store the artefact.");
      return;
    }
    player.setAttribute(SPOTS_ATTRIBUTE, dugSpots(player) | spot.bit);
    player.getPacketSender().sendVarbit(spot.varbit, 1);
    addItem(player, spot.dirty);
    startTranscript(api, player, TEGDAK_NPC_ID, PAGE, "the-archaeological-dig-digging-up-an-artefact");
  }

  function cleanArtefact(player, spot) {
    if (stageOf(player) < STAGE_DIGGING) return;
    if (!hasBrush(player)) {
      startTranscript(api, player, TEGDAK_NPC_ID, PAGE, "the-archaeological-dig-attempting-to-clean-an-artefact-without-a-brush");
      return;
    }
    if (!hasItem(player, spot.dirty)) return;
    player.getInventory().deleteNumber(spot.dirty, 1);
    addItem(player, spot.clean);
    startTranscript(api, player, TEGDAK_NPC_ID, PAGE, "the-archaeological-dig-cleaning-an-artefact-on-the-specimen-table");
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (itemId === TROWEL_ITEM_ID) {
      const spot = DIG_SPOT_BY_OBJECT.get(objectId);
      if (!spot) return;
      event.handled = true;
      digSpot(player, spot);
      return;
    }
    if (!SAMPLE_TABLE_OBJECT_IDS.has(objectId)) return;
    const spot = DIG_SPOT_BY_DIRTY.get(itemId);
    if (!spot) return;
    event.handled = true;
    cleanArtefact(player, spot);
  }

  function handleItemOnNpc(event) {
    const { player, npcId, itemId } = event;
    if (npcId !== TEGDAK_NPC_ID || stageOf(player) !== STAGE_DIGGING) return;
    if (
      itemId === TROWEL_ITEM_ID ||
      itemId === SPECIMEN_BRUSH_ITEM_ID ||
      DIG_SPOT_BY_DIRTY.has(itemId) ||
      DIG_SPOT_BY_CLEAN.has(itemId)
    ) {
      return;
    }
    event.handled = true;
    startTranscript(api, player, npcId, PAGE, "the-archaeological-dig-using-an-item-that-isn-t-an-artefact-on-tegdak");
  }

  function handleItemDropPolicy(event) {
    const spot = DIG_SPOT_BY_DIRTY.get(event.itemId) ?? DIG_SPOT_BY_CLEAN.get(event.itemId);
    if (!spot) return;
    const { player } = event;
    if (stageOf(player) !== STAGE_DIGGING) return;
    event.handled = true;
    event.dropToGround = false;
    if (hasItem(player, event.itemId)) player.getInventory().deleteNumber(event.itemId, 1);
    player.setAttribute(SPOTS_ATTRIBUTE, dugSpots(player) & ~spot.bit);
    player.getPacketSender().sendVarbit(spot.varbit, 0);
    startTranscript(api, player, TEGDAK_NPC_ID, PAGE, "the-archaeological-dig-dropping-an-artefact");
  }

  /** Route item: breaking the sphere is the quest's Goblin Village teleport. */
  function breakRouteSphere(event) {
    const { player } = event;
    if (stageOf(player) !== STAGE_SCRIBE) return false;
    if (!hasItem(player, GOBLIN_VILLAGE_SPHERE_ITEM_ID)) return false;
    player.getInventory().deleteNumber(GOBLIN_VILLAGE_SPHERE_ITEM_ID, 1);
    setZanikAtDig(player, false);
    player.moveTo(VILLAGE_LANDING);
    setStage(player, STAGE_VILLAGE);
    player.sendMessage("The sphere shatters, carrying you and Zanik to the Goblin Village.");
    return true;
  }

  /** Wielding the mace is the natural point to remind the player how it beats Sigmund. */
  function wieldAncientMace(event) {
    const { player } = event;
    if (stageOf(player) < STAGE_KIDNAPPED) return false;
    if ((stageOf(player) === STAGE_RAILWAY || (stageOf(player) === STAGE_TUNNEL && sigmundExposed(player)))
        && !specialUsed(player) && !maceHinted.has(player)) {
      maceHinted.add(player);
      player.sendMessage("The ancient mace's special attack can strip Sigmund's prayer protection.");
    }
    return false; // never swallow the Wield action itself
  }

  // ==========================================================================
  // The Goblin Village fight and the tunnel
  // ==========================================================================

  function handleNpcDeath(event) {
    const npcId = event?.npcId ?? event?.npc?.getId?.();
    const killer = event?.killer;
    if (npcId === GUARD_NPC_ID) {
      const owner = event.npc?.getOwner?.();
      if (!owner || stageOf(owner) !== STAGE_TUNNEL || tracked(owner).get("guard-3") !== event.npc) return;
      if (killer !== tracked(owner).get("mossfists") && killer !== tracked(owner).get("slimetoes")) return;
      owner.setAttribute(GUARD_DEFEATED_ATTRIBUTE, true);
      forgetTracked(owner, "guard-3");
      return;
    }
    const player = killer?.isPlayer?.() ? killer : null;
    if (!player) return;
    if (npcId === HAM_ARCHER_NPC_ID || npcId === HAM_MAGE_NPC_ID) {
      handleSniperDeath(player, npcId);
      return;
    }
    if (npcId === SIGMUND_NPC_ID) handleSigmundDeath(player);
  }

  function handleSniperDeath(player, npcId) {
    if (stageOf(player) !== STAGE_AMBUSH) return;
    const bit = npcId === HAM_ARCHER_NPC_ID ? 1 : 2;
    player.setAttribute(SNIPERS_ATTRIBUTE, snipersDead(player) | bit);
    forgetTracked(player, npcId === HAM_ARCHER_NPC_ID ? "archer" : "mage");
    if (snipersDead(player) === 3) {
      setStage(player, STAGE_SNIPERS_DEAD);
      spawnInstanceGenerals(player);
      player.sendMessage("The H.A.M. members are dead. Talk to the generals.");
    }
  }

  function handleSigmundDeath(player) {
    const stage = stageOf(player);
    if (stage !== STAGE_TUNNEL && stage !== STAGE_RAILWAY) return;
    if (!specialUsed(player)) {
      // A poison/recoil/death that bypassed the hit modifier must not skip the
      // mace objective: put him back and keep the showdown retryable.
      forgetTracked(player, "sigmund");
      spawnSigmund(player);
      player.sendMessage("Sigmund's prayer protects him. Use the ancient mace's special attack.");
      return;
    }
    forgetTracked(player, "sigmund");
    startTranscript(api, player, SIGMUND_NPC_ID, PAGE, "defeating-sigmund");
  }

  function handleSigmundHit(event) {
    const { npc, hit } = event;
    if (!npc || npc.getId?.() !== SIGMUND_NPC_ID) return;
    const attacker = hit?.getAttacker?.();
    if (!attacker?.isPlayer?.()) return;
    const player = attacker.getAsPlayer?.() ?? attacker;
    const stage = stageOf(player);
    if (stage !== STAGE_TUNNEL && stage !== STAGE_RAILWAY) {
      zeroHit(hit);
      return;
    }
    if (!sigmundExposed(player)) {
      zeroHit(hit);
      player.sendMessage("Sigmund is protected by Saradomin. Confront him first.");
      return;
    }
    if (specialUsed(player)) return;
    if (!isAncientMaceSpecial(hit)) {
      zeroHit(hit);
      if (!prayerBlockedNotified.has(player)) {
        prayerBlockedNotified.add(player);
        player.sendMessage("Sigmund's prayer absorbs the blow. Use the ancient mace's special attack.");
      }
      showProtectionLine(player, hit.getCombatType?.());
      return;
    }
    if (hit.isAccurate?.() === false) return;
    player.setAttribute(SPECIAL_ATTRIBUTE, true);
    setStage(player, STAGE_RAILWAY);
    // Deferred a tick: the chat is not opened from inside the hit pipeline.
    const { CountdownTask, TaskManager } = api.core;
    TaskManager.submit(new CountdownTask(player, 1, () => {
      if (player.isRegistered?.() === false) return;
      startTranscript(api, player, SIGMUND_NPC_ID, PAGE, "attacking-him-with-the-ancient-mace-special");
    }));
  }

  function enterTunnel(player) {
    player.moveTo(TUNNEL_LANDING);
    if (stageOf(player) === STAGE_TUNNEL && !sigmundExposed(player)) spawnTunnelNpcs(player);
    startTranscript(api, player, GUARD_NPC_ID, PAGE, "the-under-underground");
  }

  function handleCaveZoneEnter({ player }) {
    if (stageOf(player) < STAGE_TUNNEL || stageOf(player) > STAGE_RAILWAY) return;
    if (armedCaveReturn.has(player)) {
      armedCaveReturn.delete(player);
      return;
    }
    enterTunnel(player);
  }

  function handleGuardZoneEnter({ player }) {
    if (stageOf(player) !== STAGE_TUNNEL || sigmundExposed(player)) return;
    const location = player.getLocation();
    if (location.getY() >= 9000) return;
    if (player.getAttribute(HIDING_ATTRIBUTE) === true && location.equals(HIDING_TILE)) return;
    player.setAttribute(HIDING_ATTRIBUTE, false);
    player.getPacketSender().sendVarbit(VARBIT_HIDING, 0);
    if (player.getAttribute(PATROL_PASSED_ATTRIBUTE) === true && escortOf(player) > 0) {
      if (player.getAttribute(GUARDS_ENGAGED_ATTRIBUTE) !== true) {
        engageGuard(player);
        startTranscript(api, player, GUARD_NPC_ID, PAGE, "the-distraction-guards-engaging-in-combat-with-the-sergeants");
      }
      return;
    }
    caughtInTunnel(player, "the-distraction-if-the-guards-spot-the-player");
  }

  function descendToRailway(player) {
    if (inShowdown(player)) {
      player.moveTo(RAILWAY_LANDING);
      player.setAttribute(SIGMUND_EXPOSED_ATTRIBUTE, true);
      if (player.getAttribute(ZANIK_UNTIED_ATTRIBUTE) === undefined) player.setAttribute(ZANIK_UNTIED_ATTRIBUTE, false);
      if (player.getAttribute(TRAIN_OPEN_ATTRIBUTE) === undefined) player.setAttribute(TRAIN_OPEN_ATTRIBUTE, false);
      spawnSigmund(player);
      return;
    }
    if (stageOf(player) !== STAGE_TUNNEL) return;
    if (player.getAttribute(GUARDS_ENGAGED_ATTRIBUTE) !== true && player.getAttribute(GUARD_DEFEATED_ATTRIBUTE) !== true) {
      caughtInTunnel(player, "the-distraction-if-the-guard-at-the-end-spots-the-player");
      return;
    }
    clearTunnel(player);
    player.moveTo(RAILWAY_LANDING);
    // Stage 10 is the special, not the descent: Quest Helper's stage 9 still owns the
    // showdown and stage 10 starts at "untie Zanik" once the prayer is broken.
    player.setAttribute(SIGMUND_EXPOSED_ATTRIBUTE, true);
    player.setAttribute(ZANIK_UNTIED_ATTRIBUTE, false);
    player.setAttribute(TRAIN_OPEN_ATTRIBUTE, false);
    spawnSigmund(player);
    startTranscript(api, player, SIGMUND_NPC_ID, PAGE, "climbing-down-to-the-railway");
  }

  function handleUntie(player) {
    const sigmund = tracked(player).get("sigmund");
    const sigmundAlive =
      sigmund && sigmund.getHitpoints?.() > 0 && sigmund.isRegistered?.() !== false;
    if (sigmundAlive) {
      startTranscript(api, player, SIGMUND_NPC_ID, PAGE, "climbing-down-to-the-railway-attempting-to-untie-zanik-during-the-fight");
      player.setHitpoints(Math.max(1, player.getHitpoints() - 10));
      return;
    }
    // The death transcript unties her; if it was interrupted, replay it from there.
    startTranscript(api, player, SIGMUND_NPC_ID, PAGE, "defeating-sigmund", (steps) => {
      const index = steps.findIndex((step) => step?.id === "VcaIcO");
      return index === -1 ? steps : steps.slice(index);
    });
  }

  // ==========================================================================
  // Object and ladder interactions
  // ==========================================================================

  function enterStation(player) {
    const stage = stageOf(player);
    if (stage >= STAGE_KIDNAPPED && stage < STAGE_COMPLETE) {
      startTranscript(api, player, NpcIdentifiers.UR_TAG, PAGE, "upon-defeating-the-two-h-a-m-members-attempting-to-enter-the-rail-station-via-dorgesh-kaan");
      return;
    }
    player.moveTo(STATION_LANDING);
  }

  function handleObjectInteraction(event) {
    const { player, objectId, location } = event;
    if (objectId === HIDING_CRATE_OBJECT_ID && stageOf(player) === STAGE_TUNNEL) {
      event.handled = true;
      hideBehindCrate(player);
      return;
    }
    if (objectId === DOORWAY_CITY_OBJECT_ID) {
      // Outside the quest the captured doorway (LocTeleports) is the station entrance. Its
      // landing (2488,5536) was recorded on a finished account: it is the train platform,
      // which has no walkable link to the dig tunnel. During the quest the doorway leads to
      // the dig floor instead; no in-quest capture of this doorway exists.
      const stage = stageOf(player);
      if (stage === 0 || stage >= STAGE_COMPLETE) return;
      event.handled = true;
      enterStation(player);
      return;
    }
    if (objectId === DOORWAY_TUNNEL_GOBLIN_OBJECT_ID) {
      if (location?.x === 2489 && location?.y === 5536) return; // Captured station-side exit.
      event.handled = true;
      const at = player.getLocation();
      player.moveTo(at.getX() < 2600 ? CITY_LANDING : STATION_LANDING);
      return;
    }
    if (objectId === DOORWAY_TUNNEL_DWARF_OBJECT_ID) {
      return; // Captured dwarf-side exit belongs to LocTeleports.
    }
    if (objectId === DOORWAY_TUNNEL_FAR_OBJECT_ID) return;
    if (objectId === TIED_ZANIK_OBJECT_ID) {
      event.handled = true;
      const stage = stageOf(player);
      if (stage === STAGE_TUNNEL || stage === STAGE_RAILWAY) handleUntie(player);
      return;
    }
  }

  function handleLaddersClimb(event) {
    const { player, objectId } = event;
    switch (objectId) {
      case LADDER_TO_CAVES_OBJECT_ID:
        if (stageOf(player) < STAGE_TUNNEL) return;
        event.handled = true;
        player.moveTo(CAVE_LANDING);
        armedCaveReturn.add(player);
        return;
      case LADDER_TO_RAILWAY_OBJECT_ID:
        if (stageOf(player) < STAGE_TUNNEL || stageOf(player) > STAGE_RAILWAY) return;
        event.handled = true;
        descendToRailway(player);
        return;
      case LADDER_TOWER_UP_OBJECT_ID:
        event.handled = true;
        player.moveTo(TOWER_LANDING);
        return;
      case LADDER_TOWER_DOWN_OBJECT_ID:
        event.handled = true;
        player.moveTo(INSTANCE_LANDING);
        return;
      case LADDER_TRAIN_OBJECT_ID:
        if (stageOf(player) < STAGE_RAILWAY && !inShowdown(player)) return;
        event.handled = true;
        player.moveTo(STATION_BOTTOM);
        return;
      default:
        return;
    }
  }

  // ==========================================================================
  // Login
  // ==========================================================================

  /**
   * Saves from before the live stage order used 6 for "both snipers dead" and 10 for the
   * railway descent. The current order never stores 6 with both snipers dead, nor 10
   * without the mace special, so those pairs can only be old saves.
   */
  function migrateLegacyStage(player) {
    const stage = stageOf(player);
    if (stage === STAGE_AMBUSH && snipersDead(player) === 3) setStage(player, STAGE_SNIPERS_DEAD);
    else if (stage === STAGE_RAILWAY && !specialUsed(player)) setStage(player, STAGE_TUNNEL);
  }

  function handleLogin({ player }) {
    if (player?.isPlayerBot?.() === true) return;
    migrateLegacyStage(player);
    syncQuestVarbits(player);
    refreshQuestList(player);
    spawnOldak(player);
    const stage = stageOf(player);
    if (stage === STAGE_AMBUSH) spawnSnipers(player);
    if (stage === STAGE_SNIPERS_DEAD) spawnInstanceGenerals(player);
    const at = player.getLocation();
    if (stage === STAGE_TUNNEL && !sigmundExposed(player) && at.getX() >= 2393 && at.getX() <= 2414 && at.getY() >= 5525 && at.getY() <= 5560) {
      spawnTunnelNpcs(player);
      if (player.getAttribute(HIDING_ATTRIBUTE) === true) hideBehindCrate(player);
    }
    if (sigmundExposed(player) && inShowdown(player)) {
      player.setAttribute(SIGMUND_EXPOSED_ATTRIBUTE, true);
      if (player.getAttribute(ZANIK_UNTIED_ATTRIBUTE) === undefined) player.setAttribute(ZANIK_UNTIED_ATTRIBUTE, false);
      if (player.getAttribute(TRAIN_OPEN_ATTRIBUTE) === undefined) player.setAttribute(TRAIN_OPEN_ATTRIBUTE, false);
      spawnSigmund(player);
    }
  }

  function handleLogout({ player }) {
    patrolTasks.get(player)?.stop();
    patrolTasks.delete(player);
    for (const key of [...(trackedNpcs.get(player)?.keys() ?? [])]) despawnTracked(player, key);
    trackedNpcs.delete(player);
    pendingHandIn.delete(player);
    armedCaveReturn.delete(player);
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function objectiveLines(player, stage) {
    const done = stage >= STAGE_COMPLETE;
    const line = (text, complete) =>
      `${complete || done ? "<str>" : ""}${text}${complete || done ? "</str>" : ""}`;
    return [
      line("Negotiate the Dorgesh-Kaan - Keldagrim train agreement and clear the Lumbridge tunnel.", stage >= STAGE_STARTED),
      line("Expose and fight Sigmund in the tunnel.", stage >= STAGE_TUNNEL && sigmundExposed(player)),
      line("Use the ancient mace's special attack in the showdown.", specialUsed(player)),
      "",
    ];
  }

  function buildJournal(player, handle) {
    return [
      ...objectiveLines(player, handle.getStage(player)),
      ...buildJournalDetails(player, handle),
    ];
  }

  function buildJournalDetails(player, handle) {
    const stage = handle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Ur-tag asked me to help excavate the ancient goblin artefacts.</str>",
        "<str>I helped the goblin scribe and the generals, and rescued Zanik</str>",
        "<str>from Sigmund at the new Dorgesh-Kaan-Keldagrim railway.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_RAILWAY || (stage >= STAGE_TUNNEL && sigmundExposed(player))) {
      return [
        "<str>Sigmund has Zanik tied to the train tracks in the new tunnel.</str>",
        "Defeat <col=800000>Sigmund</col> and untie <col=800000>Zanik</col>!",
      ];
    }
    if (stage >= STAGE_TUNNEL) {
      return [
        "<str>Sigmund is holding Zanik in the H.A.M. tunnel under Lumbridge.</str>",
        "Enter the new hole by the rope in the <col=800000>Lumbridge Swamp",
        "Caves</col> and sneak past the guards with the goblin sergeants.",
      ];
    }
    if (stage >= STAGE_KIDNAPPED) {
      return [
        "<str>Sigmund kidnapped Zanik! The generals gave me the ancient mace</str>",
        "<str>and sent Sergeants Mossfists and Slimetoes to help me.</str>",
        "Meet the sergeants at the <col=800000>Lumbridge Swamp Caves</col>.",
      ];
    }
    if (stage >= STAGE_SNIPERS_DEAD) {
      return [
        "<str>The H.A.M. archer and mage are dead.</str>",
        "Talk to the <col=800000>generals</col> in Goblin Village.",
      ];
    }
    if (stage >= STAGE_VILLAGE) {
      return [
        "<str>Oldak teleported Zanik and me to Goblin Village.</str>",
        "Kill the <col=800000>H.A.M. archer</col> and <col=800000>mage</col>",
        "on the tower north of the village.",
      ];
    }
    if (stage >= STAGE_SCRIBE) {
      return [
        "<str>The goblin scribe could not read the mace's symbols.</str>",
        "Ask <col=800000>Oldak</col> in Dorgesh-Kaan to teleport us to the",
        "goblin generals in <col=800000>Goblin Village</col>.",
      ];
    }
    if (stage >= STAGE_ARTEFACTS) {
      return [
        "<str>I handed all six artefacts to Tegdak.</str>",
        "<str>Zanik is taking the ancient mace to the goblin scribe.</str>",
        "Show the mace to the <col=800000>goblin scribe</col>.",
      ];
    }
    if (stage >= STAGE_DIGGING) {
      return [
        "<str>Tegdak gave me a trowel and a specimen brush.</str>",
        "Dig up the six <col=800000>artefacts</col> along the train tracks,",
        "clean them on the <col=800000>sample table</col> and hand them in.",
        `Artefacts delivered: ${handedIn(player)}/6`,
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>Ur-tag asked me to help with the archaeological dig.</str>",
        "Talk to <col=800000>Tegdak</col> at the train station in the",
        "south-west of Dorgesh-Kaan.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Ur-tag</col> or",
      "<col=800000>Ambassador Alvijar</col> in Dorgesh-Kaan.",
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.MINING, 3000);
    skills.addExperiences(Skill.PRAYER, 3000);
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  api.persistAttribute(SPOTS_ATTRIBUTE);
  api.persistAttribute(HANDED_IN_ATTRIBUTE);
  api.persistAttribute(DELIVERED_ATTRIBUTE, 0);
  api.persistAttribute(ZANIK_AT_DIG_ATTRIBUTE);
  api.persistAttribute(MACE_ATTRIBUTE);
  api.persistAttribute(SPECIAL_ATTRIBUTE);
  api.persistAttribute(SIGMUND_EXPOSED_ATTRIBUTE, false);
  api.persistAttribute(ZANIK_UNTIED_ATTRIBUTE, false);
  api.persistAttribute(TRAIN_AGREEMENT_ATTRIBUTE, false);
  api.persistAttribute(TRAIN_OPEN_ATTRIBUTE, false);
  api.persistAttribute(SNIPERS_ATTRIBUTE);
  api.persistAttribute(ESCORT_ATTRIBUTE);
  api.persistAttribute(SEPARATED_ATTRIBUTE);
  api.persistAttribute(GUARDS_ENGAGED_ATTRIBUTE);
  api.persistAttribute(HIDING_ATTRIBUTE, false);
  api.persistAttribute(PATROL_PASSED_ATTRIBUTE, false);
  api.persistAttribute(GUARD_DEFEATED_ATTRIBUTE, false);

  quest = registerQuest(api, {
    key: "another_slice_of_ham",
    name: "Another Slice of H.A.M.",
    varpId: VARP_SLICE,
    varbitId: VARBIT_STAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.MINING.getIndex(), amount: 3000, label: "Mining" },
      { skillId: Skill.PRAYER.getIndex(), amount: 3000, label: "Prayer" },
    ],
    otherRewards: [
      "The ancient mace",
      "The ability to buy Goblin Village teleport spheres",
      "Free access to the Dorgesh-Kaan - Keldagrim train system",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleConditionChosen);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnNpc(handleItemOnNpc, { noted: false });
  api.onItemAction("Ancient mace", { Wield: wieldAncientMace });
  api.onItemAction("Goblin village sphere", { Break: breakRouteSphere });
  api.onItemDropPolicy(handleItemDropPolicy);
  api.onObjectInteraction(handleObjectInteraction);
  api.onCustomEvent("ladders:climb", handleLaddersClimb);
  api.onNpcInteraction("Ur-tag", { "Talk-to": talkUrTag });
  api.onNpcInteraction("Ambassador Alvijar", { "Talk-to": talkAlvijar });
  api.onNpcInteraction("Tegdak", { "Talk-to": talkTegdak });
  api.onNpcInteraction("Zanik", { "Talk-to": talkZanik });
  api.onNpcInteraction("Sigmund", { "Talk-to": talkSigmund });
  api.onNpcInteraction("H.A.M. Archer", { "Talk-to": talkHamMember });
  api.onNpcInteraction("H.A.M. Mage", { "Talk-to": talkHamMember });
  api.onNpcInteraction("Goblin scribe", { "Talk-to": talkScribe });
  api.onNpcInteraction("Oldak", { "Talk-to": talkOldak });
  api.onNpcInteraction("Builder", { "Talk-to": talkBuilder });
  api.onNpcInteraction("General Wartface", { "Talk-to": talkGeneral });
  api.onNpcInteraction("General Bentnoze", { "Talk-to": talkGeneral });
  api.onNpcInteraction("Sergeant Mossfists", { "Talk-to": talkSergeant });
  api.onNpcInteraction("Sergeant Slimetoes", { "Talk-to": talkSergeant });
  api.onNpcHitModify(handleSigmundHit);
  api.onNpcDeath(handleNpcDeath);
  api.onZoneEnter(CAVE_HOLE_ZONE, handleCaveZoneEnter);
  api.onZoneEnter(GUARD_CORRIDOR_ZONE, handleGuardZoneEnter);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
