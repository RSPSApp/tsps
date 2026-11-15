/**
 * Temple of Ikov (members).
 *
 * The words come from the "Temple of Ikov" transcript page; this plugin supplies
 * the variant selector for Lucien, Winelda and the Guardians of Armadyl (all
 * indexed), the start hook, the prose-condition answers, the limpwurt-root
 * teleport, the Fire Warrior kill and the staff hand-in that completes the
 * quest.
 *
 * Stages (varp 26): 10 started, 50 crossed the lava, 60 killed the Fire Warrior,
 * 70 carrying the Staff of Armadyl, 80 complete.
 *
 * The world's Lucien spawns (3443/3444) are transform placeholders with no
 * options in this cache, so each quester gets a private working Lucien: 13608
 * (Talk-to only) at the Flying Horse Inn and 13607 (level 14, Talk-to/Attack)
 * at his house. Both are removed on completion/logout. The Fire Warrior (3448)
 * is spawned when his door is opened; Winelda's teleports cross the lava; the
 * push-wall and ice-arrow chest are wired. The staff and the Armadyl pendant
 * live on no map object in this cache, so the plugin grants them on the
 * transcript actions that hand them over.
 *
 * The player's side (varp-less attribute) drives the Guardians: agreeing to help
 * them sets "guardians" and hands over the Armadyl pendant; taking Lucien's
 * side in the dialogue sets "lucien" and unlocks taking the staff.
 */
