/**
 * Bone Voyage (members).
 *
 * The words come from the "Bone Voyage" transcript page (plus the Barge guard /
 * navigator pages for the post-quest travel). This plugin supplies the per-stage
 * variant selector for the curator, both sawmill operators, Berry, the barge
 * crew, the bar patrons, the apothecary and the Odd Old Man, the prose-condition
 * answers, the item hand-ins, the boarding spawns and the completion reward.
 *
 * Durable stages stay 1..11 so existing saves keep their meaning:
 *   1 started (curator), 2 barge foreman briefed (go to the Varrock sawmill),
 *   3 sawmill proposal obtained (deliver to the Hosidius guild/Berry), 4 signed
 *   agreement obtained (back to the Varrock sawmill), 5 agreement delivered /
 *   supplies sent (barge foreman), 6 barge ready (board via the guard), 7 lead
 *   navigator met (ask at the Rusty Anchor), 8 bar patrons talked (return to
 *   the navigators), 9 plan agreed (potion of sealegs + lucky bone charm),
 *   10 sailing / arrived at Fossil Island, 11 complete.
 * Varbit 5795 "fossilquest_progress" (varp 1630 bits 0-8) carries Quest Helper's
 * loadSteps values 0/5/10/11/15/20/21/22/23/25/30/35. Native quest DB table 0
 * row 11 column 19 completes at 50 (script 4024 case 11 reads varbit 5795), so
 * durable completion maps to native 50 while the durable stage stays 11.
 *
 * Requirements (OSRS Wiki): The Dig Site and 100 Kudos. The Dig Site is asked
 * through the shared "quest:is-complete" event; Kudos is read synchronously from
 * the Museum module's "museum:get-kudos" event. The start hook and the Curator
 * prose branch both enforce the 100-Kudos threshold, so the canonical refusal
 * transcript remains reachable at 99.
 *
 * Rewards per the OSRS Wiki: 1 Quest Point, access to Fossil Island and the
 * Fossil island note book.
 *
 * Source: https://oldschool.runescape.wiki/w/Bone_Voyage and
 * /w/Transcript:Bone_Voyage; ids from scripts/lookup-gameval.ts and the cache
 * npc/item/object identifier files.
 *
 * Boarding and sailing:
 * - The canal barge deck is the real cache level-1 deck (3355-3366,3451-3455);
 *   the bank guard (spawned 8013) embarks the player and the static/deck guard
 *   (7768, Disembark) takes them back off. The Lead/Junior Navigators are
 *   owner-only deck spawns at 3363,3453 / 3361,3452.
 * - The voyage copies the cache sailing template at 1808,4744 into a
 *   TemplatedInstanceArea and uses the real Barge controls (30569, Operate),
 *   interface 604, overlay 603 and varbits 5798 (progress 0-100) / 5799
 *   (direction graphic). Wind is deterministic and the numeric course/speed
 *   tuning is plugin-local because no capture publishes the live rates.
 * - Pandemonium is asked through quest:is-complete for the voyage branch.
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
 * - Post-quest travel via the spawned guard's "Let's go to Fossil Island!"
 *   still teleports to the camp shore rather than replaying the voyage.
 */
