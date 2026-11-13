/**
 * Bone Voyage (members).
 *
 * The words come from the "Bone Voyage" transcript page (plus the Barge guard / Lead and Junior
 * Navigator pages for the post-quest travel). This plugin supplies the per-stage variant selector
 * for the curator, both sawmill operators, Berry, the barge crew, the bar patrons, the apothecary
 * and the Odd Old Man, the prose-condition answers, the item hand-ins, the voyage and the reward.
 *
 * Durable stages stay 1..11 so existing saves keep their meaning:
 *   1 started (curator), 2 barge foreman briefed (go to the Varrock sawmill),
 *   3 sawmill proposal obtained (deliver to the Hosidius guild/Berry), 4 signed
 *   agreement obtained (back to the Varrock sawmill), 5 agreement delivered /
 *   supplies sent (barge foreman), 6 barge ready (board via the guard), 7 lead
 *   navigator met (ask at the Rusty Anchor), 8 bar patrons talked (return to
 *   the navigators), 9 plan agreed (potion of sealegs + lucky bone charm),
 *   10 the crew has drunk the potion and set off at least once, 11 complete.
 * Varbit 5795 "fossilquest_progress" (varp 1630 bits 0-8) carries Quest Helper's loadSteps values
 * 0/5/10/11/15/20/21/22/23/25/30/35, and the quest DB completes at 50 (script 4024 case 11).
 *
 * The end of the quest follows the user's rsprox capture (rev 242,
 * "BoneVoyage-CursedVoyage", docs/quests/bone-voyage/README.md has the facts and ticks):
 * - Wire 30 once both the charm and the potion are given; 35 from the first set-off on, kept
 *   through an aborted voyage (the crew still has to "take another dose").
 * - The barge crew are the cache's static multinpcs (guard 7767/7768, navigators 7819/7820,
 *   John 7821, David 7822, island navigators at 3723,3784,1); varbit 5795 picks their quest or
 *   post-quest forms, so the plugin spawns no copies of its own.
 * - Boarding and leaving the barge are fade ferries (plugins/world/data/ferries.json
 *   fossil-barge-*), as are the post-quest navigator crossings and the row to the camp.
 * - The voyage: the crew passes out (two message boxes), the Junior Navigator's briefing, then
 *   fossilquest_sailing (604) in the side modal, its overlay 603 on the HUD, script 1993 with the
 *   bearing/sails/rudder and the minimap off. Every 4 ticks the bearing moves and the progress bar
 *   gains 10 when the bearing is within 6 steps (of 391) of north (33189), loses 5 when not.
 *   Closing the controls points the hint arrow at them. Abort and arrival fade out and land on
 *   the canal or Fossil Island barge deck with script 1996; arriving completes the quest at once
 *   and the Junior Navigator's closing lines (with the journal) follow the scroll.
 * - Ours (no capture or Wiki value): the wind, how far the rudder turns the bearing, how the
 *   sails scale progress and drift, and when a voyage counts as lost; see VOYAGE below.
 *
 * Requirements (OSRS Wiki): The Dig Site and 100 Kudos. The Dig Site is asked
 * through the shared "quest:is-complete" event; Kudos is read synchronously from
 * the Museum module's "museum:get-kudos" event. The start hook and the Curator
 * prose branch both enforce the 100-Kudos threshold, so the canonical refusal
 * transcript remains reachable at 99.
 *
 * Rewards per the OSRS Wiki and the capture's scroll: 1 Quest Point, access to Fossil Island
 * (the bone charm is the scroll's model), and the Fossil island note book from the Junior Navigator.
 *
 * - The transcript has no message step for receiving the sawmill proposal, so it
 *   is granted on the first "I'm here on behalf of the museum..." choice at the
 *   Varrock operator; the "I lost the ..." reclaim lines grant their replacement.
 * - "the-cursed-voyage-talking-to-lead-navigator-again" is a wiki "same as above"
 *   action; it replays the giving-potion variant from "Looks like we've got
 *   everything we need to set off!".
 * - The journal lines are written here (the wiki publishes none).
 * - The charm/potion states live in persisted plugin attributes and are mirrored
 *   to varbits 5796 "fossilquest_lucky_charm" (1 obtained, 2 given) and 5797
 *   "fossilquest_potion" (1 ingredients explained, 2 obtained, 3 given), matching
 *   Quest Helper's loadSteps requirements.
 */
