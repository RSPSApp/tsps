/**
 * Olaf's Quest (members).
 *
 * The words come from the "Olaf's Quest" transcript page; this plugin supplies the
 * Olaf/Ingrid/Volf/Ulfric variant selectors, the prose-condition answers for the
 * present deliveries, the start hook, the windswept-tree chop and dig, the damp
 * planks/embers fire, the cache 253 picture-wall puzzle, the cache 252 rusty-gate
 * keyhole, the walkway barrel repairs, the chest/Ulfric encounter and the
 * completion reward.
 *
 * Stages (varbit 3534 "olaf_quest_var", varp 994 bits 0-10; cache lookup-gameval
 * and the OSRS Wiki Quest Helper stage keys): 10 asked for logs, 20 logs given /
 * delivering carvings, 30 both presents delivered, 40 damp planks given, 50 fire
 * lit, 60 Sven's map given, 70 inside the Brine Rat Cavern, 80 complete.
 * Quest Helper maps steps 10/20/30/40/50/60/70; the current cache completes at 80.
 * Sibling bits live in varps 995/996 (varbits 3535-3549), which this plugin
 * writes directly: 3535/3536 (carving deliveries), 3537 (fire multi-loc: 1 embers,
 * 0 fire), 3539 (Ulfric killed), 3541-3544 (the four skull disks), 3547/3548
 * (walkway sections repaired).
 *
 * Source: https://oldschool.runescape.wiki/w/Olaf%27s_Quest and its quick guide.
 * Rewards per the wiki: 1 Quest point, 12,000 Defence XP, 20,000 coins, 4 cut
 * rubies and a piece of parchment (11036).
 *
 * Picture wall (cache 253): the four disk models are re-angled with cache script
 * 233 (if_setmodel + if_setmodelangle) and the four lever components 8-11 plus the
 * confirm component 12 are dispatched as real interface buttons. The wiki order
 * right/up/left/down solves the initial state right=3, top=2, left=1, bottom=2
 * with one +1 turn per affected disk (4 = solved, wrapping 4 -> 1). That initial
 * state is also the one QH's PaintingWall solver walks from this state; it is
 * derived from the wiki controls, not a capture. Disk state is stored in the
 * persisted olafs-quest:wall attribute and replayed on login.
 *
 * Gate (cache 252): Open or use-key shows the five cache keyhole buttons (the
 * button models are the matching key item models, because the cache leaves the
 * keyhole models unset). The key used on the gate is the only accepted shape; the
 * matching key is consumed, the gate varbit 3545 is set, and the player crosses.
 * Closing and reopening keeps the key and permits a retry.
 *
 * Remaining approximations:
 * - the wall and gate are not object-swapped: after solving, searching the wall and
 *   opening the gate moves the player through, Clock Tower style;
 * - the slippery bridge fall chance is not rolled; the two walkway repair hotspots
 *   (23213/23214) are not reliably present for players, so they are ensured at the
 *   wiki tiles (2722/2724, 10168) at runtime and repaired with a barrel + three
 *   ropes, writing varbits 3547/3548 (the map is crossable either way);
 * - lighting the fire combines the planks-on-embers and tinderbox steps into one
 *   item-on-object action (both requirements are checked);
 * - Olaf's food option hands the map over without consuming a food item; if the
 *   central "below"-jump fix ever fails to play the confession tail, a plugin-side
 *   guard replays it so the map and stage 60 are never lost;
 * - Ulfric is a per-player owner-only spawn; the 4505 rise NPC only provides the
 *   chathead for the wiki lines.
 */
