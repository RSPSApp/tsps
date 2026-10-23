/**
 * The Red Reef (members).
 *
 * The words come from the "The Red Reef" transcript page (npc-dialogues.json); this
 * plugin supplies the variant selector for every quest NPC, the start hook, the prose
 * condition answers (diving gear/space/dragon scimitar), the display-case and coral
 * dredger actions, the Last Light/Zenith/Great Conch spawns and the reward.
 *
 * Stages (varbit 18335 "trr", varp 4962 bits 0-5; matches the cache transforms and
 * the OSRS stage values, evidence below):
 *   0  not started
 *   2  asked to look for Floopa (ask around town)
 *   4  told Floopa headed to the Sacred Grove (find Elder Katt)
 *   6  Elder Katt let you into the Grove (find Floopa)
 *   8  found Floopa (sail to Red Rock)
 *   10 arrived at Red Rock (talk to the receptionist)
 *   12 receptionist arranged a meeting (inspect the display cases)
 *   14 displays inspected (meet Theodore Paxton)
 *   16 tasked with Black Eye Bethel at Last Light
 *   18 pirate ships (Paxton's task; sail south and sink them)
 *   20 pirate ships sunk (dock/disembark at Last Light)
 *   22 six pirate crew defeated on the island (climb the lighthouse)
 *   24 island crew defeated (climb to Black Eye Bethel)
 *   26 Black Eye Bethel defeated (return to Paxton)
 *   28 Zenith known (board and talk to Spencer Brentwood)
 *   30 aboard the Zenith (Spencer gives diving gear; dive)
 *   32 diving on the seabed (first dredger repair / giant lobster)
 *   34 repair the northern coral dredger again
 *   36 report to Spencer at the eastern dredger
 *   38 hear Spencer's plan back on the surface
 *   40 report to Floopa and Elder Raley
 *   42 complete
 *
 * Varbit evidence: quest id 7107 -> varbit 18335 in cache script 4024 (the quest list
 * script); lookup-gameval names it "trr", varp 4962 bits 0-5; sibling varbits are the
 * display cases (18338-18341). Cache npc transforms align with the values above
 * (Floopa appears at >= 6, Bethel's four phases at >= 18, Spencer aboard at >= 28) and
 * loc 58497 gains its "Repair" option at 32-34.
 *
 * Source: OSRS Wiki (https://oldschool.runescape.wiki/w/The_Red_Reef,
 * /w/Transcript:The_Red_Reef and /w/Transcript:The_Red_Reef/Journal).
 * Rewards per the wiki: 2 Quest points, 15,000 Sailing XP, 5,000 Smithing XP, the
 * Bosun's workbench schematic (33423) and access to the Sacred Grove.
 *
 * Naval encounter: sailing uses the generic boat system (Red Rock is a real port). The two
 * captured pirate ships use generic ship combat; sinking both sets stage 20 and varbit 13219.
 * At stage 22 the six island pirate-crew NPCs (ids 15021-15024 over six captured tiles) are
 * spawned on Last Light; defeating all six sets stage 24. The repo has no NPC-boat hull/cannon
 * model, so the captured crews are fought directly instead of through cannon fire.
 *
 * Black Eye Bethel uses the cache NPC and the captured mechanics in a level-2 area: periodic
 * sweep/charge with a dodge window, rune-scimitar and dragon-scimitar switches, and the
 * dragon scimitar special that disables protection prayers (script 1872, gfx 347).
 * - Diving is a teleport to the seabed rather than boat/sea travel; Spencer's gear
 *   items are granted by the transcript's "gives you some diving equipment" step.
 * - The camphor-tree shout and freeing the parrot are not implemented (the parrot
 *   free is optional in OSRS and its cage npc is not spawned).
 */
