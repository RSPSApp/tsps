/**
 * Black Knights' Fortress, from the OSRS Wiki and captures.
 * The fortress as it stands after the quest (guards, doors, walls, grill, main door) follows rsprox
 * 469; the completed journal follows rsprox 1581 and 2977. No available capture shows the quest
 * being done. The sabotage timings came from revision 240 capture 20260817T005704, which is not in
 * the rsprox database and cannot be re-checked.
 */
const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");

module.exports = function registerBlackKnightsFortressQuest(api) {
  const { Location, Equipment, Animation, Graphic, CountdownTask, TaskManager, TemplatedInstanceArea, StatementDialogue, Item, WorldDefinition, World, GameObject, ObjectManager, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;

  const { registerQuest, startTranscript, QUEST_POINTS_ATTRIBUTE } = require("../QuestRuntime");

  const BKF_PAGE = "Black Knights' Fortress";

  const SIR_AMIK_VARZE_NPC_ID = NpcIdentifiers.SIR_AMIK_VARZE_4;
  const FORTRESS_GUARD_NPC_IDS = new Set([
    NpcIdentifiers.FORTRESS_GUARD_2,
    NpcIdentifiers.FORTRESS_GUARD_3,
    NpcIdentifiers.FORTRESS_GUARD_4,
    NpcIdentifiers.FORTRESS_GUARD_5,
  ]);
  /** The guards whose heads speak at the sturdy door and the banquet door (rsprox 469). */
  const STURDY_DOOR_GUARD_NPC_ID = NpcIdentifiers.FORTRESS_GUARD_3;
  const BANQUET_DOOR_GUARD_NPC_ID = NpcIdentifiers.FORTRESS_GUARD_4;
  const FORTRESS_WITCH_NPC_ID = NpcIdentifiers.WITCH_5;

  const VARP_BLACK_KNIGHTS_FORTRESS = 130;
  const STAGE_INVESTIGATE = 1;
  const STAGE_SABOTAGE = 2;
  const STAGE_RETURN_TO_AMIK = 3;
  const STAGE_COMPLETE = 4;

  const DOSSIER_ITEM_ID = ItemIdentifiers.DOSSIER;
  const BRONZE_MED_HELM_ITEM_ID = ItemIdentifiers.BRONZE_MED_HELM;
  const IRON_CHAINBODY_ITEM_ID = ItemIdentifiers.IRON_CHAINBODY;
  const BLACK_FULL_HELM_ITEM_ID = ItemIdentifiers.BLACK_FULL_HELM;
  const BLACK_PLATEBODY_ITEM_ID = ItemIdentifiers.BLACK_PLATEBODY;
  const BLACK_LEG_ITEM_IDS = new Set([ItemIdentifiers.BLACK_PLATELEGS, ItemIdentifiers.BLACK_PLATESKIRT]);
  const CABBAGE_ITEM_ID = ItemIdentifiers.CABBAGE;
  const DRAYNOR_MANOR_CABBAGE_ITEM_ID = ItemIdentifiers.CABBAGE_3;
  const COINS_ITEM_ID = ItemIdentifiers.COINS;
  const REWARD_COINS = 2500;
  /** Other quests whose Sir Amik conversations must win over BKF's post-quest greeting. */
  const SHARED_AMIK_ACTIVE_QUESTS = ["dragon_slayer_ii", "recipe_for_disaster"];

  function reward(player) {
    // forceAdd drops stackable coins at the reward tile when a full bag has no coin
    // stack, so completing the quest can never destroy the recorded reward.
    player.getInventory().forceAdd(player, new Item(COINS_ITEM_ID, REWARD_COINS));
  }

  function questStarted(player, key) {
    const request = { player, key, started: false };
    api.emitCustomEvent("quest:is-started", request);
    return request.started === true;
  }

  function questComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  /** Recruitment Drive always claims Sir Amik until complete; the members quests claim him when active. */
  function sharedAmikQuestActive(player) {
    if (!WorldDefinition.isMembersWorld()) return false;
    if (!questComplete(player, "recruitment_drive")) return true;
    return SHARED_AMIK_ACTIVE_QUESTS.some((key) => questStarted(player, key) && !questComplete(player, key));
  }

  const FORTRESS_ENTRANCE_DOOR_LOC_ID = ObjectIdentifiers.STURDY_DOOR;
  const BANQUET_HALL_DOOR_LOC_ID = ObjectIdentifiers.DOOR_68;
  const GUARDED_STURDY_DOOR_LOC_ID = ObjectIdentifiers.STURDY_DOOR_2;
  const SECRET_WALL_LOC_ID = ObjectIdentifiers.WALL_8;
  const LISTENING_GRILL_LOC_ID = ObjectIdentifiers.GRILL;
  const MAIN_DOOR_LOC_IDS = new Set([ObjectIdentifiers.LARGE_DOOR_3, ObjectIdentifiers.LARGE_DOOR_4]);
  const MAIN_DOOR_X = 3007;
  const MAIN_DOOR_Y_MIN = 3515;
  const MAIN_DOOR_Y_MAX = 3516;
  const CABBAGE_HOLE_LOC_ID = ObjectIdentifiers.HOLE_2;
  const PASSAGE_LOC_IDS = new Set([
    FORTRESS_ENTRANCE_DOOR_LOC_ID, BANQUET_HALL_DOOR_LOC_ID,
    GUARDED_STURDY_DOOR_LOC_ID, SECRET_WALL_LOC_ID,
  ]);

  /** A door's or wall's rotation -> the tile across its edge from its own tile (rsprox 469). */
  const PASSAGE_ACROSS = [[-1, 0], [0, 1], [1, 0], [0, -1]];
  const WALL_SHAPE = 0;
  /** While open, the passage's tile holds this and the open leaf stands across it, for two ticks. */
  const OPEN_PASSAGE_LOC_ID = 38848;
  const OPEN_DOOR_LOC_ID = 2340;
  const OPEN_WALL_LOC_ID = 17142;
  const PASSAGE_SHUT_TICKS = 2;
  const DOOR_SOUND = 46;
  const WALL_SOUND = 2410;

  const BANQUET_KNIGHT_NAME = "Black Knight";
  const BANQUET_KNIGHT_RANGE = 8;

  const LISTEN_ANIMATION = 4195;
  const LISTENING_ANIMATION = 4552;
  const STOP_LISTENING_ANIMATION = 4197;

  const START_HOOK = "quest:black-knights-fortress:start";
  const DOSSIER_ACTION_IDS = new Set(["RQQGDa", "kI0dT0"]);
  const QUEST_COMPLETE_ACTION_ID = "uMmzNj";

  const V_START = "starting-out-starting-the-quest";
  const V_AMIK_AGAIN = "starting-out-speaking-to-sir-amik-varze-again";
  const V_REPORT = "reporting-back-to-sir-amik-varze";
  const V_RETURN = "returning-to-sir-amik-varze";
  const V_GUARD_DISGUISED = "infiltrating-the-fortress-talking-to-the-guards-while-wearing-a-disguise";
  const V_GUARD_NOT_DISGUISED = "infiltrating-the-fortress-talking-to-the-guards-while-not-wearing-a-disguise";
  const V_GUARD_BLACK_KNIGHT = "infiltrating-the-fortress-talking-to-the-guards-while-disguised-as-a-black-knight";
  const V_DOOR_MAIN = "infiltrating-the-fortress-trying-to-open-the-sturdy-door-while-not-wearing-a-disguise";
  /** The cat's head has its own rig: the human chat animations leave it broken (rsprox 469). */
  const BLACK_CAT_CHATHEAD_ANIMATION = 567;
  const V_DOOR_MEETING = "sabotaging-the-potion-interrupting-the-black-knights-meeting";
  const V_GRILL = "listen-at-grill";
  const V_GRILL_RUINED = "sabotaging-the-potion-listen-at-grill-after-ruining-the-potion";
  const V_CABBAGE_BEFORE = "sabotaging-the-potion-using-any-item-on-the-hole-or-a-cabbage-before-overhearing-the-witch";
  const V_CABBAGE_NORMAL = "sabotaging-the-potion-using-a-normal-cabbage-on-the-hole";
  const V_CABBAGE_DRAYNOR = "sabotaging-the-potion-using-a-draynor-cabbage-on-the-hole";

  let quest;
  let pluginApi;

  /** Which side of the banquet door the player is standing on, for the warning. */
  const pendingCross = new WeakMap();
  const BANQUET_GOING_IN_LINE = "I don't care. I'm going in anyway.";
  const reading = new WeakSet();
  const scenes = new WeakMap();
  const SCENE_ATTRIBUTE = "black-knights-fortress:cutscene";
  const FADE_UID = (161 << 16) | 1;

  const hasItem = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  const isGuardDisguised = (player) =>
    player.getEquipment().get(Equipment.HEAD_SLOT)?.getId?.() === BRONZE_MED_HELM_ITEM_ID &&
    player.getEquipment().get(Equipment.BODY_SLOT)?.getId?.() === IRON_CHAINBODY_ITEM_ID;

  /** The Wiki's alternative disguise: black full helm, platebody and platelegs or plateskirt. */
  const isBlackKnightDisguised = (player) =>
    player.getEquipment().get(Equipment.HEAD_SLOT)?.getId?.() === BLACK_FULL_HELM_ITEM_ID &&
    player.getEquipment().get(Equipment.BODY_SLOT)?.getId?.() === BLACK_PLATEBODY_ITEM_ID &&
    BLACK_LEG_ITEM_IDS.has(player.getEquipment().get(Equipment.LEG_SLOT)?.getId?.());

  const isDisguised = (player) => isGuardDisguised(player) || isBlackKnightDisguised(player);

  function guardVariant(player) {
    if (isBlackKnightDisguised(player)) return V_GUARD_BLACK_KNIGHT;
    return isGuardDisguised(player) ? V_GUARD_DISGUISED : V_GUARD_NOT_DISGUISED;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      // Verbatim, including the stray strike tags (rsprox 1581, 2977).
      return [
        "<str>Sir Amik Varze asked me to investigate the Black Knights'",
        "<str><str>Fortress. I sneaked inside disguised as a Guard.",
        "<str>I eavesdropped on a Witch and the Black Knight Captain and",
        "<str>discovered that their <str>invincibility potion could be destroyed",
        "<str>with a normal cabbage.",
        "<str>I found a cabbage, and used it to destroy the potion, <str>then",
        "<str>claimed my reward for a job well done.",
        "",
        "<col=ff0000>QUEST COMPLETE!",
        "<col=800000>Reward:",
        "3 Quest Points",
        "2500gp",
      ];
    }
    if (stage >= STAGE_RETURN_TO_AMIK) {
      return [
        "<str>I infiltrated the Black Knights' Fortress.</str>",
        "<str>I ruined the witch's invincibility potion with a cabbage.</str>",
        "",
        "I should claim my reward from <col=800000>Sir Amik Varze</col>",
        "in <col=800000>Falador Castle</col>.",
      ];
    }
    if (stage >= STAGE_SABOTAGE) {
      return [
        "<str>I infiltrated the Black Knights' Fortress.</str>",
        "<str>I learned that their secret weapon is an invincibility potion.</str>",
        "",
        "An ordinary <col=800000>cabbage</col> will ruin the potion.",
        "A cabbage from Draynor Manor would help the witch instead.",
      ];
    }
    if (stage >= STAGE_INVESTIGATE) {
      return [
        "Sir Amik asked me to infiltrate the <col=800000>Black Knights' Fortress</col>",
        "near Ice Mountain and sabotage their secret weapon.",
        "",
        "An <col=800000>iron chainbody</col> and <col=800000>bronze med helm</col>",
        "will let me pass as a fortress guard.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Sir Amik Varze</col>",
      "in the <col=800000>White Knights' Castle</col>.",
      "",
      "I need at least <col=800000>12 Quest Points</col>.",
    ];
  }

  function playVariant(api, player, npcId, page, variant, select) {
    return startTranscript(api, player, npcId, page, variant, select);
  }

  /** A passage is crossed between its own tile and the one across its edge. */
  function passageTiles(object) {
    const tile = object.getLocation();
    const [dx, dy] = PASSAGE_ACROSS[object.getFace() & 3];
    return { x: tile.getX(), y: tile.getY(), z: tile.getZ(), acrossX: tile.getX() + dx, acrossY: tile.getY() + dy };
  }

  function placePassageLoc(id, x, y, z, face) {
    const loc = new GameObject(id, new Location(x, y, z), WALL_SHAPE, face, null);
    ObjectManager.register(loc, true);
    return loc;
  }

  /** Opens the passage for two ticks, as captured, and walks the player one tile through it. */
  function crossDoor(player, object) {
    if (ObstacleRunner.isBusy(player)) return;
    const { x, y, z, acrossX, acrossY } = passageTiles(object);
    const pos = player.getLocation();
    const onAcross = pos.getX() === acrossX && pos.getY() === acrossY;
    const id = object.getId();
    const face = object.getFace();
    const isWall = id === SECRET_WALL_LOC_ID;
    placePassageLoc(OPEN_PASSAGE_LOC_ID, x, y, z, face);
    const leaf = placePassageLoc(isWall ? OPEN_WALL_LOC_ID : OPEN_DOOR_LOC_ID, acrossX, acrossY, z, (face + 1) & 3);
    player.getPacketSender().sendSound(isWall ? WALL_SOUND : DOOR_SOUND, 1, 0);
    TaskManager.submit(new CountdownTask(leaf, PASSAGE_SHUT_TICKS, () => {
      ObjectManager.deregister(leaf, true);
      placePassageLoc(id, x, y, z, face);
    }));
    ObstacleRunner.run({ player }, [{ walk: [onAcross ? [x, y] : [acrossX, acrossY]] }]);
  }

  // Route to whichever of the passage's two tiles is on the player's side. In line with the
  // passage either side may be the reachable one, so the ordinary object route picks.
  function routeFortressPassage(event) {
    if (!PASSAGE_LOC_IDS.has(event.objectId)) return;
    const { x, y, z, acrossX, acrossY } = passageTiles(event.object);
    const from = event.sourceLocation;
    const side = acrossX !== x ? Math.sign(from.x - x) * (acrossX - x) : Math.sign(from.y - y) * (acrossY - y);
    if (side === 0) return;
    event.destination = side > 0 ? { x: acrossX, y: acrossY, z } : { x, y, z };
  }

  /** Walking in on the meeting: the nearest knight in the room shouts and attacks (rsprox 469, tick 4697). */
  function alertBanquetKnight(player, door) {
    const doorTile = door.getLocation();
    let nearest = null;
    let nearestDistance = BANQUET_KNIGHT_RANGE + 1;
    for (const npc of World.getNpcs()) {
      if (npc?.getDefinition?.()?.getName?.() !== BANQUET_KNIGHT_NAME) continue;
      const at = npc.getLocation();
      if (at.getZ() !== doorTile.getZ() || at.getX() < doorTile.getX()) continue;
      const distance = Math.max(Math.abs(at.getX() - doorTile.getX()), Math.abs(at.getY() - doorTile.getY()));
      if (distance < nearestDistance) { nearest = npc; nearestDistance = distance; }
    }
    if (!nearest) return;
    nearest.forceChat("Die, intruder!");
    nearest.getCombat().attack(player);
  }

  // Sir Amik Varze's transcript variant by stage.
  function selectVariant({ npcId, player }) {
    if (npcId === SIR_AMIK_VARZE_NPC_ID) {
      const stage = quest.getStage(player);
      if (stage >= STAGE_COMPLETE) return null;
      if (stage >= STAGE_RETURN_TO_AMIK) return { page: BKF_PAGE, variant: V_RETURN };
      if (stage >= STAGE_SABOTAGE) return { page: BKF_PAGE, variant: V_REPORT };
      if (stage >= STAGE_INVESTIGATE) return { page: BKF_PAGE, variant: V_AMIK_AGAIN };
      return { page: BKF_PAGE, variant: V_START };
    }
    if (FORTRESS_GUARD_NPC_IDS.has(npcId)) {
      return { page: BKF_PAGE, variant: guardVariant(player) };
    }
    return null;
  }

  // Answer the transcript's prose conditions.
  function answerCondition({ npcId, player, text }) {
    if (npcId !== SIR_AMIK_VARZE_NPC_ID) return null;
    const value = String(text).toLowerCase();
    if (value.includes("lost their dossier")) return !hasItem(player, DOSSIER_ITEM_ID);
    if (value.includes("no inventory space")) return player.getInventory().isFull();
    return null;
  }

  // Guards: 4774-4776 have no index entry so the dynamic Talk-to hook never
  // runs for them; intercept all four and pick the disguise-aware variant.
  function handleGuardInteraction(event) {
    if (!FORTRESS_GUARD_NPC_IDS.has(event.npcId)) return;
    const action = String(event.definition?.getActions?.()[event.clickType - 1] ?? "").toLowerCase();
    if (action !== "talk-to") return;
    if (playVariant(pluginApi, event.player, event.npcId, BKF_PAGE, guardVariant(event.player))) event.handled = true;
  }

  // "Yes." on "Start the Black Knights' Fortress quest?" carries this slug.
  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== SIR_AMIK_VARZE_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) >= STAGE_INVESTIGATE) return;
    // The state changes with Sir Amik's dossier line, after the player's acceptance.
  }

  // The transcript's "dossier" actions hand the item over; the reward page's
  // "Quest complete!" action finishes the quest.
  function handleDialogueAction(event) {
    const { player, npcId, stepId } = event;
    if (stepId === "lUsX9u" && npcId === FORTRESS_WITCH_NPC_ID) return startSabotage(event);
    if (stepId === "Ug7RZ1" && npcId === FORTRESS_WITCH_NPC_ID) {
      const state = scenes.get(player);
      if (!state) { event.end = true; event.handled = true; return; }
      later(player, state, 2, () => {
        const from = state.area.sourceTile(3032, 3507), to = state.area.sourceTile(3031, 3507);
        player.getPacketSender().sendProjectile(from, to, 0, 100, 772, 500, 50, null, 0, 192, 128);
        const graphic = new Graphic(773); graphic.delay = 100;
        player.getPacketSender().sendGraphic(graphic, to);
      });
      later(player, state, 7, () => player.getPacketSender().sendVarbit(2494, 1));
      pauseSabotage(player, state, 7, stepId);
      event.handled = true;
      return;
    }
    if (stepId === "OIbGVl" || stepId === "jnrgsN") event.box = { statement: true };
    if (npcId !== SIR_AMIK_VARZE_NPC_ID) return;
    if (DOSSIER_ACTION_IDS.has(stepId)) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_INVESTIGATE || quest.isComplete(player)) return;
      if (!hasItem(player, DOSSIER_ITEM_ID) && !player.getInventory().isFull()) {
        player.getInventory().adds(DOSSIER_ITEM_ID, 1);
      }
      event.handled = true;
      return;
    }
    if (stepId === QUEST_COMPLETE_ACTION_ID) {
      if (!quest.isComplete(player) && quest.getStage(player) >= STAGE_RETURN_TO_AMIK) {
        quest.complete(player);
      }
      event.handled = true;
      event.end = true;
    }
  }

  function handleAmik(event) {
    const player = event.player;
    if (quest.getStage(player) === 0 && (Number(player.getAttribute(QUEST_POINTS_ATTRIBUTE)) || 0) < 12) {
      event.handled = true;
      StatementDialogue.send(player, "You need at least 12 Quest Points to start Black Knights' Fortress.");
      return true;
    }
    if (!quest.isComplete(player)) return false;
    const request = { player, key: "wanted", started: false };
    api.emitCustomEvent("quest:is-started", request);
    if (request.started) return false;
    // Sir Amik is shared: let Recruitment Drive and the active members quests keep
    // their own conversation instead of replacing it with this optional greeting.
    if (sharedAmikQuestActive(player)) return false;
    event.handled = true;
    playVariant(api, player, SIR_AMIK_VARZE_NPC_ID, BKF_PAGE, V_START, () => [
      { player: "Hello Sir Amik." }, { type: "line", speaker: "Sir Amik Varze", text: "Hello, friend!" },
      { player: "Do you have any other quests for me to do?" },
      { type: "line", speaker: "Sir Amik Varze", text: "Nothing I can think of at the moment..." },
    ]);
    return true;
  }

  function handleLine(event) {
    const { player, npcId, text } = event;
    if (event.step?.player === BANQUET_GOING_IN_LINE && pendingCross.has(player)) {
      event.after = () => crossBanquetDoor(player);
    }
    if (npcId === SIR_AMIK_VARZE_NPC_ID && String(text).startsWith("Good luck! Let me know how you get on.")) event.before = () => {
      if (quest.getStage(player) === 0 && (Number(player.getAttribute(QUEST_POINTS_ATTRIBUTE)) || 0) >= 12) {
        quest.setStage(player, STAGE_INVESTIGATE);
        player.sendMessage("You've started a new quest: <col=081190>Black Knights' Fortress</col>");
      }
      if (quest.getStage(player) === STAGE_INVESTIGATE && !hasItem(player, DOSSIER_ITEM_ID) && !player.getInventory().isFull()) player.getInventory().adds(DOSSIER_ITEM_ID, 1);
    };
    if (npcId !== FORTRESS_WITCH_NPC_ID) return;
    if (text === "Yeth, Mithreth.") {
      event.text = "Yeth, Mithtreth.";
      event.after = () => {
        if (quest.getStage(player) === STAGE_INVESTIGATE) quest.setStage(player, STAGE_SABOTAGE);
        player.performAnimation(new Animation(STOP_LISTENING_ANIMATION));
      };
    }
    if (text === "...not to merntion the trees!") event.text = "...not to mention the trees!";
    if (text === "Purrr....") event.after = () => player.performAnimation(new Animation(STOP_LISTENING_ANIMATION));
    const state = scenes.get(player);
    if (!state) return;
    if (text === "My potion!") event.after = () => state.witch?.performAnimation(new Animation(860));
    if (text === "Oh boy, this doesn't look good!") event.after = () => state.captain?.performAnimation(new Animation(2105));
    if (text === "Where has Greldo got to with that magic cabbage!") event.after = () => pauseSabotage(player, state, 6, text);
    if (String(text).startsWith("Meow!")) {
      event.text = "Meow!";
      event.speakerId = NpcIdentifiers.BLACK_CAT;
      event.expression = BLACK_CAT_CHATHEAD_ANIMATION;
      event.after = () => {
        player.getDialogueManager().reset();
        StatementDialogue.send(player, "", false);
        later(player, state, 4, () => fade(player, true));
        later(player, state, 6, () => { returnFromScene(player, state); fade(player, false); });
        later(player, state, 9, () => {
          quest.setStage(player, STAGE_RETURN_TO_AMIK);
          scenes.delete(player);
          player.setAttribute(SCENE_ATTRIBUTE, 0);
          controls(player, false);
          player.getPacketSender().sendCameraUnlock(false).sendCameraReset();
          playVariant(api, player, FORTRESS_WITCH_NPC_ID, BKF_PAGE, V_CABBAGE_NORMAL,
            steps => steps.slice(steps.findIndex(step => String(step.text).startsWith("Meow!")) + 1));
        });
      };
    }
  }

  function warnBeforeStart(event) {
    if (event.npcId === SIR_AMIK_VARZE_NPC_ID && String(event.prompt).includes("Start the Black Knights' Fortress") && event.player.getSkillManager().getCombatLevel() < 15) {
      event.warning = "Before starting this quest, be aware that your combat level is lower than the recommended level of 15.";
    }
  }

  function controls(player, active) {
    player.getMovementQueue().reset().setBlockMovement(active);
    player.setUntargetable(active);
    for (const id of [4606, 542, 12139, 18141]) player.getPacketSender().sendVarbit(id, active ? 1 : 0);
    player.getPacketSender().sendVarbit(6719, active ? 2 : 0).sendVarbit(12393, active ? 1 : 0);
  }

  function fade(player, out) {
    player.getPacketSender().sendSubInterface(FADE_UID, 174, 1, { postScripts: [{ scriptId: 948, args: out ? [0, 255, 0, 0, 50] : [0, 0, 0, 255, 50] }] });
  }

  function later(player, state, ticks, callback) {
    TaskManager.submit(new CountdownTask(player, ticks, () => {
      if (scenes.get(player) === state && player.isRegistered?.() !== false) callback();
    }));
  }

  class SabotageScene extends TemplatedInstanceArea {
    constructor(owner) {
      super(4, 4);
      this.owner = owner;
      for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) this.setChunk(0, x, y, { sourceChunkX: 376 + x, sourceChunkY: 436 + y, sourcePlane: 0, rotation: 0 });
    }
    getName() { return "Black Knights' secret weapon"; }
    sourceTile(x, y) { return this.tile(x - 3008, y - 3488, 0); }
    canAttack() { return false; }
    canTeleport() { return false; }
    postLeave(actor, logout) {
      super.postLeave(actor, logout);
      if (actor === this.owner && !scenes.get(actor)?.returning) cleanup(actor);
    }
  }

  function returnFromScene(player, state) {
    state.returning = true;
    if (player.getPrivateArea() === state.area) state.area.leave(player, false);
    player.moveTo(state.returnTile);
    state.area.destroy();
    player.getPacketSender().sendCameraReset();
  }

  function pauseSabotage(player, state, ticks, after) {
    player.getDialogueManager().reset();
    StatementDialogue.send(player, "", false);
    later(player, state, ticks, () => playVariant(api, player, FORTRESS_WITCH_NPC_ID, BKF_PAGE, V_CABBAGE_NORMAL,
      steps => steps.slice(steps.findIndex(step => step.id === after || step.text === after) + 1)));
  }

  function startSabotage(event) {
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) !== STAGE_SABOTAGE || !hasItem(player, CABBAGE_ITEM_ID) || scenes.has(player)) { event.end = true; return; }
    player.getInventory().deleteNumber(CABBAGE_ITEM_ID, 1);
    const state = { area: new SabotageScene(player), returnTile: player.getLocation().clone(), returning: false };
    scenes.set(player, state);
    player.setAttribute(SCENE_ATTRIBUTE, 1);
    controls(player, true);
    for (let axis = 0; axis < 5; axis++) player.getPacketSender().sendCameraShake(axis, 0);
    player.performAnimation(new Animation(4553));
    const thrown = new Graphic(771); thrown.height = 96;
    player.performGraphic(thrown);
    player.getPacketSender().sendProjectile(new Location(3031, 3506, 1), new Location(3031, 3507, 1), 0, 196, 772, 130, 0, null, 96, 55, 60);
    later(player, state, 6, () => fade(player, true));
    later(player, state, 8, () => {
      state.area.enter(player);
      player.moveTo(state.area.sourceTile(3017, 3497));
      player.getPacketSender().sendJingle(5, 0);
      for (const [key, id, x, y] of [["cat", NpcIdentifiers.BLACK_CAT, 3027, 3507], ["witch", FORTRESS_WITCH_NPC_ID, 3030, 3509], ["captain", NpcIdentifiers.BLACK_KNIGHT_CAPTAIN, 3028, 3509]]) {
        const tile = state.area.sourceTile(x, y);
        state[key] = api.spawnNpc({ id, x: tile.getX(), y: tile.getY(), z: 0, face: 6, wanderRadius: 0, owner: player, ownerOnly: true });
        if (state[key]) state.area.add(state[key]);
      }
    });
    later(player, state, 10, () => {
      const at = state.area.sourceTile(3035, 3499), look = state.area.sourceTile(3032, 3505);
      player.getPacketSender().sendCameraMoveTo(at.getX(), at.getY(), 1500, { rate: 100, rate2: 100, heightRelative: false }).sendCameraLookAt(look.getX(), look.getY(), 300, { rate: 100, rate2: 100, heightRelative: false });
    });
    for (const [tick, key, x, y] of [[19, "witch", 3030, 3508], [20, "witch", 3030, 3507], [22, "witch", 3030, 3508], [23, "witch", 3030, 3509], [28, "witch", 3030, 3508], [29, "witch", 3030, 3507], [30, "witch", 3030, 3506], [32, "witch", 3030, 3507], [33, "witch", 3030, 3508], [34, "witch", 3031, 3508], [38, "witch", 3030, 3508], [39, "witch", 3030, 3507], [45, "captain", 3029, 3510], [46, "captain", 3030, 3510], [53, "witch", 3030, 3506], [55, "witch", 3030, 3505], [56, "witch", 3029, 3505], [57, "witch", 3028, 3505], [58, "witch", 3027, 3505], [60, "captain", 3030, 3509], [61, "captain", 3030, 3508], [62, "captain", 3030, 3507], [63, "witch", 3028, 3505], [63, "captain", 3030, 3506], [64, "witch", 3029, 3505], [64, "captain", 3030, 3505], [66, "captain", 3031, 3505], [67, "witch", 3030, 3505], [68, "witch", 3030, 3504], [68, "captain", 3030, 3505], [69, "captain", 3031, 3505], [72, "captain", 3030, 3505], [73, "captain", 3029, 3505], [74, "captain", 3028, 3505], [75, "captain", 3027, 3505], [76, "captain", 3027, 3506], [77, "captain", 3027, 3507], [78, "witch", 3030, 3505], [79, "witch", 3030, 3506], [79, "captain", 3027, 3506], [80, "witch", 3030, 3507], [81, "witch", 3030, 3508], [82, "witch", 3031, 3508], [85, "captain", 3027, 3507]]) {
      later(player, state, tick, () => state[key]?.getMovementQueue().addFirstStep(state.area.sourceTile(x, y)));
    }
    later(player, state, 14, () => fade(player, false));
    pauseSabotage(player, state, 24, "lUsX9u");
  }

  function cleanup(player) {
    pendingCross.delete(player);
    reading.delete(player);
    const state = scenes.get(player);
    scenes.delete(player);
    if (state) { state.returning = true; returnFromScene(player, state); }
    player.setAttribute(SCENE_ATTRIBUTE, 0);
    controls(player, false);
    player.getPacketSender().sendCameraReset().closeSubInterface(FADE_UID);
  }

  function handleLogout({ player }) { cleanup(player); }
  function handleLogin({ player }) {
    if (!player.getAttribute(SCENE_ATTRIBUTE)) return;
    player.moveTo(new Location(3031, 3506, 1));
    cleanup(player);
  }

  function handleDossierRead(event) {
    if (event.itemId !== DOSSIER_ITEM_ID || !String(event.option ?? "").toLowerCase().includes("read")) return;
    const { player } = event;
    event.handled = true;
    if (!hasItem(player, DOSSIER_ITEM_ID) || reading.has(player)) return;
    reading.add(player);
    player.getDialogueManager().reset();
    player.getMovementQueue().reset().setBlockMovement(true);
    player.getPacketSender().sendVarbit(12393, 1);
    player.performAnimation(new Animation(4549));
    const show = n => StatementDialogue.send(player, `Infiltrate fortress...<br>sabotage secret weapon...<br>self destruct in ${n}...`, false);
    show(3);
    for (const [tick, count] of [[2, 3], [4, 2], [6, 1]]) TaskManager.submit(new CountdownTask(player, tick, () => {
      if (reading.has(player) && player.isRegistered?.() !== false) show(count);
    }));
    TaskManager.submit(new CountdownTask(player, 8, () => {
      if (!reading.has(player)) return;
      player.getInventory().deleteNumber(DOSSIER_ITEM_ID, 1);
      player.performAnimation(new Animation(4551));
      player.performGraphic(new Graphic(770));
    }));
    TaskManager.submit(new CountdownTask(player, 9, () => {
      if (!reading.has(player)) return;
      reading.delete(player);
      player.getPacketSender().sendInterfaceRemoval();
      player.getMovementQueue().setBlockMovement(false);
      player.getPacketSender().sendVarbit(12393, 0);
    }));
  }

  function handleFortressObjectInteraction(event) {
    const { objectId, player } = event;
    if (
      objectId !== FORTRESS_ENTRANCE_DOOR_LOC_ID &&
      objectId !== BANQUET_HALL_DOOR_LOC_ID &&
      objectId !== GUARDED_STURDY_DOOR_LOC_ID &&
      objectId !== SECRET_WALL_LOC_ID &&
      objectId !== LISTENING_GRILL_LOC_ID
    ) {
      return;
    }
    const action = String(event.definition?.getInteractions?.()[event.clickType - 1] ?? "").toLowerCase();
    const pos = player.getLocation();
    const loc = event.location;

    if (objectId === FORTRESS_ENTRANCE_DOOR_LOC_ID) {
      if (!action.includes("open")) return;
      if (pos.getY() > loc.y || isDisguised(player)) {
        crossDoor(player, event.object);
      } else {
        playVariant(pluginApi, player, STURDY_DOOR_GUARD_NPC_ID, BKF_PAGE, V_DOOR_MAIN);
      }
      event.handled = true;
      return;
    }

    if (objectId === BANQUET_HALL_DOOR_LOC_ID) {
      if (!action.includes("open")) return;
      if (pos.getX() >= loc.x) {
        crossDoor(player, event.object);
      } else {
        pendingCross.set(player, event.object);
        playVariant(pluginApi, player, BANQUET_DOOR_GUARD_NPC_ID, BKF_PAGE, V_DOOR_MEETING);
      }
      event.handled = true;
      return;
    }

    if (objectId === GUARDED_STURDY_DOOR_LOC_ID) {
      if (!action.includes("open")) return;
      crossDoor(player, event.object);
      event.handled = true;
      return;
    }

    if (objectId === SECRET_WALL_LOC_ID) {
      if (!action.includes("push")) return;
      player.sendMessage("You push against the wall. You find a secret passage.");
      crossDoor(player, event.object);
      event.handled = true;
      return;
    }

    // Listening grill: only while investigating the weapon.
    if (!action.includes("listen")) return;
    if (quest.getStage(player) < STAGE_INVESTIGATE) { event.handled = true; return; }
    const variant = quest.getStage(player) >= STAGE_RETURN_TO_AMIK ? V_GRILL_RUINED : V_GRILL;
    player.performAnimation(new Animation(LISTEN_ANIMATION));
    TaskManager.submit(new CountdownTask(player, 2, () => {
      if (player.isRegistered?.() === false) return;
      player.performAnimation(new Animation(LISTENING_ANIMATION));
      playVariant(pluginApi, player, FORTRESS_WITCH_NPC_ID, BKF_PAGE, variant);
    }));
    event.handled = true;
  }

  // The fortress's main doors never open, from either side (rsprox 469, ticks 3807 and 4350).
  function handleMainDoor(event) {
    if (!MAIN_DOOR_LOC_IDS.has(event.objectId)) return;
    const { x, y } = event.location;
    if (x !== MAIN_DOOR_X || y < MAIN_DOOR_Y_MIN || y > MAIN_DOOR_Y_MAX) return;
    event.player.sendMessage("You can't open this door.");
    event.handled = true;
  }

  // Backing out of the guard's warning forgets the door; going in anyway waits for that line.
  function handleBanquetChoice({ player, option }) {
    if (!String(option ?? "").toLowerCase().includes("going in anyway")) pendingCross.delete(player);
  }

  // "I don't care. I'm going in anyway." walks through the banquet door once continued past.
  function crossBanquetDoor(player) {
    const door = pendingCross.get(player);
    pendingCross.delete(player);
    if (!door || !player.getLocation().isWithinDistance(door.getLocation(), 2)) return;
    crossDoor(player, door);
    alertBanquetKnight(player, door);
  }

  function handleItemOnHole(event) {
    if (event.objectId !== CABBAGE_HOLE_LOC_ID) return;
    const { player, itemId } = event;
    const stage = quest.getStage(player);
    if (itemId === CABBAGE_ITEM_ID) {
      if (stage !== STAGE_SABOTAGE) {
        playVariant(pluginApi, player, FORTRESS_WITCH_NPC_ID, BKF_PAGE, V_CABBAGE_BEFORE);
      } else if (player.getInventory().getAmount(CABBAGE_ITEM_ID) > 0) {
        playVariant(pluginApi, player, FORTRESS_WITCH_NPC_ID, BKF_PAGE, V_CABBAGE_NORMAL);
      }
      event.handled = true;
      return;
    }
    if (itemId === DRAYNOR_MANOR_CABBAGE_ITEM_ID) {
      if (stage !== STAGE_SABOTAGE) {
        playVariant(pluginApi, player, FORTRESS_WITCH_NPC_ID, BKF_PAGE, V_CABBAGE_BEFORE);
      } else {
        playVariant(pluginApi, player, FORTRESS_WITCH_NPC_ID, BKF_PAGE, V_CABBAGE_DRAYNOR);
      }
      event.handled = true;
      return;
    }
    playVariant(api, player, FORTRESS_WITCH_NPC_ID, BKF_PAGE, V_CABBAGE_BEFORE);
    event.handled = true;
  }

  pluginApi = api;
  ObstacleRunner.init(api);
  quest = registerQuest(api, {
    key: "black_knights_fortress",
    name: "Black Knights' Fortress",
    varpId: VARP_BLACK_KNIGHTS_FORTRESS,
    startedValue: STAGE_INVESTIGATE,
    completionValue: STAGE_COMPLETE,
    questPoints: 3,
    completionJingleId: 152,
    scrollItemId: COINS_ITEM_ID,
    rewardItemLabel: "2,500 Coins",
    buildJournal,
    onReward: reward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcInteraction(handleGuardInteraction);
  api.onNpcInteraction("Sir Amik Varze", { "Talk-to": handleAmik });
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:menu", warnBeforeStart);
  api.onItemAction(handleDossierRead);
  api.onObjectRoute(routeFortressPassage);
  api.onBeforeObjectInteraction(handleMainDoor);
  api.onObjectInteraction(handleFortressObjectInteraction);
  api.onCustomEvent("npc-dialogue:choice", handleBanquetChoice);
  api.onItemOnObject(handleItemOnHole);
  api.onPlayerLogout(handleLogout);
  api.onPlayerLogin(handleLogin);
  api.persistAttribute(SCENE_ATTRIBUTE, 0);
};
