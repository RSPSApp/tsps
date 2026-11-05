/**
 * Pandemonium (members).
 *
 * The words come from the "Pandemonium" transcript page; this plugin supplies the
 * variant selector for 'Squawking' Steve Beanie, Ribs, Junior Jim and the port
 * masters, the Talk-to takeover for Will and Anne (their spawned cache ids are not
 * the indexed ones, so the NpcDialogues id lookup cannot reach the quest page), the
 * prose-condition answers, the cached boat scene and shipyard interactions, the
 * ledger hand-ins, the journal and the rewards.
 *
 * Stages (varbit 18314 "sailing_intro", varp 4959 bits 0-5), exactly as live sends them
 * (rsprox 381 rev 231 and PandemoniumDiscord rev 242) and as Quest Helper's loadSteps keys
 * on them:
 *   2 accepted the interview, 4 interview finished, 6 boarded Will and Anne's ship,
 *   8 at the boat / before sailing, 10 took the helm, 12 reached the wreck,
 *  14 salvaging explained, 16 salvaged the cup and washed ashore at the Pandemonium,
 *  18 asked Steve (points to Ribs), 20 heard Ribs's tale, 22 Steve points to Junior Jim,
 *  24 cup offered to Jim, 26 cup handed over and the raft granted, 28 cargo hold built,
 *  30 captain's log received, 32 Jim's cargo request logged, 34 ready to board the raft,
 *  36 boarded the raft, 38 docked and disembarked at Port Sarim,
 *  40 boarded again with the crate, 42 docked at the Pandemonium,
 *  44 crate delivered, 46 told Jim, 48 Old Grog departs, 50 complete.
 * Sibling bits of the same varp, re-sent on login: 18315 reached-wreck,
 * 18316 received-repair-kits.
 *
 * Rewards (OSRS Wiki): 1 Quest point, 300 Sailing XP (plus 100 on delivering the
 * cargo), access to Sailing and The Pandemonium, a raft, 25 sawmill coupon (wood
 * plank), 2 repair kits and a spyglass. XP and the items are granted in onReward.
 *
 * Gaps/approximations:
 * - Will and Anne's tutorial ship is the shared `pandemonium_tutorial_ship` static ship
 *   (owner-only), with its captured 2x5 deck, helm, sails and hook. Taking the helm
 *   uses the canonical controls and raising the sails starts a real BoatManager voyage.
 *   The player steers to the wreck; arrival observes its real position. Optional sail-trim
 *   boosts and exact journey timing are not reproduced. The ship is disposed when the
 *   player is pushed overboard or leaves.
 * - The raft and cargo route use the real Sailing system: Junior Jim grants a raft in
 *   the player's boat slot, the shipyard visit shows it and the cargo hold is built on
 *   its hotspot, and the crate is port task 599 (crate 32807) collected and delivered
 *   through the real ledger tables and Sailing's board/dock/leave events. Task 599 is
 *   rewardful in the capture (reward bag and 100 XP); task 600 is the noReward one.
 * - Deploy uses the captured private ship/shore maps, actors, cameras and human sequences;
 *   native Continue drives its canonical text. The ambient "sailing-the-boat-*" lines,
 *   optional voyage boosts and exact frame parity are not reproduced.
 * - Old Grog has no transcript page in npc-dialogues.json, so his lines in the
 *   finale borrow the talking NPC's (Steve's) chathead; he is owner-spawned for the
 *   scene and removed on "Old Grog departs.".
 * - Will and Anne have no post-quest variant in the dump, so a completed player
 *   falls through to their standard page. Their short "after starting the quest"
 *   variants lost their jump targets (and the offer variant its boarding action), so
 *   the full interview is replayed while the quest is at stage 2 or 4.
 */