module.exports = function registerRedReefQuest(api) {
  const { Equipment, ItemIdentifiers, Location, NpcIdentifiers, ObjectIdentifiers, Skill } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");
  const StaticShips = require("../../skills/sailing/StaticShips.Sailing");
  const { crossingFor } = require("../../objects/WallDoor.Doors");
  const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");

  // ==========================================================================
  // Ids
  // ==========================================================================

  const ELDER_RALEY_NPC_ID = NpcIdentifiers.ELDER_RALEY; // 15002
  const ELDER_KATT_NPC_ID = NpcIdentifiers.ELDER_KATT; // 14846
  const GUPPA_NPC_ID = NpcIdentifiers.GUPPA; // 15064
  const FLOOPA_GROVE_NPC_ID = NpcIdentifiers.FLOOPA_4; // 15012 (appears at stage >= 6)
  const FLOOPA_HOUSE_NPC_ID = NpcIdentifiers.FLOOPA_3; // 14994
  const RECEPTIONIST_NPC_ID = NpcIdentifiers.RECEPTIONIST; // 15013
  const THEODORE_PAXTON_NPC_ID = NpcIdentifiers.THEODORE_PAXTON; // 15015
  const SPENCER_BRENTWOOD_NPC_ID = NpcIdentifiers.SPENCER_BRENTWOOD; // 15017
  // Spencer's diving parents are nameless in NpcIdentifiers (cache 15018/15019).
  const SPENCER_DIVING_A_NPC_ID = 15018; // TRR_SPENCER_BRENTWOOD_DIVING_A
  const SPENCER_DIVING_B_NPC_ID = 15020; // SPENCER_BRENTWOOD_2, TRR_SPENCER_BRENTWOOD_DIVING_VIS
  const BLACK_EYE_BETHEL_NPC_ID = NpcIdentifiers.BLACK_EYE_BETHEL; // 15025
  const GIANT_LOBSTER_NPC_ID = NpcIdentifiers.GIANT_LOBSTER_4; // 15034
  const PIRATE_NPC_IDS = [
    NpcIdentifiers.PIRATE_53, // 15021
    NpcIdentifiers.PIRATE_54, // 15022
    NpcIdentifiers.PIRATE_55, // 15023
    NpcIdentifiers.PIRATE_56, // 15024
  ];
  // The captured static ships (data/static-ships.json): the Zenith and two pirate boats.
  const ZENITH_SHIP_ID = "the_zenith";
  const PIRATE_SHIP_IDS = ["red_reef_pirate_1", "red_reef_pirate_2"];
  const PIRATE_SHIPS_VARBIT = 13219;
  const PIRATE_SHIPS_ATTRIBUTE = "the-red-reef:pirate-ships";
  const PIRATE_SUNK_ATTRIBUTE = "the-red-reef:pirate-sunks";
  const SPENCER_DECK_X = 8;
  const SPENCER_DECK_Y = 13;
  const NAVAL_STARTED_ATTRIBUTE = "the-red-reef:naval-started";
  const VERSION_ATTRIBUTE = "the-red-reef:version";
  const VERSION = 2;
  const OLD_STAGE_MAP = new Map([[16, 18], [20, 22], [22, 24], [24, 26], [26, 28], [28, 30], [30, 32]]);
  const BETHEL_CHARGE_ANIM = 13131;
  const BETHEL_RAMPAGE_ANIM = 1056;
  const BETHEL_DRAGON_SPECIAL_ANIM = 1872;
  const BETHEL_DRAGON_SPECIAL_GFX = 347;
  const BETHEL_RUNE_GLOW = 3495;
  const BETHEL_DRAGON_GLOW = 246;
  const BETHEL_SWEEP_LINES = ["Dodge this!", "It's slashin' time!", "You're done!"];
  const BETHEL_SPECIAL_LINES = [
    "No god can save you from me!",
    "Fight me properly, coward!",
    "Even praying won't help you now!",
  ];
  const BETHEL_ZONE = { minX: 2855, maxX: 2870, minY: 2318, maxY: 2332, level: 2 };

  /** The tortugans that tell you Floopa went to the Sacred Grove (page variants). */
  const FLOOPA_SEARCH_VARIANTS = new Map([
    [NpcIdentifiers.ELDER_COCO, "the-search-for-floopa-talking-to-elder-coco"], // 14828
    [NpcIdentifiers.ELDER_COCO_2, "the-search-for-floopa-talking-to-elder-coco"], // 14829
    [NpcIdentifiers.ELDER_STROM, "the-search-for-floopa-talking-to-elder-strom"], // 14831
    [NpcIdentifiers.ELDER_STROM_2, "the-search-for-floopa-talking-to-elder-strom"], // 14832
    [NpcIdentifiers.ELDER_KRILL, "the-search-for-floopa-talking-to-elder-krill"], // 14834
    [NpcIdentifiers.ELDER_KRILL_2, "the-search-for-floopa-talking-to-elder-krill"], // 14835
    [NpcIdentifiers.ELDER_BLUNN, "the-search-for-floopa-talking-to-elder-blunn"], // 14837
    [NpcIdentifiers.ELDER_BLUNN_2, "the-search-for-floopa-talking-to-elder-blunn"], // 14838
    [NpcIdentifiers.MAG, "the-search-for-floopa-talking-to-mag"], // 14840
    [NpcIdentifiers.MAG_2, "the-search-for-floopa-talking-to-mag"], // 14841
    [NpcIdentifiers.ELDER_TORGAN, "the-search-for-floopa-talking-to-elder-torgan"], // 14845
    [NpcIdentifiers.LEFF, "the-search-for-floopa-talking-to-leff"], // 14848
    [NpcIdentifiers.DALNA, "the-search-for-floopa-talking-to-dalna"], // 14849
    [NpcIdentifiers.FINN_2, "the-search-for-floopa-talking-to-finn"], // 14850
    [NpcIdentifiers.AMMA, "the-search-for-floopa-talking-to-amma"], // 14851
    [GUPPA_NPC_ID, "the-search-for-floopa-talking-to-guppa"],
  ]);

  const DEEP_SEA_HELMET_ITEM_ID = ItemIdentifiers.DEEP_SEA_HELMET_4; // 31401
  const DEEP_SEA_APPARATUS_ITEM_ID = ItemIdentifiers.DEEP_SEA_APPARATUS_4; // 31403
  const MEDALLION_OF_THE_DEEP_ITEM_ID = ItemIdentifiers.MEDALLION_OF_THE_DEEP; // 32386
  const BOSUNS_WORKBENCH_SCHEMATIC_ITEM_ID = ItemIdentifiers.BOSUNS_WORKBENCH_SCHEMATIC; // 33423
  const DRAGON_SCIMITAR_ITEM_ID = ItemIdentifiers.DRAGON_SCIMITAR; // 4587

  /** Deep-sea gear and the medallion all satisfy the wiki's diving conditions. */
  const DIVING_ITEM_IDS = new Set([
    DEEP_SEA_HELMET_ITEM_ID,
    DEEP_SEA_APPARATUS_ITEM_ID,
    MEDALLION_OF_THE_DEEP_ITEM_ID,
  ]);

  /** Display case interiors: object, varbit, interface 400 script 8565 payload (capture 4152). */
  const DISPLAY_CASES = [
    {
      objectId: ObjectIdentifiers.DISPLAY, // 58491
      varbit: 18338,
      title: "The Brentwood Trading Company",
      model: 58824,
      height: 150,
      prose: "In the year 144 of the Fifth Age, the young Spencer Brentwood set out to redefine the relationship between humans and the sea. With nothing to his name apart from an unparalleled drive for success, along with a small loan of one million gold from his father, he founded the Brentwood Trading Company, the first step in a journey to greatness.",
    },
    {
      objectId: ObjectIdentifiers.DISPLAY_2, // 58492
      varbit: 18339,
      title: "Brentwood Diving Bell",
      model: 58825,
      height: 140,
      prose: "As an innovator, Spencer Brentwood has been personally responsible for the development of many new seafaring technologies, with the Brentwood Diving Bell being his defining achievement. This creation unlocked the exploration of the depths in a way never before seen, bringing new benefits to all of humanity.",
    },
    {
      objectId: ObjectIdentifiers.DISPLAY_3, // 58493
      varbit: 18340,
      title: "Red Coral",
      model: 58826,
      height: 150,
      prose: "In the year 152 of the Fifth Age, Spencer Brentwood was personally responsible for a discovery that changed everything. While engaging in a philanthropic research dive, Brentwood discovered red coral. Testing quickly showed that when refined correctly, burning this coral granted powerful divinational abilities. Red coral quickly became the most important substance traded by the Brentwood Trading Company, leading to a new name for the organisation: The Red Reef Trading Company.",
    },
    {
      objectId: ObjectIdentifiers.DISPLAY_4, // 58494
      varbit: 18341,
      title: "The Red Reef",
      model: 58827,
      height: 130,
      prose: "Under the guidance of Spencer Brentwood, the Red Reef Trading Company has grown to become one of the largest seafaring organisations around. Brentwood's approach sees profits come second to innovation and discovery, with the company's work in the Red Reef being the finest example of this. There, red coral is sustainably gathered and refined before being distributed across the world, with its divinational properties benefiting humanity in new ways each and every day.",
    },
  ];
  const DISPLAY_CASE_VARBITS = new Map(DISPLAY_CASES.map((entry) => [entry.objectId, entry.varbit]));
  const CORAL_DREDGER_REPAIR_OBJECT_ID = ObjectIdentifiers.CORAL_DREDGER_2; // 58500
  const CORAL_DREDGER_BASE_OBJECT_ID = 58497; // raw placed parent; transforms to 58500 at 32-34
  // Last Light's lighthouse doorway, as captured (transcripts/RedReefDiscord capture 4152,
  // ticks 1345-1347 and the reverse at 1474-1478): the normal Open click swaps the closed
  // leaf 60018 for the inactive doorway 60019 and the invisible wall 38848 in the SAME tile
  // (both shape 0 / face 0), walks the player one tile through the clipped edge, and puts
  // 60018 back two ticks later. The crossing is scripted per player, not a global open door.
  const LAST_LIGHT_DOORWAY_OBJECT_ID = 60018; // last_light_doorway, Open
  const LAST_LIGHT_DOORWAY_OPEN_OBJECT_ID = 60019; // last_light_doorway_inactive
  const LAST_LIGHT_INVISWALL_OBJECT_ID = 38848; // inviswall shown in the open doorway
  const LAST_LIGHT_DOOR_TILE = { x: 2858, y: 2323, z: 0 };
  const LAST_LIGHT_DOOR_OPEN_TICKS = 2; // capture 1345 open -> 1347 closed; same on exit
  /** player -> { key, destination } while their scripted threshold crossing is in flight. */
  const lastLightDoorCrossings = new WeakMap();
  const DISPLAY_CASE_ATTRIBUTE = "the-red-reef:display-cases";
  const DISPLAY_CASE_IDS = [...DISPLAY_CASE_VARBITS.keys()];

  // ==========================================================================
  // Stages, page and step ids
  // ==========================================================================

  const VARBIT_THE_RED_REEF = 18335; // "trr"
  const VARP_THE_RED_REEF = 4962;

  const STAGE_STARTED = 2;
  const STAGE_GROVE_KNOWN = 4;
  const STAGE_GROVE_ACCESS = 6;
  const STAGE_FLOOPA_FOUND = 8;
  const STAGE_RED_ROCK = 10;
  const STAGE_MEETING_READY = 12;
  const STAGE_MEETING_ARRANGED = 14;
  const STAGE_DISPLAYS = 16;
  const STAGE_PAXTON_TASKED = 18;
  const STAGE_SHIPS_SUNK = 20;
  const STAGE_KILL_PIRATES = 22;
  const STAGE_PIRATES_DEAD = 24;
  const STAGE_BETHEL_DEAD = 26;
  const STAGE_ZENITH_KNOWN = 28;
  const STAGE_ABOARD_ZENITH = 30;
  const STAGE_DIVING = 32;
  const STAGE_FIXING_DREDGER = 32;
  const STAGE_DREDGER_AGAIN = 34;
  const STAGE_REPORT_EAST = 36;
  const STAGE_SURFACE_PLAN = 38;
  const STAGE_RETURN_FLOOPA = 40;
  const STAGE_COMPLETE = 42;

  const SAILING_REQUIREMENT = 52;
  const SMITHING_REQUIREMENT = 48;
  const SAILING_XP = 15000;
  const SMITHING_XP = 5000;

  const PAGE = "The Red Reef";
  const START_HOOK = "quest:the-red-reef:start";

  // Condition step ids (research pack).
  const NO_DIVING_GEAR_CONDITION_IDS = new Set(["x3HLXd", "BOlODW", "VE5dY_"]);
  const HAS_DIVING_GEAR_CONDITION_IDS = new Set(["tBtk3j", "_LVHD3"]);
  const GEAR_IN_INVENTORY_CONDITION_ID = "UAR3gf";
  const WEARING_GEAR_CONDITION_ID = "x_TGNS";
  const NO_GEAR_NO_SPACE_CONDITION_IDS = new Set(["wBzwEY", "SPJpPe"]);
  const FINALE_NO_SPACE_CONDITION_ID = "HJgzIM";
  const NO_DRAGON_SCIMITAR_CONDITION_ID = "OkLA-m";
  const HAS_DRAGON_SCIMITAR_CONDITION_ID = "cfTVSP";

  // Action/message step ids (research pack).
  const GIVE_DIVING_GEAR_ACTION_IDS = new Set(["Wq1UDW", "pHjCEB"]);
  const REPAIR_DREDGER_MESSAGE_ID = "A1Ua7w";
  const SURFACE_RETURN_MESSAGE_ID = "NpiI3y";
  const SHIPS_SUNK_MESSAGE_ID = "58k-ri";
  const COMPLETE_ACTION_ID = "vNjARR";

  const APPROACHING_LAST_LIGHT_VARIANT = "the-pirates-of-last-light-when-approaching-the-island";
  const SHIPS_SUNK_VARIANT = "the-pirates-of-last-light-after-sinking-the-pirate-ships";
  const REPAIR_DREDGER_VARIANT = "underwater-repairing-the-dredger";
  const SURFACE_PLAN_LAST_LINE = "Thank you. I'd best be on my way.";
  const FINALE_GIFT_LINE = "Now, before you go I had something to give you that you might find useful.";
  const DIVE_CONFIRM_OPTION = "Let's go.";
  const ZENITH_DISEMBARK_OPTION = "Actually, I'd like to disembark.";
  const PLAYER_DIVING_VARBIT = 19526;

  // ==========================================================================
  // Zones and spawn points
  // ==========================================================================

  const RED_ROCK_ZONE = { minX: 2780, maxX: 2815, minY: 2497, maxY: 2535, levels: [0] };
  const LAST_LIGHT_ZONE = { minX: 2845, maxX: 2872, minY: 2316, maxY: 2336, levels: [0, 1, 2] };

  const FLOOPA_GROVE_TILE = { x: 3194, y: 2490, z: 0 };
  const FLOOPA_HOUSE_TILE = { x: 3186, y: 2405, z: 0 };
  const SPENCER_SURFACE_TILE = { x: 2878, y: 2505, z: 0 };
  // Capture 4152: the dive teleports the player to 2837,8922 and the visible diving Spencer
  // (15018 -> multinpc 15020) is added at 2836,8922 only for the stage 30->32 transition; it is
  // deleted the tick trr becomes 32. The first repair is the object click, not a Spencer talk.
  const SPENCER_DIVING_B_TILE = { x: 2857, y: 8915, z: 1 };
  const SEABED_DIVE_TILE = { x: 2837, y: 8922, z: 1 };
  const BETHEL_TILE = { x: 2865, y: 2324, z: 2 }; // captured add 15025, open tile
  const LOBSTER_TILE = { x: 2847, y: 8938, z: 1 }; // captured add 15034, reachable
  // The quest seabed around the dive tile; used only to restore player_diving on login.
  const RED_REEF_SEABED_ZONE = { minX: 2820, maxX: 2900, minY: 8880, maxY: 8980, level: 1 };
  // Walkable (object-free) tiles on the Last Light isle from the loc dump.
  // The last two tiles are the primary capture's trr_pirate adds (RedReefDiscord ticks
  // 626-1246), replacing the old QH points 2847,2326 (water) and 2855,2333 (ocean-clipped);
  // both replacements are walkable and already-earned kills are unaffected.
  const PIRATE_TILES = [
    { x: 2849, y: 2324 },
    { x: 2852, y: 2321 },
    { x: 2852, y: 2325 },
    { x: 2856, y: 2321 },
    { x: 2852, y: 2328 },
    { x: 2858, y: 2322 },
  ];

  let quest;
  /** Per-player quest NPCs (owner-only spawns, resynced on stage changes/login). */
  const questSpawns = new Map();
  /**
   * The finale's reward is an action step after the wiki's `end` marker: the
   * runtime closes on `end` before reaching it, so completion is armed by Raley's
   * gift line (only with a free slot) and fired on that end step.
   */
  const finaleRewardPending = new WeakSet();

  // ==========================================================================
  // Helpers
  // ==========================================================================

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const freeSlots = (player) => player.getInventory().getFreeSlots();

  function inRedReefSeabed(player) {
    const location = player.getLocation?.();
    return !!location
      && location.getZ() === RED_REEF_SEABED_ZONE.level
      && location.getX() >= RED_REEF_SEABED_ZONE.minX
      && location.getX() <= RED_REEF_SEABED_ZONE.maxX
      && location.getY() >= RED_REEF_SEABED_ZONE.minY
      && location.getY() <= RED_REEF_SEABED_ZONE.maxY;
  }

  function sendDiving(player, value) {
    player.getPacketSender().sendVarbit(PLAYER_DIVING_VARBIT, value);
  }

  /** Restore the client's diving bit from this player's actual quest location and stage. */
  function syncDivingState(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_DIVING && stage < STAGE_SURFACE_PLAN) {
      sendDiving(player, inRedReefSeabed(player) ? 1 : 0);
    } else if (stage === STAGE_SURFACE_PLAN || stage === STAGE_RETURN_FLOOPA) {
      sendDiving(player, 0);
    }
  }

  function wearing(player, itemIds) {
    for (const item of player.getEquipment().getItems()) {
      if (item && itemIds.has(item.getId())) return true;
    }
    return false;
  }

  const wearingDivingGear = (player) => wearing(player, DIVING_ITEM_IDS);
  const carryingDivingGear = (player) =>
    [...DIVING_ITEM_IDS].some((itemId) => held(player, itemId));
  const hasDivingGear = (player) => wearingDivingGear(player) || carryingDivingGear(player);

  function wearingDragonScimitar(player) {
    return player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.() === DRAGON_SCIMITAR_ITEM_ID;
  }

  function meetsRequirements(player) {
    const skills = player.getSkillManager();
    if (skills.getMaxLevel(Skill.SAILING) < SAILING_REQUIREMENT) return false;
    if (skills.getMaxLevel(Skill.SMITHING) < SMITHING_REQUIREMENT) return false;
    const request = { player, key: "troubled_tortugans", complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function grantDivingEquipment(player) {
    if (freeSlots(player) < 2) return;
    player.getInventory().adds(DEEP_SEA_HELMET_ITEM_ID, 1);
    player.getInventory().adds(DEEP_SEA_APPARATUS_ITEM_ID, 1);
  }

  function displayCaseMask(player) {
    return Number(player.getAttribute(DISPLAY_CASE_ATTRIBUTE)) || 0;
  }

  function displayCasesDone(player) {
    return displayCaseMask(player) === (1 << DISPLAY_CASE_IDS.length) - 1;
  }

  function markDisplayCase(player, index) {
    const mask = displayCaseMask(player) | (1 << index);
    player.setAttribute(DISPLAY_CASE_ATTRIBUTE, mask);
    player.getPacketSender().sendVarbit(DISPLAY_CASE_VARBITS.get(DISPLAY_CASE_IDS[index]), 1);
  }

  function sendDisplayCaseVarps(player) {
    const sender = player.getPacketSender();
    const complete = quest.getStage(player) >= STAGE_DISPLAYS;
    DISPLAY_CASE_IDS.forEach((id, index) => {
      if (complete || (displayCaseMask(player) & (1 << index)) !== 0) {
        sender.sendVarbit(DISPLAY_CASE_VARBITS.get(id), 1);
      }
    });
  }

  // ==========================================================================
  // Spawns
  // ==========================================================================

  function matchesSpawn(npc, spec) {
    const location = npc?.getLocation?.();
    return (
      npc?.getId?.() === spec.id &&
      location?.getX?.() === spec.x &&
      location?.getY?.() === spec.y &&
      location?.getZ?.() === spec.z
    );
  }

  function syncSpawn(player, state, key, spec) {
    const current = state[key];
    if (!spec) {
      if (current) api.removeNpc(current);
      state[key] = null;
      return;
    }
    if (current && matchesSpawn(current, spec)) return;
    if (current) api.removeNpc(current);
    state[key] = api.spawnNpc({ ...spec, wanderRadius: 0, owner: player, ownerOnly: true }) ?? null;
  }

  const playerShips = new WeakMap();

  function ownedShips(player) {
    let ships = playerShips.get(player);
    if (!ships) {
      ships = new Map();
      playerShips.set(player, ships);
    }
    return ships;
  }

  function aboardShip(player, ship) {
    return !!ship && player.getArea?.()?.boat === ship.boat;
  }

  function spawnOwnedShip(player, id) {
    const ships = ownedShips(player);
    const current = ships.get(id);
    if (current && StaticShips.get(current.boat.entityIndex)) return current;
    const ship = StaticShips.spawn(id, { owner: player, ownerOnly: true });
    if (ship) ships.set(id, ship);
    return ship;
  }

  function disposeOwnedShip(player, id) {
    const ships = ownedShips(player);
    const ship = ships.get(id);
    if (!ship) return;
    if (aboardShip(player, ship)) return;
    StaticShips.dispose(ship);
    ships.delete(id);
  }

  function disposeAllOwnedShips(player) {
    for (const id of [ZENITH_SHIP_ID, ...PIRATE_SHIP_IDS]) {
      const ship = ownedShips(player).get(id);
      if (ship && !aboardShip(player, ship)) {
        StaticShips.dispose(ship);
        ownedShips(player).delete(id);
      }
    }
  }

  function popcount(value) {
    let count = 0;
    for (let bits = value | 0; bits; bits &= bits - 1) count++;
    return count;
  }

  function sunkMask(player) {
    return Number(player.getAttribute(PIRATE_SUNK_ATTRIBUTE)) || 0;
  }

  function pirateShips(player) {
    return popcount(sunkMask(player));
  }

  function setSunkMask(player, mask) {
    player.setAttribute(PIRATE_SUNK_ATTRIBUTE, mask | 0);
    player.getPacketSender().sendVarbit(PIRATE_SHIPS_VARBIT, popcount(mask));
  }

  function syncPirateShips(player, stage) {
    const mask = sunkMask(player);
    for (let index = 0; index < PIRATE_SHIP_IDS.length; index++) {
      const wanted = stage === STAGE_PAXTON_TASKED && (mask & (1 << index)) === 0;
      if (wanted) spawnOwnedShip(player, PIRATE_SHIP_IDS[index]);
      else disposeOwnedShip(player, PIRATE_SHIP_IDS[index]);
    }
  }

  function syncZenith(player, stage) {
    if (stage >= STAGE_ZENITH_KNOWN && stage < STAGE_COMPLETE) {
      spawnOwnedShip(player, ZENITH_SHIP_ID);
    } else {
      disposeOwnedShip(player, ZENITH_SHIP_ID);
    }
  }

  /** Spencer stands on the Zenith deck for the first meeting and the surface report. */
  function syncDeckSpencer(player, state, stage, zenith) {
    const wanted =
      !!zenith &&
      ((stage >= STAGE_ZENITH_KNOWN && stage < STAGE_DIVING) ||
        (stage >= STAGE_SURFACE_PLAN && stage < STAGE_COMPLETE));
    if (!wanted) {
      if (state.spencerDeck) api.removeNpc(state.spencerDeck);
      state.spencerDeck = null;
      return;
    }
    const location = StaticShips.deckLocation(zenith, SPENCER_DECK_X, SPENCER_DECK_Y);
    const current = state.spencerDeck;
    if (
      current &&
      current.isRegistered?.() &&
      current.getId?.() === SPENCER_BRENTWOOD_NPC_ID &&
      current.getLocation().getX() === location.getX() &&
      current.getLocation().getY() === location.getY()
    ) {
      return;
    }
    if (current) api.removeNpc(current);
    state.spencerDeck = StaticShips.addDeckNpc(
      zenith, SPENCER_BRENTWOOD_NPC_ID, SPENCER_DECK_X, SPENCER_DECK_Y, player
    ) ?? null;
  }

  function syncPirates(player, state, stage) {
    const wanted = stage >= STAGE_KILL_PIRATES && stage < STAGE_PIRATES_DEAD;
    if (!wanted) {
      for (const npc of state.pirates) api.removeNpc(npc);
      state.pirates = [];
      return;
    }
    if (state.pirates.length === PIRATE_TILES.length) return;
    for (const npc of state.pirates) api.removeNpc(npc);
    state.pirates = PIRATE_TILES.map((tile, index) =>
      api.spawnNpc({
        id: PIRATE_NPC_IDS[index % PIRATE_NPC_IDS.length],
        x: tile.x,
        y: tile.y,
        z: 0,
        wanderRadius: 0,
        owner: player,
        ownerOnly: true,
      })
    ).filter(Boolean);
  }

  /** Keeps each player's quest NPCs in step with their stage (call on change/login). */
  function ensureSpawns(player) {
    if (!player || player.isPlayerBot?.() === true || !quest) return;
    const stage = quest.getStage(player);
    const state = questSpawns.get(player) ?? {
      floopa: null,
      spencer: null,
      spencerDeck: null,
      pirates: [],
      bethel: null,
      lobster: null,
    };
    questSpawns.set(player, state);

    let floopa = null;
    if (stage >= STAGE_FLOOPA_FOUND && stage < STAGE_RED_ROCK) {
      floopa = { id: FLOOPA_GROVE_NPC_ID, ...FLOOPA_GROVE_TILE };
    } else if (stage >= STAGE_RETURN_FLOOPA && stage < STAGE_COMPLETE) {
      floopa = { id: FLOOPA_HOUSE_NPC_ID, ...FLOOPA_HOUSE_TILE };
    }
    syncSpawn(player, state, "floopa", floopa);

    syncPirateShips(player, stage);
    syncZenith(player, stage);
    const zenith = ownedShips(player).get(ZENITH_SHIP_ID);

    // The stage-30 diving Spencer (15018/15020) is a transition add that the capture deletes
    // when trr becomes 32; stage 32 is repaired by the object click, so spawn no A NPC here.
    let spencer = null;
    if (stage >= STAGE_DREDGER_AGAIN && stage < STAGE_SURFACE_PLAN) {
      spencer = { id: SPENCER_DIVING_B_NPC_ID, ...SPENCER_DIVING_B_TILE };
    }
    syncSpawn(player, state, "spencer", spencer);
    syncDeckSpencer(player, state, stage, zenith);

    syncPirates(player, state, stage);

    const bethel =
      stage >= STAGE_PIRATES_DEAD && stage < STAGE_BETHEL_DEAD
        ? { id: BLACK_EYE_BETHEL_NPC_ID, ...BETHEL_TILE }
        : null;
    syncSpawn(player, state, "bethel", bethel);
  }

  function spawnLobster(player) {
    const state = questSpawns.get(player);
    if (!state || state.lobster) return;
    state.lobster = api.spawnNpc({
      id: GIANT_LOBSTER_NPC_ID,
      x: LOBSTER_TILE.x,
      y: LOBSTER_TILE.y,
      z: LOBSTER_TILE.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
  }

  function clearSpawns(player) {
    const state = questSpawns.get(player);
    if (state) {
      for (const key of ["floopa", "spencer", "spencerDeck", "bethel", "lobster"]) {
        if (state[key]) api.removeNpc(state[key]);
      }
      for (const npc of state.pirates) api.removeNpc(npc);
      questSpawns.delete(player);
    }
    disposeAllOwnedShips(player);
  }

  // ==========================================================================
  // Variant selection
  // ==========================================================================

  function raleyVariant(player) {
    const stage = quest.getStage(player);
    if (stage <= 0) {
      return meetsRequirements(player) ? "starting-out-talking-to-elder-raley" : null;
    }
    if (stage < STAGE_FLOOPA_FOUND) return "the-search-for-floopa-talking-to-elder-raley-again";
    if (stage >= STAGE_RETURN_FLOOPA && stage < STAGE_COMPLETE) {
      return "back-on-the-great-conch-talking-to-floopa-and-elder-raley";
    }
    if (stage < STAGE_COMPLETE) return "the-search-for-floopa-talking-to-elder-raley-after-finding-floopa";
    return null; // post-quest: the Elder Raley page's standard dialogue
  }

  function floopaVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_FLOOPA_FOUND && stage < STAGE_RED_ROCK) {
      return "the-search-for-floopa-talking-to-floopa";
    }
    if (stage >= STAGE_RED_ROCK && stage < STAGE_MEETING_READY) {
      return "the-search-for-floopa-talking-to-floopa-again";
    }
    if (stage >= STAGE_RETURN_FLOOPA && stage < STAGE_COMPLETE) {
      return "back-on-the-great-conch-talking-to-floopa-and-elder-raley";
    }
    return null;
  }

  function receptionistVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_MEETING_ARRANGED) {
      if (stage < STAGE_MEETING_READY) quest.setStage(player, STAGE_MEETING_READY);
      quest.setStage(player, STAGE_MEETING_ARRANGED);
      return "on-red-rock-talking-to-the-receptionist";
    }
    if (stage < STAGE_DISPLAYS) {
      return "on-red-rock-before-looking-at-all-four-display-cases";
    }
    if (stage < STAGE_COMPLETE) {
      return "on-red-rock-after-looking-at-all-four-display-cases";
    }
    return null;
  }

  function paxtonVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_DISPLAYS || stage >= STAGE_COMPLETE) {
      // Theodore owns this dismissal at every pre-meeting stage, and the page has no
      // post-quest variant; returning null here would make NpcDialogues fall back to
      // the page's first variant, where Elder Raley speaks instead.
      return "on-red-rock-talking-to-theodore-paxton-before-talking-to-the-receptionist";
    }
    if (stage === STAGE_DISPLAYS) {
      quest.setStage(player, STAGE_PAXTON_TASKED);
      return "on-red-rock-talking-to-theodore-paxton";
    }
    if (stage < STAGE_BETHEL_DEAD) {
      return "on-red-rock-talking-to-theodore-paxton-again";
    }
    if (stage < STAGE_ZENITH_KNOWN) {
      quest.setStage(player, STAGE_ZENITH_KNOWN);
      return "back-on-red-rock-talking-to-theodore-paxton";
    }
    if (stage < STAGE_ABOARD_ZENITH) {
      return "back-on-red-rock-talking-to-theodore-paxton-again";
    }
    return null;
  }

  function spencerVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_ZENITH_KNOWN && stage < STAGE_ABOARD_ZENITH) {
      quest.setStage(player, STAGE_ABOARD_ZENITH);
      return "aboard-the-zenith-talking-to-spencer-brentwood";
    }
    if (stage === STAGE_ABOARD_ZENITH) {
      return "aboard-the-zenith-talking-to-spencer-again";
    }
    if (stage >= STAGE_SURFACE_PLAN && stage < STAGE_RETURN_FLOOPA) {
      return "back-on-the-surface-talking-to-spencer";
    }
    // The surface-plan conversation ends at stage 40; talking to Spencer on the Zenith
    // again uses the captured aboard variant, whose "Actually, I'd like to disembark."
    // choice is handled below through the normal StaticShips return trip.
    if (stage === STAGE_RETURN_FLOOPA) {
      return "aboard-the-zenith-talking-to-spencer-again";
    }
    return null;
  }

  function divingSpencerVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_DIVING || stage >= STAGE_SURFACE_PLAN) return null;
    if (stage < STAGE_DREDGER_AGAIN) return "underwater-talking-to-spencer";
    if (stage < STAGE_REPORT_EAST) return "underwater-talking-to-spencer-again-before-fixing-the-dredger";
    return "underwater-returning-to-spencer";
  }

  function selectVariant({ npcId, player }) {
    if (npcId === ELDER_RALEY_NPC_ID) return raleyVariant(player);
    if (npcId === ELDER_KATT_NPC_ID) {
      const stage = quest.getStage(player);
      if (stage >= STAGE_GROVE_KNOWN && stage < STAGE_FLOOPA_FOUND) {
        if (stage === STAGE_GROVE_KNOWN) quest.setStage(player, STAGE_GROVE_ACCESS);
        return "the-search-for-floopa-talking-to-elder-katt";
      }
      return null;
    }
    if (npcId === FLOOPA_GROVE_NPC_ID || npcId === FLOOPA_HOUSE_NPC_ID) return floopaVariant(player);
    if (npcId === RECEPTIONIST_NPC_ID) return receptionistVariant(player);
    if (npcId === THEODORE_PAXTON_NPC_ID) return paxtonVariant(player);
    if (npcId === SPENCER_BRENTWOOD_NPC_ID) return spencerVariant(player);
    if (npcId === SPENCER_DIVING_A_NPC_ID || npcId === SPENCER_DIVING_B_NPC_ID) {
      return divingSpencerVariant(player);
    }
    if (FLOOPA_SEARCH_VARIANTS.has(npcId)) {
      const stage = quest.getStage(player);
      if (stage >= STAGE_STARTED && stage < STAGE_GROVE_KNOWN) {
        if (stage === STAGE_STARTED) quest.setStage(player, STAGE_GROVE_KNOWN);
        return FLOOPA_SEARCH_VARIANTS.get(npcId);
      }
      return null;
    }
    return null;
  }

  // ==========================================================================
  // Prose conditions
  // ==========================================================================

  function answerCondition(event) {
    const { player, stepId, pages } = event;
    if (Array.isArray(pages) && pages.length > 0 && !pages.some((entry) => entry.page === PAGE)) {
      return null;
    }
    if (NO_DIVING_GEAR_CONDITION_IDS.has(stepId)) {
      // BOlODW/VE5dY_ give the equipment: only when there is room for both items.
      if (stepId === "x3HLXd") return !hasDivingGear(player);
      return !hasDivingGear(player) && freeSlots(player) >= 2;
    }
    if (HAS_DIVING_GEAR_CONDITION_IDS.has(stepId)) return hasDivingGear(player);
    if (stepId === GEAR_IN_INVENTORY_CONDITION_ID) {
      return carryingDivingGear(player) && !wearingDivingGear(player);
    }
    if (stepId === WEARING_GEAR_CONDITION_ID) return wearingDivingGear(player);
    if (NO_GEAR_NO_SPACE_CONDITION_IDS.has(stepId)) {
      if (!hasDivingGear(player) && freeSlots(player) < 2) {
        player.sendMessage("You need two free inventory slots to take the diving equipment.");
      }
      return false;
    }
    if (stepId === FINALE_NO_SPACE_CONDITION_ID) return freeSlots(player) < 1;
    if (stepId === NO_DRAGON_SCIMITAR_CONDITION_ID) return !wearingDragonScimitar(player);
    if (stepId === HAS_DRAGON_SCIMITAR_CONDITION_ID) return wearingDragonScimitar(player);
    return null;
  }

  // ==========================================================================
  // Dialogue events
  // ==========================================================================

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== ELDER_RALEY_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) !== 0) return;
    if (!meetsRequirements(player)) {
      player.sendMessage(
        "You need level 52 Sailing, level 48 Smithing and completion of Troubled Tortugans to start this quest."
      );
      return;
    }
    quest.setStage(player, STAGE_STARTED);
  }

  function handleChoice(event) {
    if (event.npcId !== SPENCER_BRENTWOOD_NPC_ID) return;
    const { player } = event;
    const option = String(event.option ?? "").trim();
    if (option === ZENITH_DISEMBARK_OPTION) {
      const stage = quest.getStage(player);
      if (stage < STAGE_ZENITH_KNOWN || stage >= STAGE_COMPLETE) return;
      const zenith = ownedShips(player).get(ZENITH_SHIP_ID);
      if (!zenith || player.getArea?.()?.boat !== zenith.boat) return;
      sendDiving(player, 0);
      StaticShips.leave(player);
      return;
    }
    if (option !== DIVE_CONFIRM_OPTION) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_ABOARD_ZENITH || stage >= STAGE_DIVING) return;
    const zenith = ownedShips(player).get(ZENITH_SHIP_ID);
    if (zenith && player.getArea?.()?.boat === zenith.boat) player.getArea().leave(player, false);
    player.moveTo(new Location(SEABED_DIVE_TILE.x, SEABED_DIVE_TILE.y, SEABED_DIVE_TILE.z));
    quest.setStage(player, STAGE_DIVING);
    sendDiving(player, 1);
  }

  function handleDialogueLine(event) {
    const { player } = event;
    if (event.npcId === SPENCER_BRENTWOOD_NPC_ID) {
      if (event.text === SURFACE_PLAN_LAST_LINE && quest.getStage(player) === STAGE_SURFACE_PLAN) {
        quest.setStage(player, STAGE_RETURN_FLOOPA);
      }
      return;
    }
    if (event.npcId === ELDER_KATT_NPC_ID) {
      if (
        quest.getStage(player) === STAGE_GROVE_ACCESS &&
        String(event.text).includes("you may head on in")
      ) {
        quest.setStage(player, STAGE_FLOOPA_FOUND);
        ensureSpawns(player);
      }
      return;
    }
    if (event.npcId === FLOOPA_GROVE_NPC_ID) {
      if (quest.getStage(player) === STAGE_FLOOPA_FOUND && String(event.text).includes("Good luck")) {
        quest.setStage(player, STAGE_RED_ROCK);
      }
      return;
    }
    if (event.npcId !== ELDER_RALEY_NPC_ID && event.npcId !== FLOOPA_HOUSE_NPC_ID) return;
    if (event.text !== FINALE_GIFT_LINE) return;
    if (quest.getStage(player) === STAGE_RETURN_FLOOPA && freeSlots(player) >= 1) {
      finaleRewardPending.add(player);
    }
  }

  function handleAction(event) {
    const { player, npcId, stepId, step } = event;
    if (!player) return;
    if (
      step?.type === "end" &&
      finaleRewardPending.has(player) &&
      quest.getStage(player) === STAGE_RETURN_FLOOPA &&
      (npcId === ELDER_RALEY_NPC_ID || npcId === FLOOPA_HOUSE_NPC_ID)
    ) {
      finaleRewardPending.delete(player);
      event.handled = true;
      event.end = true;
      if (!quest.isComplete(player)) quest.complete(player);
      return;
    }
    if (!stepId) return;
    if (GIVE_DIVING_GEAR_ACTION_IDS.has(stepId)) {
      if (npcId !== SPENCER_BRENTWOOD_NPC_ID) return;
      grantDivingEquipment(player);
      return;
    }
    if (stepId === SHIPS_SUNK_MESSAGE_ID) {
      if (quest.getStage(player) >= STAGE_PAXTON_TASKED && quest.getStage(player) < STAGE_SHIPS_SUNK) {
        quest.setStage(player, STAGE_SHIPS_SUNK);
      }
      return;
    }
    if (stepId === REPAIR_DREDGER_MESSAGE_ID) {
      if (quest.getStage(player) !== STAGE_DREDGER_AGAIN) return;
      const state = questSpawns.get(player);
      if (state?.lobster) {
        api.removeNpc(state.lobster);
        state.lobster = null;
      }
      quest.setStage(player, STAGE_REPORT_EAST);
      return;
    }
    if (stepId === SURFACE_RETURN_MESSAGE_ID) {
      if (quest.getStage(player) !== STAGE_REPORT_EAST) return;
      const zenith = ownedShips(player).get(ZENITH_SHIP_ID);
      if (zenith) {
        api.core.BoatManager.getDeck(zenith.boat)?.enter(player);
        const tile = zenith.spec.boardingTile;
        player.moveTo(StaticShips.deckLocation(zenith, tile.x, tile.y));
      } else {
        player.moveTo(
          new Location(SPENCER_SURFACE_TILE.x, SPENCER_SURFACE_TILE.y, SPENCER_SURFACE_TILE.z)
        );
      }
      quest.setStage(player, STAGE_SURFACE_PLAN);
      sendDiving(player, 0);
      return;
    }
    if (stepId === COMPLETE_ACTION_ID) {
      if (npcId !== ELDER_RALEY_NPC_ID && npcId !== FLOOPA_HOUSE_NPC_ID) return;
      event.handled = true;
      event.end = true;
      if (!quest.isComplete(player)) quest.complete(player);
    }
  }

  // ==========================================================================
  // World interactions
  // ==========================================================================

  function atLastLightDoor(location) {
    return !!location
      && location.getX() === LAST_LIGHT_DOOR_TILE.x
      && location.getY() === LAST_LIGHT_DOOR_TILE.y
      && location.getZ() === LAST_LIGHT_DOOR_TILE.z;
  }

  /** The capture's raw client states, in both directions, over normal packets. */
  function sendLastLightDoorState(player, open) {
    const sender = player.getPacketSender();
    const location = new Location(LAST_LIGHT_DOOR_TILE.x, LAST_LIGHT_DOOR_TILE.y, LAST_LIGHT_DOOR_TILE.z);
    const raw = (id) => new api.core.GameObject(id, location.clone(), 0, 0, null);
    if (open) {
      sender.sendObjectRemoval(raw(LAST_LIGHT_DOORWAY_OBJECT_ID));
      sender.sendObject(raw(LAST_LIGHT_INVISWALL_OBJECT_ID));
      sender.sendObject(raw(LAST_LIGHT_DOORWAY_OPEN_OBJECT_ID));
    } else {
      sender.sendObjectRemoval(raw(LAST_LIGHT_INVISWALL_OBJECT_ID));
      sender.sendObjectRemoval(raw(LAST_LIGHT_DOORWAY_OPEN_OBJECT_ID));
      sender.sendObject(raw(LAST_LIGHT_DOORWAY_OBJECT_ID));
    }
  }

  function closeLastLightDoorLater(player, key) {
    const task = new api.core.Task(LAST_LIGHT_DOOR_OPEN_TICKS, key);
    task.execute = () => {
      task.stop();
      sendLastLightDoorState(player, false);
      const state = lastLightDoorCrossings.get(player);
      if (state?.key === key) lastLightDoorCrossings.delete(player);
    };
    api.core.TaskManager.submit(task);
  }

  /**
   * The captured threshold walk, like the AlKharid gate / wall-door helper: claim the click,
   * show the two open locs, then have the agility runner walk the player one tile through the
   * closed leaf's clipping (the client draws a normal walk). The server keeps the wall's
   * clipping, so this permission is scoped to the crossing player and is never a global open.
   */
  function crossLastLightDoor(event) {
    const { player } = event;
    const location = event.object?.getLocation?.() ?? event.location;
    if (!atLastLightDoor(location)) return false;
    const from = player.getLocation();
    if (from.getZ() !== LAST_LIGHT_DOOR_TILE.z) return false;
    if (Math.abs(from.getX() - LAST_LIGHT_DOOR_TILE.x) > 1
      || Math.abs(from.getY() - LAST_LIGHT_DOOR_TILE.y) > 1) return false;
    if (lastLightDoorCrossings.has(player) || ObstacleRunner.isBusy(player)) return true;
    const door = event.object
      ?? api.core.MapObjects.get(
        LAST_LIGHT_DOORWAY_OBJECT_ID,
        new Location(LAST_LIGHT_DOOR_TILE.x, LAST_LIGHT_DOOR_TILE.y, LAST_LIGHT_DOOR_TILE.z),
        player.getPrivateArea?.() ?? null
      );
    const crossing = crossingFor(door, from);
    if (!crossing) return false;
    event.handled = true;
    const key = `red-reef:last-light-door:${player.getIndex()}`;
    lastLightDoorCrossings.set(player, { key, destination: crossing.destination });
    sendLastLightDoorState(player, true);
    closeLastLightDoorLater(player, key);
    // Leading wait: one tile per tick, as the captured walk, and the runner cancels on logout.
    const task = ObstacleRunner.run({ player, object: door }, [{ wait: 1 }, { walk: [[crossing.destination.x, crossing.destination.y]] }], {
      onFinish: () => {
        const state = lastLightDoorCrossings.get(player);
        if (state?.key === key) lastLightDoorCrossings.delete(player);
      },
    });
    const state = lastLightDoorCrossings.get(player);
    if (state?.key === key) state.task = task;
    return true;
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (objectId === LAST_LIGHT_DOORWAY_OBJECT_ID && crossLastLightDoor(event)) return;
    const varbit = DISPLAY_CASE_VARBITS.get(objectId);
    if (varbit !== undefined) {
      event.handled = true;
      const stage = quest.getStage(player);
      if (stage < STAGE_MEETING_ARRANGED || stage >= STAGE_DISPLAYS) return;
      const index = DISPLAY_CASE_IDS.indexOf(objectId);
      if (index < 0) return;
      markDisplayCase(player, index);
      openDisplayCase(player, DISPLAY_CASES[index]);
      if (displayCasesDone(player)) quest.setStage(player, STAGE_DISPLAYS);
      return;
    }
    const currentObjectId = event.definition?.id
      ?? api.core.ObjectDefinition.forPlayer?.(objectId, player)?.getId?.()
      ?? objectId;
    if (objectId !== CORAL_DREDGER_REPAIR_OBJECT_ID
      && objectId !== CORAL_DREDGER_BASE_OBJECT_ID
      && currentObjectId !== CORAL_DREDGER_REPAIR_OBJECT_ID) return;
    event.handled = true;
    const stage = quest.getStage(player);
    if (stage < STAGE_DIVING || stage > STAGE_DREDGER_AGAIN) return;
    if (stage === STAGE_DIVING) {
      player.sendMessage("A giant lobster attacks you!");
      spawnLobster(player);
      return;
    }
    startTranscript(api, player, SPENCER_BRENTWOOD_NPC_ID, PAGE, REPAIR_DREDGER_VARIANT);
  }

  /** Opens the captured display-case interface 400 and runs its 8565 renderer. */
  function openDisplayCase(player, display) {
    if (!display) return;
    const sender = player.getPacketSender();
    sender.sendInterfaceScript(2524, [-1, -1]);
    sender.sendInterface(400);
    sender.sendInterfaceScript(8565, [display.title, display.model, display.prose, -5, display.height, 57, 1938, 0, 320, 0]);
  }

  function handleNpcDeath(event) {
    const { npc, killer } = event;
    if (!npc || !killer || killer.isPlayer?.() !== true) return;
    const state = questSpawns.get(killer);
    if (!state) return;
    if (state.bethel && state.bethel === npc) {
      state.bethel = null;
      bethelFights.delete(killer);
      if (quest.getStage(killer) === STAGE_PIRATES_DEAD) {
        quest.setStage(killer, STAGE_BETHEL_DEAD);
      }
      return;
    }
    const index = state.pirates.indexOf(npc);
    if (index !== -1) {
      state.pirates.splice(index, 1);
      if (state.pirates.length === 0 && quest.getStage(killer) === STAGE_KILL_PIRATES) {
        quest.setStage(killer, STAGE_PIRATES_DEAD);
        ensureSpawns(killer);
      }
      return;
    }
    if (state.lobster && state.lobster === npc) {
      state.lobster = null;
      if (quest.getStage(killer) === STAGE_DIVING) quest.setStage(killer, STAGE_DREDGER_AGAIN);
    }
  }

  /** Owner-private pirate ship sunk by the player's cannon (Sailing ShipCombat event). */
  function handleShipSunk(event) {
    const { player, ship } = event;
    if (!player || !ship || quest.getStage(player) !== STAGE_PAXTON_TASKED) return;
    const index = PIRATE_SHIP_IDS.indexOf(ship.id);
    if (index < 0 || ship.boat?.ownerPlayerId !== player.getIndex()) return;
    const bit = 1 << index;
    const mask = sunkMask(player);
    if ((mask & bit) !== 0) return;
    const next = mask | bit;
    setSunkMask(player, next);
    ownedShips(player).delete(ship.id);
    StaticShips.dispose(ship); // ShipCombat also disposes; this keeps the event self-contained.
    if (next === (1 << PIRATE_SHIP_IDS.length) - 1) {
      startTranscript(api, player, BLACK_EYE_BETHEL_NPC_ID, PAGE, SHIPS_SUNK_VARIANT);
      if (quest.getStage(player) < STAGE_SHIPS_SUNK) quest.setStage(player, STAGE_SHIPS_SUNK);
    }
    ensureSpawns(player);
  }

  function handlePlayerDeath({ player }) {
    if (!player) return;
    StaticShips.forget(player);
    playerShips.delete(player);
    questSpawns.delete(player);
    api.core.TaskManager.submit(new api.core.CountdownTask(player, 1, () => {
      if (player.isRegistered?.() !== false) ensureSpawns(player);
    }));
  }

  // ==========================================================================
  // Bethel: sweep, scimitar switches and the dragon scimitar special
  // ==========================================================================

  const bethelFights = new WeakMap();

  function bethelState(player) {
    let fight = bethelFights.get(player);
    if (!fight) {
      fight = { ticks: 0, phase: 0, specialUsed: false, sweepAt: 0 };
      bethelFights.set(player, fight);
    }
    return fight;
  }

  function handleBethelProcess(player) {
    if (!quest || quest.getStage(player) !== STAGE_PIRATES_DEAD) return;
    const state = questSpawns.get(player);
    const npc = state?.bethel;
    if (!npc || npc.removed || (npc.getHitpoints?.() ?? 0) <= 0) return;
    const fight = bethelState(player);
    fight.ticks++;
    const max = npc.getMaxHitpoints?.() ?? npc.getDefinition?.()?.getHitpoints?.() ?? 180;
    const ratio = (npc.getHitpoints?.() ?? max) / max;
    if (fight.phase === 0 && ratio <= 0.66) {
      fight.phase = 1;
      npc.forceChat("Let's see if you can handle this!");
      npc.performAnimation(new api.core.Animation(BETHEL_RAMPAGE_ANIM));
      npc.performGraphicInSlot?.(2, new api.core.Graphic(BETHEL_RUNE_GLOW));
      return;
    }
    if (fight.phase === 1 && ratio <= 0.33) {
      fight.phase = 2;
      npc.forceChat(wearingDragonScimitar(player) ? "Nice scimitar! I've got one too!" : "I stole this one from a monkey!");
      npc.performAnimation(new api.core.Animation(BETHEL_RAMPAGE_ANIM));
      npc.performGraphicInSlot?.(2, new api.core.Graphic(BETHEL_DRAGON_GLOW));
      return;
    }
    if (fight.phase === 2 && !fight.specialUsed && ratio <= 0.2) {
      fight.specialUsed = true;
      npc.forceChat(BETHEL_SPECIAL_LINES[Math.floor(Math.random() * BETHEL_SPECIAL_LINES.length)]);
      npc.performAnimation(new api.core.Animation(BETHEL_DRAGON_SPECIAL_ANIM));
      npc.performGraphicInSlot?.(2, new api.core.Graphic(BETHEL_DRAGON_SPECIAL_GFX));
      for (const prayer of [
        api.core.PrayerHandler.PROTECT_FROM_MAGIC,
        api.core.PrayerHandler.PROTECT_FROM_MISSILES,
        api.core.PrayerHandler.PROTECT_FROM_MELEE,
      ]) {
        api.core.PrayerHandler.deactivatePrayer(player, prayer);
      }
      player.sendMessage("<col=ff3045>Your protection prayers have been disabled!</col>");
      return;
    }
    if (fight.sweepAt !== 0) return;
    if (fight.ticks % 9 !== 0) return;
    fight.sweepAt = fight.ticks;
    npc.forceChat(BETHEL_SWEEP_LINES[Math.floor(Math.random() * BETHEL_SWEEP_LINES.length)]);
    npc.performAnimation(new api.core.Animation(BETHEL_CHARGE_ANIM));
    const target = player.getLocation().clone();
    api.core.TaskManager.submit(
      new api.core.CountdownTask(player, 2, () => {
        fight.sweepAt = 0;
        if (!npc.isRegistered?.() || (npc.getHitpoints?.() ?? 0) <= 0) return;
        if (player.getLocation().getDistance(target) > 1) {
          player.sendMessage("You dodge out of the way of Bethel's sweep.");
          return;
        }
        const hits = [18 + Math.floor(Math.random() * 10), 18 + Math.floor(Math.random() * 10)];
        player.getCombat().getHitQueue().addPendingDamage(
          hits.map((damage) => new api.core.HitDamage(damage, api.core.HitMask.RED).setSource(npc))
        );
      })
    );
  }

  class BethelArea extends api.core.Area {
    process(mobile) {
      if (mobile.isPlayer?.()) handleBethelProcess(mobile);
    }
  }

  function handleRedRockEnter({ player }) {
    if (!quest || quest.isComplete(player)) return;
    const stage = quest.getStage(player);
    if (stage >= STAGE_FLOOPA_FOUND && stage < STAGE_MEETING_READY) {
      quest.setStage(player, STAGE_MEETING_READY);
      ensureSpawns(player);
    }
  }

  function handleLastLightEnter({ player }) {
    if (!quest || quest.isComplete(player)) return;
    const stage = quest.getStage(player);
    if (stage === STAGE_PAXTON_TASKED && !player.getAttribute(NAVAL_STARTED_ATTRIBUTE)) {
      player.setAttribute(NAVAL_STARTED_ATTRIBUTE, true);
      startTranscript(api, player, BLACK_EYE_BETHEL_NPC_ID, PAGE, APPROACHING_LAST_LIGHT_VARIANT);
    }
    // Stage 20 is "on the boat with the crews beaten": only landing on foot moves on.
    if (stage === STAGE_SHIPS_SUNK && !player.getArea()?.boat) {
      quest.setStage(player, STAGE_KILL_PIRATES);
      player.sendMessage("You disembark at Last Light.");
    }
    ensureSpawns(player);
  }

  function handleMapSquareChange({ player }) {
    if (!quest || quest.isComplete(player)) return;
    const location = player.getLocation();
    if (
      quest.getStage(player) === STAGE_SHIPS_SUNK &&
      !player.getArea()?.boat &&
      location.getX() >= LAST_LIGHT_ZONE.minX && location.getX() <= LAST_LIGHT_ZONE.maxX &&
      location.getY() >= LAST_LIGHT_ZONE.minY && location.getY() <= LAST_LIGHT_ZONE.maxY
    ) {
      quest.setStage(player, STAGE_KILL_PIRATES);
      player.sendMessage("You disembark at Last Light.");
      ensureSpawns(player);
    }
  }

  function handleStageChanged(event) {
    if (!event || event.key !== "the_red_reef" || !event.player) return;
    event.player.setAttribute(VERSION_ATTRIBUTE, VERSION);
    ensureSpawns(event.player);
  }

  function handleLogin({ player }) {
    migrate(player);
    // Old saves stored the sunk count, not the per-ship mask.
    if (!player.getAttribute(PIRATE_SUNK_ATTRIBUTE)) {
      const old = Number(player.getAttribute(PIRATE_SHIPS_ATTRIBUTE)) || 0;
      if (old > 0) player.setAttribute(PIRATE_SUNK_ATTRIBUTE, old >= 2 ? 3 : 1);
    }
    if (quest.getStage(player) === STAGE_PAXTON_TASKED && pirateShips(player) >= 2) {
      quest.setStage(player, STAGE_SHIPS_SUNK);
    }
    player.getPacketSender().sendVarbit(PIRATE_SHIPS_VARBIT, pirateShips(player));
    if (quest.getStage(player) >= STAGE_MEETING_ARRANGED) sendDisplayCaseVarps(player);
    ensureSpawns(player);
    refreshQuestList(player);
    syncDivingState(player);
  }

  /** Old unversioned saves used 16..30 for the same nodes; move them onto the captured scale. */
  function migrate(player) {
    if ((Number(player.getAttribute(VERSION_ATTRIBUTE)) || 0) >= VERSION) return;
    const stage = quest.getStage(player);
    const mapped = OLD_STAGE_MAP.get(stage);
    if (mapped !== undefined) quest.setStage(player, mapped);
    player.setAttribute(VERSION_ATTRIBUTE, VERSION);
  }

  function handleLogout({ player }) {
    const doorCrossing = lastLightDoorCrossings.get(player);
    if (doorCrossing) {
      api.core.TaskManager.cancelTasks(doorCrossing.key);
      doorCrossing.task?.stop();
      lastLightDoorCrossings.delete(player);
    }
    finaleRewardPending.delete(player);
    clearSpawns(player);
    playerShips.delete(player);
  }

  // ==========================================================================
  // Journal and reward
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Floopa had wandered off from the Great Conch and I found her in the Sacred Grove.</str>",
        "<str>I infiltrated the Red Reef Trading Company and dealt with Black Eye Bethel.</str>",
        "<str>I helped Spencer Brentwood repair his coral dredgers and learned of his plans for the Pearl Bank.</str>",
        "<str>I told Floopa and Elder Raley what I had learned so we can plan our next move.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_RETURN_FLOOPA) {
      return [
        "Spencer wants the Tortugans off the Little Pearl so he can harvest a reef in the Pearl Bank.",
        "I should return to the <col=800000>Great Conch</col> and tell <col=800000>Floopa</col> and",
        "<col=800000>Elder Raley</col> what I have learned.",
      ];
    }
    if (stage >= STAGE_SURFACE_PLAN) {
      return [
        "Spencer revealed that the Red Reef is running out of red coral and that he plans to",
        "harvest a reef in the <col=800000>Pearl Bank</col> near the Little Pearl.",
        "I should report back to <col=800000>Red Rock</col> once I have a plan.",
      ];
    }
    if (stage >= STAGE_FIXING_DREDGER) {
      return [
        "I dived to the seabed with <col=800000>Spencer</col> and helped repair the coral dredgers.",
        "A <col=800000>giant lobster</col> appeared while I worked on the northern dredger.",
        stage >= STAGE_REPORT_EAST
          ? "I should speak to <col=800000>Spencer</col> at the eastern dredger."
          : "I should repair the northern <col=800000>coral dredger</col>.",
      ];
    }
    if (stage >= STAGE_DIVING) {
      return [
        "<str>I sailed to the Zenith and met Spencer Brentwood.</str>",
        "I am diving on the seabed with <col=800000>Spencer</col>.",
        "I should listen to what he has to say.",
      ];
    }
    if (stage >= STAGE_ZENITH_KNOWN) {
      return [
        "<str>I dealt with Black Eye Bethel for Theodore Paxton.</str>",
        "Paxton's boss, <col=800000>Spencer Brentwood</col>, has work for me aboard his ship,",
        "the <col=800000>Zenith</col>, somewhere in the middle of the Red Reef.",
      ];
    }
    if (stage >= STAGE_BETHEL_DEAD) {
      return [
        "<str>I defeated the pirates and Black Eye Bethel at Last Light.</str>",
        "I should return to <col=800000>Theodore Paxton</col> on <col=800000>Red Rock</col>.",
      ];
    }
    if (stage >= STAGE_PIRATES_DEAD) {
      return [
        "<str>I docked at Last Light and defeated the pirates.</str>",
        "I should climb the lighthouse and deal with <col=800000>Black Eye Bethel</col>.",
      ];
    }
    if (stage >= STAGE_KILL_PIRATES) {
      return [
        "<str>The pirate ships were destroyed when I approached Last Light.</str>",
        "I should defeat the <col=800000>pirates</col> on the island.",
      ];
    }
    if (stage >= STAGE_SHIPS_SUNK) {
      return [
        "<str>Theodore Paxton asked me to deal with Black Eye Bethel.</str>",
        "<str>The pirate ships were destroyed when I approached Last Light.</str>",
        "I should dock at <col=800000>Last Light</col> and defeat the pirates.",
      ];
    }
    if (stage >= STAGE_PAXTON_TASKED) {
      return [
        "<str>I infiltrated the Red Reef Trading Company on Red Rock.</str>",
        "I spoke to <col=800000>Theodore Paxton</col>, who asked me to sail to",
        "<col=800000>Last Light</col> to deal with the pirate <col=800000>Black Eye Bethel</col>.",
      ];
    }
    if (stage >= STAGE_MEETING_ARRANGED) {
      return [
        "<str>The receptionist inspected my credentials and arranged a meeting with Theodore Paxton.</str>",
        "While I wait, I should inspect the <col=800000>display cases</col> around the room.",
        "Then I should speak to <col=800000>Theodore Paxton</col> in his office.",
      ];
    }
    if (stage >= STAGE_MEETING_READY) {
      return [
        "<str>Floopa asked me to investigate the Red Reef Trading Company.</str>",
        "I have arrived at <col=800000>Red Rock</col>. I should talk to the",
        "<col=800000>receptionist</col> and offer my services to the company.",
      ];
    }
    if (stage >= STAGE_RED_ROCK) {
      return [
        "<str>Floopa asked me to investigate the Red Reef Trading Company.</str>",
        "I should sail to <col=800000>Red Rock</col>, west of the Great Conch, and investigate the company.",
      ];
    }
    if (stage >= STAGE_FLOOPA_FOUND) {
      return [
        "<str>I found Floopa in the Sacred Grove and learned of her past with the Red Reef Trading Company.</str>",
        "I should sail to <col=800000>Red Rock</col>, west of the Great Conch, and investigate the company.",
      ];
    }
    if (stage >= STAGE_GROVE_ACCESS) {
      return [
        "<str>I asked around town and learned Floopa was heading to the Sacred Grove.</str>",
        "<str>Elder Katt let me into the Grove to look for her.</str>",
        "I should find <col=800000>Floopa</col> inside the <col=800000>Sacred Grove</col>.",
      ];
    }
    if (stage >= STAGE_GROVE_KNOWN) {
      return [
        "<str>Elder Raley asked me to find Floopa, who has wandered off.</str>",
        "I asked around town and was told she was heading towards the",
        "<col=800000>Sacred Grove</col> in the middle of the island.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>Elder Raley asked me to find Floopa, who has wandered off.</str>",
        "I should ask around town and see if anyone has seen her.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Elder Raley</col>",
      "at his home on the <col=800000>Great Conch</col>.",
      "",
      "I will need level 52 Sailing, level 48 Smithing and to have",
      "completed <col=800000>Troubled Tortugans</col>.",
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.SAILING, SAILING_XP);
    skills.addExperiences(Skill.SMITHING, SMITHING_XP);
  }

  quest = registerQuest(api, {
    key: "the_red_reef",
    name: "The Red Reef",
    varpId: VARP_THE_RED_REEF,
    varbitId: VARBIT_THE_RED_REEF,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.SAILING.getIndex(), amount: SAILING_XP, label: "Sailing" },
      { skillId: Skill.SMITHING.getIndex(), amount: SMITHING_XP, label: "Smithing" },
    ],
    rewardItemId: BOSUNS_WORKBENCH_SCHEMATIC_ITEM_ID,
    rewardItemLabel: "Bosun's workbench schematic",
    otherRewards: ["Access to the Sacred Grove", "Access to Red Rock (partial completion)"],
    buildJournal,
    onReward: grantReward,
  });

  api.persistAttribute(DISPLAY_CASE_ATTRIBUTE, 0);
  api.persistAttribute(PIRATE_SHIPS_ATTRIBUTE, 0);
  api.persistAttribute(PIRATE_SUNK_ATTRIBUTE, 0);
  api.persistAttribute(NAVAL_STARTED_ATTRIBUTE, false);
  api.persistAttribute(VERSION_ATTRIBUTE, 0);

  StaticShips.attach(api);
  ObstacleRunner.init(api);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerDeath(handlePlayerDeath);
  api.onCustomEvent("sailing:ship-sunk", handleShipSunk);
  api.onZoneEnter(RED_ROCK_ZONE, handleRedRockEnter);
  api.onZoneEnter(LAST_LIGHT_ZONE, handleLastLightEnter);
  api.onPlayerMapSquareChange(handleMapSquareChange);
  api.registerArea(new BethelArea([new api.core.Boundary(BETHEL_ZONE.minX, BETHEL_ZONE.maxX, BETHEL_ZONE.minY, BETHEL_ZONE.maxY, BETHEL_ZONE.level)]));
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
