/**
 * A Soul's Bane (members).
 *
 * The words come from the "A Soul's Bane" transcript page (the surface Tolna's
 * post-quest chat comes from the "Tolna" page's "after-a-soul-s-bane" variant,
 * which NpcDialogues plays once the quest is complete). The plugin supplies the
 * variant selector for Launa and Brana, the start hook, the rift descent, the
 * four rooms (rage, fear, confusion, hopelessness), the final Tolna fight and
 * the completion rewards.
 *
 * Stages (varbit 2011 "soulbane_prog", varp 709 bits 0-4; cache evidence:
 * `varbits.txt` / `lookup-gameval.ts varbit soulbane_prog` ->
 * "2011 soulbane_prog varp=709 bits=0-4"):
 *   1 accepted Launa's request, 2 in the room of anger, 3 anger overcome
 *   (cutscene), 4 in the room of fear, 5 fear overcome (exit lit), 6 in the room
 *   of confusion, 7 confusion overcome (final door open), 8 in the room of
 *   hopelessness, 9 bridge of hope appeared, 10 Tolna confronted, 11 Tolna's body
 *   defeated (human Tolna), 12 rescued to the surface, 13 complete.
 *
 * Sibling varbits on varps 709-712 drive the cache's multi-locs and multi-NPCs
 * (taken from `varbits.txt`):
 *   2012 fear_enemydoor, 2014-2018 confu_door1-5pres, 2019 fear_killedtally,
 *   2020 hope_bridgepres, 2021 hope_killedtally, 2022-2024 final_tol1-3dead,
 *   2025 tolna_pres (npc 2010 -> 1058), 2026 launa_pres (npc 2009 -> 1054),
 *   2028 anger_flamepres (loc 13880 -> Fire), 2029 anger_weaponmulti (loc 13993
 *   -> racks 13994-13998), 2030 fear_exitlit (loc 13898 -> 13899/13900),
 *   2031 confu_door6open (loc 13912 -> 13923/13924), 2032 riftrope_pres (loc
 *   13968 -> 13969/13970), 2035 fear_monspres, 2036 anger_damagedealt,
 *   2037-2040 confu_hitcount1-4, 2041 hope_monmes, 2042 anger_donespecial.
 * The plugin sends them so the scenery and the surface NPCs match the stage.
 *
 * Source: https://oldschool.runescape.wiki/w/A_Soul%27s_Bane and
 * https://oldschool.runescape.wiki/w/Transcript:A_Soul%27s_Bane
 * Rewards per the OSRS Wiki: 1 Quest point, 500 Defence XP, 500 Hitpoints XP,
 * 500 coins and access to Tolna's rift for combat training. (The issue summary's
 * "2 QP" does not match the wiki.) Quest requirements: a rope and a weapon.
 *
 * Gaps / approximations:
 *  - OSRS instances the whole rift. This plugin spawns owner-only NPCs in the
 *    shared cave instead and removes them on logout, as the instance would.
 *  - The final arena beyond the hope bridge is built dynamically in OSRS and has
 *    no cache map in this revision: crossing the bridge transports the player to
 *    the open floor at 3078-3096,5290-5308, where Brana and the three Tolna
 *    heads are spawned. Before the bridge appears, walking north is blocked.
 *  - The rage level is filled by kills (mirrored to soulbane_damagedealt as
 *    500 per kill, 8 kills) rather than raw damage; anger weapons only hurt
 *    their matching monster and deal x10 (onNpcHitModify). Rage-room combat
 *    still grants XP, where OSRS grants none.
 *  - Only the room of anger has its wiki "Do you wish to leave?" prompt; the
 *    other room exits return the player to the surface directly. Re-entering an
 *    incomplete room resets its live state, as OSRS restarts unfinished rooms,
 *    and logging out inside the rift sends the player back to the surface.
 *  - Confusion beasts' poison and the fear reapers' safespot behaviour are not
 *    reproduced; the 8-hit illusions, one real beast per round, the hopeless
 *    creatures' three phases and the Tolna heads are.
 *  - Post-quest, entering the rift lands the player in the empty quest rooms:
 *    this revision's static training spawns sit at x3269-3323, y9796-9850 (a
 *    separate map copy) and the wiki's post-quest rooms at x3072-3136,
 *    y5248-5311 hold no plugin spawns, so there is no working combat-training
 *    area here yet.
 */