module.exports = function registerTempleOfIkovQuest(api) {
  const { Item, Skill, ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");
  const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");
  ObstacleRunner.init(api);

  const LUCIEN_NPC_IDS = new Set([
    NpcIdentifiers.LUCIEN,
    NpcIdentifiers.LUCIEN_2,
    NpcIdentifiers.LUCIEN_3,
    NpcIdentifiers.LUCIEN_4,
    NpcIdentifiers.LUCIEN_5,
    NpcIdentifiers.LUCIEN_6,
    3443,
    3444,
  ]);
  /** 13608 has Talk-to only (the inn informant); 13607 is the level-14 fight. */
  const INN_LUCIEN_NPC_ID = NpcIdentifiers.LUCIEN_5;
  const HOUSE_LUCIEN_NPC_ID = NpcIdentifiers.LUCIEN_4;
  const WINELDA_NPC_ID = NpcIdentifiers.WINELDA;
  const GUARDIAN_NPC_IDS = new Set([
    NpcIdentifiers.GUARDIAN_OF_ARMADYL,
    NpcIdentifiers.GUARDIAN_OF_ARMADYL_2,
  ]);
  const FIRE_WARRIOR_NPC_ID = NpcIdentifiers.FIRE_WARRIOR_OF_LESARKUS;

  const VARP_TEMPLE_OF_IKOV = 26;
  const STAGE_STARTED = 10;
  const STAGE_CROSSED_LAVA = 50;
  const STAGE_FIRE_WARRIOR_KILLED = 60;
  const STAGE_HAS_STAFF = 70;
  const STAGE_COMPLETE = 80;

  const PENDANT_OF_LUCIEN_ITEM_ID = ItemIdentifiers.PENDANT_OF_LUCIEN;
  const ARMADYL_PENDANT_ITEM_ID = ItemIdentifiers.ARMADYL_PENDANT;
  const STAFF_OF_ARMADYL_ITEM_ID = ItemIdentifiers.STAFF_OF_ARMADYL;
  const ICE_ARROWS_ITEM_ID = ItemIdentifiers.ICE_ARROWS;
  const LIMPWURT_ROOT_ITEM_ID = ItemIdentifiers.LIMPWURT_ROOT;
  const LIMPWURT_REQUIRED = 20;

  // World tiles (cache placements): Lucien placeholders, the fire-warrior door,
  // the wall north of the skeletons and the Temple of Ikov ice chest.
  // Wiki: the start is the Flying Horse Inn in East Ardougne (the disguised 3444's placement);
  // his house, where he is fought or given the staff, is between Edgeville and the GE (3443's).
  const INN_LUCIEN_TILE = { x: 2573, y: 3321, z: 0 };
  const HOUSE_LUCIEN_TILE = { x: 3122, y: 3483, z: 0 };
  const BOOTS_STAIRS_DOWN_ID = 98;
  const BOOTS_STAIRS_DOWN_TILE = { x: 2650, y: 9804, z: 0 };
  const FIRE_WARRIOR_DOOR_ID = 93;
  const FIRE_WARRIOR_DOOR_TILE = { x: 2646, y: 9870, z: 0 };
  /** The cache placement: a straight wall piece (shape 0) facing rotation 1. */
  const FIRE_WARRIOR_DOOR_TYPE = 0;
  const FIRE_WARRIOR_DOOR_FACE = 1;
  const FIRE_WARRIOR_TILE = { x: 2646, y: 9867, z: 0 };
  const PUSH_WALL_ID = 1597;
  const PUSH_WALL_TILE = { x: 2643, y: 9892, z: 0 };
  // Revision-242 cache gamevals ikov_leverbracket / ikov_mendedlever / ikov_leverdown.
  const LEVER_BRACKET_ID = api.core.ObjectIdentifiers.LEVER_BRACKET;
  const FITTED_LEVER_ID = api.core.ObjectIdentifiers.LEVER_5;
  const LOWERED_LEVER_ID = 88;
  const LEVER_BRACKET_TILE = { x: 2671, y: 9804, z: 0 };
  // Rsprox rev 242 recording 912156: ikov_leverdown at t539, then at t543 a mesbox with this text.
  const LEVER_PULL_TEXT = "You hear the clunking of some hidden machinery.";
  const LEVER_PULL_TEXT_DELAY = 4;
  const ICE_GATE_IDS = new Set([api.core.ObjectIdentifiers.GATE_10, api.core.ObjectIdentifiers.GATE_11]);
  const ICE_GATE_UNLOCKED_ATTRIBUTE = "temple-of-ikov:ice-gate-unlocked";
  const TRAPPED_LEVER_ID = api.core.ObjectIdentifiers.LEVER_6;
  const TRAPPED_LEVER_TILE = { x: 2665, y: 9855, z: 0 };
  const TRAP_DOOR_ID = api.core.ObjectIdentifiers.DOOR_10;
  const TRAP_DOOR_TILE = { x: 2648, y: 9857, z: 0 };
  const TRAP_PIT_LADDER_ID = api.core.ObjectIdentifiers.LADDER_4;
  const TRAP_PIT_LADDER_TILE = { x: 2682, y: 9849, z: 0 };
  const TRAP_EXIT_ID = api.core.ObjectIdentifiers.TRAPDOOR;
  const TRAP_EXIT_TILE = { x: 2665, y: 9849, z: 0 };
  const TRAP_DISARM_LEVEL = 42;
  const TRAP_DAMAGE = 20;
  const TRAP_DISARMED_ATTRIBUTE = "temple-of-ikov:trap-disarmed";
  const TRAP_DOOR_UNLOCKED_ATTRIBUTE = "temple-of-ikov:trap-door-unlocked";
  const ICE_CHEST_CLOSED_ID = 103;
  const ICE_CHEST_OPEN_ID = 104;
  const ICE_CHEST_OPEN_TICKS = 300;
  const ICE_ARROWS_FOUND_SOUND = 1628;
  const CHEST_OPEN_SOUND = 52; // chest_open
  /** rsprox_transcripts/242/912156.txt ticks 796-797, 828-829: human_openchest and chest_open, the open loc a tick on. */
  const ICE_CHEST_OPEN_DELAY_TICKS = 1;
  const ICE_CHEST_TILES = [
    [2710, 9850], [2719, 9838], [2729, 9850], [2747, 9848], [2738, 9835], [2745, 9821],
  ];
  /** West side of the lava, in the skeleton corridor, per Winelda's teleport. */
  const WINELDA_LANDING_TILE = { x: 2644, y: 9890, z: 0 };
  const BRIDGE_WALL_ID = 3550;
  const BRIDGE_ROWS = new Set([9828, 9829]);
  // Attributed maintainer requirement 5911243892, not independently decoded parity.
  const BRIDGE_CROSSING_ROW = 9828;
  const BRIDGE_ORIGIN_ATTRIBUTE = "temple-of-ikov:bridge-origin";
  const BRIDGE_WEST_EDGE = 2648, BRIDGE_EAST_EDGE = 2650;
  const BRIDGE_WEST_BANK = 2647, BRIDGE_EAST_BANK = 2651;
  // Existing runner ownership key; this quest does not create another lock.
  const OBSTACLE_ATTRIBUTE = "agility.obstacle";
  const bridgeApproaches = new WeakMap(), bridgePassages = new WeakMap(), bridgeOrigins = new WeakMap();


  const START_HOOK = "quest:temple-of-ikov:start";
  /** Winelda's root hand-in (UB9hSI) and her repeat teleport (7xhwuW). */
  const WINELDA_ROOT_TELEPORT_STEP_ID = "UB9hSI";
  const WINELDA_REPEAT_TELEPORT_STEP_ID = "7xhwuW";
  /** The Fire Warrior's fire bolt knocks the player back from the door. */
  const FIRE_WARRIOR_KNOCKBACK_STEP_ID = "i4DijU";
  /** The guardian attacks when Lucien's follower takes the staff. */
  const TAKE_STAFF_ACTION_ID = "zJVI_k";
  /** Lucien's two quest-complete endings. */
  const COMPLETE_ACTION_IDS = new Set(["f8loKo", "rgR_39"]);
  /** Guardian "attacks the player" stage directions: the player backed Lucien. */
  const LUCIEN_LOYALTY_STEP_IDS = new Set(["Z00rUz", "GUJaTp", "yPcDYb", "yW7QWI", "KcVBoC"]);
  const ARMADYL_PENDANT_LINE = "You will need this pendant to attack him.";

  const SIDE_ATTRIBUTE = "quest.temple_of_ikov.side";
  const SIDE_NONE = 0;
  const SIDE_GUARDIANS = 1;
  const SIDE_LUCIEN = 2;

  let quest;
  /** Private owner-only NPCs, one set per player, never world-visible. */
  const lucienSpawnsByPlayer = new WeakMap();
  const fireWarriorByPlayer = new WeakMap();
  const fireWarriorScenes = new WeakMap();
  const announcedFireWarriors = new WeakSet();
  const FIRE_WARRIOR_DEFEATED_ATTRIBUTE = "temple-of-ikov:fire-warrior-defeated";
  // Bounded local-actor acquisition, not a captured encounter delay.
  const FIRE_WARRIOR_LOCAL_WAIT_TICKS = 8;
  const iceChestsByPlayer = new WeakMap();
  const bracketByPlayer = new WeakMap();
  const trapTasksByPlayer = new WeakMap();
  const LUCIEN_PRIVATE_NPC_IDS = new Set([INN_LUCIEN_NPC_ID, HOUSE_LUCIEN_NPC_ID]);
  const FIRE_WARRIOR_PRIVATE_NPC_IDS = new Set([FIRE_WARRIOR_NPC_ID]);

  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;
  const limpwurtCount = (player) => player.getInventory().getAmount(LIMPWURT_ROOT_ITEM_ID);
  const thievingLevel = (player) => player.getSkillManager().getCurrentLevel(Skill.THIEVING);
  const sideOf = (player) => Number(player.getAttribute(SIDE_ATTRIBUTE)) || SIDE_NONE;
  const wearingArmadylPendant = (player) =>
    (player.getEquipment().getItems() || []).some(
      (item) => item && item.getId?.() === ARMADYL_PENDANT_ITEM_ID
    );

  function sameTile(location, tile) {
    return (
      Boolean(location) &&
      location.x === tile.x &&
      location.y === tile.y &&
      (location.z ?? 0) === tile.z
    );
  }

  function constructLocation(tile) {
    return new api.core.Location(tile.x, tile.y, tile.z);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I recovered the Staff of Armadyl.</str>",
        "<str>I decided the fate of Lucien and the guardians.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_HAS_STAFF) {
      if (sideOf(player) === SIDE_GUARDIANS) {
        return [
          "I refused to steal the Staff of Armadyl.",
          "I must defeat <col=800000>Lucien</col> while wearing the",
          "Armadyl pendant.",
        ];
      }
      return [
        "I found the Guardians of Armadyl.",
        "I must decide who receives the <col=800000>Staff of Armadyl</col>.",
      ];
    }
    if (stage >= STAGE_FIRE_WARRIOR_KILLED
      || (player.getAttribute(FIRE_WARRIOR_DEFEATED_ATTRIBUTE) === 1 && stage >= STAGE_CROSSED_LAVA)) {
      return [
        "I defeated the Fire Warrior of Lesarkus.",
        "I should search the Temple of Ikov for the guardians.",
      ];
    }
    if (stage >= STAGE_STARTED && player.getAttribute(FIRE_WARRIOR_DEFEATED_ATTRIBUTE) === 1) {
      return ["I defeated the Fire Warrior of Lesarkus.",
        "I need <col=800000>20 limpwurt roots</col> and must find Winelda."];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Lucien gave me his pendant.",
        "I need <col=800000>20 limpwurt roots</col> and must find Winelda.",
      ];
    }
    return [
      "I can start this quest by speaking to <col=800000>Lucien</col>",
      "at the Flying Horse Inn in East Ardougne.",
      "It requires 42 Thieving.",
    ];
  }

  function grantReward(player, questHandle, options = {}) {
    removeSpawns(player);
    if (options.experience === false) return;
    player.getSkillManager().addExperiences(Skill.RANGED, 10500);
    player.getSkillManager().addExperiences(Skill.FLETCHING, 8000);
  }

  /** Which transcript variant each speaker plays, by quest stage and side. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (LUCIEN_NPC_IDS.has(npcId)) {
      if (npcId === HOUSE_LUCIEN_NPC_ID || npcId === 3444) {
        return stage >= STAGE_HAS_STAFF
          ? "finishing-up-talking-to-lucien-near-varrock"
          : "starting-out-talking-to-lucien-again";
      }
      if (stage === 0) return "starting-out-talking-to-lucien";
      if (stage < STAGE_COMPLETE) return "starting-out-talking-to-lucien-again";
      return "finishing-up-talking-to-lucien-near-varrock";
    }
    if (npcId === WINELDA_NPC_ID) {
      if (stage < STAGE_STARTED) return "inside-the-dungeon-talking-to-winelda";
      if (stage < STAGE_CROSSED_LAVA) return "inside-the-dungeon-talking-to-winelda-again";
      return "inside-the-dungeon-talking-to-winelda-after-giving-the-limpwurts";
    }
    if (GUARDIAN_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_HAS_STAFF) {
        return "inside-the-dungeon-talking-to-a-guardian-of-armadyl-while-carrying-the-staff-of-armadyl";
      }
      const side = sideOf(player);
      if (side === SIDE_GUARDIANS) {
        return "inside-the-dungeon-talking-to-the-guardian-of-armadyl-after-agreeing-to-kill-lucien";
      }
      if (side === SIDE_LUCIEN) {
        return "inside-the-dungeon-taking-the-staff-of-armadyl-while-helping-lucien";
      }
      return "inside-the-dungeon-talking-to-a-guardian-of-armadyl-while-not-wearing-the-pendant-of-lucien";
    }
    if (npcId === FIRE_WARRIOR_NPC_ID) {
      return "inside-the-dungeon-talking-to-the-fire-warrior-of-lesarkus";
    }
    return null;
  }

  /** Answer the page's prose conditions. */
  function answerCondition({ player, npcId, text }) {
    if (!LUCIEN_NPC_IDS.has(npcId) && !GUARDIAN_NPC_IDS.has(npcId) && npcId !== WINELDA_NPC_ID && npcId !== FIRE_WARRIOR_NPC_ID) return null;
    const value = String(text).toLowerCase();
    if (value.includes("inventory is full")) return false;
    if (value.includes("lost the pendant")) return !held(player, PENDANT_OF_LUCIEN_ITEM_ID);
    if (value.includes("still has the pendant")) return held(player, PENDANT_OF_LUCIEN_ITEM_ID);
    if (value.includes("with 42 thieving")) return thievingLevel(player) >= 42;
    if (value.includes("without 42 thieving")) return thievingLevel(player) < 42;
    if (value.includes("chest has arrows")) return false;
    if (value.includes("chest is empty")) return true;
    if (value.includes("no limpwurt roots")) return limpwurtCount(player) === 0;
    if (value.includes("1-19 limpwurt roots")) {
      const count = limpwurtCount(player);
      return count >= 1 && count <= 19;
    }
    if (value.includes("20 limpwurt roots")) return limpwurtCount(player) >= LIMPWURT_REQUIRED;
    if (value.includes("lost the armadyl pendant")) return !held(player, ARMADYL_PENDANT_ITEM_ID);
    if (value.includes("still has the armadyl pendant")) return held(player, ARMADYL_PENDANT_ITEM_ID);
    if (value.includes("does not have the staff")) return !held(player, STAFF_OF_ARMADYL_ITEM_ID);
    if (value.includes("has the staff")) return held(player, STAFF_OF_ARMADYL_ITEM_ID);
    return null;
  }

  // ==========================================================================
  // Private Lucien / Fire Warrior spawns
  // ==========================================================================

  function spawnPrivateNpc(player, id, tile) {
    const npc = api.spawnNpc({
      id,
      x: tile.x,
      y: tile.y,
      z: tile.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    // Without this the death task queues the definition's own respawn.
    if (npc) npc.__skipDefaultRespawn = true;
    return npc;
  }

  /**
   * A missed logout leaves a player's private NPCs in the world while the WeakMap
   * forgets them (it is keyed by the discarded player object). Clear any leftover
   * owner NPCs for this player before spawning a fresh set, so logins cannot pile
   * copies on one tile. Ownership is matched by object first, then by username for
   * spawns from an earlier session of the same account.
   */
  function removeStalePrivateSpawns(player, ids) {
    const stale = [];
    api.core.World.getNpcs().forEach((npc) => {
      if (!ids.has(npc.getId()) || !npc.isOwnerOnly?.()) return;
      const owner = npc.getOwner?.();
      if (owner === player || (owner != null && owner.getUsername?.() === player.getUsername())) {
        stale.push(npc);
      }
    });
    for (const npc of stale) api.removeNpc(npc);
  }

  /**
   * The inn Lucien exists from login while the quest is open; his house double
   * (the attackable one) exists once the quest has started.
   */
  function ensureLucien(player) {
    if (quest.isComplete(player)) {
      removeLucien(player);
      return;
    }
    let entry = lucienSpawnsByPlayer.get(player);
    if (!entry) {
      removeStalePrivateSpawns(player, LUCIEN_PRIVATE_NPC_IDS);
      entry = { inn: null, house: null };
      lucienSpawnsByPlayer.set(player, entry);
    }
    if (!entry.inn) entry.inn = spawnPrivateNpc(player, INN_LUCIEN_NPC_ID, INN_LUCIEN_TILE);
    if (quest.getStage(player) >= STAGE_STARTED && !entry.house) {
      entry.house = spawnPrivateNpc(player, HOUSE_LUCIEN_NPC_ID, HOUSE_LUCIEN_TILE);
    }
  }

  function removeLucien(player) {
    const entry = lucienSpawnsByPlayer.get(player);
    if (!entry) return;
    lucienSpawnsByPlayer.delete(player);
    if (entry.inn) api.removeNpc(entry.inn);
    if (entry.house) api.removeNpc(entry.house);
  }

  function defeatedFireWarrior(player) {
    return player.getAttribute(FIRE_WARRIOR_DEFEATED_ATTRIBUTE) === 1
      || quest.getStage(player) >= STAGE_FIRE_WARRIOR_KILLED || quest.isComplete(player);
  }

  function ensureFireWarrior(player) {
    if (defeatedFireWarrior(player)) return null;
    const existing = fireWarriorByPlayer.get(player);
    if (existing) return existing;
    removeStalePrivateSpawns(player, FIRE_WARRIOR_PRIVATE_NPC_IDS);
    const npc = spawnPrivateNpc(player, FIRE_WARRIOR_NPC_ID, FIRE_WARRIOR_TILE);
    if (npc) fireWarriorByPlayer.set(player, npc);
    return npc;
  }

  function removeFireWarrior(player) {
    const scene = fireWarriorScenes.get(player);
    scene?.task?.stop();
    scene?.cancel?.();
    fireWarriorScenes.delete(player);
    const npc = fireWarriorByPlayer.get(player);
    if (!npc) return;
    fireWarriorByPlayer.delete(player);
    api.removeNpc(npc);
  }

  function removeSpawns(player) {
    removeLucien(player);
    removeFireWarrior(player);
  }

  // ==========================================================================
  // Dialogue hooks
  // ==========================================================================

  /** Wiki: 42 Thieving and 40 Ranged. */
  const REQUIRED_SKILLS = [
    { skill: Skill.THIEVING, level: 42, label: "Thieving" },
    { skill: Skill.RANGED, level: 40, label: "Ranged" },
  ];

  function missingSkillRequirements(player) {
    const skills = player.getSkillManager();
    return REQUIRED_SKILLS.filter((requirement) => skills.getMaxLevel(requirement.skill) < requirement.level);
  }

  function notifySkillRequirements(player) {
    for (const requirement of missingSkillRequirements(player)) {
      player.sendMessage(
        `You need a ${requirement.label} level of at least ${requirement.level} to start this quest.`
      );
    }
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!LUCIEN_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) {
      if (missingSkillRequirements(player).length > 0) {
        notifySkillRequirements(player);
        return;
      }
      quest.setStage(player, STAGE_STARTED);
      if (!held(player, PENDANT_OF_LUCIEN_ITEM_ID)) {
        player.getInventory().adds(PENDANT_OF_LUCIEN_ITEM_ID, 1);
      }
      ensureLucien(player);
    }
  }

  /** Agreeing to help the Guardians hands over the Armadyl pendant (9p_LQ7). */
  function handleDialogueLine(event) {
    if (event.npcId === FIRE_WARRIOR_NPC_ID && event.step?.presentation === "overhead"
      && event.pages?.some(page => page.page === PAGE
        && page.variants?.includes("inside-the-dungeon-opening-door-in-the-fire-warrior-room"))) {
      const scene = fireWarriorScenes.get(event.player);
      event.actors = scene && scene.npc === event.npc && currentFireWarriorScene(event.player, scene)
        ? [scene.npc] : [];
      event.before = () => {
        if (scene && !currentFireWarriorScene(event.player, scene)) finishFireWarriorScene(event.player, scene);
      };
      return;
    }
    if (!GUARDIAN_NPC_IDS.has(event.npcId)) return;
    if (String(event.text ?? "").includes(ARMADYL_PENDANT_LINE)) {
      const { player } = event;
      if (quest.getStage(player) < STAGE_STARTED) return;
      player.setAttribute(SIDE_ATTRIBUTE, SIDE_GUARDIANS);
      if (!held(player, ARMADYL_PENDANT_ITEM_ID)) {
        player.getInventory().adds(ARMADYL_PENDANT_ITEM_ID, 1);
        player.sendMessage("The guardian hands you an Armadyl pendant.");
      }
    }
  }

  function takeLimpwurts(player) {
    let remaining = LIMPWURT_REQUIRED;
    while (remaining > 0 && player.getInventory().getAmount(LIMPWURT_ROOT_ITEM_ID) > 0) {
      player.getInventory().deleteNumber(LIMPWURT_ROOT_ITEM_ID, 1);
      remaining--;
    }
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (npcId === WINELDA_NPC_ID) {
      if (stepId === WINELDA_ROOT_TELEPORT_STEP_ID) {
        if (quest.getStage(player) < STAGE_STARTED || quest.isComplete(player)) return;
        if (quest.getStage(player) >= STAGE_CROSSED_LAVA) return;
        if (limpwurtCount(player) < LIMPWURT_REQUIRED) return;
        takeLimpwurts(player);
        quest.setStage(player, STAGE_CROSSED_LAVA);
        player.moveTo(constructLocation(WINELDA_LANDING_TILE));
        return;
      }
      if (stepId === WINELDA_REPEAT_TELEPORT_STEP_ID) {
        if (quest.getStage(player) < STAGE_CROSSED_LAVA) return;
        player.moveTo(constructLocation(WINELDA_LANDING_TILE));
        return;
      }
    }
    if (npcId === FIRE_WARRIOR_NPC_ID && stepId === FIRE_WARRIOR_KNOCKBACK_STEP_ID) {
      const scene = fireWarriorScenes.get(player);
      if (!scene || !scene.played || scene.npc !== event.npc || !currentFireWarriorScene(player, scene)) return;
      // Authored one-step retreat on the entry side, not a claimed retail landing tile.
      const here = player.getLocation();
      if (here.getX() !== FIRE_WARRIOR_DOOR_TILE.x || here.getY() > FIRE_WARRIOR_DOOR_TILE.y) return;
      const destination = here.transform(0, -1);
      if (!api.core.RegionManager.canMovestart(here, destination, player.getSize(), player.getSize(), null)) return;
      scene.task?.stop(); // the exact retreat now owns terminal scene cleanup
      const force = new api.core.ForceMovement(here.clone(), new api.core.Location(0, -1, 0), 0, 30, 2, -1);
      // A bounded authored retreat, using the existing force task with exact scene guards.
      const task = new (class extends api.core.ForceMovementTask {
        execute() {
          if (!currentFireWarriorScene(player, scene) || player.getForceMovement() !== force) {
            finishFireWarriorScene(player, scene);
            return;
          }
          super.execute();
          if (player.getLocation().equals(destination)) announcedFireWarriors.add(scene.npc);
          finishFireWarriorScene(player, scene);
        }
      })(player, 1, force);
      scene.task = task;
      api.getTaskManager().submit(task);
      return;
    }
    if (GUARDIAN_NPC_IDS.has(npcId) && LUCIEN_LOYALTY_STEP_IDS.has(stepId)) {
      if (quest.getStage(player) >= STAGE_STARTED) {
        player.setAttribute(SIDE_ATTRIBUTE, SIDE_LUCIEN);
      }
      return;
    }
    if (GUARDIAN_NPC_IDS.has(npcId) && stepId === TAKE_STAFF_ACTION_ID) {
      if (quest.getStage(player) < STAGE_HAS_STAFF) {
        // Past this stage no one hands out another, so with no room it stays and talking again retries.
        // Our wording. The floor won't do: an item there despawns, leaving the quest stuck.
        if (player.getInventory().getAddableAmount(new Item(STAFF_OF_ARMADYL_ITEM_ID, 1)) < 1) {
          player.sendMessage("You don't have enough inventory space.");
          return;
        }
        player.getInventory().adds(STAFF_OF_ARMADYL_ITEM_ID, 1);
        player.sendMessage("You take the Staff of Armadyl.");
        quest.setStage(player, STAGE_HAS_STAFF);
      }
      return;
    }
    if (LUCIEN_NPC_IDS.has(npcId) && COMPLETE_ACTION_IDS.has(stepId)) {
      if (!quest.isComplete(player)) {
        if (held(player, STAFF_OF_ARMADYL_ITEM_ID)) {
          player.getInventory().deleteNumber(STAFF_OF_ARMADYL_ITEM_ID, 1);
        }
        quest.complete(player);
      }
    }
  }

  /** A natural pre-Winelda kill is independent of her existing lava stage. */
  function handleFireWarriorDeath({ killer, npc, npcId }) {
    if (!killer || npcId !== FIRE_WARRIOR_NPC_ID || !npc
      || fireWarriorByPlayer.get(killer) !== npc || npc.getOwner() !== killer || !npc.isOwnerOnly()
      || !killer.isRegistered() || !npc.isRegistered() || npc.getPrivateArea() !== killer.getPrivateArea()
      || npc.getLocation().getZ() !== killer.getLocation().getZ()
      || quest.getStage(killer) < STAGE_STARTED) return;
    // The actual dying NPC may have zero HP; identity, not positive NPC HP, owns this credit.
    const scene = fireWarriorScenes.get(killer);
    scene?.task?.stop();
    scene?.cancel?.();
    fireWarriorScenes.delete(killer);
    fireWarriorByPlayer.delete(killer);
    killer.setAttribute(FIRE_WARRIOR_DEFEATED_ATTRIBUTE, 1);
    if (quest.getStage(killer) >= STAGE_CROSSED_LAVA && quest.getStage(killer) < STAGE_FIRE_WARRIOR_KILLED) {
      quest.setStage(killer, STAGE_FIRE_WARRIOR_KILLED);
    }
    refreshQuestList(killer);
  }

  /** Killing the house Lucien wearing the Armadyl pendant is the good ending. */
  function handleLucienDeath({ killer, npcId }) {
    if (!killer || npcId !== HOUSE_LUCIEN_NPC_ID) return;
    const entry = lucienSpawnsByPlayer.get(killer);
    if (entry?.house) {
      api.removeNpc(entry.house);
      entry.house = null;
    }
    if (quest.isComplete(killer) || sideOf(killer) !== SIDE_GUARDIANS) return;
    if (!wearingArmadylPendant(killer)) return;
    startTranscript(api, killer, HOUSE_LUCIEN_NPC_ID, PAGE, "finishing-up-defeating-lucien");
  }

  function canLaunchFireWarriorAttack(player, method) {
    const { Ammunition, CombatType, Equipment, RangedWeapon, WeaponInterfaces } = api.core;
    const arrows = player.getEquipment().get(Equipment.AMMUNITION_SLOT);
    if (method?.type?.() !== CombatType.RANGED || arrows?.getId?.() !== ICE_ARROWS_ITEM_ID || arrows.getAmount() < 1) return false;
    const weapon = player.getWeapon();
    if (weapon && [WeaponInterfaces.DART, WeaponInterfaces.KNIFE, WeaponInterfaces.THROWNAXE,
      WeaponInterfaces.OBBY_RINGS, WeaponInterfaces.BLOWPIPE].filter(Boolean).includes(weapon)) return true;
    return Ammunition.firesFromAmmoSlot(player) &&
      RangedWeapon.getFor(player)?.getAmmunitionData()?.some(ammo => ammo.getItemId() === ICE_ARROWS_ITEM_ID) === true;
  }

  function handleCanAttack(event) {
    const { attacker, target, method } = event;
    if (!attacker?.getEquipment || !target) return;
    const targetId = typeof target.getId === "function" ? target.getId() : undefined;
    if (targetId === FIRE_WARRIOR_NPC_ID && attacker.isPlayer?.() && method) {
      // Judge ordinary attacks before launch; previously queued and reflected damage is unchanged.
      if (!canLaunchFireWarriorAttack(attacker, method)) event.allow = false;
      return;
    }
    // Lucien instead requires the Armadyl pendant; his transcript explains a refusal.
    if (targetId !== HOUSE_LUCIEN_NPC_ID) return;
    if (wearingArmadylPendant(attacker)) return;
    event.allow = false;
    if (!attacker.getDialogueManager?.()?.isActive?.()) {
      startTranscript(
        api,
        attacker,
        HOUSE_LUCIEN_NPC_ID,
        PAGE,
        "finishing-up-attacking-lucien-without-wearing-the-armadyl-pendant"
      );
    }
  }

  // ==========================================================================
  // Interactions
  // ==========================================================================

  function npcAction(event) {
    const actions = event.definition?.getActions?.() ?? [];
    return String(actions[event.clickType - 1] ?? "").toLowerCase();
  }

  /** The private Luciens are not indexed, so their Talk-to is replayed here. */
  function handleNpcInteraction(event) {
    const { player, npcId } = event;
    const action = npcAction(event);
    if (npcId === INN_LUCIEN_NPC_ID) {
      if (action !== "talk-to") return;
      event.handled = true;
      const stage = quest.getStage(player);
      const variant =
        stage < STAGE_STARTED
          ? "starting-out-talking-to-lucien"
          : "starting-out-talking-to-lucien-again";
      startTranscript(api, player, npcId, PAGE, variant);
      return;
    }
    if (npcId === HOUSE_LUCIEN_NPC_ID && action === "talk-to") {
      event.handled = true;
      startTranscript(api, player, npcId, PAGE, "finishing-up-talking-to-lucien-near-varrock");
    }
  }

  function iceChestIndex(location) {
    if ((location?.z ?? 0) !== 0) return -1;
    return ICE_CHEST_TILES.findIndex(([x, y]) => location.x === x && location.y === y);
  }

  function closeIceChest(player, state, index, object) {
    if (iceChestsByPlayer.get(player) !== state || state.open.get(index) !== object) return;
    state.open.delete(index);
    state.timers.get(index)?.stop();
    state.timers.delete(index);
    api.core.ObjectManager.deregister(object, true);
    api.core.ObjectManager.showMapObjectFor(player, ICE_CHEST_CLOSED_ID, object.getLocation());
  }

  function removeIceChests(player) {
    const state = iceChestsByPlayer.get(player);
    if (!state) return;
    for (const [index, object] of state.open) closeIceChest(player, state, index, object);
    iceChestsByPlayer.delete(player);
  }

  /** The open loc as the chest's animation ends; a logout or leaving the dungeon meanwhile drops it. */
  function openIceChest(player, state, index, object) {
    state.opening.delete(index);
    if (iceChestsByPlayer.get(player) !== state || state.open.has(index) || player.isRegistered?.() === false) return;
    if (!api.core.ObjectManager.hideMapObjectFor(player, ICE_CHEST_CLOSED_ID, object.getLocation())) return;
    const opened = new api.core.GameObject(ICE_CHEST_OPEN_ID, object.getLocation().clone(), object.getType(),
      object.getFace(), object.getPrivateArea()).setOwner(player);
    api.core.ObjectManager.register(opened, true);
    state.open.set(index, opened);
    const timer = new api.core.CountdownTask(opened, ICE_CHEST_OPEN_TICKS,
      () => closeIceChest(player, state, index, opened));
    state.timers.set(index, timer);
    api.core.TaskManager.submit(timer);
  }

  function handleIceChest(event, index) {
    const { player, object, objectId } = event;
    // These are shared cache chests; private-instance loc lookup has different ownership semantics.
    if (player.getPrivateArea() || object.getPrivateArea()) return;
    event.handled = true;
    let state = iceChestsByPlayer.get(player);
    if (!state) {
      state = { selected: api.core.Misc.random(0, ICE_CHEST_TILES.length - 1), amount: null, open: new Map(), opening: new Set(), timers: new Map() };
      iceChestsByPlayer.set(player, state);
    }
    const action = String(event.option ?? event.definition?.getInteractions?.()[event.clickType - 1]).toLowerCase();
    if (objectId === ICE_CHEST_CLOSED_ID && action === "open") {
      if (state.open.has(index) || state.opening.has(index)) return;
      state.opening.add(index);
      const sequence = api.core.CacheDefinitions.getSeqId("human_openchest");
      if (sequence != null) player.performAnimation(new api.core.Animation(sequence));
      player.getPacketSender().sendSound(CHEST_OPEN_SOUND, 10, 0);
      // Keyed to this stock, not the player: a cancelled player task would leave the chest stuck "opening".
      api.core.TaskManager.submit(new api.core.CountdownTask(state, ICE_CHEST_OPEN_DELAY_TICKS,
        () => openIceChest(player, state, index, object)));
      return;
    }
    if (objectId !== ICE_CHEST_OPEN_ID || state.open.get(index) !== object) return;
    if (action === "shut") {
      closeIceChest(player, state, index, object);
      return;
    }
    if (action !== "search") return;
    if (index !== state.selected) {
      player.sendMessage("You search the chest, but find nothing.");
      return;
    }
    const amount = state.amount ?? (state.amount = api.core.Misc.random(1, 5));
    if (player.getInventory().getAddableAmount(new Item(ICE_ARROWS_ITEM_ID, amount)) < amount) {
      player.sendMessage("You do not have enough space for the arrows.");
      return;
    }
    player.getInventory().adds(ICE_ARROWS_ITEM_ID, amount);
    // The quest guide explicitly permits searching this same open chest again:
    // it can be selected on consecutive successful searches. Opening is visual
    // state; it does not consume or reroll the one containing stock.
    state.selected = api.core.Misc.random(0, ICE_CHEST_TILES.length - 1);
    state.amount = null;
    api.core.ItemStatementDialogue.send(player, ICE_ARROWS_ITEM_ID, "You found some ice arrows!");
    player.getPacketSender().sendSound(ICE_ARROWS_FOUND_SOUND, 10, 0);
  }

  function matchingFireWarriorScene(player, scene) {
    const npc = scene.npc;
    return fireWarriorScenes.get(player) === scene && fireWarriorByPlayer.get(player) === npc
      && player.isRegistered() && player.getHitpoints() > 0 && !defeatedFireWarrior(player)
      && quest.getStage(player) >= STAGE_STARTED && player.getPrivateArea() === null
      && player.getArea() === scene.area && player.getTeleportSerial() === scene.teleportSerial
      && player.getLocation().equals(scene.start) && npc.getOwner() === player && npc.isOwnerOnly()
      && npc.getHitpoints() > 0
      && npc.getPrivateArea() === null && npc.getLocation().getZ() === scene.start.getZ();
  }

  function currentFireWarriorScene(player, scene) {
    const npc = scene.npc;
    return matchingFireWarriorScene(player, scene) && npc.isRegistered()
      && api.core.World.getNpcs().get(npc.getIndex()) === npc && npc.isVisible()
      && player.getLocalNpcs().includes(npc);
  }

  function finishFireWarriorScene(player, scene) {
    if (fireWarriorScenes.get(player) !== scene) return;
    fireWarriorScenes.delete(player);
    scene.task?.stop();
    scene.cancel?.(); // exact scoped owner, preserving a replacement dialogue
  }

  function beginFireWarriorEncounter(event) {
    const { player, object } = event;
    if (!object || object.getId() !== FIRE_WARRIOR_DOOR_ID || object.getType() !== FIRE_WARRIOR_DOOR_TYPE
      || object.getFace() !== FIRE_WARRIOR_DOOR_FACE || object.getOwner() || object.getPrivateArea()
      || !sameTile(object.getLocation(), FIRE_WARRIOR_DOOR_TILE)
      || api.core.MapObjects.getPrivateArea(player, FIRE_WARRIOR_DOOR_ID, object.getLocation()) !== object) return;
    openFireWarriorDoor(player);
  }

  function openFireWarriorDoor(player) {
    if (quest.getStage(player) < STAGE_STARTED || defeatedFireWarrior(player)
      || !player.isRegistered() || player.getHitpoints() <= 0 || player.getPrivateArea()) return;
    if (fireWarriorScenes.has(player)) return;
    const npc = ensureFireWarrior(player);
    if (!npc || announcedFireWarriors.has(npc)) return;
    const scene = { npc, start: player.getLocation().clone(), area: player.getArea(),
      teleportSerial: player.getTeleportSerial(), task: null, played: false };
    fireWarriorScenes.set(player, scene);
    let left = FIRE_WARRIOR_LOCAL_WAIT_TICKS;
    const task = new (class extends api.core.Task {
      constructor() { super(1, player); }
      execute() {
        if (!matchingFireWarriorScene(player, scene)) { finishFireWarriorScene(player, scene); return; }
        if (scene.played) {
          if (!currentFireWarriorScene(player, scene)
            || player.getDialogueManager().getOwner() !== scene.dialogueOwner) finishFireWarriorScene(player, scene);
          return;
        }
        if (!currentFireWarriorScene(player, scene)) {
          if (--left <= 0) finishFireWarriorScene(player, scene);
          return;
        }
        const request = { player, npc, npcId: FIRE_WARRIOR_NPC_ID,
          variant: { page: PAGE, variant: "inside-the-dungeon-opening-door-in-the-fire-warrior-room" },
          exact: true, handled: false };
        scene.played = true;
        api.emitCustomEvent("npc-dialogue:start", request);
        scene.cancel = request.cancel;
        scene.dialogueOwner = player.getDialogueManager().getOwner();
        if (!request.handled || !scene.dialogueOwner) finishFireWarriorScene(player, scene);
      }
      stop() {
        if (!scene.played && fireWarriorScenes.get(player) === scene) fireWarriorScenes.delete(player);
        super.stop();
      }
    })();
    scene.task = task;
    api.getTaskManager().submit(task);
  }

  function guardFireWarriorDoor(event) {
    const { player, object, objectId, location } = event;
    if (objectId !== FIRE_WARRIOR_DOOR_ID || !location || player.getPrivateArea()
      || object.getPrivateArea() || location.x !== FIRE_WARRIOR_DOOR_TILE.x
      || (location.y !== FIRE_WARRIOR_DOOR_TILE.y && location.y !== FIRE_WARRIOR_DOOR_TILE.y + 1)
      || location.z !== 0) return;
    if (!defeatedFireWarrior(player)) {
      event.handled = true;
      // Doors claims this request before later object hooks; trigger here while the wall stays shut.
      beginFireWarriorEncounter(event);
    }
  }

  function guardBootsStairs(event) {
    if (event.objectId !== BOOTS_STAIRS_DOWN_ID
      || !sameTile(event.object?.getLocation(), BOOTS_STAIRS_DOWN_TILE)) return;
    if (!require("../../world/Darkness.plugin.js").hasLightSource(event.player)) event.handled = true;
  }

  function removeBracket(player) {
    const state = bracketByPlayer.get(player);
    if (!state) return;
    bracketByPlayer.delete(player);
    api.core.ObjectManager.deregister(state.object, true);
    api.core.ObjectManager.showMapObjectFor(player, LEVER_BRACKET_ID, state.base.getLocation());
  }

  function showBracket(player, base, id) {
    const old = bracketByPlayer.get(player);
    if (old) api.core.ObjectManager.deregister(old.object, true);
    const object = new api.core.GameObject(id, base.getLocation().clone(), base.getType(), base.getFace(), null)
      .setOwner(player);
    api.core.ObjectManager.register(object, true);
    bracketByPlayer.set(player, { base, object });
  }

  function handleLeverOnBracket(event) {
    const { player, object, objectId, itemId, location } = event;
    if (objectId !== LEVER_BRACKET_ID || itemId !== ItemIdentifiers.LEVER
      || !sameTile(location, LEVER_BRACKET_TILE) || player.getPrivateArea() || object.getPrivateArea()) return false;
    event.handled = true;
    if (!player.isRegistered() || bracketByPlayer.has(player)
      || player.getAttribute(ICE_GATE_UNLOCKED_ATTRIBUTE) === 1 || !held(player, itemId)
      || api.core.MapObjects.getPrivateArea(player, objectId, object.getLocation()) !== object) return;
    if (!api.core.ObjectManager.hideMapObjectFor(player, LEVER_BRACKET_ID, object.getLocation())) return;
    player.getInventory().deleteNumber(itemId, 1);
    showBracket(player, object, FITTED_LEVER_ID);
  }

  function handleFittedLever(event) {
    const { player, object, objectId, location } = event;
    if (objectId !== FITTED_LEVER_ID || !sameTile(location, LEVER_BRACKET_TILE)
      || player.getPrivateArea() || object.getPrivateArea()) return false;
    event.handled = true;
    const state = bracketByPlayer.get(player);
    if (!player.isRegistered() || state?.object !== object || object.getOwner() !== player) return;
    player.setAttribute(ICE_GATE_UNLOCKED_ATTRIBUTE, 1);
    showBracket(player, state.base, LOWERED_LEVER_ID);
    api.core.TaskManager.submit(new api.core.CountdownTask(player, LEVER_PULL_TEXT_DELAY, () => {
      if (player.isRegistered()) api.core.StatementDialogue.send(player, LEVER_PULL_TEXT);
    }));
  }

  function isTrappedLever(event) {
    return event.objectId === TRAPPED_LEVER_ID && sameTile(event.location, TRAPPED_LEVER_TILE)
      && event.player.getPrivateArea() === null && event.object.getPrivateArea() === null;
  }

  function searchTrappedLever(event) {
    if (!isTrappedLever(event)) return false;
    event.handled = true;
    const { player, object } = event;
    if (!player.isRegistered() || trapTasksByPlayer.has(player)
      || api.core.MapObjects.getPrivateArea(player, TRAPPED_LEVER_ID, object.getLocation()) !== object) return;
    if (thievingLevel(player) < TRAP_DISARM_LEVEL) {
      api.core.StatementDialogue.send(player, "You find nothing.");
      return;
    }
    player.setAttribute(TRAP_DISARMED_ATTRIBUTE, 1);
    api.core.StatementDialogue.send(player, "You find a trap on the lever! You disable the trap.");
  }

  function stopTrapTask(player) {
    trapTasksByPlayer.get(player)?.stop();
  }

  function pullTrappedLever(event) {
    if (!isTrappedLever(event)) return false;
    event.handled = true;
    const { player, object } = event;
    const movement = player.getMovementQueue();
    if (!player.isRegistered() || trapTasksByPlayer.has(player) || movement.isMovementBlocked()
      || player.getAttribute(TRAP_DOOR_UNLOCKED_ATTRIBUTE) === 1
      || api.core.MapObjects.getPrivateArea(player, TRAPPED_LEVER_ID, object.getLocation()) !== object) return;
    const disarmed = player.getAttribute(TRAP_DISARMED_ATTRIBUTE) === 1;
    let landing = null;
    if (!disarmed) {
      const ladder = api.core.MapObjects.get(TRAP_PIT_LADDER_ID, constructLocation(TRAP_PIT_LADDER_TILE), null);
      // Authored pit routing model: use an actual usable stand beside the cache's
      // ikov_trapladder, not an invented or claimed exact retail falling tile.
      if (ladder) landing = require("../../objects/ClimbLinks").landingTile(ladder,
        { x: TRAP_PIT_LADDER_TILE.x, y: TRAP_PIT_LADDER_TILE.y }, null);
      if (!landing) return;
    }
    const sequence = api.core.CacheDefinitions.getSeqId("macro_lever_switch_down");
    if (sequence != null) player.performAnimation(new api.core.Animation(sequence));
    const start = player.getLocation().clone(), key = { player, object };
    movement.setBlockMovement(true).reset();
    const task = new (class extends api.core.Task {
      constructor() { super(1, key); }
      execute() {
        try {
          if (trapTasksByPlayer.get(player) !== this || !player.isRegistered() || player.getHitpoints() <= 0
            || player.getPrivateArea() !== null || !player.getLocation().equals(start)
            || api.core.MapObjects.getPrivateArea(player, TRAPPED_LEVER_ID, object.getLocation()) !== object) return;
          if (disarmed) {
            player.setAttribute(TRAP_DOOR_UNLOCKED_ATTRIBUTE, 1);
          } else {
            player.moveTo(landing);
            player.getCombat().getHitQueue().addPendingDamage([
              new api.core.HitDamage(TRAP_DAMAGE, api.core.HitMask.RED),
            ]);
            player.forceChat("Ouch!");
          }
        } finally { this.stop(); }
      }
      stop() {
        if (trapTasksByPlayer.get(player) === this) {
          trapTasksByPlayer.delete(player);
          movement.setBlockMovement(false);
        }
        super.stop();
      }
    })();
    trapTasksByPlayer.set(player, task);
    api.getTaskManager().submit(task);
  }

  function guardTrapDoor(event) {
    const { player, object, objectId, location } = event;
    if (objectId !== TRAP_DOOR_ID || !location || player.getPrivateArea() || object.getPrivateArea()) return;
    if (location.x !== TRAP_DOOR_TILE.x || (location.y !== TRAP_DOOR_TILE.y && location.y !== TRAP_DOOR_TILE.y + 1)
      || location.z !== 0) return;
    if (quest.isComplete(player) || player.getAttribute(TRAP_DOOR_UNLOCKED_ATTRIBUTE) === 1) return;
    event.handled = true;
  }

  function climbOutOfTrapPit(event) {
    const { player, object, objectId } = event;
    if (objectId !== TRAP_PIT_LADDER_ID || !sameTile(object?.getLocation(), TRAP_PIT_LADDER_TILE)
      || player.getPrivateArea() || object.getPrivateArea()) return;
    event.handled = true;
    if (!player.isRegistered()
      || api.core.MapObjects.getPrivateArea(player, objectId, object.getLocation()) !== object) return;
    const exit = api.core.MapObjects.get(TRAP_EXIT_ID, constructLocation(TRAP_EXIT_TILE), null);
    // Content-specific same-plane return association; cache-derived stand near
    // the southern trapdoor. Not a claim of a recording-verified retail route.
    const destination = exit && require("../../objects/ClimbLinks").landingTile(exit,
      { x: TRAPPED_LEVER_TILE.x, y: TRAPPED_LEVER_TILE.y }, null);
    if (destination) api.emitCustomEvent("ladders:climbUp", { player, object, destination });
  }

  function guardIceGate(event) {
    const { player, object, objectId, location } = event;
    if (!ICE_GATE_IDS.has(objectId) || !location || player.getPrivateArea() || object.getPrivateArea()) return;
    // The generic double-door handler retains IDs89/90 and moves each leaf one tile south.
    if ((location.x !== 2661 && location.x !== 2662)
      || (location.y !== 9803 && location.y !== 9802) || location.z !== 0) return;
    if (quest.isComplete(player) || player.getAttribute(ICE_GATE_UNLOCKED_ATTRIBUTE) === 1) return;
    event.handled = true;
  }

  function restorePulledBracket(player) {
    if (player.getPrivateArea() || player.getAttribute(ICE_GATE_UNLOCKED_ATTRIBUTE) !== 1
      || bracketByPlayer.has(player)) return;
    const base = api.core.MapObjects.get(LEVER_BRACKET_ID, constructLocation(LEVER_BRACKET_TILE), null);
    if (base && api.core.ObjectManager.hideMapObjectFor(player, LEVER_BRACKET_ID, base.getLocation())) {
      showBracket(player, base, LOWERED_LEVER_ID);
    }
  }

  function handleObjectInteraction(event) {
    const { player, objectId, location } = event;
    if (objectId === FIRE_WARRIOR_DOOR_ID && sameTile(location, FIRE_WARRIOR_DOOR_TILE)) {
      if (quest.getStage(player) < STAGE_STARTED || quest.isComplete(player)) return;
      if (defeatedFireWarrior(player)) return;
      event.handled = true;
      beginFireWarriorEncounter(event);
      return;
    }
    if (objectId === PUSH_WALL_ID && sameTile(location, PUSH_WALL_TILE)) {
      event.handled = true;
      const here = player.getLocation();
      const north = here.getY() <= PUSH_WALL_TILE.y;
      const y = north ? PUSH_WALL_TILE.y + 1 : PUSH_WALL_TILE.y - 1;
      player.moveTo(new api.core.Location(PUSH_WALL_TILE.x, y, here.getZ()));
      return;
    }
    if (objectId === ICE_CHEST_CLOSED_ID || objectId === ICE_CHEST_OPEN_ID) {
      const index = iceChestIndex(location);
      if (index >= 0) handleIceChest(event, index);
    }
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    ensureLucien(player);
  }

  // This slice covers the guide's negative displayed-weight region only.
  // Fractional-negative/displayed-zero, heavy falls and recovery keep their
  // current ordinary route; this is not a universal retail weight threshold.
  function documentedBridgeWeight(player) { return player.getWeightKg() < 0; }

  function stopBridgeApproach(player, clearPath = false) {
    const request = bridgeApproaches.get(player);
    if (!request) return;
    bridgeApproaches.delete(player);
    request.task?.stop();
    const queue = player.getMovementQueue();
    if (clearPath && player.getArea() === request.area
      && player.getTeleportSerial() === request.teleportSerial
      && queue.getBlockMovementGeneration() === request.blockGeneration
      && !ObstacleRunner.isBusy(player) && player.getForceMovement() == null
      && queue.getDestination()?.equals(request.approach)) queue.reset();
  }

  function clearBridgeOrigin(player) {
    bridgeOrigins.delete(player);
    if (player.getAttribute(BRIDGE_ORIGIN_ATTRIBUTE) != null
      && player.getAttribute(BRIDGE_ORIGIN_ATTRIBUTE) !== 0) player.setAttribute(BRIDGE_ORIGIN_ATTRIBUTE, 0);
  }

  function rememberBridgeOrigin(player, origin) {
    // Only an actual pre-entry edge creates provenance. Persist through the
    // established PlayerSave attribute contract, not a guessed relog side.
    player.setAttribute(BRIDGE_ORIGIN_ATTRIBUTE, { version: 1, entryX: origin.getX() });
    bridgeOrigins.set(player, { area: player.getArea(), teleportSerial: player.getTeleportSerial() });
  }

  function bridgeOrigin(player) {
    const record = player.getAttribute(BRIDGE_ORIGIN_ATTRIBUTE);
    if (record == null || record === 0) return null;
    const at = player.getLocation(), bound = bridgeOrigins.get(player);
    if (typeof record !== "object" || Array.isArray(record)
      || Object.keys(record).sort().join(",") !== "entryX,version" || record.version !== 1
      || ![BRIDGE_WEST_EDGE, BRIDGE_EAST_EDGE].includes(record.entryX)
      || !(player.getArea() instanceof TempleOfIkovIceChests) || player.getPrivateArea() !== null
      || at.getX() !== 2649 || at.getY() !== BRIDGE_CROSSING_ROW || at.getZ() !== 0
      || (bound && (bound.area !== player.getArea() || bound.teleportSerial !== player.getTeleportSerial()))) {
      clearBridgeOrigin(player); return null;
    }
    // A fresh Player loaded at the saved gap can bind this session only from
    // the persisted pre-entry record. A destination never supplies an entry.
    if (!bound) bridgeOrigins.set(player, { area: player.getArea(), teleportSerial: player.getTeleportSerial() });
    return new api.core.Location(record.entryX, BRIDGE_CROSSING_ROW, 0);
  }

  function stopBridgePassage(player) { bridgePassages.get(player)?.task.stop(); }

  function bridgeSceneCurrent(player, scene) {
    const at = player.getLocation();
    return bridgePassages.get(player) === scene && player.isRegistered()
      && player.getHitpoints() > 0 && !player.isNeedsPlacement()
      && player.getArea() === scene.area && player.getPrivateArea() === scene.privateArea
      && player.getTeleportSerial() === scene.teleportSerial
      && player.getForceMovement() == null
      && player.getAttribute(OBSTACLE_ATTRIBUTE) === scene.task
      && player.getMovementQueue().getBlockMovementGeneration() === scene.lockGeneration
      && at.getZ() === 0 && at.getY() === scene.y
      && at.getX() >= BRIDGE_WEST_BANK && at.getX() <= BRIDGE_EAST_BANK;
  }

  function startBridgePassage(player, request) {
    const at = player.getLocation(), queue = player.getMovementQueue();
    if (!(player.getArea() instanceof TempleOfIkovIceChests) || player.getArea() !== request.area
      || player.getPrivateArea() !== null || player.getTeleportSerial() !== request.teleportSerial
      || !player.isRegistered() || player.getHitpoints() <= 0 || player.isNeedsPlacement()
      || player.busy() || queue.isMovementBlocked() || ObstacleRunner.isBusy(player) || player.getForceMovement() != null
      || bridgePassages.has(player) || (!documentedBridgeWeight(player) && !request.returning)
      || !at.equals(request.approach)) return;
    // Exact cache wall placements bound this scoped scripted walk. No shared
    // collision change or movement:ignore-clipping privilege is granted.
    for (const [x, face] of [[BRIDGE_WEST_EDGE, 2], [BRIDGE_EAST_EDGE, 0]]) {
      const wall = api.core.MapObjects.get(BRIDGE_WALL_ID, new api.core.Location(x, request.y, 0), null);
      if (!wall || wall.getType() !== 0 || wall.getFace() !== face || wall.getOwner() != null) return;
    }
    const bank = new api.core.Location(request.westward ? BRIDGE_WEST_BANK : BRIDGE_EAST_BANK, request.y, 0);
    // Origin is known before run() performs its first immediate step. A resumed
    // scene inherits this prior origin; a new destination never invents one.
    const origin = request.origin.clone();
    if (origin.getY() !== BRIDGE_CROSSING_ROW
      || ![BRIDGE_WEST_EDGE, BRIDGE_EAST_EDGE].includes(origin.getX())) return;
    const scene = { area: request.area, privateArea: null, teleportSerial: request.teleportSerial,
      y: request.y, origin, returning: request.returning === true,
      task: null, expected: null, lockGeneration: null };
    rememberBridgeOrigin(player, origin);
    const target = scene.returning ? origin : bank;
    // A one-step resumed return must remain live until its instance finish is wrapped.
    const steps = [{ walk: [[target.getX(), target.getY()]], arrive: !scene.returning }];
    // Attributed review 5911478216 requirement: retain the existing owned hold
    // through arrival-turn packets, then release on the next owned task tick.
    if (!scene.returning) steps.push({ wait: 1 });
    const task = ObstacleRunner.run({ player }, steps, {
      onFinish: () => {
        if (bridgePassages.get(player) === scene) bridgePassages.delete(player);
        // The original click is consumed, including a successful crossing.
      },
    });
    scene.task = task;
    scene.expected = player.getLocation().clone(); // run() performs its first step immediately.
    scene.lockGeneration = queue.getBlockMovementGeneration();
    bridgePassages.set(player, scene);
    const execute = task.execute.bind(task);
    task.execute = () => {
      if (!bridgeSceneCurrent(player, scene) || !player.getLocation().equals(scene.expected)) {
        task.finish(false); return;
      }
      if (!scene.returning && !documentedBridgeWeight(player) && !player.getLocation().equals(bank)) {
        // Authored interim safety policy, not the unimplemented retail fall:
        // normal steps back to the remembered entry, never a free crossing.
        scene.returning = true;
        // A safety return is not a successful arrival and has no arrival tail.
        task.steps = [];
        task.index = 0;
        task.waitTicks = 0;
        task.walkPath = [[scene.origin.getX(), scene.origin.getY()]];
        task.walkedTiles = 0;
        task.walkArrives = true;
        task.walkTilesPerTick = 1;
      }
      execute();
      if (!task.finished) scene.expected = player.getLocation().clone();
    };
    // The unmodified runner releases CURRENT generic state and fast-forwards on
    // logout. This walk sets no render/animation/force, so finish only its own
    // exact BUSY and movement hold, leaving replacement work/force/render intact.
    task.finish = completed => {
      if (task.finished) return;
      const accepted = completed && !scene.returning && documentedBridgeWeight(player)
        && bridgeSceneCurrent(player, scene) && player.getLocation().equals(bank);
      const here = player.getLocation();
      // Keep the actual prior origin through temporary foreign work and logout
      // only while the same physical gap/scene/serial still matches. No movement
      // is resumed until ordinary input passes the current mobility/owner guards.
      const ownGap = here.getX() === 2649 && here.getY() === scene.y && here.getZ() === 0
        && here.equals(scene.expected) && player.getArea() === scene.area
        && player.getPrivateArea() === scene.privateArea && player.getTeleportSerial() === scene.teleportSerial;
      if (ownGap) rememberBridgeOrigin(player, scene.origin);
      else clearBridgeOrigin(player);
      task.finished = true;
      api.core.Task.prototype.stop.call(task);
      if (player.getAttribute(OBSTACLE_ATTRIBUTE) === task) player.setAttribute(OBSTACLE_ATTRIBUTE, null);
      // BUSY and the movement hold have independent owners.
      if (queue.getBlockMovementGeneration() === scene.lockGeneration) queue.setBlockMovement(false);
      task.complete(accepted);
    };
    task.fastForward = () => task.finish(false);
  }

  function routeBridgeWalk(event) {
    const { player, destination } = event;
    const old = bridgeApproaches.get(player);
    if (old?.routing) return; // The nested native request only routes to this bank.
    stopBridgeApproach(player);
    if (event.handled || !(player.getArea() instanceof TempleOfIkovIceChests) || !destination
      || player.getPrivateArea() !== null || player.busy() || ObstacleRunner.isBusy(player)
      || player.getForceMovement() != null || player.getMovementQueue().isMovementBlocked()
      || bridgePassages.has(player)) return;
    const from = player.getLocation();
    if (from.getZ() !== 0 || destination.z !== 0 || from.getX() < 2630 || from.getX() > 2665
      || from.getY() < 9827 || from.getY() > 9831 || destination.x < 2630 || destination.x > 2665
      || !BRIDGE_ROWS.has(destination.y)) return;
    const withinGap = from.getY() === BRIDGE_CROSSING_ROW && from.getX() === 2649;
    const knownOrigin = withinGap ? bridgeOrigin(player) : null;
    if (withinGap && !knownOrigin) return; // Never infer an entry side from this new click.
    const eligible = documentedBridgeWeight(player);
    if (!eligible && !knownOrigin) return;
    const westward = (from.getX() >= BRIDGE_EAST_EDGE || withinGap) && destination.x <= BRIDGE_WEST_EDGE;
    const eastward = (from.getX() <= BRIDGE_WEST_EDGE || withinGap) && destination.x >= BRIDGE_EAST_EDGE;
    if (!westward && !eastward) return;
    const y = BRIDGE_CROSSING_ROW, queue = player.getMovementQueue();
    const approach = withinGap ? from.clone()
      : new api.core.Location(westward ? BRIDGE_EAST_EDGE : BRIDGE_WEST_EDGE, y, 0);
    const request = { player, area: player.getArea(), teleportSerial: player.getTeleportSerial(),
      blockGeneration: queue.getBlockMovementGeneration(), westward, y, approach,
      origin: knownOrigin ? knownOrigin.clone() : approach.clone(), returning: !eligible,
      routing: false, task: null };
    event.handled = true;
    if (from.equals(request.approach)) { startBridgePassage(player, request); return; }
    bridgeApproaches.set(player, request);
    request.routing = true;
    queue.requestWalk(request.approach);
    request.routing = false;
    if (queue.isMovementBlocked() || ObstacleRunner.isBusy(player)
      || !queue.getDestination()?.equals(request.approach)) {
      stopBridgeApproach(player); return;
    }
    // A uniquely held task polls the real routed approach; it neither imports
    // the non-exported MovementTask nor cancels other tasks by a shared key.
    request.task = new api.core.Task(1, player, false);
    request.task.execute = () => {
      if (bridgeApproaches.get(player) !== request) { request.task.stop(); return; }
      if (player.getArea() !== request.area || player.getPrivateArea() !== null
        || player.getTeleportSerial() !== request.teleportSerial || !player.isRegistered()
        || player.getHitpoints() <= 0 || !documentedBridgeWeight(player)
        || queue.getBlockMovementGeneration() !== request.blockGeneration
        || ObstacleRunner.isBusy(player) || player.getForceMovement() != null) {
        stopBridgeApproach(player, true); return;
      }
      if (player.getLocation().equals(request.approach)) {
        stopBridgeApproach(player); startBridgePassage(player, request); return;
      }
      if (!queue.getDestination()?.equals(request.approach)) stopBridgeApproach(player);
    };
    api.getTaskManager().submit(request.task);
  }

  function handleLogout({ player }) {
    if (player) {
      stopBridgeApproach(player, true);
      stopBridgePassage(player);
      removeSpawns(player);
      removeIceChests(player);
      removeBracket(player);
      stopTrapTask(player);
    }
  }

  // Volatile owner-only chest overlays are discarded when their player leaves the dungeon.
  // This is scene lifecycle cleanup, not an account-persistence or OSRS relog-stock claim.
  class TempleOfIkovIceChests extends api.core.Area {
    postEnter(mobile) {
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer();
      restorePulledBracket(player);
      // AreaManager assigns getArea() after enter; provenance binds in process.
    }
    process(mobile) {
      if (mobile.isPlayer() && !bridgePassages.has(mobile.getAsPlayer())) bridgeOrigin(mobile.getAsPlayer());
    }
    postLeave(mobile, logout) {
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer();
      stopBridgeApproach(player, true);
      stopBridgePassage(player);
      if (!logout) clearBridgeOrigin(player);
      removeIceChests(player);
      removeBracket(player);
      stopTrapTask(player);
      removeFireWarrior(player);
    }
  }

  const PAGE = "Temple of Ikov";

  quest = registerQuest(api, {
    key: "temple_of_ikov",
    name: "Temple of Ikov",
    varpId: VARP_TEMPLE_OF_IKOV,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.RANGED.getIndex(), amount: 10500, label: "Ranged" },
      { skillId: Skill.FLETCHING.getIndex(), amount: 8000, label: "Fletching" },
    ],
    scrollItemId: ItemIdentifiers.BOOTS_OF_LIGHTNESS,
    otherRewards: ["Boots of lightness (optional dungeon pickup)", "Armies of Gielinor side unlocked"],
    buildJournal,
    onReward: grantReward,
  });

  api.registerArea(new TempleOfIkovIceChests([new api.core.Boundary(2624, 2753, 9758, 9916, 0)]));
  api.persistAttribute(BRIDGE_ORIGIN_ATTRIBUTE, 0);
  api.persistAttribute(SIDE_ATTRIBUTE);
  api.persistAttribute(ICE_GATE_UNLOCKED_ATTRIBUTE, 0);
  api.persistAttribute(TRAP_DISARMED_ATTRIBUTE, 0);
  api.persistAttribute(TRAP_DOOR_UNLOCKED_ATTRIBUTE, 0);
  api.persistAttribute(FIRE_WARRIOR_DEFEATED_ATTRIBUTE, 0);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onNpcInteraction(handleNpcInteraction);
  api.onCustomEvent("ladders:climb", guardBootsStairs);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject("Lever", "Lever bracket", handleLeverOnBracket);
  api.onObjectInteraction("Lever", { Pull: handleFittedLever });
  api.onCustomEvent("door:toggle", guardIceGate);
  api.onCustomEvent("door:toggle", guardFireWarriorDoor);
  api.onObjectInteraction("Lever", { "Search for traps": searchTrappedLever, Pull: pullTrappedLever });
  api.onCustomEvent("door:toggle", guardTrapDoor);
  api.onCustomEvent("ladders:climb", climbOutOfTrapPit);
  api.onCanAttack(handleCanAttack);
  api.onNpcDeath(handleFireWarriorDeath);
  api.onNpcDeath(handleLucienDeath);
  api.onWalkRoute(routeBridgeWalk);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
