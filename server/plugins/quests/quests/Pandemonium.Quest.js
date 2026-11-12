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
 * Stages (varbit 18314 "sailing_intro", varp 4959 bits 0-5), exactly as live sends them and as
 * Quest Helper's loadSteps keys on them; each comes with the line in docs/quests/pandemonium
 * (rsprox 242 20261104T121356-9573646, a full run; rsprox 231/235 agree on the values):
 *   2 accepted the interview, 4 interview finished, 6 boarded Will and Anne's ship,
 *   8 briefed, 10 took the helm, 12 stopped at the wreck, 14 salvaging explained,
 *  16 washed ashore at the Pandemonium (Steve greets the player), 18 mid-welcome, 20 sent to Ribs,
 *  22 Ribs's tale done, 24 sent to Junior Jim, 26 cup offered, 28 cup given and the raft granted,
 *  30 cargo hold built (Jim provides its materials), 32 log given, 34 Jim's cargo request logged,
 *  36 boarded the raft, 38 docked at Port Sarim, 40 boarded again with the crate,
 *  42 docked at the Pandemonium, 44 crate delivered, 46 told Jim, 48 Old Grog departs, 50 complete.
 * Sibling bits of the same varp, re-sent on login: 18315 reached-wreck,
 * 18316 received-repair-kits (Jim stows them in the raft's hold at 44).
 *
 * Rewards (OSRS Wiki): 1 Quest point, 300 Sailing XP (plus 100 on delivering the cargo), access to
 * Sailing and The Pandemonium, a raft, 25 sawmill coupon (wood plank), 2 repair kits and a
 * spyglass (in the raft's cargo hold).
 *
 * The intro HUD (345) with its step text (clientscript 627), the hint arrows, the crew's overhead
 * lines on the voyage and the quest's item boxes follow the rev 242 capture.
 *
 * Gaps/approximations:
 * - Will and Anne's tutorial ship is the shared `pandemonium_tutorial_ship` static ship
 *   (owner-only), with its rev 242 deck (helm, mast, sails, hook). Taking the helm uses the
 *   canonical controls and raising the sails starts a real BoatManager voyage; the player steers
 *   and stops at the wreck. Exact journey timing is not reproduced. Ours: Anne repeats "We need to
 *   be going south." every 35 ticks only while the boat is north of y 3140.
 * - The raft and cargo route use the real Sailing system: Junior Jim grants a raft in the player's
 *   boat slot, the shipyard visit shows it and the cargo hold is built on its hotspot, and the crate
 *   is port task 599 (crate 32807) collected and delivered through the real ledger tables and
 *   Sailing's board/dock/leave events. Its delivery is only the quest's box and 100 XP.
 * - Deploy uses the captured private ship/shore maps, actors, cameras and human sequences;
 *   native Continue drives its canonical text.
 * - Old Grog has no transcript page of his own: his Talk-to and Steve's both play the finale
 *   variant on Steve's page; he is owner-spawned from the delivery and removed on "Old Grog departs.".
 * - Will and Anne have no post-quest variant in the dump, so a completed player falls through to
 *   their standard page. Their short "after starting the quest" variants lost their jump targets
 *   (and the offer variant its boarding action), so the full interview is replayed at stage 2 or 4.
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
  const Shipyard = require("../../skills/sailing/Shipyard.Sailing.js");
  const BoatFacilities = require("../../skills/sailing/BoatFacilities.Sailing");
  const Cargo = require("../../skills/sailing/Cargo.Sailing");
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
  const OLD_GROG_RAW_NPC_ID = 14976; // sailing_intro_grog -> 14977
  const JIM_SHIPYARD_RAW_NPC_ID = 14973; // junior_jim_shipyard -> 14974
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
  const CAPTAINS_LOG_ITEM_ID = ItemIdentifiers.CAPTAINS_LOG; // 31985, sailing_log_initial
  const SAILING_LOG_ITEM_ID = ItemIdentifiers.CAPTAINS_LOG_2; // 31986, sailing_log: swapped in at stage 46
  const CRATE_OF_SHIP_PARTS_ITEM_ID = ItemIdentifiers.CRATE_OF_SHIP_PARTS_7; // 32807, quest crate
  const SAWMILL_COUPON_ITEM_ID = ItemIdentifiers.SAWMILL_COUPON_WOOD_PLANK_; // 32083
  const REPAIR_KIT_ITEM_ID = ItemIdentifiers.REPAIR_KIT; // 31964
  const SPYGLASS_ITEM_ID = ItemIdentifiers.SPYGLASS; // 31803
  // Tutorial-box icons (rsprox 242: objectbox models).
  const SHIPWRIGHT_ICON_ITEM_ID = 32916; // shipwright_icon_dummy
  const PORT_TASK_ICON_ITEM_ID = 32913; // port_task_board_icon_dummy
  const DOCK_ICON_ITEM_ID = 32914;

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
  const STAGE_WELCOMED = 18;
  const STAGE_SENT_TO_RIBS = 20;
  const STAGE_RIBS_DONE = 22;
  const STAGE_SENT_TO_JIM = 24;
  const STAGE_CUP_OFFERED = 26;
  const STAGE_CUP_GIVEN = 28;
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
  const STAGE_VERSION = 3;
  const PAGE = "Pandemonium";
  const CARGO_GIFTS_ATTRIBUTE = "pandemonium:cargo-hold-gifts";
  const TUTORIAL_HELM_ATTRIBUTE = "pandemonium:tutorial-helm";
  const TUTORIAL_SAILS_ATTRIBUTE = "pandemonium:tutorial-sails";
  const HINT_ARROW_VARBIT = 14192;
  // The intro HUD and its step text (overlay_hud, interface 345 sailing_intro_hud; clientscript 627
  // sailing_intro_hint picks the text, 0 or less hides it). Steps as rsprox 242 sends them.
  const OVERLAY_HUD_UID = (161 << 16) | 8;
  const SAILING_INTRO_HUD = 345;
  const SCRIPT_INTRO_HINT = 627;
  const HINT = Object.freeze({
    HIDDEN: 0, HELM: 1, HEADING: 2, STOP: 3, RESTART: 4, TRIM: 5, BOOST: 6, HOOK: 7,
    SAW: 8, HAMMER: 9, GANGPLANK: 10, HOTSPOT: 11, STOP_HERE: 12, DONE: -1,
  });
  // Deck-local hint arrows on the 2x5 tutorial ship and on the raft (rsprox 242).
  const ARROW_HELM = { x: 4, y: 5, height: 70, position: 3 };
  const ARROW_SAILS = { x: 4, y: 3, height: 250, position: 5 };
  const ARROW_HOOK = { x: 3, y: 2, height: 90, position: 3 };
  const ARROW_RAFT_HOTSPOT = { x: 3, y: 2, height: 30, position: 2 };
  // Shipyard arrows, world tiles.
  const ARROW_SAWS = { x: 2082, y: 2720, height: 60, position: 2 };
  const ARROW_HAMMERS = { x: 2082, y: 2721, height: 60, position: 2 };
  const ARROW_GANGPLANK = { x: 2087, y: 2724, height: 30, position: 5 };
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
  const JIM_SHIPYARD_AGAIN_VARIANT = "the-shipyard-talking-to-junior-jim-again";
  const JIM_AFTER_CUP_VARIANT = "talking-to-junior-jim-talking-to-junior-jim-after-giving-him-the-cup";
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
  // Live's stage lines (rsprox 242 20261104T121356, matching Quest Helper's 16..28 steps).
  const STEVE_WELCOME_LINE = "Aye! To be sure! This here is the finest establishment";
  const STEVE_RIBS_LINE = "speak to Ribs";
  const RIBS_END_LINE = "You should talk to Steve. He already put out a bounty";
  const STEVE_BOUNTY_END_LINE = "Jolly Roger!";
  const JIM_CUP_LINE = "Er... I do have this cup I found.";
  const SIGH_LINE = "*sigh*";
  const JIM_CARGO_HOLD_GIFTS_LINE = "I've also chucked some useful bits and bobs in your cargo hold.";
  const JIM_FAREWELL_LINE = "Don't mention it, mate.";

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
  const OLD_GROG_SPAWN_TILE = { x: 3049, y: 2968, z: 0 }; // rsprox 242, from the cargo delivery
  const JIM_SHIPYARD_TILE = { x: 2083, y: 2724, z: 0 }; // rsprox 242, the quest's shipyard visit
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

  /** Live words the warning for Jim's crate itself, with two answers (rsprox 242, tick 3941). */
  function questCargoWarning(prompt) {
    const raft = questRaft(prompt.player);
    if (quest.isComplete(prompt.player) || !raft || prompt.boat?.slot !== raft.slot
      || Cargo.countIn(raft, CRATE_OF_SHIP_PARTS_ITEM_ID) < 1) return;
    prompt.title = "Jim's cargo is still in the cargo hold.";
    prompt.options = [prompt.options[0], prompt.options[prompt.options.length - 1]];
  }

  /** Sailing's own board/leave events carry the quest's boat legs. */
  function handleBoarded({ player }) {
    handleShipyardBoarded({ player });
    const stage = quest.getStage(player);
    if (stage === STAGE_JOB_ACCEPTED) {
      quest.setStage(player, STAGE_RAFT_BOARDED);
      return;
    }
    if (stage === STAGE_PORT_SARIM) quest.setStage(player, STAGE_CARGO_BOARDED);
  }

  function handleLeft({ player, reason }) {
    if (reason !== "disembark") return;
    shipyardHint(player);
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
      const player = scene.player;
      // Commit with the normal-world landing; a saved16 can never refer to this temporary map.
      quest.setStage(player, STAGE_SALVAGED);
      endSalvageScene(player, false, false, false);
      player.moveTo(new Location(SHORE_EXIT.x, SHORE_EXIT.y, SHORE_EXIT.z));
      ensureSteve(player);
      // rsprox 242: the screen fades back in and Steve greets the player unprompted, 4 ticks on.
      Scenes.fade(player, true);
      Scenes.later(player, 2, () => Scenes.fade(player, false));
      Scenes.later(player, 4, () => greetWashedUpPlayer(player));
    });
  }

  function greetWashedUpPlayer(player) {
    if (!player.isRegistered() || quest.getStage(player) !== STAGE_SALVAGED
      || player.getDialogueManager().isActive()) return;
    const steve = steveNear(player);
    if (steve) steve.setPositionToFace?.(player.getLocation());
    startTranscript(api, player, STEVE_NPC_ID, PAGE, STEVE_FIRST_VARIANT, undefined, steve);
  }

  /** The Steve this player sees in the pub: ours, or Prying Times' owner spawn. */
  function steveNear(player) {
    const own = steveByPlayer.get(player);
    if (own?.isRegistered?.()) return own;
    for (const npc of api.getWorld().getNpcs()) {
      if (npc?.getId?.() !== STEVE_RAW_NPC_ID || (npc.isOwnerOnly?.() && npc.getOwner?.() !== player)) continue;
      const at = npc.getLocation();
      if (Math.abs(at.getX() - STEVE_SPAWN_TILE.x) <= 10 && Math.abs(at.getY() - STEVE_SPAWN_TILE.y) <= 10) return npc;
    }
    return null;
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
  const WORLD_WRECK_ZONE = { minX: 3018, maxX: 3040, minY: 3030, maxY: 3050 };
  // Capture381's headings at367/393/399/429 are client inputs, not an automatic course.

  function tutorialScene(player) {
    return tutorialScenes.get(player) ?? null;
  }

  function tutorialPartIds(scene, part) {
    const spec = scene && BoatManager.getSpec(scene.boat);
    return new Set((spec?.locs ?? []).filter((loc) => loc.part === part).map((loc) => loc.id));
  }

  // ==========================================================================
  // Intro HUD, step text and hint arrows (rsprox 242)
  // ==========================================================================

  function openIntroHud(player) {
    player.getPacketSender().sendSubInterface(OVERLAY_HUD_UID, SAILING_INTRO_HUD, 1);
  }

  function closeIntroHud(player) {
    player.getPacketSender().closeSubInterface(OVERLAY_HUD_UID);
  }

  /** Live resets the arrow and its varbit before each new one. */
  function pointAt(player, { x, y, z = 0, height, position }) {
    player.getPacketSender().sendVarbit(HINT_ARROW_VARBIT, 0).clearHintArrow()
      .sendVarbit(HINT_ARROW_VARBIT, 1)
      .sendPositionalHint(new Location(x, y, z), position, height, z);
  }

  function clearArrow(player) {
    player.getPacketSender().sendVarbit(HINT_ARROW_VARBIT, 0).clearHintArrow();
  }

  /** A deck-local arrow on a boat, in the deck's own tiles. */
  function deckArrow(boat, arrow) {
    return boat ? { ...arrow, x: boat.deckBaseX + arrow.x, y: boat.deckBaseY + arrow.y } : null;
  }

  /** The HUD's step text, and the arrow live shows with it (none clears it). */
  function introHint(player, step, arrow = null) {
    player.getPacketSender().sendClientScript(SCRIPT_INTRO_HINT, step);
    if (arrow) pointAt(player, arrow);
    else clearArrow(player);
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
    const scene = { boat: ship.boat, deck, will, anne, staticShip: ship, helmTaken, sailsRaised, voyageStarted: false,
      arrived: atWreck, ticks: 0, southSaidAt: undefined, toldToStop: false };
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
    openIntroHud(player);
    if (stage === STAGE_SAILING) introHint(player, HINT.HELM, deckArrow(scene.boat, ARROW_HELM));
    else if (stage === STAGE_SAIL_ACCEPTED) introHint(player, scene.helmTaken && sailsRaised ? HINT.STOP : HINT.HEADING);
    else if (stage === STAGE_SALVAGE_READY) introHint(player, HINT.HOOK, deckArrow(scene.boat, ARROW_HOOK));
    return true;
  }

  /** A crewmate's overhead line, also in the chatbox as theirs (rsprox 242: npc_say). */
  function crewSays(player, npc, name, text) {
    if (!npc?.isRegistered?.()) return;
    const line = text.replace("[player name]", player.getUsername());
    npc.forceChat?.(line);
    player.getPacketSender().sendTypedMessage(api.core.ChatType.NPC_SAY, line, name);
  }

  // The crew's lines on the voyage (rsprox 242 20261104T121356, ticks 3195-3293).
  const SOUTH_LINE = "We need to be going south.";
  const TRIM_LINE = "[player name]! The sails need trimming! Don't miss out on that wind!";
  const TRIMMED_LINE = "Very good!";
  const STOP_HERE_LINE = "Stop here, [player name]! This is where we want to be!";
  /** Anne repeats the heading 35 ticks after taking the helm (3195, 3230). */
  const SOUTH_REPEAT_TICKS = 35;
  /** Ours: she stops once the boat is well clear of Port Sarim (live never repeated it south of here). */
  const SOUTH_REMINDER_MAX_Y = 3140;

  function voyageScene(player, boat) {
    const scene = tutorialScene(player);
    return scene && scene.boat === boat && !scene.arrived && quest.getStage(player) === STAGE_SAIL_ACCEPTED ? scene : null;
  }

  function handleTutorialGust({ player, boat }) {
    const scene = voyageScene(player, boat);
    if (!scene) return;
    crewSays(player, scene.will, "Will", TRIM_LINE);
    introHint(player, HINT.TRIM, deckArrow(scene.boat, ARROW_SAILS));
  }

  function handleTrimmed({ player, boat }) {
    const scene = voyageScene(player, boat);
    if (!scene) return;
    crewSays(player, scene.anne, "Anne", TRIMMED_LINE);
    introHint(player, HINT.BOOST);
  }

  function handleTutorialLull({ player, boat }) {
    if (voyageScene(player, boat) && boat.moveMode !== sailingContent.MOVE_MODE.STOPPED) introHint(player, HINT.STOP);
  }

  function inWreckZone(boat) {
    return boat.tileX >= WORLD_WRECK_ZONE.minX && boat.tileX <= WORLD_WRECK_ZONE.maxX
      && boat.tileY >= WORLD_WRECK_ZONE.minY && boat.tileY <= WORLD_WRECK_ZONE.maxY;
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
    closeIntroHud(player);
    clearArrow(player);
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

  /** Old Grog drinks in the pub from the cargo delivery until he departs (rsprox 242). */
  function ensureOldGrog(player) {
    if (oldGrogByPlayer.get(player)?.isRegistered?.()) return;
    const npc = spawnOwnerNpc(OLD_GROG_RAW_NPC_ID, OLD_GROG_SPAWN_TILE, player);
    if (npc) oldGrogByPlayer.set(player, npc);
  }

  /** Talking to Old Grog himself starts the finale, as live's run did (opnpc1 sailing_intro_grog). */
  function grogTalkTo({ player, npc }) {
    if (quest.isComplete(player) || quest.getStage(player) < STAGE_JIM_DONE || quest.getStage(player) >= STAGE_GROG_DONE) return false;
    startTranscript(api, player, OLD_GROG_NPC_ID, PAGE, STEVE_FINALE_VARIANT, undefined, npc);
    return true;
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
    const atShipyard = Shipyard.visitedBoat(player) !== undefined;
    switch (stage) {
      case STAGE_SENT_TO_JIM:
        return JIM_TRADE_VARIANT;
      case STAGE_CUP_OFFERED:
        return JIM_NO_CUP_VARIANT;
      case STAGE_CUP_GIVEN:
        // At the shipyard: "What should I do now?". On the docks the cup's already his, and his
        // after-the-cup variant jumps to the TIfJ86 shipyard action.
        return atShipyard ? JIM_SHIPYARD_AGAIN_VARIANT : JIM_AFTER_CUP_VARIANT;
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
      // 48: Grog's gone and only the rewards are left; the "again" variant jumps to them.
      if (complete || stage >= STAGE_GROG_DONE) return STEVE_POST_QUEST_VARIANT;
      if (stage >= STAGE_JIM_DONE) {
        ensureOldGrog(player);
        return STEVE_FINALE_VARIANT;
      }
      if (stage < STAGE_CARGO_DELIVERED) removeOldGrog(player);
      // Live: 16 welcome, 18 mid-welcome, 20 sent to Ribs, 22 back from Ribs, 24 sent to Jim.
      if (stage >= STAGE_SENT_TO_JIM) return STEVE_SUBSEQUENT_VARIANT;
      if (stage >= STAGE_RIBS_DONE) return STEVE_AFTER_RIBS_VARIANT;
      if (stage >= STAGE_WELCOMED) return STEVE_ASKED_AGAIN_VARIANT;
      if (stage >= STAGE_SALVAGED) return STEVE_FIRST_VARIANT;
      return null;
    }
    if (npcId === RIBS_NPC_ID) {
      if (complete || stage >= STAGE_RIBS_DONE) return RIBS_AGAIN_VARIANT;
      if (stage >= STAGE_SENT_TO_RIBS) return RIBS_FIRST_VARIANT;
      return null;
    }
    if (npcId === OLD_GROG_NPC_ID) {
      if (!complete && stage >= STAGE_JIM_DONE && stage < STAGE_GROG_DONE) return STEVE_FINALE_VARIANT;
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
        // The question comes after the welcome's 18 line; 20 is set once it's answered.
        return quest.getStage(player) < STAGE_SENT_TO_RIBS;
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
      // Live replays the explanation; its "*sigh*" sets 14 (rsprox 242, ticks 3306-3316).
      startTranscript(api, player, npcId, PAGE, WILL_ARRIVAL_VARIANT);
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
    // A line's event comes when its chain is built, ahead of the line; live changes the stage as the
    // line shows, so each change runs from `before` and checks the stage then.
    const variants = event.pages?.flatMap(({ page, variants: names }) => page === PAGE ? names ?? [] : []) ?? [];
    const advance = (from, to, also) => onShow(event, () => {
      if (!from.includes(quest.getStage(player))) return;
      quest.setStage(player, to);
      also?.();
    });
    if ((npcId === WILL_NPC_ID || npcId === ANNE_NPC_ID) && text.includes(INTERVIEW_DONE_LINE)) {
      advance([STAGE_STARTED], STAGE_INTERVIEW_DONE);
    } else if (speaker === "Anne" && text.endsWith(BOARDING_DONE_LINE) && variants.includes(WILL_ABOARD_VARIANT)) {
      const previous = event.after;
      event.after = () => {
        previous?.();
        const scene = tutorialScene(player);
        if (scene && quest.getStage(player) === STAGE_SAILING && !scene.helmTaken) {
          introHint(player, HINT.HELM, deckArrow(scene.boat, ARROW_HELM));
        }
      };
    } else if (text === SIGH_LINE && stage === STAGE_ARRIVED) {
      advance([STAGE_ARRIVED], STAGE_SALVAGE_READY, () => {
        const scene = tutorialScene(player);
        if (scene) introHint(player, HINT.HOOK, deckArrow(scene.boat, ARROW_HOOK));
      });
    } else if (isSteve(npcId) && text.startsWith(STEVE_WELCOME_LINE)) {
      advance([STAGE_SALVAGED], STAGE_WELCOMED);
    } else if (isSteve(npcId) && text.includes(STEVE_RIBS_LINE)) {
      advance([STAGE_SALVAGED, STAGE_WELCOMED], STAGE_SENT_TO_RIBS);
    } else if (npcId === RIBS_NPC_ID && text.startsWith(RIBS_END_LINE)) {
      advance([STAGE_SENT_TO_RIBS], STAGE_RIBS_DONE);
    } else if (isSteve(npcId) && text === STEVE_BOUNTY_END_LINE && variants.includes(STEVE_AFTER_RIBS_VARIANT)) {
      advance([STAGE_RIBS_DONE], STAGE_SENT_TO_JIM);
    } else if (isJim(npcId) && text.startsWith(JIM_CUP_LINE)) {
      advance([STAGE_SENT_TO_JIM], STAGE_CUP_OFFERED);
    } else if (isJim(npcId) && text.includes(JIM_CARGO_HOLD_GIFTS_LINE)) {
      onShow(event, () => { if (quest.getStage(player) === STAGE_CARGO_DELIVERED) stowCargoHoldGifts(player); });
    } else if (isJim(npcId) && text === JIM_FAREWELL_LINE) {
      advance([STAGE_CARGO_DELIVERED], STAGE_JIM_DONE, () => upgradeCaptainsLog(player));
    }
  }

  /** Runs `fn` as the line shows, after any earlier `before` on it. */
  function onShow(event, fn) {
    const previous = event.before;
    event.before = () => { previous?.(); fn(); };
  }

  /**
   * Jim's repair kits and spyglass go in the raft's cargo hold, with varbit 18316, when he says so
   * (rsprox 242: the two kits are in hold 963 later). What the hold can't take goes to the player.
   */
  function stowCargoHoldGifts(player) {
    if (player.getAttribute(CARGO_GIFTS_ATTRIBUTE) === true) return;
    player.setAttribute(CARGO_GIFTS_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(VARBIT_RECEIVED_REPAIR_KITS, 1);
    const raft = questRaft(player);
    const Item = api.core.Item;
    for (const [itemId, amount] of [[REPAIR_KIT_ITEM_ID, REPAIR_KITS], [SPYGLASS_ITEM_ID, 1]]) {
      const stored = raft ? Cargo.store(raft, itemId, amount) : 0;
      for (let i = stored; i < amount; i++) player.getInventory().forceAdd(player, new Item(itemId, 1));
    }
  }

  /** Stage 46 replaces the starter log (31985) with the full captain's log (31986) in its slot. */
  function upgradeCaptainsLog(player) {
    const inventory = player.getInventory();
    const slot = inventory.getSlotForItemId(CAPTAINS_LOG_ITEM_ID);
    if (slot < 0) return;
    inventory.setItem(slot, new api.core.Item(SAILING_LOG_ITEM_ID, 1)).refreshItems();
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

  /**
   * The quest's hand-outs and tutorials are item boxes on live (rsprox 242 objectbox models), some
   * with a camera and a hint arrow on what they describe; the rest play as chat messages.
   */
  const MESSAGE_BOXES = {
    "LXQu-W": { item: OLD_CUP_ITEM_ID },
    [GIVE_CUP_MESSAGE_ID]: { item: OLD_CUP_ITEM_ID },
    [CUP_RECOVERY_MESSAGE_ID]: { item: OLD_CUP_ITEM_ID },
    [TAKE_SAW_MESSAGE_ID]: { item: SAW_ITEM_ID },
    OgmTuK: { item: SAW_ITEM_ID },
    [TAKE_HAMMER_MESSAGE_ID]: { item: HAMMER_ITEM_ID },
    aWG1rA: { item: HAMMER_ITEM_ID },
    [LOG_GIVEN_MESSAGE_ID]: { item: CAPTAINS_LOG_ITEM_ID },
    [LOG_AGAIN_GIVEN_MESSAGE_ID]: { item: CAPTAINS_LOG_ITEM_ID },
    [CARGO_REQUEST_MESSAGE_ID]: { item: CAPTAINS_LOG_ITEM_ID },
    [TAKE_CARGO_MESSAGE_ID]: { item: CRATE_OF_SHIP_PARTS_ITEM_ID },
    [DELIVER_CARGO_MESSAGE_ID]: { item: CRATE_OF_SHIP_PARTS_ITEM_ID },
    // Docking points; ours: the arrow, from the earlier tutorial chain (not in this capture).
    LhIFh_: { item: DOCK_ICON_ITEM_ID, arrow: { x: 3070, y: 2987, height: 30, position: 3 } },
    _mDPVw: { item: DOCK_ICON_ITEM_ID, arrow: { x: 3070, y: 2987, height: 30, position: 3 } },
    teg4gz: { item: DOCK_ICON_ITEM_ID, arrow: { x: 3070, y: 2987, height: 30, position: 3 } },
    EIOEfn: { item: SHIPWRIGHT_ICON_ITEM_ID },
    VOIS_P: { item: PORT_TASK_ICON_ITEM_ID, arrow: { x: 3058, y: 2986, height: 140, position: 2 },
      camera: [[3063, 2985, 640], [3058, 2986, 280]] },
    mBygf3: { item: SAILING_LOG_ITEM_ID, arrow: { x: 3046, y: 2997, height: 110, position: 6 },
      camera: [[3042, 2991, 720], [3046, 2998, 120]] },
  };

  function showMessageBox(event) {
    const box = event.kind === "message" ? MESSAGE_BOXES[event.stepId] : undefined;
    if (!box) return;
    const { player } = event;
    const sender = player.getPacketSender();
    event.box = { items: [box.item] };
    if (box.camera) {
      const [[mx, my, mh], [lx, ly, lh]] = box.camera;
      sender.sendCameraMoveTo(mx, my, mh, { rate: 232, rate2: 100, heightRelative: false })
        .sendCameraLookAt(lx, ly, lh, { rate: 232, rate2: 100, heightRelative: false });
    }
    if (box.arrow) pointAt(player, { ...box.arrow, z: 0 });
    if (box.arrow || box.camera) {
      const previous = event.after;
      event.after = () => {
        previous?.();
        if (box.arrow) clearArrow(player);
        if (box.camera) sender.sendCameraReset();
      };
    }
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    showMessageBox(event);
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
        if (raft && dock) {
          Shipyard.beginVisit(player, dock, raft.slot, undefined, { questVisit: true });
          // Live fades through the move (rsprox 242, ticks 3544-3546).
          Scenes.fade(player, false);
          beginShipyardTutorial(player);
        } else teleportAfterDialogue(player, SHIPYARD_TILE);
        return;
      }
      case BACK_TO_PANDEMONIUM_ACTION_ID:
        event.handled = true;
        // Already on the docks (back through the portal), Jim just carries on.
        if (Shipyard.visitedBoat(player) === undefined) return;
        teleportAfterDialogue(player, PANDEMONIUM_LANDING_TILE, () => endShipyardTutorial(player));
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
        if (quest.getStage(player) < STAGE_CUP_OFFERED) quest.setStage(player, STAGE_CUP_OFFERED);
        grantRaft(player);
        if (quest.getStage(player) < STAGE_CUP_GIVEN) quest.setStage(player, STAGE_CUP_GIVEN);
        return;
      case TAKE_HAMMER_MESSAGE_ID:
        if (!held(player, HAMMER_ITEM_ID)) player.getInventory().adds(HAMMER_ITEM_ID, 1);
        shipyardHint(player);
        return;
      case TAKE_SAW_MESSAGE_ID:
        if (!held(player, SAW_ITEM_ID)) player.getInventory().adds(SAW_ITEM_ID, 1);
        shipyardHint(player);
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
        ensureOldGrog(player);
        return;
      case OLD_GROG_DEPARTS_MESSAGE_ID:
        // rsprox 242: a blank-continue message box for four ticks, then its continue.
        event.box = { statement: true, holdTicks: 4 };
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
    if (stage < STAGE_CUP_OFFERED || stage >= STAGE_HOLD_BUILT) return;
    event.handled = true;
    startTranscript(api, event.player, JIM_NPC_ID, PAGE, variant);
  }

  function modifySchematics(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage >= STAGE_CUP_OFFERED && stage < STAGE_HOLD_BUILT) {
      event.handled = true;
      startTranscript(api, player, JIM_NPC_ID, PAGE, JIM_SCHEMATICS_BEFORE_VARIANT);
      return;
    }
    if (stage >= STAGE_HOLD_BUILT && !quest.isComplete(player)) {
      event.handled = true;
      startTranscript(api, player, JIM_NPC_ID, PAGE, JIM_SCHEMATICS_AFTER_VARIANT);
    }
  }

  // ==========================================================================
  // The quest's shipyard visit (rsprox 242, ticks 3544-3594)
  // ==========================================================================

  /** The raft's cargo hold (facility row 8462): the one the client lets stage 28 build free. */
  const RAFT_CARGO_HOLD_FACILITY = 8462;
  const shipyardJimByPlayer = new WeakMap();

  function isQuestRaftHold(player, boat, hotspot, facility) {
    const raft = questRaft(player);
    return quest.getStage(player) === STAGE_CUP_GIVEN && hotspot === 0 && facility === RAFT_CARGO_HOLD_FACILITY
      && !!raft && raft.slot === boat?.slot;
  }

  function beginShipyardTutorial(player) {
    ensureShipyardJim(player);
    openIntroHud(player);
    shipyardHint(player);
  }

  function ensureShipyardJim(player) {
    if (shipyardJimByPlayer.get(player)?.isRegistered?.()) return;
    const npc = spawnOwnerNpc(JIM_SHIPYARD_RAW_NPC_ID, JIM_SHIPYARD_TILE, player);
    if (npc) shipyardJimByPlayer.set(player, npc);
  }

  /** Tools first (the saws, then the hammers), then the gangplank, then the raft's hotspot. */
  function shipyardHint(player) {
    if (quest.getStage(player) !== STAGE_CUP_GIVEN || Shipyard.visitedBoat(player) === undefined) return;
    if (!held(player, SAW_ITEM_ID)) return introHint(player, HINT.SAW, ARROW_SAWS);
    if (!held(player, HAMMER_ITEM_ID)) return introHint(player, HINT.HAMMER, ARROW_HAMMERS);
    const visit = Shipyard.aboardVisit(player);
    if (!visit) return introHint(player, HINT.GANGPLANK, ARROW_GANGPLANK);
    introHint(player, HINT.HOTSPOT, deckArrow(visit.shown, ARROW_RAFT_HOTSPOT));
  }

  /** Jim covers the raft cargo hold's materials at stage 28 (client scripts 8828/8839, rsprox 242). */
  function handleFacilityCost(event) {
    if (isQuestRaftHold(event.player, event.boat, event.hotspot, event.facility)) event.provided = true;
  }

  /** The shipped shipyard UI's completed facility build advances the quest exactly once. */
  function handleFacilityBuilt({ player, boat, hotspot, facility }) {
    if (!isQuestRaftHold(player, boat, hotspot, facility)) return;
    quest.setStage(player, STAGE_HOLD_BUILT);
    introHint(player, HINT.DONE);
    // Its message ("Junior Jim helpfully provides ...") is a chat message on live, then his line.
    startTranscript(api, player, JIM_NPC_ID, PAGE, JIM_BUILD_VARIANT, undefined, shipyardJimByPlayer.get(player) ?? null);
  }

  /** The portal at stage 30: back on the docks, Jim carries on from his shipyard return line. */
  function endShipyardTutorial(player) {
    if (!shipyardJimByPlayer.has(player)) return;
    closeIntroHud(player);
    clearArrow(player);
    removeTracked(player, shipyardJimByPlayer);
  }

  function handleShipyardExited({ player }) {
    endShipyardTutorial(player);
    if (quest.getStage(player) !== STAGE_HOLD_BUILT) return;
    Scenes.later(player, 1, () => {
      if (!player.isRegistered() || quest.getStage(player) !== STAGE_HOLD_BUILT || player.getDialogueManager().isActive()) return;
      startTranscript(api, player, JIM_NPC_ID, PAGE, JIM_SHIPYARD_RETURN_VARIANT, afterShipyardReturn);
    });
  }

  /** The return variant from after its teleport (HrNl3J): "Okay, looks like that's you all sorted". */
  function afterShipyardReturn(steps) {
    const at = steps.findIndex((step) => step.id === BACK_TO_PANDEMONIUM_ACTION_ID);
    return at < 0 ? steps : steps.slice(at + 1);
  }

  function handleShipyardBoarded({ player }) {
    shipyardHint(player);
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
        ensureOldGrog(player);
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
    crewSays(player, scene.anne, "Anne", SOUTH_LINE);
    scene.southSaidAt = scene.ticks;
    introHint(player, HINT.HEADING);
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
    if (scene && scene.boat === boat && !scene.arrived && scene.helmTaken
      && quest.getStage(player) === STAGE_SAIL_ACCEPTED) {
      // Live arrives when the player stops the boat at the wreck (rsprox 242, tick 3300).
      if (mode === "stop") {
        if (scene.voyageStarted && inWreckZone(boat)) arriveAtWreck(player, scene);
        else introHint(player, HINT.RESTART);
        return;
      }
      if (mode === "full" || mode === "half") introHint(player, scene.toldToStop ? HINT.STOP_HERE : HINT.STOP);
    }
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
      scene.ticks++;
      if (!scene.helmTaken || scene.arrived) continue;
      if (player.isRegistered?.() === false) continue;
      const boat = scene.boat;
      if (scene.southSaidAt !== undefined && scene.ticks - scene.southSaidAt >= SOUTH_REPEAT_TICKS) {
        scene.southSaidAt = boat.tileY > SOUTH_REMINDER_MAX_Y ? scene.ticks : undefined;
        if (scene.southSaidAt !== undefined) crewSays(player, scene.anne, "Anne", SOUTH_LINE);
      }
      if (!scene.voyageStarted) continue;
      const inZone = inWreckZone(boat);
      if (inZone && !scene.toldToStop && boat.moveMode !== sailingContent.MOVE_MODE.STOPPED) {
        scene.toldToStop = true;
        crewSays(player, scene.anne, "Anne", STOP_HERE_LINE);
        introHint(player, HINT.STOP_HERE);
      } else if (!inZone && scene.toldToStop) {
        // Ours: sailing back out lets her call it again when the boat returns.
        scene.toldToStop = false;
      }
    }
  }

  function arriveAtWreck(player, scene) {
    scene.arrived = true;
    // Capture381 releases the helm/hand pose when stage12 is reached, before the hook.
    api.emitCustomEvent("sailing:leave-helm", { player, boat: scene.boat });
    scene.boat.moveMode = sailingContent.MOVE_MODE.STOPPED;
    scene.boat.velocity = 0;
    quest.setStage(player, STAGE_ARRIVED);
    player.getPacketSender().sendVarbit(VARBIT_REACHED_WRECK, 1);
    introHint(player, HINT.HIDDEN);
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
    if (player.getAttribute(CARGO_GIFTS_ATTRIBUTE) === true || stage >= STAGE_COMPLETE) {
      player.getPacketSender().sendVarbit(VARBIT_RECEIVED_REPAIR_KITS, 1);
    }
  }

  /** The login bootstrap's all-spells-unlocked send clobbers shared varps; re-send ours. */
  function handleBootstrap({ player }) {
    if (player) sendIntroVarbits(player);
  }

  // ==========================================================================
  // Session lifecycle
  // ==========================================================================

  /** Maps saves written by the old invented 1..16 ladder onto the live stage values once. */
  /** Saves from the invented 1..16 ladder (version 0/1) onto version 2's values. */
  const LEGACY_STAGES = { 1: 2, 2: 6, 3: 8, 4: 8, 5: 10, 6: 12, 7: 16, 8: 18, 9: 20, 10: 22, 11: 26, 12: 30, 13: 32, 14: 38, 15: 44, 16: 46 };
  /**
   * Version 2 set 18 on Steve's Ribs line, 20 on Ribs's choice and 22 on Steve's Jim line; live
   * (and Quest Helper) set them one line earlier each: 18 mid-welcome, 20 Ribs line, 22 Ribs's last
   * line, 24 Steve's "Jolly Roger!". A version 2 save at 18/20/22 is at live's 20/22/24.
   */
  const V2_STAGES = { 18: 20, 20: 22, 22: 24 };

  function migrateStage({ player }) {
    const version = Number(player.getAttribute(STAGE_VERSION_ATTRIBUTE)) || 0;
    if (version === STAGE_VERSION) return;
    let stage = quest.getStage(player);
    if (version < 2) stage = LEGACY_STAGES[stage] ?? stage;
    if (version < 3) stage = V2_STAGES[stage] ?? stage;
    if (stage !== quest.getStage(player)) quest.setStage(player, stage);
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
    if (stage >= STAGE_CARGO_DELIVERED && stage < STAGE_GROG_DONE) ensureOldGrog(player);
    sendIntroVarbits(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    endSalvageScene(player, true, false);
    endTutorialShip(player, "logout");
    removeTracked(player, shipyardJimByPlayer);
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
    if (stage >= STAGE_SENT_TO_JIM) {
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
    if (stage >= STAGE_SENT_TO_RIBS) {
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
    // Jim stows the kits and the spyglass in the raft's hold first (stage 44's dialogue); a
    // completion that never went through it still gets them.
    stowCargoHoldGifts(player);
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
  api.persistAttribute(CARGO_GIFTS_ATTRIBUTE, false);
  api.persistAttribute(TUTORIAL_HELM_ATTRIBUTE, false);
  api.persistAttribute(TUTORIAL_SAILS_ATTRIBUTE, false);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcInteraction("Will", { "Talk-to": willAnneTalkTo });
  api.onNpcInteraction("Anne", { "Talk-to": willAnneTalkTo });
  api.onNpcInteraction("Old Grog", { "Talk-to": grogTalkTo });
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onObjectInteraction(handleObjectInteraction);
  BoatManager.onAfterTick(watchTutorialVoyages);
  api.onObjectRoute(routeTutorialHook);
  api.onCustomEvent("sailing:facility-cost", handleFacilityCost);
  api.onCustomEvent("sailing:facility-built", handleFacilityBuilt);
  api.onCustomEvent("sailing:shipyard-exited", handleShipyardExited);
  api.onCustomEvent("port-tasks:hold-warning", questCargoWarning);
  api.onCustomEvent("sailing:gust", handleTutorialGust);
  api.onCustomEvent("sailing:trimmed", handleTrimmed);
  api.onCustomEvent("sailing:lull", handleTutorialLull);
  api.onCustomEvent("sailing:sail-mode-changed", handleTutorialSailModeChanged);
  api.onCustomEvent("sailing:boarded", handleBoarded);
  api.onCustomEvent("sailing:left", handleLeft);
  api.onPlayerLogin(migrateStage);
  api.onServerStartup(installQuestObjects);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onPlayerDeath(handleSalvageDeath);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
};
