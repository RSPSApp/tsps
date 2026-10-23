/**
 * Tale of the Righteous (members).
 *
 * The words come from the "Tale of the Righteous" transcript page (with the
 * "Archeio" page for his standard archive teleport, and the "Historian Duffy"
 * and "Gnosi" pages for the post-quest variants). This plugin supplies the
 * per-stage variant selectors for Phileas, Pagida, Istoria, Duffy, Gnosi and
 * Lord Shiro Shayzien, the start hook, the four prose-condition answers, the
 * crevice rope/entry, the Corrupt Lizardman fight, the unstable altar, the
 * trashed house and the completion reward.
 *
 * Stage (varbit 6358 "shayzienquest", varp 1729 "shayzienquest_main", bits 0-5;
 * `scripts/lookup-gameval.ts varbit shayzienquest`). The quest DB row for the
 * page is 143 ("quest_taleoftherighteous"), and `yarn dump:cs2 4024` maps that
 * row to varbit 6358. The stub's 7901 was a placeholder.
 *   1  started (agreed to help Phileas)
 *   2  Pagida teleported me into the Tower of Magic prison
 *   3  read the writing beside the skeleton
 *   4  reported to Phileas (he sends me to Lord Shayzien)
 *   5  Lord Shayzien approved the research
 *   6  Duffy told me about the crevice
 *   7  inspected the crevice (I need a rope)
 *   8  intentionally unused: the rope must land on 9, because the cache's
 *      cave-mouth loc 32502 transforms into the roped crevice 31966 at index 9
 *      and into the unroped 31965 for 0-8 (CacheDefinitions.getObject(32502))
 *   9  attached the rope / entered Quidamortem Cave
 *   10 killed the Corrupt Lizardman
 *   11 inspected the unstable altar
 *   12 told Duffy; the expedition moves into the cave (the summit Duffy/Gnosi/
 *      Natural Historian transforms hide at index 12 of the same varbit)
 *   13 spoke to Duffy in the cave
 *   14 spoke to Gnosi
 *   15 reported to Lord Shayzien; Phileas' furniture breaks at index 15
 *   16 entered Phileas' trashed house
 *   17 complete
 * Varbit 6359 "shayzienquest_reward" (bit 6) is set on completion; varbit 6360
 * "shayzienquest_favour" (bit 7) is deliberately left alone (Kourend favour
 * was removed in 2024).
 *
 * Requirements (OSRS Wiki): Client of Kourend (asked through the shared
 * "quest:is-complete" event), 16 Strength and 10 Mining, both not boostable.
 *
 * Rewards (OSRS Wiki): 1 Quest Point, 8,000 coins, the "History and Hearsay"
 * page for Kharedst's memoirs, the Shayzien graceful recolour and the
 * Nightmare Zone Corrupt Lizardman unlock. The 3 Xerician fabric are the
 * Corrupt Lizardman's own 100% drop (npc-drop tables: "corrupt_lizardman"),
 * so they arrive with the kill.
 *
 * Gaps/approximations:
 * - The Tower of Magic prison puzzle (Strange Device 7598 and the four
 *   crystals 31957-31960, all dynamic spawns in this cache) is not simulated;
 *   the cell gates are not placed in this cache's maps, so the skeleton is
 *   reachable directly. The palace archive exit portal 31961 returns to the
 *   archive.
 * - The crevice/rope state is Jagex's own cave-mouth multi-loc 32502 driven by
 *   varbit 6358, so no object is registered; the rope is consumed when the
 *   attach message plays and the loc turns roped because the stage reaches 9.
 * - Phileas Rimor is not in npc-spawns.json, so he is a per-player owner-only
 *   spawn at his house that is removed once the house is trashed; the summit
 *   expedition NPCs and Lord Shiro are static spawns resolved through their
 *   cache transform parents (8191->8163, 8190->8023, 11148->11038,
 *   11151->11112), which is why the selectors key on the resolved ids.
 * - Searching the south-west skeleton gives the dusty note silently: the wiki
 *   has no search message and the note's transcript is not in npc-dialogues.
 * - The dump has no post-quest Phileas variant (he goes missing), so a
 *   completed player replays the last "another expedition" repeat variant.
 * - Killing the lizardman without inspecting the altar answers both Duffy
 *   conditions false, which closes that conversation empty (the wiki branches
 *   cover only "did not kill" and "inspected the altar").
 */
