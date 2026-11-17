/**
 * The Corsair Curse, from one whole run of the quest on live (rsprox capture local 1001340, rev 240.1;
 * docs/quests/the-corsair-curse/README.md has the facts this follows).
 *
 * - Words are the Wiki transcript's (npc-dialogues.json "The Corsair Curse"), with the four lines live
 *   sends that the Wiki lacks (osrsreboxed-db capture-sources.json); heads' animations are the capture's
 *   (data/chathead-animations.json).
 * - Varbits are the cache's own (corscurs_progress 5 ... 60 and the four crew varbits), set on the
 *   lines and boxes live sets them on. NPCs, the driftwood and the ferries follow them as multinpcs and
 *   multilocs, so nothing here spawns a second captain or places a driftwood.
 * - Cutscenes, the telescope view, the fire and Ithoi's fight are corsaircurse/Scenes.CorsairCurse.js;
 *   the journal is corsaircurse/Journal.CorsairCurse.js.
 */
module.exports = function registerCorsairCurseQuest(api) {
  const {
    Animation, GameObject, MagicCombatMethod, CombatSpells, Projectile,
    ItemIdentifiers, Location, NpcIdentifiers, ObjectIdentifiers, ObjectManager, Skill, TaskManager, Task,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, questStartMessage } = require("../QuestRuntime");
  const { buildLines } = require("../corsaircurse/Journal.CorsairCurse");
  const createScenes = require("../corsaircurse/Scenes.CorsairCurse");

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
  const ARSEN = NpcIdentifiers.ARSEN_THE_THIEF; // 7976
  /** corscurs_doll_multi: the dug-up doll as live spawns it (multinpc of corscurs_doll, 7975). */
  const DOLL_MULTI = 7993;
  // The crew's sick beds (multinpcs of the ids above; capture tick 4920).
  const ITHOI_SICK = 7962; // corscurs_navigator_sick
  const COLIN_SICK = 7968; // corscurs_cabinboy_sick
  const GNOCCI_SICK = 7973; // corscurs_cook_sick
  const ARSEN_SICK = 7977; // corscurs_thief_sick

  const TOCK_NPC_IDS = new Set([CAPTAIN_TOCK_START, CAPTAIN_TOCK_POST, CAPTAIN_TOCK_FERRY]);
  const ITHOI_NPC_IDS = new Set([ITHOI, ITHOI_SICK, ITHOI_2, ITHOI_FIGHT]);
  const COLIN_NPC_IDS = new Set([COLIN, COLIN_2, COLIN_POST, COLIN_SICK]);
  const GNOCCI_NPC_IDS = new Set([GNOCCI, GNOCCI_2, GNOCCI_3, GNOCCI_SICK]);
  const ARSEN_NPC_IDS = new Set([ARSEN, ARSEN_SICK]);

  const OGRE_ARTEFACT_ITEM = ItemIdentifiers.OGRE_ARTEFACT_2; // 21837, corscurs_relic
  const TINDERBOX_ITEM = ItemIdentifiers.TINDERBOX; // 590
  const SPADE_ITEM = ItemIdentifiers.SPADE; // 952
  const FEATHER_ITEM = ItemIdentifiers.FEATHER; // 314
  const ABYSSAL_WHIP_ITEM = ItemIdentifiers.ABYSSAL_WHIP; // 4151
  /** The completion scroll's model: poison (capture tick 7401). */
  const SCROLL_ITEM = 273;

  const TELESCOPE_OBJECT = ObjectIdentifiers.TELESCOPE_10; // 31632 corscurs_telescope, Observe
  const SPADE_OBJECT = ObjectIdentifiers.SPADE_2; // 31585 sand_withspade, Take
  const SPADE_TAKEN_OBJECT = 31586; // sand_withoutspade
  const TINDERBOX_OBJECT = ObjectIdentifiers.COL_FF9040_TINDERBOX_COL; // 31634 raids_icedemon_tinderbox, Take
  const DRIFTWOOD_OBJECT = ObjectIdentifiers.DRIFTWOOD_4; // 31721
  const WET_DRIFTWOOD_OBJECT = ObjectIdentifiers.WET_DRIFTWOOD; // 31723
  const DRIFTWOOD_PARENT = 31724; // corscurs_driftwood_multi: burning at progress 49, wet from 50
  const DUNGEON_HOLE_OBJECT = ObjectIdentifiers.HOLE_54; // 31791 ds2_ogre_corsair_vine_ladder_entrance, Enter
  const OGRE_CAVE_OBJECT = ObjectIdentifiers.CAVE_59; // 31766, Enter (west of the cove)
  const VINE_LADDER_OBJECT = ObjectIdentifiers.VINE_LADDER_2; // 31790 ds2_ogre_corsair_vine_ladder, Climb
  const HUT_STAIRS_OBJECT = 31735; // ds2_corsair_cove_stairs_ramp: ground end 2531,2833,0 up, upper end 2529,2834,1 down

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
  const ACTION_TELESCOPE_VIEW = "36K07h";
  const ACTION_ITHOI_EXTINGUISHES = "Qx1uew";
  const ACTION_QUEST_COMPLETE = "SaQ1Mg";

  const VARIANT_START = "the-cursed-crew-talking-to-captain-tock";
  const VARIANT_COLIN = "colin-s-curse-talking-to-colin";
  const VARIANT_GNOCCI = "gnocci-s-curse-talking-to-gnocci";
  const VARIANT_TELESCOPE = "colin-s-curse-using-ithoi-s-telescope";
  const VARIANT_DIG = "gnocci-s-curse-digging-for-her";

  // Tiles verified against the cache collision map.
  const RIMMINGTON_TILE = { x: 2910, y: 3226, z: 0 };
  const RIMMINGTON_LANDING = { x: 2911, y: 3226, z: 0 };
  const COVE_LANDING = { x: 2578, y: 2837, z: 1 };
  const DUNGEON_LANDING = { x: 2011, y: 9007, z: 1 };
  const DIG_TILE = { x: 2503, y: 2839, z: 0 };
  /** The dug-up doll's path, a tile a tick from its spawn a tick after the dig (capture ticks 5854-5864). */
  const DOLL_SPAWN = [2505, 2839];
  const DOLL_PATH = [[2505, 2840], [2506, 2841], [2507, 2842], [2508, 2842], [2509, 2841], [2509, 2840], [2509, 2839],
    [2509, 2838], [2509, 2839]];

  const SOUND_TOCK_LEAVES = 1753;
  const SOUND_DIG = 1470;
  const SOUND_DOLL = 941;
  const SOUND_DOLL_SPLASH = 2496;
  const SOUND_SPADE = 2733;
  const SOUND_TINDERBOX = 2582;
  const JINGLE_SAIL = 171;
  /** Ticks the spade's sand stays empty after it is taken (capture ticks 4753-4766). */
  const SPADE_RESPAWN_TICKS = 13;

  const CABINBOY_ATTRIBUTE = "quest.the_corsair_curse.cabinboy";
  const COOK_ATTRIBUTE = "quest.the_corsair_curse.cook";
  const THIEF_ATTRIBUTE = "quest.the_corsair_curse.thief";
  const NAVIGATOR_ATTRIBUTE = "quest.the_corsair_curse.navigator";
  const TRAITOR_ATTRIBUTE = "quest.the_corsair_curse.traitor";
  const PROOF_ATTRIBUTE = "corsair-curse:proof-plan";
  const THIEF_STORY_ATTRIBUTE = "corsair-curse:thief-story";
  const THIEF_REPORT_ATTRIBUTE = "corsair-curse:thief-report";
  const DEPARTED_ATTRIBUTE = "corsair-curse:captain-departed";

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
  /** Arsen told the player about the firing before Gnocci told them about the meal: the journal's order. */
  const TRAITOR_ARSEN_FIRST = 1 << 3;

  /** Players whose driftwood burns: corscurs_progress 49 for the fire scene. */
  const burning = new WeakSet();
  const dolls = new WeakMap();
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
    const flags = traitorFlags(player);
    if (flags & flag) return;
    // Arsen before Gnocci: the journal lists his report first.
    const first = flag === TRAITOR_ARSEN && (flags & TRAITOR_GNOCCI) === 0 ? TRAITOR_ARSEN_FIRST : 0;
    player.setAttribute(TRAITOR_ATTRIBUTE, flags | flag | first);
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
    if (burning.has(player) && stage === STAGE_CONFESSED) return 49;
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
  }

  function later(key, ticks, action) {
    const task = new Task(ticks, key, false);
    task.execute = () => { task.stop(); action(); };
    TaskManager.submit(task);
  }

  const Scenes = createScenes(api, {
    colinDone(player, tail) {
      setCabinboy(player, CABINBOY_HEARD);
      if (tail?.length) startTranscript(api, player, COLIN, PAGE, VARIANT_COLIN, () => tail);
    },
    gnocciDone(player, tail) {
      setCook(player, COOK_HEARD);
      if (tail?.length) startTranscript(api, player, GNOCCI, PAGE, VARIANT_GNOCCI, () => tail);
    },
    telescopeDone(player) {
      setCabinboy(player, CABINBOY_TELESCOPE);
      startTranscript(api, player, ITHOI, PAGE, VARIANT_TELESCOPE, (steps) => Scenes.tailAfter(VARIANT_TELESCOPE, ACTION_TELESCOPE_VIEW) ?? steps.slice(-1));
    },
    fireLit(player) {
      burning.add(player);
      sendProgress(player);
    },
    fireOut(player) {
      burning.delete(player);
      advance(player, STAGE_PROVED);
      sendProgress(player);
    },
    fireDone(player, steps) {
      startTranscript(api, player, ITHOI, PAGE,
        "traitor-in-the-midst-attempting-to-light-the-the-driftwood-after-discovering-ithoi-s-lie", () => steps);
    },
    fightWon(player) {
      advance(player, STAGE_KILLED);
    },
    sceneEnded(player) {
      // A fire scene cut short leaves the driftwood unlit: it can be lit again.
      if (burning.delete(player)) sendProgress(player);
    },
  });

  // ==========================================================================
  // Travel
  // ==========================================================================

  function sailToCove(player) {
    moveTo(player, COVE_LANDING);
    advance(player, STAGE_ARRIVED);
  }

  function sailToRimmington(player) {
    moveTo(player, RIMMINGTON_LANDING);
  }

  function handleTravel(event) {
    const { player, npc } = event;
    if (!player || !npc) return false;
    if (quest.getStage(player) === STAGE_NOT_STARTED) return false;
    if (nearRimmington(npc)) sailToCove(player);
    else sailToRimmington(player);
    return true;
  }

  // ==========================================================================
  // Transcript variant selection
  // ==========================================================================

  function selectTockVariant(player, npc) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return "after-corsair-curse";
    if (stage === STAGE_NOT_STARTED) return VARIANT_START;
    if (nearRimmington(npc)) return "the-cursed-crew-talking-to-captain-tock-again";
    switch (stage) {
      case STAGE_STARTED:
        return VARIANT_START;
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
    if (progress === 0) return VARIANT_COLIN;
    if (progress === CABINBOY_HEARD) return "colin-s-curse-talking-to-colin-talking-to-colin-again";
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
    if (progress === 0) return VARIANT_GNOCCI;
    if (progress === COOK_HEARD) return "gnocci-s-curse-talking-to-gnocci-talking-to-gnocci-again";
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
    if (ARSEN_NPC_IDS.has(npcId)) return selectArsenVariant(player);
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
        if (!ARSEN_NPC_IDS.has(npcId)) return null;
        return thief(player) < THIEF_HAS_ARTEFACT;
      case COND_NO_TESS_YET:
        if (!ARSEN_NPC_IDS.has(npcId)) return null;
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
    if (stepId === ACTION_TOCK_LEAVES) {
      event.handled = true;
      event.box = { statement: true };
      player.setAttribute(DEPARTED_ATTRIBUTE, true);
      // Capture tick 4414: progress 10, the box and its sound on the same tick.
      if (quest.getStage(player) < STAGE_STARTED) advance(player, STAGE_STARTED);
      else sendProgress(player);
      player.getPacketSender().sendSoundEffect(SOUND_TOCK_LEAVES, 1, 0, 255);
      return;
    }
    if (stepId === ACTION_SAIL_TO_COVE) {
      event.handled = true;
      sail(player, event);
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
      // The artefact goes with Tess's "Dis is tooth-pick" line, not the box (capture ticks 5657, 5663).
      event.box = { items: [OGRE_ARTEFACT_ITEM] }; event.handled = false;
      return;
    }
    if (stepId === ACTION_TELESCOPE_VIEW) {
      event.handled = true;
      Scenes.telescope(player, telescopeLine(player));
      return;
    }
    if (stepId === ACTION_ITHOI_EXTINGUISHES) {
      event.handled = true;
      return;
    }
    if (stepId === ACTION_QUEST_COMPLETE) {
      if (quest.getStage(player) >= STAGE_KILLED && !quest.isComplete(player)) {
        quest.complete(player);
      }
    }
  }

  /**
   * "The ship sails to Corsair Cove..." (capture ticks 4702-4708): progress 15 and the fade out with the
   * box, jingle 171; the player is on the cove's deck three ticks later, the fade back in a tick after
   * that, and the box goes by itself a tick later.
   */
  function sail(player, event) {
    advance(player, STAGE_ARRIVED);
    event.box = { statement: true, holdTicks: 5, advance: true };
    Scenes.fade(player, "out");
    player.getPacketSender().sendJingle(JINGLE_SAIL);
    later(player, 3, () => moveTo(player, COVE_LANDING));
    later(player, 4, () => Scenes.fade(player, "in"));
  }

  /** The telescope's line: the transcript's Big Chompy Bird Hunting condition, as the scene shows it. */
  function telescopeLine(player) {
    const id = bigChompyComplete(player) ? COND_CHOMPY_TELESCOPE : COND_NO_CHOMPY_TELESCOPE;
    const condition = (Scenes.tailAfter(VARIANT_TELESCOPE, ACTION_TELESCOPE_VIEW) ?? []).find((step) => step.id === id);
    const text = condition?.steps?.find((step) => typeof step.player === "string")?.player;
    return { player: true, text: text ?? "" };
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
      event.end = true;
      digUpDoll(player);
    }
  }

  /**
   * The dig (capture ticks 5853-5864): the dig and its sound on the choice; a tick later corscurs_cook 2
   * and the doll, which ticks along its path a tile a tick to the water's edge and is gone eleven ticks
   * after the dig with a splash. The player's line is held from +4 and continued from +11.
   */
  function digUpDoll(player) {
    player.getPacketSender().sendInterfaceRemoval();
    player.performAnimation(new Animation(830));
    player.getPacketSender().sendSoundEffect(SOUND_DIG, 1, 0, 255);
    const line = digLine(player);
    later(player, 1, () => {
      if (cook(player) !== COOK_HEARD) return;
      setCook(player, COOK_DUG);
      removeDoll(player);
      const doll = api.spawnNpc({ id: DOLL_MULTI, x: DOLL_SPAWN[0], y: DOLL_SPAWN[1], z: 0, wanderRadius: 0, owner: player, ownerOnly: true });
      if (!doll) return;
      doll.__skipDefaultRespawn = true;
      doll.setFlag?.("movement:ignore-clipping", true);
      dolls.set(player, doll);
      player.getPacketSender().sendSoundEffect(SOUND_DOLL, 1, 0, 255);
      DOLL_PATH.forEach(([x, y], index) => later(player, index + 1, () => {
        if (dolls.get(player) !== doll || !doll.isRegistered?.()) return;
        doll.getMovementQueue().reset().addSteps(new Location(x, y, 0));
        if (index < DOLL_PATH.length - 1) player.getPacketSender().sendSoundEffect(SOUND_DOLL, 1, 0, 255);
      }));
      later(player, 3, () => {
        if (dolls.get(player) === doll) Scenes.heldPlayerLine(player, line.text);
      });
      later(player, DOLL_PATH.length + 1, () => {
        if (dolls.get(player) !== doll) return;
        removeDoll(player);
        player.getPacketSender().sendSoundEffect(SOUND_DOLL_SPLASH, 1, 0, 255);
        startTranscript(api, player, GNOCCI, PAGE, VARIANT_DIG, () => line.steps);
      });
    });
  }

  /** The dig's line and the condition branch it plays from, by the player's Crafting level. */
  function digLine(player) {
    const choice = (Scenes.tailAfter(VARIANT_DIG, "Okay, he said he buried") ?? []).find((step) => step.type === "choice");
    const conditions = choice?.options?.[0]?.steps ?? [];
    const id = craftingLevel(player) >= 18 ? COND_CRAFTING : COND_NO_CRAFTING;
    const condition = conditions.find((step) => step.id === id);
    return { text: condition?.steps?.find((step) => typeof step.player === "string")?.player ?? "", steps: conditions };
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
        startTranscript(api, player, ITHOI, PAGE, VARIANT_TELESCOPE);
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

  /**
   * The vines (capture ticks 5606-5609, 5677-5678, 5797-5815): into the cave, the pick-up-floor
   * sequence (827) and a tick later the cave; out of it, reach-for-ladder (828) and a tick later the
   * cove. Each end keeps the side of the vines the player stood on.
   */
  function climbVine(player, entering) {
    const north = player.getLocation().getY() > (entering ? 2861 : 9005);
    player.performAnimation(new Animation(entering ? 827 : 828));
    later(player, 1, () => moveTo(player, entering
      ? { x: 2012, y: north ? 9006 : 9004, z: 1 }
      : { x: 2523, y: north ? 2862 : 2860, z: 0 }));
  }

  function leaveDungeon(player) {
    climbVine(player, false);
  }

  /** Picking the spade out of the sand (capture tick 4753): the sand shows empty for 13 ticks. */
  function takeSpade(player, object) {
    if (player.getInventory().getAmount(SPADE_ITEM) > 0) return;
    if (player.getInventory().isFull()) {
      player.sendMessage("You don't have enough inventory space.");
      return;
    }
    player.performAnimation(new Animation(832));
    player.getPacketSender().sendSoundEffect(SOUND_SPADE, 1, 0, 255);
    player.getInventory().adds(SPADE_ITEM, 1);
    if (!object?.getLocation) return;
    const at = object.getLocation();
    const empty = new GameObject(SPADE_TAKEN_OBJECT, at.clone(), object.getType(), object.getFace(), object.getPrivateArea?.() ?? null);
    ObjectManager.replaceInPlace(object, empty);
    later(empty, SPADE_RESPAWN_TICKS, () => {
      const back = new GameObject(SPADE_OBJECT, at.clone(), object.getType(), object.getFace(), object.getPrivateArea?.() ?? null);
      ObjectManager.replaceInPlace(empty, back);
    });
  }

  /** The tinderbox by Gnocci's bed (capture ticks 5436-5437): pick-up-floor, then the box and its sound. */
  function takeTinderbox(player) {
    if (player.getInventory().getAmount(TINDERBOX_ITEM) > 0) return;
    if (player.getInventory().isFull()) {
      player.sendMessage("You don't have enough inventory space.");
      return;
    }
    player.performAnimation(new Animation(827));
    later(player, 1, () => {
      if (player.getInventory().getAmount(TINDERBOX_ITEM) > 0) return;
      player.getInventory().adds(TINDERBOX_ITEM, 1);
      player.getPacketSender().sendSoundEffect(SOUND_TINDERBOX, 1, 0, 255);
    });
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
      takeSpade(player, event.object ?? event.gameObject);
      return;
    }
    if (objectId === TINDERBOX_OBJECT) {
      event.handled = true;
      takeTinderbox(player);
    }
  }

  /** The generic Ladders plugin asks "which way?" for a lone "Climb"; own that click. */
  function claimClimb(request) {
    if (!request || !request.player) return;
    if (request.objectId === VINE_LADDER_OBJECT) {
      request.handled = true;
      leaveDungeon(request.player);
    } else if (request.objectId === HUT_STAIRS_OBJECT) {
      // Ithoi's stairs are a ramp: each end leads only one way, so the floor of the clicked end decides.
      const player = request.player;
      const floor = request.object?.getLocation?.().getZ?.() ?? player.getLocation().getZ();
      request.handled = true;
      if (floor === 0 && quest.getStage(player) === STAGE_KILL_ORDER) {
        // Capture tick 6964: the climb enters the fight's copy of the hut.
        Scenes.fight(player);
        return;
      }
      if (floor !== 0 && Scenes.leaveFight(player)) return;
      api.emitCustomEvent(floor === 0 ? "ladders:climbUp" : "ladders:climbDown", { player, object: request.object });
    }
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
      if (Scenes.playing(player)) return;
      Scenes.fire(player);
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
    startTranscript(api, player, GNOCCI, PAGE, VARIANT_DIG);
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

  // ==========================================================================
  // Ithoi's fight
  // ==========================================================================

  function ownerOfFight(npc) {
    const owner = npc?.getOwner?.();
    return owner && Scenes.fightOf(owner)?.npc === npc ? owner : null;
  }

  /** "Awww!" with his death sequence (capture tick 7248); the copy ends two ticks later. */
  function ithoiDying({ npc }) {
    if (npc?.getId?.() !== ITHOI_FIGHT) return;
    npc.forceChat("Awww!");
    const owner = ownerOfFight(npc);
    if (owner && quest.getStage(owner) === STAGE_KILL_ORDER) Scenes.fightWon(owner);
  }

  const ithoiSpells = [CombatSpells.WIND_STRIKE, CombatSpells.WATER_STRIKE, CombatSpells.EARTH_STRIKE, CombatSpells.FIRE_STRIKE, CombatSpells.CURSE].map((base, index) => {
    const spell = Object.create(base);
    spell.castAnimation = () => new Animation(index === 4 ? 11428 : 9144);
    // An NPC spell's usual flight (51 -> 46 + 10 a tile), which MagicCombatMethod times the hit to; a flat 90 crossed the hut at one speed.
    spell.castProjectile = (source, target) => Projectile.createProjectile(source, target, [91,94,97,100,109][index], 51, Projectile.arrivalCycles(source, target, Projectile.LEGACY_MAGIC_END_BASE), 43, 31);
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
  // Lines
  // ==========================================================================

  function menuWarning(event) {
    if (!TOCK_NPC_IDS.has(event.npcId) || quest.getStage(event.player) !== 0) return;
    if (String(event.prompt).includes("Start") && event.player.getSkillManager().getCombatLevel() < 20) event.warning = "Before starting this quest, be aware that your combat level is lower than the recommended level of 20.";
  }

  /** The lines live moves the quest on at, and the ones its scenes start on. */
  function renderLine(event) {
    const { player, npcId } = event;
    if (!player || typeof event.text !== "string") return;
    const line = event.text;
    const stage = quest.getStage(player);
    // Tock's ship (capture ticks 4382-4405): the line is held while the camera shows it.
    if (TOCK_NPC_IDS.has(npcId) && line.startsWith("Now, I've a ship moored west of Rimmington.")
      && stage === STAGE_STARTED && !sub(player, DEPARTED_ATTRIBUTE) && !Scenes.playing(player)) {
      event.holdTicks = 23;
      chainBefore(event, () => Scenes.ship(player));
      return;
    }
    // Colin's and Gnocci's flashbacks take over from their first held line.
    if (COLIN_NPC_IDS.has(npcId) && line.startsWith("I was using Ithoi's telescope") && cabinboy(player) === 0 && stage === STAGE_INVESTIGATING) {
      chainBefore(event, () => Scenes.colin(player, npcId));
      return;
    }
    if (GNOCCI_NPC_IDS.has(npcId) && line.startsWith("I was fishing...") && cook(player) === 0 && stage === STAGE_INVESTIGATING) {
      chainBefore(event, () => Scenes.gnocci(player, npcId));
      return;
    }
    chainBefore(event, () => lineReached(player, npcId, line));
  }

  /** Every line passes through here: keep a hook another quest set for the same line. */
  function chainBefore(event, run) {
    const previous = event.before;
    event.before = () => {
      previous?.();
      run();
    };
  }

  function lineReached(player, npcId, line) {
    const stage = quest.getStage(player);
    if (TOCK_NPC_IDS.has(npcId) && line === "Sure, I'll try to help with your curse." && stage === 0) {
      advance(player, STAGE_STARTED); player.sendMessage(questStartMessage(player, "The Corsair Curse"));
    }
    if (ITHOI_NPC_IDS.has(npcId) && line.startsWith("Okay, it doesn't sound like you know")) { setNavigator(player, NAVIGATOR_TOLD); if (stage < STAGE_INVESTIGATING) advance(player, STAGE_INVESTIGATING); }
    if (ARSEN_NPC_IDS.has(npcId) && line.startsWith("I'd hoped I could use my amazing")) { player.setAttribute(THIEF_STORY_ATTRIBUTE, true); setThief(player, THIEF_HEARD); }
    if (ARSEN_NPC_IDS.has(npcId) && line.startsWith("Maybe you could get the relic back")) { player.setAttribute(THIEF_STORY_ATTRIBUTE, false); setThief(player, THIEF_HEARD); }
    if (npcId === NpcIdentifiers.CHIEF_TESS && line.startsWith("Dis is tooth-pick.") && thief(player) === THIEF_HAS_ARTEFACT
      && player.getInventory().getAmount(OGRE_ARTEFACT_ITEM) > 0) {
      player.getInventory().deleteNumber(OGRE_ARTEFACT_ITEM, 1);
      setThief(player, THIEF_RETURNED_RELIC);
    }
    if (ARSEN_NPC_IDS.has(npcId) && line.startsWith("Their chief, Tess, says")) { player.setAttribute(THIEF_REPORT_ATTRIBUTE, true); sendProgress(player); }
    if (ARSEN_NPC_IDS.has(npcId) && line.startsWith("She didn't care - she's got lots")) { player.setAttribute(THIEF_REPORT_ATTRIBUTE, false); setThief(player, THIEF_TOLD); }
    if (COLIN_NPC_IDS.has(npcId) && line.startsWith("Oh. Oh, I see. Okay...")) setCabinboy(player, CABINBOY_TOLD);
    if (GNOCCI_NPC_IDS.has(npcId) && line.startsWith("Clockwork? Oh,")) setCook(player, COOK_TOLD);
    if (TOCK_NPC_IDS.has(npcId) && line.startsWith("Arrr, I don't rightly know. It began")) advance(player, STAGE_TRAITOR_KNOWN);
    if (GNOCCI_NPC_IDS.has(npcId) && line.startsWith("Anyway I didn't dare try to fish")) { addTraitorFlag(player, TRAITOR_GNOCCI); maybeAdvanceTraitor(player); sendProgress(player); }
    if (ARSEN_NPC_IDS.has(npcId) && line.startsWith("My brother, Francois, says")) { addTraitorFlag(player, TRAITOR_ARSEN); maybeAdvanceTraitor(player); sendProgress(player); }
    if (ITHOI_NPC_IDS.has(npcId) && line.startsWith("Arrr! Too clever ye be")) advance(player, STAGE_CONFESSED);
    if (ITHOI_NPC_IDS.has(npcId) && line.startsWith("The Corsairs all think I'm sick too")) { player.setAttribute(PROOF_ATTRIBUTE, true); sendProgress(player); }
    if (TOCK_NPC_IDS.has(npcId) && line.startsWith("Arrr! So he was never sick at all!")) advance(player, STAGE_KILL_ORDER);
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
  }

  function handleLogout({ player }) {
    if (!player) return;
    Scenes.stop(player, true);
    removeDoll(player);
    burning.delete(player);
    TaskManager.cancelTasks(player);
  }

  // ==========================================================================
  // Journal
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const flags = traitorFlags(player);
    return buildLines({
      progress: questHandle.getStage(player) >= STAGE_COMPLETE ? 60 : wireStage(player),
      cabinboy: cabinboy(player),
      cook: cook(player),
      thief: thiefWire(player),
      navigator: navigator(player),
      gnocciTold: (flags & TRAITOR_GNOCCI) !== 0,
      arsenTold: (flags & TRAITOR_ARSEN) !== 0,
      arsenFirst: (flags & TRAITOR_ARSEN_FIRST) !== 0,
    });
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

  // Wiki: "The Corsair Curse/Quick guide" and "Quest experience rewards": 1,200 Firemaking experience.
  const COMPLETION_XP = [[Skill.FIREMAKING, 1200, "Firemaking"]];
  // Held back for a completion not played through (`experience: false`), as the quest runtime requires.
  function grantCompletionXp(player, _quest, options = {}) {
    if (options.experience === false) return;
    for (const [skill, amount] of COMPLETION_XP) player.getSkillManager().addExperiences(skill, amount);
  }

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
    xpRewards: COMPLETION_XP.map(([skill, amount, label]) => ({ skillId: skill.getIndex(), amount, label })),
    onReward: grantCompletionXp,
    otherRewards: [
      "Access to Yusuf's bank in the Corsair Cove",
      "The ability to dock your boat at the Corsair Cove Port",
    ],
    scrollItemId: SCROLL_ITEM,
    buildJournal,
  });

  // The scene tables against the transcript's words, at load: a regenerated transcript that moved a line fails here.
  Scenes.ensureBound();

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
  api.onNpcBeforeDeath(ithoiDying);
  api.registerNpcCombatMethodProvider(ITHOI_FIGHT, IthoiCombat);
  api.onNpcInteraction("Yusuf", { Bank: useYusufBank });
  api.onCustomEvent("ladders:climb", claimClimb);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
