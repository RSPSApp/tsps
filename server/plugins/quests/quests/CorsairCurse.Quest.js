/** The Corsair Curse. Capture evidence: docs/f2p-coastal-parity.md. */
module.exports = function registerCorsairCurseQuest(api) {
  const {
    GameObject, Area, PrivateArea, Boundary, Animation, Graphic, Task, TaskManager, DialogueChainBuilder, ActionDialogue, MagicCombatMethod, CombatSpells, Projectile, StatementDialogue,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    ObjectManager,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const VARP_CORSAIR_CURSE = 1677; // "corscurs"
  const VARBIT_PROGRESS = 6071; // "corscurs_progress", bits 0-5
  const VARBIT_CABINBOY = 6072; // "corscurs_cabinboy", bits 6-7
  const VARBIT_COOK = 6073; // "corscurs_cook", bits 8-9
  const VARBIT_THIEF = 6074; // "corscurs_thief", bits 10-12
  const VARBIT_NAVIGATOR = 6075; // "corscurs_navigator", bit 13

  const STAGE_NOT_STARTED = 0;
  const STAGE_STARTED = 1;
  const STAGE_ARRIVED = 2;
  const STAGE_INVESTIGATING = 3;
  const STAGE_TRAITOR_KNOWN = 4;
  const STAGE_FIRING_KNOWN = 5;
  const STAGE_CONFESSED = 6;
  const STAGE_PROVED = 7;
  const STAGE_KILL_ORDER = 8;
  const STAGE_KILLED = 9;
  const STAGE_COMPLETE = 10;

  const PAGE = "The Corsair Curse";

  const CAPTAIN_TOCK_START = NpcIdentifiers.CAPTAIN_TOCK; // 7956
  const CAPTAIN_TOCK_POST = NpcIdentifiers.CAPTAIN_TOCK_2; // 7957
  const CAPTAIN_TOCK_FERRY = NpcIdentifiers.CAPTAIN_TOCK_3; // 7958
  const ITHOI = NpcIdentifiers.ITHOI_THE_NAVIGATOR; // 7961
  const ITHOI_2 = NpcIdentifiers.ITHOI_THE_NAVIGATOR_2; // 7963
  const ITHOI_FIGHT = NpcIdentifiers.ITHOI_THE_NAVIGATOR_3; // 7964, level 35
  const COLIN = NpcIdentifiers.CABIN_BOY_COLIN; // 7965
  const COLIN_2 = NpcIdentifiers.CABIN_BOY_COLIN_2; // 7966
  const COLIN_POST = NpcIdentifiers.CABIN_BOY_COLIN_3; // 7967
  const GNOCCI = NpcIdentifiers.GNOCCI_THE_COOK; // 7970
  const GNOCCI_2 = NpcIdentifiers.GNOCCI_THE_COOK_2; // 7971
  const GNOCCI_3 = NpcIdentifiers.GNOCCI_THE_COOK_3; // 7972
  const DOLL = NpcIdentifiers.DOLL;
  const ARSEN = NpcIdentifiers.ARSEN_THE_THIEF; // 7976

  const TOCK_NPC_IDS = new Set([CAPTAIN_TOCK_START, CAPTAIN_TOCK_POST, CAPTAIN_TOCK_FERRY]);
  const ITHOI_NPC_IDS = new Set([ITHOI, ITHOI_2, ITHOI_FIGHT]);
  const COLIN_NPC_IDS = new Set([COLIN, COLIN_2, COLIN_POST]);
  const GNOCCI_NPC_IDS = new Set([GNOCCI, GNOCCI_2, GNOCCI_3]);

  const OGRE_ARTEFACT_ITEM = ItemIdentifiers.OGRE_ARTEFACT_2; // 21837
  const TINDERBOX_ITEM = ItemIdentifiers.TINDERBOX; // 590
  const SPADE_ITEM = ItemIdentifiers.SPADE; // 952
  const FEATHER_ITEM = ItemIdentifiers.FEATHER; // 314
  const ABYSSAL_WHIP_ITEM = ItemIdentifiers.ABYSSAL_WHIP; // 4151

  const TELESCOPE_OBJECT = ObjectIdentifiers.TELESCOPE_10; // 31632, Observe
  const SPADE_OBJECT = ObjectIdentifiers.SPADE_2; // 31585, Take
  const TINDERBOX_OBJECT = ObjectIdentifiers.COL_FF9040_TINDERBOX_COL; // 31634, Take
  const DRIFTWOOD_OBJECT = ObjectIdentifiers.DRIFTWOOD_4; // 31721
  const BURNING_DRIFTWOOD_OBJECT = ObjectIdentifiers.BURNING_DRIFTWOOD; // 31722
  const WET_DRIFTWOOD_OBJECT = ObjectIdentifiers.WET_DRIFTWOOD; // 31723
  const DRIFTWOOD_PARENT = 31724; // corscurs_driftwood_multi, cache241.
  const DUNGEON_HOLE_OBJECT = ObjectIdentifiers.HOLE_54; // 31791, Enter (four pillars)
  const OGRE_CAVE_OBJECT = ObjectIdentifiers.CAVE_59; // 31766, Enter (west of the cove)
  const VINE_LADDER_OBJECT = ObjectIdentifiers.VINE_LADDER_2; // 31790, Climb

  // Prose conditions on the "The Corsair Curse" page.
  const COND_NO_TOCK_YET = "EXq6K1";
  const COND_NO_TESS_YET = "pEzzRs";
  const COND_NO_CHOMPY_TELESCOPE = "HqAI6F";
  const COND_CHOMPY_TELESCOPE = "_SmqOy";
  const COND_NO_CHOMPY_RETURN = "q6KWx3";
  const COND_CHOMPY_RETURN = "Kk6cWa";
  const COND_NO_CRAFTING = "k-Ae5A";
  const COND_CRAFTING = "gZdLev";
  const COND_SPOKEN_TO_ARSEN = "Sc-0qW";

  // Action / message stage directions on the same page.
  const ACTION_TOCK_LEAVES = "9srM-C";
  const ACTION_SAIL_TO_COVE = "GnY-u6";
  const ACTION_RECEIVE_ARTEFACT = "yRckkD";
  const ACTION_PRESENT_ARTEFACT = "wenZvG";
  const ACTION_ITHOI_EXTINGUISHES = "Qx1uew";
  const ACTION_QUEST_COMPLETE = "SaQ1Mg";

  // Tiles verified against the cache collision map.
  const TOCK_START_TILE = { x: 3030, y: 3273, z: 0 };
  const RIMMINGTON_TILE = { x: 2910, y: 3226, z: 0 };
  const RIMMINGTON_LANDING = { x: 2911, y: 3226, z: 0 };
  const COVE_TOCK_TILE = { x: 2574, y: 2836, z: 1 };
  const COVE_LANDING = { x: 2578, y: 2837, z: 1 };
  const ARSEN_TILE = { x: 2556, y: 2856, z: 1 };
  const COLIN_TILE = { x: 2559, y: 2856, z: 1 };
  const GNOCCI_TILE = { x: 2546, y: 2862, z: 1 };
  const ITHOI_TILE = { x: 2529, y: 2837, z: 1 };
  const POST_TOCK_TILE = { x: 2586, y: 2866, z: 0 };
  const DUNGEON_LANDING = { x: 2011, y: 9007, z: 1 };
  const CAVE_LANDING = { x: 2483, y: 2889, z: 0 };
  const DIG_TILE = { x: 2503, y: 2839, z: 0 };
  const DRIFTWOOD_TILE = { x: 2530, y: 2837, z: 0 };

  const CABINBOY_ATTRIBUTE = "quest.the_corsair_curse.cabinboy";
  const COOK_ATTRIBUTE = "quest.the_corsair_curse.cook";
  const THIEF_ATTRIBUTE = "quest.the_corsair_curse.thief";
  const NAVIGATOR_ATTRIBUTE = "quest.the_corsair_curse.navigator";
  const TRAITOR_ATTRIBUTE = "quest.the_corsair_curse.traitor";

  const CABINBOY_HEARD = 1;
  const CABINBOY_TELESCOPE = 2;
  const CABINBOY_TOLD = 3;
  const COOK_HEARD = 1;
  const COOK_DUG = 2;
  const COOK_TOLD = 3;
  const THIEF_HEARD = 1;
  const THIEF_HAS_ARTEFACT = 2;
  const THIEF_RETURNED_RELIC = 3;
  const THIEF_TOLD = 4;
  const NAVIGATOR_TOLD = 1;

  const TRAITOR_GNOCCI = 1 << 0;
  const TRAITOR_ARSEN = 1 << 1;
  const TRAITOR_COLIN = 1 << 2;

  const npcsByPlayer = new Map();
  const scenes = new WeakMap();
  const fights = new WeakMap();
  const dolls = new WeakMap();
  const PROOF_ATTRIBUTE = "corsair-curse:proof-plan";
  const THIEF_STORY_ATTRIBUTE = "corsair-curse:thief-story";
  const THIEF_REPORT_ATTRIBUTE = "corsair-curse:thief-report";
  const DEPARTED_ATTRIBUTE = "corsair-curse:captain-departed";
  let quest;

  const sub = (player, attribute) => Number(player.getAttribute(attribute)) || 0;
  const cabinboy = (player) => sub(player, CABINBOY_ATTRIBUTE);
  const cook = (player) => sub(player, COOK_ATTRIBUTE);
  const thief = (player) => sub(player, THIEF_ATTRIBUTE);
  const navigator = (player) => sub(player, NAVIGATOR_ATTRIBUTE);
  const traitorFlags = (player) => sub(player, TRAITOR_ATTRIBUTE);

  function setSub(player, attribute, varbit, value) {
    player.setAttribute(attribute, value | 0);
    player.getPacketSender().sendVarbit(varbit, varbit === VARBIT_THIEF ? thiefWire(player) : value | 0);
    if (quest) player.getPacketSender().sendVarbit(VARBIT_PROGRESS, wireStage(player));
  }

  const setCabinboy = (player, value) => setSub(player, CABINBOY_ATTRIBUTE, VARBIT_CABINBOY, value);
  const setCook = (player, value) => setSub(player, COOK_ATTRIBUTE, VARBIT_COOK, value);
  const setThief = (player, value) => setSub(player, THIEF_ATTRIBUTE, VARBIT_THIEF, value);
  const setNavigator = (player, value) => setSub(player, NAVIGATOR_ATTRIBUTE, VARBIT_NAVIGATOR, value);

  function addTraitorFlag(player, flag) {
    player.setAttribute(TRAITOR_ATTRIBUTE, traitorFlags(player) | flag);
  }

  function maybeAdvanceTraitor(player) {
    const flags = traitorFlags(player);
    if ((flags & TRAITOR_GNOCCI) !== 0 && (flags & TRAITOR_ARSEN) !== 0) {
      advance(player, STAGE_FIRING_KNOWN);
    }
  }

  function anyTheoryHeard(player) {
    return thief(player) >= THIEF_HEARD || cabinboy(player) >= CABINBOY_HEARD || cook(player) >= COOK_HEARD;
  }

  function thiefWire(player) {
    const stage = thief(player);
    if (stage === THIEF_HEARD) return sub(player, THIEF_STORY_ATTRIBUTE) ? 1 : 2;
    if (stage === THIEF_HAS_ARTEFACT) return 3;
    if (stage === THIEF_RETURNED_RELIC) return sub(player, THIEF_REPORT_ATTRIBUTE) ? 5 : 4;
    return stage >= THIEF_TOLD ? 6 : 0;
  }

  function wireStage(player) {
    const stage = quest.getStage(player);
    if (scenes.get(player)?.kind === "fire") return 49;
    if (stage === STAGE_STARTED) return sub(player, DEPARTED_ATTRIBUTE) ? 10 : 5;
    if (stage === STAGE_ARRIVED) return 15;
    if (stage === STAGE_INVESTIGATING) return crewResolved(player) ? 20 : 15;
    if (stage === STAGE_TRAITOR_KNOWN) return traitorFlags(player) & (TRAITOR_GNOCCI | TRAITOR_ARSEN) ? 30 : 25;
    if (stage === STAGE_FIRING_KNOWN) return 35;
    if (stage === STAGE_CONFESSED) return sub(player, PROOF_ATTRIBUTE) ? 45 : 40;
    return ({ [STAGE_PROVED]: 50, [STAGE_KILL_ORDER]: 52, [STAGE_KILLED]: 55, [STAGE_COMPLETE]: 60 })[stage] ?? 0;
  }

  function crewResolved(player) {
    return thief(player) >= THIEF_TOLD && cabinboy(player) >= CABINBOY_TOLD && cook(player) >= COOK_TOLD;
  }

  function bigChompyComplete(player) {
    const request = { player, key: "big_chompy_bird_hunting", complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function craftingLevel(player) {
    return Number(player.getSkillManager().getCurrentLevel(Skill.CRAFTING)) || 0;
  }

  function nearRimmington(npc) {
    const location = npc?.getLocation?.();
    if (!location) return false;
    return Math.abs(location.getX() - RIMMINGTON_TILE.x) <= 8
      && Math.abs(location.getY() - RIMMINGTON_TILE.y) <= 8;
  }

  function near(player, tile, radius) {
    const location = player?.getLocation?.();
    if (!location) return false;
    return Math.abs(location.getX() - tile.x) <= radius
      && Math.abs(location.getY() - tile.y) <= radius;
  }

  function moveTo(player, tile) {
    player.moveTo(new Location(tile.x, tile.y, tile.z));
  }

  function advance(player, value) {
    if (quest.getStage(player) < value) quest.setStage(player, value);
    ensureNpcs(player);
  }

  // ==========================================================================
  // Spawned NPCs (owner-only; the crew exist in the world at every stage)
  // ==========================================================================

  function postColinTile(player) {
    return near(player, RIMMINGTON_TILE, 24) ? RIMMINGTON_TILE : COVE_TOCK_TILE;
  }

  function desiredNpcs(player) {
    const stage = quest.getStage(player);
    if (stage <= STAGE_NOT_STARTED || stage >= STAGE_COMPLETE) return [];
    // The cache's canonical multi-NPCs already supply the crew and post-quest
    // captain. Only the travelling captain needs per-player locations.
    const list = [{ key: "tock-rimmington", id: CAPTAIN_TOCK_FERRY, ...RIMMINGTON_TILE }];
    if (stage >= STAGE_ARRIVED) list.push({ key: "tock-cove", id: CAPTAIN_TOCK_FERRY, ...COVE_TOCK_TILE });
    return list;
  }

  function npcMatches(npc, want) {
    const location = npc?.getLocation?.();
    return npc?.getId?.() === want.id
      && location?.getX?.() === want.x
      && location?.getY?.() === want.y
      && location?.getZ?.() === want.z;
  }

  /** Spawns, moves and removes this player's quest NPCs to match the stage. */
  function ensureNpcs(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    const tracked = npcsByPlayer.get(player) ?? new Map();
    const desired = desiredNpcs(player);
    const wanted = new Map(desired.map((entry) => [entry.key, entry]));
    for (const [key, npc] of [...tracked]) {
      if (wanted.has(key) && npcMatches(npc, wanted.get(key))) continue;
      api.removeNpc(npc);
      tracked.delete(key);
    }
    for (const want of desired) {
      if (tracked.has(want.key)) continue;
      const npc = api.spawnNpc({
        id: want.id,
        x: want.x,
        y: want.y,
        z: want.z,
        wanderRadius: 0,
        owner: player,
        ownerOnly: true,
      });
      if (npc) tracked.set(want.key, npc);
    }
    if (tracked.size > 0) npcsByPlayer.set(player, tracked);
    else npcsByPlayer.delete(player);
  }

  // ==========================================================================
  // Travel
  // ==========================================================================

  function sailToCove(player) {
    moveTo(player, COVE_LANDING);
    advance(player, STAGE_ARRIVED);
  }

  function sailToRimmington(player) {
    moveTo(player, RIMMINGTON_LANDING);
    ensureNpcs(player);
  }

  function handleTravel(event) {
    const { player, npc } = event;
    if (!player || !npc) return false;
    if (quest.getStage(player) === STAGE_NOT_STARTED) return false;
    if (nearRimmington(npc)) sailToCove(player);
    else sailToRimmington(player);
    return true;
  }

  // Scenery in cinematic Areas is local to the viewer. Main-world driftwood
  // uses cache multi-loc31724 and the player's progress varbit.
  function placeDriftwood(player, id) {
    const scene = scenes.get(player);
    if (!scene) return;
    ObjectManager.register(new GameObject(id, new Location(DRIFTWOOD_TILE.x, DRIFTWOOD_TILE.y, DRIFTWOOD_TILE.z), 10, 0, scene), true);
  }

  // ==========================================================================

  // ==========================================================================
  // Transcript variant selection
  // ==========================================================================

  function selectTockVariant(player, npc) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return "after-corsair-curse";
    if (stage === STAGE_NOT_STARTED) return "the-cursed-crew-talking-to-captain-tock";
    if (nearRimmington(npc)) return "the-cursed-crew-talking-to-captain-tock-again";
    switch (stage) {
      case STAGE_STARTED:
        return "the-cursed-crew-talking-to-captain-tock";
      case STAGE_INVESTIGATING:
        if (thief(player) === THIEF_HEARD) return "arsen-s-curse-talking-to-captain-tock";
        if (crewResolved(player)) return "traitor-in-the-midst-talking-to-captain-tock";
        if (anyTheoryHeard(player)) {
          return "gnocci-s-curse-talking-to-captain-tock-during-the-investigation-of-the-curses";
        }
        return "the-cursed-crew-talking-to-captain-tock-after-ithoi";
      case STAGE_TRAITOR_KNOWN:
        return "traitor-in-the-midst-talking-to-captain-tock-talking-to-captain-tock-again";
      case STAGE_FIRING_KNOWN:
        return "traitor-in-the-midst-talking-to-captain-tock-after-talking-to-everyone-else";
      case STAGE_CONFESSED:
        return "traitor-in-the-midst-talking-to-ithoi-after-talking-to-everyone-else-talking-to-captain-tock-after-ithoi-admits-he-poisoned-the-crew";
      case STAGE_PROVED:
      case STAGE_KILL_ORDER:
        return "traitor-in-the-midst-talking-to-captain-tock-after-proving-ithoi-poisoned-the-crew";
      case STAGE_KILLED:
        return "traitor-in-the-midst-talking-to-captain-tock-after-killing-ithoi";
      default:
        return "the-cursed-crew-talking-to-captain-tock-after-ithoi";
    }
  }

  function selectIthoiVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_KILL_ORDER) return null;
    if (stage >= STAGE_PROVED) {
      return "traitor-in-the-midst-attempting-to-light-the-the-driftwood-after-discovering-ithoi-s-lie-talking-to-ithoi-again";
    }
    if (stage === STAGE_CONFESSED) {
      return "traitor-in-the-midst-talking-to-ithoi-after-talking-to-everyone-else-talking-to-ithoi-again";
    }
    if (stage === STAGE_FIRING_KNOWN) {
      return "traitor-in-the-midst-talking-to-ithoi-after-talking-to-everyone-else";
    }
    if (stage === STAGE_TRAITOR_KNOWN) {
      return "traitor-in-the-midst-talking-to-ithoi-before-talking-to-everyone-else";
    }
    if (stage === STAGE_INVESTIGATING) {
      return anyTheoryHeard(player)
        ? "gnocci-s-curse-talking-to-ithoi-during-the-investigation-of-the-curses"
        : "the-cursed-crew-talking-to-ithoi";
    }
    if (stage === STAGE_ARRIVED) return "the-cursed-crew-talking-to-ithoi";
    return "before-the-corsair-curse";
  }

  function selectArsenVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return "after-the-corsair-curse";
    if (stage === STAGE_TRAITOR_KNOWN || stage === STAGE_FIRING_KNOWN) {
      return "traitor-in-the-midst-talking-to-arsen";
    }
    if (stage === STAGE_CONFESSED) {
      return "traitor-in-the-midst-talking-to-ithoi-after-talking-to-everyone-else-talking-to-arsen-after-ithoi-admits-he-poisoned-the-crew";
    }
    if (stage === STAGE_PROVED || stage === STAGE_KILL_ORDER) {
      return "traitor-in-the-midst-talking-to-arsen-after-proving-ithoi-poisoned-the-crew";
    }
    if (stage === STAGE_KILLED) return "traitor-in-the-midst-talking-to-arsen-after-killing-ithoi";
    if (stage < STAGE_INVESTIGATING) {
      return stage >= STAGE_ARRIVED
        ? "the-cursed-crew-talking-to-arsen-before-talking-to-ithoi"
        : "before-the-corsair-curse";
    }
    const progress = thief(player);
    if (progress === 0) return "arsen-s-curse-talking-to-arsen";
    if (progress <= THIEF_HAS_ARTEFACT) return "arsen-s-curse-talking-to-arsen-talking-to-arsen-again";
    if (progress === THIEF_RETURNED_RELIC) {
      return "arsen-s-curse-returning-to-arsen";
    }
    return "arsen-s-curse-returning-to-arsen";
  }

  function selectColinVariant(player, npc) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return nearRimmington(npc)
        ? "after-the-corsair-curse-rimmington"
        : "after-the-corsair-curse-corsair-cove";
    }
    if (stage === STAGE_TRAITOR_KNOWN) return "traitor-in-the-midst-talking-to-colin";
    if (stage === STAGE_FIRING_KNOWN) {
      return "traitor-in-the-midst-talking-to-colin-talking-to-colin-again";
    }
    if (stage === STAGE_CONFESSED) {
      return "traitor-in-the-midst-talking-to-ithoi-after-talking-to-everyone-else-talking-to-colin-after-ithoi-admits-he-poisoned-the-crew";
    }
    if (stage === STAGE_PROVED || stage === STAGE_KILL_ORDER) {
      return "traitor-in-the-midst-talking-to-colin-after-proving-ithoi-poisoned-the-crew";
    }
    if (stage === STAGE_KILLED) return "traitor-in-the-midst-talking-to-colin-after-killing-ithoi";
    if (stage < STAGE_INVESTIGATING) {
      return stage >= STAGE_ARRIVED
        ? "the-cursed-crew-talking-to-colin-before-talking-to-ithoi"
        : "before-the-corsair-curse";
    }
    const progress = cabinboy(player);
    if (progress === 0) return "colin-s-curse-talking-to-colin";
    if (progress === CABINBOY_HEARD) return "colin-s-curse-talking-to-colin-talking-to-colin-again";
    if (progress === CABINBOY_TELESCOPE) {
      return "colin-s-curse-returning-to-colin";
    }
    return "colin-s-curse-returning-to-colin";
  }

  function selectGnocciVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return "after-the-corsair-curse";
    if (stage === STAGE_TRAITOR_KNOWN) return "traitor-in-the-midst-talking-to-gnocchi";
    if (stage === STAGE_FIRING_KNOWN) {
      return "traitor-in-the-midst-talking-to-gnocchi-talking-to-gnocchi-again";
    }
    if (stage === STAGE_CONFESSED) {
      return "traitor-in-the-midst-talking-to-ithoi-after-talking-to-everyone-else-talking-to-gnocchi-after-ithoi-admits-he-poisoned-the-crew";
    }
    if (stage === STAGE_PROVED || stage === STAGE_KILL_ORDER) {
      return "traitor-in-the-midst-talking-to-gnocci-after-proving-ithoi-poisoned-the-crew";
    }
    if (stage === STAGE_KILLED) return "traitor-in-the-midst-talking-to-gnocci-after-killing-ithoi";
    if (stage < STAGE_INVESTIGATING) {
      return stage >= STAGE_ARRIVED
        ? "the-cursed-crew-talking-to-gnocci-before-talking-to-ithoi"
        : "before-the-corsair-curse";
    }
    const progress = cook(player);
    if (progress === 0) return "gnocci-s-curse-talking-to-gnocci";
    if (progress === COOK_HEARD) return "gnocci-s-curse-talking-to-gnocci-talking-to-gnocci-again";
    if (progress === COOK_DUG) {
      return "gnocci-s-curse-returning-to-gnocci";
    }
    return "gnocci-s-curse-returning-to-gnocci";
  }

  function selectTessVariant(player) {
    if (quest.getStage(player) !== STAGE_INVESTIGATING) return null;
    if (thief(player) === THIEF_HEARD) {
      return "arsen-s-curse-talking-to-chief-tess-before-talking-to-captain-tock";
    }
    if (thief(player) === THIEF_HAS_ARTEFACT) {
      return "arsen-s-curse-talking-to-chief-tess-after-talking-to-captain-tock";
    }
    return null;
  }

  function selectVariant({ npcId, npc, player }) {
    if (!player) return null;
    if (TOCK_NPC_IDS.has(npcId)) return selectTockVariant(player, npc);
    if (ITHOI_NPC_IDS.has(npcId)) return selectIthoiVariant(player);
    if (npcId === ARSEN) return selectArsenVariant(player);
    if (COLIN_NPC_IDS.has(npcId)) return selectColinVariant(player, npc);
    if (GNOCCI_NPC_IDS.has(npcId)) return selectGnocciVariant(player);
    if (npcId === NpcIdentifiers.CHIEF_TESS) return selectTessVariant(player);
    if (npcId === NpcIdentifiers.YUSUF || npcId === NpcIdentifiers.YUSUF_2) return { page: "Yusuf", variant: quest.isComplete(player) ? "standard-dialogue" : "before-completion-of-the-corsair-curse" };
    return null;
  }

  // ==========================================================================
  // Prose conditions
  // ==========================================================================

  function answerCondition({ npcId, player, stepId }) {
    if (!player) return null;
    switch (stepId) {
      case COND_NO_TOCK_YET:
        if (npcId !== ARSEN) return null;
        return thief(player) < THIEF_HAS_ARTEFACT;
      case COND_NO_TESS_YET:
        if (npcId !== ARSEN) return null;
        return thief(player) < THIEF_RETURNED_RELIC;
      case COND_NO_CHOMPY_TELESCOPE:
      case COND_NO_CHOMPY_RETURN:
        if (!ITHOI_NPC_IDS.has(npcId) && !COLIN_NPC_IDS.has(npcId)) return null;
        return !bigChompyComplete(player);
      case COND_CHOMPY_TELESCOPE:
      case COND_CHOMPY_RETURN:
        if (!ITHOI_NPC_IDS.has(npcId) && !COLIN_NPC_IDS.has(npcId)) return null;
        return bigChompyComplete(player);
      case COND_NO_CRAFTING:
        if (!GNOCCI_NPC_IDS.has(npcId)) return null;
        return craftingLevel(player) < 18;
      case COND_CRAFTING:
        if (!GNOCCI_NPC_IDS.has(npcId)) return null;
        return craftingLevel(player) >= 18;
      case COND_SPOKEN_TO_ARSEN:
        if (!GNOCCI_NPC_IDS.has(npcId)) return null;
        return (traitorFlags(player) & TRAITOR_ARSEN) !== 0;
      default:
        return null;
    }
  }

  // ==========================================================================
  // Transcript actions and choices
  // ==========================================================================

  function handleDialogueAction(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;
    if (sceneAction(event)) return;
    if (stepId === ACTION_TOCK_LEAVES) {
      event.handled = true;
      event.box = { statement: true };
      player.setAttribute(DEPARTED_ATTRIBUTE, true);
      if (quest.getStage(player) < STAGE_STARTED) advance(player, STAGE_STARTED);
      else sendProgress(player);
      return;
    }
    if (stepId === ACTION_SAIL_TO_COVE) {
      event.handled = true;
      advance(player, STAGE_ARRIVED);
      event.box = { statement: true };
      later(player, 3, () => moveTo(player, COVE_LANDING));
      return;
    }
    if (stepId === ACTION_RECEIVE_ARTEFACT) {
      event.handled = true;
      if (player.getInventory().isFull()) { player.sendMessage("You need more inventory space."); return; }
      event.box = { items: [OGRE_ARTEFACT_ITEM] }; event.handled = false;
      if (thief(player) === THIEF_HEARD) {
        player.getInventory().adds(OGRE_ARTEFACT_ITEM, 1);
        setThief(player, THIEF_HAS_ARTEFACT);
      }
      return;
    }
    if (stepId === ACTION_PRESENT_ARTEFACT) {
      event.handled = true;
      if (thief(player) !== THIEF_HAS_ARTEFACT || !player.getInventory().getAmount(OGRE_ARTEFACT_ITEM)) return;
      event.box = { items: [OGRE_ARTEFACT_ITEM] }; event.handled = false;
      player.getInventory().deleteNumber(OGRE_ARTEFACT_ITEM, 1);
      return;
    }
    if (stepId === ACTION_ITHOI_EXTINGUISHES) {
      event.handled = true;
      placeDriftwood(player, WET_DRIFTWOOD_OBJECT);
      return;
    }
    if (stepId === ACTION_QUEST_COMPLETE) {
      if (quest.getStage(player) >= STAGE_KILLED && !quest.isComplete(player)) {
        quest.complete(player);
        ensureNpcs(player);
      }
    }
  }

  function handleDialogueChoice(event) {
    const { player, npcId, option } = event;
    if (!player) return;
    if (TOCK_NPC_IDS.has(npcId) && option === "Please take me back to Rimmington.") sailToRimmington(player);
    if (npcId === COLIN_POST && quest.isComplete(player)) {
      if (option === "Please take me back to Rimmington.") sailToRimmington(player);
      if (option === "Yes please.") sailToCove(player);
    }
    if (GNOCCI_NPC_IDS.has(npcId) && option === "Search for the possessed doll and face the consequences." && cook(player) === COOK_HEARD) {
      event.player.performAnimation(new Animation(830));
      later(player, 1, () => {
        if (cook(player) !== COOK_HEARD) return;
        setCook(player, COOK_DUG);
        const doll = api.spawnNpc({ id: DOLL, x: 2505, y: 2839, z: 0, wanderRadius: 0, owner: player, ownerOnly: true });
        if (!doll) return;
        doll.__skipDefaultRespawn = true; dolls.set(player, doll);
        const path = [[2505,2840],[2506,2841],[2507,2842],[2508,2842],[2509,2841],[2509,2840],[2509,2839],[2509,2838],[2509,2839]];
        path.forEach(([x,y], index) => later(player, index + 1, () => { if (dolls.get(player) === doll) doll.moveTo(new Location(x,y,0)); }));
        later(player, 10, () => removeDoll(player));
      });
    }
  }

  function removeDoll(player) {
    const doll = dolls.get(player);
    if (doll) api.removeNpc(doll);
    dolls.delete(player);
  }

  // ==========================================================================
  // Object and item interactions
  // ==========================================================================

  function observeTelescope(player) {
    const stage = quest.getStage(player);
    if (stage === STAGE_INVESTIGATING) {
      const progress = cabinboy(player);
      if (progress === CABINBOY_HEARD) {
        startTranscript(api, player, ITHOI, PAGE, "colin-s-curse-using-ithoi-s-telescope");
        return true;
      }
      if (progress >= CABINBOY_TELESCOPE) {
        startTranscript(api, player, ITHOI, PAGE, "colin-s-curse-using-ithoi-s-telescope-again");
        return true;
      }
      return false;
    }
    if (stage >= STAGE_TRAITOR_KNOWN && stage < STAGE_COMPLETE) {
      startTranscript(api, player, ITHOI, PAGE, "traitor-in-the-midst-observing-the-telescope-again");
      return true;
    }
    return false;
  }

  function climbVine(player, entering) {
    const north = player.getLocation().getY() > (entering ? 2861 : 9005);
    player.performAnimation(new Animation(828));
    later(player, 1, () => moveTo(player, entering
      ? { x: 2012, y: north ? 9006 : 9004, z: 1 }
      : { x: 2523, y: north ? 2862 : 2860, z: 0 }));
  }

  function leaveDungeon(player) {
    climbVine(player, false);
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (!player) return;
    if (objectId === TELESCOPE_OBJECT) {
      if (observeTelescope(player)) event.handled = true;
      return;
    }
    if (objectId === DUNGEON_HOLE_OBJECT || objectId === OGRE_CAVE_OBJECT) {
      event.handled = true;
      if (objectId === DUNGEON_HOLE_OBJECT) climbVine(player, true);
      else moveTo(player, DUNGEON_LANDING);
      return;
    }
    if (objectId === VINE_LADDER_OBJECT) {
      event.handled = true;
      leaveDungeon(player);
      return;
    }
    if (objectId === SPADE_OBJECT) {
      event.handled = true;
      if (player.getInventory().getAmount(SPADE_ITEM) === 0) player.getInventory().adds(SPADE_ITEM, 1);
      return;
    }
    if (objectId === TINDERBOX_OBJECT) {
      event.handled = true;
      if (player.getInventory().getAmount(TINDERBOX_ITEM) === 0) player.getInventory().adds(TINDERBOX_ITEM, 1);
    }
  }

  /** The generic Ladders plugin asks "which way?" for a lone "Climb"; own that click. */
  function claimClimb(request) {
    if (!request || request.objectId !== VINE_LADDER_OBJECT || !request.player) return;
    request.handled = true;
    leaveDungeon(request.player);
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (!player || itemId !== TINDERBOX_ITEM) return;
    if (objectId === WET_DRIFTWOOD_OBJECT) {
      event.handled = true;
      player.sendMessage("The driftwood is too wet to light.");
      return;
    }
    if (objectId !== DRIFTWOOD_OBJECT && objectId !== DRIFTWOOD_PARENT) return;
    if (!player.getInventory().getAmount(TINDERBOX_ITEM)) return;
    event.handled = true;
    const stage = quest.getStage(player);
    if (stage >= STAGE_PROVED) {
      player.sendMessage("The driftwood is too wet to light.");
      return;
    }
    if (stage === STAGE_CONFESSED && sub(player, PROOF_ATTRIBUTE)) {
      if (scenes.has(player)) return;
      player.performAnimation(new Animation(733));
      startFireScene(player);
      return;
    }
    if (stage >= STAGE_INVESTIGATING) {
      startTranscript(
        api,
        player,
        ITHOI,
        PAGE,
        "traitor-in-the-midst-attempting-to-light-the-the-driftwood-before-discovering-ithoi-s-lie"
      );
    }
  }

  function handleDig(event) {
    const { player } = event;
    if (!player) return false;
    if (quest.getStage(player) !== STAGE_INVESTIGATING) return false;
    if (cook(player) !== COOK_HEARD) return false;
    if (!near(player, DIG_TILE, 3)) return false;
    startTranscript(api, player, GNOCCI, PAGE, "gnocci-s-curse-digging-for-her");
    return true;
  }

  function claimDig(event) {
    if (event.itemId === SPADE_ITEM && /dig/i.test(String(event.option)) && handleDig(event)) event.allow = false;
  }

  function handleItemOnNpc(event) {
    const { player, target, itemId } = event;
    if (!player || !target || !ITHOI_NPC_IDS.has(target.getId?.())) return;
    if (itemId !== FEATHER_ITEM && itemId !== ABYSSAL_WHIP_ITEM) return;
    event.handled = true;
    startTranscript(api, player, ITHOI, PAGE, "traitor-in-the-midst-using-any-abyssal-whip-or-a-feather-on-him");
  }

  function handleNpcDeath(event) {
    const player = event?.killer?.isPlayer?.() ? event.killer : null;
    if (!player || event.npcId !== ITHOI_FIGHT) return;
    if (quest.getStage(player) !== STAGE_KILL_ORDER || fights.get(player)?.npc !== event.npc) return;
    clearFight(player);
    const tracked = npcsByPlayer.get(player);
    if (tracked) {
      tracked.delete("ithoi");
      if (tracked.size === 0) npcsByPlayer.delete(player);
    }
    advance(player, STAGE_KILLED);
  }

  function later(key, ticks, action) {
    const task = new Task(ticks, key, false);
    task.execute = () => { task.stop(); action(); };
    TaskManager.submit(task);
  }

  class CorsairScene extends PrivateArea {
    constructor(player, kind, tile) {
      super([new Boundary(tile.x - 40, tile.x + 40, tile.y - 40, tile.y + 40, 0), new Boundary(tile.x - 40, tile.x + 40, tile.y - 40, tile.y + 40, 1)]);
      this.owner = player; this.kind = kind; this.returnTile = player.getLocation().clone();
      this.model = player.getNpcTransformationId();
    }
    canTeleport() { return false; }
    canAttack() { return false; }
    postLeave(mobile, logout) {
      if (mobile === this.owner) { mobile.setArea(null); endScene(mobile); }
      super.postLeave(mobile, logout);
    }
  }

  function beginScene(player, kind, tile, model) {
    if (scenes.has(player)) endScene(player);
    const scene = new CorsairScene(player, kind, tile);
    scenes.set(player, scene); scene.enter(player); moveTo(player, tile);
    if (model !== undefined) player.setNpcTransformationId(model);
    player.getMovementQueue().setBlockMovement(true); player.setUntargetable(true);
    player.getPacketSender().sendVarbit(6719, 2); player.getPacketSender().sendVarbit(12393, 1);
    for(let axis=0;axis<5;axis++)player.getPacketSender().sendCameraShake(axis,0,0,0);
    return scene;
  }

  function endScene(player) {
    const scene = scenes.get(player);
    if (!scene) return;
    scenes.delete(player); TaskManager.cancelTasks(scene);
    player.setNpcTransformationId(scene.model); player.performAnimation(new Animation(-1));
    player.getMovementQueue().setBlockMovement(false); player.setUntargetable(false);
    player.getPacketSender().sendVarbit(6719, 0); player.getPacketSender().sendVarbit(12393, 0);
    player.getPacketSender().sendCameraUnlock(false).sendCameraReset();
    if (player.getArea() === scene) scene.leave(player, false);
    player.moveTo(scene.returnTile); scene.destroy();
  }

  function camera(player, x, y, height, tx, ty, th, rate = 232, rate2 = 100) {
    const options={rate,rate2,heightRelative:false};
    player.getPacketSender().sendCameraMoveTo(x, y, height, options);
    player.getPacketSender().sendCameraLookAt(tx, ty, th, options);
  }
  function moveCamera(player,x,y,height,rate,rate2=rate) {
    player.getPacketSender().sendCameraMoveTo(x,y,height,{rate,rate2,heightRelative:false});
  }
  function sceneTail(steps,anchor) {
    for(let i=0;i<steps.length;i++) {
      const step=steps[i];
      if(step.id===anchor||step.text===anchor||step.player===anchor)return steps.slice(i+1);
      for(const nested of [step.steps,...(step.options??[]).map(option=>option.steps)]) {
        const result=nested&&sceneTail(nested,anchor);if(result)return result;
      }
    }
    return null;
  }
  function freezeScene(player) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ActionDialogue(0,{execute:()=>StatementDialogue.send(player,"",false)})));
  }
  function sceneSpeech(player,npcId,name,text) {
    player.getPacketSender().sendChatboxInterface(231).sendNpcHeadOnInterface(npcId,(231<<16)|2).sendString(name,(231<<16)|4)
      .sendString(text,(231<<16)|6).sendString("",(231<<16)|5).sendInterfaceFlagsRange((231<<16)|5,-1,-1,0);
  }
  function pauseScene(event,ticks) {
    const {player}=event,scene=scenes.get(player),anchor=event.stepId??event.text;
    freezeScene(player);
    event.handled=true;
    later(scene,ticks,()=>startTranscript(api,player,scene.kind==="colin"?COLIN:GNOCCI,PAGE,scene.kind==="colin"?"colin-s-curse-talking-to-colin":"gnocci-s-curse-talking-to-gnocci",steps=>sceneTail(steps,anchor)??[]));
  }
  function gnocciBurial(player) {
    const scene=scenes.get(player);freezeScene(player);
    sceneSpeech(player,GNOCCI,"Gnocci the Cook","She's moving!<br>SHE'S POSSESSED!<br>HELP!");
    later(scene,8,()=>{
      StatementDialogue.send(player,"",false);camera(player,2510,2835,350,2504,2840,200);
      const doll=api.spawnNpc({id:DOLL,x:2505,y:2839,z:0,wanderRadius:0,owner:player,ownerOnly:true});if(doll)scene.enter(doll);
    });
    later(scene,10,()=>player.performAnimation(new Animation(830)));
    const line="I buried Her in the sand, by that tree, to the west. But I still feel Her eyes staring into my soul. Please find Her, and kill the demon inside!";
    later(scene,13,()=>sceneSpeech(player,GNOCCI,"Gnocci the Cook",line));
    later(scene,18,()=>{
      endScene(player);setCook(player,COOK_HEARD);
      startTranscript(api,player,GNOCCI,PAGE,"gnocci-s-curse-talking-to-gnocci",steps=>sceneTail(steps,"OV-LNe")??[]);
    });
  }

  function sceneAction(event) {
    const { player, stepId } = event;
    if (stepId === "Gsd1jQ") {
      beginScene(player, "colin", { x: 2528, y: 2841, z: 1 }, COLIN_2);
      camera(player, 2527, 2824, 700, 2527, 2839, 350);
      const scene=scenes.get(player);later(scene,1,()=>moveCamera(player,2527,2828,700,1));
      pauseScene(event,1);
    } else if (stepId === "p6ox6g") {
      const scene=scenes.get(player);freezeScene(player);
      later(scene,2,()=>{
        endScene(player);setCabinboy(player,CABINBOY_HEARD);
        startTranscript(api,player,COLIN,PAGE,"colin-s-curse-talking-to-colin",steps=>sceneTail(steps,"p6ox6g")??[]);
      });
    } else if (stepId === "Cs_rhQ") {
      beginScene(player, "gnocci", { x: 2500, y: 2840, z: 0 }, GNOCCI_3);
      camera(player, 2499, 2833, 800, 2505, 2837, 200);
      player.performAnimation(new Animation(619));
      const scene=scenes.get(player);later(scene,1,()=>moveCamera(player,2503,2830,280,3));
      pauseScene(event,1);
    } else if (stepId === "OV-LNe") {
      gnocciBurial(player);
    } else if (stepId === "36K07h") {
      player.performAnimation(new Animation(2171));
      beginScene(player, "telescope", { x: 2528, y: 2816, z: 0 });
      camera(player, 2528, 2821, 400, 2528, 2822, 300);
      const scene = scenes.get(player);
      later(scene,1,()=>moveCamera(player,2528,2818,400,1));
      const ogre = api.spawnNpc({ id: NpcIdentifiers.BUGS_2, x: 2528, y: 2822, z: 0, wanderRadius: 0, owner: player, ownerOnly: true });
      if (ogre) scene.enter(ogre);
      freezeScene(player);
      later(scene,9,()=>player.getPacketSender().sendChatboxInterface(217).sendPlayerHeadOnInterface((217<<16)|2)
        .sendString("That doesn't look anything like a mermaid. That's an ogre!",(217<<16)|6).sendString("",(217<<16)|5).sendInterfaceFlagsRange((217<<16)|5,-1,-1,0));
      later(scene, 18, () => {
        endScene(player); setCabinboy(player, CABINBOY_TELESCOPE);
        startTranscript(api, player, ITHOI, PAGE, "colin-s-curse-using-ithoi-s-telescope", (steps) => steps.slice(2));
      });
    } else if (["rqXQdP", "Xub2Df", "gXvRex", "8whjhh"].includes(stepId) && scenes.get(player)?.kind === "colin") {
      player.performAnimation(new Animation(2171));
      const scene=scenes.get(player);
      if(stepId==="Xub2Df"){moveCamera(player,2523,2830,700,1);pauseScene(event,3);}
      else {
        const delay=stepId==="gXvRex"?2:3;
        later(scene,delay,()=>camera(player,2523,2831,650,2540,2844,350));
        pauseScene(event,stepId==="rqXQdP"?3:stepId==="gXvRex"?5:6);
      }
    } else return false;
    event.handled = true;
    return true;
  }

  function startFireScene(player) {
    if (scenes.has(player)) return;
    StatementDialogue.send(player, "You light the driftwood...");
    later(player, 2, () => {
      if (player.isRegistered?.() === false || quest.getStage(player) !== STAGE_CONFESSED) return;
      const scene = beginScene(player, "fire", { x: 2530, y: 2841, z: 1 });
      scene.returnTile = new Location(2529, 2838, 0);
      sendProgress(player); placeDriftwood(player, BURNING_DRIFTWOOD_OBJECT);
      later(scene,3,()=>camera(player, 2529, 2835, 200, 2529, 2841, 170));
      later(scene,4,()=>moveCamera(player,2529,2837,200,1));
      later(scene, 10, () => {
        moveTo(player, { x: 2529, y: 2838, z: 0 });
        camera(player, 2531, 2841, 300, 2531, 2835, 240);
        const ithoi = api.spawnNpc({ id: ITHOI_2, x: 2529, y: 2833, z: 0, wanderRadius: 0, owner: player, ownerOnly: true });
        if (!ithoi) return;
        scene.enter(ithoi); ithoi.forceChat("Arrr... uh-oh!");
        for (const [tick, x, y] of [[1,2530,2833],[2,2532,2833],[3,2532,2835],[4,2532,2836]]) later(scene, tick, () => ithoi.moveTo(new Location(x, y, 0)));
        later(scene, 8, () => {
          ithoi.forceChat("Arrr!"); ithoi.performAnimation(new Animation(711)); ithoi.performGraphic(new Graphic(120, 92));
          player.getPacketSender().sendProjectile(ithoi.getLocation(), new Location(2530, 2837, 0), 0, 90, 127, 43, 31, null, 51);
          placeDriftwood(player, WET_DRIFTWOOD_OBJECT);
        });
      });
      later(scene,22,()=>moveCamera(player,2531,2840,300,1));
      later(scene, 26, () => {
        endScene(player); advance(player, STAGE_PROVED);
        startTranscript(api, player, ITHOI, PAGE, "traitor-in-the-midst-attempting-to-light-the-the-driftwood-after-discovering-ithoi-s-lie", (steps) => steps.slice(-1));
      });
    });
  }

  function menuWarning(event) {
    if (!TOCK_NPC_IDS.has(event.npcId) || quest.getStage(event.player) !== 0) return;
    if (String(event.prompt).includes("Start") && event.player.getSkillManager().getCombatLevel() < 20) event.warning = "Before starting this quest, be aware that your combat level is lower than the recommended level of 20.";
  }

  function renderLine(event) {
    const { player, npcId } = event;
    if (!player || typeof event.text !== "string") return;
    const line = event.text;
    if (TOCK_NPC_IDS.has(npcId) && line.startsWith("Now, I've a ship moored west of Rimmington.")) { event.before = () => {
      if(quest.getStage(player)!==STAGE_STARTED)return;
      const scene = beginScene(player, "ship", { x: 2918, y: 3231, z: 0 });
      freezeScene(player);sceneSpeech(player,CAPTAIN_TOCK_START,"Captain Tock",line);
      later(scene,2,()=>camera(player, 2943, 3224, 800, 2928, 3224, 100));
      later(scene, 3, () => camera(player, 2926, 3224, 800, 2911, 3224, 100, 6, 0));
      later(scene, 12, () => player.getPacketSender().sendCameraLookAt(2911, 3227, 100, {rate:1,rate2:0,heightRelative:false}));
      later(scene, 23, () => {
        endScene(player);
        startTranscript(api, player, CAPTAIN_TOCK_START, PAGE, "the-cursed-crew-talking-to-captain-tock", (steps) => sceneTail(steps,line)??[]);
      });
    }; return; }
    // Every line passes through here: keep a hook another quest set for the same line.
    const previous = event.before;
    event.before = () => {
      previous?.();
      const stage = quest.getStage(player);
      if (TOCK_NPC_IDS.has(npcId) && line === "Sure, I'll try to help with your curse." && stage === 0) {
        advance(player, STAGE_STARTED); player.sendMessage("You've started a new quest: <col=081190>The Corsair Curse</col>");
      }
      if (ITHOI_NPC_IDS.has(npcId) && line.startsWith("Okay, it doesn't sound like you know")) { setNavigator(player, 1); if (stage < STAGE_INVESTIGATING) advance(player, STAGE_INVESTIGATING); }
      if (npcId === ARSEN && line.startsWith("I'd hoped I could use my amazing")) { player.setAttribute(THIEF_STORY_ATTRIBUTE, true); setThief(player, THIEF_HEARD); }
      if (npcId === ARSEN && line.startsWith("Maybe you could get the relic back")) { player.setAttribute(THIEF_STORY_ATTRIBUTE, false); setThief(player, THIEF_HEARD); }
      if (npcId === NpcIdentifiers.CHIEF_TESS && line.startsWith("Dis is tooth-pick.")) setThief(player, THIEF_RETURNED_RELIC);
      if (npcId === ARSEN && line.startsWith("Their chief, Tess, says")) { player.setAttribute(THIEF_REPORT_ATTRIBUTE, true); sendProgress(player); }
      if (npcId === ARSEN && line.startsWith("She didn't care - she's got lots")) { player.setAttribute(THIEF_REPORT_ATTRIBUTE, false); setThief(player, THIEF_TOLD); }
      if (COLIN_NPC_IDS.has(npcId) && line.startsWith("Oh. Oh, I see. Okay...")) setCabinboy(player, CABINBOY_TOLD);
      if (GNOCCI_NPC_IDS.has(npcId) && line.startsWith("Clockwork? Oh,")) setCook(player, COOK_TOLD);
      if (TOCK_NPC_IDS.has(npcId) && line.startsWith("Arrr, I don't rightly know. It began")) advance(player, STAGE_TRAITOR_KNOWN);
      if (GNOCCI_NPC_IDS.has(npcId) && line.startsWith("Anyway I didn't dare try to fish")) { addTraitorFlag(player, TRAITOR_GNOCCI); maybeAdvanceTraitor(player); sendProgress(player); }
      if (npcId === ARSEN && line.startsWith("My brother, Francois, says")) { addTraitorFlag(player, TRAITOR_ARSEN); maybeAdvanceTraitor(player); sendProgress(player); }
      if (ITHOI_NPC_IDS.has(npcId) && line.startsWith("Arrr! Too clever ye be")) advance(player, STAGE_CONFESSED);
      if (ITHOI_NPC_IDS.has(npcId) && line.startsWith("The Corsairs all think I'm sick too")) { player.setAttribute(PROOF_ATTRIBUTE, true); sendProgress(player); }
      if (TOCK_NPC_IDS.has(npcId) && line.startsWith("Arrr! So he was never sick at all!")) advance(player, STAGE_KILL_ORDER);
      const scene = scenes.get(player);
      if (scene?.kind === "telescope" && line.startsWith("That doesn't look anything like a mermaid.")) { endScene(player); setCabinboy(player, CABINBOY_TELESCOPE); }
      if (scene?.kind === "colin") {
        if(line.startsWith("... yes, it's a mermaid!"))moveCamera(player,2523,2831,650,1);
        if(line.startsWith("I hope she's not angry."))moveCamera(player,2516,2827,1300,2);
      }
      if (scene?.kind === "gnocci" && line.startsWith("Ooh, what's this?")) player.performAnimation(new Animation(4185));
      if(scene?.kind==="gnocci"&&line.startsWith("She's moving!"))gnocciBurial(player);
    };
    const scene=scenes.get(player);
    if(scene?.kind==="colin"&&line.startsWith("... yes, it's a mermaid!"))event.after=()=>{
      pauseScene(event,2);later(scene,1,()=>camera(player,2524,2834,400,2540,2839,350));
    };
    if(scene?.kind==="colin"&&line.startsWith("I can see you moving your arms"))event.after=()=>{
      pauseScene(event,6);later(scene,2,()=>camera(player,2524,2834,400,2540,2839,350));
    };
    if(scene?.kind==="gnocci"&&line.startsWith("Ooh, what's this?"))event.after=()=>{
      moveCamera(player,2505,2839,220,1);pauseScene(event,2);
    };
    if(scene?.kind==="gnocci"&&line.startsWith("C'mon little lobsters. We don't want to keep the Captain"))event.after=()=>{
      pauseScene(event,2);later(scene,1,()=>camera(player,2504,2841,220,2505,2835,170));
    };
  }

  class IthoiArena extends PrivateArea {
    constructor(player) { super([new Boundary(2525,2534,2834,2843,1)]); this.owner = player; }
    postLeave(mobile, logout) {
      if (mobile === this.owner) { mobile.setArea(null); clearFight(mobile); }
      super.postLeave(mobile, logout);
    }
  }
  class IthoiHut extends Area {
    process(mobile) {
      if (!mobile.isPlayer() || quest.getStage(mobile) !== STAGE_KILL_ORDER || fights.has(mobile)) return;
      const arena = new IthoiArena(mobile); arena.enter(mobile);
      const npc = api.spawnNpc({ id: ITHOI_FIGHT, x: 2529, y: 2839, z: 1, wanderRadius: 0, owner: mobile, ownerOnly: true });
      if (!npc) { arena.leave(mobile, false); return; }
      npc.__skipDefaultRespawn = true; arena.enter(npc); fights.set(mobile, { arena, npc }); npc.getCombat().attack(mobile);
    }
  }
  function clearFight(player) {
    const fight = fights.get(player); if (!fight) return;
    fights.delete(player); api.removeNpc(fight.npc);
    if (player.getArea() === fight.arena) fight.arena.leave(player, false);
    fight.arena.destroy();
  }
  function ithoiDying({ npc }) { if (npc?.getId() === ITHOI_FIGHT) npc.forceChat("Awww!"); }

  const ithoiSpells = [CombatSpells.WIND_STRIKE, CombatSpells.WATER_STRIKE, CombatSpells.EARTH_STRIKE, CombatSpells.FIRE_STRIKE, CombatSpells.CURSE].map((base, index) => {
    const spell = Object.create(base);
    spell.castAnimation = () => new Animation(index === 4 ? 11428 : 9144);
    spell.castProjectile = (source, target) => Projectile.createProjectile(source, target, [91,94,97,100,109][index], 51, 90, 43, 31);
    if (index < 4) spell.maximumHit = () => Math.min(6, base.maximumHit());
    else spell.spellEffect = (_source, target) => {
      if (!target.isPlayer()) return;
      const skills = target.getSkillManager(), current = skills.getCurrentLevel(Skill.DEFENCE);
      if (current >= skills.getMaxLevel(Skill.DEFENCE)) {
        skills.setCurrentLevelCombat(Skill.DEFENCE, Math.max(0, current - Math.floor(current * 0.05)));
        skills.updateSkill(Skill.DEFENCE); target.sendMessage("You feel weakened.");
      }
    };
    return spell;
  });
  class IthoiCombat extends MagicCombatMethod {
    start(npc, target) {
      npc.getCombat().setCastSpell(ithoiSpells[Math.floor(Math.random() * ithoiSpells.length)]);
      npc.forceChat(["Ye'll pay!", "Curse you!", "Curse 'em all!", "Arrr, land-lubber!"][Math.floor(Math.random() * 4)]);
      super.start(npc, target);
    }
    attackSpeed() { return 5; }
    hits(npc, target) {
      const hits = super.hits(npc, target);
      if (npc.getCombat().getSelectedSpell() === ithoiSpells[4]) for (const hit of hits) hit.setTotalDamage(0);
      return hits;
    }
    finished(npc) { npc.getCombat().setCastSpell(null); }
  }
  function useYusufBank({ player }) {
    if (!quest.isComplete(player)) { startTranscript(api, player, NpcIdentifiers.YUSUF, "Yusuf", "before-completion-of-the-corsair-curse"); return; }
    player.getBank(player.getCurrentBankTab()).open();
  }

  // ==========================================================================
  // Session lifecycle
  // ==========================================================================

  function sendProgress(player) {
    const packet = player.getPacketSender();
    packet.sendVarbit(VARBIT_PROGRESS, wireStage(player));
    packet.sendVarbit(VARBIT_CABINBOY, cabinboy(player));
    packet.sendVarbit(VARBIT_COOK, cook(player));
    packet.sendVarbit(VARBIT_THIEF, thiefWire(player));
    packet.sendVarbit(VARBIT_NAVIGATOR, navigator(player));
  }

  function handleLogin({ player }) {
    if (!player) return;
    refreshQuestList(player);
    sendProgress(player);
    ensureNpcs(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    endScene(player); clearFight(player); removeDoll(player); TaskManager.cancelTasks(player);
    const tracked = npcsByPlayer.get(player);
    if (tracked) for (const npc of tracked.values()) api.removeNpc(npc);
    npcsByPlayer.delete(player);
  }

  // ==========================================================================
  // Journal
  // ==========================================================================

  function crewLine(progress, done, text) {
    return progress >= done ? `<str>${text}</str>` : text;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Captain Tock asked me to help lift the curse on his crew.</str>",
        "<str>I looked into the crew's stories and found the curse was fake.</str>",
        "<str>Ithoi the Navigator had poisoned the crew to keep his place on</str>",
        "<str>the ship, and I dealt with him for Captain Tock.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_KILLED) {
      return [
        "<str>Ithoi had poisoned the crew and faked the curse.</str>",
        "<str>I killed Ithoi as Captain Tock asked.</str>",
        "",
        "I should tell <col=800000>Captain Tock</col> what has happened.",
      ];
    }
    if (stage >= STAGE_KILL_ORDER) {
      return [
        "<str>I proved Ithoi's curse was fake.</str>",
        "Captain Tock has asked me to kill <col=800000>Ithoi the Navigator</col>.",
      ];
    }
    if (stage >= STAGE_PROVED) {
      return [
        "<str>Ithoi confessed that he poisoned the crew and faked the curse.</str>",
        "<str>I lit the driftwood under his hut and he ran out to put it out,</str>",
        "<str>proving he was never sick.</str>",
        "",
        "I should tell <col=800000>Captain Tock</col>.",
      ];
    }
    if (stage >= STAGE_CONFESSED) {
      return [
        "<str>Ithoi admitted poisoning the crew to save his place on the ship.</str>",
        "",
        "He will not get up on his own, so I need to prove he is faking his illness.",
      ];
    }
    if (stage >= STAGE_FIRING_KNOWN) {
      return [
        "<str>Captain Tock says the crew fell ill after dinner, but Ithoi, who</str>",
        "<str>did not eat it, felt ill too.</str>",
        "",
        "<str>Gnocci says Ithoi cooked that meal, and Arsen says the Captain</str>",
        "<str>may dismiss Ithoi now the Corsairs no longer need a navigator.</str>",
        "",
        "I should confront <col=800000>Ithoi the Navigator</col>.",
      ];
    }
    if (stage >= STAGE_TRAITOR_KNOWN) {
      return [
        "<str>None of the crew's own theories could have caused the curse.</str>",
        "",
        "<str>Captain Tock says the crew fell ill after dinner, but Ithoi, who</str>",
        "<str>did not eat it, felt ill too.</str>",
        "",
        "I should ask the crew about <col=800000>that meal</col>.",
      ];
    }
    if (stage >= STAGE_INVESTIGATING) {
      return [
        "<str>Captain Tock asked me to help lift the curse on his crew.</str>",
        "<str>Ithoi the Navigator says the crew really are cursed.</str>",
        "",
        "I should investigate the crew's stories:",
        crewLine(thief(player), THIEF_TOLD, "Arsen's relic was only a tooth-pick."),
        crewLine(cabinboy(player), CABINBOY_TOLD, "The mermaid Colin saw was an ogre."),
        crewLine(cook(player), COOK_TOLD, "The possessed doll was clockwork."),
      ];
    }
    if (stage >= STAGE_ARRIVED) {
      return [
        "<str>Captain Tock asked me to help lift the curse on his crew.</str>",
        "<str>We sailed to Corsair Cove.</str>",
        "",
        "I should speak to <col=800000>Ithoi the Navigator</col>, whose hut is",
        "on the beach to the south-west, before the other crew members.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Captain Tock asked me to help lift the curse on his crew.",
        "",
        "His ship is moored at the west end of <col=800000>Rimmington</col>.",
        "I should meet him on board and sail to <col=800000>Corsair Cove</col>.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Captain Tock</col>",
      "at the crossroads north of <col=800000>Port Sarim</col>.",
    ];
  }

  api.persistAttribute(PROOF_ATTRIBUTE, false);
  api.persistAttribute(THIEF_STORY_ATTRIBUTE, false);
  api.persistAttribute(THIEF_REPORT_ATTRIBUTE, false);
  api.persistAttribute(DEPARTED_ATTRIBUTE, false);
  api.persistAttribute(CABINBOY_ATTRIBUTE, 0);
  api.persistAttribute(COOK_ATTRIBUTE);
  api.persistAttribute(THIEF_ATTRIBUTE);
  api.persistAttribute(NAVIGATOR_ATTRIBUTE);
  api.persistAttribute(TRAITOR_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "the_corsair_curse",
    name: "The Corsair Curse",
    varpId: VARP_CORSAIR_CURSE,
    varbitId: VARBIT_PROGRESS,
    varbitValue: (_stage, player) => wireStage(player),
    completionJingleId: 154,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [],
    otherRewards: [
      "Access to Yusuf's bank in the Corsair Cove",
      "The ability to dock your boat at the Corsair Cove Port",
    ],
    buildJournal,
  });



  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("npc-dialogue:line", renderLine);
  api.onCustomEvent("npc-dialogue:menu", menuWarning);
  api.onCustomEvent("npc-dialogue:choice", handleDialogueChoice);
  api.onNpcInteraction("Captain Tock", { Travel: handleTravel });
  api.onNpcInteraction("Cabin Boy Colin", { Travel: handleTravel });
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject);
  api.onCanUseItem(claimDig);
  api.onItemOnNpc(handleItemOnNpc);
  api.onNpcDeath(handleNpcDeath);
  api.onNpcBeforeDeath(ithoiDying);
  api.registerNpcCombatMethodProvider(ITHOI_FIGHT, IthoiCombat);
  api.registerArea(new IthoiHut([new Boundary(2525, 2534, 2834, 2843, 1)]));
  api.onNpcInteraction("Yusuf", { Bank: useYusufBank });
  api.onCustomEvent("ladders:climb", claimClimb);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
