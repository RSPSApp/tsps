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
  const ICE_ARROWS_PER_SEARCH = 5;

  // World tiles (cache placements): Lucien placeholders, the fire-warrior door,
  // the wall north of the skeletons and the Temple of Ikov ice chest.
  const INN_LUCIEN_TILE = { x: 3122, y: 3483, z: 0 };
  const HOUSE_LUCIEN_TILE = { x: 2573, y: 3321, z: 0 };
  const FIRE_WARRIOR_DOOR_ID = 93;
  const FIRE_WARRIOR_DOOR_TILE = { x: 2646, y: 9870, z: 0 };
  /** The cache placement: a straight wall piece (shape 0) facing rotation 1. */
  const FIRE_WARRIOR_DOOR_TYPE = 0;
  const FIRE_WARRIOR_DOOR_FACE = 1;
  const FIRE_WARRIOR_TILE = { x: 2646, y: 9867, z: 0 };
  const FIRE_WARRIOR_KNOCKBACK_TILE = { x: 2646, y: 9874, z: 0 };
  const PUSH_WALL_ID = 1597;
  const PUSH_WALL_TILE = { x: 2643, y: 9892, z: 0 };
  const ICE_CHEST_ID = 375;
  const ICE_CHEST_TILE = { x: 2634, y: 9908, z: 0 };
  /** West side of the lava, in the skeleton corridor, per Winelda's teleport. */
  const WINELDA_LANDING_TILE = { x: 2644, y: 9890, z: 0 };

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
    if (stage >= STAGE_FIRE_WARRIOR_KILLED) {
      return [
        "I defeated the Fire Warrior of Lesarkus.",
        "I should search the Temple of Ikov for the guardians.",
      ];
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

  function grantReward(player) {
    removeSpawns(player);
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

  function ensureFireWarrior(player) {
    const existing = fireWarriorByPlayer.get(player);
    if (existing) return existing;
    removeStalePrivateSpawns(player, FIRE_WARRIOR_PRIVATE_NPC_IDS);
    const npc = spawnPrivateNpc(player, FIRE_WARRIOR_NPC_ID, FIRE_WARRIOR_TILE);
    if (npc) fireWarriorByPlayer.set(player, npc);
    return npc;
  }

  function removeFireWarrior(player) {
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
      player.moveTo(constructLocation(FIRE_WARRIOR_KNOCKBACK_TILE));
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

  /** Killing the Fire Warrior advances the quest once the lava is crossed. */
  function handleFireWarriorDeath({ killer, npcId }) {
    if (!killer || npcId !== FIRE_WARRIOR_NPC_ID) return;
    fireWarriorByPlayer.delete(killer);
    if (quest.getStage(killer) >= STAGE_FIRE_WARRIOR_KILLED) return;
    if (quest.getStage(killer) >= STAGE_CROSSED_LAVA) {
      quest.setStage(killer, STAGE_FIRE_WARRIOR_KILLED);
    }
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

  function openIceChest(player) {
    if (player.getInventory().isFull()) {
      player.sendMessage("You do not have enough space for the arrows.");
      return;
    }
    if (player.getInventory().getAmount(ICE_ARROWS_ITEM_ID) > 0) {
      player.sendMessage("You search the chest, but find nothing.");
      return;
    }
    player.getInventory().adds(ICE_ARROWS_ITEM_ID, ICE_ARROWS_PER_SEARCH);
    player.sendMessage("You found some ice arrows!");
  }

  /**
   * OSRS swings the door open; the cache has no separate open loc for 93 (every
   * "Door" sharing its models keeps clip type 2 and only differs by its Open/Close
   * option), so opening it means taking the closed wall off the map: the doorway
   * tile becomes walkable and stops blocking arrows, and the removal is broadcast
   * and remembered across scene reloads like any Doors deregister.
   */
  function openFireWarriorDoorTile() {
    const { GameObject, Location, ObjectManager } = api.core;
    ObjectManager.deregister(
      new GameObject(
        FIRE_WARRIOR_DOOR_ID,
        new Location(
          FIRE_WARRIOR_DOOR_TILE.x,
          FIRE_WARRIOR_DOOR_TILE.y,
          FIRE_WARRIOR_DOOR_TILE.z
        ),
        FIRE_WARRIOR_DOOR_TYPE,
        FIRE_WARRIOR_DOOR_FACE
      ),
      true
    );
  }

  function openFireWarriorDoor(player) {
    if (quest.getStage(player) < STAGE_STARTED || quest.isComplete(player)) return;
    openFireWarriorDoorTile();
    ensureFireWarrior(player);
    startTranscript(
      api,
      player,
      FIRE_WARRIOR_NPC_ID,
      PAGE,
      "inside-the-dungeon-opening-door-in-the-fire-warrior-room"
    );
  }

  function handleObjectInteraction(event) {
    const { player, objectId, location } = event;
    if (objectId === FIRE_WARRIOR_DOOR_ID && sameTile(location, FIRE_WARRIOR_DOOR_TILE)) {
      if (quest.getStage(player) < STAGE_STARTED || quest.isComplete(player)) return;
      event.handled = true;
      openFireWarriorDoor(player);
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
    if (objectId === ICE_CHEST_ID && sameTile(location, ICE_CHEST_TILE)) {
      event.handled = true;
      openIceChest(player);
    }
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    ensureLucien(player);
  }

  function handleLogout({ player }) {
    if (player) removeSpawns(player);
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
    rewardItemId: ItemIdentifiers.BOOTS_OF_LIGHTNESS,
    rewardItemLabel: "Boots of lightness",
    otherRewards: ["Armies of Gielinor side unlocked"],
    buildJournal,
    onReward: grantReward,
  });

  api.persistAttribute(SIDE_ATTRIBUTE);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onNpcInteraction(handleNpcInteraction);
  api.onObjectInteraction(handleObjectInteraction);
  api.onCanAttack(handleCanAttack);
  api.onNpcDeath(handleFireWarriorDeath);
  api.onNpcDeath(handleLucienDeath);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