module.exports = function registerTaleOfTheRighteousQuest(api) {
  const {
    Item,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Tale of the Righteous";
  const START_HOOK = "quest:tale-of-the-righteous:start";

  const VARP_SHAYZIEN_QUEST = 1729; // "shayzienquest_main"
  const VARBIT_SHAYZIEN_QUEST = 6358; // "shayzienquest" bits 0-5
  const VARBIT_SHAYZIEN_REWARD = 6359; // "shayzienquest_reward" bit 6

  const STAGE_STARTED = 1;
  const STAGE_PRISON = 2;
  const STAGE_SKELETON_FOUND = 3;
  const STAGE_PHILEAS_REPORTED = 4;
  const STAGE_PERMISSION = 5;
  const STAGE_DUFFY_TOLD = 6;
  const STAGE_CREVICE_FOUND = 7;
  const STAGE_ROPE_ATTACHED = 9;
  const STAGE_LIZARD_KILLED = 10;
  const STAGE_ALTAR_INSPECTED = 11;
  const STAGE_DUFFY_RETURNED = 12;
  const STAGE_DUFFY_CAVE = 13;
  const STAGE_GNOSI_TOLD = 14;
  const STAGE_LORD_TOLD = 15;
  const STAGE_HOME_TRASHED = 16;
  const STAGE_COMPLETE = 17;

  // Durable stages 3-7 are internal labels, not the Quest Helper loadSteps keys.
  // Canonical varbit 6358 uses skeleton found=5, reported=6, permission=7,
  // Duffy told=8 and crevice found=8. Stage 9+ already matches the cache's
  // multi-loc transform indices (rope 9, summit hidden 12, furniture 15).
  const VARBIT_VALUE_BY_STAGE = new Map([
    [STAGE_SKELETON_FOUND, 5],
    [STAGE_PHILEAS_REPORTED, 6],
    [STAGE_PERMISSION, 7],
    [STAGE_DUFFY_TOLD, 8],
    [STAGE_CREVICE_FOUND, 8],
  ]);

  function stageVarbitValue(stage) {
    return VARBIT_VALUE_BY_STAGE.get(stage) ?? stage;
  }

  const STRENGTH_REQUIREMENT = 16;
  const MINING_REQUIREMENT = 10;

  const PHILEAS_NPC_IDS = new Set([
    NpcIdentifiers.PHILEAS_RIMOR, // 7999
    NpcIdentifiers.PHILEAS_RIMOR_2, // 10991
  ]);
  const PAGIDA_NPC_ID = NpcIdentifiers.PAGIDA; // 7608
  const ARCHEIO_NPC_ID = NpcIdentifiers.ARCHEIO; // 7614
  const ISTORIA_NPC_IDS = new Set([
    NpcIdentifiers.ISTORIA, // 11112 (11151 resolves here through varbit 12296)
    NpcIdentifiers.ISTORIA_2, // 11113
  ]);
  const DUFFY_NPC_IDS = new Set([
    NpcIdentifiers.HISTORIAN_DUFFY, // 8007, the cave spawn
    NpcIdentifiers.HISTORIAN_DUFFY_2, // 8163 (summit 8191 resolves here)
  ]);
  const GNOSI_NPC_IDS = new Set([
    NpcIdentifiers.GNOSI, // 8006, the cave spawn
    NpcIdentifiers.GNOSI_2, // 8023 (summit 8190 resolves here)
  ]);
  const LORD_SHIRO_NPC_IDS = new Set([
    NpcIdentifiers.LORD_SHIRO_SHAYZIEN, // 10963
    NpcIdentifiers.LORD_SHIRO_SHAYZIEN_2, // 10964
    NpcIdentifiers.LORD_SHIRO_SHAYZIEN_3, // 10965
    NpcIdentifiers.LORD_SHIRO_SHAYZIEN_4, // 11038 (the War Tent 11148 resolves here)
  ]);
  const CORRUPT_LIZARDMAN_NPC_ID = NpcIdentifiers.CORRUPT_LIZARDMAN_2; // 8000
  const MYSTERIOUS_VOICE_NPC_ID = NpcIdentifiers.MYSTERIOUS_VOICE; // 8022, narrator for the object transcripts

  const ROPE_ITEM_ID = ItemIdentifiers.ROPE; // 954
  const DUSTY_NOTE_ITEM_ID = ItemIdentifiers.DUSTY_NOTE; // 25706
  const HISTORY_AND_HEARSAY_ITEM_ID = ItemIdentifiers.HISTORY_AND_HEARSAY; // 21766
  const COINS_ITEM_ID = ItemIdentifiers.COINS; // 995

  // The cave mouth is a multi-loc (shayzienquest_cave, no identifier constant)
  // that resolves to the crevices by stage varbit 6358; item-on-object events
  // carry the spawned id, object events the resolved definition id.
  const CAVE_MOUTH_OBJECT_ID = 32502;
  const CREVICE_NOROPE_OBJECT_ID = ObjectIdentifiers.CREVICE_33; // 31965
  const CREVICE_ROPED_OBJECT_ID = ObjectIdentifiers.CREVICE_34; // 31966
  const CAVE_ROPE_OBJECT_ID = ObjectIdentifiers.ROPE_34; // 31967
  const SKELETON_CELL_OBJECT_ID = ObjectIdentifiers.SKELETON_80; // 31962, Investigate
  const SKELETON_SEARCH_OBJECT_ID = ObjectIdentifiers.SKELETON_94; // 41422, Search
  const MAGIC_GATE_OBJECT_ID = ObjectIdentifiers.MAGIC_GATE; // 32507
  const UNSTABLE_ALTAR_OBJECT_ID = ObjectIdentifiers.UNSTABLE_ALTAR; // 32508
  const PRISON_PORTAL_OBJECT_ID = ObjectIdentifiers.PORTAL_30; // 31961

  // Condition step ids on the "Tale of the Righteous" page.
  const NO_REQUIREMENTS_CONDITION_ID = "wEQnk0";
  const HAS_REQUIREMENTS_CONDITION_ID = "JlgSJ-";
  const NOT_KILLED_CONDITION_ID = "z8e6e8";
  const ALTAR_CONDITION_ID = "RnxTcK";
  // Message/action step ids.
  const SKELETON_WRITING_MESSAGE_ID = "oYSkWr";
  const ALTAR_VOICE_MESSAGE_ID = "7bxu8Q";
  const COMPLETE_ACTION_ID = "Iz9UXn";
  const ARCHEIO_TELEPORT_ACTION_ID = "CggcE8"; // "Transcript:Archeio" standard dialogue

  const PHILEAS_TILE = { x: 1542, y: 3571, z: 0 };
  const CREVICE_SURFACE_TILE = { x: 1213, y: 3560, z: 0 };
  const CAVE_LANDING_TILE = { x: 1168, y: 9972, z: 0 };
  const GATE_NORTH_TILE = { x: 1171, y: 9945, z: 0 };
  const LIZARD_TILE = { x: 1171, y: 9950, z: 0 };
  const PRISON_LANDING_TILE = { x: 1577, y: 10199, z: 0 };
  const ARCHIVE_LANDING_TILE = { x: 1552, y: 10221, z: 0 };

  // Phileas' lounge: the room the shayzienquest_* furniture stands in (walls at
  // x 1536/1548 and y 3566/3575 in the cache map).
  const PHILEAS_HOUSE_ZONE = { minX: 1538, maxX: 1547, minY: 3567, maxY: 3574, levels: [0] };
  const CAVE_ZONE = { minX: 1158, maxX: 1210, minY: 9920, maxY: 9985, levels: [0] };

  let quest;
  const phileasSpawns = new Map();
  const caveEncounters = new Map();
  /** Players who have just attached the rope and are being asked to enter. */
  const pendingCreviceEntry = new WeakSet();

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  function normText(value) {
    return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function moveTo(player, tile) {
    player.moveTo(new Location(tile.x, tile.y, tile.z ?? 0));
  }

  function tileOf(value) {
    if (!value) return null;
    return typeof value.getX === "function"
      ? { x: value.getX(), y: value.getY(), z: value.getZ() }
      : { x: value.x, y: value.y, z: value.z ?? 0 };
  }

  function inZone(zone, value) {
    const tile = tileOf(value);
    return Boolean(tile) && tile.x >= zone.minX && tile.x <= zone.maxX &&
      tile.y >= zone.minY && tile.y <= zone.maxY &&
      (!zone.levels || zone.levels.includes(tile.z));
  }

  function clientOfKourendComplete(player) {
    const request = { player, key: "client_of_kourend", complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsRequirements(player) {
    const skills = player.getSkillManager();
    if (skills.getMaxLevel(Skill.STRENGTH) < STRENGTH_REQUIREMENT) return false;
    if (skills.getMaxLevel(Skill.MINING) < MINING_REQUIREMENT) return false;
    return clientOfKourendComplete(player);
  }

  // ==========================================================================
  // Dialogue variants
  // ==========================================================================

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (PHILEAS_NPC_IDS.has(npcId)) {
      if (stage <= 0) return "getting-started-talking-to-phileas";
      if (stage === STAGE_STARTED) return "getting-started-talking-to-phileas-talking-to-phileas-again";
      if (stage === STAGE_SKELETON_FOUND) return "another-expedition-talking-to-phileas";
      // No post-quest variant exists: he is gone after stage 15, but a lingering
      // copy replays the last quest repeat rather than inventing words.
      return "another-expedition-talking-to-phileas-talking-to-phileas-again";
    }
    if (npcId === PAGIDA_NPC_ID) {
      if (stage >= STAGE_STARTED && stage < STAGE_COMPLETE) {
        return "perhaps-the-archives-are-incomplete-talking-to-pagida";
      }
      return null;
    }
    if (ISTORIA_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_STARTED && stage < STAGE_COMPLETE) {
        return "perhaps-the-archives-are-incomplete-talking-to-istoria";
      }
      return null;
    }
    if (DUFFY_NPC_IDS.has(npcId)) {
      if (stage === STAGE_PERMISSION) return "another-expedition-talking-to-historian-duffy";
      if (stage >= STAGE_DUFFY_TOLD && stage <= STAGE_ALTAR_INSPECTED) {
        return "another-expedition-returning-to-duffy";
      }
      if (stage >= STAGE_DUFFY_RETURNED && stage < STAGE_COMPLETE) {
        return "another-expedition-talking-to-duffy-in-the-cave";
      }
      if (stage >= STAGE_COMPLETE) return "after-completion-of-tale-of-the-righteous";
      return null;
    }
    if (GNOSI_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_DUFFY_CAVE && stage < STAGE_COMPLETE) {
        return "another-expedition-talking-to-gnosi";
      }
      if (stage >= STAGE_COMPLETE) return "after-completion-of-tale-of-the-righteous";
      return null;
    }
    if (LORD_SHIRO_NPC_IDS.has(npcId)) {
      if (stage <= STAGE_SKELETON_FOUND) return "standard-dialogue-prior-to-starting-tale-of-the-righteous";
      if (stage === STAGE_PHILEAS_REPORTED) return "another-expedition-talking-to-lord-shayzien";
      if (stage <= STAGE_DUFFY_CAVE) return "another-expedition-talking-to-lord-shayzien-talking-to-lord-shayzien-again";
      if (stage === STAGE_GNOSI_TOLD) return "finishing-up-reporting-to-lord-shayzien";
      if (stage === STAGE_LORD_TOLD) return "finishing-up-reporting-to-lord-shayzien-talking-to-lord-shayzien-again";
      if (stage === STAGE_HOME_TRASHED) return "finishing-up-returning-to-lord-shayzien";
      return null;
    }
    return null;
  }

  /** The wiki prose conditions, keyed off their step ids on the quest page. */
  function answerCondition({ player, stepId }) {
    switch (stepId) {
      case NO_REQUIREMENTS_CONDITION_ID:
        return !meetsRequirements(player);
      case HAS_REQUIREMENTS_CONDITION_ID:
        return meetsRequirements(player);
      case NOT_KILLED_CONDITION_ID:
        return quest.getStage(player) < STAGE_LIZARD_KILLED;
      case ALTAR_CONDITION_ID:
        return quest.getStage(player) >= STAGE_ALTAR_INSPECTED;
      default:
        return null;
    }
  }

  // ==========================================================================
  // Dialogue side effects
  // ==========================================================================

  function handleStartHook({ player, npcId, hook }) {
    if (hook !== START_HOOK || !PHILEAS_NPC_IDS.has(npcId)) return;
    if (quest.getStage(player) !== 0 || !meetsRequirements(player)) return;
    quest.setStage(player, STAGE_STARTED);
  }

  function handleDialogueLine(event) {
    const { player, npcId, text } = event;
    const stage = quest.getStage(player);
    if (PHILEAS_NPC_IDS.has(npcId)) {
      if (stage === STAGE_SKELETON_FOUND && text === "I guess I'll be on my way then.") {
        quest.setStage(player, STAGE_PHILEAS_REPORTED);
      }
      return;
    }
    if (LORD_SHIRO_NPC_IDS.has(npcId)) {
      if (stage === STAGE_PHILEAS_REPORTED && text === "Good luck citizen.") {
        quest.setStage(player, STAGE_PERMISSION);
      } else if (stage === STAGE_GNOSI_TOLD && text === "Eugh, so much walking. Fine, I'll go see Phileas.") {
        quest.setStage(player, STAGE_LORD_TOLD);
      }
      return;
    }
    if (DUFFY_NPC_IDS.has(npcId)) {
      if (stage === STAGE_PERMISSION && text === "Alright, I'll start there.") {
        quest.setStage(player, STAGE_DUFFY_TOLD);
      } else if (stage === STAGE_ALTAR_INSPECTED && text === "Well in that case, we'll go take a look.") {
        quest.setStage(player, STAGE_DUFFY_RETURNED);
      } else if (stage === STAGE_DUFFY_RETURNED && String(text).includes("I'd recommend you talk to Gnosi")) {
        quest.setStage(player, STAGE_DUFFY_CAVE);
      }
      return;
    }
    if (GNOSI_NPC_IDS.has(npcId)) {
      if (stage === STAGE_DUFFY_CAVE && text === "Will do, see you later.") {
        quest.setStage(player, STAGE_GNOSI_TOLD);
      }
    }
  }

  function handleAction(event) {
    const { player, stepId } = event;
    switch (stepId) {
      case SKELETON_WRITING_MESSAGE_ID: // message: the writing beside the skeleton
        if (quest.getStage(player) >= STAGE_STARTED && quest.getStage(player) < STAGE_SKELETON_FOUND) {
          quest.setStage(player, STAGE_SKELETON_FOUND);
        }
        return;
      case ALTAR_VOICE_MESSAGE_ID: // message: a strange voice
        if (quest.getStage(player) >= STAGE_LIZARD_KILLED && quest.getStage(player) < STAGE_ALTAR_INSPECTED) {
          quest.setStage(player, STAGE_ALTAR_INSPECTED);
        }
        return;
      case COMPLETE_ACTION_ID:
        event.handled = true;
        if (quest.getStage(player) >= STAGE_HOME_TRASHED && !quest.isComplete(player)) {
          quest.complete(player);
        }
        return;
      case ARCHEIO_TELEPORT_ACTION_ID: // the standard Archeio dialogue teleports visitors
        event.handled = true;
        moveTo(player, ARCHIVE_LANDING_TILE);
        return;
      default:
        return;
    }
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    const choice = normText(option);
    if (npcId === PAGIDA_NPC_ID && choice === "yesplease") {
      if (quest.getStage(player) >= STAGE_STARTED && !quest.isComplete(player)) {
        if (quest.getStage(player) < STAGE_PRISON) quest.setStage(player, STAGE_PRISON);
        moveTo(player, PRISON_LANDING_TILE);
      }
      return;
    }
    if (pendingCreviceEntry.has(player)) {
      if (npcId !== MYSTERIOUS_VOICE_NPC_ID) return;
      pendingCreviceEntry.delete(player);
      if (choice === "yes") enterCave(player);
    }
  }

  // ==========================================================================
  // Quidamortem Cave
  // ==========================================================================

  function enterCave(player) {
    if (quest.getStage(player) < STAGE_ROPE_ATTACHED || quest.isComplete(player)) return;
    moveTo(player, CAVE_LANDING_TILE);
    ensureCaveNpcs(player);
  }

  function ensureCaveNpcs(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    const stage = quest.getStage(player);
    const active = stage >= STAGE_ROPE_ATTACHED && stage < STAGE_LIZARD_KILLED;
    if (!active) {
      clearCaveNpcs(player);
      return;
    }
    if (caveEncounters.get(player)?.lizard) return;
    const lizard = api.spawnNpc({
      id: CORRUPT_LIZARDMAN_NPC_ID,
      x: LIZARD_TILE.x,
      y: LIZARD_TILE.y,
      z: LIZARD_TILE.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    caveEncounters.set(player, { lizard });
  }

  function clearCaveNpcs(player) {
    const tracked = caveEncounters.get(player);
    if (!tracked) return;
    if (tracked.lizard) api.removeNpc(tracked.lizard);
    caveEncounters.delete(player);
  }

  function handleNpcDeath(event) {
    if (event.npcId !== CORRUPT_LIZARDMAN_NPC_ID) return;
    const owner = event.killer?.isPlayer?.() ? event.killer : null;
    if (!owner) return;
    const tracked = caveEncounters.get(owner);
    if (!tracked || tracked.lizard !== event.npc) return;
    tracked.lizard = null;
    const stage = quest.getStage(owner);
    if (stage >= STAGE_ROPE_ATTACHED && stage < STAGE_LIZARD_KILLED) {
      quest.setStage(owner, STAGE_LIZARD_KILLED);
    }
  }

  /** The generic Ladders plugin owns objects named "Rope"; claim the cave rope. */
  function claimCaveRopeClimb(request) {
    if (request.objectId !== CAVE_ROPE_OBJECT_ID) return;
    request.handled = true;
    moveTo(request.player, CREVICE_SURFACE_TILE);
    clearCaveNpcs(request.player);
  }

  function handleCaveZoneEnter({ player }) {
    ensureCaveNpcs(player);
  }

  function handleCaveZoneExit({ player }) {
    clearCaveNpcs(player);
  }

  // ==========================================================================
  // Phileas and his house
  // ==========================================================================

  function ensurePhileas(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    if (quest.getStage(player) >= STAGE_LORD_TOLD) {
      removePhileas(player);
      return;
    }
    if (phileasSpawns.has(player)) return;
    const npc = api.spawnNpc({
      id: NpcIdentifiers.PHILEAS_RIMOR,
      x: PHILEAS_TILE.x,
      y: PHILEAS_TILE.y,
      z: PHILEAS_TILE.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) phileasSpawns.set(player, npc);
  }

  function removePhileas(player) {
    const npc = phileasSpawns.get(player);
    if (!npc) return;
    api.removeNpc(npc);
    phileasSpawns.delete(player);
  }

  function handleHouseZoneEnter({ player }) {
    if (quest.getStage(player) !== STAGE_LORD_TOLD) return;
    removePhileas(player);
    quest.setStage(player, STAGE_HOME_TRASHED);
    startTranscript(api, player, MYSTERIOUS_VOICE_NPC_ID, PAGE, "finishing-up-entering-phileas-home");
  }

  // ==========================================================================
  // Objects
  // ==========================================================================

  function handleObjectInteraction(event) {
    const { player } = event;
    const locId = event.definition?.id ?? event.objectId;
    switch (locId) {
      case CREVICE_NOROPE_OBJECT_ID: {
        const stage = quest.getStage(player);
        if (stage < STAGE_DUFFY_TOLD || quest.isComplete(player)) return;
        event.handled = true;
        if (stage === STAGE_DUFFY_TOLD) quest.setStage(player, STAGE_CREVICE_FOUND);
        startTranscript(api, player, MYSTERIOUS_VOICE_NPC_ID, PAGE, "another-expedition-investigating-the-crevice");
        return;
      }
      case CREVICE_ROPED_OBJECT_ID:
        if (quest.getStage(player) < STAGE_ROPE_ATTACHED || quest.isComplete(player)) return;
        event.handled = true;
        enterCave(player);
        return;
      case SKELETON_CELL_OBJECT_ID:
        if (quest.getStage(player) < STAGE_STARTED || quest.isComplete(player)) return;
        event.handled = true;
        startTranscript(api, player, MYSTERIOUS_VOICE_NPC_ID, PAGE, "perhaps-the-archives-are-incomplete-investigating-the-skeleton");
        return;
      case SKELETON_SEARCH_OBJECT_ID: {
        if (quest.getStage(player) < STAGE_STARTED || quest.isComplete(player)) return;
        event.handled = true;
        if (!held(player, DUSTY_NOTE_ITEM_ID)) {
          const inventory = player.getInventory();
          if (inventory.isFull()) inventory.full();
          else inventory.adds(DUSTY_NOTE_ITEM_ID, 1);
        }
        return;
      }
      case UNSTABLE_ALTAR_OBJECT_ID:
        if (quest.getStage(player) < STAGE_LIZARD_KILLED || quest.isComplete(player)) return;
        event.handled = true;
        startTranscript(api, player, MYSTERIOUS_VOICE_NPC_ID, PAGE, "another-expedition-inspecting-the-unstable-altar");
        return;
      case MAGIC_GATE_OBJECT_ID:
        event.handled = true;
        if (quest.getStage(player) >= STAGE_LIZARD_KILLED) moveTo(player, GATE_NORTH_TILE);
        else ensureCaveNpcs(player);
        return;
      case CAVE_ROPE_OBJECT_ID:
        event.handled = true;
        moveTo(player, CREVICE_SURFACE_TILE);
        clearCaveNpcs(player);
        return;
      case PRISON_PORTAL_OBJECT_ID:
        event.handled = true;
        moveTo(player, ARCHIVE_LANDING_TILE);
        return;
      default:
        return;
    }
  }

  /** Rope onto the multi-loc cave mouth (which resolves to the unroped crevice). */
  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (itemId !== ROPE_ITEM_ID || objectId !== CAVE_MOUTH_OBJECT_ID) return;
    event.handled = true;
    const stage = quest.getStage(player);
    if (stage < STAGE_DUFFY_TOLD || stage >= STAGE_ROPE_ATTACHED || quest.isComplete(player)) return;
    player.getInventory().deleteNumber(ROPE_ITEM_ID, 1);
    quest.setStage(player, STAGE_ROPE_ATTACHED);
    pendingCreviceEntry.add(player);
    startTranscript(api, player, MYSTERIOUS_VOICE_NPC_ID, PAGE, "another-expedition-using-a-rope-on-the-crevice");
  }

  /** The standard Archeio dialogue's "Teleport" option is a second way in. */
  function handleArcheioTeleportOption(event) {
    moveTo(event.player, ARCHIVE_LANDING_TILE);
  }

  // ==========================================================================
  // Journal and reward
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Phileas Rimor asked me to find out what happened to the</str>",
        "<str>expedition his ancestor led to Mount Quidamortem.</str>",
        "<str>I retraced the expedition's route and found an ancient temple</str>",
        "<str>beneath the mountain, but Phileas has since vanished.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_STARTED) {
      const lines = [
        "<str>Phileas Rimor asked me to find out what happened to the</str>",
        "<str>expedition his ancestor led to Mount Quidamortem.</str>",
      ];
      if (stage >= STAGE_SKELETON_FOUND) {
        lines.push(
          "<str>In the Tower of Magic prison I found writing warning of</str>",
          "<str>lizards on the mountain and not to trust the King.</str>"
        );
      }
      if (stage >= STAGE_PHILEAS_REPORTED) {
        lines.push("<str>Phileas sent me to get Lord Shayzien's permission to investigate.</str>");
      }
      if (stage >= STAGE_DUFFY_TOLD) {
        lines.push(
          "<str>Lord Shayzien approved my research. Historian Duffy told me</str>",
          "<str>about a crevice on the western face of the mountain.</str>"
        );
      }
      if (stage >= STAGE_LIZARD_KILLED) {
        lines.push("<str>I entered the cave and killed the corrupt lizardman guarding it.</str>");
      }
      if (stage >= STAGE_ALTAR_INSPECTED) {
        lines.push(
          "<str>I found an unstable altar that gives off the same power as the</str>",
          "<str>Dark Altar.</str>"
        );
      }
      if (stage >= STAGE_DUFFY_CAVE) {
        lines.push("<str>Duffy and Gnosi travelled into the cave to study the altar.</str>");
      }
      if (stage >= STAGE_GNOSI_TOLD) {
        lines.push("<str>Gnosi believes the altar let Xeric live far beyond a normal life.</str>");
      }
      if (stage >= STAGE_LORD_TOLD) {
        lines.push("", "I should search <col=800000>Phileas' house</col> for the parcel.");
      }
      if (stage >= STAGE_HOME_TRASHED) {
        lines.push("", "Phileas is missing and his house has been trashed. I should tell <col=800000>Lord Shayzien</col>.");
      }
      return lines;
    }
    return [
      "I can start this quest by speaking to <col=800000>Phileas Rimor</col>",
      "in his house in <col=800000>Shayzien</col>.",
      "",
      "I must have completed <col=800000>Client of Kourend</col>, and have",
      "<col=800000>16 Strength</col> and <col=800000>10 Mining</col>.",
    ];
  }

  function sendRewardVarbit(player) {
    if (quest?.isComplete(player)) player.getPacketSender().sendVarbit(VARBIT_SHAYZIEN_REWARD, 1);
  }

  function grantReward(player) {
    const inventory = player.getInventory();
    if (inventory.isFull()) inventory.forceAdd(player, new Item(COINS_ITEM_ID, 8000));
    else inventory.adds(COINS_ITEM_ID, 8000);
    sendRewardVarbit(player);
  }

  function handleLogin({ player }) {
    ensurePhileas(player);
    if (inZone(CAVE_ZONE, player.getLocation())) ensureCaveNpcs(player);
    sendRewardVarbit(player);
    refreshQuestList(player);
  }

  function handleBootstrapComplete({ player }) {
    sendRewardVarbit(player);
  }

  function handleLogout({ player }) {
    pendingCreviceEntry.delete(player);
    removePhileas(player);
    clearCaveNpcs(player);
  }

  quest = registerQuest(api, {
    key: "tale_of_the_righteous",
    name: "Tale of the Righteous",
    varpId: VARP_SHAYZIEN_QUEST,
    varbitId: VARBIT_SHAYZIEN_QUEST,
    varbitValue: stageVarbitValue,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [],
    rewardItemId: HISTORY_AND_HEARSAY_ITEM_ID,
    rewardItemLabel: "History and Hearsay (Kharedst's memoirs page)",
    otherRewards: ["8,000 Coins", "Shayzien graceful outfit recolour", "Nightmare Zone: Corrupt Lizardman"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("ladders:climb", claimCaveRopeClimb);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject);
  api.onNpcClick([ARCHEIO_NPC_ID], 3, handleArcheioTeleportOption);
  api.onNpcDeath(handleNpcDeath);
  api.onZoneEnter(PHILEAS_HOUSE_ZONE, handleHouseZoneEnter);
  api.onZoneEnter(CAVE_ZONE, handleCaveZoneEnter);
  api.onZoneExit(CAVE_ZONE, handleCaveZoneExit);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrapComplete);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
