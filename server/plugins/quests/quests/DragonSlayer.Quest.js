/** Dragon Slayer I: revision240 RSProx stages, offerings, voyage and Elvarg proof. See docs/f2p-adventure-parity.md. */
module.exports = function registerDragonSlayerQuest(api) {
  const { Skill, Item, Location, Animation, Graphic, GameObject, ForceMovement, TaskManager, CountdownTask, TemplatedInstanceArea, DialogueChainBuilder, ActionDialogue, StatementDialogue, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, startTranscript, getRegisteredQuests } = require("../QuestRuntime");

  const GUILDMASTER_NPC_ID = NpcIdentifiers.GUILDMASTER;
  const DUKE_HORACIO_NPC_ID = NpcIdentifiers.DUKE_HORACIO;
  const KLARENSE_NPC_ID = NpcIdentifiers.KLARENSE;
  const WORMBRAIN_NPC_ID = NpcIdentifiers.WORMBRAIN;
  const ORACLE_NPC_ID = NpcIdentifiers.ORACLE;
  const OZIACH_NPC_ID = NpcIdentifiers.OZIACH;

  /** Elvarg/Ned cache variants absent from NpcIdentifiers (xrsps ids). */
  const ELVARG_LEGACY_NPC_ID = 816;
  const NED_LEGACY_NPC_IDS = [818, 5865];

  const ELVARG_NPC_IDS = new Set([
    ELVARG_LEGACY_NPC_ID,
    NpcIdentifiers.ELVARG_2,
    NpcIdentifiers.ELVARG_3,
    NpcIdentifiers.ELVARG,
  ]);
  const NED_NPC_IDS = new Set([
    ...NED_LEGACY_NPC_IDS,
    NpcIdentifiers.CAPTAIN_NED,
    NpcIdentifiers.NED,
    NpcIdentifiers.CAPTAIN_NED_2,
  ]);

  const VARP_DRAGON_SLAYER = 176;
  const STAGE_NOT_STARTED = 0;
  const STAGE_GUILDMASTER = 1;
  const STAGE_OZIACH = 2;
  const STAGE_BOUGHT_SHIP = 3;
  const STAGE_REPAIR_1 = 4;
  const STAGE_REPAIR_2 = 5;
  const STAGE_REPAIR_3 = 7;
  const STAGE_NED_READY = 8;
  const STAGE_CRANDOR = 9;
  const STAGE_COMPLETE = 10;
  const IDES_PERMIT_DUKE_STAGE = 10;

  const ITEM = {
    coins: ItemIdentifiers.COINS,
    silk: ItemIdentifiers.SILK,
    plank: ItemIdentifiers.PLANK,
    hammer: ItemIdentifiers.HAMMER,
    lobsterPot: ItemIdentifiers.LOBSTER_POT,
    wizardMindBomb: ItemIdentifiers.WIZARDS_MIND_BOMB,
    unfiredBowl: ItemIdentifiers.UNFIRED_BOWL,
    steelNails: ItemIdentifiers.STEEL_NAILS,
    antiDragonShield: ItemIdentifiers.ANTI_DRAGON_SHIELD,
    mapMelzar: ItemIdentifiers.MAP_PART,
    mapWormbrain: ItemIdentifiers.MAP_PART_2,
    mapOracle: ItemIdentifiers.MAP_PART_3,
    crandorMap: ItemIdentifiers.CRANDOR_MAP,
    mazeKey: ItemIdentifiers.MAZE_KEY,
    redKey: ItemIdentifiers.KEY_3,
    orangeKey: ItemIdentifiers.KEY_4,
    yellowKey: ItemIdentifiers.KEY_5,
    blueKey: ItemIdentifiers.KEY_6,
    magentaKey: ItemIdentifiers.KEY_7,
    greenKey: ItemIdentifiers.KEY_8,
    elvargsHead: ItemIdentifiers.ELVARGS_HEAD,
  };

  const MAP_PIECES = [ITEM.mapMelzar, ITEM.mapWormbrain, ITEM.mapOracle];
  const MAZE_KEYS = [ITEM.redKey, ITEM.orangeKey, ITEM.yellowKey, ITEM.blueKey, ITEM.magentaKey, ITEM.greenKey];
  const MAZE_DOORS = [
    ObjectIdentifiers.RED_DOOR,
    ObjectIdentifiers.ORANGE_DOOR,
    ObjectIdentifiers.YELLOW_DOOR,
    ObjectIdentifiers.BLUE_DOOR,
    ObjectIdentifiers.MAGENTA_DOOR,
    ObjectIdentifiers.GREEN_DOOR,
  ];
  // The maze keys come from npc-drops.json on the real Melzar's Maze NPCs
  // (zombie rat 3969-3971, ghost 3975-3979, skeleton 3972-3974, zombie
  // 3980/3981, Melzar 823, lesser demon 3982); the old xrsps dropper ids no
  // longer name those NPCs, so the plugin does not grant keys itself.
  const OFFERINGS = [ITEM.silk, ITEM.unfiredBowl, ITEM.lobsterPot, ITEM.wizardMindBomb];

  // The Lady Lumbridge's hole is nameless in the cache (configName dragonslayer_shiphole),
  // option Repair, at 3047,3207. The old xrsps HOLE_3 (2589) is not placed.
  const SHIP_HOLE_ID = 25036;

  const LOC = {
    magicDoor: ObjectIdentifiers.MAGIC_DOOR_6,
    oracleChest: [ObjectIdentifiers.CHEST_14, ObjectIdentifiers.CHEST_15],
    shipHole: SHIP_HOLE_ID,
    shipGangplanks: [ObjectIdentifiers.GANGPLANK_15, ObjectIdentifiers.GANGPLANK_16],
    melzarEntrance: ObjectIdentifiers.DOOR_91,
    melzarChest: [ObjectIdentifiers.CHEST_16, ObjectIdentifiers.CHEST_17],
    // Crandor's volcano: the surface hole drops into the lair by the exit rope,
    // and the wall divides the rope corridor from Elvarg's chamber.
    crandorOpening: ObjectIdentifiers.HOLE_40,
    crandorRope: ObjectIdentifiers.CLIMBING_ROPE_13,
    crandorWall: ObjectIdentifiers.WALL_161,
    crandorShortcut: ObjectIdentifiers.WALL_9,
    melzarBasementLadder: ObjectIdentifiers.LADDER_21,
    melzarExitDoor: ObjectIdentifiers.EXIT_DOOR,
  };

  // Cache rev241 2602 "Exit door" placements in Melzar's Maze. Wiki: the ground
  // north-east room and the basement zombie/Melzar/demon rooms each have a brown
  // door to the exit. Leaving through an exit door restarts the maze, so these are
  // one-way only: from the room the player is leaving to the maze/exit corridor,
  // never back. The ground door's room is the ladder room east of it, reached by
  // climbing up from the basement after the chest.
  const MELZAR_EXIT_DOORS = [
    { x: 2938, y: 3252, z: 0, exitX: -1 }, // ground NE ladder room -> maze
    { x: 2931, y: 9640, z: 0, exitX: -1 }, // zombie room -> west exit corridor
    { x: 2927, y: 9649, z: 0, exitX: -1 }, // Melzar room -> west exit corridor
    { x: 2924, y: 9654, z: 0, exitX: -1 }, // demon room -> west exit corridor
  ];

  const TILE = {
    melzarInside: new Location(2933, 3248, 0),
    melzarOutside: new Location(2942, 3248, 0),
    melzarBasementLadder: new Location(2932, 3240, 0),
    melzarBasement: new Location(2932, 9640, 0),
    crandor: new Location(2835, 3235, 0),
    crandorLair: new Location(2833, 9656, 0),
    crandorSurface: new Location(2833, 3256, 0),
  };

  const ATTR_ORACLE = "dragon-slayer.oracle";
  const ATTR_NED_ASKED = "dragon-slayer.ned-asked";
  const ATTR_OZIACH_CONGRATS = "dragon-slayer.oziach-congrats";
  const ATTR_SHORTCUT = "dragon-slayer.shortcut";
  const QUEST_POINTS_ATTRIBUTE = "quest.points";
  const OFFERINGS_ATTRIBUTE = "dragon-slayer:offerings";
  const INSTRUCTIONS_ATTRIBUTE = "dragon-slayer:instructions";
  const NED_KNOWS_ATTRIBUTE = "dragon-slayer:ned-knows-ship-fixed";
  const ELVARG_SEEN_ATTRIBUTE = "dragon-slayer:elvarg-seen";
  const ELVARG_KILLED_ATTRIBUTE = "dragon-slayer:elvarg-killed";
  const EXPLAINED_ATTRIBUTE = "dragon-slayer:champion-explained-elvarg";
  const OFFERING_VARBITS = [3747, 3748, 3749, 3750];
  const SHIP_VARBITS = [1835, 1836, 1837];
  /** Guildmaster follow-up answers; set means the question has not been asked yet. */
  const INSTRUCTION = { melzar: 0, oracle: 1, wormbrain: 2, ship: 3, shield: 4 };
  const SHORTCUT_VARBIT = 3741;
  const PRINCE_ALI_KEY = "prince_ali_rescue";
  const PRINCE_STAGE_WIG = 20;
  const PRINCE_STAGE_SAVED = 100;
  const PRINCE_WIG_ITEMS = [ItemIdentifiers.WIG, ItemIdentifiers.WIG_2];
  const VOYAGE = "the-dragon-of-crandor-sailing-to-crandor";
  const NED_SCENE_ID = 824, JENKINS_SCENE_ID = 826;
  const FIRE_SMALL = 25156, FIRE_LARGE = 25155, FIREBALL = 1155, FIRE_IMPACT_GRAPHIC = 1154;
  const ELVARG_INTRO_NPC_ID = 817;
  const SCENE_OVERLAY_UID = (161 << 16) | 1;
  const SCENE_INTERFACE = { journey: 299, route: 544, clouds: 543, elvarg: 545, fly: 546, fade: 174 };
  const ELVARG_BODY = 25202, ELVARG_HEADLESS = 25203;
  // Cache rev241: dragonsecretdoor 2606 is a shape-0 wall at 2836,9600 face3; the
  // Crandor side is north (walkable 2836,9601) and Karamja is south (2836,9598).
  const SHORTCUT_TILE = new Location(2836, 9600, 0);
  const SHORTCUT_NORTH = new Location(2836, 9601, 0);
  const SHORTCUT_SOUTH = new Location(2836, 9598, 0);
  const scenes = new WeakMap(), actions = new WeakMap(), pendingStart = new WeakSet();
  const saved = (player, key) => Number(player.getAttribute(key)) || 0;
  const askedAbout = (player, bit) => (saved(player, INSTRUCTIONS_ATTRIBUTE) & (1 << bit)) === 0;
  const completedQuest = (player, key) => getRegisteredQuests().find(entry => entry.key === key)?.isComplete?.(player) === true;
  const questStage = (player, key) => {
    const request = { player, key, stage: null };
    api.emitCustomEvent("quest:get-stage", request);
    return Number(request.stage) || 0;
  };
  const princeNeedsWig = (player) => {
    const stage = questStage(player, PRINCE_ALI_KEY);
    return stage >= PRINCE_STAGE_WIG && stage < PRINCE_STAGE_SAVED
      && !PRINCE_WIG_ITEMS.some(id => hasItem(player, id));
  };
  const later = (key, ticks, action) => TaskManager.submit(new CountdownTask(key, ticks, action));
  const offerings = player => saved(player, OFFERINGS_ATTRIBUTE) || (oracleState(player) >= 3 ? 15 : 0);
  function onNedShip(player) {
    const loc = player.getLocation();
    return loc.getZ() === 1 && Math.abs(loc.getX() - 3048) <= 5
      && (Math.abs(loc.getY() - 3207) <= 5 || Math.abs(loc.getY() - 9639) <= 5);
  }
  function wireStage(stage, player) {
    if (stage === STAGE_CRANDOR) return saved(player, ELVARG_KILLED_ATTRIBUTE) ? 9 : 8;
    if (stage === STAGE_NED_READY) return 7;
    if (stage === STAGE_REPAIR_3) return 6;
    if (stage === STAGE_REPAIR_1 || stage === STAGE_REPAIR_2) return 3;
    return stage;
  }
  function syncState({player}) {
    unlockShortcutAfterLeaving(player);
    const stage = quest.getStage(player), sender = player.getPacketSender();
    sender.sendVarbit(1832, oracleState(player) >= 2 ? 1 : 0).sendVarbit(SHORTCUT_VARBIT, player.getAttribute(ATTR_SHORTCUT) === true ? 1 : 0)
      .sendVarbit(3751, player.getAttribute(ATTR_NED_ASKED) === true ? 1 : 0)
      .sendVarbit(3752, saved(player, NED_KNOWS_ATTRIBUTE)).sendVarbit(18306, saved(player, EXPLAINED_ATTRIBUTE));
    OFFERING_VARBITS.forEach((id, bit) => sender.sendVarbit(id, (offerings(player) >> bit) & 1));
    SHIP_VARBITS.forEach((id, bit) => sender.sendVarbit(id, stage < STAGE_CRANDOR && stage >= [STAGE_REPAIR_1, STAGE_REPAIR_2, STAGE_REPAIR_3][bit] ? 1 : 0));
    for (let bit = 0; bit < 5; bit++) sender.sendVarbit(3742 + bit, (saved(player, INSTRUCTIONS_ATTRIBUTE) >> bit) & 1);
  }


  const PAGE = "Dragon Slayer I";
  const DUKE_PAGE = "Duke Horacio";
  const OZIACH_PAGE = "Oziach";
  const ORACLE_PAGE = "Oracle";
  const KLARENSE_PAGE = "Klarense";
  const NED_PAGE = "Ned";

  const START_HOOK = "quest:dragon-slayer-i:start";
  const REQUIRED_QUEST_POINTS = 32;

  const hasItem = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const hasCrandorMap = (player) => hasItem(player, ITEM.crandorMap);
  const hasAllMapPieces = (player) => MAP_PIECES.every((id) => hasItem(player, id));
  const ownsMapPiece = (player, itemId) => hasItem(player, itemId) || hasCrandorMap(player);
  const questPoints = (player) => Number(player.getAttribute(QUEST_POINTS_ATTRIBUTE)) || 0;
  const oracleState = (player) => Number(player.getAttribute(ATTR_ORACLE)) || 0;
  const setOracleState = (player, value) => player.setAttribute(ATTR_ORACLE, value);

  let quest;
  let itemOnGroundManager;

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return ["<str>I slew Elvarg and became a true dragon slayer.</str>", "", "<col=ff0000>QUEST COMPLETE!</col>"];
    }
    if (stage >= STAGE_CRANDOR) return ["Enter Crandor's volcano and defeat <col=800000>Elvarg</col>."];
    if (stage >= STAGE_NED_READY) return ["Board the Lady Lumbridge with Captain Ned and sail to Crandor."];
    if (stage >= STAGE_REPAIR_3) return ["Bring the completed Crandor map to <col=800000>Ned</col> in Draynor."];
    if (stage >= STAGE_BOUGHT_SHIP) {
      return [
        "Repair all three holes in the Lady Lumbridge with planks",
        "and 30 steel nails per hole. Complete the three map pieces.",
      ];
    }
    if (stage >= STAGE_OZIACH) {
      return [
        "Find the three Crandor map pieces: in Melzar's Maze,",
        "behind the Oracle's magic door, and from Wormbrain.",
        "Obtain an anti-dragon shield from Duke Horacio.",
      ];
    }
    if (stage >= STAGE_GUILDMASTER) return ["Speak to <col=800000>Oziach</col> near Edgeville."];
    return ["You need 32 Quest Points, then speak to the Champions' Guildmaster."];
  }

  function reward(player) {
    player.getSkillManager().addExperiences(Skill.STRENGTH, 18650);
    player.getSkillManager().addExperiences(Skill.DEFENCE, 18650);
  }

  function idesNeedsDukePermit(player) {
    const request = { player, key: "the_ides_of_milk", stage: 0 };
    api.emitCustomEvent("quest:get-stage", request);
    return request.stage === IDES_PERMIT_DUKE_STAGE;
  }

  function giveItem(player, itemId, amount = 1) {
    if (player.getInventory().isFull()) {
      player.sendMessage("You need more free inventory space.");
      return false;
    }
    player.getInventory().adds(itemId, amount);
    return true;
  }

  function dropItem(player, itemId, location) {
    if (!itemOnGroundManager) return;
    itemOnGroundManager.registerLocation(
      player,
      new Item(itemId, 1),
      new Location(location.x, location.y, location.z)
    );
  }

  function freeze(player) {
    player.getMovementQueue().reset().setBlockMovement(true); player.setUntargetable(true);
    player.getDialogueManager().reset();
    StatementDialogue.send(player, "", false);
  }
  function fade(player, black) {
    player.getPacketSender().sendSubInterface(SCENE_OVERLAY_UID, SCENE_INTERFACE.fade, 1).sendClientScript(948, 0, 0, 0, black ? 0 : 255, 50);
  }
  class VoyageScene extends TemplatedInstanceArea {
    constructor(player, intro = false) {
      super(intro ? 8 : 5, intro ? 8 : 5); this.owner = player; this.returnTile = player.getLocation().clone(); this.actors = [];
      this.origin = intro ? [2816, 9600] : [2056, 5504]; this.plane = intro ? 0 : 1;
      for (let z = 0; z < 3; z++) for (let x = 0; x < this.widthChunks; x++) for (let y = 0; y < this.heightChunks; y++)
        this.setChunk(z, x, y, { sourceChunkX: this.origin[0] / 8 + x, sourceChunkY: this.origin[1] / 8 + y, sourcePlane: z, rotation: 0 });
    }
    sourceTile(x, y, z = this.plane) { return this.tile(x - this.origin[0], y - this.origin[1], z); }
    canTeleport() { return false; }
    canAttack() { return false; }
    postLeave(mobile, logout) {
      if (mobile === this.owner) {
        scenes.delete(mobile); TaskManager.cancelTasks(this);
        for (const npc of this.actors) api.removeNpc(npc);
        mobile.getMovementQueue().setBlockMovement(false); mobile.setUntargetable(false);
        mobile.getPacketSender().sendVarbit(6719, 0).sendVarbit(542, 0).sendVarbit(4606, 0).closeSubInterface(SCENE_OVERLAY_UID);
        if (!this.cameraReleased) mobile.getPacketSender().sendCameraUnlock(false).sendCameraReset();
        if (logout) mobile.moveTo(this.returnTile);
      }
      super.postLeave(mobile, logout);
    }
  }
  function sceneActor(scene, id, x, y) {
    const at = scene.sourceTile(x, y), npc = api.spawnNpc({ id, x: at.getX(), y: at.getY(), z: at.getZ(), owner: scene.owner, ownerOnly: true, wanderRadius: 0 });
    if (npc) { scene.enter(npc); scene.actors.push(npc); } return npc;
  }
  function camera(player, scene, move, look, rate = 232, lookFirst = false) {
    const sender = player.getPacketSender(), options = { rate, rate2: rate, heightRelative: false };
    const from = move && (scene ? scene.sourceTile(move[0], move[1]) : new Location(move[0], move[1], 0));
    const to = look && (scene ? scene.sourceTile(look[0], look[1]) : new Location(look[0], look[1], 0));
    if (lookFirst && look) sender.sendCameraLookAt(to.getX(), to.getY(), look[2], options);
    if (move) sender.sendCameraMoveTo(from.getX(), from.getY(), move[2], options);
    if (!lookFirst && look) sender.sendCameraLookAt(to.getX(), to.getY(), look[2], options);
  }
  function voyageContinue(player, anchor) {
    startTranscript(api, player, NED_SCENE_ID, PAGE, VOYAGE, steps => steps.slice(steps.findIndex(step => step.id === anchor) + 1));
  }
  function beginVoyage(player) {
    if (quest.getStage(player) !== STAGE_NED_READY || scenes.has(player) || actions.has(player)) return;
    const scene = new VoyageScene(player); scenes.set(player, scene); freeze(player); fade(player, true);
    player.getPacketSender().sendVarbit(6719, 2).sendVarbit(542, 1).sendVarbit(4606, 1);
    later(scene, 2, () => {
      for (let axis = 0; axis < 5; axis++) player.getPacketSender().sendCameraShake(axis, 0);
      player.getPacketSender().sendInterface(SCENE_INTERFACE.journey).sendClientScript(1131, 3).sendSong(147).sendJingle(172, 0);
    });
    later(scene, 14, () => player.getPacketSender().sendInterface(SCENE_INTERFACE.route));
    later(scene, 20, () => {
      player.moveTo(scene.sourceTile(2067, 5517)); scene.enter(player);
      scene.ned = sceneActor(scene, NED_SCENE_ID, 2066, 5517);
      scene.jenkins = sceneActor(scene, JENKINS_SCENE_ID, 2063, 5518);
      player.getPacketSender().sendInterfaceRemoval(); fade(player, false);
      voyageContinue(player, "P3s5v9");
    });
  }
  function fireAt(scene, source, target, delay) {
    const at = scene.sourceTile(...target), sender = scene.owner.getPacketSender();
    sender.sendProjectile(scene.sourceTile(...source), at, 0, 55, FIREBALL, 1000, 0, null, delay, 0);
    sender.sendGraphic(new Graphic(FIRE_IMPACT_GRAPHIC, delay + 55), at).sendSoundEffect(3741, 1, delay + 55);
  }
  function sceneFire(scene, id, x, y, z = 1) {
    const object = new GameObject(id, scene.sourceTile(x, y, z), 10, 0, scene);
    api.getObjectManager().register(object, true); scene.add(object);
  }
  function handleVoyageAction(event) {
    const {player, stepId} = event, scene = scenes.get(player);
    if (!(scene instanceof VoyageScene)) return;
    if (stepId === "m7RQ3q") {
      event.handled = true; event.end = true; freeze(player);
      StatementDialogue.send(player, "Clouds surround the ship.", false);
      player.getPacketSender().sendSubInterface(SCENE_OVERLAY_UID, SCENE_INTERFACE.clouds, 1).sendSong(360).sendSoundEffect(3762, 1, 0);
      later(scene, 5, () => voyageContinue(player, stepId)); return;
    }
    if (stepId === "yVgKdy") {
      event.handled = true; event.end = true; freeze(player);
      player.getPacketSender().sendSubInterface(SCENE_OVERLAY_UID, SCENE_INTERFACE.elvarg, 1).sendSoundEffect(3754, 1, 0);
      later(scene, 1, () => { player.getPacketSender().closeSubInterface(SCENE_OVERLAY_UID); voyageContinue(player, stepId); }); return;
    }
    if (stepId === "1XD38w") {
      event.handled = true; event.end = true; freeze(player);
      player.getPacketSender().sendSoundEffect(3750, 1, 0);
      camera(player, scene, [2072, 5517, 300], [2062, 5515, 100]);
      camera(player, scene, [2072, 5520, 300], null, 1);
      for (const [from, to, delay] of [[[2076, 5526], [2065, 5516], 0], [[2073, 5526], [2064, 5516], 30], [[2078, 5526], [2063, 5516], 60]]) fireAt(scene, from, to, delay);
      later(scene, 2, () => { scene.ned?.performAnimation(new Animation(2105)); scene.jenkins?.performAnimation(new Animation(4280)); });
      for (let i = 0; i < 3; i++) later(scene, 2 + i, () => sceneFire(scene, FIRE_SMALL, 2065 - i, 5516));
      later(scene, 4, () => voyageContinue(player, stepId)); return;
    }
    if (stepId === "07qPBA") {
      event.handled = true; event.end = true; freeze(player);
      player.getPacketSender().sendSubInterface(SCENE_OVERLAY_UID, SCENE_INTERFACE.fly, 1).sendSoundEffect(3751, 1, 0);
      later(scene, 2, () => scene.jenkins?.moveTo(scene.sourceTile(2066, 5518)));
      later(scene, 1, () => { sceneFire(scene, FIRE_LARGE, 2060, 5516, 2); sceneFire(scene, FIRE_SMALL, 2061, 5518, 2); });
      later(scene, 3, () => {
        player.getPacketSender().closeSubInterface(SCENE_OVERLAY_UID);
        camera(player, scene, [2068, 5518, 300], [2062, 5518, 100]); camera(player, scene, [2074, 5526, 300], null, 1);
        player.getPacketSender().sendCameraShake(1, 0, 5, 8); scene.jenkins?.moveTo(scene.sourceTile(2066, 5518));
        sceneFire(scene, FIRE_LARGE, 2064, 5516);
        for (let i = 0; i < 5; i++) fireAt(scene, [2057 + i * 3, 5522], [2063 + i, 5518], i * 30);
      });
      later(scene, 5, () => scene.jenkins?.performAnimation(new Animation(6649, 6)));
      later(scene, 7, () => { scene.jenkins?.performAnimation(new Animation(836)); player.getPacketSender().sendSoundEffect(513, 1, 0).sendSoundEffect(512, 1, 0); });
      for (let i = 0; i < 5; i++) later(scene, 4 + i, () => sceneFire(scene, FIRE_SMALL, 2063 + i, 5518));
      later(scene, 9, () => { sceneFire(scene, FIRE_LARGE, 2062, 5517); voyageContinue(player, stepId); }); return;
    }
    if (stepId === "9r5-VW") {
      event.handled = true; event.end = true; freeze(player);
      player.getPacketSender().sendCameraShake(0, 20).sendSoundEffect(3742, 1, 0); StatementDialogue.send(player, "<col=800000>CRASH!", false); fade(player, true);
      later(scene, 3, () => { scene.cameraReleased = true; player.getPacketSender().sendCameraReset(); });
      later(scene, 4, () => {
        scene.returnTile = new Location(2852, 3238, 0); scene.leave(player, false); player.moveTo(scene.returnTile);
        quest.setStage(player, STAGE_CRANDOR); syncState({player});
        player.getMovementQueue().setBlockMovement(true); player.setUntargetable(true); player.performAnimation(new Animation(4191));
        camera(player, null, [2854, 3241, 300], [2849, 3238, 200]); fade(player, false);
        StatementDialogue.send(player, "You are knocked unconscious and later awake on an ash-strewn<br>beach.", false);
        const token = {}; actions.set(player, token);
        later(token, 5, () => { if (actions.get(player) !== token) return; actions.delete(player); player.getMovementQueue().setBlockMovement(false); player.setUntargetable(false); player.getPacketSender().sendCameraUnlock(false).sendCameraReset().sendInterfaceRemoval().closeSubInterface(SCENE_OVERLAY_UID).sendSong(170); });
      });
    }
  }
  function cleanup({player}) {
    pendingStart.delete(player);
    const scene = scenes.get(player);
    if (scene) {
      if (player.getArea() === scene) scene.leave(player, true);
      else { TaskManager.cancelTasks(scene); scene.destroy(); scenes.delete(player); }
    }
    const token = actions.get(player);
    if (token) {
      TaskManager.cancelTasks(token); actions.delete(player);
      player.getPacketSender().sendCameraUnlock(false).sendCameraReset().closeSubInterface(SCENE_OVERLAY_UID);
    }
    player.setForceMovement(null);
    player.getMovementQueue().setBlockMovement(false); player.setUntargetable(false);
  }
  function handleLine(request) {
    const {player, npcId} = request, text = String(request.text);
    if (npcId === GUILDMASTER_NPC_ID && text.startsWith("You'll have to speak to Oziach")) request.before = () => {
      if (!pendingStart.has(player) || quest.getStage(player) !== 0 || questPoints(player) < REQUIRED_QUEST_POINTS) return;
      pendingStart.delete(player); quest.setStage(player, STAGE_GUILDMASTER);
      player.sendMessage("You've started a new quest: <col=081190>Dragon Slayer I</col>");
    };
    if (npcId === OZIACH_NPC_ID && text === "Slay the dragon of Crandor!") request.before = () => {
      if (quest.getStage(player) !== STAGE_GUILDMASTER) return;
      player.setAttribute(INSTRUCTIONS_ATTRIBUTE, 31); quest.setStage(player, STAGE_OZIACH); syncState({player});
    };
    if (npcId === KLARENSE_NPC_ID && text === "Okey-dokey! She's all yours!") request.before = () => {
      if (quest.getStage(player) !== STAGE_OZIACH || !hasItem(player, ITEM.coins, 2000)) return;
      player.getInventory().deleteNumber(ITEM.coins, 2000); quest.setStage(player, STAGE_BOUGHT_SHIP);
    };
    if (npcId === ORACLE_NPC_ID && text.startsWith("The map's behind a door below")) request.before = () => {
      setOracleState(player, Math.max(2, oracleState(player))); player.getPacketSender().sendVarbit(1832, 1);
    };
    if (NED_NPC_IDS.has(npcId) && text === "Crandor?") request.before = () => { player.setAttribute(ATTR_NED_ASKED, true); player.getPacketSender().sendVarbit(3751, 1); };
    if (NED_NPC_IDS.has(npcId) && text === "Just show me the map and we can get ready to go!") request.before = () => {
      player.setAttribute(NED_KNOWS_ATTRIBUTE, 1); player.getPacketSender().sendVarbit(3752, 1);
    };
    if (npcId === GUILDMASTER_NPC_ID) {
      const clues = ["Melzar built a castle", "Thalzar was the most paranoid", "A few weeks ago", "Quite a specific one", "That part shouldn't be too difficult"];
      const bit = clues.findIndex(prefix => text.startsWith(prefix));
      if (bit >= 0) request.before = () => { player.setAttribute(INSTRUCTIONS_ATTRIBUTE, saved(player, INSTRUCTIONS_ATTRIBUTE) & ~(1 << bit)); player.getPacketSender().sendVarbit(3742 + bit, 0); };
      if (text.startsWith("Thirty years ago")) request.before = () => { player.setAttribute(EXPLAINED_ATTRIBUTE, 1); player.getPacketSender().sendVarbit(18306, 1); };
    }
    const scene = scenes.get(player);
    if (!(scene instanceof VoyageScene) || npcId !== NED_SCENE_ID) return;
    if (request.speaker === "Cabin Boy Jenkins") request.speakerId = JENKINS_SCENE_ID;
    else if (request.speaker === "Captain Ned") request.speakerId = NED_SCENE_ID;
    if (text.startsWith("Ah, it's good to feel")) request.before = () => {
      camera(player, scene, [2077, 5518, 100], [2069, 5517, 25], 232, true); camera(player, scene, [2074, 5516, 100], null, 1); player.getPacketSender().sendCameraShake(1, 0, 10, 8);
    };
    if (text.startsWith("And this is a mighty")) request.before = () => camera(player, scene, [2073, 5516, 100], [2066, 5517, 25], 1);
    if (text.startsWith("How much longer")) request.before = () => camera(player, scene, [2069, 5513, 300], [2066, 5517, 100], 1);
    if (text.startsWith("Looks like there's a storm")) request.before = () => {
      player.getPacketSender().sendCameraShake(1, 0); camera(player, scene, [2074, 5525, 1500], [2064, 5520, 300], 232, true); camera(player, scene, [2064, 5525, 1500], null, 1); player.getPacketSender().closeSubInterface(SCENE_OVERLAY_UID);
    };
    if (text === "We're going to sink!") request.before = () => { camera(player, scene, [2074, 5526, 600], [2066, 5517, 100]); camera(player, scene, [2064, 5518, 400], null, 1); player.getPacketSender().sendCameraShake(1, 0, 10, 8); };
    if (text === "We're going to crash!") request.before = () => camera(player, scene, [2064, 5518, 400], null, 2);
  }

  // ============================================================================
  // Transcript selection
  // ============================================================================

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);

    if (npcId === GUILDMASTER_NPC_ID) {
      if (stage >= STAGE_COMPLETE) {
        return { page: PAGE, variant: "the-dragon-of-crandor-talking-to-the-guildmaster-after-slaying-elvarg" };
      }
      if (stage === STAGE_NOT_STARTED) {
        if (questPoints(player) < REQUIRED_QUEST_POINTS) return null;
        return { page: PAGE, variant: "a-quest-for-the-rune-platebody-talking-to-the-guildmaster" };
      }
      if (stage === STAGE_GUILDMASTER) {
        return {
          page: PAGE,
          variant: "a-quest-for-the-rune-platebody-talking-to-the-guildmaster-talking-to-the-guildmaster-again-before-talking-to-oziach",
        };
      }
      if (stage === STAGE_OZIACH) {
        return { page: PAGE, variant: "a-quest-for-the-rune-platebody-talking-to-the-guildmaster-after-talking-to-oziach" };
      }
      return { page: PAGE, variant: "a-quest-for-the-rune-platebody-talking-to-the-guildmaster-again" };
    }

    if (npcId === DUKE_HORACIO_NPC_ID) {
      // Duke's flat page carries the anti-dragon shield conversation (the
      // Dragon Slayer I page only holds Oziach/Ned/etc. variants). Defer while
      // Ides of Milk needs its stage-10 permit dialogue; otherwise claim him
      // while Dragon Slayer still owes the player a shield.
      if (stage < STAGE_GUILDMASTER || hasItem(player, ITEM.antiDragonShield) || idesNeedsDukePermit(player)) return null;
      return { page: DUKE_PAGE };
    }

    if (npcId === OZIACH_NPC_ID) {
      if (stage === STAGE_GUILDMASTER) {
        return { page: PAGE, variant: "a-quest-for-the-rune-platebody-talking-to-oziach" };
      }
      if ((stage === STAGE_CRANDOR && saved(player, ELVARG_KILLED_ATTRIBUTE)) || stage >= STAGE_COMPLETE) {
        if (stage < STAGE_COMPLETE || player.getAttribute(ATTR_OZIACH_CONGRATS) !== true) {
          return { page: PAGE, variant: "the-dragon-of-crandor-talking-to-oziach-after-slaying-elvarg" };
        }
        return { page: OZIACH_PAGE, variant: "after-completing-dragon-slayer-i" };
      }
      if (stage >= STAGE_OZIACH) {
        return { page: PAGE, variant: "a-quest-for-the-rune-platebody-talking-to-oziach-talking-to-oziach-before-slaying-the-dragon" };
      }
      return null;
    }

    if (npcId === ORACLE_NPC_ID) {
      if (stage < STAGE_OZIACH || !askedAbout(player, INSTRUCTION.oracle)) return null;
      if (!ownsMapPiece(player, ITEM.mapOracle)) {
        return { page: PAGE, variant: "thalzar-s-map-piece-talking-to-the-oracle" };
      }
      return { page: ORACLE_PAGE, variant: "standard-dialogue" };
    }

    if (npcId === KLARENSE_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return { page: KLARENSE_PAGE, variant: "after-dragon-slayer-i" };
      if (stage === STAGE_CRANDOR) {
        return { page: PAGE, variant: "the-dragon-of-crandor-talking-to-klarense-after-reaching-crandor" };
      }
      if (stage >= STAGE_BOUGHT_SHIP) {
        return { page: PAGE, variant: "an-old-crandorian-ship-talking-to-klarense-after-purchasing-the-lady-lumbridge" };
      }
      // No pre-Oziach refusal variant; the purchase is refused in the
      // condition handler instead.
      return { page: PAGE, variant: "an-old-crandorian-ship-talking-to-klarense" };
    }

    if (npcId === WORMBRAIN_NPC_ID) {
      if (stage < STAGE_OZIACH || !askedAbout(player, INSTRUCTION.wormbrain) || ownsMapPiece(player, ITEM.mapWormbrain)) return null;
      return { page: PAGE, variant: "lozar-s-map-piece-talking-to-wormbrain" };
    }

    if (NED_NPC_IDS.has(npcId)) {
      // Completed Dragon Slayer no longer owns Ned; Prince Ali or Ned's standard page decides.
      if (stage >= STAGE_COMPLETE) return null;
      // An active Prince Ali wig request outranks DS land dialogue. DS keeps only the
      // on-ship departure window so its voyage cannot be blocked by the other quest.
      if (princeNeedsWig(player) && !(stage === STAGE_NED_READY && onNedShip(player))) return null;
      if (stage === STAGE_CRANDOR) {
        return { page: PAGE, variant: "the-dragon-of-crandor-talking-to-ned-after-reaching-crandor" };
      }
      if (stage >= STAGE_NED_READY) {
        return onNedShip(player)
          ? { page: PAGE, variant: "the-dragon-of-crandor-talking-to-ned-on-the-lady-lumbridge" }
          : { page: PAGE, variant: "the-dragon-of-crandor-talking-to-ned-after-giving-him-the-crandor-map" };
      }
      if (stage >= STAGE_OZIACH) {
        if (player.getAttribute(ATTR_NED_ASKED) !== true) {
          return { page: PAGE, variant: "an-old-crandorian-ship-finding-a-willing-captain-ned" };
        }
        return {
          page: PAGE,
          variant: "an-old-crandorian-ship-finding-a-willing-captain-talking-to-ned-again-if-the-player-wasn-t-ready-the-first-time",
        };
      }
      return null;
    }

    return null;
  }

  // ============================================================================
  // Prose conditions from the transcripts
  // ============================================================================

  function answerCondition({ npcId, player, text }) {
    const value = String(text).toLowerCase();
    const stage = quest.getStage(player);

    if (npcId === GUILDMASTER_NPC_ID) {
      if (value.includes("completed pandemonium")) return completedQuest(player, "pandemonium");
      if (value.includes("45 combat or 33 magic")) {
        return (
          player.getSkillManager().getCombatLevel() < 45 ||
          player.getSkillManager().getCurrentLevel(Skill.MAGIC) < 33
        );
      }
      if (value.includes("does not have the key")) return !hasItem(player, ITEM.mazeKey);
      if (value.includes("key in their key ring")) return false;
      if (value.includes("key in their inventory or bank")) return hasItem(player, ITEM.mazeKey);
      return null;
    }

    if (npcId === OZIACH_NPC_ID) {
      if (value.includes("murder mystery has been completed")) return completedQuest(player, "murder_mystery");
      if (value.includes("elvarg's head")) return hasItem(player, ITEM.elvargsHead);
      return null;
    }

    if (npcId === WORMBRAIN_NPC_ID) {
      if (value.includes("does not have enough coins")) {
        return player.getInventory().getAmount(ITEM.coins) < 10000;
      }
      if (value.includes("has enough coins")) {
        return player.getInventory().getAmount(ITEM.coins) >= 10000;
      }
      return null;
    }

    if (npcId === KLARENSE_NPC_ID) {
      if (value.includes("does not have enough coins")) {
        return player.getInventory().getAmount(ITEM.coins) < 2000;
      }
      if (value.includes("has enough coins")) {
        return player.getInventory().getAmount(ITEM.coins) >= 2000;
      }
      if (value.includes("has not fixed the ship")) return stage < STAGE_REPAIR_3;
      if (value.includes("has fixed the ship")) return stage >= STAGE_REPAIR_3;
      return null;
    }

    if (NED_NPC_IDS.has(npcId)) {
      const mapReady = hasCrandorMap(player) || hasAllMapPieces(player);
      if (value.includes("shortcut has been opened")) return player.getAttribute(ATTR_SHORTCUT) === true;
      if (value.includes("hasn't bought the ship yet")) return stage < STAGE_BOUGHT_SHIP;
      if (value.includes("hasn't repaired the ship yet")) return stage < STAGE_REPAIR_3;
      if (value.includes("does not have the completed map or all 3 pieces")) return !mapReady;
      if (value.includes("has the completed map or all 3 pieces")) return mapReady;
      if (value.includes("does not have the completed map")) return !hasCrandorMap(player);
      if (value.includes("has all three map parts")) return hasAllMapPieces(player);
      if (value.includes("has the completed map")) return hasCrandorMap(player);
      return null;
    }

    if (npcId === DUKE_HORACIO_NPC_ID) {
      if (value.includes("does not have an anti-dragon shield")) {
        return !hasItem(player, ITEM.antiDragonShield);
      }
      if (value.includes("during dragon slayer i")) {
        return stage >= STAGE_GUILDMASTER && stage < STAGE_COMPLETE;
      }
      if (value.includes("has not finished dragon slayer i")) return stage < STAGE_COMPLETE;
      if (value.includes("has finished dragon slayer i")) return stage >= STAGE_COMPLETE;
      return null;
    }

    return null;
  }

  // ============================================================================
  // Hooks / choices / chosen conditions that carry state
  // ============================================================================

  function handleStartHook({ player, npcId, hook }) {
    if (hook !== START_HOOK || npcId !== GUILDMASTER_NPC_ID) return;
    if (quest.getStage(player) !== STAGE_NOT_STARTED) return;
    if (questPoints(player) < REQUIRED_QUEST_POINTS) {
      player.sendMessage("Only champions with at least 32 Quest Points may take this challenge.");
      return;
    }
    pendingStart.add(player);
  }

  // ============================================================================
  // Hand-ins and completion
  // ============================================================================

  function handleDialogueAction(event) {
    const { player, npcId, stepId } = event;
    const stage = quest.getStage(player);
    if (npcId === GUILDMASTER_NPC_ID && stepId === "fTWupR") {
      const combatLow = player.getSkillManager().getCombatLevel() < 45;
      const magicLow = player.getSkillManager().getCurrentLevel(Skill.MAGIC) < 33;
      event.text = combatLow
        ? "Before starting this quest, be aware that your combat level is lower than the recommended level of 45." + (magicLow ? " One or more of your skill levels are also lower than recommended." : "")
        : "One or more of your skill levels are lower than recommended.";
      event.box = {statement:true}; return;
    }

    if (npcId === WORMBRAIN_NPC_ID && stepId === "I8YYjs") {
      if (hasItem(player, ITEM.coins, 10000) && !ownsMapPiece(player, ITEM.mapWormbrain)) {
        const inventory = player.getInventory();
        if (inventory.isFull() && inventory.getAmount(ITEM.coins) > 10000) {
          player.sendMessage("You need a free inventory slot for the map piece."); event.handled = true; event.end = true; return;
        }
        inventory.deleteNumber(ITEM.coins, 10000);
        if (!giveItem(player, ITEM.mapWormbrain)) { inventory.adds(ITEM.coins, 10000); event.handled = true; event.end = true; }
      }
      return; // leave the transcript's own message to play
    }

    if (npcId === GUILDMASTER_NPC_ID && stepId === "xUz7Ja") {
      if (!hasItem(player, ITEM.mazeKey) && !player.getInventory().isFull()) {
        player.getInventory().adds(ITEM.mazeKey, 1);
      }
      return;
    }

    if (
      npcId === DUKE_HORACIO_NPC_ID &&
      (stepId === "LnbjYr" || stepId === "igRDii" || stepId === "if_uB3" || stepId === "emj6I8")
    ) {
      if (!hasItem(player, ITEM.antiDragonShield) && !player.getInventory().isFull()) {
        player.getInventory().adds(ITEM.antiDragonShield, 1);
      }
      return;
    }

    if (
      NED_NPC_IDS.has(npcId) &&
      (stepId === "PjZiNz" || stepId === "fvCrJ7" || stepId === "nJiC7S")
    ) {
      if (stage >= STAGE_REPAIR_3 && stage < STAGE_NED_READY) {
        if (hasCrandorMap(player)) {
          player.getInventory().deleteNumber(ITEM.crandorMap, 1);
        } else if (hasAllMapPieces(player)) {
          for (const id of MAP_PIECES) player.getInventory().deleteNumber(id, 1);
        } else {
          return;
        }
        player.setAttribute(NED_KNOWS_ATTRIBUTE, 1);
        player.getPacketSender().sendVarbit(3752, 1);
        quest.setStage(player, STAGE_NED_READY);
      }
      event.box = { items: [ITEM.crandorMap] };
      return;
    }

    if (npcId === OZIACH_NPC_ID && stepId === "0KEI_n") {
      if (stage >= STAGE_COMPLETE) {
        player.setAttribute(ATTR_OZIACH_CONGRATS, true); event.handled = true; event.end = true; return;
      }
      if (stage !== STAGE_CRANDOR || !saved(player, ELVARG_KILLED_ATTRIBUTE)) { event.handled = true; event.end = true; return; }
      quest.complete(player);
      player.setAttribute(ATTR_OZIACH_CONGRATS, true);
      event.handled = true;
      event.end = true;
      return;
    }

    if (NED_NPC_IDS.has(npcId) && stepId === "1nn6tK") {
      event.handled = true; event.end = true; beginVoyage(player);
    }
    if (scenes.has(player) && npcId === NED_SCENE_ID) handleVoyageAction(event);

  }

  // ============================================================================
  // Map pieces and maze / Oracle / ship / Crandor objects
  // ============================================================================

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    if (usedItemId === usedWithItemId) return;
    if (!MAP_PIECES.includes(usedItemId) || !MAP_PIECES.includes(usedWithItemId)) return;
    if (hasAllMapPieces(player)) {
      for (const id of MAP_PIECES) player.getInventory().deleteNumber(id, 1);
      player.getInventory().adds(ITEM.crandorMap, 1);
      player.sendMessage(
        "You put the three pieces together and assemble a map that shows the route through the reefs to Crandor."
      );
    } else {
      player.sendMessage("You still need one more piece of map.");
    }
    event.handled = true;
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    const stage = quest.getStage(player);

    if (itemId === ITEM.mazeKey && objectId === LOC.melzarEntrance) {
      const at = event.object?.getLocation?.();
      if (at && player.getLocation().getX() < at.getX()) player.moveTo(TILE.melzarOutside.clone());
      else if (stage >= STAGE_OZIACH) player.moveTo(TILE.melzarInside.clone());
      event.handled = true;
      return;
    }

    const doorIndex = MAZE_DOORS.indexOf(objectId);
    if (doorIndex >= 0 && MAZE_KEYS.includes(itemId)) {
      if (itemId !== MAZE_KEYS[doorIndex]) {
        player.sendMessage("This key doesn't fit this door.");
        event.handled = true;
        return;
      }
      player.getInventory().deleteNumber(itemId, 1);
      player.sendMessage("The key disintegrates as it unlocks the door.");
      crossMazeDoor(player, event.object, event.location);
      event.handled = true;
      return;
    }

    if (objectId === LOC.magicDoor && OFFERINGS.includes(itemId)) {
      event.handled = true;
      if (stage < STAGE_OZIACH || oracleState(player) < 2 || !hasItem(player, itemId)) return;
      const bit = OFFERINGS.indexOf(itemId);
      if (offerings(player) & (1 << bit)) { player.sendMessage("You have already put that into the opening in the door."); return; }
      player.getInventory().deleteNumber(itemId, 1);
      player.setAttribute(OFFERINGS_ATTRIBUTE, offerings(player) | (1 << bit));
      player.getPacketSender().sendVarbit(OFFERING_VARBITS[bit], 1);
      player.sendMessage([
        "You put the silk into the opening in the door.", "You put the unfired bowl into the opening in the door.",
        "You put the Lobster pot into the opening in the door.", "You pour the Wizard's Mind Bomb into the opening in the door.",
      ][bit]);
      if (offerings(player) === 15) {
        setOracleState(player, 3);
        const token = {}; actions.set(player, token);
        later(token, 1, () => {
          if (actions.get(player) !== token) return;
          actions.delete(player); player.sendMessage("The door opens...");
          const at = event.object.getLocation();
          player.getPacketSender().sendObjectAnimation(event.object, new Animation(6636));
          crossMagicDoor(player, { x: at.getX(), y: at.getY(), z: at.getZ() });
        });
      }
      return;
    }
    if (itemId === ITEM.plank && objectId === LOC.shipHole) {
      repairShip(player);
      event.handled = true;
    }
  }

  /**
   * Cross a wall-straight maze door one tile past the edge it blocks. The
   * use-item walk can leave the player standing on the door tile, and the old
   * "east of the door" guess then sent them back the way they came; the door's
   * face (0 west, 1 south, 2 east, 3 north - the blocked edge) says which way
   * is through. A player already across the door is sent back the other way.
   */
  function crossMazeDoor(player, object, location) {
    const face = Number(object?.getFace?.() ?? 0) & 0x3;
    const pos = player.getLocation();
    if (face === 0 || face === 2) {
      const throughX = face === 0 ? location.x - 1 : location.x + 1;
      const acrossX = pos.getX() === location.x
        ? throughX
        : pos.getX() < location.x ? location.x + 1 : location.x - 1;
      player.moveTo(new Location(acrossX, location.y, location.z));
      return;
    }
    const throughY = face === 1 ? location.y + 1 : location.y - 1;
    const acrossY = pos.getY() === location.y
      ? throughY
      : pos.getY() < location.y ? location.y + 1 : location.y - 1;
    player.moveTo(new Location(location.x, acrossY, location.z));
  }

  function handleShipHoleClick(event) {
    repairShip(event.player);
  }

  /** The Lady Lumbridge's gangplanks are this quest's, not the generic gangplank crossing's. */
  function claimShipGangplank(request) {
    if (!LOC.shipGangplanks.includes(request.objectId)) return;
    const stage = quest.getStage(request.player);
    if (stage < STAGE_BOUGHT_SHIP) {
      request.handled = true;
      request.player.sendMessage("The ship is not ready to sail yet.");
      return;
    }
    // Ned waits on deck; boarding does not start the voyage.
  }

  function handleGangplankClick(event) {
    if (quest.getStage(event.player) >= STAGE_BOUGHT_SHIP) return false;
    event.player.sendMessage("You must buy the ship before boarding it.");
  }

  function plainLocation(value) {
    if (!value) return null;
    return { x: value.getX?.() ?? value.x, y: value.getY?.() ?? value.y, z: value.getZ?.() ?? value.z };
  }

  function crossMagicDoor(player, loc) {
    const px = player.getLocation().getX();
    player.moveTo(new Location(px <= loc.x ? loc.x + 1 : loc.x - 1, loc.y, loc.z));
  }

  function handleMagicDoorClick(event) {
    const { player } = event;
    event.handled = true;
    if (offerings(player) !== 15) { player.sendMessage("You can't see any way to open the door."); return; }
    const at = plainLocation(event.location ?? event.object?.getLocation?.());
    if (at) crossMagicDoor(player, at);
  }

  function handleMelzarEntranceClick(event) {
    const { player } = event;
    event.handled = true;
    const at = event.object?.getLocation?.();
    // The same exterior door on the building's east side is the way out of the
    // north-east ladder room; the Exit doors themselves only lead into the maze.
    if (at && player.getLocation().getX() < at.getX()) {
      player.moveTo(TILE.melzarOutside.clone());
      return;
    }
    if (quest.getStage(player) < STAGE_OZIACH || !hasItem(player, ITEM.mazeKey)) {
      player.sendMessage("The door is locked.");
      return;
    }
    player.moveTo(TILE.melzarInside.clone());
  }

  function handleMazeDoorClick(event) {
    const doorIndex = MAZE_DOORS.indexOf(event.objectId ?? event.object?.getId?.());
    if (doorIndex < 0) return;
    const { player } = event;
    event.handled = true;
    const key = MAZE_KEYS[doorIndex];
    if (!hasItem(player, key)) { player.sendMessage("The door is locked."); return; }
    player.getInventory().deleteNumber(key, 1);
    player.sendMessage("The key disintegrates as it unlocks the door.");
    const at = plainLocation(event.location ?? event.object?.getLocation?.());
    crossMazeDoor(player, event.object, at);
  }

  /** Doors.plugin claims Open first; these quest doors answer its door:toggle event. */
  function claimQuestDoor(request) {
    if (request.handled) return;
    const id = request.objectId ?? request.object?.getId?.();
    if (id !== LOC.crandorShortcut && id !== LOC.magicDoor && id !== LOC.melzarEntrance
      && id !== LOC.melzarExitDoor && !MAZE_DOORS.includes(id)) return;
    const option = request.option ?? request.definition?.getInteractions?.()[request.clickType - 1];
    if (option !== "Open") return;
    if (id === LOC.crandorShortcut) return handleCrandorShortcutClick(request);
    if (id === LOC.magicDoor) return handleMagicDoorClick(request);
    if (id === LOC.melzarEntrance) return handleMelzarEntranceClick(request);
    if (id === LOC.melzarExitDoor) return handleMelzarExitDoorClick(request);
    return handleMazeDoorClick(request);
  }

  /**
   * Brown exit doors at the cache placements above. Only the room side may pass
   * into the maze or exit corridor; the other side is refused so it cannot
   * re-enter without the matching maze key (Wiki Dragon Slayer I: use the normal
   * door and start the maze over).
   */
  function handleMelzarExitDoorClick(event) {
    const at = event.object?.getLocation?.();
    if (!at) return;
    const placement = MELZAR_EXIT_DOORS.find(door =>
      door.x === at.getX() && door.y === at.getY() && door.z === at.getZ());
    if (!placement) return;
    const pos = event.player.getLocation();
    const dx = pos.getX() - placement.x, dy = pos.getY() - placement.y;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return;
    if (placement.exitX === 1 ? dx >= 0 : dx < 0) return;
    event.handled = true;
    const location = plainLocation(event.location ?? at);
    crossMazeDoor(event.player, event.object, location);
  }

  /**
   * FUNLADDERTOP 2605 is a one-way basement entry with no ClimbLinks pair. Keep the
   * climb animation by handing the real destination to Ladders' climbDown.
   * Destination is the Melzar basement copy at the same x/y (+6400), inside QH's
   * zombie-room zone (2931..2933, 9639..9644).
   */
  function claimMelzarBasementLadder(request) {
    if (request.handled || request.objectId !== LOC.melzarBasementLadder) return;
    const at = request.object?.getLocation?.();
    if (!at || at.getX() !== TILE.melzarBasementLadder.getX() || at.getY() !== TILE.melzarBasementLadder.getY()
      || at.getZ() !== TILE.melzarBasementLadder.getZ()) return;
    const option = request.object?.getDefinition?.().getInteractions?.()[request.clickType - 1];
    if (option !== "Climb-down") return;
    request.handled = true;
    api.emitCustomEvent("ladders:climbDown", { player: request.player, destination: TILE.melzarBasement.clone() });
  }

  function handleOracleChestClick(event) {
    const { player } = event;
    if (oracleState(player) < 3 || ownsMapPiece(player, ITEM.mapOracle)) {
      player.sendMessage("You find nothing useful.");
      return;
    }
    if (giveItem(player, ITEM.mapOracle)) player.sendMessage("You find a piece of an old map.");
  }

  function handleMelzarChestClick(event) {
    const { player } = event;
    if (quest.getStage(player) < STAGE_OZIACH || ownsMapPiece(player, ITEM.mapMelzar)) {
      player.sendMessage("You find nothing in the chest.");
      return;
    }
    if (giveItem(player, ITEM.mapMelzar)) player.sendMessage("You find a piece of an old map.");
  }

  function handleCrandorOpeningClick({player}) {
    if (scenes.has(player) || actions.has(player)) return;
    if (saved(player, ELVARG_SEEN_ATTRIBUTE)) { player.moveTo(TILE.crandorLair.clone()); return; }
    const scene = new VoyageScene(player, true); scene.returnTile = TILE.crandorLair.clone(); scenes.set(player, scene);
    freeze(player); fade(player, true); player.getPacketSender().sendVarbit(6719, 2).sendVarbit(542, 1);
    for (let axis = 0; axis < 5; axis++) player.getPacketSender().sendCameraShake(axis, 0);
    later(scene, 4, () => {
      player.moveTo(scene.sourceTile(2833, 9656)); scene.enter(player); sceneActor(scene, ELVARG_INTRO_NPC_ID, 2854, 9638);
      camera(player, scene, [2848, 9639, 475], [2856, 9650, 150], 232, true); fade(player, false);
    });
    later(scene, 7, () => camera(player, scene, [2848, 9639, 250], [2866, 9640, 150], 2, true));
    later(scene, 13, () => fade(player, true));
    later(scene, 16, () => {
      scene.cameraReleased = true;
      player.getPacketSender().sendCameraTranslate(2816 - scene.getBaseX(), 9600 - scene.getBaseY());
      player.setAttribute(ELVARG_SEEN_ATTRIBUTE, 1); scene.leave(player, false); player.moveTo(scene.returnTile);
      player.getMovementQueue().setBlockMovement(true); player.setUntargetable(true);
      const token = {}; actions.set(player, token);
      later(token, 1, () => { if (actions.get(player) === token) fade(player, false); });
      later(token, 4, () => {
        if (actions.get(player) !== token) return;
        actions.delete(player); player.getMovementQueue().setBlockMovement(false); player.setUntargetable(false);
        player.getPacketSender().sendCameraUnlock(false).sendCameraReset().sendInterfaceRemoval().closeSubInterface(SCENE_OVERLAY_UID);
      });
    });
  }

  /**
   * The Crandor climbing rope (25213) links the lair to the surface. Both tiles are
   * plane 0; the lair is the map's +6400 underground copy, so the side the player is
   * on decides the destination (the generic ladder map link guessed the empty plane 1).
   */
  function climbCrandorRope(player) {
    if (scenes.has(player) || actions.has(player)) return;
    const inLair = player.getLocation().getY() >= 6400;
    player.moveTo((inLair ? TILE.crandorSurface : TILE.crandorLair).clone());
  }

  /** Crandor surface plus the dungeon north of the secret wall; the Karamja side is y<=9600. */
  function onCrandor(player) {
    const at = player.getLocation(), x = at.getX(), y = at.getY();
    if (at.getZ() !== 0) return false;
    return (x >= 2810 && x <= 2872 && y >= 3228 && y <= 3312)
      || (x >= 2821 && x <= 2872 && y >= 9601 && y <= 9663);
  }

  function openCrandorShortcut(player) {
    if (player.getAttribute(ATTR_SHORTCUT) === true) return;
    player.setAttribute(ATTR_SHORTCUT, true);
    player.getPacketSender().sendVarbit(SHORTCUT_VARBIT, 1);
  }

  /**
   * https://oldschool.runescape.wiki/w/Dragon_Slayer_I (Trivia): "If you sail to Crandor
   * and then teleport out without opening the secret entrance from Karamja to Crandor,
   * the shortcut will unlock by itself." Death respawn takes the same leave-Crandor path.
   * Private scenes are not the island, so their map-square changes must not unlock it.
   */
  function unlockShortcutAfterLeaving(player) {
    if (quest.getStage(player) !== STAGE_CRANDOR || saved(player, ELVARG_KILLED_ATTRIBUTE)) return;
    if (player.getAttribute(ATTR_SHORTCUT) === true || onCrandor(player)) return;
    if (scenes.has(player) || actions.has(player) || player.getPrivateArea?.()) return;
    openCrandorShortcut(player);
  }

  function crossCrandorShortcut(player) {
    player.moveTo((player.getLocation().getY() > SHORTCUT_TILE.getY() ? SHORTCUT_SOUTH : SHORTCUT_NORTH).clone());
  }

  function handleCrandorShortcutClick(event) {
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) < STAGE_CRANDOR) return;
    openCrandorShortcut(player);
    crossCrandorShortcut(player);
  }

  function handleCrandorRopeClick(event) {
    climbCrandorRope(event.player);
  }

  function handleMapSquareChange({ player }) {
    unlockShortcutAfterLeaving(player);
  }

  /** The rope's "Climb" is claimed before Ladders' generic climb prompt can guess a plane. */
  function claimCrandorRope(request) {
    if (request.objectId !== LOC.crandorRope) return;
    request.handled = true;
    climbCrandorRope(request.player);
  }

  /** The low wall between the entrance rope and Elvarg's chamber. */
  function handleCrandorWallClick(event) {
    const { player } = event;
    if (scenes.has(player) || actions.has(player)) return;
    const entering = player.getLocation().getX() < 2846;
    if (entering && quest.getStage(player) < STAGE_OZIACH) { player.sendMessage("You have no reason to enter the dragon's lair."); return; }
    if (entering && !saved(player, ELVARG_KILLED_ATTRIBUTE)) api.emitCustomEvent("elvarg:enter", {player, handled:false, aggressive:false});
    const start = new Location(entering ? 2845 : 2847, 9636, 0), end = new Location(entering ? 2847 : 2845, 9636, 0);
    const token = {}; actions.set(player, token);
    player.moveTo(start); player.getMovementQueue().reset().setBlockMovement(true);
    const movement = new ForceMovement(start, new Location(end.getX() - start.getX(), 0), 30, 94, entering ? 1 : 3, 839);
    player.setForceMovement(movement); player.performAnimation(new Animation(839, 30));
    later(token, 4, () => {
      if (actions.get(player) !== token) return;
      actions.delete(player); player.setForceMovement(null); player.moveTo(end); player.getMovementQueue().setBlockMovement(false);
      if (entering && !saved(player, ELVARG_KILLED_ATTRIBUTE)) api.emitCustomEvent("elvarg:enter", {player, handled:false, aggressive:true});
      else if (!entering) api.emitCustomEvent("elvarg:leave", {player});
    });
  }

  // ============================================================================
  // NPC deaths: Wormbrain's map piece and Elvarg
  // ============================================================================

  function handleNpcDeath(event) {
    const { killer, npcId } = event;
    if (!killer || typeof killer.getInventory !== "function") return;
    const stage = quest.getStage(killer);

    if (ELVARG_NPC_IDS.has(npcId)) {
      if (stage !== STAGE_CRANDOR || saved(killer, ELVARG_KILLED_ATTRIBUTE)) return;
      const area = killer.getPrivateArea(), at = event.npc.getLocation().clone();
      const body = new GameObject(ELVARG_BODY, at, 10, 1, area);
      api.getObjectManager().register(body, true); if (area) area.add(body);
      const token = {}; actions.set(killer, token);
      killer.setAttribute(ELVARG_KILLED_ATTRIBUTE, 1);
      killer.getMovementQueue().reset().setBlockMovement(true); killer.setUntargetable(true);
      later(token, 1, () => {
        killer.getPacketSender().sendConfig(VARP_DRAGON_SLAYER, 9);
      });
      later(token, 5, () => { if (actions.get(killer) === token) { killer.moveTo(new Location(at.getX(), at.getY() - 1, at.getZ())); killer.performAnimation(new Animation(6654)); } });
      later(token, 11, () => {
        if (actions.get(killer) !== token) return;
        api.getObjectManager().deregister(body, true);
        const headless = new GameObject(ELVARG_HEADLESS, at, 10, 1, area);
        api.getObjectManager().register(headless, true); if (area) area.add(headless);
        killer.performAnimation(new Animation(6655));
        if (!hasItem(killer, ITEM.elvargsHead)) {
          if (killer.getInventory().isFull()) dropItem(killer, ITEM.elvargsHead, {x:at.getX(),y:at.getY(),z:at.getZ()});
          else giveItem(killer, ITEM.elvargsHead);
        }
        killer.sendMessage("You cut off Elvarg's head as proof of your victory!");
        killer.getPacketSender().sendJingle(267, 0);
        later(token, 3, () => { actions.delete(killer); killer.getMovementQueue().setBlockMovement(false); killer.setUntargetable(false); });
      });
      return;
    }

    if (npcId === WORMBRAIN_NPC_ID) {
      if (stage >= STAGE_OZIACH && askedAbout(killer, INSTRUCTION.wormbrain) && !ownsMapPiece(killer, ITEM.mapWormbrain)) {
        dropItem(killer, ITEM.mapWormbrain, event.location);
        killer.sendMessage("Wormbrain drops a map piece on the floor.");
      }
      return;
    }
  }

  function repairShip(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_CRANDOR) {
      player.sendMessage(saved(player, ATTR_SHORTCUT)
        ? "You don't need to mess about with broken ships now that you have found the secret passage from Karamja."
        : "The ship doesn't need repairing.");
      return;
    }
    if (stage < STAGE_BOUGHT_SHIP || stage >= STAGE_REPAIR_3) {
      player.sendMessage("The ship doesn't need repairing.");
      return;
    }
    if (!hasItem(player, ITEM.plank)) {
      player.sendMessage("You'll need to use wooden planks on this hole to patch it up.");
      return;
    }
    if (!hasItem(player, ITEM.steelNails, 30)) {
      player.sendMessage("You need 30 steel nails to attach the plank with.");
      return;
    }
    if (!hasItem(player, ITEM.hammer)) { player.sendMessage("You need a hammer to attach the plank with."); return; }
    if (actions.has(player)) return;
    const token = {}; actions.set(player, token);
    player.performAnimation(new Animation(3676));
    player.getMovementQueue().reset().setBlockMovement(true);
    later(token, 2, () => {
      if (actions.get(player) !== token) return;
      actions.delete(player); player.getMovementQueue().setBlockMovement(false);
      if (quest.getStage(player) !== stage || !hasItem(player, ITEM.plank) || !hasItem(player, ITEM.steelNails, 30) || !hasItem(player, ITEM.hammer)) return;
      player.getInventory().deleteNumber(ITEM.plank, 1);
      player.getInventory().deleteNumber(ITEM.steelNails, 30);
      const next = stage === STAGE_BOUGHT_SHIP ? STAGE_REPAIR_1 : stage === STAGE_REPAIR_1 ? STAGE_REPAIR_2 : STAGE_REPAIR_3;
      quest.setStage(player, next); syncState({player});
      const text = next === STAGE_REPAIR_3
        ? "You nail a final plank over the hole. You have successfully patched the hole in the ship."
        : `You nail a plank over the hole, but you still need ${next === STAGE_REPAIR_1 ? "more planks" : "one more plank"} to close the hole completely.`;
      player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
    });
  }

  quest = registerQuest(api, {
    key: "dragon_slayer_i",
    name: "Dragon Slayer I",
    varpId: VARP_DRAGON_SLAYER,
    varpValue: wireStage,
    startedValue: STAGE_GUILDMASTER,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.STRENGTH.getIndex(), amount: 18650, label: "Strength" },
      { skillId: Skill.DEFENCE.getIndex(), amount: 18650, label: "Defence" },
    ],
    scrollItemId: ITEM.elvargsHead,
    completionJingleId: 152,
    otherRewards: [
      "Ability to equip Rune and",
      "Dragon Platebodies",
    ],
    buildJournal,
    onReward: reward,
  });

  for (const key of [OFFERINGS_ATTRIBUTE, INSTRUCTIONS_ATTRIBUTE, NED_KNOWS_ATTRIBUTE, ELVARG_SEEN_ATTRIBUTE, ELVARG_KILLED_ATTRIBUTE, EXPLAINED_ATTRIBUTE]) api.persistAttribute(key, 0);
  api.persistAttribute(ATTR_ORACLE, 0);
  api.persistAttribute(ATTR_NED_ASKED);
  api.persistAttribute(ATTR_OZIACH_CONGRATS);
  api.persistAttribute(ATTR_SHORTCUT);
  itemOnGroundManager = api.getItemOnGroundManager();

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onPlayerLogin(syncState);
  api.onPlayerMapSquareChange(handleMapSquareChange);
  api.onPlayerLogout(cleanup);
  api.onPlayerDisconnect(cleanup);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnObject(handleItemOnObject);
  api.onObjectFirstClick(LOC.shipHole, handleShipHoleClick);
  api.onObjectFirstClick(LOC.shipGangplanks, handleGangplankClick);
  api.onCustomEvent("ladders:climb", claimShipGangplank);
  api.onCustomEvent("ladders:climb", claimCrandorRope);
  api.onCustomEvent("ladders:climb", claimMelzarBasementLadder);
  api.onCustomEvent("door:toggle", claimQuestDoor);
  api.onObjectFirstClick(LOC.magicDoor, handleMagicDoorClick);
  api.onObjectFirstClick(LOC.melzarEntrance, handleMelzarEntranceClick);
  api.onObjectFirstClick(LOC.melzarExitDoor, handleMelzarExitDoorClick);
  api.onObjectFirstClick(MAZE_DOORS, handleMazeDoorClick);
  api.onObjectFirstClick(LOC.oracleChest, handleOracleChestClick);
  api.onObjectFirstClick(LOC.melzarChest, handleMelzarChestClick);
  api.onObjectFirstClick(LOC.crandorOpening, handleCrandorOpeningClick);
  api.onObjectFirstClick(LOC.crandorRope, handleCrandorRopeClick);
  api.onObjectFirstClick(LOC.crandorWall, handleCrandorWallClick);
  api.onObjectFirstClick(LOC.crandorShortcut, handleCrandorShortcutClick);
  api.onNpcDeath(handleNpcDeath);
};