module.exports = function registerBoneVoyageQuest(api) {
  const { CacheDefinitions, CountdownTask, ItemIdentifiers, Location, NpcIdentifiers, Skill, TaskManager } = api.core;
  const { registerQuest, refreshQuestList, loadTranscripts, startTranscript } = require("../QuestRuntime");

  const PAGE = "Bone Voyage";
  const JUNIOR_PAGE = "Junior Navigator";
  const VOYAGE_FAILED_VARIANT = "the-cursed-voyage-talking-to-lead-navigator-again-if-the-player-fails-the-voyage";
  const JUNIOR_AFTER_FAIL_VARIANT = "the-cursed-voyage-aborting-the-voyage-talking-to-junior-navigator-after-failing-a-voyage";
  const LEAD_TRY_AGAIN_VARIANT = "the-cursed-voyage-aborting-the-voyage-talking-to-junior-navigator-after-failing-a-voyage-talking-to-the-lead-navigator-to-try-again";
  const FINISHING_VARIANT = "the-cursed-voyage-finishing-up";
  const START_HOOK = "quest:bone-voyage:start";

  const VARP_FOSSILQUEST_MAIN = 1630; // "fossilquest_main"
  const VARBIT_FOSSILQUEST_PROGRESS = 5795; // "fossilquest_progress", varp 1630 bits 0-8
  const VARBIT_FOSSILQUEST_LUCKY_CHARM = 5796; // "fossilquest_lucky_charm", bits 9-10
  const VARBIT_FOSSILQUEST_POTION = 5797; // "fossilquest_potion", bits 11-12
  const VARBIT_FOSSILQUEST_SAILING_PROGRESS = 5798; // the progress bar, 0-100
  const VARBIT_CURRENT_HINT_ARROW = 14192; // "current_hint_arrow"
  const HINT_ARROW_CONTROLS = 7; // capture: set while the controls are closed at sea
  const VARBIT_MINIMAP_STATE = 6719; // "minimap_state" (live's minimap_toggle 2 / 0)
  const MINIMAP_OFF = 2;
  const STAGE_WIRE = Object.freeze({
    0: 0, 1: 5, 2: 10, 3: 11, 4: 15, 5: 20, 6: 21, 7: 22, 8: 23, 9: 25, 10: 35, 11: 50,
  });
  const READY_TO_SAIL_WIRE = 30; // stage 9 with the charm and the potion both given

  const component = (name, fallback) => CacheDefinitions?.getComponentId?.(name) ?? fallback;
  const SIDEMODAL_UID = component("toplevel_osrs_stretch:sidemodal", (161 << 16) | 74);
  const OVERLAY_HUD_UID = component("toplevel_osrs_stretch:overlay_hud", (161 << 16) | 8);
  const OVERLAY_ATMOSPHERE_UID = component("toplevel_osrs_stretch:overlay_atmosphere", (161 << 16) | 1);
  const FADE_INTERFACE = 174; // fade_overlay
  const FADE_SCRIPT = 948;
  const FADE_CYCLES = 50;
  const SET_OFF_FADE_CYCLES = 15; // capture: the set-off fade is the only short one

  const SAILING_INTERFACE = 604; // fossilquest_sailing
  const SAILING_OVERLAY = 603; // fossilquest_sailing_overlay
  const VOYAGE_SCRIPT = 1993; // fossilquest_voyage
  const VOYAGE_END_SCRIPT = 1996; // fossilquest_voyage_end
  const sailing = (child) => (SAILING_INTERFACE << 16) | child;
  const SAIL_ABORT_BUTTON = sailing(2);
  const SAIL_BEARING = sailing(8);
  const SAIL_INCREASE_BUTTON = sailing(11);
  const SAIL_DECREASE_BUTTON = sailing(12);
  const SAIL_THROTTLE_HIGH = sailing(14);
  const SAIL_THROTTLE_MID = sailing(21);
  const SAIL_THROTTLE_LOW = sailing(28);
  const SAIL_DIRECTION_GRAPHIC = sailing(37);
  const SAIL_RIGHT_BUTTON = sailing(38);
  const SAIL_LEFT_BUTTON = sailing(39);

  const SAILING_SOURCE = Object.freeze({ x: 1808, y: 4744, widthChunks: 5, heightChunks: 4, planes: 3 });
  const SAILING_START_TILE = Object.freeze({ x: 1819, y: 4761, z: 1 });
  const SAILING_JUNIOR_TILE = Object.freeze({ x: 1820, y: 4762, z: 1 });
  const SAILING_HINT_TILE = Object.freeze({ x: 1818, y: 4761, z: 1 }); // in front of the controls at 1818,4760
  const HINT_ARROW_HEIGHT = 75;
  const HINT_ARROW_CENTRE = 2;

  /**
   * The voyage. Captured: the 4-tick cadence from the set-off, the bearing in steps of 391 around
   * north (33189, gauge 10120-49220), +10 within 6 steps and -5 outside, sails 0-2 starting at 1,
   * the rudder's three states, and that the progress step follows the sails set at the previous
   * update (3 points a step: lowered sails 1 point an update, full sails 3).
   * Ours: the wind (a prevailing drift plus gusts, scaled by the sails as the Wiki says sail height
   * changes how far the barge shifts), the rudder's 4 steps, and losing the way after 20 updates
   * in a row off course (the Junior Navigator's "headed in the wrong direction for too long").
   */
  const VOYAGE = Object.freeze({
    north: 33189, step: 391, minOffset: -59, maxOffset: 41, onCourse: 6, updateTicks: 4,
    gain: 10, loss: 5, sailPoints: [1, 1, 3], pointsPerStep: 3, startThrottle: 1,
    rudder: 4, prevailing: 4, gust: 3, sailScale: [1 / 3, 2 / 3, 1], lostAfter: 20,
  });
  const RUDDER_STRAIGHT = 0;
  const RUDDER_LEFT = 1;
  const RUDDER_RIGHT = 2;

  const STAGE_STARTED = 1;
  const STAGE_FOREMAN_BRIEFED = 2;
  const STAGE_PROPOSAL_OBTAINED = 3;
  const STAGE_AGREEMENT_OBTAINED = 4;
  const STAGE_SUPPLIES_SENT = 5;
  const STAGE_FOREMAN_READY = 6;
  const STAGE_MET_NAVIGATOR = 7;
  const STAGE_BAR_PATRONS = 8;
  const STAGE_PLAN_AGREED = 9;
  const STAGE_SAILING = 10;
  const STAGE_COMPLETE = 11;

  const CURATOR_NPC_ID = NpcIdentifiers.CURATOR_HAIG_HALEN; // 5214
  const BARGE_FOREMAN_NPC_ID = NpcIdentifiers.BARGE_FOREMAN; // 1938
  const SAWMILL_OPERATOR_NPC_ID = NpcIdentifiers.SAWMILL_OPERATOR; // 3101, Varrock and Hosidius
  const BERRY_NPC_ID = NpcIdentifiers.BERRY_3; // 7235, outside the Woodcutting Guild
  const APOTHECARY_NPC_ID = NpcIdentifiers.APOTHECARY; // 5036
  const ODD_OLD_MAN_NPC_ID = NpcIdentifiers.ODD_OLD_MAN; // 1259
  const DECK_GUARD_NPC_ID = NpcIdentifiers.BARGE_GUARD; // 7768, on the barge: Talk-to, Disembark
  const CANAL_GUARD_NPC_IDS = new Set([
    NpcIdentifiers.BARGE_GUARD_2, // 8012, post-quest: Talk-to, Embark, Quick-Travel
    NpcIdentifiers.BARGE_GUARD_3, // 8013, before completion: Talk-to, Embark
  ]);
  const LEAD_NAVIGATOR_NPC_IDS = new Set([
    NpcIdentifiers.LEAD_NAVIGATOR, // 7761
    NpcIdentifiers.LEAD_NAVIGATOR_2, // 7762
  ]);
  const JUNIOR_NAVIGATOR_NPC_IDS = new Set([
    NpcIdentifiers.JUNIOR_NAVIGATOR, // 7763
    NpcIdentifiers.JUNIOR_NAVIGATOR_2, // 7764
  ]);
  const JUNIOR_NAVIGATOR_SPAWN_ID = NpcIdentifiers.JUNIOR_NAVIGATOR; // 7763
  const JACK_SEAGULL_NPC_ID = NpcIdentifiers.JACK_SEAGULL; // 1335
  const LONGBOW_BEN_NPC_ID = NpcIdentifiers.LONGBOW_BEN; // 1336
  const AHAB_NPC_ID = NpcIdentifiers.AHAB; // 1337

  const SAWMILL_PROPOSAL_ITEM_ID = ItemIdentifiers.SAWMILL_PROPOSAL; // 21528
  const SAWMILL_AGREEMENT_ITEM_ID = ItemIdentifiers.SAWMILL_AGREEMENT; // 21529
  const BONE_CHARM_ITEM_ID = ItemIdentifiers.BONE_CHARM; // 21530
  const POTION_OF_SEALEGS_ITEM_ID = ItemIdentifiers.POTION_OF_SEALEGS; // 21531
  const FOSSIL_ISLAND_NOTE_BOOK_ITEM_ID = ItemIdentifiers.FOSSIL_ISLAND_NOTE_BOOK; // 21662
  const VODKA_ITEM_ID = ItemIdentifiers.VODKA; // 2015
  const MARRENTILL_POTION_UNF_ITEM_ID = ItemIdentifiers.MARRENTILL_POTION_UNF_; // 93

  const DIG_SITE_KEY = "the_dig_site";
  const PANDEMONIUM_KEY = "pandemonium";
  const WOODCUTTING_GUILD_LEVEL = 60;

  /** The barge decks: where the abort and the Digsite crossing land, and where the voyage arrives. */
  const CANAL_DECK_TILE = Object.freeze({ x: 3360, y: 3453, z: 1 });
  const ISLAND_DECK_TILE = Object.freeze({ x: 3723, y: 3784, z: 1 });
  /** Everything east of this is Fossil Island (the island barge, 3723,3784); the canal is at 3360. */
  const FOSSIL_ISLAND_MIN_X = 3600;
  const BOARD_ROUTE = "fossil-barge-board";
  const DISEMBARK_ROUTE = "fossil-barge-disembark";
  const CAMP_ROUTE = "fossil-island";
  const BOARD_FALLBACK = Object.freeze({ x: 3362, y: 3452, z: 1 });
  const DISEMBARK_FALLBACK = Object.freeze({ x: 3362, y: 3445, z: 0 });
  const CAMP_FALLBACK = Object.freeze({ x: 3724, y: 3808, z: 0 });

  const CHARM_ATTRIBUTE = "quest.bone_voyage.charm"; // 0 none, 1 got, 2 given away
  const POTION_ATTRIBUTE = "quest.bone_voyage.potion"; // 0 none, 1 got, 2 given away
  const APOTHECARY_ATTRIBUTE = "quest.bone_voyage.apothecary"; // 1 ingredients explained
  /** { phase, progress, points, bearing, throttle, steer, ticks, offCourse, prevailing }. */
  const VOYAGE_ATTRIBUTE = "quest.bone_voyage.voyage";
  /** Set on completion until the Junior Navigator hands over the journal (or the next login does). */
  const JOURNAL_PENDING_ATTRIBUTE = "bone-voyage:journal-pending";

  const GIVING_POTION_VARIANT = "the-cursed-voyage-giving-lead-navigator-the-sealegs-potion";
  const POTION_HANDOVER_STEPS = 4; // slice from "Looks like we've got everything we need to set off!"
  const CREW_SIP_STEP = "Bdvq4m";
  const CREW_PASS_OUT_STEP = "fnCM3G";
  const BRIEFING_FIRST_LINE = "You'll need to operate the barge controls, I'll let you know if we're headed in the right direction.";
  const BRIEFING_LAST_LINE = "If we're headed in the wrong direction for too long I'll take us back to the digsite. Let me know if you want me to go back over these instructions at any point.";
  const BOARDING_LINE = "Absolutely, the navigators are waiting for you on board!";
  /** Capture tick 722: the note book arrives as the second closing line is continued (the "journal" line is 723). */
  const JOURNAL_LINE = "I suppose you'll want to start exploring the island as soon as possible.";
  /** Capture tick 428: live's line ends in an ellipsis (the transcript's has a full stop). */
  const ABORT_MESSAGE = "With the aid of the junior navigator, you sail back to the digsite...";
  const QUEST_SCROLL_INTERFACE = 153;

  const SAILING_AREAS = new WeakMap();
  /** Each player's timeline key, so a logout cancels the fades still to come. */
  const TIMELINES = new WeakMap();

  let quest;

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const give = (player, itemId, amount = 1) => player.getInventory().adds(itemId, amount);
  const toLocation = (tile) => new Location(tile.x, tile.y, tile.z);

  function charmState(player) {
    return Number(player.getAttribute(CHARM_ATTRIBUTE)) || 0;
  }

  function potionState(player) {
    return Number(player.getAttribute(POTION_ATTRIBUTE)) || 0;
  }

  function apothecaryState(player) {
    return Number(player.getAttribute(APOTHECARY_ATTRIBUTE)) || 0;
  }

  /** Mirror the protection states to the client varbits Quest Helper keys on. */
  function syncProtectionVarbits(player) {
    const potion = potionState(player) >= 2 ? 3 : potionState(player) === 1 ? 2 : apothecaryState(player) >= 1 ? 1 : 0;
    const charm = charmState(player) >= 2 ? 2 : charmState(player) === 1 ? 1 : 0;
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_FOSSILQUEST_LUCKY_CHARM, charm);
    sender.sendVarbit(VARBIT_FOSSILQUEST_POTION, potion);
  }

  function readyToSail(player) {
    return charmState(player) >= 2 && potionState(player) >= 2;
  }

  function stageWire(stage, player) {
    if (stage === STAGE_PLAN_AGREED && readyToSail(player)) return READY_TO_SAIL_WIRE;
    return STAGE_WIRE[stage] ?? stage;
  }

  function sendWireStage(player) {
    player.getPacketSender().sendVarbit(VARBIT_FOSSILQUEST_PROGRESS, stageWire(quest.getStage(player), player));
  }

  function onFossilIsland(location) {
    return typeof location?.getX?.() === "number" && location.getX() >= FOSSIL_ISLAND_MIN_X;
  }

  // ==========================================================================
  // Timelines and screen effects
  // ==========================================================================

  function timelineKey(player) {
    let key = TIMELINES.get(player);
    if (!key) {
      key = { player };
      TIMELINES.set(player, key);
    }
    return key;
  }

  function later(player, ticks, action) {
    TaskManager.submit(new CountdownTask(timelineKey(player), ticks, () => {
      if (player.isRegistered?.() === false) return;
      action();
    }));
  }

  function fade(player, out, cycles = FADE_CYCLES) {
    const args = out ? [0, 255, 0, 0, cycles] : [0, 0, 0, 255, cycles];
    player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_INTERFACE, 1,
      { postScripts: [{ scriptId: FADE_SCRIPT, args }] });
  }

  function closeFade(player) {
    player.getPacketSender().closeSubInterface(OVERLAY_ATMOSPHERE_UID);
  }

  function setMinimap(player, off) {
    player.getPacketSender().sendVarbit(VARBIT_MINIMAP_STATE, off ? MINIMAP_OFF : 0);
  }

  /** The barge's fade crossings: the Ferries plugin's routes (plugins/world/data/ferries.json), or the plain move. */
  function ferry(player, route, fallback) {
    const request = { player, route, handled: false };
    api.emitCustomEvent("ferries:travel", request);
    if (!request.handled) player.moveTo(toLocation(fallback));
    return true;
  }

  // ==========================================================================
  // The voyage
  // ==========================================================================

  function voyageState(player) {
    const raw = player.getAttribute(VOYAGE_ATTRIBUTE);
    return raw && typeof raw === "object" ? raw : null;
  }

  function setVoyageState(player, state) {
    const { controlsOpen, ...saved } = state;
    player.setAttribute(VOYAGE_ATTRIBUTE, saved);
    return state;
  }

  function freshVoyage(phase) {
    const prevailing = (Math.random() < 0.5 ? -1 : 1) * VOYAGE.prevailing;
    return {
      phase, progress: 0, points: 0, bearing: 0, throttle: VOYAGE.startThrottle, lastThrottle: VOYAGE.startThrottle,
      steer: RUDDER_STRAIGHT, ticks: 0, offCourse: 0, prevailing, controlsOpen: false,
    };
  }

  function atSea(player) {
    const area = SAILING_AREAS.get(player);
    return !!area && !area.isDestroyed?.() && player.getArea?.() === area;
  }

  class SailingArea extends api.core.TemplatedInstanceArea {
    constructor(player, state) {
      super(SAILING_SOURCE.widthChunks, SAILING_SOURCE.heightChunks);
      const sourceChunkX = SAILING_SOURCE.x >> 3;
      const sourceChunkY = SAILING_SOURCE.y >> 3;
      for (let plane = 0; plane < SAILING_SOURCE.planes; plane++) {
        for (let chunkX = 0; chunkX < SAILING_SOURCE.widthChunks; chunkX++) {
          for (let chunkY = 0; chunkY < SAILING_SOURCE.heightChunks; chunkY++) {
            this.setChunk(plane, chunkX, chunkY, {
              sourceChunkX: sourceChunkX + chunkX,
              sourceChunkY: sourceChunkY + chunkY,
              sourcePlane: plane,
              rotation: 0,
            });
          }
        }
      }
      this.player = player;
      this.state = state;
      this.junior = null;
    }
    sourceTile(x, y, z) {
      return this.tile(x - SAILING_SOURCE.x, y - SAILING_SOURCE.y, z);
    }
    canTeleport() { return false; }
    process(member) {
      if (member !== this.player || this.state.phase !== "sailing") return;
      sailingTick(this);
    }
    postLeave(member, logout) {
      if (member === this.player) {
        if (SAILING_AREAS.get(member) === this) SAILING_AREAS.delete(member);
        if (logout) {
          TaskManager.cancelTasks?.(timelineKey(member));
          setVoyageState(member, this.state);
        }
      }
      super.postLeave(member, logout);
    }
  }

  function spawnSailingJunior(area) {
    if (area.junior) return area.junior;
    const tile = area.sourceTile(SAILING_JUNIOR_TILE.x, SAILING_JUNIOR_TILE.y, SAILING_JUNIOR_TILE.z);
    const npc = api.spawnNpc({
      id: JUNIOR_NAVIGATOR_SPAWN_ID, x: tile.getX(), y: tile.getY(), z: tile.getZ(),
      owner: area.player, ownerOnly: true, wanderRadius: 0,
    });
    if (npc) {
      npc.setScriptedMovement?.(true);
      npc.getMovementQueue?.().setBlockMovement?.(true);
      area.junior = npc;
      area.add(npc);
    }
    return npc;
  }

  /** The barge at sea: the cache template at 1808,4744 copied for the player, with the Junior Navigator. */
  function openSailingScene(player, state) {
    const existing = SAILING_AREAS.get(player);
    if (existing && !existing.isDestroyed()) {
      existing.state = state;
      return existing;
    }
    const area = new SailingArea(player, state);
    SAILING_AREAS.set(player, area);
    area.enter(player);
    const start = area.sourceTile(SAILING_START_TILE.x, SAILING_START_TILE.y, SAILING_START_TILE.z);
    player.moveTo(new Location(start.getX(), start.getY(), start.getZ()));
    spawnSailingJunior(area);
    return area;
  }

  function bearingAngle(state) {
    return VOYAGE.north + VOYAGE.step * (state.bearing | 0);
  }

  function sendVoyageScript(player, state) {
    player.getPacketSender().sendInterfaceScript(VOYAGE_SCRIPT, [
      SAIL_BEARING, bearingAngle(state), SAIL_THROTTLE_LOW, SAIL_THROTTLE_MID, SAIL_THROTTLE_HIGH,
      state.throttle | 0, SAIL_DIRECTION_GRAPHIC, state.steer | 0,
    ]);
  }

  function sendProgress(player, state) {
    player.getPacketSender().sendVarbit(VARBIT_FOSSILQUEST_SAILING_PROGRESS, Math.max(0, Math.min(100, state.progress | 0)));
  }

  function controlsHint(player, area, on) {
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_CURRENT_HINT_ARROW, on ? HINT_ARROW_CONTROLS : 0);
    sender.clearHintArrow?.();
    if (on && area) {
      const tile = area.sourceTile(SAILING_HINT_TILE.x, SAILING_HINT_TILE.y, SAILING_HINT_TILE.z);
      sender.sendPositionalHint?.(tile, HINT_ARROW_CENTRE, HINT_ARROW_HEIGHT, tile.getZ());
    }
  }

  function openControls(player, area) {
    if (!area || area.state.phase !== "sailing") return false;
    const sender = player.getPacketSender();
    controlsHint(player, area, false);
    sender.sendSubInterface(SIDEMODAL_UID, SAILING_INTERFACE, 0);
    sender.sendSubInterface(OVERLAY_HUD_UID, SAILING_OVERLAY, 1);
    sendVoyageScript(player, area.state);
    sendProgress(player, area.state);
    setMinimap(player, true);
    area.state.controlsOpen = true;
    return true;
  }

  /** The side-modal controls close (walking, talking, Abort); the overlay stays until the barge lands. */
  function closeControls(player) {
    const area = SAILING_AREAS.get(player);
    if (!area?.state?.controlsOpen) return;
    area.state.controlsOpen = false;
    player.getPacketSender().closeSubInterface(SIDEMODAL_UID);
    if (area.state.phase === "sailing") controlsHint(player, area, true);
  }

  function clearSailingScreen(player) {
    const area = SAILING_AREAS.get(player);
    if (area?.state) area.state.controlsOpen = false;
    const sender = player.getPacketSender();
    sender.closeSubInterface(SIDEMODAL_UID);
    sender.closeSubInterface(OVERLAY_HUD_UID);
    controlsHint(player, null, false);
  }

  function leaveSailingScene(player) {
    const area = SAILING_AREAS.get(player);
    SAILING_AREAS.delete(player);
    if (!area) return;
    if (player.getArea?.() === area) area.leave(player, false);
    else area.destroy();
  }

  function sailingTick(area) {
    const state = area.state;
    state.ticks = (state.ticks | 0) + 1;
    if (state.ticks % VOYAGE.updateTicks !== 0 || !state.controlsOpen) return;
    updateVoyage(area);
  }

  /** One 4-tick update: the progress step for the bearing it found, then the wind and rudder move it. */
  function updateVoyage(area) {
    const { player, state } = area;
    const onCourse = Math.abs(state.bearing | 0) <= VOYAGE.onCourse;
    const sails = Math.max(0, Math.min(2, state.lastThrottle ?? state.throttle));
    state.lastThrottle = state.throttle;
    state.points = (state.points | 0) + VOYAGE.sailPoints[sails];
    const before = state.progress | 0;
    while (state.points >= VOYAGE.pointsPerStep) {
      state.points -= VOYAGE.pointsPerStep;
      state.progress = Math.max(0, Math.min(100, (state.progress | 0) + (onCourse ? VOYAGE.gain : -VOYAGE.loss)));
    }
    state.offCourse = onCourse ? 0 : (state.offCourse | 0) + 1;
    const oldBearing = state.bearing | 0;
    // Ours: the wind and the rudder (no capture separates them).
    if (Math.random() < 0.1) state.prevailing = -(state.prevailing || VOYAGE.prevailing);
    const gust = Math.round((Math.random() * 2 - 1) * VOYAGE.gust);
    const wind = (state.prevailing | 0) + gust;
    const rudder = state.steer === RUDDER_LEFT ? VOYAGE.rudder : state.steer === RUDDER_RIGHT ? -VOYAGE.rudder : 0;
    const drift = Math.round(wind * VOYAGE.sailScale[Math.max(0, Math.min(2, state.throttle | 0))]) + rudder;
    state.bearing = Math.max(VOYAGE.minOffset, Math.min(VOYAGE.maxOffset, oldBearing + drift));
    if ((state.progress | 0) !== before) sendProgress(player, state);
    if (state.bearing !== oldBearing) sendVoyageScript(player, state);
    setVoyageState(player, state);
    if ((state.progress | 0) >= 100) arriveVoyage(player, area);
    else if (state.offCourse >= VOYAGE.lostAfter) returnToCanal(player, { failed: true });
  }

  /** "I'm ready, let's go.": the screen fades and, three ticks on, the player is on the barge at sea. */
  function startVoyage(player) {
    const stage = quest.getStage(player);
    if (stage !== STAGE_PLAN_AGREED && !(stage === STAGE_SAILING && !atSea(player))) return false;
    const state = setVoyageState(player, freshVoyage("briefing"));
    quest.setStage(player, STAGE_SAILING);
    fade(player, true, SET_OFF_FADE_CYCLES);
    later(player, 3, () => boardSailingBarge(player, state));
    return true;
  }

  function boardSailingBarge(player, state) {
    if (quest.getStage(player) !== STAGE_SAILING || atSea(player)) return;
    if (voyageState(player)?.phase !== "briefing") return;
    openSailingScene(player, state);
    watchBriefing(player);
  }

  function chatboxOpen(player) {
    return player.getDialogueManager?.()?.isActive?.() === true
      || api.core.MultiChatboxPrompt?.getPending?.(player) != null;
  }

  /**
   * Ours: a briefing walked away from (the chatbox closed before its end) must not leave the
   * barge dark or the controls dead: the screen fades in and Operate works, the controls closed.
   */
  function watchBriefing(player) {
    later(player, 1, () => {
      const area = SAILING_AREAS.get(player);
      if (!area || area.state.phase !== "briefing") return;
      if (chatboxOpen(player)) {
        watchBriefing(player);
        return;
      }
      startSailing(player, area, false);
    });
  }

  /** The briefing is over: faded in, and the controls open (its last line) or wait for Operate. */
  function startSailing(player, area, openNow) {
    area.state.phase = "sailing";
    setVoyageState(player, area.state);
    if (!area.state.fadedIn) fade(player, false);
    area.state.fadedIn = true;
    if (openNow) {
      closeFade(player);
      openControls(player, area);
      return;
    }
    controlsHint(player, area, true);
    later(player, 2, () => closeFade(player));
  }

  /**
   * The Junior Navigator's last briefing line: the controls open over the faded-in barge (capture
   * tick 346, on that continue). A tick on here: the conversation's own close would take the side
   * modal straight back down.
   */
  function finishBriefing(player) {
    const area = SAILING_AREAS.get(player);
    if (!area || area.state.phase !== "briefing") return;
    area.state.phase = "sailing";
    area.state.fadedIn = true;
    setVoyageState(player, area.state);
    closeFade(player);
    later(player, 1, () => {
      if (SAILING_AREAS.get(player) === area && !area.state.controlsOpen) openControls(player, area);
    });
  }

  /** Abort (Yes.) or a lost voyage: fade, then the canal barge deck three ticks on; the stage stays at 35. */
  function returnToCanal(player, { failed = false } = {}) {
    const area = SAILING_AREAS.get(player);
    if (!area || quest.getStage(player) !== STAGE_SAILING || area.state.phase !== "sailing") return false;
    area.state.phase = "returning";
    setVoyageState(player, area.state);
    clearSailingScreen(player);
    fade(player, true);
    later(player, 3, () => {
      if (!failed) player.sendMessage(ABORT_MESSAGE);
      landOnDeck(player, CANAL_DECK_TILE, "returned");
      // Transcript:Bone_Voyage "If the player fails the voyage": the Junior Navigator's line (ours: on landing).
      if (failed) startTranscript(api, player, JUNIOR_NAVIGATOR_SPAWN_ID, PAGE, VOYAGE_FAILED_VARIANT);
    });
    later(player, 6, () => closeFade(player));
    return true;
  }

  function landOnDeck(player, tile, phase) {
    const state = { ...(voyageState(player) ?? {}), phase };
    leaveSailingScene(player);
    player.moveTo(toLocation(tile));
    setVoyageState(player, state);
    player.getPacketSender().sendInterfaceScript(VOYAGE_END_SCRIPT, [SAIL_BEARING]);
    fade(player, false);
    setMinimap(player, false);
  }

  /** The bar is full: fade four ticks on, the Fossil Island barge at seven, the quest complete at ten. */
  function arriveVoyage(player, area) {
    area.state.phase = "arriving";
    area.state.progress = 100;
    setVoyageState(player, area.state);
    later(player, 4, () => {
      clearSailingScreen(player);
      fade(player, true);
    });
    later(player, 7, () => landOnDeck(player, ISLAND_DECK_TILE, "arrived"));
    // The fade overlay stays until the scroll closes (capture tick 719).
    later(player, 10, () => completeVoyage(player));
  }

  function completeVoyage(player) {
    if (quest.isComplete(player)) return;
    player.setAttribute(JOURNAL_PENDING_ATTRIBUTE, true);
    player.setAttribute(VOYAGE_ATTRIBUTE, 0);
    quest.complete(player);
  }

  /** After the completion scroll: the Junior Navigator's closing lines (the transcript's, after its MUBvQ9). */
  function playFinishingLines(player) {
    if (player.getAttribute(JOURNAL_PENDING_ATTRIBUTE) !== true) return;
    closeFade(player);
    startTranscript(api, player, JUNIOR_NAVIGATOR_SPAWN_ID, PAGE, FINISHING_VARIANT,
      (steps) => steps.filter((step) => step.id !== "MUBvQ9"));
  }

  function giveJournal(player) {
    if (player.getAttribute(JOURNAL_PENDING_ATTRIBUTE) !== true) return;
    player.setAttribute(JOURNAL_PENDING_ATTRIBUTE, false);
    if (!held(player, FOSSIL_ISLAND_NOTE_BOOK_ITEM_ID)) give(player, FOSSIL_ISLAND_NOTE_BOOK_ITEM_ID);
  }

  function pressSailingButton(event) {
    const { player, buttonId } = event;
    const area = SAILING_AREAS.get(player);
    if (!area || area.state.phase !== "sailing" || quest.getStage(player) !== STAGE_SAILING) return false;
    const state = area.state;
    if (buttonId === SAIL_ABORT_BUTTON) {
      // Capture tick 414: the controls close (hint arrow on them), then "Abort the voyage?" Yes./Cancel.
      closeControls(player);
      api.sendMultiChatboxPrompt(player, "Abort the voyage?", "Yes.", () => returnToCanal(player), "Cancel.", () => {});
      return true;
    }
    const before = [state.throttle, state.steer];
    if (buttonId === SAIL_INCREASE_BUTTON) state.throttle = Math.min(2, (state.throttle | 0) + 1);
    else if (buttonId === SAIL_DECREASE_BUTTON) state.throttle = Math.max(0, (state.throttle | 0) - 1);
    // The rudder (capture): right from straight is 2, from left back to straight; left the mirror.
    else if (buttonId === SAIL_RIGHT_BUTTON) state.steer = state.steer === RUDDER_LEFT ? RUDDER_STRAIGHT : RUDDER_RIGHT;
    else if (buttonId === SAIL_LEFT_BUTTON) state.steer = state.steer === RUDDER_RIGHT ? RUDDER_STRAIGHT : RUDDER_LEFT;
    else return false;
    if (before[0] !== state.throttle || before[1] !== state.steer) sendVoyageScript(player, state);
    setVoyageState(player, state);
    return true;
  }

  function operateBargeControls(event) {
    const { player } = event;
    const area = SAILING_AREAS.get(player);
    const phase = area?.state?.phase;
    if (!area || (phase !== "sailing" && phase !== "briefing") || quest.getStage(player) !== STAGE_SAILING) return false;
    if (event.option && String(event.option).toLowerCase() !== "operate") return false;
    event.handled = true;
    // A briefing cut short: Operate takes over from it.
    if (phase === "briefing") {
      startSailing(player, area, true);
      return true;
    }
    return openControls(player, area);
  }

  function handleInterfaceClosed({ player, interfaceId }) {
    if (interfaceId === QUEST_SCROLL_INTERFACE) {
      playFinishingLines(player);
      return;
    }
    if (interfaceId !== SAILING_INTERFACE) return;
    const area = SAILING_AREAS.get(player);
    if (!area?.state?.controlsOpen) return;
    area.state.controlsOpen = false;
    if (area.state.phase === "sailing") controlsHint(player, area, true);
  }

  /** The Junior Navigator at sea goes back over the briefing (capture ticks 348 and 360: no "Hello."). */
  function briefingSteps(steps) {
    const option = steps.find((step) => step.type === "choice")?.options?.[0]?.steps ?? [];
    const first = option.findIndex((step) => step.text === BRIEFING_FIRST_LINE);
    return first >= 0 ? option.slice(first) : [];
  }

  function talkToJuniorNavigator(event) {
    const { player, npcId } = event;
    if (!JUNIOR_NAVIGATOR_NPC_IDS.has(npcId) || quest.getStage(player) !== STAGE_SAILING || !atSea(player)) return false;
    closeControls(player);
    event.handled = true;
    startTranscript(api, player, npcId, PAGE, GIVING_POTION_VARIANT, briefingSteps);
    return true;
  }

  /** Junior Navigator's Travel: the row to the camp from Fossil Island; on the canal, his pointer to the lead. */
  function juniorNavigatorTravel(event) {
    const { player, npcId } = event;
    if (!JUNIOR_NAVIGATOR_NPC_IDS.has(npcId) || !quest.isComplete(player)) return false;
    event.handled = true;
    if (onFossilIsland(event.npc?.getLocation?.() ?? player.getLocation())) return ferry(player, CAMP_ROUTE, CAMP_FALLBACK);
    startTranscript(api, player, npcId, JUNIOR_PAGE, "standard-dialogue-digsite-right-click-travel-option");
    return true;
  }

  function isQuestComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function isQuestStarted(player, key) {
    const request = { player, key, started: false };
    api.emitCustomEvent("quest:is-started", request);
    return request.started === true;
  }

  /** Synchronous Museum contract: the real Museum handler fills request.kudos. */
  function kudosOf(player) {
    const request = { player, kudos: 0 };
    api.emitCustomEvent("museum:get-kudos", request);
    return Number(request.kudos) || 0;
  }

  function canStartBoneVoyage(player) {
    return isQuestComplete(player, DIG_SITE_KEY) && kudosOf(player) >= 100;
  }

  function canEnterWoodcuttingGuild(player) {
    return player.getSkillManager().getMaxLevel(Skill.WOODCUTTING) >= WOODCUTTING_GUILD_LEVEL;
  }

  function hasPotionIngredients(player) {
    return held(player, VODKA_ITEM_ID, 2) && held(player, MARRENTILL_POTION_UNF_ITEM_ID);
  }

  function variantSteps(variant) {
    const record = loadTranscripts(api)?.[PAGE];
    const steps = record?.variants?.[variant];
    return Array.isArray(steps) ? steps : [];
  }

  // ==========================================================================
  // Variant selection
  // ==========================================================================

  function selectSawmillVariant(player, npc, stage) {
    const x = npc?.getLocation?.()?.getX?.();
    // The two sawmill operators share NPC id 3101: Hosidius is far to the west.
    if (typeof x === "number" && x < 2000) {
      if (stage === STAGE_PROPOSAL_OBTAINED) {
        return "the-finishing-touches-talking-to-the-hosidius-sawmill-operator";
      }
      if (stage === STAGE_AGREEMENT_OBTAINED) {
        return held(player, SAWMILL_AGREEMENT_ITEM_ID)
          ? "the-finishing-touches-talking-to-hosidius-sawmill-operator-again"
          : "the-finishing-touches-claiming-another-trade-agreement-from-the-operator";
      }
      return null;
    }
    if (stage === STAGE_FOREMAN_BRIEFED) return "the-finishing-touches-talking-to-the-sawmill-operator";
    if (stage === STAGE_PROPOSAL_OBTAINED) {
      return held(player, SAWMILL_PROPOSAL_ITEM_ID)
        ? "the-finishing-touches-talking-to-the-sawmill-operator-again"
        : "the-finishing-touches-claiming-another-trade-proposal";
    }
    if (stage === STAGE_AGREEMENT_OBTAINED) {
      return "the-finishing-touches-returning-to-the-varrock-sawmill-operator";
    }
    return null;
  }

  /** The post-quest navigators' pages by which barge they stand on. */
  function navigatorPage(npc, player) {
    return onFossilIsland(npc?.getLocation?.() ?? player.getLocation())
      ? "standard-dialogue-fossil-island"
      : "standard-dialogue-digsite";
  }

  function selectLeadNavigatorVariant(player, stage, npc) {
    if (stage >= STAGE_COMPLETE) return navigatorPage(npc, player);
    if (stage === STAGE_FOREMAN_READY) {
      return "the-cursed-voyage-talking-to-the-lead-navigator";
    }
    if (stage === STAGE_MET_NAVIGATOR) return "the-cursed-voyage-talking-to-the-lead-navigator-again";
    if (stage === STAGE_BAR_PATRONS) return "talking-to-bar-patrons-returning-to-the-navigators";
    // Wire 35 (capture tick 290): once the crew has set off, "My head... What happened?".
    if (stage === STAGE_SAILING) return LEAD_TRY_AGAIN_VARIANT;
    if (stage !== STAGE_PLAN_AGREED) return null;
    if (held(player, POTION_OF_SEALEGS_ITEM_ID)) return GIVING_POTION_VARIANT;
    if (potionState(player) >= 2) return "the-cursed-voyage-talking-to-lead-navigator-again";
    return "talking-to-bar-patrons-talking-to-lead-navigator-before-getting-the-potion";
  }

  function selectJuniorNavigatorVariant(player, stage, npc) {
    if (stage >= STAGE_COMPLETE) return navigatorPage(npc, player);
    // Wire 35 off the barge at sea (capture tick 135): "You should talk to the lead navigator when you're ready to set sail."
    if (stage === STAGE_SAILING) return JUNIOR_AFTER_FAIL_VARIANT;
    if (stage === STAGE_PLAN_AGREED) {
      if (charmState(player) >= 2) return "the-cursed-voyage-talking-to-junior-navigator-again";
      if (held(player, BONE_CHARM_ITEM_ID)) return "the-cursed-voyage-giving-junior-navigator-the-bone-charm";
      return "talking-to-bar-patrons-talking-to-junior-navigator-before-getting-the-lucky-charm";
    }
    if (stage >= STAGE_SUPPLIES_SENT && stage <= STAGE_BAR_PATRONS) {
      return "the-cursed-voyage-talking-to-the-junior-navigator";
    }
    return null;
  }

  function selectBargeGuardVariant(npcId, stage) {
    // On the barge, every stage that can reach it (capture tick 147, wire 35): "Can I get off the barge?".
    if (npcId === DECK_GUARD_NPC_ID) return stage >= STAGE_FOREMAN_READY ? "after-bone-voyage-on-the-barge" : null;
    if (!CANAL_GUARD_NPC_IDS.has(npcId)) return null;
    if (stage >= STAGE_COMPLETE) return "after-bone-voyage-on-the-canal";
    if (stage >= STAGE_FOREMAN_READY) return "the-cursed-voyage-talking-to-the-barge-guard";
    return null;
  }

  function selectApothecaryVariant(player, stage) {
    if (stage < STAGE_PLAN_AGREED || stage >= STAGE_COMPLETE) return null;
    if (held(player, POTION_OF_SEALEGS_ITEM_ID) || potionState(player) >= 2) {
      return "talking-to-bar-patrons-talking-to-apothecary-after-getting-the-potion";
    }
    if (potionState(player) === 1) return "talking-to-bar-patrons-claiming-another-potion-of-sealegs";
    if (apothecaryState(player) >= 1) {
      return "talking-to-bar-patrons-talking-to-the-apothecary-talking-to-the-apothecary-again";
    }
    return "talking-to-bar-patrons-talking-to-the-apothecary";
  }

  function tailOfTwoCatsOwnsApothecary(player) {
    const request = { player, key: "a_tail_of_two_cats", stage: null };
    api.emitCustomEvent("quest:get-stage", request);
    return request.stage === 30 || request.stage === 40;
  }

  function selectOddOldManVariant(player, stage) {
    if (stage < STAGE_PLAN_AGREED || stage >= STAGE_COMPLETE) return null;
    if (held(player, BONE_CHARM_ITEM_ID)) {
      return "talking-to-bar-patrons-talking-to-odd-old-man-after-getting-the-bone-charm";
    }
    if (charmState(player) === 1) return "talking-to-bar-patrons-claiming-another-bone-charm";
    if (charmState(player) >= 2) return null; // already given to the junior navigator
    return "talking-to-bar-patrons-talking-to-the-odd-old-man";
  }

  /** Which transcript variant an NPC plays, by quest stage. */
  function selectVariant({ npcId, player, npc }) {
    const stage = quest.getStage(player);

    if (npcId === CURATOR_NPC_ID) {
      // The Golem's museum step owns the curator while that quest is in progress,
      // and The Dig Site owns him until it is complete (Bone Voyage requires it).
      if ((isQuestStarted(player, "the_golem") && !isQuestComplete(player, "the_golem")) ||
        !isQuestComplete(player, DIG_SITE_KEY)) return null;
      // After Bone Voyage the Curator is the canonical standard-dialogue NPC
      // again. Select it here because this plugin registers before the other
      // museum quests, which still claim him in their own stages.
      if (quest.isComplete(player)) return "standard-dialogue";
      // With the Dig Site complete the Curator transcript stays reachable at
      // under 100 Kudos so its canonical refusal branch can play.
      return stage === 0
        ? "starting-out-talking-to-curator-haig-halen"
        : "starting-out-talking-to-haig-halen-again";
    }

    if (npcId === BARGE_FOREMAN_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return "standard-dialogue-after-bone-voyage";
      if (stage === STAGE_SUPPLIES_SENT) return "the-cursed-voyage-talking-to-the-barge-foreman";
      if (stage >= STAGE_FOREMAN_READY) return "the-cursed-voyage-talking-to-the-barge-foreman-again";
      if (stage === STAGE_STARTED) return "the-finishing-touches-talking-to-the-barge-foreman";
      if (stage >= STAGE_FOREMAN_BRIEFED) return "the-finishing-touches-talking-to-barge-foreman-again";
      return null;
    }

    if (npcId === SAWMILL_OPERATOR_NPC_ID) return selectSawmillVariant(player, npc, stage);

    if (npcId === BERRY_NPC_ID) {
      if (stage === STAGE_PROPOSAL_OBTAINED) return "the-finishing-touches-talking-to-berry";
      if (stage === STAGE_AGREEMENT_OBTAINED) {
        return held(player, SAWMILL_AGREEMENT_ITEM_ID)
          ? "the-finishing-touches-talking-to-berry-talking-to-berry-again"
          : "the-finishing-touches-talking-to-berry-reclaiming-the-trade-agreement-from-berry";
      }
      return null;
    }

    if (npcId === DECK_GUARD_NPC_ID || CANAL_GUARD_NPC_IDS.has(npcId)) return selectBargeGuardVariant(npcId, stage);

    if (LEAD_NAVIGATOR_NPC_IDS.has(npcId)) return selectLeadNavigatorVariant(player, stage, npc);
    if (JUNIOR_NAVIGATOR_NPC_IDS.has(npcId)) return selectJuniorNavigatorVariant(player, stage, npc);

    if (npcId === JACK_SEAGULL_NPC_ID || npcId === LONGBOW_BEN_NPC_ID || npcId === AHAB_NPC_ID) {
      if (stage !== STAGE_MET_NAVIGATOR) return null;
      if (npcId === JACK_SEAGULL_NPC_ID) return "talking-to-bar-patrons-talking-to-jack-seagull";
      if (npcId === LONGBOW_BEN_NPC_ID) return "talking-to-bar-patrons-talking-to-longbow-ben";
      return "talking-to-bar-patrons-talking-to-ahab";
    }

    if (npcId === APOTHECARY_NPC_ID) return selectApothecaryVariant(player, stage);
    if (npcId === ODD_OLD_MAN_NPC_ID) return selectOddOldManVariant(player, stage);
    return null;
  }

  // ==========================================================================
  // Prose conditions
  // ==========================================================================

  function answerCondition({ npcId, player, stepId }) {
    switch (stepId) {
      case "wKfp1L": // If the player has not completed The Dig Site:
        // The dump has no words for this branch (a "missing" step), so it is never
        // taken; the Kudos refusal below carries the unmet-requirement message.
        return npcId === CURATOR_NPC_ID ? false : null;
      case "YIFCBb": // If the player has completed The Dig Site but doesn't have enough Kudos:
        return npcId === CURATOR_NPC_ID ? isQuestComplete(player, DIG_SITE_KEY) && kudosOf(player) < 100 : null;
      case "eSsOcb": // Before Bone Voyage:
        return npcId === CURATOR_NPC_ID ? !quest.isComplete(player) : null;
      case "1RIiH_": // After Bone Voyage:
      case "5xOdLs": // After Bone Voyage: the fossil-island questions option
        return npcId === CURATOR_NPC_ID ? quest.isComplete(player) : null;
      case "LV2D06": // If the player does not have the requirements to enter the Woodcutting Guild:
        return npcId === BERRY_NPC_ID ? !canEnterWoodcuttingGuild(player) : null;
      case "E7cwkN": // If the player has the requirements to enter the Woodcutting Guild:
        return npcId === BERRY_NPC_ID ? canEnterWoodcuttingGuild(player) : null;
      case "9i_Evk": // If the player doesn't have the sawmill proposal:
        return npcId === SAWMILL_OPERATOR_NPC_ID ? !held(player, SAWMILL_PROPOSAL_ITEM_ID) : null;
      case "dPvuGK": // If the player has the sawmill proposal:
        return npcId === SAWMILL_OPERATOR_NPC_ID ? held(player, SAWMILL_PROPOSAL_ITEM_ID) : null;
      case "0F3J3M": // If the player doesn't have the trade agreement:
        return npcId === SAWMILL_OPERATOR_NPC_ID ? !held(player, SAWMILL_AGREEMENT_ITEM_ID) : null;
      case "2oeHvt": // If the player has the trade agreement with them:
        return npcId === SAWMILL_OPERATOR_NPC_ID ? held(player, SAWMILL_AGREEMENT_ITEM_ID) : null;
      case "B-Orf7": // If the player doesn't have the ingredients:
        return npcId === APOTHECARY_NPC_ID ? !hasPotionIngredients(player) : null;
      case "-PIN4d": // If the player has the ingredients:
        return npcId === APOTHECARY_NPC_ID ? hasPotionIngredients(player) : null;
      case "5OiggG": // If the player hasn't completed Pandemonium:
        return LEAD_NAVIGATOR_NPC_IDS.has(npcId) ? !isQuestComplete(player, PANDEMONIUM_KEY) : null;
      case "FkQAxU": // If the player has completed Pandemonium:
        return LEAD_NAVIGATOR_NPC_IDS.has(npcId) ? isQuestComplete(player, PANDEMONIUM_KEY) : null;
      default:
        return null;
    }
  }

  // ==========================================================================
  // Dialogue events
  // ==========================================================================

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== CURATOR_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) !== 0 || !canStartBoneVoyage(player)) return;
    quest.setStage(player, STAGE_STARTED);
  }

  function grantSawmillProposal(player, npc) {
    if (quest.getStage(player) !== STAGE_FOREMAN_BRIEFED) return;
    const x = npc?.getLocation?.()?.getX?.();
    if (typeof x === "number" && x < 2000) return; // the Hosidius operator has its own variant
    if (held(player, SAWMILL_PROPOSAL_ITEM_ID)) return;
    give(player, SAWMILL_PROPOSAL_ITEM_ID);
    quest.setStage(player, STAGE_PROPOSAL_OBTAINED);
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;

    if (LEAD_NAVIGATOR_NPC_IDS.has(npcId)) {
      const stage = quest.getStage(player);
      if (stage === STAGE_FOREMAN_READY && option === "Yep, that would be me.") {
        quest.setStage(player, STAGE_MET_NAVIGATOR);
        return;
      }
      if ((stage === STAGE_PLAN_AGREED || stage === STAGE_SAILING) && option === "I'm ready, let's go.") startVoyage(player);
      return;
    }

    if (npcId === SAWMILL_OPERATOR_NPC_ID && option === "I'm here on behalf of the museum archaeological team.") {
      grantSawmillProposal(player, event.npc);
    }
  }

  function handleLine(event) {
    const { player, npcId, text } = event;

    // The Junior Navigator's briefing is spoken inside the Lead Navigator's conversation.
    if (text === BRIEFING_LAST_LINE && (LEAD_NAVIGATOR_NPC_IDS.has(npcId) || JUNIOR_NAVIGATOR_NPC_IDS.has(npcId))
      && voyageState(player)?.phase === "briefing") {
      const previous = event.after;
      event.after = () => {
        previous?.();
        finishBriefing(player);
      };
      return;
    }

    if (npcId === BARGE_FOREMAN_NPC_ID) {
      const stage = quest.getStage(player);
      if (stage === STAGE_STARTED && text === "Okay, I'll talk to the sawmill operator.") {
        quest.setStage(player, STAGE_FOREMAN_BRIEFED);
        return;
      }
      if (
        stage === STAGE_SUPPLIES_SENT &&
        text === "The barge guard will happily help you on board. Just give him a prod!"
      ) {
        quest.setStage(player, STAGE_FOREMAN_READY);
      }
      return;
    }

    // Capture tick 116: the fade starts as "Absolutely, the navigators..." is continued.
    if (CANAL_GUARD_NPC_IDS.has(npcId) && text === BOARDING_LINE && canBoard(player)) {
      const previous = event.after;
      event.after = () => {
        previous?.();
        boardBarge(player);
      };
      return;
    }

    if (npcId === SAWMILL_OPERATOR_NPC_ID) {
      if (text === "I lost the trade proposal..." && !held(player, SAWMILL_PROPOSAL_ITEM_ID)) {
        give(player, SAWMILL_PROPOSAL_ITEM_ID);
        return;
      }
      if (text === "I lost the trade agreement..." && !held(player, SAWMILL_AGREEMENT_ITEM_ID)) {
        give(player, SAWMILL_AGREEMENT_ITEM_ID);
      }
      return;
    }

    if (npcId === BERRY_NPC_ID) {
      if (text === "I lost the trade agreement..." && !held(player, SAWMILL_AGREEMENT_ITEM_ID)) {
        give(player, SAWMILL_AGREEMENT_ITEM_ID);
      }
      return;
    }

    if (npcId === APOTHECARY_NPC_ID) {
      // The first-time variant explains the ingredients; the second visit checks them.
      if (
        text === "Two bottles of vodka and an unfinished marrentill potion, I already have everything else I require."
      ) {
        player.setAttribute(APOTHECARY_ATTRIBUTE, 1);
        syncProtectionVarbits(player);
      }
      return;
    }

    if (LEAD_NAVIGATOR_NPC_IDS.has(npcId)) {
      const stage = quest.getStage(player);
      if (
        stage === STAGE_BAR_PATRONS &&
        text === "Okay, I'll be back once I've got the potion of sealegs and the lucky charm."
      ) {
        quest.setStage(player, STAGE_PLAN_AGREED);
        return;
      }
      if (stage === STAGE_PLAN_AGREED && text === "Yes, I have it here." && held(player, POTION_OF_SEALEGS_ITEM_ID)) {
        player.getInventory().deleteNumber(POTION_OF_SEALEGS_ITEM_ID, 1);
        player.setAttribute(POTION_ATTRIBUTE, 2);
        syncProtectionVarbits(player);
        sendWireStage(player);
      }
      return;
    }

    if (JUNIOR_NAVIGATOR_NPC_IDS.has(npcId)) {
      if (text === JOURNAL_LINE) {
        giveJournal(player);
        return;
      }
      if (
        quest.getStage(player) === STAGE_PLAN_AGREED &&
        text === "Yes, I have it here." &&
        held(player, BONE_CHARM_ITEM_ID)
      ) {
        player.getInventory().deleteNumber(BONE_CHARM_ITEM_ID, 1);
        player.setAttribute(CHARM_ATTRIBUTE, 2);
        syncProtectionVarbits(player);
        sendWireStage(player);
      }
      return;
    }

    if (
      npcId === JACK_SEAGULL_NPC_ID &&
      text === "Be off with ye then, and talk to them navigators! You're ruinin' me rum!" &&
      quest.getStage(player) === STAGE_MET_NAVIGATOR
    ) {
      quest.setStage(player, STAGE_BAR_PATRONS);
    }
  }

  /** The crew passing out (capture ticks 315 and 320): message boxes; the second fades the barge in. */
  function crewMessageBox(event) {
    if (quest.getStage(event.player) !== STAGE_SAILING) return;
    event.handled = true;
    event.box = { statement: true };
    if (event.stepId !== CREW_PASS_OUT_STEP) return;
    const { player } = event;
    const previous = event.after;
    event.after = () => {
      previous?.();
      const state = voyageState(player);
      if (state?.phase === "briefing" && !atSea(player)) boardSailingBarge(player, state);
      fade(player, false);
      const area = SAILING_AREAS.get(player);
      if (area) area.state.fadedIn = true;
    };
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    switch (stepId) {
      case CREW_SIP_STEP:
      case CREW_PASS_OUT_STEP:
        crewMessageBox(event);
        return;
      case "qqTUFt": // Berry signs the trade proposal
        if (npcId !== BERRY_NPC_ID) return;
        if (!held(player, SAWMILL_PROPOSAL_ITEM_ID)) {
          event.handled = true;
          return;
        }
        player.getInventory().deleteNumber(SAWMILL_PROPOSAL_ITEM_ID, 1);
        give(player, SAWMILL_AGREEMENT_ITEM_ID);
        quest.setStage(player, STAGE_AGREEMENT_OBTAINED);
        return;
      case "t4tIWK": // the Hosidius sawmill operator signs the proposal
        if (npcId !== SAWMILL_OPERATOR_NPC_ID) return;
        if (!held(player, SAWMILL_PROPOSAL_ITEM_ID)) {
          event.handled = true;
          return;
        }
        player.getInventory().deleteNumber(SAWMILL_PROPOSAL_ITEM_ID, 1);
        give(player, SAWMILL_AGREEMENT_ITEM_ID);
        quest.setStage(player, STAGE_AGREEMENT_OBTAINED);
        return;
      case "ydGRf_": // the Varrock sawmill operator receives the signed agreement
        if (npcId !== SAWMILL_OPERATOR_NPC_ID) return;
        if (!held(player, SAWMILL_AGREEMENT_ITEM_ID)) {
          event.handled = true;
          return;
        }
        player.getInventory().deleteNumber(SAWMILL_AGREEMENT_ITEM_ID, 1);
        quest.setStage(player, STAGE_SUPPLIES_SENT);
        return;
      case "xD7_29": // the apothecary mixes the potion
        if (npcId !== APOTHECARY_NPC_ID) return;
        if (!hasPotionIngredients(player)) {
          event.handled = true;
          return;
        }
        player.getInventory().deleteNumber(VODKA_ITEM_ID, 2);
        player.getInventory().deleteNumber(MARRENTILL_POTION_UNF_ITEM_ID, 1);
        give(player, POTION_OF_SEALEGS_ITEM_ID);
        player.setAttribute(POTION_ATTRIBUTE, 1);
        syncProtectionVarbits(player);
        return;
      case "jkqn2q": // another potion of sealegs
        if (npcId !== APOTHECARY_NPC_ID) return;
        if (!held(player, POTION_OF_SEALEGS_ITEM_ID)) give(player, POTION_OF_SEALEGS_ITEM_ID);
        player.setAttribute(POTION_ATTRIBUTE, 1);
        syncProtectionVarbits(player);
        return;
      case "SFRpYT":
      case "9o4UIM": // the Odd Old Man hands over the bone charm
        if (npcId !== ODD_OLD_MAN_NPC_ID) return;
        if (!held(player, BONE_CHARM_ITEM_ID)) give(player, BONE_CHARM_ITEM_ID);
        player.setAttribute(CHARM_ATTRIBUTE, 1);
        syncProtectionVarbits(player);
        return;
      case "MUBvQ9": // the transcript's completion: the voyage's arrival completes it instead
        if (JUNIOR_NAVIGATOR_NPC_IDS.has(npcId)) event.handled = true;
        return;
      case "sRnbFX": // lead navigator "same as above" once the potion is handed in
        if (!LEAD_NAVIGATOR_NPC_IDS.has(npcId)) return;
        if (quest.getStage(player) !== STAGE_PLAN_AGREED || potionState(player) < 2) return;
        event.handled = true;
        event.steps = variantSteps(GIVING_POTION_VARIANT).slice(POTION_HANDOVER_STEPS);
        return;
      default:
        return;
    }
  }

  /**
   * The Apothecary's Talk-to is taken as a named hook rather than through the generic
   * NpcDialogues handler: another quest binds "Apothecary" first and silently consumes
   * the click while its own quest is inactive, so the generic path never runs. Bone
   * Voyage's hook is registered earlier alphabetically; other stages fall through.
   */
  function talkToApothecary(event) {
    const { player, npcId } = event;
    if (npcId !== APOTHECARY_NPC_ID) return false;
    if (tailOfTwoCatsOwnsApothecary(player)) return false;
    const variant = selectApothecaryVariant(player, quest.getStage(player));
    if (!variant) return false;
    startTranscript(api, player, npcId, PAGE, variant);
    return true;
  }

  // ==========================================================================
  // The canal barge
  // ==========================================================================

  /** The guard lets the player on once the foreman says the barge is ready, and ever after. */
  function canBoard(player) {
    return quest.getStage(player) >= STAGE_FOREMAN_READY;
  }

  function boardBarge(player) {
    if (!canBoard(player)) return false;
    return ferry(player, BOARD_ROUTE, BOARD_FALLBACK);
  }

  function embarkBarge(event) {
    if (!CANAL_GUARD_NPC_IDS.has(event.npcId) || !canBoard(event.player)) return false;
    event.handled = boardBarge(event.player);
    return event.handled;
  }

  function disembarkBarge(event) {
    if (event.npcId !== DECK_GUARD_NPC_ID) return false;
    event.handled = ferry(event.player, DISEMBARK_ROUTE, DISEMBARK_FALLBACK);
    return true;
  }

  // ==========================================================================
  // Journal and login
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Curator Haig Halen asked me to help finish the barge for the</str>",
        "<str>museum's expedition to Fossil Island.</str>",
        "<str>I helped reinforce the barge with redwood planks, found a way</str>",
        "<str>past the curse and sailed to Fossil Island.</str>",
        "",
        "<str>I now have access to Fossil Island.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage === 0) {
      return [
        "I can start this quest by speaking to <col=800000>Curator Haig Halen</col>",
        "in the <col=800000>Varrock Museum</col>.",
        "",
        "I must have completed <col=800000>The Dig Site</col> and earned",
        "100 <col=800000>Kudos</col> from the museum.",
      ];
    }
    const lines = [
      "Curator Haig Halen asked me to help finish the barge for the",
      "museum's expedition to Fossil Island.",
      "",
    ];
    if (stage === STAGE_STARTED) {
      lines.push(
        "I should speak to the <col=800000>barge foreman</col> at the canal",
        "north of the Digsite."
      );
    } else if (stage === STAGE_FOREMAN_BRIEFED) {
      lines.push(
        "I should talk to the <col=800000>sawmill operator</col> at the Lumber",
        "Yard north-west of the Digsite."
      );
    } else if (stage === STAGE_PROPOSAL_OBTAINED) {
      lines.push(
        "I should deliver the <col=800000>sawmill proposal</col> to the sawmill",
        "operator in the Woodcutting Guild in Hosidius, or to Berry",
        "outside the guild if I cannot enter."
      );
    } else if (stage === STAGE_AGREEMENT_OBTAINED) {
      lines.push(
        "I should return the signed <col=800000>sawmill agreement</col> to the",
        "sawmill operator at the Lumber Yard."
      );
    } else if (stage === STAGE_SUPPLIES_SENT) {
      lines.push("The supplies have been sent. I should let the", "<col=800000>barge foreman</col> know.");
    } else if (stage === STAGE_FOREMAN_READY) {
      lines.push("I should board the barge and speak to the", "<col=800000>lead navigator</col>.");
    } else if (stage === STAGE_MET_NAVIGATOR) {
      lines.push(
        "The voyage is said to be cursed. I should ask the sailors at",
        "the <col=800000>Rusty Anchor Inn</col> in Port Sarim about it."
      );
    } else if (stage === STAGE_BAR_PATRONS) {
      lines.push(
        "I should tell the <col=800000>navigators</col> what I learned at the",
        "Rusty Anchor Inn."
      );
    } else if (stage === STAGE_PLAN_AGREED) {
      lines.push(
        "I need a <col=800000>potion of sealegs</col> from the Apothecary in",
        "Varrock (2 vodka and a marrentill potion (unf)) and a lucky",
        "<col=800000>bone charm</col> from the Odd Old Man near Paterdomus."
      );
    } else if (stage === STAGE_SAILING) {
      if (voyageState(player)?.phase === "sailing") {
        lines.push(
          "I should operate the <col=800000>barge controls</col> and keep the",
          "bearing north until we reach Fossil Island."
        );
      } else {
        lines.push("I should talk to the <col=800000>Lead Navigator</col> on the barge to", "set sail again.");
      }
    }
    return lines;
  }

  /** A save from inside the voyage: back on the barge at sea, ashore, or on the canal deck. */
  function resumeVoyage(player) {
    const voyage = voyageState(player);
    const phase = voyage?.phase;
    if ((phase === "sailing" || phase === "briefing") && (voyage.progress | 0) < 100) {
      const state = { ...freshVoyage("sailing"), ...voyage, phase: "sailing", controlsOpen: false };
      setVoyageState(player, state);
      const area = openSailingScene(player, state);
      controlsHint(player, area, true);
      setMinimap(player, true);
      return;
    }
    if (phase === "returning" || phase === "aborted") {
      player.moveTo(toLocation(CANAL_DECK_TILE));
      setVoyageState(player, { ...voyage, phase: "returned" });
      return;
    }
    if (phase === "returned") return;
    // "arriving", "arrived", or a stage-10 save from before the voyage was played (already ashore).
    if (!onFossilIsland(player.getLocation())) player.moveTo(toLocation(ISLAND_DECK_TILE));
    completeVoyage(player);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    if (player?.isPlayerBot?.() === true) return;
    if (quest.getStage(player) === STAGE_SAILING) resumeVoyage(player);
    else if (quest.isComplete(player)) giveJournal(player);
    syncProtectionVarbits(player);
    sendWireStage(player);
  }

  function handleLogout({ player }) {
    TaskManager.cancelTasks?.(timelineKey(player));
  }

  api.persistAttribute(CHARM_ATTRIBUTE);
  api.persistAttribute(POTION_ATTRIBUTE);
  api.persistAttribute(APOTHECARY_ATTRIBUTE);
  api.persistAttribute(VOYAGE_ATTRIBUTE);
  api.persistAttribute(JOURNAL_PENDING_ATTRIBUTE, false);

  quest = registerQuest(api, {
    key: "bone_voyage",
    name: "Bone Voyage",
    varpId: VARP_FOSSILQUEST_MAIN,
    varbitId: VARBIT_FOSSILQUEST_PROGRESS,
    varbitValue: stageWire,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [],
    // Capture tick 708: the scroll shows the bone charm and lists the points and the island only;
    // the note book comes from the Junior Navigator's "Here, take this journal..." (tick 722).
    scrollItemId: BONE_CHARM_ITEM_ID,
    otherRewards: ["Access to Fossil Island"],
    buildJournal,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcInteraction("Barge guard", { Embark: embarkBarge, Disembark: disembarkBarge });
  api.onNpcInteraction("Junior Navigator", { "Talk-to": talkToJuniorNavigator, Travel: juniorNavigatorTravel });
  api.onNpcInteraction("Apothecary", { "Talk-to": talkToApothecary });
  api.onObjectInteraction("Barge controls", { Operate: operateBargeControls });
  api.onInterfaceActionButton([
    SAIL_ABORT_BUTTON, SAIL_INCREASE_BUTTON, SAIL_DECREASE_BUTTON, SAIL_RIGHT_BUTTON, SAIL_LEFT_BUTTON,
  ], pressSailingButton);
  api.onCustomEvent("interface:closed", handleInterfaceClosed);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