module.exports = function registerBoneVoyageQuest(api) {
  const { ItemIdentifiers, Location, NpcIdentifiers, Skill } = api.core;
  const { registerQuest, refreshQuestList, loadTranscripts, startTranscript } = require("../QuestRuntime");

  const PAGE = "Bone Voyage";
  const START_HOOK = "quest:bone-voyage:start";

  const VARP_FOSSILQUEST_MAIN = 1630; // "fossilquest_main"
  const VARBIT_FOSSILQUEST_PROGRESS = 5795; // "fossilquest_progress", varp 1630 bits 0-8
  const VARBIT_FOSSILQUEST_LUCKY_CHARM = 5796; // "fossilquest_lucky_charm", bits 9-10
  const VARBIT_FOSSILQUEST_POTION = 5797; // "fossilquest_potion", bits 11-12
  const VARBIT_FOSSILQUEST_SAILING_PROGRESS = 5798; // bits 0-6, 0-100
  const VARBIT_FOSSILQUEST_SAILING_ARROW = 5799; // bits 7-30, direction graphic
  const STAGE_WIRE = Object.freeze({
    0: 0, 1: 5, 2: 10, 3: 11, 4: 15, 5: 20, 6: 21, 7: 22, 8: 23, 9: 25, 10: 30, 11: 50,
  });
  const ARRIVED_WIRE_STAGE = 35; // QH's last sailing key; native completion is 50.
  const SAILING_INTERFACE = 604; // fossilquest_sailing
  const SAILING_OVERLAY = 603; // fossilquest_sailing_overlay
  const SAILING_HUD_UID = (161 << 16) | 8;
  const SAILING_OVERLAY_UID = (161 << 16) | 1;
  const SAIL_ABORT_BUTTON = (SAILING_INTERFACE << 16) | 2; // Abort
  const SAIL_INCREASE_BUTTON = (SAILING_INTERFACE << 16) | 11; // Increase throttle
  const SAIL_DECREASE_BUTTON = (SAILING_INTERFACE << 16) | 12; // Decrease throttle
  const SAIL_RIGHT_BUTTON = (SAILING_INTERFACE << 16) | 38; // Steer right
  const SAIL_LEFT_BUTTON = (SAILING_INTERFACE << 16) | 39; // Steer left
  const SAILING_SOURCE = Object.freeze({ x: 1808, y: 4744, widthChunks: 5, heightChunks: 4, planes: 3 });
  const SAILING_START_TILE = Object.freeze({ x: 1818, y: 4761, z: 1 });
  const SAILING_JUNIOR_TILE = Object.freeze({ x: 1815, y: 4760, z: 1 });
  // ponytail: deterministic wind and gain table stand in for untranscribed live rates.
  const SAILING_WIND = Object.freeze([-1, 0, 1, 0, 1, -1]);
  const SAILING_WIND_TICKS = 6;
  const SAILING_MAX_TICKS = 240;

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
  const BARGE_GUARD_NPC_IDS = new Set([
    NpcIdentifiers.BARGE_GUARD, // 7768
    NpcIdentifiers.BARGE_GUARD_2, // 8012
    NpcIdentifiers.BARGE_GUARD_3, // 8013
  ]);
  const BARGE_GUARD_SPAWN_ID = NpcIdentifiers.BARGE_GUARD_3; // 8013, Talk-to + Embark
  const LEAD_NAVIGATOR_NPC_IDS = new Set([
    NpcIdentifiers.LEAD_NAVIGATOR, // 7761
    NpcIdentifiers.LEAD_NAVIGATOR_2, // 7762
  ]);
  const JUNIOR_NAVIGATOR_NPC_IDS = new Set([
    NpcIdentifiers.JUNIOR_NAVIGATOR, // 7763
    NpcIdentifiers.JUNIOR_NAVIGATOR_2, // 7764
  ]);
  const LEAD_NAVIGATOR_SPAWN_ID = NpcIdentifiers.LEAD_NAVIGATOR; // 7761
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

  // Cache-walkable tiles: bank guard, the real canal barge deck on plane 1, and
  // the Fossil Island shore.
  const GUARD_TILE = { x: 3364, y: 3446, z: 0 };
  const BOAT_DECK_TILE = { x: 3360, y: 3454, z: 1 };
  const LEAD_NAVIGATOR_TILE = { x: 3363, y: 3453, z: 1 };
  const JUNIOR_NAVIGATOR_TILE = { x: 3361, y: 3452, z: 1 };
  const ISLAND_ARRIVAL_TILE = { x: 3720, y: 3782, z: 0 };
  const ISLAND_JUNIOR_TILE = { x: 3721, y: 3782, z: 0 };

  const CHARM_ATTRIBUTE = "quest.bone_voyage.charm"; // 0 none, 1 got, 2 given away
  const POTION_ATTRIBUTE = "quest.bone_voyage.potion"; // 0 none, 1 got, 2 given away
  const APOTHECARY_ATTRIBUTE = "quest.bone_voyage.apothecary"; // 1 ingredients explained
  const VOYAGE_ATTRIBUTE = "quest.bone_voyage.voyage"; // { phase, progress, heading, throttle, ticks }

  const GIVING_POTION_VARIANT = "the-cursed-voyage-giving-lead-navigator-the-sealegs-potion";
  const POTION_HANDOVER_STEPS = 4; // slice from "Looks like we've got everything we need to set off!"

  const GUARD_SPAWNS = new Map();
  const CANAL_NAVIGATORS = new Map();
  const ISLAND_JUNIORS = new Map();
  const SAILING_AREAS = new WeakMap();

  let quest;

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const give = (player, itemId, amount = 1) => player.getInventory().adds(itemId, amount);

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

  function stageWire(stage, player) {
    if (stage === STAGE_SAILING && voyageState(player)?.phase === "arrived") return ARRIVED_WIRE_STAGE;
    return STAGE_WIRE[stage] ?? stage;
  }

  function sendWireStage(player) {
    player.getPacketSender().sendVarbit(VARBIT_FOSSILQUEST_PROGRESS, stageWire(quest.getStage(player), player));
  }

  function voyageState(player) {
    const raw = player.getAttribute(VOYAGE_ATTRIBUTE);
    return raw && typeof raw === "object" ? raw : null;
  }

  function setVoyageState(player, state) {
    player.setAttribute(VOYAGE_ATTRIBUTE, state);
    return state;
  }

  function clearVoyageState(player) {
    player.setAttribute(VOYAGE_ATTRIBUTE, 0);
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
        if (logout) setVoyageState(member, this.state);
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

  function openSailingScene(player, state) {
    const existing = SAILING_AREAS.get(player);
    if (existing && !existing.isDestroyed()) {
      existing.state = state;
      return existing;
    }
    removeIslandJunior(player);
    const area = new SailingArea(player, state);
    SAILING_AREAS.set(player, area);
    area.enter(player);
    const start = area.sourceTile(SAILING_START_TILE.x, SAILING_START_TILE.y, SAILING_START_TILE.z);
    player.moveTo(new Location(start.getX(), start.getY(), start.getZ()));
    spawnSailingJunior(area);
    return area;
  }

  function startVoyage(player) {
    if (quest.getStage(player) !== STAGE_PLAN_AGREED) return false;
    removeCanalNavigators(player);
    const state = setVoyageState(player, { phase: "sailing", progress: 0, heading: 0, throttle: 1, ticks: 0, wind: 0 });
    quest.setStage(player, STAGE_SAILING);
    openSailingScene(player, state);
    return true;
  }

  function sailingDirection(state) {
    // The direction graphic is an angle in the cache script; keep it monotonic with the rudder.
    return (state.heading + 2) * 45;
  }

  function sendSailingVarbits(player, state) {
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_FOSSILQUEST_SAILING_PROGRESS, Math.max(0, Math.min(100, state.progress | 0)));
    sender.sendVarbit(VARBIT_FOSSILQUEST_SAILING_ARROW, sailingDirection(state));
  }

  function openControls(player, area) {
    if (!area || area.state.phase !== "sailing") return false;
    const sender = player.getPacketSender();
    sendSailingVarbits(player, area.state);
    sender.sendSubInterface(SAILING_HUD_UID, SAILING_INTERFACE, 1);
    sender.sendSubInterface(SAILING_OVERLAY_UID, SAILING_OVERLAY, 1);
    area.state.controlsOpen = true;
    return true;
  }

  function closeControls(player) {
    const sender = player.getPacketSender();
    sender.closeSubInterface(SAILING_HUD_UID);
    sender.closeSubInterface(SAILING_OVERLAY_UID);
    const area = SAILING_AREAS.get(player);
    if (area?.state) area.state.controlsOpen = false;
  }

  function sailingTick(area) {
    const player = area.player;
    const state = area.state;
    if (!state.controlsOpen || state.phase !== "sailing") return;
    state.ticks = (state.ticks | 0) + 1;
    state.wind = SAILING_WIND[Math.floor(state.ticks / SAILING_WIND_TICKS) % SAILING_WIND.length];
    const offCourse = state.heading - state.wind;
    const speed = state.throttle + 1;
    const gain = offCourse === 0 ? speed + 1 : Math.abs(offCourse) === 1 ? speed : -2;
    state.progress = Math.max(0, Math.min(100, (state.progress | 0) + gain));
    sendSailingVarbits(player, state);
    if (state.progress >= 100) {
      arriveVoyage(player, area);
      return;
    }
    if (state.ticks > SAILING_MAX_TICKS) {
      abortVoyage(player, area);
      return;
    }
    if (state.ticks % 5 === 0) setVoyageState(player, state);
  }

  function endSailingScene(player, area) {
    closeControls(player);
    if (SAILING_AREAS.get(player) === area) SAILING_AREAS.delete(player);
    if (player.getArea?.() === area) area.leave(player, false);
    else area.destroy();
  }

  function arriveVoyage(player, area) {
    const state = area.state;
    state.phase = "arrived";
    state.progress = 100;
    state.controlsOpen = false;
    setVoyageState(player, state);
    endSailingScene(player, area);
    player.moveTo(new Location(ISLAND_ARRIVAL_TILE.x, ISLAND_ARRIVAL_TILE.y, ISLAND_ARRIVAL_TILE.z));
    ensureIslandJunior(player);
    sendWireStage(player);
  }

  function abortVoyage(player, area = SAILING_AREAS.get(player)) {
    if (quest.getStage(player) !== STAGE_SAILING) return false;
    if (area) {
      area.state.phase = "aborted";
      setVoyageState(player, area.state);
      endSailingScene(player, area);
    }
    clearVoyageState(player);
    quest.setStage(player, STAGE_PLAN_AGREED);
    player.moveTo(new Location(GUARD_TILE.x, GUARD_TILE.y, GUARD_TILE.z));
    ensureGuard(player);
    ensureCanalNavigators(player);
    return true;
  }

  function pressSailingButton(event) {
    const { player, buttonId } = event;
    const area = SAILING_AREAS.get(player);
    if (!area || area.state.phase !== "sailing" || quest.getStage(player) !== STAGE_SAILING) return false;
    if (buttonId === SAIL_ABORT_BUTTON) {
      abortVoyage(player, area);
      return true;
    }
    if (buttonId === SAIL_INCREASE_BUTTON) area.state.throttle = Math.min(3, (area.state.throttle | 0) + 1);
    else if (buttonId === SAIL_DECREASE_BUTTON) area.state.throttle = Math.max(0, (area.state.throttle | 0) - 1);
    else if (buttonId === SAIL_RIGHT_BUTTON) area.state.heading = Math.min(2, (area.state.heading | 0) + 1);
    else if (buttonId === SAIL_LEFT_BUTTON) area.state.heading = Math.max(-2, (area.state.heading | 0) - 1);
    else return false;
    setVoyageState(player, area.state);
    sendSailingVarbits(player, area.state);
    return true;
  }

  function operateBargeControls(event) {
    const { player } = event;
    const area = SAILING_AREAS.get(player);
    if (!area || area.state.phase !== "sailing" || quest.getStage(player) !== STAGE_SAILING) return false;
    if (event.option && String(event.option).toLowerCase() !== "operate") return false;
    event.handled = true;
    return openControls(player, area);
  }

  function handleInterfaceClosed({ player, interfaceId }) {
    if (interfaceId !== SAILING_INTERFACE && interfaceId !== SAILING_OVERLAY) return;
    const area = SAILING_AREAS.get(player);
    if (area?.state) area.state.controlsOpen = false;
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

  function selectLeadNavigatorVariant(player, stage) {
    if (stage === STAGE_FOREMAN_READY) {
      return "the-cursed-voyage-talking-to-the-lead-navigator";
    }
    if (stage === STAGE_MET_NAVIGATOR) return "the-cursed-voyage-talking-to-the-lead-navigator-again";
    if (stage === STAGE_BAR_PATRONS) return "talking-to-bar-patrons-returning-to-the-navigators";
    if (stage !== STAGE_PLAN_AGREED) return null;
    if (held(player, POTION_OF_SEALEGS_ITEM_ID)) return GIVING_POTION_VARIANT;
    if (potionState(player) >= 2) return "the-cursed-voyage-talking-to-lead-navigator-again";
    return "talking-to-bar-patrons-talking-to-lead-navigator-before-getting-the-potion";
  }

  /** Canonical island shore beside the docked barge deck at 3715,3784,1. */
  function isAtIslandArrival(player) {
    const location = player.getLocation?.();
    if (!location || location.getZ() !== 0) return false;
    return Math.max(
      Math.abs(location.getX() - ISLAND_ARRIVAL_TILE.x),
      Math.abs(location.getY() - ISLAND_ARRIVAL_TILE.y),
    ) <= 4;
  }

  function selectJuniorNavigatorVariant(player, stage) {
    if (stage === STAGE_SAILING) {
      if (isAtIslandArrival(player)) return "the-cursed-voyage-finishing-up";
      // Still at sea (QH sailing zone 1812,4750-1840,4774): never offer the
      // completion branch. The on-board safe lines are the charm thanks or the
      // pre-sail "talk to the lead navigator" line.
      return charmState(player) >= 2
        ? "the-cursed-voyage-talking-to-junior-navigator-again"
        : "the-cursed-voyage-talking-to-the-junior-navigator";
    }
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

    if (BARGE_GUARD_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return "after-bone-voyage-on-the-canal";
      if (stage >= STAGE_FOREMAN_READY && stage <= STAGE_PLAN_AGREED) {
        return "the-cursed-voyage-talking-to-the-barge-guard";
      }
      return null;
    }

    if (LEAD_NAVIGATOR_NPC_IDS.has(npcId)) return selectLeadNavigatorVariant(player, stage);
    if (JUNIOR_NAVIGATOR_NPC_IDS.has(npcId)) return selectJuniorNavigatorVariant(player, stage);

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

    if (BARGE_GUARD_NPC_IDS.has(npcId) && option === "Can I go onto the barge?") {
      boardBarge(player);
      return;
    }

    if (LEAD_NAVIGATOR_NPC_IDS.has(npcId)) {
      const stage = quest.getStage(player);
      if (stage === STAGE_FOREMAN_READY && option === "Yep, that would be me.") {
        quest.setStage(player, STAGE_MET_NAVIGATOR);
        return;
      }
      if (stage === STAGE_PLAN_AGREED && option === "I'm ready, let's go.") startVoyage(player);
      return;
    }

    if (npcId === SAWMILL_OPERATOR_NPC_ID && option === "I'm here on behalf of the museum archaeological team.") {
      grantSawmillProposal(player, event.npc);
    }
  }

  function handleLine(event) {
    const { player, npcId, text } = event;

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
        ensureGuard(player);
      }
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
      }
      return;
    }

    if (JUNIOR_NAVIGATOR_NPC_IDS.has(npcId)) {
      if (
        quest.getStage(player) === STAGE_PLAN_AGREED &&
        text === "Yes, I have it here." &&
        held(player, BONE_CHARM_ITEM_ID)
      ) {
        player.getInventory().deleteNumber(BONE_CHARM_ITEM_ID, 1);
        player.setAttribute(CHARM_ATTRIBUTE, 2);
        syncProtectionVarbits(player);
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

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    switch (stepId) {
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
        ensureGuard(player);
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
      case "MUBvQ9": // quest complete
        if (!JUNIOR_NAVIGATOR_NPC_IDS.has(npcId) || !isAtIslandArrival(player)) return;
        event.handled = true;
        removeIslandJunior(player);
        quest.complete(player);
        return;
      case "sRnbFX": // lead navigator "same as above" once the potion is handed in
        if (!LEAD_NAVIGATOR_NPC_IDS.has(npcId)) return;
        if (quest.getStage(player) !== STAGE_PLAN_AGREED || potionState(player) < 2) return;
        event.handled = true;
        event.steps = variantSteps(GIVING_POTION_VARIANT).slice(POTION_HANDOVER_STEPS);
        return;
      case "OgUvos": // post-quest row to the expedition camp
        if (!BARGE_GUARD_NPC_IDS.has(npcId) || quest.getStage(player) < STAGE_COMPLETE) return;
        player.moveTo(new Location(ISLAND_ARRIVAL_TILE.x, ISLAND_ARRIVAL_TILE.y, ISLAND_ARRIVAL_TILE.z));
        return;
      case "R43aKV": // the navigator's "Yes, please." row to Fossil Island
        if (!LEAD_NAVIGATOR_NPC_IDS.has(npcId)) return;
        player.moveTo(new Location(ISLAND_ARRIVAL_TILE.x, ISLAND_ARRIVAL_TILE.y, ISLAND_ARRIVAL_TILE.z));
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
    const variant = selectApothecaryVariant(player, quest.getStage(player));
    if (!variant) return false;
    startTranscript(api, player, npcId, PAGE, variant);
    return true;
  }

  // ==========================================================================
  // Spawns and the voyage
  // ==========================================================================

  /** The guard's Talk-to/Embark step: move onto the real level-1 barge deck. */
  function boardBarge(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_FOREMAN_READY || stage > STAGE_PLAN_AGREED) return false;
    ensureGuard(player);
    ensureCanalNavigators(player);
    player.moveTo(new Location(BOAT_DECK_TILE.x, BOAT_DECK_TILE.y, BOAT_DECK_TILE.z));
    return true;
  }

  function embarkBarge(event) {
    if (!BARGE_GUARD_NPC_IDS.has(event.npcId)) return false;
    event.handled = boardBarge(event.player);
    return event.handled;
  }

  function disembarkBarge(event) {
    if (!BARGE_GUARD_NPC_IDS.has(event.npcId)) return false;
    const stage = quest.getStage(event.player);
    if (stage < STAGE_FOREMAN_READY || stage > STAGE_PLAN_AGREED) return false;
    event.player.moveTo(new Location(GUARD_TILE.x, GUARD_TILE.y, GUARD_TILE.z));
    event.handled = true;
    return true;
  }

  function ensureGuard(player) {
    if (GUARD_SPAWNS.has(player)) return;
    const npc = api.spawnNpc({
      id: BARGE_GUARD_SPAWN_ID,
      x: GUARD_TILE.x,
      y: GUARD_TILE.y,
      z: GUARD_TILE.z,
      owner: player,
      ownerOnly: true,
    });
    if (npc) GUARD_SPAWNS.set(player, npc);
  }

  function ensureCanalNavigators(player) {
    if (CANAL_NAVIGATORS.has(player)) return;
    const lead = api.spawnNpc({
      id: LEAD_NAVIGATOR_SPAWN_ID,
      x: LEAD_NAVIGATOR_TILE.x,
      y: LEAD_NAVIGATOR_TILE.y,
      z: LEAD_NAVIGATOR_TILE.z,
      owner: player,
      ownerOnly: true,
    });
    const junior = api.spawnNpc({
      id: JUNIOR_NAVIGATOR_SPAWN_ID,
      x: JUNIOR_NAVIGATOR_TILE.x,
      y: JUNIOR_NAVIGATOR_TILE.y,
      z: JUNIOR_NAVIGATOR_TILE.z,
      owner: player,
      ownerOnly: true,
    });
    if (lead || junior) CANAL_NAVIGATORS.set(player, { lead, junior });
  }

  function removeCanalNavigators(player) {
    const tracked = CANAL_NAVIGATORS.get(player);
    if (!tracked) return;
    if (tracked.lead) api.removeNpc(tracked.lead);
    if (tracked.junior) api.removeNpc(tracked.junior);
    CANAL_NAVIGATORS.delete(player);
  }

  function ensureIslandJunior(player) {
    if (ISLAND_JUNIORS.has(player)) return;
    const npc = api.spawnNpc({
      id: JUNIOR_NAVIGATOR_SPAWN_ID,
      x: ISLAND_JUNIOR_TILE.x,
      y: ISLAND_JUNIOR_TILE.y,
      z: ISLAND_JUNIOR_TILE.z,
      owner: player,
      ownerOnly: true,
    });
    if (npc) ISLAND_JUNIORS.set(player, npc);
  }

  function removeIslandJunior(player) {
    const npc = ISLAND_JUNIORS.get(player);
    if (npc) api.removeNpc(npc);
    ISLAND_JUNIORS.delete(player);
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
      if (voyageState(player)?.phase === "arrived") {
        lines.push("I should speak to the <col=800000>Junior Navigator</col> on Fossil Island.");
      } else {
        lines.push(
          "I should operate the <col=800000>barge controls</col> and keep the",
          "bearing north until we reach Fossil Island."
        );
      }
    }
    return lines;
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    if (player?.isPlayerBot?.() === true) return;
    const stage = quest.getStage(player);
    if ((stage >= STAGE_SUPPLIES_SENT && stage <= STAGE_PLAN_AGREED) || stage >= STAGE_COMPLETE) {
      ensureGuard(player);
    }
    if (stage >= STAGE_FOREMAN_READY && stage <= STAGE_PLAN_AGREED) ensureCanalNavigators(player);
    if (stage === STAGE_SAILING) {
      const voyage = voyageState(player);
      if (voyage?.phase === "sailing" && (voyage.progress | 0) < 100) {
        removeCanalNavigators(player);
        voyage.controlsOpen = false;
        setVoyageState(player, voyage);
        openSailingScene(player, voyage);
      } else {
        // Old stage-10 saves were already teleported ashore by the previous plugin;
        // keep them there rather than sending them back through the voyage.
        removeCanalNavigators(player);
        setVoyageState(player, { ...(voyage ?? {}), phase: "arrived", progress: 100 });
        player.moveTo(new Location(ISLAND_ARRIVAL_TILE.x, ISLAND_ARRIVAL_TILE.y, ISLAND_ARRIVAL_TILE.z));
        ensureIslandJunior(player);
        sendWireStage(player);
      }
    }
    syncProtectionVarbits(player);
  }

  api.persistAttribute(CHARM_ATTRIBUTE);
  api.persistAttribute(POTION_ATTRIBUTE);
  api.persistAttribute(APOTHECARY_ATTRIBUTE);
  api.persistAttribute(VOYAGE_ATTRIBUTE);

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
    rewardItemId: FOSSIL_ISLAND_NOTE_BOOK_ITEM_ID,
    rewardItemLabel: "Fossil island note book",
    otherRewards: ["Access to Fossil Island"],
    buildJournal,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcInteraction("Barge guard", { Embark: embarkBarge, Disembark: disembarkBarge });
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
};
