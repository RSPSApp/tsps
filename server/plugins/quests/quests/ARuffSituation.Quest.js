/** A Ruff Situation: RSProx main recording and puppy follow-up, revision241.
 * Captured stage values, interactions, actor choreography and camera sequences
 * are documented in docs/p2p-varlamore-pair-parity.md. Raw logs stay local.
 */
module.exports = function registerARuffSituationQuest(api) {
  const {
    ActionDialogue, Animation, Area, Boundary, CountdownTask, DialogueChainBuilder,
    ItemStatementDialogue, PrivateArea, StatementDialogue, TaskManager,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "A Ruff Situation";
  const START_HOOK = "quest:a-ruff-situation:start";

  // Varp 5742 "dogquest" (scripts/lookup-gameval.ts varbit dogquest).
  const VARP_DOGQUEST = 5742;
  const STAGE_VARBIT = 15889;

  const STAGE_ACCEPTED = 5, STAGE_LEADING = 20, STAGE_INSPECTED = 30;
  const STAGE_FIRST_SCENE = 40, STAGE_FIRST_PICKUP = 45, STAGE_FIRST_SAFE = 50;
  const STAGE_CRAFTED = 65, STAGE_TRADE = 66, STAGE_GOBLINS_GONE = 70;
  const STAGE_THIRD_SEARCH = 80, STAGE_OUTLAW_SCENE = 85;
  const STAGE_RESCUE = 95, STAGE_THIRD_PICKUP = 100, STAGE_SHELTER = 110, STAGE_FINAL_SCENE = 115;
  const STAGE_STARTED = 10;
  const STAGE_GERTRUDE = 15;
  const STAGE_DOG = 25;
  const STAGE_DEN = 35;
  const STAGE_FIRST_PUPPY = 55;
  const STAGE_STUFFED_DOG = 60;
  const STAGE_SECOND_PUPPY = 75;
  const STAGE_OUTLAWS = 90;
  const STAGE_THIRD_PUPPY = 105;
  const STAGE_COMPLETE = 120;

  const CRAFTING_REQUIREMENT = 15;
  const GERTRUDES_CAT_KEY = "gertrudes_cat";

  const TALIA_NPC_ID = NpcIdentifiers.TALIA_2; // 16486
  const CHASE_NPC_ID = NpcIdentifiers.CHASE; // 16488
  const GERTRUDE_NPC_IDS = new Set([NpcIdentifiers.GERTRUDE, NpcIdentifiers.GERTRUDE_2]);
  const QUEST_GUARD_NPC_ID = NpcIdentifiers.GUARD_302; // 16493
  const STRAY_DOG_NPC_ID = NpcIdentifiers.STRAY_DOG_8; // 16504, Interact
  const STRAY_DOG_FOLLOWING_NPC_ID = NpcIdentifiers.STRAY_DOG_9; // 16505, Interact|Dismiss
  const PICKLENOSE_NPC_ID = NpcIdentifiers.PICKLENOSE; // 16523
  const TOETALLER_NPC_ID = NpcIdentifiers.TOETALLER; // 16524
  const OUTLAW_23_NPC_ID = NpcIdentifiers.OUTLAW_11; // 16527, level 23
  const OUTLAW_22_NPC_ID = NpcIdentifiers.OUTLAW_12; // 16528, level 22
  const STRAY_DOG_NPC_IDS = new Set([
    STRAY_DOG_NPC_ID,
    STRAY_DOG_FOLLOWING_NPC_ID,
    NpcIdentifiers.STRAY_DOG_10, // 16529
    NpcIdentifiers.STRAY_DOG_11, // 16530
  ]);

  const GRAIN_ITEM_ID = ItemIdentifiers.GRAIN; // 1947
  const FUR_ITEM_ID = ItemIdentifiers.FUR; // 6814
  const BEAR_FUR_ITEM_ID = ItemIdentifiers.BEAR_FUR; // 948
  const GREY_WOLF_FUR_ITEM_ID = ItemIdentifiers.GREY_WOLF_FUR; // 958
  const FOX_FUR_ITEM_ID = ItemIdentifiers.FOX_FUR; // 29163
  const JAGUAR_FUR_ITEM_ID = ItemIdentifiers.JAGUAR_FUR; // 29218
  const FUR_ITEM_IDS = new Set([
    FUR_ITEM_ID,
    BEAR_FUR_ITEM_ID,
    GREY_WOLF_FUR_ITEM_ID,
    FOX_FUR_ITEM_ID,
    JAGUAR_FUR_ITEM_ID,
  ]);
  const NEEDLE_ITEM_ID = ItemIdentifiers.NEEDLE; // 1733
  const THREAD_ITEM_ID = ItemIdentifiers.THREAD; // 1734
  const COSTUME_NEEDLE_ITEM_ID = ItemIdentifiers.COSTUME_NEEDLE; // 29920
  const STUFFED_DOG_ITEM_ID = ItemIdentifiers.STUFFED_DOG; // 34602


  const TALIA_TILE = { x: 3036, y: 3456 };
  const CHASE_TILE = { x: 3037, y: 3457 };
  const GUARD_TILE = { x: 3179, y: 3425 };
  const BANK_DOG_TILE = { x: 3180, y: 3425 };
  const DEN_DOG_TILE = { x: 3197, y: 3414 };
  const COOK_DOG_TILE = { x: 3148, y: 3456 };
  const GOBLIN_DOG_TILE = { x: 3132, y: 3436 };
  const CAMP_DOG_TILE = { x: 3136, y: 3467 };
  const PICKLENOSE_TILE = { x: 3130, y: 3437 };
  const TOETALLER_TILE = { x: 3130, y: 3435 };
  const OUTLAW_TILES = new Map([
    [OUTLAW_23_NPC_ID, { x: 3136, y: 3474 }],
    [OUTLAW_22_NPC_ID, { x: 3135, y: 3475 }],
  ]);

  // Condition step ids on the "A Ruff Situation" page.
  const REQUIREMENTS_NOT_MET_CONDITION_ID = "L94gv4";
  const REQUIREMENTS_MET_CONDITION_ID = "HETyUu";
  const CAT_NOT_DONE_CONDITION_ID = "8Dawwp";
  const CAT_DONE_CONDITION_ID = "Kxe_wx";
  const GERTRUDE_CAT_DONE_CONDITION_ID = "uj8cWF";
  const GERTRUDE_CAT_NOT_DONE_CONDITION_ID = "K0h0go";
  const NO_SPACE_CUTSCENE_CONDITION_ID = "nBi_OT";
  const NO_FOLLOWER_CONDITION_ID = "HB4vku";
  const HAS_FOLLOWER_CONDITION_ID = "LSUSeA";
  const DOG_FOLLOWING_CONDITION_ID = "LCq_B6";
  const DOG_NOT_FOLLOWING_CONDITION_ID = "8YcOp_";
  const GOT_GRAIN_CONDITION_ID = "TmJIzl";
  const NO_GRAIN_CONDITION_ID = "t9Ur6J";
  const GOT_FUR_CONDITION_ID = "rVWHFC";
  const NO_FUR_CONDITION_ID = "1IDQ_T";
  const GOT_NEEDLE_CONDITION_ID = "sV_vTi";
  const NO_NEEDLE_CONDITION_ID = "h8Xi6t";
  const GOT_THREAD_CONDITION_ID = "zopo9g";
  const NO_THREAD_CONDITION_ID = "JRfGJi";
  const MISSING_ITEMS_CONDITION_ID = "tSYWmu";
  const HAS_ITEMS_CONDITION_ID = "o7fqus";
  const NO_SPACE_GOBLINS_CONDITION_ID = "yApHLl";
  const NO_SPACE_OUTLAWS_CONDITION_ID = "7ZjmSz";
  const MISSING_PUPPIES_CONDITION_ID = "38Af3Z";
  const HAS_PUPPIES_CONDITION_ID = "w58Zw0";
  const NO_SPACE_SPANIEL_CONDITION_ID = "2DRYza";
  const HAS_SPACE_SPANIEL_CONDITION_ID = "XjUT9d";

  // Action/message step ids on the page.
  const PUPPY_APPEARS_STEP = "FcFo5X";
  const PUPPY_APPROACHES_STEP = "0JYuUr";
  const GOBLIN_RUNS_STEP = "9rWUTo";
  const FIRST_PUPPY_PICKUP_STEP = "sZmmAX";
  const GIVE_STUFFED_DOG_STEP = "dsJOoa";
  const GOBLINS_LEAVE_STEP = "AsGBaf";
  const SECOND_PUPPY_PICKUP_STEP = "9aHrpW";
  const OUTLAWS_APPROACH_STEP = "WaE4-O";
  const OUTLAWS_CONTINUE_STEP = "VHbybd";
  const RUN_IN_STEP = "SwYquA";
  const THIRD_PUPPY_PICKUP_STEP = "61xr7U";
  const PLACE_PUPPIES_STEP = "9JXyoS";
  const DOG_LEAVES_STEP = "Darl0H";
  const GUARD_WALKS_IN_STEP = "XTGJ4B";
  const QUEST_COMPLETE_STEP = "sCG0ie";



  const TALIA_OFFERED_ATTRIBUTE = "quest.a_ruff_situation.talia-offered";
  const INSPECTED_ATTRIBUTE = "quest.a_ruff_situation.inspected";
  const DOG_WAITING_ATTRIBUTE = "quest.a_ruff_situation.dog-waiting";
  const THIRD_HUNT_ATTRIBUTE = "quest.a_ruff_situation.third-hunt";
  const GOBLINS_LEFT_ATTRIBUTE = "quest.a_ruff_situation.goblins-left";
  const OUTLAWS_KILLED_ATTRIBUTE = "quest.a_ruff_situation.outlaws-killed";
  const BIT_NEWSPAPER = 1 << 0;
  const BIT_CHEWED_BOX = 1 << 1;
  const BIT_BEDDING = 1 << 2;
  const ALL_INSPECTED = BIT_NEWSPAPER | BIT_CHEWED_BOX | BIT_BEDDING;
  const OUTLAW_BITS = new Map([
    [OUTLAW_23_NPC_ID, 1 << 0],
    [OUTLAW_22_NPC_ID, 1 << 1],
  ]);
  const ALL_OUTLAWS_KILLED = (1 << 0) | (1 << 1);

  /** Tracked per-player owner-only spawns, keyed by role. */
  const trackedNpcs = new WeakMap();
  const DATA = require("../data/a-ruff-situation.json");
  const VERSION_ATTRIBUTE = "a-ruff-situation:stage-version";
  const PUPPIES = [ItemIdentifiers.STRAY_PUPPY, ItemIdentifiers.STRAY_PUPPY_2, ItemIdentifiers.STRAY_PUPPY_3];
  const DEN_FLAGS = [15894, 15895, 15896];
  const scenes = new WeakMap(), routes = new WeakMap(), actionKeys = new WeakMap();
  const FADE_UID = (161 << 16) | 1;
  const WELCOME_PLAY_BUTTON_UID = (378 << 16) | 72;
  const pendingRecovery = new WeakMap();


  let quest;

  // ==========================================================================
  // State helpers
  // ==========================================================================

  function tracked(player) {
    let map = trackedNpcs.get(player);
    if (!map) {
      map = new Map();
      trackedNpcs.set(player, map);
    }
    return map;
  }

  function spawnTracked(player, key, definition) {
    const map = tracked(player);
    if (map.get(key)) return map.get(key);
    const npc = api.spawnNpc({ ...definition, owner: player, ownerOnly: true });
    if (npc) map.set(key, npc);
    return npc;
  }

  function removeTracked(player, key) {
    const map = trackedNpcs.get(player);
    const npc = map?.get(key);
    if (npc) {
      api.removeNpc(npc);
      map.delete(key);
    }
  }

  function removeAllTracked(player) {
    const map = trackedNpcs.get(player);
    if (!map) return;
    for (const npc of map.values()) api.removeNpc(npc);
    trackedNpcs.delete(player);
  }

  function atTile(npc, tile) {
    const location = npc?.getLocation?.();
    return !!location && location.getX() === tile.x && location.getY() === tile.y && location.getZ() === 0;
  }

  function setStage(player, stage) {
    if (quest.getStage(player) === stage) return;
    quest.setStage(player, stage);
    syncNpcs(player);
    syncFlags(player);
  }

  function craftingLevel(player) {
    return player.getSkillManager().getMaxLevel(Skill.CRAFTING);
  }

  function freeSlots(player) {
    return player.getInventory().getFreeSlots();
  }

  function hasItem(player, itemId) {
    return player.getInventory().getAmount(itemId) > 0;
  }

  function hasAnyFur(player) {
    for (const itemId of FUR_ITEM_IDS) if (hasItem(player, itemId)) return true;
    return false;
  }

  function hasNeedle(player) {
    return hasItem(player, NEEDLE_ITEM_ID) || hasItem(player, COSTUME_NEEDLE_ITEM_ID);
  }

  function hasThreadOrCostumeNeedle(player) {
    return hasItem(player, THREAD_ITEM_ID) || hasItem(player, COSTUME_NEEDLE_ITEM_ID);
  }

  function hasCraftItems(player) {
    return hasItem(player, GRAIN_ITEM_ID) && hasAnyFur(player) && hasNeedle(player) && hasThreadOrCostumeNeedle(player);
  }

  function questComplete(player, key) {
    const request = { player, key };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function questStage(player, key) {
    const request = { player, key };
    api.emitCustomEvent("quest:get-stage", request);
    return Number(request.stage) || 0;
  }

  function hasFollower(player) {
    const current = player.getAttribute?.("pets:current");
    return current?.isRegistered?.() === true;
  }

  function inspectedMask(player) {
    return Number(player.getAttribute(INSPECTED_ATTRIBUTE)) || 0;
  }

  function dogWaiting(player) {
    return player.getAttribute(DOG_WAITING_ATTRIBUTE) === true;
  }

  function thirdHunt(player) {
    return player.getAttribute(THIRD_HUNT_ATTRIBUTE) === true;
  }

  function isDogFollowing(player) {
    return !dogWaiting(player) && !quest.isComplete(player);
  }

  function isQuestPage(pages) {
    return Array.isArray(pages) && pages.some((page) => page?.page === PAGE);
  }

  function later(key, ticks, callback) {
    TaskManager.submit(new CountdownTask(key, ticks, callback));
  }
  function camera(player, move, look, motion = { rate: 232, rate2: 100 }) {
    const sender = player.getPacketSender(), options = { ...motion, heightRelative: false };
    if (move) sender.sendCameraMoveTo(...move, options);
    if (look) sender.sendCameraLookAt(...look, options);
  }
  function controls(player, blocked) {
    player.getMovementQueue().reset().setBlockMovement(blocked);
    player.setUntargetable(blocked);
    player.getPacketSender().sendVarbit(12393, blocked ? 1 : 0).sendVarbit(6719, blocked ? 2 : 0);
  }
  function fade(player, out) {
    player.getPacketSender().sendSubInterface(FADE_UID, 174, 1, {
      postScripts: [{ scriptId: 948, args: out ? [0, 255, 0, 0, 50] : [0, 0, 0, 255, 50] }],
    });
  }
  function freeze(player) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new ActionDialogue(0, { execute: () => StatementDialogue.send(player, "", false) })
    ));
  }
  class DogScene extends PrivateArea {
    constructor(player) { super([new Boundary(3008, 3210, 3392, 3500, 0)]); this.owner = player; }
    canAttack() { return false; }
    canTeleport() { return false; }
    postLeave(actor, logout) {
      if (actor === this.owner && scenes.get(actor)?.area === this) cleanupScene(actor, false);
      super.postLeave(actor, logout);
    }
  }
  function spawnSceneActor(scene, key, id, x, y) {
    if (!scene) return null;
    if (scene.actors.has(key)) return scene.actors.get(key);
    const npc = api.spawnNpc({ id, x, y, z: 0, owner: scene.player, ownerOnly: true, wanderRadius: 0 });
    if (npc) { scene.actors.set(key, npc); scene.area.enter(npc); }
    return npc;
  }
  function cleanupScene(player, returnPlayer = true) {
    const scene = scenes.get(player);
    if (!scene) return;
    scenes.delete(player); TaskManager.cancelTasks(scene);
    for (const npc of scene.actors.values()) api.removeNpc(npc);
    controls(player, false);
    player.getPacketSender().sendCameraUnlock(false).sendCameraReset().closeSubInterface(FADE_UID);
    if (scene.area && player.getArea() === scene.area && returnPlayer) {
      scene.area.leave(player, false); player.moveTo(scene.returnTo);
    }
  }
  const SCENE_VARIANTS = {
    first: "cutscene", outlaws: "looking-for-the-third-puppy-cutscene",
    rescue: "looking-for-the-third-puppy-after-killing-the-outlaws",
    shelter: "looking-for-the-third-puppy-back-at-the-shelter",
  };
  function playScene(player, anchor) {
    const scene = scenes.get(player); if (!scene) return;
    startTranscript(api, player, STRAY_DOG_NPC_ID, PAGE, SCENE_VARIANTS[scene.name], steps => {
      if (!anchor) return steps;
      const index = steps.findIndex(step => step.id === anchor);
      return index >= 0 ? steps.slice(index + 1) : steps;
    });
  }
  function beginScene(player, name) {
    if (scenes.has(player)) return;
    if (name === "shelter" && !PUPPIES.every(id => hasItem(player, id))) {
      startTranscript(api, player, STRAY_DOG_NPC_ID, PAGE, "looking-for-the-third-puppy-talking-to-the-stray-dog-with-the-puppies"); return;
    }
    routes.delete(player); removeTracked(player, "dog");
    const returnTo = name === "first" ? new Location(3148, 3455, 0)
      : name === "outlaws" ? new Location(3136, 3469, 0)
      : name === "rescue" ? new Location(3136, 3475, 0) : new Location(3041, 3458, 0);
    const scene = { player, name, returnTo, actors: new Map(), area: null };
    scenes.set(player, scene);
    setStage(player, { first: STAGE_FIRST_SCENE, outlaws: STAGE_OUTLAW_SCENE, rescue: STAGE_RESCUE, shelter: STAGE_SHELTER }[name]);
    controls(player, true); freeze(player);
    if (name !== "rescue") fade(player, true);
    const place = () => {
      scene.area = new DogScene(player); scene.area.enter(player); player.moveTo(returnTo);
      if (name === "first") {
        spawnSceneActor(scene, "dog", 16530, 3148, 3456);
        spawnSceneActor(scene, "goblin", 16534, 3136, 3449);
        spawnSceneActor(scene, "puppy", 16531, 3136, 3450);
      } else if (name === "outlaws") {
        player.moveTo(new Location(3136, 3464, 0));
        spawnSceneActor(scene, "dog", 16530, 3136, 3465);
        spawnSceneActor(scene, "puppy", 16533, 3137, 3476);
        spawnSceneActor(scene, "outlaw-one", 16535, 3134, 3475);
        spawnSceneActor(scene, "outlaw-two", 16536, 3134, 3477);
      } else if (name === "rescue") {
        spawnSceneActor(scene, "dog", 16530, 3136, 3477);
        spawnSceneActor(scene, "puppy", 16533, 3137, 3476);
      } else {
        setStage(player, STAGE_FINAL_SCENE);
        spawnSceneActor(scene, "dog", 16530, 3043, 3457);
        spawnSceneActor(scene, "talia", 16537, 3038, 3458);
        spawnSceneActor(scene, "chase", 16538, 3037, 3458);
      }
      for (const npc of scene.actors.values()) npc.setPositionToFace(player.getLocation());
    };
    const setCamera = () => {
      player.getPacketSender().sendCameraUnlock(false);
      if (name === "first") camera(player, [3152, 3451, 400], [3148, 3456, 250]);
      if (name === "outlaws") camera(player, [3132, 3470, 600], [3137, 3476, 600]);
      if (name === "rescue") camera(player, [3131, 3476, 500], [3137, 3476, 600]);
      if (name === "shelter") camera(player, [3044, 3461, 500], [3038, 3458, 350]);
    };
    if (name === "rescue") { place(); setCamera(); later(scene, 1, () => playScene(player)); }
    else {
      later(scene, 2, place); later(scene, 3, setCamera);
      later(scene, 4, () => fade(player, false));
      later(scene, name === "shelter" ? 7 : 6, () => playScene(player));
    }
  }
  function pauseScene(event, ticks) {
    const scene = scenes.get(event.player); if (!scene) return;
    freeze(event.player); later(scene, ticks, () => playScene(event.player, event.stepId));
  }
  function leaveScene(player, resetDelay, callback) {
    const scene = scenes.get(player); if (!scene) { callback?.(); return; }
    freeze(player); fade(player, true);
    later(scene, resetDelay, () => {
      const area = scene.area; scene.area = null;
      if (area) { area.leave(player, false); player.moveTo(scene.returnTo); }
      player.getPacketSender().sendCameraUnlock(false).sendCameraReset();
    });
    later(scene, resetDelay + 2, () => {
      cleanupScene(player); syncNpcs(player); fade(player, false); callback?.();
    });
  }
  function givePuppy(player, index) {
    if (hasItem(player, PUPPIES[index])) return true;
    if (freeSlots(player) === 0) {
      const scene = scenes.get(player);
      if (scene) { const name = scene.name; cleanupScene(player); setStage(player, name === "first" ? STAGE_FIRST_SCENE : STAGE_RESCUE); }
      syncNpcs(player); player.sendMessage("You don't have room to take the stray puppy right now."); return false;
    }
    player.getInventory().adds(PUPPIES[index], 1); player.getPacketSender().sendVarbit(DEN_FLAGS[index], 0);
    removeTracked(player, `den-puppy-${index}`); removeTracked(player, "goblin-puppy");
    const scene = scenes.get(player), npc = scene?.actors.get("puppy");
    if (npc) { api.removeNpc(npc); scene.actors.delete("puppy"); }
    return true;
  }
  function pickupAfterPause(event, index, after) {
    const { player } = event, scene = scenes.get(player), key = scene ?? {};
    if (actionKeys.has(player)) return;
    actionKeys.set(player, key); freeze(player);
    later(key, 1, () => {
      player.performAnimation(new Animation(827));
      (scene?.actors.get("puppy") ?? tracked(player).get("goblin-puppy"))?.forceChat(["Yip yip!", "Yop yop!", "Yap yap!"][index]);
    });
    later(key, 2, () => {
      actionKeys.delete(player);
      if (!givePuppy(player, index)) return;
      after();
    });
  }

  function syncFlags(player) {
    const stage = quest.getStage(player), mask = inspectedMask(player), sender = player.getPacketSender();
    sender.sendVarbit(15890, (mask & BIT_BEDDING) ? 1 : 0).sendVarbit(15891, (mask & BIT_NEWSPAPER) ? 1 : 0)
      .sendVarbit(15893, (mask & BIT_CHEWED_BOX) ? 1 : 0).sendVarbit(15899, stage > 0 && stage < STAGE_COMPLETE ? 1 : 0)
      .sendVarbit(15897, stage >= STAGE_FIRST_SAFE && stage < STAGE_TRADE && !dogWaiting(player) ? 1 : 0)
      .sendVarbit(15898, dogWaiting(player) ? 1 : 0);
    const earned = [STAGE_FIRST_SAFE, STAGE_SECOND_PUPPY, STAGE_THIRD_PUPPY];
    earned.forEach((threshold, i) => sender.sendVarbit(DEN_FLAGS[i], stage >= threshold && stage < STAGE_SHELTER && !hasItem(player, PUPPIES[i]) ? 1 : 0));
  }
  function syncPuppies(player, stage) {
    [STAGE_FIRST_SAFE, STAGE_SECOND_PUPPY, STAGE_THIRD_PUPPY].forEach((threshold, i) => {
      if (stage >= threshold && stage < STAGE_SHELTER && !hasItem(player, PUPPIES[i])) {
        spawnTracked(player, `den-puppy-${i}`, { id: 16515 + i, x: 3196 + i, y: 3414, z: 0, wanderRadius: 0 });
      } else removeTracked(player, `den-puppy-${i}`);
    });
    if (stage >= STAGE_FIRST_SAFE && stage <= STAGE_GOBLINS_GONE)
      spawnTracked(player, "goblin-puppy", { id: 16516, x: 3131, y: 3435, z: 0, wanderRadius: 0 });
    else removeTracked(player, "goblin-puppy");
  }
  function markVersion({ player, key }) { if (key === "a_ruff_situation") player.setAttribute(VERSION_ATTRIBUTE, 1); }
  function migrateStage(player) {
    const previous = quest.getStage(player), migrated = [0, 10, 15, 25, 35, 55, 60, 75, 90, 105, 120][previous];
    if (player.getAttribute(VERSION_ATTRIBUTE) !== 1 && previous > 0 && previous <= 10) quest.setStage(player, migrated);
    player.setAttribute(VERSION_ATTRIBUTE, 1);
    // A disconnect during placement must not require puppies already removed from inventory.
    if (quest.getStage(player) === STAGE_TRADE && !hasItem(player, STUFFED_DOG_ITEM_ID)) {
      player.setAttribute(GOBLINS_LEFT_ATTRIBUTE, true); quest.setStage(player, STAGE_GOBLINS_GONE);
    }
    if (quest.getStage(player) === STAGE_FINAL_SCENE) {
      PUPPIES.forEach(id => { if (!hasItem(player, id) && freeSlots(player) > 0) player.getInventory().adds(id, 1); });
      quest.setStage(player, STAGE_THIRD_PUPPY);
    }
  }
  function beginRoute(player, name) {
    if (scenes.has(player) || routes.has(player)) return;
    const path = DATA.routes[name]; if (!path?.length) return;
    const dog = tracked(player).get("dog"); if (!dog) return;
    dog.setFollowing(null); dog.setMovementSteps?.(2);
    routes.set(player, { name, path, index: 0, dog, moving: false });
  }
  class DogQuestArea extends Area {
    constructor() { super([new Boundary(3010, 3210, 3392, 3500, 0)]); }
    process(actor) {
      if (!actor.isPlayer()) return;
      const player = actor.getAsPlayer(); if (scenes.has(player)) return;
      const route = routes.get(player); if (!route) return;
      const location = route.dog.getLocation();
      // shortcut: the route records pauses but not the script's exact follow-distance threshold.
      if (location.getDistance(player.getLocation()) > 10) return;
      if (route.moving && !atTile(route.dog, { x: route.path[route.index][0], y: route.path[route.index][1] })) return;
      if (route.moving) route.index++;
      if (route.index >= route.path.length) {
        routes.delete(player);
        if (route.name === "den") setStage(player, STAGE_DOG);
        else beginScene(player, route.name === "cook" ? "first" : "outlaws");
        return;
      }
      const [x, y] = route.path[route.index]; route.dog.getMovementQueue().addSteps(new Location(x, y, 0)); route.moving = true;
    }
  }
  function handleLine(event) {
    if (!isQuestPage(event.pages)) return;
    const { player, text } = event, scene = scenes.get(player), metadata = DATA.dialogue[text];
    if (metadata) {
      event.expression = metadata.expression;
      if (metadata.head) event.speakerId = metadata.head;
      if (metadata.side) event.side = metadata.side;
    }
    const speaker = event.step?.speaker;
    if (text === "..." && speaker === "Picklenose") event.speakerId = 16521;
    if (text === "..." && speaker === "Toetaller") event.speakerId = 16522;
    if (speaker === "Stray puppy" || (scene && !metadata && ["Picklenose", "Stray dog", "Stray Dog"].includes(speaker))) {
      event.skip = true; return;
    }
    const advance = (stage, after) => {
      event.before = () => setStage(player, stage);
      if (after) event.after = after;
    };
    if (text === "Gertrude." && quest.getStage(player) === STAGE_ACCEPTED) advance(STAGE_STARTED);
    if (text.startsWith("Well, it would be nice for someone to do something about those mangy stray dogs")) advance(STAGE_GERTRUDE);
    if (text === "Of course I can! Where did you want to go, girl?") advance(STAGE_LEADING);
    if (text === "You'd better be quick! She's already on the move.") event.after = () => beginRoute(player, "den");
    if (text === "What's wrong? Have you caught their scent?") advance(STAGE_DEN, () => beginRoute(player, "cook"));
    if (text === "... Then a needle and thread to put it together...") advance(STAGE_STUFFED_DOG);
    if (scene?.name === "first" && text === "Bark bark.") event.before = () => camera(player, [3152, 3454, 400], [3145, 3456, 380], { rate: 3, rate2: 30 });
    if (scene?.name === "outlaws" && text === "Look what we got 'ere.") event.before = () => camera(player, [3128, 3476, 400], null, { cycles: 210, easing: "ease_in_out_sine", ignoreTerrain: true });
    if (scene?.name === "outlaws" && text === "You'll 'av to take 'em from us.") event.after = () => {
      cleanupScene(player); setStage(player, STAGE_OUTLAWS);
    };
    if (scene?.name === "shelter" && text === "Wonderful, you will all be happy and safe here!") event.after = () => camera(player, [3034, 3450, 400], [3039, 3458, 350]);
    if (text === "You seem enthusiastic enough. Let's head out.") event.after = () => beginScene(player, "shelter");
    if (scene?.name === "shelter" && text === "Business is business.") event.after = () => {
      quest.complete(player); const active = scenes.get(player);
      later(active, 2, () => { cleanupScene(player); syncNpcs(player); syncFlags(player); });
    };
  }
  function pickupPuppy(event) {
    const { player, npc } = event, stage = quest.getStage(player), map = tracked(player);
    if (npc && map.get("goblin-puppy") === npc && stage === STAGE_GOBLINS_GONE) {
      if (givePuppy(player, 1)) { setStage(player, STAGE_SECOND_PUPPY); syncNpcs(player); }
      return;
    }
    for (let i = 0; i < 3; i++) {
      if (npc && map.get(`den-puppy-${i}`) === npc) { if (givePuppy(player, i)) syncFlags(player); return; }
    }
    return false;
  }
  function puppyItemAction(event) {
    const { player, itemId } = event;
    const index = PUPPIES.indexOf(itemId);
    if (index < 0 || !hasItem(player, itemId)) return;
    event.handled = true; player.getInventory().deleteNumber(itemId, 1);
    player.sendMessage("The stray puppy runs back to its den."); syncFlags(player); syncPuppies(player, quest.getStage(player));
  }

  // ==========================================================================
  // NPC spawns
  // ==========================================================================

  function dogTileFor(player, stage) {
    if (dogWaiting(player)) return DEN_DOG_TILE;
    if (stage === STAGE_GERTRUDE || stage === STAGE_LEADING) return BANK_DOG_TILE;
    if (stage === STAGE_FIRST_SCENE) return COOK_DOG_TILE;
    if (stage === STAGE_RESCUE || stage === STAGE_OUTLAW_SCENE) return CAMP_DOG_TILE;
    if (stage === STAGE_DOG || stage === STAGE_INSPECTED || stage === STAGE_DEN) return DEN_DOG_TILE;
    if (stage >= STAGE_FIRST_SAFE && stage <= STAGE_SECOND_PUPPY) return GOBLIN_DOG_TILE;
    if (stage === STAGE_THIRD_SEARCH) return GOBLIN_DOG_TILE;
    if (stage > STAGE_THIRD_SEARCH && stage <= STAGE_THIRD_PUPPY) return CAMP_DOG_TILE;
    return null;
  }
  function syncDog(player, stage) {
    if (scenes.has(player)) return;
    const tile = dogTileFor(player, stage), existing = tracked(player).get("dog");
    if (!tile) { removeTracked(player, "dog"); return; }
    if (routes.has(player) && existing) return;
    const follows = !dogWaiting(player) && stage >= STAGE_FIRST_PUPPY && stage < STAGE_TRADE;
    const wanted = follows ? STRAY_DOG_FOLLOWING_NPC_ID : STRAY_DOG_NPC_ID;
    if (!existing || existing.getId() !== wanted) {
      removeTracked(player, "dog");
      spawnTracked(player, "dog", { id: wanted, ...tile, z: 0, wanderRadius: 0 });
    }
    const dog = tracked(player).get("dog");
    dog?.setFollowing(follows ? player : null);
    if (follows) dog?.setMobileInteraction(player);
  }

  function outlawsKilledMask(player) {
    return Number(player.getAttribute(OUTLAWS_KILLED_ATTRIBUTE)) || 0;
  }

  function syncOutlaws(player, stage) {
    if (stage !== STAGE_OUTLAWS) {
      removeTracked(player, "outlaw-23");
      removeTracked(player, "outlaw-22");
      return;
    }
    const mask = outlawsKilledMask(player);
    for (const [npcId, bit] of OUTLAW_BITS) {
      const key = npcId === OUTLAW_23_NPC_ID ? "outlaw-23" : "outlaw-22";
      if (mask & bit) {
        removeTracked(player, key);
        continue;
      }
      spawnTracked(player, key, { id: npcId, ...OUTLAW_TILES.get(npcId), z: 0, wanderRadius: 0 });
    }
  }

  function syncGoblins(player, stage) {
    const wanted =
      stage >= STAGE_FIRST_PUPPY &&
      stage < STAGE_SECOND_PUPPY &&
      player.getAttribute(GOBLINS_LEFT_ATTRIBUTE) !== true;
    if (!wanted) {
      removeTracked(player, "picklenose");
      removeTracked(player, "toetaller");
      return;
    }
    spawnTracked(player, "picklenose", { id: PICKLENOSE_NPC_ID, ...PICKLENOSE_TILE, z: 0, wanderRadius: 0 });
    spawnTracked(player, "toetaller", { id: TOETALLER_NPC_ID, ...TOETALLER_TILE, z: 0, wanderRadius: 0 });
  }

  function syncNpcs(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    spawnTracked(player, "talia", { id: TALIA_NPC_ID, ...TALIA_TILE, z: 0, wanderRadius: 0 });
    spawnTracked(player, "chase", { id: 16487, ...CHASE_TILE, z: 0, wanderRadius: 0 });

    const stage = quest.getStage(player);
    if (stage >= STAGE_STARTED && stage <= STAGE_GERTRUDE) {
      // The canonical Varrock Gertrude supplies this interaction.
    } else {
      removeTracked(player, "gertrude");
    }

    if (stage >= STAGE_GERTRUDE && stage < STAGE_COMPLETE) {
      spawnTracked(player, "guard", { id: QUEST_GUARD_NPC_ID, ...GUARD_TILE, z: 0, wanderRadius: 0 });
    } else {
      removeTracked(player, "guard");
    }

    syncDog(player, stage);
    syncGoblins(player, stage);
    syncOutlaws(player, stage);
    syncPuppies(player, stage);
  }

  // ==========================================================================
  // Talk-to handlers
  // ==========================================================================

  function talkTalia(event) {
    const { player, npcId } = event;
    if (npcId !== TALIA_NPC_ID) return false;
    if (quest.isComplete(player)) {
      startTranscript(api, player, npcId, PAGE, "post-quest-dialogue");
      return;
    }
    const stage = quest.getStage(player);
    if (stage === 0) {
      startTranscript(
        api,
        player,
        npcId,
        PAGE,
        player.getAttribute(TALIA_OFFERED_ATTRIBUTE) === true
          ? "starting-off-talking-to-talia-again"
          : "starting-off-talking-to-talia"
      );
      return;
    }
    if (stage === STAGE_ACCEPTED || stage === STAGE_STARTED) {
      startTranscript(api, player, npcId, PAGE, "starting-off-talking-to-talia-after-starting-the-quest");
      return;
    }
    if (stage === STAGE_GERTRUDE) {
      startTranscript(api, player, npcId, PAGE, "gertrude-talking-to-talia-again");
      return;
    }
    if (stage === STAGE_SECOND_PUPPY) {
      startTranscript(
        api,
        player,
        npcId,
        PAGE,
        "back-to-the-goblins-with-the-stuffed-dog-talking-to-talia-again-with-two-puppies"
      );
      return;
    }
    if (stage >= STAGE_THIRD_PUPPY) {
      beginScene(player, "shelter");
      return;
    }
    startTranscript(api, player, npcId, PAGE, "cutscene-talking-to-talia-again");
  }

  function talkChase(event) {
    const { player, npcId } = event;
    if (![CHASE_NPC_ID, 16487, 16489].includes(npcId)) return false;
    if (quest.isComplete(player)) return puppies.talkChase(event);
    startTranscript(
      api,
      player,
      npcId,
      PAGE,
      quest.getStage(player) === 0
        ? "starting-off-talking-to-chase"
        : "starting-off-talking-to-chase-after-starting-the-quest"
    );
  }

  function talkGertrude(event) {
    const { player, npcId } = event;
    if (!GERTRUDE_NPC_IDS.has(npcId)) return false;
    const tailStage = questStage(player, "a_tail_of_two_cats");
    if (tailStage === 3 || tailStage === 4) return false;
    const gertrudesCatStage = questStage(player, GERTRUDES_CAT_KEY);
    if (gertrudesCatStage > 0 && gertrudesCatStage < 6) return false;
    const stage = quest.getStage(player);
    if (stage !== STAGE_STARTED && stage !== STAGE_GERTRUDE) return false;
    startTranscript(
      api,
      player,
      npcId,
      PAGE,
      stage === STAGE_STARTED ? "gertrude" : "gertrude-talking-to-gertrude-again"
    );
  }

  function talkQuestGuard(event) {
    const { player, npcId } = event;
    if (npcId !== QUEST_GUARD_NPC_ID || quest.isComplete(player)) return false;
    const stage = quest.getStage(player);
    if (stage === STAGE_GERTRUDE) {
      startTranscript(api, player, npcId, PAGE, "stray-dog-talking-to-the-guard-or-interacting-with-the-stray-dog");
      return;
    }
    if (stage === STAGE_DOG || stage === STAGE_DEN) {
      startTranscript(api, player, npcId, PAGE, "at-the-dog-s-house-talking-to-the-guard");
      return;
    }
    if (stage >= STAGE_FIRST_PUPPY && stage <= STAGE_SECOND_PUPPY) {
      startTranscript(
        api,
        player,
        npcId,
        PAGE,
        dogWaiting(player)
          ? "back-to-the-goblins-with-the-stuffed-dog-talking-to-the-guard-while-the-stray-dog-is-with-the-goblins"
          : "cutscene-talking-to-the-guard-again"
      );
      return;
    }
    return false;
  }

  function talkGoblins(event) {
    const { player, npcId } = event;
    if (npcId !== PICKLENOSE_NPC_ID && npcId !== TOETALLER_NPC_ID) return false;
    const stage = quest.getStage(player);
    if (stage === STAGE_FIRST_PUPPY) {
      startTranscript(api, player, npcId, PAGE, "goblins");
      return;
    }
    if (stage >= STAGE_STUFFED_DOG && stage <= STAGE_TRADE) {
      if (!hasItem(player, STUFFED_DOG_ITEM_ID)) {
        startTranscript(
          api,
          player,
          npcId,
          PAGE,
          "goblins-talking-to-the-goblins-again-or-trying-to-pick-up-the-stray-puppy-without-the-stuffed-dog"
        );
        return;
      }
      startTranscript(
        api,
        player,
        npcId,
        PAGE,
        dogWaiting(player)
          ? "back-to-the-goblins-with-the-stuffed-dog-talking-to-the-goblins-without-the-stray-dog"
          : "back-to-the-goblins-with-the-stuffed-dog-talking-to-the-goblins-with-the-stray-dog"
      );
      return;
    }
    return false;
  }

  function interactStrayDog(event) {
    const { player, npcId } = event;
    if (!STRAY_DOG_NPC_IDS.has(npcId) || quest.isComplete(player)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_GERTRUDE) return false;

    if (dogWaiting(player) && stage >= STAGE_DOG) {
      player.setAttribute(DOG_WAITING_ATTRIBUTE, false);
      syncDog(player, stage);
      startTranscript(api, player, npcId, PAGE, "cutscene-returning-to-the-dog-after-leaving-her");
      return;
    }
    if (stage === STAGE_GERTRUDE) {
      startTranscript(api, player, npcId, PAGE, "stray-dog-talking-to-the-guard-or-interacting-with-the-stray-dog");
      return;
    }
    if (stage === STAGE_DOG) {
      startTranscript(api, player, npcId, PAGE, "at-the-dog-s-house-interacting-with-the-dog");
      return;
    }
    // Closing the post-inspection conversation leaves the saved stage here; the
    // dog interaction is the only way back to its final line, which starts the
    // Cooks' Guild route.
    if (stage === STAGE_INSPECTED) {
      startTranscript(api, player, npcId, PAGE, "at-the-dog-s-house-after-inspecting-all-three-objects");
      return;
    }
    if (stage === STAGE_DEN) {
      beginRoute(player, "cook");
      return;
    }
    if (stage === STAGE_FIRST_SCENE || stage === STAGE_RESCUE) {
      beginScene(player, stage === STAGE_FIRST_SCENE ? "first" : "rescue"); return;
    }
    if (stage === STAGE_FIRST_SAFE || stage === STAGE_FIRST_PUPPY) {
      startTranscript(api, player, npcId, PAGE, "cutscene-after-the-cutscene");
      return;
    }
    if (stage >= STAGE_STUFFED_DOG && stage <= STAGE_TRADE) {
      if (thirdHunt(player)) {
        startTranscript(api, player, npcId, PAGE, "looking-for-the-third-puppy-cutscene");
        return;
      }
      startTranscript(api, player, npcId, PAGE, "cutscene-interacting-with-the-stray-dog");
      return;
    }
    if (stage === STAGE_SECOND_PUPPY) {
      if (thirdHunt(player)) {
        startTranscript(api, player, npcId, PAGE, "looking-for-the-third-puppy-cutscene");
        return;
      }
      startTranscript(api, player, npcId, PAGE, "looking-for-the-third-puppy");
      return;
    }
    if (stage === STAGE_OUTLAWS) {
      startTranscript(api, player, npcId, PAGE, "looking-for-the-third-puppy-periodically-while-fighting");
      return;
    }
    if (stage === STAGE_THIRD_PUPPY) {
      startTranscript(api, player, npcId, PAGE, "looking-for-the-third-puppy-talking-to-the-stray-dog-with-the-puppies");
      return;
    }
    return false;
  }

  function dismissStrayDog(event) {
    const { player, npcId } = event;
    if (!STRAY_DOG_NPC_IDS.has(npcId) || quest.isComplete(player)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_DOG) return false;
    player.setAttribute(DOG_WAITING_ATTRIBUTE, true);
    syncDog(player, stage);
    startTranscript(api, player, npcId, PAGE, "cutscene-dismissing-the-stray-dog");
  }

  // ==========================================================================
  // Den objects
  // ==========================================================================

  function inspectDenObject(event, bit) {
    const { player } = event;
    if (quest.getStage(player) !== STAGE_DOG || actionKeys.has(player)) return false;
    event.handled = true;
    const descriptions = {
      [BIT_NEWSPAPER]: ["You inspect the scraps on the floor...", "They've been ripped up by something with small teeth.", 4, 15891],
      [BIT_CHEWED_BOX]: ["You inspect the crate...", "You notice some chew marks on the corner.", 2, 15893],
      [BIT_BEDDING]: ["You inspect the bed...", "You notice a large indentation and three smaller ones.", 2, 15890],
    };
    const [first, second, ticks, flag] = descriptions[bit], key = {};
    actionKeys.set(player, key); StatementDialogue.send(player, first, false);
    later(key, ticks, () => {
      actionKeys.delete(player);
      const mask = inspectedMask(player) | bit; player.setAttribute(INSPECTED_ATTRIBUTE, mask);
      player.getPacketSender().sendVarbit(flag, 1);
      const chain = new DialogueChainBuilder().add(new StatementDialogue(0, second));
      chain.add(new ActionDialogue(1, { execute: () => {
        if (mask === ALL_INSPECTED) {
          setStage(player, STAGE_INSPECTED);
          startTranscript(api, player, STRAY_DOG_NPC_ID, PAGE, "at-the-dog-s-house-after-inspecting-all-three-objects");
        } else player.getPacketSender().sendInterfaceRemoval();
      } })); player.getDialogueManager().startDialogues(chain);
    });
  }

  function inspectNewspaper(event) {
    return inspectDenObject(event, BIT_NEWSPAPER);
  }

  function inspectChewedBox(event) {
    return inspectDenObject(event, BIT_CHEWED_BOX);
  }

  function inspectRoughBedding(event) {
    return inspectDenObject(event, BIT_BEDDING);
  }

  // ==========================================================================
  // Transcript conditions
  // ==========================================================================

  function answerCondition(event) {
    if (!isQuestPage(event.pages)) return null;
    const { player, stepId } = event;
    switch (stepId) {
      case REQUIREMENTS_NOT_MET_CONDITION_ID:
        return craftingLevel(player) < CRAFTING_REQUIREMENT;
      case REQUIREMENTS_MET_CONDITION_ID:
        return craftingLevel(player) >= CRAFTING_REQUIREMENT;
      case CAT_NOT_DONE_CONDITION_ID:
      case GERTRUDE_CAT_NOT_DONE_CONDITION_ID:
        return !questComplete(player, GERTRUDES_CAT_KEY);
      case CAT_DONE_CONDITION_ID:
      case GERTRUDE_CAT_DONE_CONDITION_ID:
        return questComplete(player, GERTRUDES_CAT_KEY);
      case NO_SPACE_CUTSCENE_CONDITION_ID:
      case NO_SPACE_GOBLINS_CONDITION_ID:
      case NO_SPACE_OUTLAWS_CONDITION_ID:
      case NO_SPACE_SPANIEL_CONDITION_ID:
        return freeSlots(player) === 0;
      case HAS_SPACE_SPANIEL_CONDITION_ID:
        return freeSlots(player) > 0;
      case NO_FOLLOWER_CONDITION_ID:
        return !hasFollower(player);
      case HAS_FOLLOWER_CONDITION_ID:
        return hasFollower(player);
      case DOG_FOLLOWING_CONDITION_ID:
        return isDogFollowing(player);
      case DOG_NOT_FOLLOWING_CONDITION_ID:
        return !isDogFollowing(player);
      case GOT_GRAIN_CONDITION_ID:
        return hasItem(player, GRAIN_ITEM_ID);
      case NO_GRAIN_CONDITION_ID:
        return !hasItem(player, GRAIN_ITEM_ID);
      case GOT_FUR_CONDITION_ID:
        return hasAnyFur(player);
      case NO_FUR_CONDITION_ID:
        return !hasAnyFur(player);
      case GOT_NEEDLE_CONDITION_ID:
        return hasNeedle(player);
      case NO_NEEDLE_CONDITION_ID:
        return !hasNeedle(player);
      case GOT_THREAD_CONDITION_ID:
        return hasThreadOrCostumeNeedle(player);
      case NO_THREAD_CONDITION_ID:
        return !hasThreadOrCostumeNeedle(player);
      case MISSING_ITEMS_CONDITION_ID:
        return !hasCraftItems(player);
      case HAS_ITEMS_CONDITION_ID:
        return hasCraftItems(player);
      case MISSING_PUPPIES_CONDITION_ID:
        return !PUPPIES.every(id => hasItem(player, id));
      case HAS_PUPPIES_CONDITION_ID:
        return PUPPIES.every(id => hasItem(player, id));
      default:
        return null;
    }
  }

  // ==========================================================================
  // Dialogue events
  // ==========================================================================

  function handleStartHook(event) {
    const { player, npcId, hook } = event;
    if (hook !== START_HOOK || npcId !== TALIA_NPC_ID) return;
    if (quest.getStage(player) !== 0) return;
    if (craftingLevel(player) < CRAFTING_REQUIREMENT) return;
    setStage(player, STAGE_ACCEPTED);
    player.setAttribute(VERSION_ATTRIBUTE, 1);
    player.getPacketSender().sendVarbit(15899, 1);
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (npcId !== TALIA_NPC_ID || option !== "No.") return;
    if (quest.getStage(player) !== 0) return;
    player.setAttribute(TALIA_OFFERED_ATTRIBUTE, true);
  }

  function handleAction(event) {
    if (!isQuestPage(event.pages)) return;
    const { player, stepId } = event, scene = scenes.get(player);
    if (event.kind === "message") event.box = { statement: true };
    switch (stepId) {
      case PUPPY_APPEARS_STEP:
        event.handled = true; scene?.actors.get("puppy")?.forceChat("Yelp!");
        return pauseScene(event, 6);
      case PUPPY_APPROACHES_STEP:
        event.handled = true;
        scene?.actors.get("puppy")?.getMovementQueue().addSteps(new Location(3147, 3456, 0));
        scene?.actors.get("goblin")?.getMovementQueue().addSteps(new Location(3144, 3456, 0));
        later(scene, 3, () => scene?.actors.get("goblin")?.forceChat("Get back 'ere!"));
        return pauseScene(event, 13);
      case GOBLIN_RUNS_STEP:
        event.handled = true; scene?.actors.get("goblin")?.getMovementQueue().addSteps(new Location(3135, 3440, 0));
        return pauseScene(event, 2);
      case FIRST_PUPPY_PICKUP_STEP:
        event.handled = true;
        return pickupAfterPause(event, 0, () => {
          setStage(player, STAGE_FIRST_PICKUP); setStage(player, STAGE_FIRST_SAFE);
          leaveScene(player, 4, () => startTranscript(api, player, STRAY_DOG_NPC_ID, PAGE, "cutscene-after-the-cutscene"));
        });
      case GIVE_STUFFED_DOG_STEP:
        if (!hasItem(player, STUFFED_DOG_ITEM_ID)) { event.handled = true; event.end = true; return; }
        player.getInventory().deleteNumber(STUFFED_DOG_ITEM_ID, 1);
        setStage(player, STAGE_TRADE);
        event.box = { items: [STUFFED_DOG_ITEM_ID] }; return;
      case GOBLINS_LEAVE_STEP:
        event.handled = true;
        controls(player, true); fade(player, true);
        {
          const key = {}; actionKeys.set(player, key); freeze(player);
          later(key, 4, () => {
            player.setAttribute(GOBLINS_LEFT_ATTRIBUTE, true); setStage(player, STAGE_GOBLINS_GONE); fade(player, false);
          });
          later(key, 6, () => {
            actionKeys.delete(player); controls(player, false); player.getPacketSender().closeSubInterface(FADE_UID);
            startTranscript(api, player, event.npcId, PAGE,
              "back-to-the-goblins-with-the-stuffed-dog-talking-to-the-goblins-with-the-stray-dog",
              steps => steps.slice(steps.findIndex(s => s.id === stepId) + 1));
          });
        } return;
      case SECOND_PUPPY_PICKUP_STEP:
        event.handled = true;
        return pickupAfterPause(event, 1, () => { setStage(player, STAGE_SECOND_PUPPY); player.getPacketSender().sendInterfaceRemoval(); });
      case OUTLAWS_APPROACH_STEP:
      case OUTLAWS_CONTINUE_STEP:
        event.handled = true;
        camera(player, stepId === OUTLAWS_APPROACH_STEP ? [3129, 3476, 450] : [3131, 3476, 500], null,
          { cycles: stepId === OUTLAWS_APPROACH_STEP ? 60 : 90, easing: "ease_out_cubic", ignoreTerrain: true });
        return pauseScene(event, 1);
      case RUN_IN_STEP:
        event.handled = true;
        later(scene, 1, () => {
          camera(player, [3130, 3481, 700], null, { cycles: 90, easing: "ease_out_cubic", ignoreTerrain: true });
          camera(player, null, [3136, 3469, 300], { cycles: 150, easing: "ease_out_cubic", trackTarget: false });
          player.getMovementQueue().setBlockMovement(false).addSteps(new Location(3136, 3469, 0));
          scene.actors.get("dog")?.getMovementQueue().addSteps(new Location(3136, 3470, 0));
        }); return pauseScene(event, 8);
      case THIRD_PUPPY_PICKUP_STEP:
        event.handled = true;
        return pickupAfterPause(event, 2, () => {
          setStage(player, STAGE_THIRD_PICKUP); setStage(player, STAGE_THIRD_PUPPY);
          leaveScene(player, 4, () => startTranscript(api, player, STRAY_DOG_NPC_ID, PAGE,
            "looking-for-the-third-puppy-after-killing-the-outlaws", steps => steps.slice(steps.findIndex(s => s.id === stepId) + 1)));
        });
      case PLACE_PUPPIES_STEP:
        event.handled = true;
        if (!PUPPIES.every(id => hasItem(player, id))) return;
        for (let i = 0; i < 3; i++) {
          player.getInventory().deleteNumber(PUPPIES[i], 1);
          const pup = spawnSceneActor(scene, `puppy-${i}`, 16531 + i, 3039 - i, 3460); pup?.forceChat(["Yip!", "Yop!", "Yap yap!"][i]);
        }
        camera(player, [3044, 3455, 480], [3038, 3459, 330]); return pauseScene(event, 7);
      case DOG_LEAVES_STEP:
        event.handled = true; scene?.actors.get("dog")?.getMovementQueue().addSteps(new Location(3038, 3457, 0));
        return pauseScene(event, 4);
      case GUARD_WALKS_IN_STEP:
        event.handled = true; spawnSceneActor(scene, "guard", QUEST_GUARD_NPC_ID, 3037, 3455)?.getMovementQueue().addSteps(new Location(3039, 3458, 0));
        return pauseScene(event, 4);
      case QUEST_COMPLETE_STEP:
        return; // The transcript's end marker precedes this; finish on Chase's final line.
      default:
        if (event.text === "The stray dog barks in the direction the goblin ran off in.") setStage(player, STAGE_FIRST_PUPPY);
        // This line also appears in the "which way did the goblins go?" reminder.
        // Only the second-puppy conversation may advance the hunt; otherwise the
        // reminder would skip the goblin trade.
        if (event.text === "The stray dog sniffs the air..." && quest.getStage(player) === STAGE_SECOND_PUPPY) {
          event.handled = true; StatementDialogue.send(player, event.text, false);
          const key = {}; actionKeys.set(player, key);
          later(key, 3, () => { actionKeys.delete(player); setStage(player, STAGE_THIRD_SEARCH); beginRoute(player, "third"); player.getPacketSender().sendInterfaceRemoval(); });
        }
    }
  }

  // ==========================================================================
  // Outlaw fight
  // ==========================================================================

  function handleNpcDeath(event) {
    const { npc } = event, player = npc?.getOwner?.();
    if (!player || !OUTLAW_BITS.has(event.npcId) || quest.getStage(player) !== STAGE_OUTLAWS) return;
    const key = event.npcId === OUTLAW_23_NPC_ID ? "outlaw-23" : "outlaw-22";
    if (tracked(player).get(key) !== npc) return;
    const mask = outlawsKilledMask(player) | OUTLAW_BITS.get(event.npcId);
    player.setAttribute(OUTLAWS_KILLED_ATTRIBUTE, mask); removeTracked(player, key);
    if (mask === ALL_OUTLAWS_KILLED) beginScene(player, "rescue");
  }

  // ==========================================================================
  // Stuffed dog crafting
  // ==========================================================================

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = new Set([usedItemId, usedWithItemId]);
    if (!pair.has(GRAIN_ITEM_ID) || ![...pair].some((itemId) => FUR_ITEM_IDS.has(itemId))) return;
    event.handled = true;
    if (quest.getStage(player) < STAGE_STUFFED_DOG || quest.getStage(player) > STAGE_TRADE) return;
    if (hasItem(player, STUFFED_DOG_ITEM_ID)) {
      startTranscript(api, player, STRAY_DOG_NPC_ID, PAGE, "stuffed-dog-trying-to-craft-another-stuffed-dog");
      return;
    }
    if (!hasCraftItems(player)) {
      startTranscript(
        api,
        player,
        STRAY_DOG_NPC_ID,
        PAGE,
        "stuffed-dog-trying-to-make-the-stuffed-dog-with-one-or-more-items-missing"
      );
      return;
    }
    const furId = [...pair].find((itemId) => FUR_ITEM_IDS.has(itemId));
    if (furId === FOX_FUR_ITEM_ID) {
      api.sendMultiChatboxPrompt(
        player,
        "Which item would you like to craft?",
        "Stuffed dog.",
        () => craftStuffedDog(player, furId),
        "Small meat pouch.",
        () => {}
      );
      return;
    }
    api.sendMultiChatboxPrompt(
      player,
      "Craft a stuffed dog?",
      "Yes.",
      () => craftStuffedDog(player, furId),
      "No.",
      () => {}
    );
  }

  function craftStuffedDog(player, furId) {
    const stage = quest.getStage(player);
    if (stage < STAGE_STUFFED_DOG || stage > STAGE_TRADE || hasItem(player, STUFFED_DOG_ITEM_ID)) return;
    if (!hasCraftItems(player)) {
      player.sendMessage(
        "You do not have the required items to make a stuffed dog. You need grain, some fur, a needle and some thread."
      );
      return;
    }
    player.getInventory().deleteNumber(GRAIN_ITEM_ID, 1);
    player.getInventory().deleteNumber(furId, 1);
    // The recorded single craft leaves the needle and thread in the inventory.
    player.getInventory().adds(STUFFED_DOG_ITEM_ID, 1);
    player.performAnimation(new Animation(8839));
    if (stage < STAGE_CRAFTED) setStage(player, STAGE_CRAFTED);
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0,
      STUFFED_DOG_ITEM_ID, "You create a stuffed dog. It will probably convince the goblins.")));
  }

  // ==========================================================================
  // Session lifecycle
  // ==========================================================================

  function handleLogin({ player, isNewAccount }) {
    migrateStage(player);
    syncFlags(player);
    syncNpcs(player);
    // Login bootstrap and desktop Welcome both replace the root, clearing early scene UI.
    // Match WelcomeScreen's bypasses; only resume once the final gameframe is mounted.
    pendingRecovery.set(player, { waitForWelcome: !(isNewAccount || player.isPlayerBot?.() === true
      || api.core.Wilderness.isInLocation(player.getLocation()) || player.getAttribute("mobile-client") === true) });
    refreshQuestList(player);
  }
  function scheduleRecovery(player, fromWelcome) {
    const pending = pendingRecovery.get(player);
    if (!pending || pending.waitForWelcome !== fromWelcome || pending.scheduled) return;
    pending.scheduled = true;
    queueMicrotask(() => {
      if (pendingRecovery.get(player) !== pending) return;
      pendingRecovery.delete(player);
      resumeRecovery(player);
    });
  }
  function handleBootstrap({ player }) { scheduleRecovery(player, false); }
  function handleWelcomeReady({ player }) { scheduleRecovery(player, true); return false; }
  function resumeRecovery(player) {
    const stage = quest.getStage(player);
    if (stage === STAGE_LEADING) beginRoute(player, "den");
    else if (stage === STAGE_DEN) beginRoute(player, "cook");
    else if (stage === STAGE_THIRD_SEARCH) beginRoute(player, "third");
    else if (stage === STAGE_FIRST_SCENE) beginScene(player, "first");
    else if (stage === STAGE_OUTLAW_SCENE) beginScene(player, "outlaws");
    else if (stage === STAGE_RESCUE) beginScene(player, "rescue");
    else if (stage === STAGE_SHELTER || stage === STAGE_FINAL_SCENE) beginScene(player, "shelter");
  }

  function handleLogout({ player }) {
    if (!player) return;
    pendingRecovery.delete(player);
    cleanupScene(player, false); routes.delete(player);
    const key = actionKeys.get(player); if (key) TaskManager.cancelTasks(key); actionKeys.delete(player);
    controls(player, false); player.getPacketSender().closeSubInterface(FADE_UID);
    removeAllTracked(player);
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Talia asked me to find stray dogs for the shelter and Gertrude pointed</str>",
        "<str>me to a stray dog in Varrock whose puppies had been stolen.</str>",
        "<str>I rescued all three puppies from the goblins and the outlaws and</str>",
        "<str>reunited them with their mother at the Dog Shelter.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_THIRD_PUPPY) {
      return [
        "I rescued the last of the stray dog's puppies from the outlaws.",
        "",
        "I should bring them to <col=800000>Talia</col> at the Dog Shelter.",
      ];
    }
    if (stage >= STAGE_OUTLAWS) {
      return [
        "The stray dog led me to the outlaw camp north of the Cooks' Guild,",
        "where outlaws have cornered her last puppy.",
        "",
        "I must defeat the <col=800000>outlaws</col>.",
      ];
    }
    if (stage >= STAGE_SECOND_PUPPY) {
      return [
        "<str>The goblins traded me the second puppy for a stuffed dog.</str>",
        "",
        "Follow the <col=800000>stray dog</col> to find her last puppy.",
      ];
    }
    if (stage >= STAGE_STUFFED_DOG) {
      return [
        "<str>The goblins west of the Cooks' Guild took a puppy and want a</str>",
        "<str>stuffed dog in exchange.</str>",
        "",
        "Make a <col=800000>stuffed dog</col> from grain, fur, a needle",
        "and thread, then show it to <col=800000>Picklenose</col>.",
      ];
    }
    if (stage >= STAGE_FIRST_PUPPY) {
      return [
        "<str>I rescued one of the stray dog's puppies from a goblin near the</str>",
        "<str>Cooks' Guild. The goblins have taken the others.</str>",
        "",
        "I should talk to <col=800000>Picklenose</col> west of the Cooks' Guild.",
      ];
    }
    if (stage >= STAGE_DEN) {
      return [
        "<str>I followed the stray dog to her den and found her puppies are</str>",
        "<str>missing. She has caught their scent.</str>",
        "",
        "Follow the <col=800000>stray dog</col> to find her puppies.",
      ];
    }
    if (stage >= STAGE_DOG) {
      return [
        "<str>The guard said I should follow the stray dog.</str>",
        "",
        "Follow the <col=800000>stray dog</col> from the Varrock west bank",
        "to her den, then inspect the mess she shows you.",
      ];
    }
    if (stage >= STAGE_GERTRUDE) {
      return [
        "Gertrude said there are stray dogs near the west entrance to Varrock.",
        "",
        "I should find one and see how I can help it.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Talia asked me to find stray dogs for the shelter.",
        "",
        "She suggested I speak to <col=800000>Gertrude</col>, whose house is",
        "near the western entrance to Varrock.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Talia</col> at the",
      "<col=800000>Dog Shelter</col>, south-west of the Edgeville Monastery.",
      "I need 15 Crafting.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 1000);
  }

  api.persistAttribute(VERSION_ATTRIBUTE, 0);
  api.persistAttribute(TALIA_OFFERED_ATTRIBUTE, false);
  api.persistAttribute(INSPECTED_ATTRIBUTE, 0);
  api.persistAttribute(DOG_WAITING_ATTRIBUTE, false);
  api.persistAttribute(THIRD_HUNT_ATTRIBUTE, false);
  api.persistAttribute(GOBLINS_LEFT_ATTRIBUTE, false);
  api.persistAttribute(OUTLAWS_KILLED_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "a_ruff_situation",
    name: "A Ruff Situation",
    varpId: VARP_DOGQUEST,
    varbitId: STAGE_VARBIT,
    startedValue: STAGE_ACCEPTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.CRAFTING.getIndex(), amount: 1000, label: "Crafting" }],
    otherRewards: ["Access to puppies, which can be grown into dogs"],
    buildJournal,
    onReward: grantReward,
  });

  const puppies = require("../ruff/Puppies.Quests")(api, quest);
  api.registerArea(new DogQuestArea());
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("quest:stage-changed", markVersion);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onNpcInteraction("Talia", { "Talk-to": talkTalia });
  api.onNpcInteraction("Chase", { "Talk-to": talkChase, Adopt: talkChase });
  api.onNpcInteraction("Gertrude", { "Talk-to": talkGertrude });
  api.onNpcInteraction("Guard", { "Talk-to": talkQuestGuard });
  api.onNpcInteraction("Picklenose", { "Talk-to": talkGoblins });
  api.onNpcInteraction("Toetaller", { "Talk-to": talkGoblins });
  api.onNpcInteraction("Stray dog", { Interact: interactStrayDog, Dismiss: dismissStrayDog });
  api.onObjectInteraction("Torn newspaper", { Inspect: inspectNewspaper });
  api.onObjectInteraction("Chewed box", { Inspect: inspectChewedBox });
  api.onObjectInteraction("Rough bedding", { Inspect: inspectRoughBedding });
  api.onItemOnItem(handleItemOnItem);
  api.onNpcInteraction("Stray puppy", { "Pick-up": pickupPuppy });
  api.onItemDropPolicy(puppyItemAction);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
  api.onInterfaceActionButton(WELCOME_PLAY_BUTTON_UID, handleWelcomeReady);
  api.onPlayerLogout(handleLogout);
  api.onPlayerDisconnect(handleLogout);
};