module.exports = function registerPandemoniumQuest(api) {
  const {
    GameObject,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    ObjectManager,
    ShopManager,
    Skill,
    TeleportHandler,
    TeleportType,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");
  const Scenes = createQuestScenes(api);
  const { Sailing, BoatManager } = api.core;
  const StaticShips = require("../../skills/sailing/StaticShips.Sailing");
  const sailingContent = require("../../skills/sailing/SailingContent.Sailing");
  const Shipyard = require("../../skills/sailing/Shipyard.plugin.js");
  const BoatFacilities = require("../../skills/sailing/BoatFacilities.Sailing");
  const PortTasks = require("../../skills/sailing/porttasks/Common.PortTasks");

  // NPCs (cache ids; NpcIdentifiers comments).
  const WILL_NPC_ID = NpcIdentifiers.WILL; // 14959, the cached boat scene's Will
  const ANNE_NPC_ID = NpcIdentifiers.ANNE_3; // 14964, the cached boat scene's Anne
  // Canonical base ids: the cache transform publishes the dialogue children above.
  const WILL_DOCK_RAW_NPC_ID = 14957; // sailing_intro_will_sarim -> 14959
  const WILL_BOAT_RAW_NPC_ID = 14958; // sailing_intro_will_boat -> 14959
  const ANNE_DOCK_RAW_NPC_ID = 14962; // sailing_intro_anne_sarim -> 14964
  const ANNE_BOAT_RAW_NPC_ID = 14963; // sailing_intro_anne_boat -> 14964
  const STEVE_RAW_NPC_ID = 14967; // steve_beanie -> 14968/14969
  const RIBS_RAW_NPC_ID = 14970; // sailing_intro_ribs -> 14971
  const JIM_RAW_NPC_ID = 14972; // junior_jim -> 14974
  const WILL_DOCK_HEAD_ID = WILL_DOCK_RAW_NPC_ID;
  const WILL_BOAT_HEAD_ID = WILL_BOAT_RAW_NPC_ID;
  const ANNE_DOCK_HEAD_ID = ANNE_DOCK_RAW_NPC_ID;
  const ANNE_BOAT_HEAD_ID = ANNE_BOAT_RAW_NPC_ID;
  const OLD_GROG_HEAD_ID = 14976;
  const STEVE_NPC_ID = NpcIdentifiers.SQUAWKING_STEVE_BEANIE; // 14968
  const STEVE_NPC_ID_2 = NpcIdentifiers.SQUAWKING_STEVE_BEANIE_2; // 14969
  const RIBS_NPC_ID = NpcIdentifiers.RIBS; // 14971
  const JIM_NPC_ID = NpcIdentifiers.JUNIOR_JIM_2; // 14975, Junior Jim on the docks
  const OLD_GROG_NPC_ID = NpcIdentifiers.OLD_GROG; // 14977
  const PORT_MASTER_SARIM_NPC_ID = NpcIdentifiers.PORT_MASTER; // 15459, Port Sarim
  const PORT_MASTER_PANDEMONIUM_NPC_ID = NpcIdentifiers.PORT_MASTER_3; // 15461, The Pandemonium
  const STEVE_NPC_IDS = new Set([STEVE_NPC_ID, STEVE_NPC_ID_2]);
  const JIM_NPC_IDS = new Set([
    NpcIdentifiers.JUNIOR_JIM, // 14974
    JIM_NPC_ID,
    NpcIdentifiers.JUNIOR_JIM_3, // 15238
  ]);

  // Items (cache ids; ItemIdentifiers comments).
  const OLD_CUP_ITEM_ID = ItemIdentifiers.OLD_CUP; // 31338
  const HAMMER_ITEM_ID = ItemIdentifiers.HAMMER; // 2347
  const SAW_ITEM_ID = ItemIdentifiers.SAW; // 8794
  const CAPTAINS_LOG_ITEM_ID = ItemIdentifiers.CAPTAINS_LOG; // 31985
  const CRATE_OF_SHIP_PARTS_ITEM_ID = ItemIdentifiers.CRATE_OF_SHIP_PARTS_7; // 32807, quest crate
  const SAWMILL_COUPON_ITEM_ID = ItemIdentifiers.SAWMILL_COUPON_WOOD_PLANK_; // 32083
  const REPAIR_KIT_ITEM_ID = ItemIdentifiers.REPAIR_KIT; // 31964
  const SPYGLASS_ITEM_ID = ItemIdentifiers.SPYGLASS; // 31803

  const SALVAGING_HOOK_BASE_OBJECT_ID = api.core.CacheDefinitions.getLocId("sailing_intro_salvaging_hook");
  // The native client sends the placed parent; a visible-child click resolves to the same hook.
  const SALVAGING_HOOK_OBJECT_ID = ObjectIdentifiers.SALVAGING_HOOK_2;

  const VARP_SAILING_INTRO = 4959; // "sailing_intro_primary"
  const VARBIT_SAILING_INTRO = 18314; // sailing_intro, varp 4959 bits 0-5
  const VARBIT_REACHED_WRECK = 18315; // sailing_intro_reached_wreck, bit 6
  const VARBIT_RECEIVED_REPAIR_KITS = 18316; // sailing_intro_received_repairkits, bit 7
  const SHOP_PANDEMONIUM_PUB = 1415; // shops.json "The Pandemonium (pub)"

  // The values are the ones live sends (381/PandemoniumDiscord captures), and the ones
  // Quest Helper's loadSteps keys on. The old 1..16 ladder was invented and never matched
  // the client's quest state.
  const STAGE_INTERVIEW_DONE = 4;
  const STAGE_BOARDED = 6;
  const STAGE_SAILING = 8;
  const STAGE_SAIL_ACCEPTED = 10;
  const STAGE_ARRIVED = 12;
  const STAGE_SALVAGE_READY = 14;
  const STAGE_SALVAGED = 16;
  const STAGE_STEVE_ASKED = 18;
  const STAGE_RIBS_DONE = 20;
  const STAGE_JIM_TOLD = 22;
  const STAGE_CUP_OFFERED = 24;
  const STAGE_CUP_GIVEN = 26;
  const STAGE_BOAT_GRANTED = 28;
  const STAGE_HOLD_BUILT = 30;
  const STAGE_LOG_GIVEN = 32;
  const STAGE_JOB_ACCEPTED = 34;
  const STAGE_RAFT_BOARDED = 36;
  const STAGE_PORT_SARIM = 38;
  const STAGE_CARGO_BOARDED = 40;
  const STAGE_PANDEMONIUM = 42;
  const STAGE_CARGO_DELIVERED = 44;
  const STAGE_JIM_DONE = 46;
  const STAGE_GROG_DONE = 48;
  const STAGE_COMPLETE = 50;
  const STAGE_STARTED = 2;

  const SAILING_XP = 300;
  const CARGO_DELIVERY_XP = 100;
  const SAWMILL_COUPONS = 25;
  const REPAIR_KITS = 2;

  const STAGE_VERSION_ATTRIBUTE = "pandemonium:stage-version";
  const STAGE_VERSION = 2;
  const PAGE = "Pandemonium";
  const TUTORIAL_ATTRIBUTE = "pandemonium:tutorials";
  const TUTORIAL_HELM_ATTRIBUTE = "pandemonium:tutorial-helm";
  const TUTORIAL_SAILS_ATTRIBUTE = "pandemonium:tutorial-sails";
  const HINT_ARROW_VARBIT = 14192;
  const OBJECTBOX = 193;
  const START_HOOK = "quest:pandemonium:start";

  // Variant names (npc-dialogues.json, "Pandemonium" page).
  const WILL_START_VARIANT = "starting-off-talking-to-anne-or-will";
  const WILL_ABOARD_VARIANT = "at-the-boat-talking-to-anne-or-will";
  const WILL_SAIL_OFF_VARIANT = "at-the-boat-talking-to-will-or-anne-before-sailing-off";
  const WILL_DEPLOY_EARLY_VARIANT = "at-the-boat-deploying-the-salvaging-hook-before-sailing-off";
  const WILL_BACK_AT_PORT_VARIANT = "at-the-boat-talking-to-will-or-anne-back-at-port-sarim";
  const WILL_ARRIVAL_VARIANT = "reaching-the-salvaging-point";
  const WILL_ARRIVAL_AGAIN_VARIANT =
    "reaching-the-salvaging-point-talking-to-anne-or-will-after-they-explain-salvaging-or-interacting-with-the-helm-or-sails";
  const WILL_DEPLOY_VARIANT = "reaching-the-salvaging-point-deploying-the-salvaging-hook";
  const WILL_SWIM_VARIANT = "reaching-the-salvaging-point-swimming-to-shore";
  const STEVE_FIRST_VARIANT = "at-the-pandemonium-talking-to-squawking-steve-beanie";
  const STEVE_ASKED_AGAIN_VARIANT = "at-the-pandemonium-talking-to-squaking-steve-beanie-again";
  const STEVE_AFTER_RIBS_VARIANT = "at-the-pandemonium-talking-to-squawking-steve-beanie-again";
  const STEVE_SUBSEQUENT_VARIANT = "at-the-pandemonium-subsequent-dialogue-with-squawking-steve-beanie";
  const STEVE_FINALE_VARIANT = "talking-to-steve";
  const STEVE_POST_QUEST_VARIANT = "talking-to-steve-talking-to-steve-again-after-old-grog-departs";
  const RIBS_FIRST_VARIANT = "at-the-pandemonium-talking-to-ribs";
  const RIBS_AGAIN_VARIANT = "at-the-pandemonium-talking-to-ribs-again";
  const JIM_TRADE_VARIANT = "talking-to-junior-jim";
  const JIM_NO_CUP_VARIANT =
    "talking-to-junior-jim-talking-to-junior-jim-again-before-showing-him-the-cup-or-using-the-cup-on-him";
  const JIM_SHIPYARD_RETURN_VARIANT = "the-shipyard-talking-to-junior-jim-again-2";
  const JIM_AFTER_LOG_VARIANT = "the-shipyard-talking-to-junior-jim-after-he-gives-you-the-captain-s-log";
  const JIM_CARGO_PROGRESS_VARIANT = "at-the-pandemonium-talking-to-junior-jim-after-he-asks-for-the-cargo";
  const JIM_DELIVERED_VARIANT = "at-the-pandemonium-talking-to-junior-jim-after-depositing-the-cargo";
  const JIM_CRATE_HAMMERS_VARIANT = "the-shipyard-taking-from-the-crate-of-hammers";
  const JIM_CRATE_SAWS_VARIANT = "the-shipyard-taking-from-the-crate-of-saws";
  const JIM_SCHEMATICS_BEFORE_VARIANT = "the-shipyard-modify-boat-schematics-before-building-the-cargo-hold";
  const JIM_SCHEMATICS_AFTER_VARIANT = "the-shipyard-attempting-to-modify-the-cargo-hold";
  const JIM_BUILD_VARIANT = "the-shipyard-building-the-cargo-hold";
  const PORT_MASTER_SARIM_VARIANT = "at-port-sarim-talking-to-the-port-master";
  const PORT_MASTER_PANDEMONIUM_VARIANT = "at-the-pandemonium-talking-to-the-port-master";
  const PORT_MASTER_DONE_VARIANT = "at-the-pandemonium-talking-to-the-port-master-after-dropping-off-the-cargo";

  // Condition step ids on the "Pandemonium" page (research pack).
  const CANNOT_START_CONDITION_ID = "W3C3C9";
  const INTERVIEW_NO_SPACE_CONDITION_ID = "CCJ1aq";
  const BACK_NO_SPACE_CONDITION_ID = "jS98T4";
  const DEPLOY_NO_SPACE_CONDITION_ID = "XUpDAq";
  const STEVE_NOT_ASKED_CONDITION_ID = "CNjUL8";
  const CUP_RECOVERY_NO_SPACE_CONDITION_ID = "43Ms0-";
  const LOST_OLD_CUP_CONDITION_ID = "A7s0Gf";
  const LOST_CUP_CONDITION_ID = "hf2_5G";
  const HAS_CUP_CONDITION_ID = "a8695u";
  const NO_BOTH_TOOLS_CONDITION_ID = "WjitRI";
  const HAS_BOTH_TOOLS_CONDITION_ID = "3rjK-a";
  const NO_HAMMER_CONDITION_ID = "Q7H8oK";
  const HAS_HAMMER_CONDITION_ID = "xuFc3_";
  const NO_SAW_CONDITION_ID = "N0YXhs";
  const HAS_SAW_CONDITION_ID = "VWaptx";
  const LOG_NO_SPACE_CONDITION_ID = "K30w8b";
  const LOG_AGAIN_NO_SPACE_CONDITION_ID = "JFe9GO";
  const SARIM_HAS_CARGO_CONDITION_ID = "abPgqO";
  const JIM_NO_CARGO_CONDITION_ID = "dnoJFg";
  const JIM_HAS_CARGO_CONDITION_ID = "p6q3K5";
  const PAN_NO_CARGO_CONDITION_ID = "ypYvbi";
  const PAN_HAS_CARGO_CONDITION_ID = "TpqvDF";

  // Message/action step ids whose side effects this plugin performs.
  const BOARD_SHIP_ACTION_ID = "BDfVg8";
  const GO_BACK_TO_PORT_ACTION_ID = "VuZpfc";
  const GO_BACK_TO_SHIP_ACTION_ID = "Nm7LVw";
  const SALVAGE_MESSAGE_ID = "p40qKY";
  const SHOW_SALVAGE_MESSAGE_ID = "tHqfi7";
  const PUSH_OVERBOARD_ACTION_ID = "hQBGdU";
  const WALK_TO_PANDEMONIUM_ACTION_ID = "dpOs4I";
  const CUP_RECOVERY_MESSAGE_ID = "P7HYtI";
  const GIVE_CUP_MESSAGE_ID = "jkS3Ej";
  const GO_TO_SHIPYARD_ACTION_ID = "TIfJ86";
  const TAKE_HAMMER_MESSAGE_ID = "niwCRR";
  const TAKE_SAW_MESSAGE_ID = "CnlEDp";
  const BUILD_HOLD_MESSAGE_ID = "bu1EIn";
  const BACK_TO_PANDEMONIUM_ACTION_ID = "HrNl3J";
  const LOG_GIVEN_MESSAGE_ID = "7jgwOg";
  const LOG_AGAIN_GIVEN_MESSAGE_ID = "g4CUrq";
  const CARGO_REQUEST_MESSAGE_ID = "DgYchr";
  const TAKE_CARGO_MESSAGE_ID = "8bdD6i";
  const DELIVER_CARGO_MESSAGE_ID = "Bvs9Sf";
  const OLD_GROG_DEPARTS_MESSAGE_ID = "C5l2Ww";
  const QUEST_COMPLETE_ACTION_ID = "SJ3WVd";
  const OPEN_SHOP_ACTION_ID = "n-AhO0";

  // Option and line texts the stage changes key on.
  const BOARDING_DONE_LINE = "Take the helm when ready.";
  const INTERVIEW_DONE_LINE = "Just let us know when you're ready, and we'll hop aboard!";
  const STEVE_RIBS_LINE = "speak to Ribs";
  const STEVE_JIM_LINE = "speak with Junior Jim";
  const JIM_FAREWELL_LINE = "Don't mention it, mate.";
  const CHEEKY_DIP_LINE = "cheeky dip";

  // Quest-only scenery and teleport tiles (quest-helper/cache positions; the ledgers and
  // gangplank are absent from this world's maps, the boat deck is the cache's own scene).
  // The tutorial ship is the shared static-ship blueprint (owner-only for this player), with
  // its captured helm, sails and salvaging hook. The wreck is already in the real world map.
  const TUTORIAL_SHIP_ID = "pandemonium_tutorial_ship";
  const TUTORIAL_WILL_TILE = { x: 4, y: 3 };
  const TUTORIAL_ANNE_TILE = { x: 3, y: 2 };
  const PORT_SARIM_TILE = { x: 3025, y: 3209, z: 0 };
  const PANDEMONIUM_LANDING_TILE = { x: 3069, y: 2987, z: 0 };
  const PANDEMONIUM_PUB_TILE = { x: 3050, y: 2967, z: 0 };
  const SHIPYARD_TILE = { x: 2084, y: 2730, z: 0 };
  const STEVE_SPAWN_TILE = { x: 3050, y: 2966, z: 0 };
  const RIBS_SPAWN_TILE = { x: 3051, y: 2974, z: 0 };
  const OLD_GROG_SPAWN_TILE = { x: 3049, y: 2966, z: 0 };
  const PORT_SARIM_LEDGER_TILE = { x: 3028, y: 3194 };
  const PANDEMONIUM_LEDGER_TILE = { x: 3061, y: 2985 };
  const PORT_SARIM_LEDGER_BASE = api.core.CacheDefinitions.getLocId("dock_loading_bay_ledger_table_port_sarim");
  const PANDEMONIUM_LEDGER_BASE = api.core.CacheDefinitions.getLocId("dock_loading_bay_ledger_table_pandemonium");

  let quest;
  let questObjectsInstalled = false;
  const steveByPlayer = new WeakMap();
  const ribsByPlayer = new WeakMap();
  const boatCrewByPlayer = new WeakMap();
  const oldGrogByPlayer = new WeakMap();

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const freeSlots = (player) => player.getInventory().getFreeSlots();
  const isSteve = (npcId) => STEVE_NPC_IDS.has(npcId);
  const isJim = (npcId) => JIM_NPC_IDS.has(npcId);

  const QUEST_PORT_TASK_ID = 599; // "Pandemonium ship part delivery" (data/port-tasks.json)
  const PANDEMONIUM_DOCK_ID = "the_pandemonium";

  /** Jim gives the cup's new owner a raft in their next free boat slot, as live does. */
  function grantRaft(player) {
    const state = player.getSailing?.();
    if (!state) return;
    if (state.boats.some((boat) => boat.type === "raft")) return;
    const raft = Sailing.giveBoat(player, "raft", PANDEMONIUM_DOCK_ID);
    if (!raft) return;
    // The quest gives a bare raft: the cargo hold is built at the shipyard.
    raft.facilities = new Array(BoatFacilities.hotspotsOf(raft.type).length).fill(0);
  }

  /** Puts Jim's cargo task in the player's first port-task slot, as the log does. */
  function assignCargoTask(player) {
    const slots = PortTasks.slots(player);
    if (slots.some((slot) => slot?.id === QUEST_PORT_TASK_ID)) return true;
    const index = slots.findIndex((slot) => !slot);
    if (index < 0) return false;
    slots[index] = { id: QUEST_PORT_TASK_ID, taken: 0, delivered: 0 };
    PortTasks.setSlots(player, slots);
    return true;
  }

  function questRaft(player) {
    return player.getSailing?.()?.boats.find((boat) => boat.type === "raft");
  }

  /** Sailing's own board/leave events carry the quest's boat legs. */
  function handleBoarded({ player }) {
    const stage = quest.getStage(player);
    if (stage === STAGE_JOB_ACCEPTED) {
      quest.setStage(player, STAGE_RAFT_BOARDED);
      return;
    }
    if (stage === STAGE_PORT_SARIM) quest.setStage(player, STAGE_CARGO_BOARDED);
  }

  function handleLeft({ player, reason }) {
    if (reason !== "disembark") return;
    const stage = quest.getStage(player);
    if (stage === STAGE_RAFT_BOARDED) quest.setStage(player, STAGE_PORT_SARIM);
    else if (stage === STAGE_CARGO_BOARDED) quest.setStage(player, STAGE_PANDEMONIUM);
  }

  function teleport(player, tile, onArrival) {
    TeleportHandler.teleport(player, new Location(tile.x, tile.y, tile.z), TeleportType.NORMAL, false, onArrival);
  }

  /**
   * Moves the player once the dialogue has closed. A step's teleport closes the chatbox
   * (TeleportHandler.onTeleporting), which would cut off the lines that follow it in the
   * transcript (TIfJ86, HrNl3J, dpOs4I), so those wait for the chatbox to be gone.
   */
  function teleportAfterDialogue(player, tile, onArrival) {
    const { CountdownTask, TaskManager, MultiChatboxPrompt } = api.core;
    TaskManager.submit(
      new CountdownTask(player, 1, () => {
        if (player.isRegistered?.() === false) return;
        const chatbox = player.getDialogueManager?.()?.isActive?.() === true
          || (MultiChatboxPrompt?.getPending?.(player) ?? null) !== null;
        if (chatbox) {
          teleportAfterDialogue(player, tile, onArrival);
          return;
        }
        teleport(player, tile);
        onArrival?.();
      })
    );
  }

  function removeTracked(player, map) {
    const npc = map.get(player);
    if (npc) api.removeNpc(npc);
    map.delete(player);
  }

  function hasNpcNear(player, npcId, tile, range = 10) {
    for (const npc of api.getWorld().getNpcs()) {
      if (npc.getId?.() !== npcId) continue;
      // Another player's owner-only spawn is invisible here and must not stand in for ours.
      if (npc.isOwnerOnly?.() && npc.getOwner?.() !== player) continue;
      const location = npc.getLocation?.();
      if (!location || location.getZ() !== tile.z) continue;
      if (Math.max(Math.abs(location.getX() - tile.x), Math.abs(location.getY() - tile.y)) <= range) {
        return true;
      }
    }
    return false;
  }

  function spawnOwnerNpc(npcId, tile, owner) {
    return api.spawnNpc({
      id: npcId,
      x: tile.x,
      y: tile.y,
      z: tile.z,
      wanderRadius: 0,
      owner,
      ownerOnly: true,
    });
  }

  const tutorialScenes = new Map();
  const salvageScenes = new Map();
  // RSProx381 uses these fixed cache scenes after Deploy, separate from the sailing entity.
  const SALVAGE_MAP = { x: 1472, y: 4480 };
  const SHORE_MAP = { x: 3008, y: 2944 };
  const SHORE_EXIT = { x: 3049, y: 2970, z: 0 };
  const WILL_CUTSCENE_ID = api.core.CacheDefinitions.getNpcId("sailing_intro_will_cutscene");
  const ANNE_CUTSCENE_ID = api.core.CacheDefinitions.getNpcId("sailing_intro_anne_cutscene");
  const MEDALLION_ITEM_ID = api.core.CacheDefinitions.getObjId("sailing_intro_medallion");
  const SCENE_SEQUENCES = Object.fromEntries(Object.entries({
    lower: "sailing_human_salvage_hook_kandarin_2x5_drop01",
    reset: "sailing_human_salvage_hook_kandarin_2x5_reset01",
    overboard: "sailing_intro_human_overboard",
    push: "sailing_intro_anne_push",
    floor: "human_onfloor",
    getUp: "human_getup_priority_10",
  }).map(([key, name]) => [key, api.core.CacheDefinitions.getSeqId(name)]));

  class SalvageSceneArea extends api.core.TemplatedInstanceArea {
    constructor(scene) {
      super(8, 8);
      this.scene = scene;
      this.setSource(SALVAGE_MAP);
    }
    getName() { return "Pandemonium"; }
    sourceTile(x, y, z) { return this.tile(x - this.source.x, y - this.source.y, z); }
    setSource(source) {
      this.source = source;
      for (let z = 0; z < 4; z++) for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
        this.setChunk(z, x, y, { sourceChunkX: source.x / 8 + x, sourceChunkY: source.y / 8 + y, sourcePlane: z, rotation: 0 });
      }
    }
    canTeleport() { return false; }
    canAttack() { return false; }
    npcAggression() { return false; }
    process(mobile) {
      if (mobile === this.scene.player && !canContinueSalvage(this.scene)) endSalvageScene(mobile);
    }
    postLeave(mobile, logout) {
      if (mobile === this.scene.player && salvageScenes.get(mobile) === this.scene) {
        endSalvageScene(mobile, logout, false, logout);
      }
      super.postLeave(mobile, logout);
    }
  }

  function canContinueSalvage(scene) {
    const player = scene.player;
    if (salvageScenes.get(player) !== scene || !player.isRegistered() || player.getHitpoints() <= 0 || player.isDying
      || quest.getStage(player) !== STAGE_SALVAGE_READY || player.getPrivateArea() !== scene.area) return false;
    const manager = player.getDialogueManager();
    return scene.phase === "dialogue"
      ? manager.isActive() && manager.getOwner() === scene.dialogueOwner
      : manager.getCurrent() === scene.holdDialogue;
  }

  function salvageLater(scene, ticks, action) {
    Scenes.later(scene, ticks, () => {
      if (salvageScenes.get(scene.player) !== scene) return;
      if (!canContinueSalvage(scene)) return endSalvageScene(scene.player);
      action();
    });
  }

  function holdSalvage(scene, phase) {
    const player = scene.player;
    const previousPlayback = scene.playback;
    scene.playback?.cancel?.();
    // A synchronous close callback may have opened a different feature's prompt.
    if (previousPlayback && player.getDialogueManager().isActive()) { endSalvageScene(player); return false; }
    scene.phase = phase;
    scene.holdOwner = Object.freeze({});
    player.getPacketSender().withChatboxOwner(scene.holdOwner, () => Scenes.hold(player));
    scene.holdDialogue = player.getDialogueManager().getCurrent();
    return true;
  }

  function salvagePose(scene, mobile, sequence) {
    const animation = new api.core.Animation(sequence);
    mobile.performAnimation(animation);
    if (mobile === scene.player && mobile.getAnimation() === animation) scene.playerAnimationGeneration = mobile.getAnimationGeneration();
  }

  function salvageCamera(scene, move, look) {
    const from = scene.area.sourceTile(move[0], move[1], scene.plane);
    const to = scene.area.sourceTile(look[0], look[1], scene.plane);
    scene.player.getPacketSender()
      .sendCameraMoveTo(from.getX(), from.getY(), 550, { rate: 232, rate2: 100, heightRelative: false })
      .sendCameraLookAt(to.getX(), to.getY(), 350, { rate: 232, rate2: 100, heightRelative: false });
  }

  function playSalvage(scene, variant = WILL_DEPLOY_VARIANT, select) {
    scene.phase = "dialogue";
    scene.variant = variant;
    const npc = variant === WILL_DEPLOY_VARIANT ? scene.will : null;
    scene.playback = { player: scene.player, npc, npcId: npc?.getId() ?? STEVE_NPC_ID,
      variant: { page: PAGE, variant }, exact: true, select };
    api.emitCustomEvent("npc-dialogue:start", scene.playback);
    scene.dialogueOwner = scene.player.getDialogueManager().getOwner();
    if (!scene.playback.handled || !scene.player.getDialogueManager().isActive()) endSalvageScene(scene.player);
  }

  function beginSalvageScene(player) {
    if (salvageScenes.has(player)) return;
    endTutorialShip(player);
    const scene = { player, actors: [], phase: "opening", plane: 1 };
    scene.area = new SalvageSceneArea(scene);
    salvageScenes.set(player, scene);
    scene.area.enter(player);
    player.moveTo(scene.area.sourceTile(1498, 4512, 1));
    player.setPositionToFace(scene.area.sourceTile(1497, 4512, 1));
    Scenes.controls(player, true, true);
    Scenes.fade(player, true);
    if (!holdSalvage(scene, "opening")) return;
    for (const [key, id, x, y] of [["will", WILL_CUTSCENE_ID, 1498, 4510], ["anne", ANNE_CUTSCENE_ID, 1499, 4511]]) {
      const at = scene.area.sourceTile(x, y, 1);
      const npc = api.spawnNpc({ id, x: at.getX(), y: at.getY(), z: 1, owner: player, ownerOnly: true, wanderRadius: 0 });
      scene.area.add(npc);
      scene.actors.push(npc);
      scene[key] = npc;
      npc.setPositionToFace(scene.area.sourceTile(1498, 4512, 1));
    }
    // The owner and actors must receive their new native map/NPC context first.
    salvageLater(scene, 2, () => {
      player.getPacketSender().sendCameraTarget({ player: player.getIndex() });
      salvageCamera(scene, [1490, 4509], [1510, 4514]);
      Scenes.fade(player, false);
      playSalvage(scene);
    });
  }

  function lowerSalvageHook(scene) {
    if (!holdSalvage(scene, "lowering")) return;
    salvagePose(scene, scene.player, SCENE_SEQUENCES.lower);
    salvageLater(scene, 3, () => salvagePose(scene, scene.player, SCENE_SEQUENCES.reset));
    salvageLater(scene, 5, () => {
      salvagePose(scene, scene.player, api.core.Animation.DEFAULT_RESET_ANIMATION.getId());
      playSalvage(scene, WILL_DEPLOY_VARIANT,
        steps => !held(scene.player, OLD_CUP_ITEM_ID) && freeSlots(scene.player) < 1
          ? steps.slice(0, 1) : steps.slice(steps.findIndex(step => step.id === SALVAGE_MESSAGE_ID)));
    });
  }

  function approachSalvageCrew(scene) {
    const queue = scene.player.getMovementQueue();
    queue.reset().setBlockMovement(false);
    queue.walkStep(0, -1);
    scene.anne.setPositionToFace(scene.area.sourceTile(1498, 4511, 1));
    salvageLater(scene, 2, () => queue.reset().setBlockMovement(true));
  }

  function pushFromSalvageShip(scene) {
    if (!holdSalvage(scene, "overboard")) return;
    Scenes.fade(scene.player, true);
    salvageLater(scene, 1, () => {
      salvagePose(scene, scene.player, SCENE_SEQUENCES.overboard);
      salvagePose(scene, scene.anne, SCENE_SEQUENCES.push);
    });
    salvageLater(scene, 8, () => {
      for (const npc of scene.actors.splice(0)) api.removeNpc(npc);
      scene.area.setSource(SHORE_MAP);
      scene.plane = 0;
      scene.player.moveTo(scene.area.sourceTile(3034, 2995, 0));
    });
    salvageLater(scene, 9, () => {
      salvagePose(scene, scene.player, SCENE_SEQUENCES.floor);
      salvageCamera(scene, [3026, 3000], [3036, 2993]);
      Scenes.fade(scene.player, false);
    });
    salvageLater(scene, 13, () => salvagePose(scene, scene.player, SCENE_SEQUENCES.getUp));
    salvageLater(scene, 15, () => playSalvage(scene, WILL_SWIM_VARIANT));
  }

  function finishSalvageScene(scene) {
    if (!holdSalvage(scene, "finishing")) return;
    Scenes.fade(scene.player, true);
    salvageLater(scene, 6, () => {
      scene.finished = true;
      // Commit with the normal-world landing; a saved16 can never refer to this temporary map.
      quest.setStage(scene.player, STAGE_SALVAGED);
      endSalvageScene(scene.player, false, false, false);
      scene.player.moveTo(new Location(SHORE_EXIT.x, SHORE_EXIT.y, SHORE_EXIT.z));
      ensureSteve(scene.player);
    });
  }

  function endSalvageScene(player, logout = false, restore = true, relocate = true) {
    const scene = salvageScenes.get(player);
    if (!scene) return;
    salvageScenes.delete(player);
    api.core.TaskManager.cancelTasks(scene);
    scene.playback?.cancel?.();
    const manager = player.getDialogueManager();
    if (manager.getCurrent() === scene.holdDialogue) {
      player.getPacketSender().closeChatboxFor(scene.holdOwner);
      if (manager.getCurrent() === scene.holdDialogue) manager.reset();
    }
    for (const npc of scene.actors.splice(0)) api.removeNpc(npc);
    if (player.getPrivateArea() === scene.area) scene.area.leave(player, logout);
    scene.area.destroy();
    const dead = player.getHitpoints() <= 0 || player.isDying;
    const blocked = player.getMovementQueue().isMovementBlocked(), untargetable = player.isUntargetable();
    Scenes.closeFade(player);
    Scenes.controls(player, false);
    if (dead) {
      player.getMovementQueue().setBlockMovement(blocked);
      player.setUntargetable(untargetable);
    } else if (scene.playerAnimationGeneration !== undefined && player.getAnimationGeneration() === scene.playerAnimationGeneration) {
      player.performAnimation(api.core.Animation.DEFAULT_RESET_ANIMATION);
    }
    player.getPacketSender().sendCameraReset();
    if (relocate) {
      player.moveTo(new Location(PORT_SARIM_TILE.x, PORT_SARIM_TILE.y, PORT_SARIM_TILE.z));
      if (restore && !logout && !dead && player.isRegistered() && quest.getStage(player) === STAGE_SALVAGE_READY) {
        startTutorialShip(player, { atWreck: true });
      }
    }
  }

  function handleSalvageDeath({ player }) { endSalvageScene(player, false, false); }

  function ownsSalvageSource(event, scene) {
    return scene && scene.phase === "dialogue" && scene.player.isRegistered()
      && scene.player.getHitpoints() > 0 && !scene.player.isDying
      && quest.getStage(scene.player) === STAGE_SALVAGE_READY && scene.player.getPrivateArea() === scene.area
      && event.pages?.some(({ page, variants }) => page === PAGE && variants?.includes(scene.variant));
  }

  function handleSalvageLine(event) {
    const scene = salvageScenes.get(event.player);
    if (!ownsSalvageSource(event, scene)) return false;
    if (event.step?.speaker === "Will") event.speakerId = WILL_CUTSCENE_ID;
    if (event.step?.speaker === "Anne") event.speakerId = ANNE_CUTSCENE_ID;
    if (scene.variant === WILL_DEPLOY_VARIANT) {
      if (event.text === "Right then, let's give this a go.") event.after = () => lowerSalvageHook(scene);
      if (event.text === "Well?") event.before = () => scene.player.setPositionToFace(scene.will.getLocation());
      if (event.text === "What do you make of these?") event.after = () => approachSalvageCrew(scene);
      if (event.text === "That's right! And now that we've found it, I'm afraid we don't really need you anymore.") {
        event.before = () => scene.player.setPositionToFace(scene.anne.getLocation());
      }
    }
    return true;
  }
  // Owned tutorial entity16 in rsprox381: the 2x5 ship's observed start and stopped wreck root.
  const TUTORIAL_START_FINE = { fineX: 3056 * 128 + 64, fineY: 3190 * 128 + 64 };
  const WORLD_WRECK_FINE = { fineX: 3035 * 128 + 32, fineY: 3048 * 128 + 96 };
  const WORLD_WRECK_TILE = { x: 3035, y: 3048 };
  const WORLD_WRECK_ZONE = { minX: 3018, maxX: 3040, minY: 3030, maxY: 3050 };
  // Capture381's headings at367/393/399/429 are client inputs, not an automatic course.

  function tutorialScene(player) {
    return tutorialScenes.get(player) ?? null;
  }

  function tutorialPartIds(scene, part) {
    const spec = scene && BoatManager.getSpec(scene.boat);
    return new Set((spec?.locs ?? []).filter((loc) => loc.part === part).map((loc) => loc.id));
  }

  function showTutorialBoxes(player, boxes) {
    const { DialogueChainBuilder, ItemStatementDialogue, ActionDialogue } = api.core;
    const chain = new DialogueChainBuilder();
    boxes.forEach((box, index) => {
      chain.add(new ItemStatementDialogue(index, box.item, box.text));
      chain.add(new ActionDialogue(index + 1, { execute: () => {
        if (box.hint) {
          player.getPacketSender().sendVarbit(HINT_ARROW_VARBIT, 1);
          player.getPacketSender().sendPositionalHint(new Location(box.hint.x, box.hint.y, box.hint.z ?? 0), box.hint.position, box.hint.height);
        } else {
          player.getPacketSender().sendVarbit(HINT_ARROW_VARBIT, 0).clearHintArrow();
        }
      } }));
    });
    player.getDialogueManager().startDialogues(chain);
  }

  function showDockingTutorial(player) {
    const tutorials = Number(player.getAttribute(TUTORIAL_ATTRIBUTE)) || 0;
    if (tutorials & 1) return;
    player.setAttribute(TUTORIAL_ATTRIBUTE, tutorials | 1);
    showTutorialBoxes(player, [{
      item: 32914,
      text: "You can embark or disembark from your boat via docking points found around the world. To find a docking point, just look for the relevant icon on your map.",
      hint: { x: 3070, y: 2987, height: 30, position: 3 },
    }]);
  }

  function showTaskLogTutorials(player) {
    const tutorials = Number(player.getAttribute(TUTORIAL_ATTRIBUTE)) || 0;
    if ((tutorials & 6) === 6) return;
    player.setAttribute(TUTORIAL_ATTRIBUTE, tutorials | 6);
    showTutorialBoxes(player, [
      { item: 32913, text: "Port tasks can be accepted from notice boards found at various ports around the world. To find a notice board, just look for the relevant icon on your map.", hint: { x: 3058, y: 2986, height: 140, position: 2 } },
      { item: 31986, text: "Your captain's log contains details on how to chart the sea. You can consult the log at any time for hints on what to chart. Charles in the cave on the Pandemonium can also help you out with sea charting.", hint: { x: 3046, y: 2997, height: 110, position: 6 } },
    ]);
  }

  function startTutorialShip(player, { atWreck = false } = {}) {
    endTutorialShip(player);
    const stage = quest.getStage(player);
    const ship = StaticShips.spawn(TUTORIAL_SHIP_ID, {
      owner: player,
      ownerOnly: true,
      ...(atWreck ? { ...WORLD_WRECK_FINE, angle: 0 } : { ...TUTORIAL_START_FINE, angle: 0 }),
    });
    if (!ship) return false;
    const deck = BoatManager.getDeck(ship.boat);
    const will = StaticShips.addDeckNpc(ship, WILL_BOAT_RAW_NPC_ID, TUTORIAL_WILL_TILE.x, TUTORIAL_WILL_TILE.y, player);
    const anne = StaticShips.addDeckNpc(ship, ANNE_BOAT_RAW_NPC_ID, TUTORIAL_ANNE_TILE.x, TUTORIAL_ANNE_TILE.y, player);
    StaticShips.board(player, ship);
    const helmTaken = atWreck || (stage >= STAGE_SAIL_ACCEPTED && player.getAttribute(TUTORIAL_HELM_ATTRIBUTE) === true);
    const sailsRaised = atWreck || (stage >= STAGE_SAIL_ACCEPTED && player.getAttribute(TUTORIAL_SAILS_ATTRIBUTE) === true);
    const scene = { boat: ship.boat, deck, will, anne, staticShip: ship, helmTaken, sailsRaised, voyageStarted: false, arrived: atWreck };
    tutorialScenes.set(player, scene);
    api.emitCustomEvent("sailing:board-supplied-panel", { player, boat: scene.boat, stopped: atWreck, accepted: false });
    if (helmTaken && !atWreck) {
      const request = { player, boat: scene.boat, accepted: false };
      api.emitCustomEvent("sailing:take-helm", request);
      scene.helmTaken = request.accepted === true;
    }
    scene.boat.moveMode = sailingContent.MOVE_MODE.STOPPED;
    if (scene.helmTaken && sailsRaised && !atWreck) api.emitCustomEvent("sailing:set-supplied-sails", {
      player, boat: scene.boat, mode: "full", accepted: false,
    });
    if (!atWreck) tutorialFadeIn(player, scene);
    return true;
  }

  function tutorialFadeIn(player, scene) {
    Scenes.fade(player, true);
    Scenes.later(player, 1, () => {
      if (tutorialScene(player) !== scene || !StaticShips.isAboard(player, scene.staticShip)) return;
      player.getPacketSender().sendCameraTarget({ worldEntity: scene.boat.entityIndex });
      Scenes.later(player, 1, () => Scenes.fade(player, false));
    });
  }

  function startBoardingDialogue(player, scene) {
    if (tutorialScene(player) !== scene || !StaticShips.isAboard(player, scene.staticShip)
      || !player.isRegistered() || player.getHitpoints() <= 0 || player.isDying
      || quest.getStage(player) !== STAGE_BOARDED || player.getDialogueManager().isActive()
      || player.getPacketSender().hasInterruptibleInterface()) return;
    scene.will.setMobileInteraction(player);
    startTranscript(api, player, WILL_NPC_ID, PAGE, WILL_ABOARD_VARIANT, undefined, scene.will);
  }

  function handleTutorialDialogueLine(event) {
    const { player, step, pages } = event;
    const scene = tutorialScene(player);
    const actor = step?.speaker === "Will" ? scene?.will : step?.speaker === "Anne" ? scene?.anne : null;
    if (!actor || !pages?.some(({ page }) => page === PAGE)
      || (event.npc && event.npc !== scene.will && event.npc !== scene.anne)) return;
    const previous = event.before;
    event.before = () => {
      const current = player.getDialogueManager().getCurrent();
      previous?.();
      if (player.getDialogueManager().getCurrent() !== current || tutorialScene(player) !== scene
        || !player.isRegistered() || player.getHitpoints() <= 0 || player.isDying
        || !StaticShips.isAboard(player, scene.staticShip) || !actor.isRegistered() || actor.getOwner() !== player
        || actor.getPrivateArea() !== player.getPrivateArea()
        || quest.getStage(player) < STAGE_BOARDED || quest.getStage(player) > STAGE_SALVAGE_READY) return;
      player.setMobileInteraction(null);
      player.setPositionToFace(actor.getLocation());
      if (quest.getStage(player) === STAGE_BOARDED && step.speaker === "Anne"
        && event.text.endsWith(BOARDING_DONE_LINE)
        && pages.some(({ page, variants }) => page === PAGE && variants?.includes(WILL_ABOARD_VARIANT))) {
        quest.setStage(player, STAGE_SAILING);
      }
    };
  }

  function endTutorialShip(player, reason) {
    const scene = tutorialScenes.get(player);
    if (!scene) return;
    tutorialScenes.delete(player);
    api.emitCustomEvent("sailing:leave-helm", { player, boat: scene.boat });
    api.emitCustomEvent("sailing:leave-supplied-panel", { player, boat: scene.boat, reason });
    Scenes.cancel(player);
    Scenes.closeFade(player);
    if (scene.will) api.removeNpc(scene.will);
    if (scene.anne) api.removeNpc(scene.anne);
    if (StaticShips.isAboard(player, scene.staticShip)) StaticShips.leave(player);
    StaticShips.dispose(scene.staticShip);
    Scenes.controls(player, false);
    player.getPacketSender().sendCameraReset();
  }

  function ensureOldGrog(player) {
    if (oldGrogByPlayer.get(player)?.isRegistered?.()) return;
    const npc = spawnOwnerNpc(OLD_GROG_NPC_ID, OLD_GROG_SPAWN_TILE, player);
    if (npc) oldGrogByPlayer.set(player, npc);
  }

  function removeOldGrog(player) {
    removeTracked(player, oldGrogByPlayer);
  }

  function ensureRibs(player) {
    if (ribsByPlayer.get(player)?.isRegistered?.()) return;
    const npc = spawnOwnerNpc(RIBS_RAW_NPC_ID, RIBS_SPAWN_TILE, player);
    if (npc) ribsByPlayer.set(player, npc);
  }

  /**
   * Steve is spawned one tick late: Prying Times owner-spawns him at the same tile in
   * its own login hook, so waiting a tick lets this plugin find and keep that one
   * instead of putting two Steves on top of each other.
   */
  function scheduleEnsureSteve(player) {
    const { CountdownTask, TaskManager } = api.core;
    TaskManager.submit(new CountdownTask(player, 1, () => ensureSteve(player)));
  }

  function ensureSteve(player) {
    if (steveByPlayer.get(player)?.isRegistered?.()) return;
    // Prying Times already owner-spawns the raw base 14967 here.
    if (hasNpcNear(player, STEVE_RAW_NPC_ID, STEVE_SPAWN_TILE)) return;
    const npc = spawnOwnerNpc(STEVE_RAW_NPC_ID, STEVE_SPAWN_TILE, player);
    if (npc) steveByPlayer.set(player, npc);
  }

  function openPandemoniumShop(player) {
    const { CountdownTask, TaskManager } = api.core;
    TaskManager.submit(new CountdownTask(player, 1, () => ShopManager.open(player, SHOP_PANDEMONIUM_PUB)));
  }

  // ==========================================================================
  // Variant selection and condition answers
  // ==========================================================================

  function jimVariant(player, stage) {
    if (quest.isComplete(player)) return null; // his standard page takes over
    switch (stage) {
      case STAGE_JIM_TOLD:
        if (held(player, OLD_CUP_ITEM_ID)) {
          quest.setStage(player, STAGE_CUP_OFFERED);
          return JIM_TRADE_VARIANT;
        }
        return JIM_NO_CUP_VARIANT;
      case STAGE_CUP_OFFERED:
        return held(player, OLD_CUP_ITEM_ID) ? JIM_TRADE_VARIANT : JIM_NO_CUP_VARIANT;
      case STAGE_CUP_GIVEN:
      case STAGE_BOAT_GRANTED:
        // Only "talking-to-junior-jim" carries the TIfJ86 shipyard action; replaying it
        // after an interrupted hand-in is what keeps the route recoverable.
        return JIM_TRADE_VARIANT;
      case STAGE_HOLD_BUILT:
        return JIM_SHIPYARD_RETURN_VARIANT;
      case STAGE_LOG_GIVEN:
        return JIM_AFTER_LOG_VARIANT;
      case STAGE_JOB_ACCEPTED:
        return JIM_CARGO_PROGRESS_VARIANT;
      case STAGE_CARGO_DELIVERED:
        return JIM_DELIVERED_VARIANT;
      default:
        return null;
    }
  }

  /** Which transcript variant the NPC plays, scoped to the quest's own NPCs and stages. */
  function selectVariant({ npcId, player }) {
    const complete = quest.isComplete(player);
    const stage = quest.getStage(player);
    if (isSteve(npcId)) {
      if (complete) return STEVE_POST_QUEST_VARIANT;
      if (stage >= STAGE_JIM_DONE) {
        ensureOldGrog(player);
        return STEVE_FINALE_VARIANT;
      }
      removeOldGrog(player);
      if (stage >= STAGE_JIM_TOLD) return STEVE_SUBSEQUENT_VARIANT;
      if (stage >= STAGE_RIBS_DONE) return STEVE_AFTER_RIBS_VARIANT;
      if (stage >= STAGE_STEVE_ASKED) return STEVE_ASKED_AGAIN_VARIANT;
      if (stage >= STAGE_SALVAGED) return STEVE_FIRST_VARIANT;
      return null;
    }
    if (npcId === RIBS_NPC_ID) {
      if (complete || stage >= STAGE_RIBS_DONE) return RIBS_AGAIN_VARIANT;
      if (stage >= STAGE_STEVE_ASKED) return RIBS_FIRST_VARIANT;
      return null;
    }
    if (isJim(npcId)) return jimVariant(player, stage);
    if (npcId === PORT_MASTER_SARIM_NPC_ID) {
      return stage >= STAGE_LOG_GIVEN && stage < STAGE_PORT_SARIM ? PORT_MASTER_SARIM_VARIANT : null;
    }
    if (npcId === PORT_MASTER_PANDEMONIUM_NPC_ID) {
      if (stage === STAGE_PANDEMONIUM) return PORT_MASTER_PANDEMONIUM_VARIANT;
      if (stage >= STAGE_CARGO_DELIVERED && stage < STAGE_JIM_DONE) return PORT_MASTER_DONE_VARIANT;
      return null;
    }
    return null;
  }

  /** Answers the wiki prose conditions, scoped by the page's own step ids. */
  function answerCondition({ player, stepId }) {
    switch (stepId) {
      case CANNOT_START_CONDITION_ID:
        return false; // no requirements
      case INTERVIEW_NO_SPACE_CONDITION_ID:
      case BACK_NO_SPACE_CONDITION_ID:
      case CUP_RECOVERY_NO_SPACE_CONDITION_ID:
      case LOG_NO_SPACE_CONDITION_ID:
      case LOG_AGAIN_NO_SPACE_CONDITION_ID:
        return freeSlots(player) < 1;
      case DEPLOY_NO_SPACE_CONDITION_ID:
        return !held(player, OLD_CUP_ITEM_ID) && freeSlots(player) < 1;
      case STEVE_NOT_ASKED_CONDITION_ID:
        return quest.getStage(player) < STAGE_STEVE_ASKED;
      case LOST_OLD_CUP_CONDITION_ID:
      case LOST_CUP_CONDITION_ID:
        return !held(player, OLD_CUP_ITEM_ID);
      case HAS_CUP_CONDITION_ID:
        return held(player, OLD_CUP_ITEM_ID);
      case NO_BOTH_TOOLS_CONDITION_ID:
        return !(held(player, HAMMER_ITEM_ID) && held(player, SAW_ITEM_ID));
      case HAS_BOTH_TOOLS_CONDITION_ID:
        return held(player, HAMMER_ITEM_ID) && held(player, SAW_ITEM_ID);
      case NO_HAMMER_CONDITION_ID:
        return !held(player, HAMMER_ITEM_ID);
      case HAS_HAMMER_CONDITION_ID:
        return held(player, HAMMER_ITEM_ID);
      case NO_SAW_CONDITION_ID:
        return !held(player, SAW_ITEM_ID);
      case HAS_SAW_CONDITION_ID:
        return held(player, SAW_ITEM_ID);
      case SARIM_HAS_CARGO_CONDITION_ID:
      case JIM_HAS_CARGO_CONDITION_ID:
      case PAN_HAS_CARGO_CONDITION_ID:
        return held(player, CRATE_OF_SHIP_PARTS_ITEM_ID);
      case JIM_NO_CARGO_CONDITION_ID:
      case PAN_NO_CARGO_CONDITION_ID:
        return !held(player, CRATE_OF_SHIP_PARTS_ITEM_ID);
      default:
        return null;
    }
  }

  // ==========================================================================
  // Talk-to: Will and Anne are not in npc-dialogue-index.json under their spawned
  // ids, so their whole conversation is replayed through startTranscript.
  // ==========================================================================

  function willAnneTalkTo(event) {
    const { player, npcId, definition } = event;
    const name = definition?.getName?.();
    if (name !== "Will" && name !== "Anne") return false;
    if (quest.isComplete(player)) return false; // no post-quest variant in the dump
    const stage = quest.getStage(player);
    if (stage >= STAGE_BOARDED && stage <= STAGE_SALVAGE_READY
      && !StaticShips.isAboard(player, tutorialScene(player)?.staticShip)) {
      endTutorialShip(player);
      startTranscript(api, player, npcId, PAGE, WILL_BACK_AT_PORT_VARIANT);
      return true;
    }
    if (stage === 0 || stage === STAGE_STARTED || stage === STAGE_INTERVIEW_DONE) {
      // The two short "after starting"/"after being offered" variants lose their jump
      // targets (and the offer variant its boarding action) in the dump, so the full
      // interview is replayed; it reaches the boarding action reliably.
      startTranscript(api, player, npcId, PAGE, WILL_START_VARIANT);
      return true;
    }
    if (stage === STAGE_BOARDED) {
      startTranscript(api, player, npcId, PAGE, WILL_ABOARD_VARIANT, undefined, event.npc);
      return true;
    }
    if (stage === STAGE_SAILING || stage === STAGE_SAIL_ACCEPTED) {
      startTranscript(api, player, npcId, PAGE, WILL_SAIL_OFF_VARIANT);
      return true;
    }
    if (stage === STAGE_ARRIVED) {
      startTranscript(api, player, npcId, PAGE, WILL_ARRIVAL_AGAIN_VARIANT);
      quest.setStage(player, STAGE_SALVAGE_READY);
      return true;
    }
    if (stage === STAGE_SALVAGE_READY) {
      startTranscript(api, player, npcId, PAGE, WILL_ARRIVAL_AGAIN_VARIANT);
      return true;
    }
    return false;
  }

  // ==========================================================================
  // Dialogue side effects
  // ==========================================================================

  function handleStartHook({ player, hook }) {
    if (hook !== START_HOOK) return;
    player.setAttribute(STAGE_VERSION_ATTRIBUTE, STAGE_VERSION);
    if (quest.getStage(player) === 0) quest.setStage(player, STAGE_STARTED);
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (typeof option !== "string") return;
    if (npcId === RIBS_NPC_ID && quest.getStage(player) === STAGE_STEVE_ASKED) {
      quest.setStage(player, STAGE_RIBS_DONE);
    }
  }

  /** The transcript has no end-of-branch action for these; their lines carry the stage. */
  function handleDialogueLine(event) {
    if (handleSalvageLine(event)) return;
    handleTutorialDialogueLine(event);
    const { player, npcId, text, step } = event;
    if (typeof text !== "string") return;
    const stage = quest.getStage(player);
    const speaker = step?.speaker;
    if (speaker === "Will") event.speakerId = stage >= STAGE_BOARDED && stage <= STAGE_SALVAGED ? WILL_BOAT_HEAD_ID : WILL_DOCK_HEAD_ID;
    if (speaker === "Anne") event.speakerId = stage >= STAGE_BOARDED && stage <= STAGE_SALVAGED ? ANNE_BOAT_HEAD_ID : ANNE_DOCK_HEAD_ID;
    if (speaker === "Old Grog") event.speakerId = OLD_GROG_HEAD_ID;
    if ((npcId === WILL_NPC_ID || npcId === ANNE_NPC_ID) && text.includes(INTERVIEW_DONE_LINE)) {
      if (stage >= STAGE_STARTED && stage < STAGE_INTERVIEW_DONE) {
        quest.setStage(player, STAGE_INTERVIEW_DONE);
      }
      return;
    }
    if (isSteve(npcId) && text.includes(STEVE_RIBS_LINE)) {
      if (stage === STAGE_SALVAGED) quest.setStage(player, STAGE_STEVE_ASKED);
      return;
    }
    if (isSteve(npcId) && text.includes(STEVE_JIM_LINE)) {
      if (stage < STAGE_JIM_TOLD && stage >= STAGE_RIBS_DONE) {
        quest.setStage(player, STAGE_JIM_TOLD);
      }
      return;
    }
    if (isJim(npcId) && text === JIM_FAREWELL_LINE && stage === STAGE_CARGO_DELIVERED) {
      quest.setStage(player, STAGE_JIM_DONE);
      event.after = () => showTaskLogTutorials(player);
      return;
    }
    if (isJim(npcId) && text.includes(CHEEKY_DIP_LINE)) event.after = () => showDockingTutorial(player);
  }

  function boardShip(player) {
    player.setAttribute(STAGE_VERSION_ATTRIBUTE, STAGE_VERSION);
    const stage = quest.getStage(player);
    if (!startTutorialShip(player, { atWreck: stage >= STAGE_ARRIVED && stage <= STAGE_SALVAGE_READY })) return;
    if (quest.getStage(player) < STAGE_BOARDED) quest.setStage(player, STAGE_BOARDED);
    if (stage <= STAGE_BOARDED) {
      const scene = tutorialScene(player);
      Scenes.later(player, 2, () => startBoardingDialogue(player, scene));
    }
  }

  /** Drops a trailing wiki "the conversation continues below" jump (the cutscene tail). */
  function dropJumps(steps) {
    return steps.filter((step) => step.type !== "jump");
  }

  function pushOverboard(player) {
    const scene = salvageScenes.get(player);
    if (scene) { pushFromSalvageShip(scene); return; }
    endTutorialShip(player);
    teleport(player, PANDEMONIUM_LANDING_TILE, () => {
      if (player.isRegistered?.() === false) return;
      startTranscript(api, player, STEVE_NPC_ID, PAGE, WILL_SWIM_VARIANT, dropJumps);
    });
  }

  function completeQuest(player) {
    if (!quest.isComplete(player) && quest.getStage(player) >= STAGE_JIM_DONE) {
      quest.complete(player);
    }
    removeOldGrog(player);
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    switch (stepId) {
      case BOARD_SHIP_ACTION_ID:
        event.handled = true;
        event.end = true;
        boardShip(player);
        return;
      case GO_BACK_TO_PORT_ACTION_ID:
        event.handled = true;
        endTutorialShip(player);
        teleport(player, PORT_SARIM_TILE);
        return;
      case GO_BACK_TO_SHIP_ACTION_ID:
        event.handled = true;
        event.end = true;
        boardShip(player);
        return;
      case PUSH_OVERBOARD_ACTION_ID:
        event.handled = true;
        event.end = true;
        pushOverboard(player);
        return;
      case WALK_TO_PANDEMONIUM_ACTION_ID:
        event.handled = true;
        if (ownsSalvageSource(event, salvageScenes.get(player))) {
          event.end = true;
          finishSalvageScene(salvageScenes.get(player));
          return;
        }
        teleportAfterDialogue(player, PANDEMONIUM_PUB_TILE);
        return;
      case GO_TO_SHIPYARD_ACTION_ID: {
        event.handled = true;
        const raft = questRaft(player);
        const dock = sailingContent.content().docks.find((entry) => entry.id === PANDEMONIUM_DOCK_ID);
        if (raft && dock) Shipyard.beginVisit(player, dock, raft.slot);
        else teleportAfterDialogue(player, SHIPYARD_TILE);
        return;
      }
      case BACK_TO_PANDEMONIUM_ACTION_ID:
        event.handled = true;
        teleportAfterDialogue(player, PANDEMONIUM_LANDING_TILE);
        return;
      case OPEN_SHOP_ACTION_ID:
        if (!isSteve(npcId)) return;
        event.handled = true;
        event.end = true;
        openPandemoniumShop(player);
        return;
      case QUEST_COMPLETE_ACTION_ID:
        event.handled = true;
        event.end = true;
        completeQuest(player);
        return;
      case SALVAGE_MESSAGE_ID:
        if (!held(player, OLD_CUP_ITEM_ID)) player.getInventory().adds(OLD_CUP_ITEM_ID, 1);
        if (ownsSalvageSource(event, salvageScenes.get(player))) {
          event.handled = true;
          event.box = { items: [MEDALLION_ITEM_ID, OLD_CUP_ITEM_ID] };
        }
        return;
      case SHOW_SALVAGE_MESSAGE_ID:
        if (ownsSalvageSource(event, salvageScenes.get(player))) {
          event.handled = true;
          event.box = { items: [MEDALLION_ITEM_ID, OLD_CUP_ITEM_ID] };
        }
        return;
      case CUP_RECOVERY_MESSAGE_ID:
        if (!held(player, OLD_CUP_ITEM_ID)) player.getInventory().adds(OLD_CUP_ITEM_ID, 1);
        return;
      case GIVE_CUP_MESSAGE_ID:
        if (held(player, OLD_CUP_ITEM_ID)) player.getInventory().deleteNumber(OLD_CUP_ITEM_ID, 1);
        if (quest.getStage(player) < STAGE_CUP_GIVEN) quest.setStage(player, STAGE_CUP_GIVEN);
        grantRaft(player);
        if (quest.getStage(player) < STAGE_BOAT_GRANTED) quest.setStage(player, STAGE_BOAT_GRANTED);
        return;
      case TAKE_HAMMER_MESSAGE_ID:
        if (!held(player, HAMMER_ITEM_ID)) player.getInventory().adds(HAMMER_ITEM_ID, 1);
        return;
      case TAKE_SAW_MESSAGE_ID:
        if (!held(player, SAW_ITEM_ID)) player.getInventory().adds(SAW_ITEM_ID, 1);
        return;
      case BUILD_HOLD_MESSAGE_ID:
        if (quest.getStage(player) < STAGE_HOLD_BUILT) quest.setStage(player, STAGE_HOLD_BUILT);
        return;
      case LOG_GIVEN_MESSAGE_ID:
        if (!held(player, CAPTAINS_LOG_ITEM_ID)) player.getInventory().adds(CAPTAINS_LOG_ITEM_ID, 1);
        if (quest.getStage(player) < STAGE_LOG_GIVEN) quest.setStage(player, STAGE_LOG_GIVEN);
        return;
      case LOG_AGAIN_GIVEN_MESSAGE_ID:
        if (!held(player, CAPTAINS_LOG_ITEM_ID)) player.getInventory().adds(CAPTAINS_LOG_ITEM_ID, 1);
        if (assignCargoTask(player) && quest.getStage(player) < STAGE_JOB_ACCEPTED) quest.setStage(player, STAGE_JOB_ACCEPTED);
        return;
      case CARGO_REQUEST_MESSAGE_ID:
        if (quest.getStage(player) === STAGE_LOG_GIVEN && assignCargoTask(player)) quest.setStage(player, STAGE_JOB_ACCEPTED);
        return;
      case TAKE_CARGO_MESSAGE_ID:
        if (!held(player, CRATE_OF_SHIP_PARTS_ITEM_ID)) {
          if (freeSlots(player) < 1) {
            player.sendMessage("You don't have enough inventory space.");
            return;
          }
          player.getInventory().adds(CRATE_OF_SHIP_PARTS_ITEM_ID, 1);
        }
        return;
      case DELIVER_CARGO_MESSAGE_ID:
        if (held(player, CRATE_OF_SHIP_PARTS_ITEM_ID)) {
          player.getInventory().deleteNumber(CRATE_OF_SHIP_PARTS_ITEM_ID, 1);
        }
        if (quest.getStage(player) < STAGE_CARGO_DELIVERED) quest.setStage(player, STAGE_CARGO_DELIVERED);
        return;
      case OLD_GROG_DEPARTS_MESSAGE_ID:
        removeOldGrog(player);
        if (quest.getStage(player) < STAGE_GROG_DONE) quest.setStage(player, STAGE_GROG_DONE);
        return;
      default:
    }
  }

  // ==========================================================================
  // Objects: the boat's salvaging hook, the shipyard crates/schematics/gangplank and
  // the two ledger tables. Each case no-ops (leaving `handled` false) when the quest
  // is not in the stage that owns it, so PortTasks/Prying Times still see the click.
  // ==========================================================================

  function deploySalvagingHook(event) {
    const { player } = event;
    if (salvageScenes.has(player)) { event.handled = true; return; }
    const ship = tutorialScene(player);
    if (!ship || !StaticShips.isAboard(player, ship.staticShip)) return;
    event.handled = true;
    const stage = quest.getStage(player);
    if (stage === STAGE_SALVAGE_READY) {
      beginSalvageScene(player);
    } else if (stage >= STAGE_BOARDED && stage < STAGE_SALVAGE_READY) {
      startTranscript(api, player, WILL_NPC_ID, PAGE, WILL_DEPLOY_EARLY_VARIANT);
    }
  }

  function takeFromCrate(event, variant) {
    const stage = quest.getStage(event.player);
    if (stage < STAGE_CUP_GIVEN || stage >= STAGE_HOLD_BUILT) return;
    event.handled = true;
    startTranscript(api, event.player, JIM_NPC_ID, PAGE, variant);
  }

  function modifySchematics(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage >= STAGE_CUP_GIVEN && stage < STAGE_HOLD_BUILT) {
      event.handled = true;
      startTranscript(api, player, JIM_NPC_ID, PAGE, JIM_SCHEMATICS_BEFORE_VARIANT);
      return;
    }
    if (stage >= STAGE_HOLD_BUILT && !quest.isComplete(player)) {
      event.handled = true;
      startTranscript(api, player, JIM_NPC_ID, PAGE, JIM_SCHEMATICS_AFTER_VARIANT);
    }
  }

  /** The shipped shipyard UI's completed facility build advances the quest exactly once. */
  function handleFacilityBuilt({ player, boat, hotspot, facility }) {
    if (quest.getStage(player) !== STAGE_BOAT_GRANTED || hotspot !== 0) return;
    const raft = questRaft(player);
    if (!raft || raft.slot !== boat?.slot) return;
    if (facility !== BoatFacilities.facilityNamed("Cargo hold")) return;
    quest.setStage(player, STAGE_HOLD_BUILT);
    startTranscript(api, player, JIM_NPC_ID, PAGE, JIM_BUILD_VARIANT);
  }

  /** Native clicks keep the physical multiloc base separate from its resolved ledger action. */
  function ledgerActionId(event) {
    const resolved = event.definition?.id;
    return resolved === ObjectIdentifiers.LEDGER_TABLE_2 || resolved === ObjectIdentifiers.LEDGER_TABLE_3
      ? resolved : event.objectId;
  }

  /** PortTasks deposits the crate; the quest advances once its task slot is complete. */
  function handleLedgerInteraction(event) {
    const { player } = event;
    const objectId = ledgerActionId(event);
    if (objectId !== ObjectIdentifiers.LEDGER_TABLE_3 || quest.getStage(player) !== STAGE_PANDEMONIUM) return;
    const { CountdownTask, TaskManager } = api.core;
    TaskManager.submit(
      new CountdownTask(player, 1, () => {
        if (quest.getStage(player) !== STAGE_PANDEMONIUM) return;
        if (PortTasks.slots(player).some((slot) => slot?.id === QUEST_PORT_TASK_ID)) return;
        quest.setStage(player, STAGE_CARGO_DELIVERED);
      })
    );
  }

  /** The tutorial voyage requires taking the helm, raising the sails, then sailing south. */
  function handleTutorialHelm(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage !== STAGE_SAILING && stage !== STAGE_SAIL_ACCEPTED) return false;
    const scene = tutorialScene(player);
    if (!scene || !StaticShips.isAboard(player, scene.staticShip)) return false;
    const name = event.definition?.getName?.();
    const option = event.definition?.getInteractions?.()?.[event.clickType - 1];
    if (!tutorialPartIds(scene, "helm").has(event.objectId) && !(name === "Helm" && option === "Navigate")) return false;
    if (option !== undefined && option !== "Navigate") return false;
    event.handled = true;
    if (scene.will?.getInteractingMobile() === player) scene.will.setMobileInteraction(null);
    const request = { player, boat: scene.boat, accepted: false };
    api.emitCustomEvent("sailing:take-helm", request);
    if (request.accepted !== true) return true;
    if (scene.helmTaken) return true;
    scene.helmTaken = true;
    player.setAttribute(TUTORIAL_HELM_ATTRIBUTE, true);
    if (stage === STAGE_SAILING) quest.setStage(player, STAGE_SAIL_ACCEPTED);
    Scenes.cancel(player);
    Scenes.closeFade(player);
    return true;
  }

  function handleTutorialSails(event) {
    const { player } = event;
    if (quest.getStage(player) !== STAGE_SAIL_ACCEPTED) return false;
    const scene = tutorialScene(player);
    if (!scene) return false;
    const name = event.definition?.getName?.();
    const option = event.definition?.getInteractions?.()?.[event.clickType - 1];
    const sails = new Set([...tutorialPartIds(scene, "sails"), ...tutorialPartIds(scene, "sailCloth")]);
    if (!sails.has(event.objectId) && !(name === "Sails" && option === "Set")) return false;
    if (option !== undefined && option !== "Set") return false;
    event.handled = true;
    if (!scene.helmTaken) {
      player.sendMessage("You need to take the helm before raising the sails.");
      return true;
    }
    api.emitCustomEvent("sailing:set-supplied-sails", { player, boat: scene.boat, mode: "full", accepted: false });
    return true;
  }

  /** Observe an accepted canonical mode change; repeated inputs never restart a voyage. */
  function handleTutorialSailModeChanged({ player, boat, mode }) {
    const scene = tutorialScene(player);
    const moveMode = mode === "full" ? sailingContent.MOVE_MODE.FULL
      : mode === "half" ? sailingContent.MOVE_MODE.HALF
      : mode === "reverse" ? sailingContent.MOVE_MODE.REVERSE : undefined;
    if (!scene || scene.boat !== boat || scene.arrived || scene.voyageStarted || moveMode === undefined
      || !player.isRegistered() || player.getHitpoints() <= 0 || player.isDying
      || quest.getStage(player) !== STAGE_SAIL_ACCEPTED || !scene.helmTaken
      || !boat.ownerOnly || boat.ownerPlayerId !== player.getIndex()
      || boat.helmPlayerId !== player.getIndex() || boat.moveMode !== moveMode
      || sailingContent.getVarbit(player, sailingContent.VARBIT.SIDEPANEL_BOAT_MOVE_MODE) !== moveMode
      || !StaticShips.isAboard(player, scene.staticShip)) return;
    scene.sailsRaised = true;
    scene.voyageStarted = true;
    if (player.getAttribute(TUTORIAL_SAILS_ATTRIBUTE) !== true) player.setAttribute(TUTORIAL_SAILS_ATTRIBUTE, true);
  }

  /**
   * A boat-mounted hook is operated over the side from where the player already stands; the
   * cache's 1x1 hook carries clipMask 15, so the generic object route cannot find a reachable
   * side. Use the engine's route destination contract to operate from the current deck tile.
   */
  function routeTutorialHook(event) {
    if (event.clickType !== 1 || (event.objectId !== SALVAGING_HOOK_BASE_OBJECT_ID
      && event.objectId !== SALVAGING_HOOK_OBJECT_ID) || !tutorialScene(event.player)) return;
    const at = event.player.getLocation();
    const object = event.object.getLocation();
    if (Math.max(Math.abs(object.getX() - at.getX()), Math.abs(object.getY() - at.getY())) > 3) return;
    event.destination = { x: at.getX(), y: at.getY(), z: at.getZ() };
  }

  /** Observe arrival without replaying a recorder's heading inputs over the player's controls. */
  function watchTutorialVoyages() {
    for (const [player, scene] of tutorialScenes) {
      if (!StaticShips.isAboard(player, scene.staticShip)) {
        endTutorialShip(player);
        continue;
      }
      if (!scene.voyageStarted || scene.arrived) continue;
      if (player.isRegistered?.() === false) continue;
      const boat = scene.boat;
      if (boat.tileX >= WORLD_WRECK_ZONE.minX && boat.tileX <= WORLD_WRECK_ZONE.maxX
        && boat.tileY >= WORLD_WRECK_ZONE.minY && boat.tileY <= WORLD_WRECK_ZONE.maxY
        && Math.abs(boat.tileX - WORLD_WRECK_TILE.x) <= 2
        && Math.abs(boat.tileY - WORLD_WRECK_TILE.y) <= 2) {
        arriveAtWreck(player, scene);
      }
    }
  }

  function arriveAtWreck(player, scene) {
    scene.arrived = true;
    // Capture381 releases the helm/hand pose when stage12 is reached, before the hook.
    api.emitCustomEvent("sailing:leave-helm", { player, boat: scene.boat });
    scene.boat.moveMode = sailingContent.MOVE_MODE.STOPPED;
    scene.boat.velocity = 0;
    Scenes.fade(player, true);
    Scenes.later(player, 2, () => Scenes.fade(player, false));
    quest.setStage(player, STAGE_ARRIVED);
    player.getPacketSender().sendVarbit(VARBIT_REACHED_WRECK, 1);
    startTranscript(api, player, WILL_NPC_ID, PAGE, WILL_ARRIVAL_VARIANT);
  }

  function handleObjectInteraction(event) {
    // The tutorial's Sails Set is option 2; handle the ordered helm/sails actions before the
    // general clickType-1 guard used by the remaining interactions.
    if (handleTutorialHelm(event)) return;
    if (handleTutorialSails(event)) return;
    if (event.clickType !== 1) return;
    switch (ledgerActionId(event)) {
      case SALVAGING_HOOK_BASE_OBJECT_ID:
      case SALVAGING_HOOK_OBJECT_ID:
        deploySalvagingHook(event);
        return;
      case ObjectIdentifiers.CRATE_OF_HAMMERS:
        takeFromCrate(event, JIM_CRATE_HAMMERS_VARIANT);
        return;
      case ObjectIdentifiers.CRATE_OF_SAWS:
        takeFromCrate(event, JIM_CRATE_SAWS_VARIANT);
        return;
      case ObjectIdentifiers.BOAT_SCHEMATICS:
        modifySchematics(event);
        return;

      case ObjectIdentifiers.LEDGER_TABLE_3:
        handleLedgerInteraction(event);
        return;
      default:
    }
  }

  function registerQuestObject(objectId, tile) {
    const object = new GameObject(objectId, new Location(tile.x, tile.y, 0), 10, 0, null);
    ObjectManager.register(object, true);
    return object;
  }

  /** Ledger tables the world's maps lack at the two ports the quest uses. */
  function installQuestObjects() {
    if (questObjectsInstalled) return;
    questObjectsInstalled = true;
    registerQuestObject(PORT_SARIM_LEDGER_BASE, PORT_SARIM_LEDGER_TILE);
    registerQuestObject(PANDEMONIUM_LEDGER_BASE, PANDEMONIUM_LEDGER_TILE);
  }

  /** The quest's sibling varbits in varp 4959 are not stage-writable, so re-send them. */
  function sendIntroVarbits(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_ARRIVED) player.getPacketSender().sendVarbit(VARBIT_REACHED_WRECK, 1);
    if (stage >= STAGE_COMPLETE) player.getPacketSender().sendVarbit(VARBIT_RECEIVED_REPAIR_KITS, 1);
  }

  /** The login bootstrap's all-spells-unlocked send clobbers shared varps; re-send ours. */
  function handleBootstrap({ player }) {
    if (player) sendIntroVarbits(player);
  }

  // ==========================================================================
  // Session lifecycle
  // ==========================================================================

  /** Maps saves written by the old invented 1..16 ladder onto the live stage values once. */
  function migrateStage({ player }) {
    if (player.getAttribute(STAGE_VERSION_ATTRIBUTE) === STAGE_VERSION) return;
    const old = quest.getStage(player);
    const migrated = { 1: 2, 2: 6, 3: 8, 4: 8, 5: 10, 6: 12, 7: 16, 8: 18, 9: 20, 10: 22, 11: 26, 12: 30, 13: 32, 14: 38, 15: 44, 16: 46 }[old];
    if (migrated !== undefined) quest.setStage(player, migrated);
    player.setAttribute(STAGE_VERSION_ATTRIBUTE, STAGE_VERSION);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    installQuestObjects();
    ensureRibs(player);
    scheduleEnsureSteve(player);
    const stage = quest.getStage(player);
    if (stage >= STAGE_BOARDED && stage <= STAGE_SALVAGE_READY) {
      if (startTutorialShip(player, { atWreck: stage >= STAGE_ARRIVED }) && stage === STAGE_BOARDED) {
        const scene = tutorialScene(player);
        Scenes.later(player, 2, () => startBoardingDialogue(player, scene));
      }
    }
    if (stage === STAGE_JIM_DONE) ensureOldGrog(player);
    sendIntroVarbits(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    endSalvageScene(player, true, false);
    endTutorialShip(player, "logout");
    removeOldGrog(player);
    removeTracked(player, steveByPlayer);
    removeTracked(player, ribsByPlayer);
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I returned to Steve and he introduced me to Old Grog, a</str>",
        "<str>privateer hunting Will and Anne. Old Grog agreed to let me</str>",
        "<str>join him once I get more experience out at sea.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_JIM_DONE) {
      return [
        "<str>I sailed to Port Sarim and collected Jim's Cargo before</str>",
        "<str>delivering it to The Pandemonium. I should now check back in</str>",
        "with <col=800000>Steve</col> and see if he has an update on Will and Anne.",
      ];
    }
    if (stage >= STAGE_CARGO_DELIVERED) {
      return [
        "<str>I sailed to Port Sarim and collected Jim's Cargo before</str>",
        "<str>delivering it to The Pandemonium.</str>",
        "",
        "I should let <col=800000>Jim</col> know.",
      ];
    }
    if (stage >= STAGE_PANDEMONIUM) {
      return [
        "<str>For my first adventure on my new Raft, Junior Jim</str>",
        "<str>suggested I pick up some Cargo from Port Sarim for him.</str>",
        "<str>I sailed there and collected the Cargo.</str>",
        "",
        "I should now deliver it to the <col=800000>Port Master</col> on",
        "<col=800000>The Pandemonium</col>.",
      ];
    }
    if (stage >= STAGE_LOG_GIVEN) {
      return [
        "<str>Junior Jim traded the Cup I found for a Raft, helped me</str>",
        "<str>build a Cargo Hold on it and gave me a Captain's Log.</str>",
        "",
        "I should board my <col=800000>Raft</col> at The Pandemonium and sail",
        "to <col=800000>Port Sarim</col> to collect Jim's Cargo.",
      ];
    }
    if (stage >= STAGE_HOLD_BUILT) {
      return [
        "<str>Junior Jim traded the Cup I found for a Raft and helped me</str>",
        "<str>build a Cargo Hold on it.</str>",
        "",
        "I should speak to <col=800000>Jim</col> again about heading out to sea.",
      ];
    }
    if (stage >= STAGE_CUP_GIVEN) {
      return [
        "<str>I traded the Cup I found in exchange for a Raft.</str>",
        "",
        "I should gather a <col=800000>hammer</col> and a <col=800000>saw</col>,",
        "board my Raft and build a <col=800000>Cargo Hold</col>.",
      ];
    }
    if (stage >= STAGE_JIM_TOLD) {
      return [
        "<str>Steve told me I'd need a Boat of my own and directed me to</str>",
        "<str>Junior Jim on the docks of The Pandemonium.</str>",
        "",
        "I should speak to <col=800000>Junior Jim</col>.",
      ];
    }
    if (stage >= STAGE_RIBS_DONE) {
      return [
        "<str>At Steve's suggestion I spoke with Ribs, the previous owner</str>",
        "<str>of the Map. He believed the Medallion taken by Will and Anne</str>",
        "<str>to be cursed.</str>",
        "",
        "I should discuss this with <col=800000>Steve</col>.",
      ];
    }
    if (stage >= STAGE_STEVE_ASKED) {
      return [
        "<str>I spoke to Steve Beanie, who told me Will and Anne stole a</str>",
        "<str>Map from The Pandemonium and it led them to the Medallion.</str>",
        "",
        "He suggested I discuss the Map with <col=800000>Ribs</col>.",
      ];
    }
    if (stage >= STAGE_SALVAGED) {
      return [
        "<str>I manned the Salvaging Hook and collected a Cup and a</str>",
        "<str>Medallion. Will and Anne betrayed me and pushed me overboard,</str>",
        "<str>but I washed up on a nearby island.</str>",
        "",
        "I should discuss my situation with <col=800000>Steve Beanie</col>.",
      ];
    }
    if (stage >= STAGE_ARRIVED) {
      return [
        "<str>I joined Will and Anne on their Boat and sailed them to a</str>",
        "<str>spot east of the Karamja Shipyard to gather some salvage.</str>",
        "",
        "I should man the <col=800000>Salvaging Hook</col> when ready.",
      ];
    }
    if (stage >= STAGE_SAILING) {
      return [
        "<str>I joined Will and Anne on their Boat and they asked me to</str>",
        "<str>sail them to a spot east of the Karamja Shipyard to gather</str>",
        "<str>some salvage.</str>",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>I spoke to Will and Anne on the Port Sarim docks. They</str>",
        "<str>offered me a job and asked me to join them on their Boat to</str>",
        "<str>discuss the details.</str>",
        "",
        "I should let them know when I'm ready to board the Boat.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Will</col> and",
      "<col=800000>Anne</col> on the docks of <col=800000>Port Sarim</col>.",
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.SAILING, SAILING_XP);
    const inventory = player.getInventory();
    const Item = api.core.Item;
    // registerQuest adds the first coupon; top the stack up to 25. forceAdd merges the
    // stackable coupons and drops overflow instead of silently losing the quest rewards.
    inventory.forceAdd(player, new Item(SAWMILL_COUPON_ITEM_ID, SAWMILL_COUPONS - 1));
    for (let i = 0; i < REPAIR_KITS; i++) {
      inventory.forceAdd(player, new Item(REPAIR_KIT_ITEM_ID, 1));
    }
    inventory.forceAdd(player, new Item(SPYGLASS_ITEM_ID, 1));
    player.getPacketSender().sendVarbit(VARBIT_RECEIVED_REPAIR_KITS, 1);
  }

  quest = registerQuest(api, {
    key: "pandemonium",
    name: "Pandemonium",
    varpId: VARP_SAILING_INTRO,
    varbitId: VARBIT_SAILING_INTRO,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.SAILING.getIndex(), amount: SAILING_XP, label: "Sailing" }],
    rewardItemId: SAWMILL_COUPON_ITEM_ID,
    rewardItemLabel: "25 x Sawmill coupon (wood plank)",
    otherRewards: ["Access to the Sailing skill", "Access to The Pandemonium", "A raft"],
    buildJournal,
    onReward: grantReward,
  });

  StaticShips.attach(api);
  api.persistAttribute(STAGE_VERSION_ATTRIBUTE, 0);
  api.persistAttribute(TUTORIAL_ATTRIBUTE, 0);
  api.persistAttribute(TUTORIAL_HELM_ATTRIBUTE, false);
  api.persistAttribute(TUTORIAL_SAILS_ATTRIBUTE, false);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcInteraction("Will", { "Talk-to": willAnneTalkTo });
  api.onNpcInteraction("Anne", { "Talk-to": willAnneTalkTo });
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onObjectInteraction(handleObjectInteraction);
  BoatManager.onAfterTick(watchTutorialVoyages);
  api.onObjectRoute(routeTutorialHook);
  api.onCustomEvent("sailing:facility-built", handleFacilityBuilt);
  api.onCustomEvent("sailing:sail-mode-changed", handleTutorialSailModeChanged);
  api.onCustomEvent("sailing:boarded", handleBoarded);
  api.onCustomEvent("sailing:left", handleLeft);
  api.onCustomEvent("interface:closed", ({ player, interfaceId }) => {
    if (interfaceId === OBJECTBOX) player.getPacketSender().sendVarbit(HINT_ARROW_VARBIT, 0).clearHintArrow();
  });
  api.onPlayerLogin(migrateStage);
  api.onServerStartup(installQuestObjects);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onPlayerDeath(handleSalvageDeath);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
};