module.exports = function registerSoulsBaneQuest(api) {
  const {
    Equipment,
    ItemIdentifiers,
    Location,
    Misc,
    NpcIdentifiers,
    ObjectIdentifiers,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, startDialogue, loadTranscripts } =
    require("../QuestRuntime");

  const PAGE = "A Soul's Bane";
  const START_HOOK = "quest:a-soul-s-bane:start";

  // ==========================================================================
  // Identifiers
  // ==========================================================================

  const LAUNA_NPC_IDS = new Set([NpcIdentifiers.LAUNA, NpcIdentifiers.LAUNA_2]); // 1054/1055
  const BRANA_NPC_ID = NpcIdentifiers.BRANA; // 1056
  const TOLNA_VOICE_NPC_ID = NpcIdentifiers.TOLNA_3; // 1059, "Tolna's Voice"
  const TOLNA_HUMAN_NPC_ID = NpcIdentifiers.TOLNA_2; // 1058
  const ANGER_BEAR_NPC_ID = NpcIdentifiers.ANGRY_BEAR; // 1060
  const ANGER_UNICORN_NPC_ID = NpcIdentifiers.ANGRY_UNICORN; // 1061
  const ANGER_GIANT_RAT_NPC_ID = NpcIdentifiers.ANGRY_GIANT_RAT; // 1062
  const ANGER_GOBLIN_NPC_ID = NpcIdentifiers.ANGRY_GOBLIN; // 1065
  const FEAR_REAPER_NPC_ID = NpcIdentifiers.FEAR_REAPER; // 1066
  const CONFUSION_BEAST_NPC_IDS = [
    NpcIdentifiers.CONFUSION_BEAST, // 1067
    NpcIdentifiers.CONFUSION_BEAST_2,
    NpcIdentifiers.CONFUSION_BEAST_3,
    NpcIdentifiers.CONFUSION_BEAST_4,
    NpcIdentifiers.CONFUSION_BEAST_5,
  ];
  const HOPELESS_PHASE_NPC_IDS = [
    NpcIdentifiers.HOPELESS_CREATURE, // 1072
    NpcIdentifiers.HOPELESS_CREATURE_2, // 1073
    NpcIdentifiers.HOPELESS_CREATURE_3, // 1074
  ];
  const TOLNA_HEAD_NPC_IDS = [
    NpcIdentifiers.TOLNA_4, // 1075
    NpcIdentifiers.TOLNA_5, // 1076
    NpcIdentifiers.TOLNA_6, // 1077
  ];

  const ROPE_ITEM_ID = ItemIdentifiers.ROPE; // 954
  const ANGER_SWORD_ITEM_ID = ItemIdentifiers.ANGER_SWORD; // 7806
  const ANGER_BATTLEAXE_ITEM_ID = ItemIdentifiers.ANGER_BATTLEAXE; // 7807
  const ANGER_MACE_ITEM_ID = ItemIdentifiers.ANGER_MACE; // 7808
  const ANGER_SPEAR_ITEM_ID = ItemIdentifiers.ANGER_SPEAR; // 7809
  const ANGER_WEAPON_ITEM_IDS = new Set([
    ANGER_SWORD_ITEM_ID,
    ANGER_SPEAR_ITEM_ID,
    ANGER_MACE_ITEM_ID,
    ANGER_BATTLEAXE_ITEM_ID,
  ]);
  /** Wiki table: sword-unicorn, spear-bear, mace-giant rat, battleaxe-goblin. */
  const ANGER_WEAPON_BY_MONSTER = new Map([
    [ANGER_UNICORN_NPC_ID, ANGER_SWORD_ITEM_ID],
    [ANGER_BEAR_NPC_ID, ANGER_SPEAR_ITEM_ID],
    [ANGER_GIANT_RAT_NPC_ID, ANGER_MACE_ITEM_ID],
    [ANGER_GOBLIN_NPC_ID, ANGER_BATTLEAXE_ITEM_ID],
  ]);
  const ANGER_WEAPON_BIT_BY_ITEM = new Map([
    [ANGER_SWORD_ITEM_ID, 1 << 0],
    [ANGER_SPEAR_ITEM_ID, 1 << 1],
    [ANGER_MACE_ITEM_ID, 1 << 2],
    [ANGER_BATTLEAXE_ITEM_ID, 1 << 3],
  ]);

  // Rifts (the surface hole; 13968 is the name-null multi-loc base).
  const RIFT_BASE_OBJECT_ID = 13968;
  const RIFT_OBJECT_IDS = new Set([
    ObjectIdentifiers.RIFT, // 13967
    RIFT_BASE_OBJECT_ID,
    ObjectIdentifiers.RIFT_2, // 13969
    ObjectIdentifiers.RIFT_3, // 13970
    ObjectIdentifiers.RIFT_4,
    ObjectIdentifiers.RIFT_5,
    ObjectIdentifiers.RIFT_6,
    ObjectIdentifiers.RIFT_7,
    ObjectIdentifiers.RIFT_8,
    ObjectIdentifiers.RIFT_9,
    ObjectIdentifiers.RIFT_10,
    ObjectIdentifiers.RIFT_11,
    ObjectIdentifiers.RIFT_12,
    ObjectIdentifiers.RIFT_13, // 13980
  ]);

  // Room of anger: 13993 is the name-null rack base, children 13994-13998.
  const WEAPON_RACK_BASE_OBJECT_ID = 13993;
  const WEAPON_RACK_OBJECT_IDS = new Set([
    WEAPON_RACK_BASE_OBJECT_ID,
    ObjectIdentifiers.WEAPON_RACK_5, // 13994
    ObjectIdentifiers.WEAPON_RACK_6,
    ObjectIdentifiers.WEAPON_RACK_7,
    ObjectIdentifiers.WEAPON_RACK_8,
    ObjectIdentifiers.WEAPON_RACK_9, // 13998
  ]);
  const ANGER_EXIT_OBJECT_ID = ObjectIdentifiers.EXIT_7; // 13882, tunnel to fear
  const RAGE_LEAVE_OBJECT_ID = ObjectIdentifiers.EXIT_5; // 13878, back to the surface

  // Room of fear.
  const DARK_HOLE_OBJECT_IDS = new Set([
    ObjectIdentifiers.DARK_HOLE_2, // 13891
    ObjectIdentifiers.DARK_HOLE_3,
    ObjectIdentifiers.DARK_HOLE_4,
    ObjectIdentifiers.DARK_HOLE_5,
    ObjectIdentifiers.DARK_HOLE_6,
    ObjectIdentifiers.DARK_HOLE_7, // 13896
  ]);
  const FEAR_EXIT_BASE_OBJECT_ID = 13898; // multi-loc base, child 13899/13900
  const FEAR_EXIT_OBJECT_IDS = new Set([
    FEAR_EXIT_BASE_OBJECT_ID,
    ObjectIdentifiers.BLACK_HOLE, // 13899
    ObjectIdentifiers.BLACK_HOLE_2, // 13900
  ]);
  const FEAR_LEAVE_OBJECT_ID = ObjectIdentifiers.EXIT_8; // 13901

  // Room of confusion: name-null multi-loc bases 13907-13912, children 13913-13924.
  const CONFUSING_DOOR_BASE_1_OBJECT_ID = 13907; // confu_door1pres
  const CONFUSING_DOOR_BASE_2_OBJECT_ID = 13908; // confu_door2pres
  const CONFUSING_DOOR_BASE_3_OBJECT_ID = 13909; // confu_door3pres
  const CONFUSING_DOOR_BASE_4_OBJECT_ID = 13910; // confu_door4pres
  const CONFUSING_DOOR_BASE_5_OBJECT_ID = 13911; // confu_door5pres
  const CONFUSING_DOOR_FINAL_BASE_OBJECT_ID = 13912; // confu_door6open, child 13923/13924
  const CONFUSING_DOOR_BASE_OBJECT_IDS = new Set([
    CONFUSING_DOOR_BASE_1_OBJECT_ID,
    CONFUSING_DOOR_BASE_2_OBJECT_ID,
    CONFUSING_DOOR_BASE_3_OBJECT_ID,
    CONFUSING_DOOR_BASE_4_OBJECT_ID,
    CONFUSING_DOOR_BASE_5_OBJECT_ID,
    CONFUSING_DOOR_FINAL_BASE_OBJECT_ID,
  ]);
  const CONFUSING_DOOR_CHILD_OBJECT_IDS = new Set([
    ObjectIdentifiers.CONFUSING_DOOR, // 13913
    ObjectIdentifiers.CONFUSING_DOOR_2,
    ObjectIdentifiers.CONFUSING_DOOR_3,
    ObjectIdentifiers.CONFUSING_DOOR_4,
    ObjectIdentifiers.CONFUSING_DOOR_5,
    ObjectIdentifiers.CONFUSING_DOOR_6,
    ObjectIdentifiers.CONFUSING_DOOR_7,
    ObjectIdentifiers.CONFUSING_DOOR_8,
    ObjectIdentifiers.CONFUSING_DOOR_9,
    ObjectIdentifiers.CONFUSING_DOOR_10,
    ObjectIdentifiers.CONFUSING_DOOR_11, // 13923
    ObjectIdentifiers.CONFUSING_DOOR_12, // 13924
  ]);
  const CONFUSION_LEAVE_OBJECT_ID = ObjectIdentifiers.EXIT_9; // 13904

  // Exits (13932/13933) and the climb-out rope.
  const HOPELESS_EXIT_OBJECT_IDS = new Set([ObjectIdentifiers.EXIT_10, ObjectIdentifiers.EXIT_11]); // 13932/13933
  const RIFT_ROPE_OBJECT_ID = ObjectIdentifiers.ROPE_19; // 13999
  const LEAVE_OBJECT_IDS = new Set([FEAR_LEAVE_OBJECT_ID, CONFUSION_LEAVE_OBJECT_ID]);

  // ==========================================================================
  // Varbits
  // ==========================================================================

  const VARBIT_SOULBANE_PROG = 2011;
  const VARBIT_FEAR_ENEMYDOOR = 2012;
  const VARBIT_CONFU_DOOR_PRESENCE_BASE = 2014; // 2014-2018, doors 1-5
  const VARBIT_FEAR_KILLEDTALLY = 2019;
  const VARBIT_HOPE_BRIDGEPRES = 2020;
  const VARBIT_HOPE_KILLEDTALLY = 2021;
  const VARBIT_FINAL_TOL_DEAD_BASE = 2022; // 2022-2024
  const VARBIT_TOLNA_PRES = 2025;
  const VARBIT_LAUNA_PRES = 2026;
  const VARBIT_ANGER_FLAMEPRES = 2028;
  const VARBIT_ANGER_WEAPONMULTI = 2029;
  const VARBIT_FEAR_EXITLIT = 2030;
  const VARBIT_CONFU_DOOR6OPEN = 2031;
  const VARBIT_RIFTROPE_PRES = 2032;
  const VARBIT_FEAR_MONSPRES = 2035;
  const VARBIT_ANGER_DAMAGEDEALT = 2036;
  const VARBIT_CONFU_HITCOUNT_BASE = 2037; // 2037-2040
  const VARBIT_HOPE_MONMES = 2041;
  const VARBIT_ANGER_DONESPECIAL = 2042;

  // ==========================================================================
  // Stages
  // ==========================================================================

  const STAGE_STARTED = 1;
  const STAGE_RAGE = 2;
  const STAGE_RAGE_DONE = 3;
  const STAGE_FEAR = 4;
  const STAGE_FEAR_DONE = 5;
  const STAGE_CONFUSION = 6;
  const STAGE_CONFUSION_DONE = 7;
  const STAGE_HOPELESS = 8;
  const STAGE_HOPELESS_DONE = 9;
  const STAGE_TOLNA = 10;
  const STAGE_TOLNA_BODY_DEAD = 11;
  const STAGE_TOLNA_SAVED = 12;
  const STAGE_COMPLETE = 13;

  const ANGER_KILLS_REQUIRED = 8;
  const FEAR_KILLS_REQUIRED = 5;
  const CONFUSION_KILLS_REQUIRED = 5;
  const CONFUSION_ILLUSION_HITS = 8;
  const HOPELESS_CREATURES_REQUIRED = 5;
  const HOPELESS_PHASE_HITPOINTS = 25;

  const TOLNA_HEADS_DEAD_MASK = 0b111;

  // ==========================================================================
  // Tiles (all verified walkable in the cache's collision map)
  // ==========================================================================

  const SURFACE_RETURN_TILE = new Location(3310, 3455, 0);
  const RAGE_ENTRY_TILE = new Location(3024, 5237, 0);
  const FEAR_ENTRY_TILE = new Location(3050, 5235, 0);
  const CONFUSION_ENTRY_TILE = new Location(3057, 5207, 0);
  const HOPELESS_ENTRY_TILE = new Location(3020, 5200, 0);
  const HOPELESS_PUSH_BACK_TILE = new Location(3021, 5198, 0);
  // The OSRS final arena has no cache map; the fight uses the post-quest room
  // at 3078-3096,5290-5308, which is open floor.
  const FINAL_ENTRY_TILE = new Location(3086, 5302, 0);
  const CAVE_MIN_X = 3000;
  const CAVE_MAX_X = 3140;
  const CAVE_MIN_Y = 5170;
  const CAVE_MAX_Y = 5310;
  const FINAL_ZONE = { minX: 3013, maxX: 3039, minY: 5185, maxY: 5190, levels: [0] };

  const ANGER_MONSTER_SPAWNS = [
    [ANGER_BEAR_NPC_ID, 3014, 5230],
    [ANGER_BEAR_NPC_ID, 3020, 5230],
    [ANGER_UNICORN_NPC_ID, 3026, 5230],
    [ANGER_UNICORN_NPC_ID, 3032, 5230],
    [ANGER_GIANT_RAT_NPC_ID, 3014, 5237],
    [ANGER_GIANT_RAT_NPC_ID, 3020, 5237],
    [ANGER_GOBLIN_NPC_ID, 3026, 5237],
    [ANGER_GOBLIN_NPC_ID, 3032, 5237],
  ];

  /** Six dark holes and the open tile in front of each (where its reaper spawns). */
  const FEAR_HOLES = [
    { x: 3046, y: 5229, frontX: 3048, frontY: 5229 },
    { x: 3046, y: 5239, frontX: 3048, frontY: 5239 },
    { x: 3052, y: 5219, frontX: 3052, frontY: 5220 },
    { x: 3063, y: 5219, frontX: 3063, frontY: 5220 },
    { x: 3065, y: 5245, frontX: 3065, frontY: 5244 },
    { x: 3068, y: 5227, frontX: 3066, frontY: 5227 },
  ];

  const CONFUSION_SPAWNS = [
    [3050, 5192],
    [3060, 5192],
    [3048, 5198],
    [3058, 5198],
    [3055, 5204],
  ];

  const HOPELESS_SPAWNS = [
    [3014, 5198],
    [3020, 5198],
    [3026, 5198],
    [3032, 5198],
    [3020, 5210],
  ];

  const BRANA_SPAWN = [3094, 5304];
  const HUMAN_TOLNA_SPAWN = [3082, 5299];
  const TOLNA_HEAD_SPAWNS = [
    [3080, 5295],
    [3086, 5295],
    [3092, 5295],
  ];

  // ==========================================================================
  // Attribute keys
  // ==========================================================================

  const WEAPON_BITS_ATTRIBUTE = "souls-bane:weapon-bits";
  const RAGE_KILLS_ATTRIBUTE = "souls-bane:rage-kills";
  const FEAR_TALLY_ATTRIBUTE = "souls-bane:fear-tally";
  const FEAR_HOLE_ATTRIBUTE = "souls-bane:fear-hole";
  const ROPE_ATTACHED_ATTRIBUTE = "souls-bane:rope-attached";
  const CONFUSION_TALLY_ATTRIBUTE = "souls-bane:confusion-tally";
  const HOPELESS_TALLY_ATTRIBUTE = "souls-bane:hopeless-tally";
  const TOLNA_HEADS_ATTRIBUTE = "souls-bane:tolna-heads";

  // ==========================================================================
  // Per-player spawned NPC bookkeeping (the owner-only cave instance)
  // ==========================================================================

  let quest;
  const npcsByPlayer = new Map();
  const npcMeta = new Map();

  function trackNpc(player, npc, meta) {
    if (!npc) return null;
    meta.player = player;
    meta.npc = npc;
    npcMeta.set(npc, meta);
    let owned = npcsByPlayer.get(player);
    if (!owned) {
      owned = new Set();
      npcsByPlayer.set(player, owned);
    }
    owned.add(npc);
    return npc;
  }

  function isOwnedNpc(player, npc) {
    return npcsByPlayer.get(player)?.has(npc) === true;
  }

  function hasNpcOfKind(player, kind) {
    const owned = npcsByPlayer.get(player);
    if (!owned) return false;
    for (const npc of owned) {
      if (npcMeta.get(npc)?.kind === kind) return true;
    }
    return false;
  }

  function removeNpcsOfKind(player, kind) {
    const owned = npcsByPlayer.get(player);
    if (!owned) return;
    for (const npc of [...owned]) {
      const meta = npcMeta.get(npc);
      if (meta?.kind !== kind && kind !== null) continue;
      owned.delete(npc);
      npcMeta.delete(npc);
      api.removeNpc(npc);
    }
  }

  function clearOwnedNpcs(player) {
    removeNpcsOfKind(player, null);
    npcsByPlayer.delete(player);
  }

  // ==========================================================================
  // Small helpers
  // ==========================================================================

  function setVarbit(player, varbitId, value) {
    player.getPacketSender().sendVarbit(varbitId, value | 0);
  }

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull()
        ? 0
        : 28;
  }

  function held(player, itemId) {
    return player.getInventory().getAmount(itemId) > 0;
  }

  function attribute(player, key) {
    return Number(player.getAttribute(key)) || 0;
  }

  function resolvedObjectId(event) {
    if (event.definition?.id != null) return event.definition.id;
    return event.objectId;
  }

  function moveTo(player, tile) {
    player.moveTo(new Location(tile.getX(), tile.getY(), tile.getZ()));
  }

  function inCave(player) {
    const location = player.getLocation();
    return (
      location.getX() >= CAVE_MIN_X &&
      location.getX() <= CAVE_MAX_X &&
      location.getY() >= CAVE_MIN_Y &&
      location.getY() <= CAVE_MAX_Y
    );
  }

  // ==========================================================================
  // Rage room
  // ==========================================================================

  function weaponBits(player) {
    return attribute(player, WEAPON_BITS_ATTRIBUTE);
  }

  function syncWeaponVarbit(player) {
    let taken = 0;
    for (const bit of ANGER_WEAPON_BIT_BY_ITEM.values()) {
      if ((weaponBits(player) & bit) !== 0) taken++;
    }
    setVarbit(player, VARBIT_ANGER_WEAPONMULTI, taken);
  }

  function heldAngerWeapon(player) {
    for (const itemId of ANGER_WEAPON_ITEM_IDS) {
      if (held(player, itemId)) return itemId;
    }
    return -1;
  }

  function returnAngerWeapon(player, itemId) {
    const heldItem = itemId ?? heldAngerWeapon(player);
    if (heldItem === -1) return;
    player.getInventory().deleteNumber(heldItem, 1);
    player.setAttribute(
      WEAPON_BITS_ATTRIBUTE,
      weaponBits(player) & ~ANGER_WEAPON_BIT_BY_ITEM.get(heldItem)
    );
    syncWeaponVarbit(player);
  }

  function takeAngerWeapon(player, itemId) {
    if (quest.getStage(player) !== STAGE_RAGE || quest.isComplete(player)) return;
    const bit = ANGER_WEAPON_BIT_BY_ITEM.get(itemId);
    if ((weaponBits(player) & bit) !== 0) {
      player.sendMessage("You already took that weapon from the rack.");
      return;
    }
    if (freeSlots(player) < 1) {
      player.sendMessage("You need a free inventory slot to take a weapon.");
      return;
    }
    returnAngerWeapon(player);
    player.getInventory().adds(itemId, 1);
    player.setAttribute(WEAPON_BITS_ATTRIBUTE, weaponBits(player) | bit);
    syncWeaponVarbit(player);
  }

  function spawnAngerMonsters(player) {
    for (const [npcId, x, y] of ANGER_MONSTER_SPAWNS) {
      const npc = api.spawnNpc({
        id: npcId,
        x,
        y,
        z: 0,
        wanderRadius: 2,
        owner: player,
        ownerOnly: true,
      });
      trackNpc(player, npc, { kind: "anger", monsterId: npcId });
    }
  }

  function resetRageRoom(player) {
    removeNpcsOfKind(player, "anger");
    player.setAttribute(RAGE_KILLS_ATTRIBUTE, 0);
    player.setAttribute(WEAPON_BITS_ATTRIBUTE, 0);
    setVarbit(player, VARBIT_ANGER_DAMAGEDEALT, 0);
    setVarbit(player, VARBIT_ANGER_WEAPONMULTI, 0);
    setVarbit(player, VARBIT_ANGER_FLAMEPRES, 0);
    setVarbit(player, VARBIT_ANGER_DONESPECIAL, 0);
    spawnAngerMonsters(player);
  }

  function completeRage(player) {
    if (quest.getStage(player) !== STAGE_RAGE) return;
    quest.setStage(player, STAGE_RAGE_DONE);
    removeNpcsOfKind(player, "anger");
    setVarbit(player, VARBIT_ANGER_FLAMEPRES, 1);
    setVarbit(player, VARBIT_ANGER_DONESPECIAL, 1);
    player.getSkillManager().addExperiences(Skill.ATTACK, 40);
    startTranscript(api, player, TOLNA_VOICE_NPC_ID, PAGE, "room-of-rage-after-filling-the-rage-level");
  }

  function onAngerKill(player) {
    if (quest.getStage(player) !== STAGE_RAGE) return;
    const kills = attribute(player, RAGE_KILLS_ATTRIBUTE) + 1;
    player.setAttribute(RAGE_KILLS_ATTRIBUTE, kills);
    setVarbit(player, VARBIT_ANGER_DAMAGEDEALT, Math.min(4095, kills * 500));
    if (kills >= ANGER_KILLS_REQUIRED) completeRage(player);
  }

  // ==========================================================================
  // Fear room
  // ==========================================================================

  function rerollFearHole(player) {
    const current = attribute(player, FEAR_HOLE_ATTRIBUTE);
    let next = Misc.randomInclusive(0, FEAR_HOLES.length - 1);
    if (next === current) next = (next + 1) % FEAR_HOLES.length;
    player.setAttribute(FEAR_HOLE_ATTRIBUTE, next);
    setVarbit(player, VARBIT_FEAR_ENEMYDOOR, next);
  }

  function resetFearRoom(player) {
    removeNpcsOfKind(player, "reaper");
    player.setAttribute(FEAR_TALLY_ATTRIBUTE, 0);
    setVarbit(player, VARBIT_FEAR_KILLEDTALLY, 0);
    setVarbit(player, VARBIT_FEAR_MONSPRES, 0);
    setVarbit(player, VARBIT_FEAR_EXITLIT, quest.getStage(player) >= STAGE_FEAR_DONE ? 1 : 0);
    rerollFearHole(player);
  }

  function lookInsideHole(event) {
    event.handled = true;
    const { player, location } = event;
    if (quest.getStage(player) !== STAGE_FEAR) {
      player.sendMessage("There is nothing of interest in there.");
      return;
    }
    if (hasNpcOfKind(player, "reaper")) {
      player.sendMessage("Something is already lurking in one of these holes.");
      return;
    }
    const index = FEAR_HOLES.findIndex((hole) => hole.x === location.x && hole.y === location.y);
    if (index === -1) return;
    if (index !== attribute(player, FEAR_HOLE_ATTRIBUTE)) {
      startTranscript(api, player, FEAR_REAPER_NPC_ID, PAGE, "room-of-fear-look-inside-dark-holes");
      return;
    }
    const hole = FEAR_HOLES[index];
    const npc = api.spawnNpc({
      id: FEAR_REAPER_NPC_ID,
      x: hole.frontX,
      y: hole.frontY,
      z: 0,
      wanderRadius: 1,
      owner: player,
      ownerOnly: true,
    });
    trackNpc(player, npc, { kind: "reaper" });
    setVarbit(player, VARBIT_FEAR_MONSPRES, 1);
    rerollFearHole(player);
    startTranscript(api, player, FEAR_REAPER_NPC_ID, PAGE, "room-of-fear-look-inside-dark-holes");
  }

  const FEAR_KILL_VARIANTS = new Map([
    [1, "room-of-fear-after-killing-the-first-reaper"],
    [2, "room-of-fear-after-killing-the-second-reaper"],
    [3, "room-of-fear-after-killing-the-third-reaper"],
    [4, "room-of-fear-after-killing-the-forth-reaper"],
  ]);

  function onReaperKill(player) {
    setVarbit(player, VARBIT_FEAR_MONSPRES, 0);
    if (quest.getStage(player) !== STAGE_FEAR) return;
    const tally = attribute(player, FEAR_TALLY_ATTRIBUTE) + 1;
    player.setAttribute(FEAR_TALLY_ATTRIBUTE, tally);
    setVarbit(player, VARBIT_FEAR_KILLEDTALLY, tally);
    if (tally >= FEAR_KILLS_REQUIRED) {
      setVarbit(player, VARBIT_FEAR_EXITLIT, 1);
      quest.setStage(player, STAGE_FEAR_DONE);
      startTranscript(api, player, FEAR_REAPER_NPC_ID, PAGE, "room-of-fear-after-killing-the-last-reaper");
      return;
    }
    startTranscript(api, player, FEAR_REAPER_NPC_ID, PAGE, FEAR_KILL_VARIANTS.get(tally));
  }

  // ==========================================================================
  // Confusion room
  // ==========================================================================

  function syncConfusionDoors(player) {
    const tally = attribute(player, CONFUSION_TALLY_ATTRIBUTE);
    for (let door = 1; door <= 5; door++) {
      setVarbit(player, VARBIT_CONFU_DOOR_PRESENCE_BASE + (door - 1), tally >= door ? 1 : 0);
    }
    setVarbit(player, VARBIT_CONFU_DOOR6OPEN, quest.getStage(player) >= STAGE_CONFUSION_DONE ? 1 : 0);
  }

  function spawnConfusionRound(player) {
    removeNpcsOfKind(player, "confusion");
    const realIndex = Misc.randomInclusive(0, CONFUSION_SPAWNS.length - 1);
    CONFUSION_SPAWNS.forEach(([x, y], index) => {
      const npc = api.spawnNpc({
        id: CONFUSION_BEAST_NPC_IDS[index],
        x,
        y,
        z: 0,
        wanderRadius: 3,
        owner: player,
        ownerOnly: true,
      });
      trackNpc(player, npc, { kind: "confusion", illusion: index !== realIndex, hits: 0 });
    });
  }

  function resetConfusionRoom(player) {
    player.setAttribute(CONFUSION_TALLY_ATTRIBUTE, 0);
    syncConfusionDoors(player);
    spawnConfusionRound(player);
  }

  function vanishIllusion(meta) {
    if (meta.vanished) return;
    meta.vanished = true;
    const { player, npc } = meta;
    npcsByPlayer.get(player)?.delete(npc);
    npcMeta.delete(npc);
    api.removeNpc(npc);
    setVarbit(player, VARBIT_CONFU_HITCOUNT_BASE, Math.min(15, meta.hits));
    startTranscript(api, player, CONFUSION_BEAST_NPC_IDS[0], PAGE, "room-of-confusion-killing-a-confusion-beast");
  }

  function onConfusionBeastKill(player, meta) {
    if (meta.illusion || quest.getStage(player) !== STAGE_CONFUSION) return;
    const tally = attribute(player, CONFUSION_TALLY_ATTRIBUTE) + 1;
    player.setAttribute(CONFUSION_TALLY_ATTRIBUTE, tally);
    removeNpcsOfKind(player, "confusion");
    if (tally >= CONFUSION_KILLS_REQUIRED) {
      quest.setStage(player, STAGE_CONFUSION_DONE);
      syncConfusionDoors(player);
      startTranscript(api, player, CONFUSION_BEAST_NPC_IDS[0], PAGE, "room-of-confusion-after-revealing-the-final-door");
      return;
    }
    syncConfusionDoors(player);
    startTranscript(
      api,
      player,
      CONFUSION_BEAST_NPC_IDS[0],
      PAGE,
      "room-of-confusion-killing-the-last-confusion-beast-each-time"
    );
    spawnConfusionRound(player);
  }

  // ==========================================================================
  // Hopeless room
  // ==========================================================================

  function spawnHopelessCreatures(player) {
    removeNpcsOfKind(player, "hopeless");
    for (const [x, y] of HOPELESS_SPAWNS) {
      const npc = api.spawnNpc({
        id: HOPELESS_PHASE_NPC_IDS[0],
        x,
        y,
        z: 0,
        wanderRadius: 2,
        owner: player,
        ownerOnly: true,
      });
      trackNpc(player, npc, { kind: "hopeless", phase: 1 });
    }
  }

  function resetHopelessRoom(player) {
    player.setAttribute(HOPELESS_TALLY_ATTRIBUTE, 0);
    setVarbit(player, VARBIT_HOPE_KILLEDTALLY, 0);
    setVarbit(player, VARBIT_HOPE_MONMES, 0);
    setVarbit(player, VARBIT_HOPE_BRIDGEPRES, quest.getStage(player) >= STAGE_HOPELESS_DONE ? 1 : 0);
    spawnHopelessCreatures(player);
  }

  const HOPELESS_KILL_VARIANTS = new Map([
    [1, "room-of-hopelessness-after-killing-the-first-hopeless-creature"],
    [2, "room-of-hopelessness-after-killing-the-second-hopeless-creature"],
    [3, "room-of-hopelessness-after-killing-the-third-hopeless-creature"],
    [4, "room-of-hopelessness-after-killing-the-fourth-hopeless-creature"],
  ]);

  function onHopelessCreatureKill(player) {
    if (quest.getStage(player) !== STAGE_HOPELESS) return;
    const tally = attribute(player, HOPELESS_TALLY_ATTRIBUTE) + 1;
    player.setAttribute(HOPELESS_TALLY_ATTRIBUTE, tally);
    setVarbit(player, VARBIT_HOPE_KILLEDTALLY, tally);
    if (tally >= HOPELESS_CREATURES_REQUIRED) {
      setVarbit(player, VARBIT_HOPE_BRIDGEPRES, 1);
      quest.setStage(player, STAGE_HOPELESS_DONE);
      startTranscript(
        api,
        player,
        HOPELESS_PHASE_NPC_IDS[0],
        PAGE,
        "room-of-hopelessness-after-killing-the-last-hopeless-creature"
      );
      return;
    }
    startTranscript(api, player, HOPELESS_PHASE_NPC_IDS[0], PAGE, HOPELESS_KILL_VARIANTS.get(tally));
  }

  // ==========================================================================
  // Final room (Tolna)
  // ==========================================================================

  function spawnBrana(player) {
    if (hasNpcOfKind(player, "brana")) return;
    const [x, y] = BRANA_SPAWN;
    const npc = api.spawnNpc({
      id: BRANA_NPC_ID,
      x,
      y,
      z: 0,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    trackNpc(player, npc, { kind: "brana" });
  }

  function spawnHumanTolna(player) {
    if (hasNpcOfKind(player, "tolna-human")) return;
    const [x, y] = HUMAN_TOLNA_SPAWN;
    const npc = api.spawnNpc({
      id: TOLNA_HUMAN_NPC_ID,
      x,
      y,
      z: 0,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    trackNpc(player, npc, { kind: "tolna-human" });
  }

  function spawnTolnaHeads(player) {
    TOLNA_HEAD_SPAWNS.forEach(([x, y], index) => {
      const npc = api.spawnNpc({
        id: TOLNA_HEAD_NPC_IDS[index],
        x,
        y,
        z: 0,
        wanderRadius: 0,
        owner: player,
        ownerOnly: true,
      });
      trackNpc(player, npc, { kind: "tolna", headIndex: index });
    });
  }

  function syncTolnaVarbits(player) {
    const dead = attribute(player, TOLNA_HEADS_ATTRIBUTE);
    for (let index = 0; index < TOLNA_HEAD_NPC_IDS.length; index++) {
      setVarbit(player, VARBIT_FINAL_TOL_DEAD_BASE + index, dead & (1 << index) ? 1 : 0);
    }
  }

  function startFinalEncounter(player) {
    quest.setStage(player, STAGE_TOLNA);
    player.setAttribute(TOLNA_HEADS_ATTRIBUTE, 0);
    syncTolnaVarbits(player);
    moveTo(player, FINAL_ENTRY_TILE);
    spawnBrana(player);
    spawnTolnaHeads(player);
    playFlatVariant(player, BRANA_NPC_ID, "finding-tolna");
  }

  /** Re-creates missing quest NPCs for a player already in the final room. */
  function ensureFinalNpcs(player) {
    const stage = quest.getStage(player);
    if (stage === STAGE_TOLNA) {
      spawnBrana(player);
      if (!hasNpcOfKind(player, "tolna")) spawnTolnaHeads(player);
      return;
    }
    if (stage >= STAGE_TOLNA_BODY_DEAD && stage < STAGE_COMPLETE) {
      spawnBrana(player);
      spawnHumanTolna(player);
    }
  }

  function onTolnaHeadKill(player, meta) {
    if (quest.getStage(player) !== STAGE_TOLNA) return;
    const dead = attribute(player, TOLNA_HEADS_ATTRIBUTE) | (1 << meta.headIndex);
    player.setAttribute(TOLNA_HEADS_ATTRIBUTE, dead);
    setVarbit(player, VARBIT_FINAL_TOL_DEAD_BASE + meta.headIndex, 1);
    if ((dead & TOLNA_HEADS_DEAD_MASK) !== TOLNA_HEADS_DEAD_MASK) return;
    removeNpcsOfKind(player, "tolna");
    quest.setStage(player, STAGE_TOLNA_BODY_DEAD);
    spawnHumanTolna(player);
    startTranscript(
      api,
      player,
      TOLNA_HUMAN_NPC_ID,
      PAGE,
      "finding-tolna-after-defeating-tolna-s-body"
    );
  }

  /** The final conversation ends with the player being transported to the surface. */
  function rescueToSurface(player) {
    clearOwnedNpcs(player);
    setVarbit(player, VARBIT_TOLNA_PRES, 1);
    setVarbit(player, VARBIT_LAUNA_PRES, 1);
    quest.setStage(player, STAGE_TOLNA_SAVED);
    moveTo(player, SURFACE_RETURN_TILE);
  }

  // ==========================================================================
  // Transcripts
  // ==========================================================================

  /**
   * Plays a flat variant from the page with full control over its steps: the wiki
   * marks Tolna's cutscene replies "unavailable" (they would abort the chat), so
   * those are dropped, and `end` is left to whatever action follows.
   */
  function playFlatVariant(player, npcId, variantName) {
    const record = loadTranscripts(api)?.[PAGE];
    const raw = record?.variants?.[variantName];
    if (!Array.isArray(raw)) return false;
    const steps = [];
    for (const step of raw) {
      if (typeof step.player === "string") {
        steps.push({ player: [step.player] });
      } else if (step.type === "line" && typeof step.text === "string") {
        steps.push({ npc: [step.text] });
      } else if (typeof step.npc === "string") {
        steps.push({ npc: [step.npc] });
      } else if (step.type === "action" && step.id === "yRpBoz") {
        steps.push({ exec: (execPlayer) => rescueToSurface(execPlayer) });
      }
    }
    if (steps.length === 0) return false;
    startDialogue(api, player, { npcId }, steps);
    return true;
  }

  /** Which transcript variant each tracked speaker plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (LAUNA_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return null;
      if (stage >= STAGE_TOLNA_BODY_DEAD) return "finding-tolna-talking-to-launa-after-defeating-tolna-s-body";
      if (stage >= STAGE_TOLNA) return "finding-tolna-talking-to-launa";
      if (stage >= STAGE_HOPELESS_DONE) return "room-of-hopelessness-launa-after-the-hopelessness-room";
      if (stage >= STAGE_HOPELESS) return "room-of-hopelessness-talking-to-launa-after-entering-the-room-of-hopelessness";
      if (stage >= STAGE_CONFUSION_DONE) return "room-of-confusion-talking-to-launa-after-completing-the-confusion-room";
      if (stage >= STAGE_CONFUSION) return "room-of-confusion-talking-to-launa-after-entering-the-room-of-confusion";
      if (stage >= STAGE_FEAR_DONE) return "room-of-fear-talking-to-launa-after-completing-the-room-of-fear";
      if (stage >= STAGE_FEAR) return "room-of-fear-talking-to-launa-after-entering-the-room-of-fear";
      if (stage >= STAGE_RAGE_DONE) return "room-of-rage-talking-to-launa-after-watching-the-cutscene-of-tolna-leaving";
      if (stage >= STAGE_RAGE) return "room-of-rage-talking-to-launa-after-entering-the-room-of-fear";
      if (stage >= STAGE_STARTED) return "talking-with-launa-to-start-talking-with-launa-before-going-down";
      return "talking-with-launa-to-start";
    }
    if (npcId === BRANA_NPC_ID) {
      if (stage >= STAGE_TOLNA_BODY_DEAD) return "finding-tolna-talking-to-brana-after-defeating-tolna-s-body";
      if (stage >= STAGE_TOLNA || stage >= STAGE_HOPELESS_DONE) return "finding-tolna-talking-to-brana";
      return null;
    }
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (hook !== START_HOOK) return;
    if (!LAUNA_NPC_IDS.has(npcId)) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  /** Step ids on the "A Soul's Bane" page that carry a quest side effect. */
  function handleDialogueAction(event) {
    const { player, stepId } = event;
    if (!stepId) return;
    switch (stepId) {
      case "XKAe5W":
        event.handled = true;
        takeAngerWeapon(player, ANGER_SWORD_ITEM_ID);
        return;
      case "8rLjvM":
        event.handled = true;
        takeAngerWeapon(player, ANGER_SPEAR_ITEM_ID);
        return;
      case "Xld8iR":
        event.handled = true;
        takeAngerWeapon(player, ANGER_MACE_ITEM_ID);
        return;
      case "ezxOLM":
        event.handled = true;
        takeAngerWeapon(player, ANGER_BATTLEAXE_ITEM_ID);
        return;
      case "eR_gdp":
        event.handled = true;
        returnAngerWeapon(player);
        return;
      case "A8xOC8":
      case "S7W_C7":
      case "tu3BVs":
      case "7plMsC":
      case "YfCAkM":
      case "qg2OEC":
      case "cX-dFd":
      case "p9LxXG":
      case "aVOAK9":
      case "b-rzL6":
        event.handled = true;
        return;
      case "L5OhWd":
        event.handled = true;
        removeNpcsOfKind(player, "anger");
        return;
      case "ROYjyj":
        event.handled = true;
        event.end = true;
        return;
      case "dTo8zi":
        event.handled = true;
        leaveToSurface(player);
        return;
      case "8Wy3kE":
        event.handled = true;
        player.sendMessage("Tolna's human body appears on the narrow path.");
        return;
      case "yRpBoz":
        event.handled = true;
        event.end = true;
        rescueToSurface(player);
        return;
      case "xHblVY":
        event.handled = true;
        event.end = true;
        if (!quest.isComplete(player)) quest.complete(player);
        return;
      default:
        return;
    }
  }

  /** The surface Tolna's completion chat, and the underground human Tolna. */
  function talkToTolna({ player, npc, npcId }) {
    if (npcId !== TOLNA_HUMAN_NPC_ID) return;
    const stage = quest.getStage(player);
    if (isOwnedNpc(player, npc)) {
      if (stage === STAGE_TOLNA_BODY_DEAD) {
        // Flat playback: the variant's `end` would otherwise cut off its teleport action.
        playFlatVariant(player, TOLNA_HUMAN_NPC_ID, "finding-tolna-talking-to-human-tolna");
      }
      return;
    }
    if (stage === STAGE_TOLNA_SAVED && !quest.isComplete(player)) {
      startTranscript(api, player, TOLNA_HUMAN_NPC_ID, PAGE, "talking-to-tolna-on-the-surface");
      return;
    }
    // Post-quest chat falls through to the "Tolna" page's after-a-soul-s-bane variant.
    return false;
  }

  // ==========================================================================
  // Room transitions
  // ==========================================================================

  function enterRoom(player) {
    const stage = quest.getStage(player);
    if (stage <= STAGE_RAGE) {
      if (stage === STAGE_RAGE) resetRageRoom(player);
      moveTo(player, RAGE_ENTRY_TILE);
      return;
    }
    if (stage === STAGE_RAGE_DONE) {
      quest.setStage(player, STAGE_FEAR);
      resetFearRoom(player);
      moveTo(player, FEAR_ENTRY_TILE);
      startTranscript(api, player, TOLNA_VOICE_NPC_ID, PAGE, "room-of-fear");
      return;
    }
    if (stage === STAGE_FEAR) {
      resetFearRoom(player);
      moveTo(player, FEAR_ENTRY_TILE);
      return;
    }
    if (stage === STAGE_FEAR_DONE) {
      quest.setStage(player, STAGE_CONFUSION);
      resetConfusionRoom(player);
      moveTo(player, CONFUSION_ENTRY_TILE);
      startTranscript(api, player, TOLNA_VOICE_NPC_ID, PAGE, "room-of-confusion");
      return;
    }
    if (stage === STAGE_CONFUSION) {
      resetConfusionRoom(player);
      moveTo(player, CONFUSION_ENTRY_TILE);
      return;
    }
    if (stage === STAGE_CONFUSION_DONE) {
      quest.setStage(player, STAGE_HOPELESS);
      resetHopelessRoom(player);
      moveTo(player, HOPELESS_ENTRY_TILE);
      startTranscript(api, player, TOLNA_VOICE_NPC_ID, PAGE, "room-of-hopelessness");
      return;
    }
    if (stage === STAGE_HOPELESS) {
      resetHopelessRoom(player);
      moveTo(player, HOPELESS_ENTRY_TILE);
      return;
    }
    if (stage === STAGE_HOPELESS_DONE) {
      moveTo(player, HOPELESS_ENTRY_TILE);
      return;
    }
    if (stage <= STAGE_TOLNA_BODY_DEAD) {
      ensureFinalNpcs(player);
      moveTo(player, FINAL_ENTRY_TILE);
      return;
    }
    // Post-rescue, entering the rift lands in the (empty) post-quest rooms.
    moveTo(player, RAGE_ENTRY_TILE);
  }

  function descendRift(event) {
    event.handled = true;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED) {
      player.sendMessage("You should speak to Launa first.");
      return;
    }
    if (quest.isComplete(player)) {
      moveTo(player, RAGE_ENTRY_TILE);
      // Varrock medium: entering Tolna's rift after A Soul's Bane.
      api.emitCustomEvent("diary:task", { player, diary: "varrock", task: "enter-the-tolna-dungeon-after-completing-a-soul" });
      return;
    }
    if (!attribute(player, ROPE_ATTACHED_ATTRIBUTE)) {
      if (!held(player, ROPE_ITEM_ID)) {
        player.sendMessage("You need a rope to climb down the rift.");
        return;
      }
      player.getInventory().deleteNumber(ROPE_ITEM_ID, 1);
      player.setAttribute(ROPE_ATTACHED_ATTRIBUTE, 1);
      setVarbit(player, VARBIT_RIFTROPE_PRES, 1);
    }
    if (stage === STAGE_STARTED) {
      quest.setStage(player, STAGE_RAGE);
      startTranscript(api, player, TOLNA_VOICE_NPC_ID, PAGE, "room-of-rage");
    } else if (stage === STAGE_FEAR) {
      startTranscript(api, player, TOLNA_VOICE_NPC_ID, PAGE, "room-of-fear-re-entering-the-room-of-fear");
    }
    enterRoom(player);
  }

  function leaveToSurface(player) {
    clearOwnedNpcs(player);
    moveTo(player, SURFACE_RETURN_TILE);
  }

  function climbOut(event) {
    event.handled = true;
    leaveToSurface(event.player);
  }

  function leaveRageRoom(event) {
    event.handled = true;
    startTranscript(api, event.player, TOLNA_VOICE_NPC_ID, PAGE, "room-of-rage-leaving-the-room");
  }

  function enterAngerExit(event) {
    event.handled = true;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_RAGE_DONE) {
      player.sendMessage("The tunnel is sealed by the anger of this place.");
      return;
    }
    if (stage === STAGE_RAGE_DONE) {
      quest.setStage(player, STAGE_FEAR);
      resetFearRoom(player);
      moveTo(player, FEAR_ENTRY_TILE);
      startTranscript(api, player, TOLNA_VOICE_NPC_ID, PAGE, "room-of-fear");
      return;
    }
    if (stage === STAGE_FEAR) resetFearRoom(player);
    moveTo(player, FEAR_ENTRY_TILE);
  }

  function enterFearExit(event) {
    event.handled = true;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_FEAR_DONE) {
      player.sendMessage("It is far too dark to go in there.");
      return;
    }
    if (stage === STAGE_FEAR_DONE) {
      quest.setStage(player, STAGE_CONFUSION);
      resetConfusionRoom(player);
      moveTo(player, CONFUSION_ENTRY_TILE);
      startTranscript(api, player, TOLNA_VOICE_NPC_ID, PAGE, "room-of-confusion");
      return;
    }
    if (stage === STAGE_CONFUSION) resetConfusionRoom(player);
    moveTo(player, CONFUSION_ENTRY_TILE);
  }

  function enterConfusingDoor(event) {
    event.handled = true;
    const { player } = event;
    const rawId = event.objectId;
    const resolvedId = resolvedObjectId(event);
    const isFinalDoor =
      rawId === CONFUSING_DOOR_FINAL_BASE_OBJECT_ID ||
      resolvedId === ObjectIdentifiers.CONFUSING_DOOR_11 ||
      resolvedId === ObjectIdentifiers.CONFUSING_DOOR_12;
    const stage = quest.getStage(player);
    if (stage < STAGE_CONFUSION) {
      player.sendMessage("The door leads nowhere. How confusing.");
      return;
    }
    if (!isFinalDoor) {
      player.sendMessage("The door leads nowhere. How confusing.");
      return;
    }
    if (stage < STAGE_CONFUSION_DONE) {
      player.sendMessage("The door is sealed tight.");
      return;
    }
    if (stage === STAGE_CONFUSION_DONE) {
      quest.setStage(player, STAGE_HOPELESS);
      resetHopelessRoom(player);
      moveTo(player, HOPELESS_ENTRY_TILE);
      startTranscript(api, player, TOLNA_VOICE_NPC_ID, PAGE, "room-of-hopelessness");
      return;
    }
    if (stage === STAGE_HOPELESS) resetHopelessRoom(player);
    moveTo(player, HOPELESS_ENTRY_TILE);
  }

  function handleFinalZoneEnter({ player }) {
    const stage = quest.getStage(player);
    if (stage < STAGE_HOPELESS_DONE) {
      moveTo(player, HOPELESS_PUSH_BACK_TILE);
      player.sendMessage("The bridge of hope has not appeared yet.");
      return;
    }
    if (stage === STAGE_HOPELESS_DONE) {
      startFinalEncounter(player);
      return;
    }
    ensureFinalNpcs(player);
  }

  // ==========================================================================
  // Combat
  // ==========================================================================

  function handleNpcHitModify(event) {
    const meta = npcMeta.get(event.npc);
    if (!meta) return;
    if (meta.kind === "anger") {
      const attacker = event.hit.getAttacker?.();
      if (attacker !== meta.player) {
        for (const hit of event.hit.getHits()) hit.setDamage(0);
        event.hit.updateTotalDamage?.();
        return;
      }
      const weapon = attacker.getEquipment?.().get?.(Equipment.WEAPON_SLOT);
      const weaponId = weapon?.getId?.();
      if (weaponId !== ANGER_WEAPON_BY_MONSTER.get(meta.monsterId)) {
        for (const hit of event.hit.getHits()) hit.setDamage(0);
        event.hit.updateTotalDamage?.();
        return;
      }
      for (const hit of event.hit.getHits()) hit.setDamage(hit.getDamage() * 10);
      event.hit.updateTotalDamage?.();
      return;
    }
    if (meta.kind === "confusion" && meta.illusion && !meta.vanished) {
      for (const hit of event.hit.getHits()) hit.setDamage(0);
      event.hit.updateTotalDamage?.();
      meta.hits = (meta.hits ?? 0) + 1;
      if (meta.hits >= CONFUSION_ILLUSION_HITS) vanishIllusion(meta);
    }
  }

  function handleNpcBeforeDeath(event) {
    const meta = npcMeta.get(event.npc);
    if (!meta || meta.kind !== "hopeless") return;
    if (meta.phase >= HOPELESS_PHASE_NPC_IDS.length) return;
    event.preventDeath = true;
    meta.phase += 1;
    event.npc.setNpcTransformationId(HOPELESS_PHASE_NPC_IDS[meta.phase - 1]);
    event.npc.setHitpoints(HOPELESS_PHASE_HITPOINTS);
    event.npc.getCombat?.()?.reset?.();
    event.npc.getCombat?.()?.getHitQueue?.()?.clear?.();
  }

  function handleNpcDeath(event) {
    const meta = npcMeta.get(event.npc);
    if (!meta) return;
    const { player } = meta;
    npcMeta.delete(event.npc);
    npcsByPlayer.get(player)?.delete(event.npc);
    switch (meta.kind) {
      case "anger":
        onAngerKill(player);
        return;
      case "reaper":
        onReaperKill(player);
        return;
      case "confusion":
        onConfusionBeastKill(player, meta);
        return;
      case "hopeless":
        onHopelessCreatureKill(player);
        return;
      case "tolna":
        onTolnaHeadKill(player, meta);
        return;
      default:
        return;
    }
  }

  // ==========================================================================
  // Object interaction
  // ==========================================================================

  function handleObjectInteraction(event) {
    const objectId = resolvedObjectId(event);
    const rawId = event.objectId;
    if (RIFT_OBJECT_IDS.has(objectId) || rawId === RIFT_BASE_OBJECT_ID) {
      descendRift(event);
      return;
    }
    if (WEAPON_RACK_OBJECT_IDS.has(objectId) || rawId === WEAPON_RACK_BASE_OBJECT_ID) {
      event.handled = true;
      if (quest.getStage(event.player) !== STAGE_RAGE) {
        event.player.sendMessage("You have no reason to take a weapon from the rack.");
        return;
      }
      startTranscript(api, event.player, TOLNA_VOICE_NPC_ID, PAGE, "room-of-rage-weapon-rack");
      return;
    }
    if (DARK_HOLE_OBJECT_IDS.has(objectId)) {
      lookInsideHole(event);
      return;
    }
    if (FEAR_EXIT_OBJECT_IDS.has(objectId) || rawId === FEAR_EXIT_BASE_OBJECT_ID) {
      enterFearExit(event);
      return;
    }
    if (
      CONFUSING_DOOR_BASE_OBJECT_IDS.has(rawId) ||
      CONFUSING_DOOR_BASE_OBJECT_IDS.has(objectId) ||
      CONFUSING_DOOR_CHILD_OBJECT_IDS.has(objectId)
    ) {
      enterConfusingDoor(event);
      return;
    }
    if (objectId === ANGER_EXIT_OBJECT_ID) {
      enterAngerExit(event);
      return;
    }
    if (objectId === RAGE_LEAVE_OBJECT_ID) {
      leaveRageRoom(event);
      return;
    }
    if (LEAVE_OBJECT_IDS.has(objectId) || HOPELESS_EXIT_OBJECT_IDS.has(objectId)) {
      climbOut(event);
      return;
    }
    if (objectId === RIFT_ROPE_OBJECT_ID) {
      climbOut(event);
    }
  }

  function handleItemOnObject(event) {
    if (event.itemId !== ROPE_ITEM_ID) return;
    if (
      !RIFT_OBJECT_IDS.has(event.objectId) &&
      event.objectId !== RIFT_BASE_OBJECT_ID
    ) {
      return;
    }
    descendRift(event);
  }

  // ==========================================================================
  // Login / logout / death
  // ==========================================================================

  /** Mirrors the per-player state onto the sibling varbits the cache reads. */
  function syncVarbits(player) {
    const stage = quest.getStage(player);
    setVarbit(player, VARBIT_RIFTROPE_PRES, attribute(player, ROPE_ATTACHED_ATTRIBUTE) ? 1 : 0);
    setVarbit(player, VARBIT_FEAR_ENEMYDOOR, attribute(player, FEAR_HOLE_ATTRIBUTE));
    setVarbit(player, VARBIT_FEAR_KILLEDTALLY, attribute(player, FEAR_TALLY_ATTRIBUTE));
    setVarbit(player, VARBIT_FEAR_MONSPRES, hasNpcOfKind(player, "reaper") ? 1 : 0);
    setVarbit(player, VARBIT_FEAR_EXITLIT, stage >= STAGE_FEAR_DONE ? 1 : 0);
    syncConfusionDoors(player);
    setVarbit(player, VARBIT_HOPE_KILLEDTALLY, attribute(player, HOPELESS_TALLY_ATTRIBUTE));
    setVarbit(player, VARBIT_HOPE_MONMES, attribute(player, HOPELESS_TALLY_ATTRIBUTE));
    setVarbit(player, VARBIT_HOPE_BRIDGEPRES, stage >= STAGE_HOPELESS_DONE ? 1 : 0);
    syncTolnaVarbits(player);
    setVarbit(player, VARBIT_TOLNA_PRES, stage >= STAGE_TOLNA_SAVED ? 1 : 0);
    setVarbit(player, VARBIT_LAUNA_PRES, stage >= STAGE_TOLNA_SAVED ? 1 : 0);
    setVarbit(player, VARBIT_ANGER_FLAMEPRES, stage >= STAGE_RAGE_DONE ? 1 : 0);
    setVarbit(
      player,
      VARBIT_ANGER_DAMAGEDEALT,
      Math.min(4095, attribute(player, RAGE_KILLS_ATTRIBUTE) * 500)
    );
    setVarbit(player, VARBIT_ANGER_DONESPECIAL, stage >= STAGE_RAGE_DONE ? 1 : 0);
    syncWeaponVarbit(player);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    if (!player) return;
    syncVarbits(player);
    if (inCave(player) && quest.isStarted(player) && !quest.isComplete(player)) {
      // OSRS throws the player out of the instance on login; incomplete rooms restart.
      if (quest.getStage(player) === STAGE_TOLNA) quest.setStage(player, STAGE_HOPELESS_DONE);
      moveTo(player, SURFACE_RETURN_TILE);
    }
  }

  function handleLogout({ player }) {
    if (!player) return;
    clearOwnedNpcs(player);
  }

  function handlePlayerDeath({ player }) {
    if (!player) return;
    if (quest.getStage(player) === STAGE_TOLNA) quest.setStage(player, STAGE_HOPELESS_DONE);
    clearOwnedNpcs(player);
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function rageJournalLine(player) {
    const kills = Math.min(attribute(player, RAGE_KILLS_ATTRIBUTE), ANGER_KILLS_REQUIRED);
    return `Rage level: ${kills}/${ANGER_KILLS_REQUIRED} defeats.`;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Launa asked me to find her husband Brana and her son Tolna in the</str>",
        "<str>rift east of Varrock.</str>",
        "<str>I defeated the monsters of rage, fear, confusion and hopelessness,</str>",
        "<str>and Tolna was restored to his human form.</str>",
        "",
        "I may now train in <col=800000>Tolna's rift</col>.",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_TOLNA_SAVED) {
      return [
        "<str>Launa asked me to find her husband Brana and her son Tolna in the</str>",
        "<str>rift east of Varrock.</str>",
        "<str>I saved Tolna and he returned to the surface.</str>",
        "",
        "I should talk to <col=800000>Tolna</col> by the rift to finish up.",
      ];
    }
    if (stage >= STAGE_TOLNA_BODY_DEAD) {
      return [
        "<str>Launa asked me to find her husband Brana and her son Tolna in the</str>",
        "<str>rift east of Varrock.</str>",
        "<str>I defeated Tolna's monstrous body and he became human again.</str>",
        "",
        "I should talk to <col=800000>Tolna</col>.",
      ];
    }
    if (stage >= STAGE_TOLNA) {
      return [
        "<str>Launa asked me to find her husband Brana and her son Tolna in the</str>",
        "<str>rift east of Varrock.</str>",
        "<str>I crossed the bridge of hope and found Brana with Tolna's body.</str>",
        "",
        "I must defeat the three heads of <col=800000>Tolna</col>.",
      ];
    }
    if (stage >= STAGE_HOPELESS_DONE) {
      return [
        "<str>Launa asked me to find her husband Brana and her son Tolna in the</str>",
        "<str>rift east of Varrock.</str>",
        "<str>I overcame hopelessness and a bridge of hope appeared.</str>",
        "",
        "I should cross the <col=800000>bridge of hope</col> and face Tolna.",
      ];
    }
    if (stage >= STAGE_HOPELESS) {
      return [
        "<str>Launa asked me to find her husband Brana and her son Tolna in the</str>",
        "<str>rift east of Varrock.</str>",
        "",
        "I am in the room of hopelessness.",
        `Hopeless creatures defeated: ${attribute(player, HOPELESS_TALLY_ATTRIBUTE)}/${HOPELESS_CREATURES_REQUIRED}.`,
        "Each must be killed three times to fully die.",
      ];
    }
    if (stage >= STAGE_CONFUSION_DONE) {
      return [
        "<str>Launa asked me to find her husband Brana and her son Tolna in the</str>",
        "<str>rift east of Varrock.</str>",
        "",
        "I overcame confusion and only one door remains.",
        "I should go through the <col=800000>final door</col>.",
      ];
    }
    if (stage >= STAGE_CONFUSION) {
      return [
        "<str>Launa asked me to find her husband Brana and her son Tolna in the</str>",
        "<str>rift east of Varrock.</str>",
        "",
        "I am in the room of confusion.",
        `Real confusion beasts defeated: ${attribute(player, CONFUSION_TALLY_ATTRIBUTE)}/${CONFUSION_KILLS_REQUIRED}.`,
        "Only one beast is real; illusions vanish after a few hits.",
      ];
    }
    if (stage >= STAGE_FEAR_DONE) {
      return [
        "<str>Launa asked me to find her husband Brana and her son Tolna in the</str>",
        "<str>rift east of Varrock.</str>",
        "",
        "I overcame fear and an exit has been illuminated.",
        "I should enter the <col=800000>lit hole</col>.",
      ];
    }
    if (stage >= STAGE_FEAR) {
      return [
        "<str>Launa asked me to find her husband Brana and her son Tolna in the</str>",
        "<str>rift east of Varrock.</str>",
        "",
        "I am in the room of fear.",
        `Fear reapers defeated: ${attribute(player, FEAR_TALLY_ATTRIBUTE)}/${FEAR_KILLS_REQUIRED}.`,
        "I should search the <col=800000>dark holes</col>.",
      ];
    }
    if (stage >= STAGE_RAGE_DONE) {
      return [
        "<str>Launa asked me to find her husband Brana and her son Tolna in the</str>",
        "<str>rift east of Varrock.</str>",
        "<str>I overcame the room of anger.</str>",
        "",
        "I should head through the tunnel to the east.",
      ];
    }
    if (stage >= STAGE_RAGE) {
      return [
        "<str>Launa asked me to find her husband Brana and her son Tolna in the</str>",
        "<str>rift east of Varrock.</str>",
        "",
        "I am in the room of anger.",
        rageJournalLine(player),
        "I should take a weapon from the <col=800000>weapon rack</col> and slay the monsters.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "I agreed to help <col=800000>Launa</col> find her husband Brana and her",
        "son Tolna in the rift east of Varrock.",
        "",
        "I need a <col=800000>rope</col> to climb down into the rift.",
      ];
    }
    return [
      "I can start this quest by speaking to <col=800000>Launa</col>",
      "at the rift east of <col=800000>Varrock</col>, south of the Earth Altar.",
      "",
      "I will need a <col=800000>rope</col> and a weapon.",
      "",
      "There are no requirements for this quest.",
    ];
  }

  function grantReward(player) {
    // registerQuest adds the first coin; top the stack up to 500.
    player.getInventory().adds(ItemIdentifiers.COINS, 499);
    player.getSkillManager().addExperiences(Skill.DEFENCE, 500);
    player.getSkillManager().addExperiences(Skill.HITPOINTS, 500);
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  api.persistAttribute(WEAPON_BITS_ATTRIBUTE);
  api.persistAttribute(RAGE_KILLS_ATTRIBUTE);
  api.persistAttribute(FEAR_TALLY_ATTRIBUTE);
  api.persistAttribute(FEAR_HOLE_ATTRIBUTE);
  api.persistAttribute(ROPE_ATTACHED_ATTRIBUTE);
  api.persistAttribute(CONFUSION_TALLY_ATTRIBUTE);
  api.persistAttribute(HOPELESS_TALLY_ATTRIBUTE);
  api.persistAttribute(TOLNA_HEADS_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "a_souls_bane",
    name: "A Soul's Bane",
    varpId: 709,
    varbitId: VARBIT_SOULBANE_PROG,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.DEFENCE.getIndex(), amount: 500, label: "Defence" },
      { skillId: Skill.HITPOINTS.getIndex(), amount: 500, label: "Hitpoints" },
    ],
    rewardItemId: ItemIdentifiers.COINS,
    rewardItemLabel: "500 Coins",
    otherRewards: ["Access to Tolna's rift for combat training"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onNpcInteraction("Tolna", { "Talk-to": talkToTolna });
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onNpcDeath(handleNpcDeath);
  api.onNpcBeforeDeath(handleNpcBeforeDeath);
  api.onNpcHitModify(handleNpcHitModify);
  api.onZoneEnter(FINAL_ZONE, handleFinalZoneEnter);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onPlayerDisconnect(handleLogout);
  api.onPlayerDeath(handlePlayerDeath);
};