module.exports = function registerOlafsQuestQuest(api) {
  const {
    Animation,
    Item,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectDefinition,
    ObjectIdentifiers,
    Skill,
    Location,
  } = api.core;
  const { registerQuest, startTranscript, refreshQuestList } = require("../QuestRuntime");
  const woodcutting = require("../../skills/Woodcutting.plugin.js");

  // NPCs (cache names: olaf, olaf_volf, olaf_ingrid, olaf2_ulfric, olaf2_ulfric_rise).
  const OLAF_NPC_ID = NpcIdentifiers.OLAF_HRADSON; // 4488
  const VOLF_NPC_ID = NpcIdentifiers.VOLF_OLAFSON; // 4489
  const INGRID_NPC_ID = NpcIdentifiers.INGRID_HRADSON; // 4490
  const ULFRIC_NPC_ID = NpcIdentifiers.ULFRIC; // 4500
  const ULFRIC_RISE_NPC_ID = NpcIdentifiers.ULFRIC_2; // 4505
  const SKELETON_NPC_IDS = new Set([
    NpcIdentifiers.SKELETON_FREMENNIK, // 4491
    NpcIdentifiers.SKELETON_FREMENNIK_2, // 4492
    NpcIdentifiers.SKELETON_FREMENNIK_3, // 4493
    NpcIdentifiers.SKELETON_FREMENNIK_4, // 4494
    NpcIdentifiers.SKELETON_FREMENNIK_5, // 4495
    NpcIdentifiers.SKELETON_FREMENNIK_6, // 4496
    NpcIdentifiers.SKELETON_FREMENNIK_7, // 4497
    NpcIdentifiers.SKELETON_FREMENNIK_8, // 4498
    NpcIdentifiers.SKELETON_FREMENNIK_9, // 4499
  ]);

  // Objects (cache names: olaf_windswept_tree, olaf_multi_fire, olaf2_chest_closed,
  // olaf2_skull_puzzle_wall, olaf2_invis_hotspot_barrel1/2, olaf2_rusty_gate_puzzle).
  const WINDSWEPT_TREE_OBJECT_ID = ObjectIdentifiers.WINDSWEPT_TREE_2; // 18137
  const FIRE_OBJECT_ID = ObjectIdentifiers.FIRE_14; // 14169
  const OLAF_FIRE_BASE_OBJECT_ID = 14170; // fire pit, "Use-Logs" (no identifier)
  const EMBERS_OBJECT_ID = ObjectIdentifiers.EMBERS; // 14171
  const OLAF_MULTI_FIRE_OBJECT_ID = 14172; // multi-loc, no identifier
  const FIRE_OBJECT_IDS = new Set([
    FIRE_OBJECT_ID,
    OLAF_FIRE_BASE_OBJECT_ID,
    EMBERS_OBJECT_ID,
    OLAF_MULTI_FIRE_OBJECT_ID,
  ]);
  const CHEST_CLOSED_OBJECT_ID = ObjectIdentifiers.CHEST_54; // 14197
  const CHEST_OPEN_OBJECT_ID = ObjectIdentifiers.CHEST_53; // 14196
  const PICTURE_WALL_OBJECT_ID = ObjectIdentifiers.PICTURE_WALL; // 23156
  const CAVE_EXIT_OBJECT_IDS = new Set([
    ObjectIdentifiers.CAVE_37, // 23157
    ObjectIdentifiers.CAVE_38, // 23158
  ]);
  const WALKWAY_OBJECT_ID = ObjectIdentifiers.WALKWAY; // 23213
  const WALKWAY_2_OBJECT_ID = ObjectIdentifiers.WALKWAY_2; // 23214
  const WALKWAY_OBJECT_IDS = new Set([WALKWAY_OBJECT_ID, WALKWAY_2_OBJECT_ID]);
  const RUSTY_GATE_OBJECT_ID = ObjectIdentifiers.GATE_163; // 23216, "Open"

  // Items (cache names: olaf_woodplank, olaf_woodcarvinga/b, olaf_treasuremap,
  // olaf_windswept_logs, olaf2_gate_key_1..5, olaf2_walkway_repair_barrel[_inv]).
  const DAMP_PLANKS_ITEM_ID = ItemIdentifiers.DAMP_PLANKS; // 11031
  const CRUDE_CARVING_ITEM_ID = ItemIdentifiers.CRUDE_CARVING; // 11032
  const CRUDER_CARVING_ITEM_ID = ItemIdentifiers.CRUDER_CARVING; // 11033
  const SVENS_LAST_MAP_ITEM_ID = ItemIdentifiers.SVENS_LAST_MAP; // 11034
  const WINDSWEPT_LOGS_ITEM_ID = ItemIdentifiers.WINDSWEPT_LOGS; // 11035
  const PARCHMENT_ITEM_ID = ItemIdentifiers.PARCHMENT_2; // 11036
  // Cache names: olaf2_gate_key_1..5. The wiki names the shapes cross, square,
  // triangle, hexagon and star; the interface's fourth lock component is named
  // circle in the cache (it is the same fourth shape slot).
  const GATE_KEY_CROSS_ITEM_ID = ItemIdentifiers.KEY_12; // 11039, cross
  const GATE_KEY_SQUARE_ITEM_ID = ItemIdentifiers.KEY_13; // 11040, square
  const GATE_KEY_TRIANGLE_ITEM_ID = ItemIdentifiers.KEY_14; // 11041, triangle
  const GATE_KEY_CIRCLE_ITEM_ID = ItemIdentifiers.KEY_15; // 11042, hexagon/circle lock
  const GATE_KEY_STAR_ITEM_ID = ItemIdentifiers.KEY_16; // 11043, star
  const GATE_KEY_ITEM_IDS = [
    GATE_KEY_CROSS_ITEM_ID,
    GATE_KEY_SQUARE_ITEM_ID,
    GATE_KEY_TRIANGLE_ITEM_ID,
    GATE_KEY_CIRCLE_ITEM_ID,
    GATE_KEY_STAR_ITEM_ID,
  ];
  const ROTTEN_BARREL_ITEM_ID = ItemIdentifiers.ROTTEN_BARREL; // 11044
  const ROTTEN_BARREL_INV_ITEM_ID = ItemIdentifiers.ROTTEN_BARREL_2; // 11045
  const REPAIR_ROPE_ITEM_ID = ItemIdentifiers.ROPE_6; // 11046
  const ROPE_ITEM_ID = ItemIdentifiers.ROPE; // 954
  const TINDERBOX_ITEM_ID = ItemIdentifiers.TINDERBOX; // 590
  const SPADE_ITEM_ID = ItemIdentifiers.SPADE; // 952
  const BREAD_ITEM_ID = ItemIdentifiers.BREAD; // 2309
  const SHARK_ITEM_ID = ItemIdentifiers.SHARK; // 385
  const COINS_ITEM_ID = ItemIdentifiers.COINS; // 995
  const RUBY_ITEM_ID = ItemIdentifiers.RUBY; // 1603

  // Varbits of olaf_var (994) / olaf_extra_var (995) / olaf2_extra_var (996).
  const OLAF_STAGE_VARBIT = 3534; // varp 994 bits 0-10
  const OLAF_VOLF_VARBIT = 3535; // varp 995 bits 4-5
  const OLAF_INGRID_VARBIT = 3536; // varp 995 bits 2-3
  const OLAF_FIRE_VARBIT = 3537; // varp 995 bits 0-1: 1 embers, 0 fire
  const OLAF_KILLED_ULFRIC_VARBIT = 3539; // varp 995 bit 15
  const OLAF_TREASURE_VARBIT = 3540; // varp 995 bit 16
  const OLAF_RIGHT_DISK_VARBIT = 3541; // olaf2_gate_disk_1, varp 995 bits 17-19
  const OLAF_BOTTOM_DISK_VARBIT = 3542; // olaf2_gate_disk_2, varp 995 bits 20-22
  const OLAF_LEFT_DISK_VARBIT = 3543; // olaf2_gate_disk_3, varp 995 bits 23-25
  const OLAF_TOP_DISK_VARBIT = 3544; // olaf2_gate_disk_4, varp 995 bits 26-28
  const OLAF_GATE_COMPLETED_VARBIT = 3545; // varp 996 bit 1
  const OLAF_WALKWAY_1_VARBIT = 3547; // varp 996 bit 3
  const OLAF_WALKWAY_2_VARBIT = 3548; // varp 996 bit 4

  // Cache interfaces 252 (olaf2_lock_gate) and 253 (olaf2_skull_puzzle).
  const OLAF_GATE_INTERFACE_ID = 252;
  const OLAF_WALL_INTERFACE_ID = 253;
  const OLAF_GATE_KEY_COMPONENTS = [8, 14]; // olaf2_dummy_key / olaf_key_dummy
  // Component names from the cache: square/cross/triangle/circle/star lock buttons.
  const GATE_KEYHOLES = [
    { component: 9, itemId: GATE_KEY_SQUARE_ITEM_ID },
    { component: 10, itemId: GATE_KEY_CROSS_ITEM_ID },
    { component: 11, itemId: GATE_KEY_TRIANGLE_ITEM_ID },
    { component: 12, itemId: GATE_KEY_CIRCLE_ITEM_ID },
    { component: 13, itemId: GATE_KEY_STAR_ITEM_ID },
  ];
  const GATE_KEYHOLE_BUTTON_UIDS = GATE_KEYHOLES.map(
    (keyhole) => (OLAF_GATE_INTERFACE_ID << 16) | keyhole.component
  );

  // The four skull disks. value 4 is solved (the cache's zero-angle model); each
  // lever rotates its pair +1, wrapping 4 -> 1, which is the wiki's one-step turn.
  const WALL_DISKS = [
    { key: "right", component: 4, modelId: 24136 },
    { key: "top", component: 5, modelId: 24138 },
    { key: "left", component: 6, modelId: 24135 },
    { key: "bottom", component: 7, modelId: 24134 },
  ];
  // Cache component names: lever_right=8, lever_top=9, lever_left=10,
  // lever_bottom=11, lever_confirm=12.
  const WALL_LEVERS = {
    8: ["left", "right"], // right lever rotates the left and right circles
    9: ["top", "left"], // top lever rotates the top and left circles
    10: ["left", "bottom"], // left lever rotates the left and bottom circles
    11: ["top", "bottom"], // bottom lever rotates the top and bottom circles
  };
  const WALL_CONFIRM_COMPONENT = 12;
  const WALL_PUZZLE_BUTTON_UIDS = [8, 9, 10, 11, 12].map(
    (component) => (OLAF_WALL_INTERFACE_ID << 16) | component
  );
  // The wiki order right, up, left, down solves the unique initial state below:
  // right=3, top=2, left=1, bottom=2, each lever +1 wrapping 4 -> 1.
  const WALL_INITIAL = { right: 3, bottom: 2, left: 1, top: 2 };
  const WALL_INITIAL_PACKED =
    (WALL_INITIAL.right & 7) |
    ((WALL_INITIAL.bottom & 7) << 3) |
    ((WALL_INITIAL.left & 7) << 6) |
    ((WALL_INITIAL.top & 7) << 9);
  const WALL_ACTION_FLAG = 1 << 1; // Op1: Pull/Open/Confirm, matching the cache flags
  const WALL_SET_MODEL_SCRIPT_ID = 233; // cache script: if_setmodel + if_setmodelangle + if_setmodelanim
  const WALL_LEVER_ANIMATION_ID = 6125; // cache sequence olaf2_skull_lever
  const WALL_MODEL_TILT = 512; // cache components' rotationX
  const WALL_MODEL_SPIN_STEP = 512; // one quarter turn
  const WALL_MODEL_ZOOM = 420; // cache disk component zoom

  // Stage values (Quest Helper step keys 10..70; cache completion threshold 80).
  const STAGE_STARTED = 10;
  const STAGE_LOGS_GIVEN = 20;
  const STAGE_PRESENTS_DELIVERED = 30;
  const STAGE_PLANKS_GIVEN = 40;
  const STAGE_FIRE_LIT = 50;
  const STAGE_MAP_GIVEN = 60;
  const STAGE_IN_CAVE = 70;
  const STAGE_COMPLETE = 80;

  const WINDSWEPT_TREE_TILE = { x: 2748, y: 3734 };
  const CAVE_ENTRY_TILE = { x: 2694, y: 10124 };
  const CAVE_EXIT_TILE = { x: 2726, y: 3731 };
  const ULFRIC_SPAWN_TILE = { x: 2745, y: 10161 };
  // The rusty gate sits mid-walkway at (2725, 10168) in the cave.
  const RUSTY_GATE_OBJECT_TILE_X = 2725;
  const RUSTY_GATE_OBJECT_TILE_Y = 10168;
  // Wiki tiles of the two barrel+rope repair hotspots (Quest Helper OLAF2_INVIS_HOTSPOT_BARREL1/2).
  const WALKWAY_HOTSPOTS = [
    { id: ObjectIdentifiers.WALKWAY, x: 2722, y: 10168 }, // 23213
    { id: ObjectIdentifiers.WALKWAY_2, x: 2724, y: 10168 }, // 23214
  ];
  const WALKWAY_OBJECT_TYPE = 10; // scenery
  const FULL_WALKWAY_REPAIR_ROPE = 3; // 3 ropes per broken section

  const PAGE = "Olaf's Quest";
  const START_HOOK = "quest:olaf-s-quest:start";
  const DIG_ANIMATION_ID = 830;

  const TRIALS_INCOMPLETE_VARIANT = "talking-to-olaf-if-the-fremennik-trials-has-not-been-completed";
  const START_VARIANT = "talking-to-olaf-if-the-fremennik-trials-has-been-completed";
  const NO_LOGS_VARIANT = "talking-to-olaf-talking-to-olaf-again-without-the-windswept-logs";
  const LOGS_VARIANT = "talking-to-olaf-talking-to-olaf-with-the-windswept-logs";
  const DELIVERING_VARIANT = "delivering-the-presents-talking-to-olaf-again";
  const INGRID_DELIVER_VARIANT = "delivering-the-presents-ingrid-s-present";
  const INGRID_AGAIN_VARIANT = "delivering-the-presents-ingrid-s-present-talking-to-ingrid-again";
  const VOLF_DELIVER_VARIANT = "delivering-the-presents-volf-s-present";
  const VOLF_AGAIN_VARIANT = "delivering-the-presents-volf-s-present-talking-to-volf-again";
  const PLANS_VARIANT = "talking-to-olaf-after-the-presents-have-been-delivered";
  const COLD_VARIANT =
    "talking-to-olaf-after-the-presents-have-been-delivered-talking-to-olaf-again-if-the-fire-has-not-lighten-up";
  const FIRE_LIT_VARIANT =
    "talking-to-olaf-after-the-presents-have-been-delivered-lighting-up-the-fire";
  const AFTERWARDS_VARIANT =
    "talking-to-olaf-after-the-presents-have-been-delivered-talking-to-olaf-afterwards";
  const AFTER_MAP_VARIANT =
    "talking-to-olaf-after-the-presents-have-been-delivered-talking-to-olaf-again-after-getting-sven-s-last-map";
  const RECLAIM_MAP_VARIANT =
    "talking-to-olaf-after-the-presents-have-been-delivered-talking-to-olaf-again-after-getting-sven-s-last-map-reclaiming-back-the-map-if-lost";
  const DIG_VARIANT = "entering-the-brine-rat-cavern-when-digging-beside-the-windswept-tree";
  const WALL_ATTEMPT_VARIANT = "entering-the-brine-rat-cavern-attempting-to-open-the-picture-wall";
  const WALL_OPEN_VARIANT = "entering-the-brine-rat-cavern-opening-the-picture-wall";
  const CHEST_OPEN_VARIANT = "entering-the-brine-rat-cavern-opening-the-chest-inside-the-shipwreck";
  const CHEST_AFTER_VARIANT =
    "entering-the-brine-rat-cavern-opening-the-chest-inside-the-shipwreck-after-ulfric-has-been-defeated";

  // Condition step ids on the delivering-the-presents page.
  const INGRID_NOT_DELIVERED_CONDITION_ID = "F3uj3T";
  const INGRID_DELIVERED_CONDITION_ID = "2OfZ4k";
  const VOLF_NOT_DELIVERED_CONDITION_ID = "5JJakl";
  const VOLF_DELIVERED_CONDITION_ID = "EObsHe";

  // Action/message step ids.
  const CARVE_ACTION_ID = "b5Mnae"; // "Olaf carves furiously." -> carvings
  const BREAD_RECEIVE_ACTION_ID = "cWJG2g"; // Ingrid's present thank-you
  const SHARK_RECEIVE_ACTION_ID = "sQYWRb"; // Volf's present thank-you
  const PLANKS_RECEIVE_ACTION_ID = "X7TD0c"; // damp planks for the fire
  const MAP_HANDOVER_ACTION_ID = "C8kt_f"; // "Olaf hands you the map."
  const MAP_RECLAIM_ACTION_ID = "ScOeTx"; // Sven's last map, reclaimed
  const COMPLETE_ACTION_ID = "QKeIBs"; // "Congratulations! Quest complete!"

  // The stage-50 "afterwards" choice: the food option's wiki jump continues into the
  // refuse branch's tail. Used only by the plugin-side fallback replay.
  const FOOD_OPTION_TEXT = "Alright, here, have some food. Now give me the map.";
  const REFUSE_OPTION_TEXT = "Not a chance.";
  const REFUSE_FOLLOW_UP_LINE = "Okay, okay, I was only asking.";
  const MAP_CONFESSION_LINE =
    "Well, regardless, you've more than earned this map. It was the last one my grandfather, Sven the Helmsman, ever made.";

  const BITS_ATTRIBUTE = "quest.olafs_quest.bits";
  const WALL_ATTRIBUTE = "olafs-quest:wall";
  const BIT_INGRID_DELIVERED = 1 << 0;
  const BIT_VOLF_DELIVERED = 1 << 1;
  const BIT_WALKWAY_1 = 1 << 2;
  const BIT_WALKWAY_2 = 1 << 3;
  const BIT_WALL_OPEN = 1 << 4;
  const BIT_GATE_OPEN = 1 << 5;
  const BIT_FIGHT_STARTED = 1 << 6;
  const BIT_ULFRIC_KILLED = 1 << 7;

  let quest;
  let groundItems = null;
  let walkwayHotspotsEnsured = false;
  const ulfricByPlayer = new Map();
  const wallMessageSeen = new WeakSet();
  const gateKeyByPlayer = new WeakMap();
  // Food-option guard: after the confession line the wiki jump continues into the
  // refuse branch, whose opening ("Not a chance." / "Okay, okay...") does not belong.
  const foodTailPending = new WeakSet();
  const foodTailArmed = new WeakSet();

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

  const owned = (player, itemId) => held(player, itemId)
    || (player.getBanks?.() ?? []).some((bank) => bank.getAmount(itemId) > 0);

  function skillLevel(player, skill) {
    return Number(player.getSkillManager().getCurrentLevel(skill)) || 0;
  }

  function sendVarbit(player, varbitId, value) {
    player.getPacketSender().sendVarbit(varbitId, value | 0);
  }

  function near(player, tile, radius) {
    const location = player?.getLocation?.();
    if (!location) return false;
    return (
      Math.abs(location.getX() - tile.x) <= radius &&
      Math.abs(location.getY() - tile.y) <= radius
    );
  }

  function hasAnyGateKey(player) {
    for (const keyId of GATE_KEY_ITEM_IDS) if (held(player, keyId)) return true;
    return false;
  }

  function heldRepairRopes(player) {
    return (
      player.getInventory().getAmount(REPAIR_ROPE_ITEM_ID) +
      player.getInventory().getAmount(ROPE_ITEM_ID)
    );
  }

  function takeRepairRopes(player, amount) {
    let remaining = amount;
    for (const ropeId of [REPAIR_ROPE_ITEM_ID, ROPE_ITEM_ID]) {
      if (remaining <= 0) break;
      const have = player.getInventory().getAmount(ropeId);
      const take = Math.min(have, remaining);
      if (take > 0) {
        player.getInventory().deleteNumber(ropeId, take);
        remaining -= take;
      }
    }
  }

  /** Waits for the F2P quest registry's answer (first boolean wins). */
  function fremennikTrialsComplete(player) {
    const request = { player, key: "fremennik_trials", complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  /**
   * The player-resolved id: placed multi-locs (the Olaf fire) report their raw id,
   * but the client and the object's actions use the varbit child (Embers/Fire).
   */
  function resolvedObjectId(event) {
    if (event.definition?.id != null) return event.definition.id;
    if (event.object) {
      const definition = ObjectDefinition.forPlayer(event.object.getId(), event.player);
      if (definition) return definition.id;
    }
    return event.objectId;
  }

  /** Move one tile past a wall-straight obstacle, from the player's side. */
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

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Olaf Hradson asked me to help him win back his family's</str>",
        "<str>respect after his shipwreck near Rellekka.</str>",
        "<str>I delivered his carvings, lit his fire and took up the map</str>",
        "<str>of his grandfather, Sven the Helmsman.</str>",
        "<str>In the Brine Rat Cavern I solved the picture wall, crossed</str>",
        "<str>the walkway and defeated the undead captain Ulfric, claiming</str>",
        "<str>Sven's treasure.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage <= 0) {
      return [
        "I can start this quest by speaking to <col=800000>Olaf Hradson</col>",
        "north-east of <col=800000>Rellekka</col>.",
        "",
        "I must have completed <col=800000>The Fremennik Trials</col>.",
      ];
    }
    const lines = [
      "<str>Olaf Hradson asked me to help him win back his family's</str>",
      "<str>respect after his shipwreck near Rellekka.</str>",
      "",
    ];
    if (stage < STAGE_PRESENTS_DELIVERED) {
      lines.push("I need to chop <col=800000>windswept logs</col> from the tree east of Olaf");
      lines.push("and take the carvings to his wife and son in Rellekka.");
    } else if (stage < STAGE_PLANKS_GIVEN) {
      lines.push("I delivered the carvings and should return to <col=800000>Olaf</col>.");
    } else if (stage < STAGE_FIRE_LIT) {
      lines.push("Olaf gave me <col=800000>damp planks</col>; I should use them on his");
      lines.push("<col=800000>embers</col> and light the fire with a tinderbox.");
    } else if (stage < STAGE_MAP_GIVEN) {
      lines.push("The fire is lit; I should talk to <col=800000>Olaf</col> and claim his map.");
    } else if (stage < STAGE_IN_CAVE) {
      lines.push("I have <col=800000>Sven's last map</col>; I should dig beside the");
      lines.push("<col=800000>windswept tree</col> to enter the cavern.");
    } else {
      lines.push("In the <col=800000>Brine Rat Cavern</col> I must solve the picture wall,");
      lines.push("repair the walkway, open the gate and claim Sven's treasure.");
    }
    return lines;
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.DEFENCE, 12000);
    // forceAdd drops at the reward location when the bag is full, matching the
    // runtime's quest-reward contract instead of silently losing the items.
    const inventory = player.getInventory();
    for (let index = 0; index < 3; index++) {
      inventory.forceAdd(player, new Item(RUBY_ITEM_ID, 1));
    }
    inventory.forceAdd(player, new Item(COINS_ITEM_ID, 20000));
    inventory.forceAdd(player, new Item(PARCHMENT_ITEM_ID, 1));
  }

  function selectOlafVariant(player) {
    const stage = quest.getStage(player);
    if (stage <= 0) {
      return fremennikTrialsComplete(player) ? START_VARIANT : TRIALS_INCOMPLETE_VARIANT;
    }
    if (stage < STAGE_LOGS_GIVEN) {
      return held(player, WINDSWEPT_LOGS_ITEM_ID) ? LOGS_VARIANT : NO_LOGS_VARIANT;
    }
    if (stage < STAGE_PRESENTS_DELIVERED) return DELIVERING_VARIANT;
    if (stage < STAGE_PLANKS_GIVEN) return PLANS_VARIANT;
    if (stage < STAGE_FIRE_LIT) return COLD_VARIANT;
    if (stage < STAGE_MAP_GIVEN) return AFTERWARDS_VARIANT;
    if (!owned(player, SVENS_LAST_MAP_ITEM_ID) && stage < STAGE_IN_CAVE) {
      return RECLAIM_MAP_VARIANT;
    }
    return AFTER_MAP_VARIANT;
  }

  /**
   * The item pages document that destroyed carvings/planks are replaced by Olaf
   * ("you will need to see Olaf Hradson to get another/some more"). Reissue only
   * the present that has not been delivered yet, so a delivered present is not
   * duplicated. The transcript has no dedicated replacement branch, so this
   * happens when the next Olaf conversation begins.
   */
  function restoreLostQuestItems(player) {
    const stage = quest.getStage(player);
    if (stage === STAGE_LOGS_GIVEN) {
      if (!hasBit(player, BIT_INGRID_DELIVERED) && !owned(player, CRUDE_CARVING_ITEM_ID)) {
        player.getInventory().adds(CRUDE_CARVING_ITEM_ID, 1);
      }
      if (!hasBit(player, BIT_VOLF_DELIVERED) && !owned(player, CRUDER_CARVING_ITEM_ID)) {
        player.getInventory().adds(CRUDER_CARVING_ITEM_ID, 1);
      }
    } else if (stage === STAGE_PLANKS_GIVEN && !owned(player, DAMP_PLANKS_ITEM_ID)) {
      player.getInventory().adds(DAMP_PLANKS_ITEM_ID, 1);
    }
  }

  /** Which transcript variant each speaker plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    // A ::quest reset leaves the second-varp bits behind; drop them once the stage is back to 0.
    if (quest.getStage(player) <= 0) {
      if (bits(player) !== 0) player.setAttribute(BITS_ATTRIBUTE, 0);
      player.setAttribute(WALL_ATTRIBUTE, WALL_INITIAL_PACKED);
    }
    if (npcId === OLAF_NPC_ID) {
      restoreLostQuestItems(player);
      return selectOlafVariant(player);
    }
    const stage = quest.getStage(player);
    if (npcId === INGRID_NPC_ID) {
      if (stage < STAGE_LOGS_GIVEN) {
        return fremennikTrialsComplete(player)
          ? "after-the-fremennik-trials-but-before-olaf-s-quest"
          : "before-and-during-the-fremennik-trials";
      }
      if (quest.isComplete(player)) return "after-olaf-s-quest";
      const delivering =
        stage === STAGE_LOGS_GIVEN &&
        !hasBit(player, BIT_INGRID_DELIVERED) &&
        held(player, CRUDE_CARVING_ITEM_ID);
      return delivering ? INGRID_DELIVER_VARIANT : INGRID_AGAIN_VARIANT;
    }
    if (npcId === VOLF_NPC_ID) {
      if (stage < STAGE_LOGS_GIVEN) {
        return fremennikTrialsComplete(player)
          ? "after-the-fremennik-trials-but-before-olaf-s-quest"
          : "before-the-fremennik-trials";
      }
      if (quest.isComplete(player)) return "after-olaf-s-quest";
      const delivering =
        stage === STAGE_LOGS_GIVEN &&
        !hasBit(player, BIT_VOLF_DELIVERED) &&
        held(player, CRUDER_CARVING_ITEM_ID);
      return delivering ? VOLF_DELIVER_VARIANT : VOLF_AGAIN_VARIANT;
    }
    return null;
  }

  /** Answer the present-delivery prose conditions on Olaf's delivering variant. */
  function answerCondition({ npcId, player, stepId }) {
    if (npcId !== OLAF_NPC_ID) return null;
    if (stepId === INGRID_NOT_DELIVERED_CONDITION_ID) return !hasBit(player, BIT_INGRID_DELIVERED);
    if (stepId === INGRID_DELIVERED_CONDITION_ID) return hasBit(player, BIT_INGRID_DELIVERED);
    if (stepId === VOLF_NOT_DELIVERED_CONDITION_ID) return !hasBit(player, BIT_VOLF_DELIVERED);
    if (stepId === VOLF_DELIVERED_CONDITION_ID) return hasBit(player, BIT_VOLF_DELIVERED);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== OLAF_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  /** Run an action once the player's chatbox is free (Making History's pattern). */
  function afterDialogue(player, action, attempts = 40) {
    const { CountdownTask, TaskManager } = api.core;
    if (!CountdownTask || !TaskManager) {
      action();
      return;
    }
    TaskManager.submit(
      new CountdownTask(player, 1, () => {
        if (player.isRegistered?.() === false) return;
        if (player.getDialogueManager?.()?.isActive?.() && attempts > 0) {
          afterDialogue(player, action, attempts - 1);
          return;
        }
        action();
      })
    );
  }

  /** The two Volf conditions from Olaf's delivering variant, in wiki order. */
  function selectVolfConditions(steps) {
    return steps.filter(
      (step) =>
        step.type === "condition" &&
        (step.id === VOLF_NOT_DELIVERED_CONDITION_ID || step.id === VOLF_DELIVERED_CONDITION_ID)
    );
  }

  /**
   * The dialogue runtime collapses a run of sibling conditions to the first true one,
   * which would drop Volf's half of "So, how did my wife like her carving?". After the
   * Ingrid half has played, replay just the Volf conditions as a follow-up.
   */
  function handleCondition({ player, npcId, stepId }) {
    if (npcId !== OLAF_NPC_ID) return;
    if (stepId !== INGRID_NOT_DELIVERED_CONDITION_ID && stepId !== INGRID_DELIVERED_CONDITION_ID) {
      return;
    }
    afterDialogue(player, () => {
      if (player.isRegistered?.() === false) return;
      if (quest.getStage(player) !== STAGE_LOGS_GIVEN) return;
      api.emitCustomEvent("npc-dialogue:start", {
        player,
        npcId: OLAF_NPC_ID,
        variant: DELIVERING_VARIANT,
        select: selectVolfConditions,
      });
    });
  }

  /**
   * The tail the food option's "below" jump should reach: the shared confession line
   * and everything after it in the refuse branch, ending in the C8kt_f map hand-over.
   */
  function selectMapTail(steps) {
    for (const step of steps) {
      if (step.type !== "choice" || !Array.isArray(step.options)) continue;
      const refuse = step.options.find((option) => option.text === REFUSE_OPTION_TEXT);
      if (!refuse || !Array.isArray(refuse.steps)) continue;
      const at = refuse.steps.findIndex(
        (candidate) =>
          candidate.type === "line" && candidate.text === MAP_CONFESSION_LINE
      );
      if (at >= 0) return refuse.steps.slice(at + 1);
      return refuse.steps.filter((candidate) => candidate.player !== REFUSE_OPTION_TEXT);
    }
    return [];
  }

  /**
   * Safety net for the food option: the runtime should play the confession tail and
   * hand the map over (stage 60). If the chat closes still at stage 50, replay the
   * correct continuation ourselves so the quest can never stall here.
   */
  function handleChoice({ player, npcId, option }) {
    if (npcId !== OLAF_NPC_ID || option !== FOOD_OPTION_TEXT) return;
    if (quest.getStage(player) !== STAGE_FIRE_LIT) return;
    foodTailPending.add(player);
    afterDialogue(player, () => {
      if (player.isRegistered?.() === false) return;
      if (quest.getStage(player) !== STAGE_FIRE_LIT) return;
      foodTailPending.delete(player);
      foodTailArmed.delete(player);
      api.emitCustomEvent("npc-dialogue:start", {
        player,
        npcId: OLAF_NPC_ID,
        variant: AFTERWARDS_VARIANT,
        select: selectMapTail,
      });
    });
  }

  /**
   * The food option's "below" jump now resolves into the refuse branch body, which
   * starts with the refuse echo and a repeated confession line. Drop those, so the
   * food branch reads as the wiki tail. Harmless when a resolver returns the sliced
   * tail directly (the first real tail line disarms the guard).
   */
  function handleDialogueLine(event) {
    const { player, npcId, text } = event;
    if (npcId !== OLAF_NPC_ID || !foodTailPending.has(player)) return;
    if (text === MAP_CONFESSION_LINE) {
      if (foodTailArmed.has(player)) {
        event.skip = true; // the refuse branch's repeated confession line
        foodTailPending.delete(player);
        foodTailArmed.delete(player);
      } else {
        foodTailArmed.add(player); // the food branch's own confession line
      }
      return;
    }
    if (!foodTailArmed.has(player)) return;
    if (text === REFUSE_OPTION_TEXT || text === REFUSE_FOLLOW_UP_LINE) {
      event.skip = true;
      return;
    }
    foodTailPending.delete(player);
    foodTailArmed.delete(player);
  }

  function markPresentDelivered(player) {
    if (
      hasBit(player, BIT_INGRID_DELIVERED) &&
      hasBit(player, BIT_VOLF_DELIVERED) &&
      quest.getStage(player) < STAGE_PRESENTS_DELIVERED
    ) {
      quest.setStage(player, STAGE_PRESENTS_DELIVERED);
    }
  }

  /**
   * Transcript message/action side effects. Message steps keep `handled` false so
   * their text still shows; receive actions set it to stop the generic fallback.
   */
  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (
      npcId !== OLAF_NPC_ID &&
      npcId !== INGRID_NPC_ID &&
      npcId !== VOLF_NPC_ID &&
      npcId !== ULFRIC_RISE_NPC_ID
    ) {
      return;
    }
    if (stepId === CARVE_ACTION_ID) {
      if (quest.getStage(player) >= STAGE_LOGS_GIVEN) return;
      if (!held(player, WINDSWEPT_LOGS_ITEM_ID)) return;
      player.getInventory().deleteNumber(WINDSWEPT_LOGS_ITEM_ID, 1);
      player.getInventory().adds(CRUDE_CARVING_ITEM_ID, 1);
      player.getInventory().adds(CRUDER_CARVING_ITEM_ID, 1);
      quest.setStage(player, STAGE_LOGS_GIVEN);
      return;
    }
    if (stepId === BREAD_RECEIVE_ACTION_ID) {
      event.handled = true;
      if (hasBit(player, BIT_INGRID_DELIVERED) || !held(player, CRUDE_CARVING_ITEM_ID)) return;
      player.getInventory().deleteNumber(CRUDE_CARVING_ITEM_ID, 1);
      player.getInventory().adds(BREAD_ITEM_ID, 1);
      setBit(player, BIT_INGRID_DELIVERED);
      sendVarbit(player, OLAF_INGRID_VARBIT, 1);
      markPresentDelivered(player);
      return;
    }
    if (stepId === SHARK_RECEIVE_ACTION_ID) {
      event.handled = true;
      if (hasBit(player, BIT_VOLF_DELIVERED) || !held(player, CRUDER_CARVING_ITEM_ID)) return;
      player.getInventory().deleteNumber(CRUDER_CARVING_ITEM_ID, 1);
      player.getInventory().adds(SHARK_ITEM_ID, 1);
      setBit(player, BIT_VOLF_DELIVERED);
      sendVarbit(player, OLAF_VOLF_VARBIT, 1);
      markPresentDelivered(player);
      return;
    }
    if (stepId === PLANKS_RECEIVE_ACTION_ID) {
      event.handled = true;
      if (quest.getStage(player) >= STAGE_PLANKS_GIVEN || quest.getStage(player) < STAGE_PRESENTS_DELIVERED) {
        return;
      }
      player.getInventory().adds(DAMP_PLANKS_ITEM_ID, 1);
      sendVarbit(player, OLAF_FIRE_VARBIT, 1); // The campfire burns down to embers.
      quest.setStage(player, STAGE_PLANKS_GIVEN);
      return;
    }
    if (stepId === MAP_HANDOVER_ACTION_ID) {
      foodTailPending.delete(player);
      foodTailArmed.delete(player);
      if (quest.getStage(player) >= STAGE_MAP_GIVEN) return;
      if (!held(player, SVENS_LAST_MAP_ITEM_ID)) player.getInventory().adds(SVENS_LAST_MAP_ITEM_ID, 1);
      quest.setStage(player, STAGE_MAP_GIVEN);
      return;
    }
    if (stepId === MAP_RECLAIM_ACTION_ID) {
      event.handled = true;
      if (!owned(player, SVENS_LAST_MAP_ITEM_ID)) player.getInventory().adds(SVENS_LAST_MAP_ITEM_ID, 1);
      return;
    }
    if (stepId === COMPLETE_ACTION_ID) {
      event.handled = true;
      event.end = true;
      if (quest.getStage(player) >= STAGE_IN_CAVE && !quest.isComplete(player)) {
        sendVarbit(player, OLAF_TREASURE_VARBIT, 1);
        quest.complete(player);
      }
    }
  }

  function wallState(player) {
    const packed = Number(player.getAttribute(WALL_ATTRIBUTE));
    if (!Number.isFinite(packed) || packed <= 0) return { ...WALL_INITIAL };
    return {
      right: (packed >> 0) & 7,
      bottom: (packed >> 3) & 7,
      left: (packed >> 6) & 7,
      top: (packed >> 9) & 7,
    };
  }

  function wallPacked(state) {
    return (
      (state.right & 7) |
      ((state.bottom & 7) << 3) |
      ((state.left & 7) << 6) |
      ((state.top & 7) << 9)
    );
  }

  function sendWallVarbits(player, state) {
    sendVarbit(player, OLAF_RIGHT_DISK_VARBIT, state.right);
    sendVarbit(player, OLAF_BOTTOM_DISK_VARBIT, state.bottom);
    sendVarbit(player, OLAF_LEFT_DISK_VARBIT, state.left);
    sendVarbit(player, OLAF_TOP_DISK_VARBIT, state.top);
  }

  function saveWallState(player, state) {
    player.setAttribute(WALL_ATTRIBUTE, wallPacked(state));
    sendWallVarbits(player, state);
  }

  function sendWallDisk(player, disk, value) {
    // The disk models are flat plates; angleY spins them in their own plane.
    // value 4 is the cache's solved angle (0), and each wrong step is one turn.
    const angleY = ((4 - value) & 3) * WALL_MODEL_SPIN_STEP;
    player.getPacketSender().sendClientScript(
      WALL_SET_MODEL_SCRIPT_ID,
      (OLAF_WALL_INTERFACE_ID << 16) | disk.component,
      disk.modelId,
      0,
      0,
      WALL_MODEL_TILT,
      angleY,
      0,
      WALL_MODEL_ZOOM,
      -1
    );
  }

  function openWallInterface(player) {
    const state = wallState(player);
    saveWallState(player, state);
    const sender = player.getPacketSender();
    sender.sendInterface(OLAF_WALL_INTERFACE_ID);
    for (const disk of WALL_DISKS) sendWallDisk(player, disk, state[disk.key]);
    for (const uid of WALL_PUZZLE_BUTTON_UIDS) {
      sender.sendInterfaceFlagsRange(uid, -1, -1, WALL_ACTION_FLAG);
    }
  }

  function confirmWallPuzzle(player) {
    const state = wallState(player);
    if (WALL_DISKS.some((disk) => state[disk.key] !== 4)) return;
    for (const disk of WALL_DISKS) state[disk.key] = 4;
    saveWallState(player, state);
    for (const disk of WALL_DISKS) sendWallDisk(player, disk, state[disk.key]);
    setBit(player, BIT_WALL_OPEN);
    player.getPacketSender().closeInterface(OLAF_WALL_INTERFACE_ID);
    startTranscript(api, player, ULFRIC_RISE_NPC_ID, PAGE, WALL_OPEN_VARIANT);
  }

  function handleWallInterfaceClick(event) {
    const { player, buttonId } = event;
    if ((buttonId >>> 16) !== OLAF_WALL_INTERFACE_ID) return;
    if (event.action !== 1) return;
    const component = buttonId & 0xffff;
    event.handled = true;
    if (quest.getStage(player) < STAGE_IN_CAVE || hasBit(player, BIT_WALL_OPEN)) return;
    if (component === WALL_CONFIRM_COMPONENT) {
      confirmWallPuzzle(player);
      return;
    }
    const affected = WALL_LEVERS[component];
    if (!affected) return;
    const state = wallState(player);
    for (const key of affected) state[key] = (state[key] % 4) + 1;
    saveWallState(player, state);
    player.getPacketSender().sendInterfaceAnimation(
      (OLAF_WALL_INTERFACE_ID << 16) | component,
      WALL_LEVER_ANIMATION_ID
    );
    for (const key of affected) {
      const disk = WALL_DISKS.find((entry) => entry.key === key);
      if (disk) sendWallDisk(player, disk, state[key]);
    }
  }

  function handlePictureWall(event) {
    const { player } = event;
    if (event.objectId !== PICTURE_WALL_OBJECT_ID && event.definition?.id !== PICTURE_WALL_OBJECT_ID) {
      return false;
    }
    if (quest.getStage(player) < STAGE_IN_CAVE) return false;
    if (hasBit(player, BIT_WALL_OPEN)) {
      stepThrough(player, event.location);
      return true;
    }
    if (!wallMessageSeen.has(player)) {
      wallMessageSeen.add(player);
      startTranscript(api, player, ULFRIC_RISE_NPC_ID, PAGE, WALL_ATTEMPT_VARIANT);
      return true;
    }
    openWallInterface(player);
    return true;
  }

  function firstHeldGateKey(player) {
    for (const keyId of GATE_KEY_ITEM_IDS) if (held(player, keyId)) return keyId;
    return null;
  }

  function moveAcrossRustyGate(player) {
    // The cache gate has no walkable open variant: cross to the far side directly.
    const east = player.getLocation().getX() <= RUSTY_GATE_OBJECT_TILE_X;
    player.moveTo(
      new Location(
        east ? RUSTY_GATE_OBJECT_TILE_X + 1 : RUSTY_GATE_OBJECT_TILE_X - 1,
        RUSTY_GATE_OBJECT_TILE_Y,
        0
      )
    );
  }

  function openGateInterface(player, usedKeyId) {
    gateKeyByPlayer.set(player, usedKeyId);
    const sender = player.getPacketSender();
    sender.sendInterface(OLAF_GATE_INTERFACE_ID);
    for (const component of OLAF_GATE_KEY_COMPONENTS) {
      sender.sendInterfaceModel((OLAF_GATE_INTERFACE_ID << 16) | component, usedKeyId, 1);
    }
    for (const keyhole of GATE_KEYHOLES) {
      const uid = (OLAF_GATE_INTERFACE_ID << 16) | keyhole.component;
      sender.sendInterfaceModel(uid, keyhole.itemId, 1);
      sender.sendInterfaceFlagsRange(uid, -1, -1, WALL_ACTION_FLAG);
    }
  }

  /** The gate object opens the cache 252 keyhole interface; the key is not used yet. */
  function presentGateKeyhole(player, usedKeyId = null) {
    if (quest.getStage(player) < STAGE_IN_CAVE) return false;
    if (hasBit(player, BIT_GATE_OPEN)) {
      moveAcrossRustyGate(player);
      return true;
    }
    const keyId = usedKeyId && held(player, usedKeyId) ? usedKeyId : firstHeldGateKey(player);
    if (!keyId) {
      player.sendMessage("The gate is locked. One of the skeletons here must carry a key.");
      return true;
    }
    openGateInterface(player, keyId);
    return true;
  }

  function handleGateInterfaceClick(event) {
    const { player, buttonId } = event;
    if ((buttonId >>> 16) !== OLAF_GATE_INTERFACE_ID) return;
    if (event.action !== 1) return;
    const component = buttonId & 0xffff;
    const keyhole = GATE_KEYHOLES.find((entry) => entry.component === component);
    if (!keyhole) return;
    event.handled = true;
    if (quest.getStage(player) < STAGE_IN_CAVE || hasBit(player, BIT_GATE_OPEN)) return;
    const expectedKey = gateKeyByPlayer.get(player);
    if (expectedKey && keyhole.itemId !== expectedKey) return;
    if (!held(player, keyhole.itemId)) return;
    player.getInventory().deleteNumber(keyhole.itemId, 1);
    gateKeyByPlayer.delete(player);
    setBit(player, BIT_GATE_OPEN);
    sendVarbit(player, OLAF_GATE_COMPLETED_VARBIT, 1);
    player.sendMessage("You turn the key in the lock and the gate swings open.");
    player.getPacketSender().closeInterface(OLAF_GATE_INTERFACE_ID);
    moveAcrossRustyGate(player);
  }

  function openRustyGate(request) {
    const { player, objectId } = request;
    if (objectId !== RUSTY_GATE_OBJECT_ID) return false;
    if (quest.getStage(player) < STAGE_IN_CAVE) return false;
    return presentGateKeyhole(player);
  }

  function handleGateOpen(event) {
    if (event.objectId !== RUSTY_GATE_OBJECT_ID && event.definition?.id !== RUSTY_GATE_OBJECT_ID) {
      return false;
    }
    return openRustyGate(event);
  }

  function claimGateToggle(request) {
    if (request.handled) return;
    if (request.objectId !== RUSTY_GATE_OBJECT_ID) return;
    if (openRustyGate(request)) request.handled = true;
  }

  function handleCaveExit(event) {
    const { player } = event;
    if (!CAVE_EXIT_OBJECT_IDS.has(event.objectId) && !CAVE_EXIT_OBJECT_IDS.has(event.definition?.id)) {
      return false;
    }
    if (quest.getStage(player) < STAGE_IN_CAVE) return false;
    player.moveTo(new Location(CAVE_EXIT_TILE.x, CAVE_EXIT_TILE.y, 0));
    return true;
  }

  function startUlfricFight(player) {
    setBit(player, BIT_FIGHT_STARTED);
    const npc = api.spawnNpc({
      id: ULFRIC_NPC_ID,
      x: ULFRIC_SPAWN_TILE.x,
      y: ULFRIC_SPAWN_TILE.y,
      z: 0,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) ulfricByPlayer.set(player, npc);
    startTranscript(api, player, ULFRIC_RISE_NPC_ID, PAGE, CHEST_OPEN_VARIANT);
  }

  function handleChestOpen(event) {
    const { player } = event;
    if (event.objectId !== CHEST_CLOSED_OBJECT_ID && event.objectId !== CHEST_OPEN_OBJECT_ID) {
      return false;
    }
    if (quest.getStage(player) < STAGE_IN_CAVE) return false;
    event.handled = true;
    if (!hasBit(player, BIT_ULFRIC_KILLED)) {
      const alive = ulfricByPlayer.get(player);
      if (hasBit(player, BIT_FIGHT_STARTED) && alive && alive.isRegistered?.() === true) {
        player.sendMessage("Ulfric guards the chest!");
        return true;
      }
      startUlfricFight(player);
      return true;
    }
    startTranscript(api, player, ULFRIC_RISE_NPC_ID, PAGE, CHEST_AFTER_VARIANT);
    return true;
  }

  function handleChop(event) {
    const { player } = event;
    if (event.objectId !== WINDSWEPT_TREE_OBJECT_ID && event.definition?.id !== WINDSWEPT_TREE_OBJECT_ID) {
      return false;
    }
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || quest.isComplete(player)) return false;
    const axe = woodcutting.findBestUsableAxe(player);
    if (!axe) {
      player.sendMessage("You need an axe to chop down this tree.");
      return true;
    }
    if (skillLevel(player, Skill.WOODCUTTING) < 50) {
      player.sendMessage("You need a Woodcutting level of 50 to chop this tree.");
      return true;
    }
    if (held(player, WINDSWEPT_LOGS_ITEM_ID)) {
      player.sendMessage("You already have some windswept logs.");
      return true;
    }
    player.performAnimation(new Animation(axe.animationId));
    player.getInventory().adds(WINDSWEPT_LOGS_ITEM_ID, 1);
    player.sendMessage("You get some windswept logs.");
    return true;
  }

  /** Spade "Dig" beside the windswept tree drops into the cavern. */
  function handleDig(event) {
    const { player } = event;
    if (event.itemId !== SPADE_ITEM_ID) return false;
    if (!near(player, WINDSWEPT_TREE_TILE, 8)) return false;
    if (quest.getStage(player) < STAGE_MAP_GIVEN) {
      player.sendMessage("You shovel some snow. Congratulations!");
      return true;
    }
    player.performAnimation(new Animation(DIG_ANIMATION_ID));
    ensureWalkwayHotspots();
    startTranscript(api, player, ULFRIC_RISE_NPC_ID, PAGE, DIG_VARIANT);
    player.moveTo(new Location(CAVE_ENTRY_TILE.x, CAVE_ENTRY_TILE.y, 0));
    if (quest.getStage(player) < STAGE_IN_CAVE) quest.setStage(player, STAGE_IN_CAVE);
    return true;
  }

  function lightOlafFire(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_PLANKS_GIVEN || stage >= STAGE_FIRE_LIT) {
      player.sendMessage("You have no reason to do that.");
      return;
    }
    if (!held(player, TINDERBOX_ITEM_ID)) {
      player.sendMessage("You need a tinderbox to light the fire.");
      return;
    }
    if (skillLevel(player, Skill.FIREMAKING) < 40) {
      player.sendMessage("You need a Firemaking level of 40 to light this fire.");
      return;
    }
    player.getInventory().deleteNumber(DAMP_PLANKS_ITEM_ID, 1);
    sendVarbit(player, OLAF_FIRE_VARBIT, 0);
    startTranscript(api, player, ULFRIC_RISE_NPC_ID, PAGE, FIRE_LIT_VARIANT);
    quest.setStage(player, STAGE_FIRE_LIT);
  }

  /**
   * Ensure the two barrel hotspot locs exist at their cache/wiki tiles and are sent
   * to the client, so a barrel can always be used on them. The map only gains the
   * object when it is missing; the runtime spawn is sent either way.
   */
  function ensureWalkwayHotspots() {
    if (walkwayHotspotsEnsured) return;
    walkwayHotspotsEnsured = true;
    const { GameObject, MapObjects, ObjectManager } = api.core;
    if (!GameObject || !MapObjects || !ObjectManager) return;
    for (const spot of WALKWAY_HOTSPOTS) {
      const location = new Location(spot.x, spot.y, 0);
      const object = new GameObject(spot.id, location, WALKWAY_OBJECT_TYPE, 0, null);
      if (!MapObjects.get(spot.id, location, null)) MapObjects.add(object);
      ObjectManager.register(object, true);
    }
  }

  function repairWalkway(player, objectId, barrelItemId) {
    if (quest.getStage(player) < STAGE_IN_CAVE) return;
    const bit = objectId === WALKWAY_OBJECT_ID ? BIT_WALKWAY_1 : BIT_WALKWAY_2;
    if (hasBit(player, bit)) {
      player.sendMessage("This section of the walkway is already repaired.");
      return;
    }
    if (heldRepairRopes(player) < FULL_WALKWAY_REPAIR_ROPE) {
      player.sendMessage("You need three ropes to secure the barrel in place.");
      return;
    }
    player.getInventory().deleteNumber(barrelItemId, 1);
    takeRepairRopes(player, FULL_WALKWAY_REPAIR_ROPE);
    setBit(player, bit);
    sendVarbit(
      player,
      objectId === WALKWAY_OBJECT_ID ? OLAF_WALKWAY_1_VARBIT : OLAF_WALKWAY_2_VARBIT,
      1
    );
    player.sendMessage("You secure the barrel across the broken walkway.");
  }

  function handleItemOnObject(event) {
    const { player, itemId } = event;
    const objectId = resolvedObjectId(event);
    if (GATE_KEY_ITEM_IDS.includes(itemId) && objectId === RUSTY_GATE_OBJECT_ID) {
      if (quest.getStage(player) < STAGE_IN_CAVE) return;
      event.handled = true;
      presentGateKeyhole(player, itemId);
      return;
    }
    if (itemId === DAMP_PLANKS_ITEM_ID && FIRE_OBJECT_IDS.has(objectId)) {
      event.handled = true;
      lightOlafFire(player);
      return;
    }
    if (
      (itemId === ROTTEN_BARREL_ITEM_ID || itemId === ROTTEN_BARREL_INV_ITEM_ID) &&
      WALKWAY_OBJECT_IDS.has(objectId)
    ) {
      event.handled = true;
      repairWalkway(player, objectId, itemId);
    }
  }

  function handleNpcDeath({ killer, npc, npcId }) {
    if (npcId === ULFRIC_NPC_ID) {
      const owner = npc.getOwner?.();
      if (!owner) return;
      ulfricByPlayer.delete(owner);
      setBit(owner, BIT_ULFRIC_KILLED);
      sendVarbit(owner, OLAF_KILLED_ULFRIC_VARBIT, 1);
      return;
    }
    if (!SKELETON_NPC_IDS.has(npcId)) return;
    if (killer?.isPlayer?.() !== true) return;
    if (quest.getStage(killer) < STAGE_IN_CAVE || quest.isComplete(killer)) return;
    if (hasAnyGateKey(killer)) return;
    if (!groundItems) return;
    const location = npc.getLocation?.() ?? npc.getSpawnLocation?.();
    if (!location) return;
    const keyId = GATE_KEY_ITEM_IDS[Math.floor(Math.random() * GATE_KEY_ITEM_IDS.length)];
    groundItems.registerLocation(killer, new Item(keyId, 1), location);
  }

  function handleLogout({ player }) {
    if (!player) return;
    const ulfric = ulfricByPlayer.get(player);
    if (ulfric) api.removeNpc(ulfric);
    ulfricByPlayer.delete(player);
    gateKeyByPlayer.delete(player);
    foodTailPending.delete(player);
    foodTailArmed.delete(player);
  }

  function handleLogin({ player }) {
    if (quest.getStage(player) <= 0) {
      if (bits(player) !== 0) player.setAttribute(BITS_ATTRIBUTE, 0);
      player.setAttribute(WALL_ATTRIBUTE, WALL_INITIAL_PACKED);
    }
    ensureWalkwayHotspots();
    refreshQuestList(player);
  }

  /** Re-send the sibling varbits the stage sync does not carry after the login bootstrap. */
  function syncExtraVarbits({ player }) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_FIRE_LIT) sendVarbit(player, OLAF_FIRE_VARBIT, 0);
    else if (stage >= STAGE_PLANKS_GIVEN) sendVarbit(player, OLAF_FIRE_VARBIT, 1);
    if (hasBit(player, BIT_INGRID_DELIVERED)) sendVarbit(player, OLAF_INGRID_VARBIT, 1);
    if (hasBit(player, BIT_VOLF_DELIVERED)) sendVarbit(player, OLAF_VOLF_VARBIT, 1);
    if (hasBit(player, BIT_ULFRIC_KILLED)) sendVarbit(player, OLAF_KILLED_ULFRIC_VARBIT, 1);
    if (stage >= STAGE_COMPLETE) sendVarbit(player, OLAF_TREASURE_VARBIT, 1);
    if (hasBit(player, BIT_WALKWAY_1)) sendVarbit(player, OLAF_WALKWAY_1_VARBIT, 1);
    if (hasBit(player, BIT_WALKWAY_2)) sendVarbit(player, OLAF_WALKWAY_2_VARBIT, 1);
    if (hasBit(player, BIT_GATE_OPEN)) sendVarbit(player, OLAF_GATE_COMPLETED_VARBIT, 1);
    sendWallVarbits(player, wallState(player));
  }

  groundItems = api.getItemOnGroundManager();
  api.persistAttribute(BITS_ATTRIBUTE);
  api.persistAttribute(WALL_ATTRIBUTE, WALL_INITIAL_PACKED);

  quest = registerQuest(api, {
    key: "olafs_quest",
    name: "Olaf's Quest",
    varpId: 994,
    varbitId: OLAF_STAGE_VARBIT,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.DEFENCE.getIndex(), amount: 12000, label: "Defence" }],
    rewardItemId: RUBY_ITEM_ID,
    rewardItemLabel: "4 cut rubies, 20,000 coins and a piece of parchment",
    otherRewards: ["Access to the Brine Rat Cavern"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("door:toggle", claimGateToggle);
  api.onObjectInteraction("Windswept tree", { "Chop down": handleChop });
  api.onObjectInteraction("Picture wall", { Search: handlePictureWall });
  api.onObjectInteraction("Gate", { Open: handleGateOpen });
  api.onObjectInteraction("Chest", { Open: handleChestOpen });
  api.onObjectInteraction("Cave", { Exit: handleCaveExit });
  api.onItemAction("Spade", { Dig: handleDig });
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onInterfaceActionButton(GATE_KEYHOLE_BUTTON_UIDS, handleGateInterfaceClick);
  api.onInterfaceActionButton(WALL_PUZZLE_BUTTON_UIDS, handleWallInterfaceClick);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogout(handleLogout);
  api.onPlayerLogin(handleLogin);
  api.onCustomEvent("player:bootstrap-complete", syncExtraVarbits);
};
