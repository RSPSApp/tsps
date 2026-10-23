/** Demon Slayer. Capture evidence and remaining presentation gaps: docs/demon-slayer.md. */
module.exports = function registerDemonSlayerQuest(api) {
  const { Item, Location, World, Area, PrivateArea, Boundary, Animation, Graphic, NpcDialogue, DialogueChainBuilder, ActionDialogue, ForceMovement, ForceMovementTask, Task, TaskManager, StatementDialogue, GameObject, ObjectManager, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, startDialogue } = require("../QuestRuntime");

  const ARIS_NPC_ID = NpcIdentifiers.ARIS;
  /** Aris' legacy cache id 5082 has no generated NpcIdentifiers member. */
  const ARIS_LEGACY_NPC_ID = 5082;
  const TRAIBORN_NPC_ID = NpcIdentifiers.WIZARD_TRAIBORN;
  const PRYSIN_NPC_IDS = new Set([
    NpcIdentifiers.SIR_PRYSIN,
    NpcIdentifiers.SIR_PRYSIN_2,
    NpcIdentifiers.SIR_PRYSIN_3,
  ]);
  const ROVIN_NPC_IDS = new Set([NpcIdentifiers.CAPTAIN_ROVIN, NpcIdentifiers.CAPTAIN_ROVIN_2]);
  const DELRITH_NPC_ID = NpcIdentifiers.DELRITH;
  const WEAKENED_DELRITH_NPC_ID = NpcIdentifiers.WEAKENED_DELRITH;

  const VARP_DEMON_SLAYER = 222;
  const VARBIT_DEMON_SLAYER = 2561;
  const VARBIT_INCANTATION_FIRST = 2562;
  const VARBIT_DRAIN_KEY = 2568;
  const VARBIT_SILVERLIGHT_CASE = 2567;
  const VARBIT_SUMMONING_SEEN = 2569;
  const DENATH_NPC_ID = NpcIdentifiers.DENATH_4;
  const WALLY_NPC_ID = NpcIdentifiers.WALLY;
  const NPC_DIALOGUE_CONTINUE_UID = (231 << 16) | 5;
  const SUMMONERS = [
    [NpcIdentifiers.DARK_WIZARD_7, 3226, 3371], [NpcIdentifiers.DARK_WIZARD_8, 3229, 3371],
    [NpcIdentifiers.DARK_WIZARD_9, 3226, 3368], [DENATH_NPC_ID, 3229, 3368],
  ];
  const ANIMATION = { wally: 4603, sword: 4604, chant: 4617, summoned: 4623, banished: 4624 };
  /** Temple of the Eye's stage attribute. Its tower stages (6-25) give Traiborn
   * dialogue of their own, so Demon Slayer must not shadow him there. */
  const TEMPLE_OF_THE_EYE_STAGE_ATTRIBUTE = "quest.temple_of_the_eye.stage";
  const TOTE_TOWER_STAGE = 60;
  const TOTE_COMPLETE_STAGE = 130;
  const STAGE_STARTED = 1;
  const STAGE_KEY_HUNT = 2;
  const STAGE_COLLECTING_BONES = 3;
  const STAGE_TRAIBORN_KEY = 28;
  const STAGE_SILVERLIGHT = 29;
  const STAGE_COMPLETE = 30;
  const BONES_REQUIRED = 25;

  const TRAIBORN_KEY_ITEM_ID = ItemIdentifiers.SILVERLIGHT_KEY;
  const ROVIN_KEY_ITEM_ID = ItemIdentifiers.SILVERLIGHT_KEY_2;
  const PRYSIN_KEY_ITEM_ID = ItemIdentifiers.SILVERLIGHT_KEY_3;
  const SILVERLIGHT_ITEM_ID = ItemIdentifiers.SILVERLIGHT;
  const BONES_ITEM_ID = ItemIdentifiers.BONES;
  const COINS_ITEM_ID = ItemIdentifiers.COINS;
  const BUCKET_OF_WATER_ITEM_ID = ItemIdentifiers.BUCKET_OF_WATER;
  const EMPTY_BUCKET_ITEM_ID = ItemIdentifiers.BUCKET;
  const SPINACH_ROLL_ITEM_ID = ItemIdentifiers.SPINACH_ROLL;

  /** Wiki: jugs, bowls and vials of water flush the key as well as a bucket. */
  const WATER_CONTAINERS = new Map([
    [BUCKET_OF_WATER_ITEM_ID, EMPTY_BUCKET_ITEM_ID],
    [ItemIdentifiers.JUG_OF_WATER, ItemIdentifiers.JUG],
    [ItemIdentifiers.BOWL_OF_WATER, ItemIdentifiers.BOWL],
    [ItemIdentifiers.VIAL_OF_WATER, ItemIdentifiers.VIAL],
  ]);

  /** Object id 2843 has no generated ObjectIdentifiers member; value kept from the original plugin. */
  const PALACE_KITCHEN_DRAIN_OBJECT_ID = 2843;
  const DRAIN_LOC_IDS = new Set([
    PALACE_KITCHEN_DRAIN_OBJECT_ID,
    ObjectIdentifiers.DRAIN_6,
    ObjectIdentifiers.DRAIN_7,
  ]);
  const SEWER_KEY_TILE = new Location(3227, 9898, 0);

  const DRAIN_ATTRIBUTE = "demon_slayer.drain";
  const INCANTATION_ATTRIBUTE = "demon-slayer:incantation";

  const QUEST_START_HOOK = "quest:demon-slayer:start";
  const PRYSIN_INTRO_OPTION_ID = "vc9k5u";
  const ROVIN_KEY_MESSAGE_ID = "E0eUno";
  const SPINACH_ROLL_MESSAGE_ID = "OZH22x";
  const BONES_SOME_MESSAGE_ID = "Sq4znF";
  const BONES_LAST_MESSAGE_ID = "yjBusJ";
  const TRAIBORN_KEY_MESSAGE_ID = "o1N_Vv";
  const SILVERLIGHT_MESSAGE_ID = "AFDEAH";
  const QUEST_COMPLETE_ACTION_ID = "WId-ED";
  const PRYSIN_SELL_SILVERLIGHT_ACTION_ID = "p5BVZ5";
  /** Condition step id on the pre-fight page that offers Silverlight back when lost. */
  const PRYSIN_LOST_SILVERLIGHT_CONDITION_ID = "VlRPCO";
  const BONES_CHOICE_TEXT = "i'll get the bones for you.";
  const TALK_ABOUT_QUEST_TEXT = "talk about demon slayer";

  /** Correct incantation, used to fill the transcript's [word N] placeholders. */
  const INCANTATION_WORDS = ["Carlem", "Aber", "Camerinthum", "Purchai", "Gabindo"];

  /** The stone circle south of Varrock where Delrith is summoned (owner-only fight). */
  const DELRITH_ZONE = { minX: 3220, maxX: 3235, minY: 3362, maxY: 3377, levels: [0] };
  const DELRITH_WANDER_RADIUS = 2;
  const WEAKENED_DELRITH_TICKS = 100;

  let quest;
  let itemOnGroundManager;
  let pluginApi;

  /** player -> { delrith, weakened, weakenedExpiresAt }; owner-only instanced fight. */
  const demonEncounters = new WeakMap();
  const visions = new WeakMap();

  function later(key, ticks, callback) {
    class SceneTask extends Task {
      constructor() { super(ticks, key, false); }
      execute() { this.stop(); callback(); }
    }
    TaskManager.submit(new SceneTask());
  }

  function setSceneControls(player, active) {
    player.getMovementQueue().setBlockMovement(active);
    player.setUntargetable(active);
    player.getPacketSender().sendVarbit(6719, active ? 2 : 0);
    player.getPacketSender().sendVarbit(12393, active ? 1 : 0);
  }

  class DemonSceneArea extends PrivateArea {
    constructor(player, vision) {
      super([new Boundary(3216, 3240, 3352, 3384, 0)]);
      this.owner = player;
      this.vision = vision;
      this.returnTile = player.getLocation().clone();
    }
    canTeleport() { return false; }
    canAttack(attacker, target) {
      if (this.vision || demonEncounters.get(this.owner)?.summoning) return false;
      if (attacker === this.owner && target.getId?.() === DELRITH_NPC_ID && !silverlightEquipped(attacker)) {
        startTranscript(api, attacker, ARIS_NPC_ID, "Demon Slayer", "the-final-battle-attempting-to-attack-delrith-without-silverlight");
        return false;
      }
      return null;
    }
    process(mobile) {
      if (!this.vision && mobile === this.owner) handlePlayerProcess({ player: mobile });
    }
    postLeave(mobile, logout) {
      if (mobile === this.owner) {
        mobile.setArea(null);
        if (this.vision) endVision(mobile);
        else clearDemonEncounter(mobile);
        setSceneControls(mobile, false);
        if (!this.vision) mobile.getPacketSender().sendCameraReset();
      }
      super.postLeave(mobile, logout);
    }
  }

  function startVision(player) {
    if (visions.has(player)) return;
    const scene = new DemonSceneArea(player, true);
    scene.enter(player);
    visions.set(player, scene);
    player.moveTo(new Location(3225, 3371, 0));
    player.setNpcTransformationId(WALLY_NPC_ID);
    setSceneControls(player, true);
    player.getPacketSender().sendCameraMoveTo(3227, 3369, 300, { rate: 232, rate2: 232 });
    player.getPacketSender().sendCameraLookAt(3229, 3367, 250, { rate: 232, rate2: 232 });
    player.getPacketSender().sendCameraShake(1, 0, 10, 10);
    player.getPacketSender().sendCameraShake(3, 0, 90, 1);
    player.getPacketSender().sendSong(196);
  }

  function endVision(player) {
    const scene = visions.get(player);
    if (!scene) return;
    visions.delete(player);
    TaskManager.cancelTasks(scene);
    if (scene.running !== undefined) player.setRunning(scene.running);
    player.setNpcTransformationId(-1);
    player.setForceMovement(null);
    player.performAnimation(new Animation(-1));
    setSceneControls(player, false);
    player.getPacketSender().sendCameraReset();
    if (player.getArea() === scene) scene.leave(player, false);
    player.moveTo(scene.returnTile);
    scene.destroy();
  }


  const hasItem = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  /** Inventory or equipment (Silverlight is a weapon, so can be wielded). */
  const ownsItem = (player, itemId) =>
    hasItem(player, itemId) || bankHasItem(player, itemId) ||
    (player.getEquipment().getItems() || []).some((item) => item && item.getId?.() === itemId);

  const bankHasItem = (player, itemId) =>
    player.getBanks?.()?.some((bank) => bank && bank.getAmount(itemId) > 0) === true;

  function incantationOrder(player) {
    let order = player.getAttribute(INCANTATION_ATTRIBUTE);
    if (!Array.isArray(order) || order.length !== INCANTATION_WORDS.length ||
        new Set(order).size !== INCANTATION_WORDS.length || order.some((word) => !Number.isInteger(word) || word < 0 || word >= INCANTATION_WORDS.length)) {
      order = INCANTATION_WORDS.map((_, index) => index);
      for (let index = order.length - 1; index > 0; index--) {
        const other = Math.floor(Math.random() * (index + 1));
        [order[index], order[other]] = [order[other], order[index]];
      }
      player.setAttribute(INCANTATION_ATTRIBUTE, order);
    }
    return order;
  }

  function sendIncantation(player) {
    incantationOrder(player).forEach((word, index) =>
      player.getPacketSender().sendVarbit(VARBIT_INCANTATION_FIRST + index, word));
  }

  const hasAllKeys = (player) =>
    hasItem(player, TRAIBORN_KEY_ITEM_ID) &&
    hasItem(player, ROVIN_KEY_ITEM_ID) &&
    hasItem(player, PRYSIN_KEY_ITEM_ID);

  const carriedKeyCount = (player) =>
    [TRAIBORN_KEY_ITEM_ID, ROVIN_KEY_ITEM_ID, PRYSIN_KEY_ITEM_ID].filter((id) =>
      hasItem(player, id)
    ).length;

  // Preserve saved legacy values: 0/1 unflushed, 2 flushed, 3 collected.
  // The client varbit uses 0 unflushed, 1 flushed, 2 collected.
  const drainState = (player) => Number(player.getAttribute(DRAIN_ATTRIBUTE)) || 0;
  const setDrainState = (player, value) => {
    player.setAttribute(DRAIN_ATTRIBUTE, value);
    player.getPacketSender().sendVarbit(VARBIT_DRAIN_KEY, Math.max(0, Math.min(2, value - 1)));
  };

  /** The drained state (=2) means the key is lying in the sewer. Ground items
   * despawn after ~3 minutes, so re-place the owner's key whenever they are in the
   * sewer and it is missing; the drain stage itself is persisted on the player. */
  function inSewer(player) {
    const location = player.getLocation();
    return Math.abs(location.getX() - SEWER_KEY_TILE.getX()) <= 64
      && Math.abs(location.getY() - SEWER_KEY_TILE.getY()) <= 64;
  }

  function ensureSewerKey(player) {
    if (drainState(player) !== 2) return;
    if (hasItem(player, PRYSIN_KEY_ITEM_ID) || bankHasItem(player, PRYSIN_KEY_ITEM_ID)) return;
    if (!inSewer(player)) return;
    if (itemOnGroundManager.getGroundItem(player.getUsername(), PRYSIN_KEY_ITEM_ID, SEWER_KEY_TILE, player.getPrivateArea())) return;
    itemOnGroundManager.registerLocation(player, new Item(PRYSIN_KEY_ITEM_ID, 1), SEWER_KEY_TILE);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage === 0) {
      return [
        "I can start this quest by speaking to <col=800000>Aris</col> in the",
        "<col=800000>tent in Varrock's main square</col>.",
        "",
        "I must be able to defeat an apocalyptic demon!",
      ];
    }

    const history = [
      "<str>I spoke to Aris in Varrock Square, who saw my future.</str>",
      "<str>It involved killing Delrith, who almost destroyed Varrock.</str>",
    ];
    if (stage < STAGE_KEY_HUNT) {
      return [
        ...history,
        "",
        "To defeat <col=800000>Delrith</col> I need the magical sword",
        "<col=800000>Silverlight</col>. I should speak to <col=800000>Sir Prysin</col> in Varrock Palace.",
      ];
    }
    if (stage < STAGE_SILVERLIGHT) {
      const lines = [
        ...history,
        "",
        "Sir Prysin needs three keys before he can give me Silverlight.",
        hasItem(player, PRYSIN_KEY_ITEM_ID)
          ? "<str>I have recovered Sir Prysin's key.</str>"
          : "His key was dropped down the palace kitchen drain.",
        hasItem(player, ROVIN_KEY_ITEM_ID)
          ? "<str>I have Captain Rovin's key.</str>"
          : "Captain Rovin has another key in Varrock Palace.",
      ];
      if (hasItem(player, TRAIBORN_KEY_ITEM_ID)) {
        lines.push("<str>I have Wizard Traiborn's key.</str>");
      } else if (stage >= STAGE_COLLECTING_BONES && stage <= STAGE_TRAIBORN_KEY) {
        const given = stage - STAGE_COLLECTING_BONES;
        lines.push(
          `Wizard Traiborn still needs ${Math.max(0, BONES_REQUIRED - given)} sets of bones.`
        );
      } else {
        lines.push("Wizard Traiborn has the third key at the Wizards' Tower.");
      }
      if (hasAllKeys(player)) {
        lines.push("", "I should take all three keys back to Sir Prysin.");
      }
      return lines;
    }
    if (stage === STAGE_SILVERLIGHT) {
      return [
        ...history,
        "<str>I reclaimed Silverlight from Sir Prysin.</str>",
        "",
        "I should go to the stone circle south of Varrock and destroy",
        "<col=800000>Delrith</col> while wielding <col=800000>Silverlight</col>.",
      ];
    }
    return [
      ...history,
      "<str>I reclaimed Silverlight from Sir Prysin.</str>",
      "<str>I used it and Aris's incantation to banish Delrith.</str>",
      "",
      "<col=ff0000>QUEST COMPLETE!</col>",
    ];
  }

  /** True while Temple of the Eye is in progress and using Traiborn (its tower
   * stages: 6 brief, 7 apprentices, 8-25 riddle solved). */
  function templeOfTheEyeUsesTraiborn(player) {
    const stage = Number(player.getAttribute(TEMPLE_OF_THE_EYE_STAGE_ATTRIBUTE)) || 0;
    return stage >= TOTE_TOWER_STAGE && stage < TOTE_COMPLETE_STAGE;
  }

  // Which transcript each quest NPC plays, by quest stage / keys carried.
  function selectDialogueVariant({ npcId, player }) {
    const stage = quest.getStage(player);

    if (npcId === ARIS_NPC_ID || npcId === ARIS_LEGACY_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return { page: "Aris", variant: "after-demon-slayer" };
      if (stage >= STAGE_SILVERLIGHT) {
        return { page: "Demon Slayer", variant: "getting-the-key-from-traiborn-aris-after-acquiring-the-sword" };
      }
      if (stage >= STAGE_KEY_HUNT) {
        return { page: "Demon Slayer", variant: "getting-the-key-from-traiborn-after-talking-to-sir-prysin" };
      }
      if (stage >= STAGE_STARTED) {
        return { page: "Demon Slayer", variant: "starting-demon-slayer-aris-after-starting-the-quest" };
      }
      return { page: "Demon Slayer", variant: "starting-demon-slayer" };
    }

    if (PRYSIN_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return { page: "Sir Prysin", variant: "standard-dialogue" };
      if (stage >= STAGE_SILVERLIGHT) {
        return { page: "Demon Slayer", variant: "getting-the-key-from-traiborn-talking-to-sir-prysin-before-fighting-delrith" };
      }
      if (stage >= STAGE_KEY_HUNT) {
        if (hasAllKeys(player)) {
          return { page: "Demon Slayer", variant: "getting-the-key-from-traiborn-returning-to-sir-prysin-with-all-the-keys" };
        }
        const count = carriedKeyCount(player);
        if (count === 0) {
          return { page: "Demon Slayer", variant: "sir-prysin-talking-to-sir-prysin-again-before-getting-keys" };
        }
        if (count === 1) {
          return { page: "Demon Slayer", variant: "sir-prysin-returning-to-sir-prysin-with-one-key" };
        }
        return { page: "Demon Slayer", variant: "sir-prysin-talking-to-sir-prysin-with-two-keys" };
      }
      return { page: "Demon Slayer", variant: "sir-prysin" };
    }

    if (ROVIN_NPC_IDS.has(npcId)) {
      if (
        stage >= STAGE_KEY_HUNT &&
        stage < STAGE_SILVERLIGHT &&
        hasItem(player, ROVIN_KEY_ITEM_ID)
      ) {
        return { page: "Demon Slayer", variant: "getting-the-key-from-captain-rovin-talking-to-captain-rovin-again-after-obtaining-the-key" };
      }
      return { page: "Demon Slayer", variant: "getting-the-key-from-captain-rovin" };
    }

    if (npcId === TRAIBORN_NPC_ID) {
      if (stage === STAGE_TRAIBORN_KEY && !hasItem(player, TRAIBORN_KEY_ITEM_ID) && !bankHasItem(player, TRAIBORN_KEY_ITEM_ID)) {
        return { page: "Demon Slayer", variant: "getting-the-key-from-traiborn-traiborn-after-losing-the-key" };
      }
      if (stage >= STAGE_COLLECTING_BONES && stage < STAGE_TRAIBORN_KEY) {
        const needed = BONES_REQUIRED - (stage - STAGE_COLLECTING_BONES);
        const available = Math.min(needed, player.getInventory().getAmount(BONES_ITEM_ID));
        if (available <= 0) {
          return { page: "Demon Slayer", variant: "getting-the-key-from-traiborn-returning-with-no-bones-to-traiborn" };
        }
        if (available >= needed) {
          return { page: "Demon Slayer", variant: "getting-the-key-from-traiborn-returning-with-the-last-of-the-bones-to-traiborn" };
        }
        return { page: "Demon Slayer", variant: "getting-the-key-from-traiborn-returning-with-some-bones-to-traiborn" };
      }
      if (stage === STAGE_TRAIBORN_KEY) {
        return { page: "Demon Slayer", variant: "getting-the-key-from-traiborn-traiborn-after-obtaining-the-key" };
      }
      if (stage === STAGE_KEY_HUNT) {
        return { page: "Demon Slayer", variant: "getting-the-key-from-traiborn" };
      }
      // stage 0/1 and stage >= SILVERLIGHT: generic wizard talk, unless Temple
      // of the Eye is in progress and using Traiborn for its own quest.
      if (templeOfTheEyeUsesTraiborn(player)) return null;
      return { page: "Wizard Traiborn", variant: "standard-dialogue" };
    }

    // Only reachable if the human adds these ids to npc-dialogue-index.json.
    if (npcId === WEAKENED_DELRITH_NPC_ID) {
      return { page: "Demon Slayer", variant: "the-final-battle-after-lowering-delrith-s-hitpoints-to-0" };
    }
    if (npcId === DELRITH_NPC_ID) {
      return { page: "Demon Slayer", variant: "the-final-battle" };
    }

    return null;
  }

  // Answer the transcript's prose conditions.
  function answerDialogueCondition({ npcId, player, text }) {
    const value = String(text).toLowerCase();
    const inventory = player.getInventory();

    if (npcId === ARIS_NPC_ID || npcId === ARIS_LEGACY_NPC_ID) {
      if (value.includes("doesn't have any money")) return inventory.getAmount(COINS_ITEM_ID) < 1;
      return null;
    }

    if (PRYSIN_NPC_IDS.has(npcId)) {
      if (value.includes("keys from traiborn and rovin")) {
        return hasItem(player, TRAIBORN_KEY_ITEM_ID) && hasItem(player, ROVIN_KEY_ITEM_ID);
      }
      if (value.includes("keys from rovin and the drain")) {
        return hasItem(player, ROVIN_KEY_ITEM_ID) && hasItem(player, PRYSIN_KEY_ITEM_ID);
      }
      if (value.includes("keys from traiborn and the drain")) {
        return hasItem(player, TRAIBORN_KEY_ITEM_ID) && hasItem(player, PRYSIN_KEY_ITEM_ID);
      }
      if (value.includes("key from captain rovin")) return hasItem(player, ROVIN_KEY_ITEM_ID);
      if (value.includes("key from wizard traiborn")) return hasItem(player, TRAIBORN_KEY_ITEM_ID);
      if (value.includes("key from the drain")) return hasItem(player, PRYSIN_KEY_ITEM_ID);
      if (value.includes("does not have silverlight")) return !ownsItem(player, SILVERLIGHT_ITEM_ID);
      if (value.includes("has silverlight")) return ownsItem(player, SILVERLIGHT_ITEM_ID);
      if (value.includes("does not have at least 500 coins")) {
        return inventory.getAmount(COINS_ITEM_ID) < 500;
      }
      if (value.includes("at least 500 coins")) {
        return inventory.getAmount(COINS_ITEM_ID) >= 500 && !inventory.isFull();
      }
      if (value.includes("lacks sufficient inventory space")) return inventory.isFull();
      return null;
    }

    if (ROVIN_NPC_IDS.has(npcId)) {
      if (value.includes("key in their inventory")) return hasItem(player, ROVIN_KEY_ITEM_ID);
      if (value.includes("key in their bank")) return bankHasItem(player, ROVIN_KEY_ITEM_ID);
      return null;
    }

    return null;
  }

  function visionTail(steps, text) {
    for (let index = 0; index < steps.length; index++) {
      if (steps[index].text === text) return steps.slice(index);
      for (const option of steps[index].options ?? []) {
        const tail = visionTail(option.steps ?? [], text);
        if (tail) return tail;
      }
      if (steps[index].steps) {
        const tail = visionTail(steps[index].steps, text);
        if (tail) return tail;
      }
    }
    return null;
  }

  function resumeVision(player, text) {
    startTranscript(api, player, ARIS_NPC_ID, "Demon Slayer", "starting-demon-slayer",
      (steps) => visionTail(steps, text));
  }

  // The dump keeps wiki placeholders in a few spoken lines; render them.
  function renderDialogueLine(event) {
    const text = String(event.text || "");
    if (visions.has(event.player)) {
      if (text === "Die, foul demon!") event.before = () => {
        const player = event.player;
        const scene = visions.get(player);
        scene.running = player.isRunningReturn();
        player.moveTo(new Location(3225, 3363, 0));
        player.setRunning(true);
        TaskManager.submit(new ForceMovementTask(player, 2, new ForceMovement(
          new Location(3225, 3363, 0), new Location(2, 4, 0), 0, 60, 0, 824)));

        later(scene, 4, () => {
          player.getMovementQueue().setBlockMovement(true);
          player.performAnimation(new Animation(ANIMATION.wally));
        });
        event.player.getPacketSender().sendCameraLookAt(3227, 3367, 200, { rate: 2, rate2: 10 });
        event.player.getPacketSender().sendCameraLookAt(3227, 3367, 100, { rate: 1, rate2: 10 });
        event.player.getPacketSender().sendCameraShake(3, 0, 0, 0);
        player.getDialogueManager().reset();
        new NpcDialogue(0, WALLY_NPC_ID, text).send(player);
        player.getPacketSender().sendString("", NPC_DIALOGUE_CONTINUE_UID).sendInterfaceFlagsRange(NPC_DIALOGUE_CONTINUE_UID, -1, -1, 0);
        later(scene, 8, () => {
          if (visions.get(player) === scene) resumeVision(player, "Now, what was that incantation again?");
        });
      };
      if (text === "Now, what was that incantation again?") event.before = () => {
        event.player.getPacketSender().sendCameraMoveTo(3227, 3369, 100, { rate: 2, rate2: 10 });
        event.player.getPacketSender().sendCameraShake(1, 0, 10, 5);
        event.player.getPacketSender().sendCameraShake(3, 0, 2, 50);
      };
      if (text === "[word 1]... [word 2]... [word 3]... [word 4]... [word 5]!") event.after = () => {
        const scene = visions.get(event.player);
        event.player.getDialogueManager().reset();
        StatementDialogue.send(event.player, "", false);
        later(scene, 4, () => {
          if (visions.get(event.player) === scene) resumeVision(event.player, "I am the greatest demon slayer EVER!");
        });
      };
      if (text === "I am the greatest demon slayer EVER!") event.before = () => {
        event.player.performAnimation(new Animation(ANIMATION.sword));
        event.player.performGraphic(new Graphic(778));
        event.player.getPacketSender().sendCameraShake(1, 0, 0, 0);
        event.player.getPacketSender().sendCameraShake(3, 0, 0, 0);
        event.player.getPacketSender().sendCameraMoveTo(3225, 3363, 500, { rate: 232, rate2: 232 });
        event.player.getPacketSender().sendCameraLookAt(3227, 3367, 200, { rate: 232, rate2: 232 });
      };
    }
    if (event.step?.speaker === "Dark wizards") event.speakerId = NpcIdentifiers.DARK_WIZARD_8;
    const fight = demonEncounters.get(event.player);
    if (fight?.summoning && text.startsWith("I've got to get out of here")) {
      event.before = () => event.player.getPacketSender().sendCameraMoveTo(3226, 3383, 1000, { rate: 1, rate2: 1 });
      event.after = () => {
        fight.summoning = false;
        TaskManager.cancelTasks(fight);
        for (const actor of fight.actors) actor.performAnimation(new Animation(-1));
        if (fight.actors.at(-1)) api.removeNpc(fight.actors.pop());
        event.player.getPacketSender().sendVarbit(VARBIT_SUMMONING_SEEN, 1);
        event.player.getPacketSender().sendCameraReset();
        setSceneControls(event.player, false);
      };
    }
    if (event.npcId === TRAIBORN_NPC_ID && text.includes("[25-X]")) {
      const stage = quest.getStage(event.player);
      const remaining = Math.max(0, BONES_REQUIRED - (stage - STAGE_COLLECTING_BONES));
      event.text = text.replace("[25-X]", String(remaining));
      return;
    }
    if ((event.npcId === ARIS_NPC_ID || event.npcId === ARIS_LEGACY_NPC_ID) && text.includes("[word")) {
      sendIncantation(event.player);
      const order = incantationOrder(event.player);
      event.text = text.replace(/\[word (\d)\]/g, (_, index) => INCANTATION_WORDS[order[Number(index) - 1]]);
    }
  }

  // Option choices that carry no action id in the dump but gate quest state.
  function handleDialogueChoice({ player, npcId, option, stepId }) {
    if ((npcId === ARIS_NPC_ID || npcId === ARIS_LEGACY_NPC_ID) &&
        quest.getStage(player) === 0 && String(option).toLowerCase() === "yes.") {
      if (hasItem(player, COINS_ITEM_ID)) player.getInventory().deleteNumber(COINS_ITEM_ID, 1);
      return;
    }
    if (stepId === PRYSIN_INTRO_OPTION_ID && PRYSIN_NPC_IDS.has(npcId)) {
      const stage = quest.getStage(player);
      if (stage >= STAGE_STARTED && stage < STAGE_KEY_HUNT) {
        quest.setStage(player, STAGE_KEY_HUNT);
      }
      return;
    }
    if (npcId !== TRAIBORN_NPC_ID) return;
    const text = String(option || "").toLowerCase();
    if (text === BONES_CHOICE_TEXT) {
      const stage = quest.getStage(player);
      if (stage >= STAGE_KEY_HUNT && stage < STAGE_COLLECTING_BONES) {
        quest.setStage(player, STAGE_COLLECTING_BONES);
      }
      return;
    }
    if (text.includes(TALK_ABOUT_QUEST_TEXT)) {
      const stage = quest.getStage(player);
      if (stage === STAGE_TRAIBORN_KEY && !hasItem(player, TRAIBORN_KEY_ITEM_ID) && !bankHasItem(player, TRAIBORN_KEY_ITEM_ID)) {
        quest.setStage(player, STAGE_COLLECTING_BONES);
      }
    }
  }

  // "Demon Slayer is started." carries this slug; the reading cost 1 coin.
  function handleDialogueHook({ player, npcId, hook }) {
    if (hook !== QUEST_START_HOOK) return;
    if (npcId !== ARIS_NPC_ID && npcId !== ARIS_LEGACY_NPC_ID) return;
    if (quest.getStage(player) >= STAGE_STARTED) return;
    endVision(player);
    quest.setStage(player, STAGE_STARTED);
    sendIncantation(player);
    player.sendMessage("You've started a new quest: <col=0ab0ff>Demon Slayer</col>");
  }

  // Key and bone hand-overs keyed off the transcript's message/action ids.
  function handleDialogueAction(event) {
    const { player, npcId, stepId } = event;
    if (stepId === "OzuYrk" && (npcId === ARIS_NPC_ID || npcId === ARIS_LEGACY_NPC_ID)) {
      startVision(player);
      event.handled = true;
      return;
    }
    if (stepId === "xjQ9zZ" && demonEncounters.get(player)?.summoning) {
      summonDelrith(player);
      event.handled = true;
      player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ActionDialogue(0, {
        execute: () => StatementDialogue.send(player, "The wizards cast an evil spell...", false),
      })));
      const fight = demonEncounters.get(player);
      later(fight, 14, () => {
        if (demonEncounters.get(player) === fight && fight.summoning) {
          startTranscript(api, player, DENATH_NPC_ID, "Demon Slayer", "the-final-battle", (steps) => steps.slice(4));
        }
      });
      return;
    }
    if (stepId === ROVIN_KEY_MESSAGE_ID && ROVIN_NPC_IDS.has(npcId)) {
      const stage = quest.getStage(player);
      if (
        !hasItem(player, ROVIN_KEY_ITEM_ID) && !bankHasItem(player, ROVIN_KEY_ITEM_ID) &&
        stage >= STAGE_KEY_HUNT &&
        stage < STAGE_SILVERLIGHT &&
        !player.getInventory().isFull()
      ) {
        player.getInventory().adds(ROVIN_KEY_ITEM_ID, 1);
      } else {
        event.handled = true;
      }
      return;
    }

    if (npcId === TRAIBORN_NPC_ID) {
      if (stepId === SPINACH_ROLL_MESSAGE_ID) {
        if (!player.getInventory().isFull()) player.getInventory().adds(SPINACH_ROLL_ITEM_ID, 1);
        return; // leave the transcript's own message to play
      }
      if (stepId === BONES_SOME_MESSAGE_ID || stepId === BONES_LAST_MESSAGE_ID) {
        const stage = quest.getStage(player);
        if (stage < STAGE_COLLECTING_BONES || stage >= STAGE_TRAIBORN_KEY) {
          event.handled = true;
          return;
        }
        const needed = BONES_REQUIRED - (stage - STAGE_COLLECTING_BONES);
        const available = Math.min(needed, player.getInventory().getAmount(BONES_ITEM_ID));
        if (available <= 0) {
          event.handled = true;
          return;
        }
        player.getInventory().deleteNumber(BONES_ITEM_ID, available);
        quest.setStage(player, stage + available);
        player.sendMessage(
          `You give Traiborn ${available} set${available === 1 ? "" : "s"} of bones.`
        );
        event.handled = true;
        event.end = false;
        return;
      }
      if (stepId === TRAIBORN_KEY_MESSAGE_ID) {
        const stage = quest.getStage(player);
        if (
          !hasItem(player, TRAIBORN_KEY_ITEM_ID) && !bankHasItem(player, TRAIBORN_KEY_ITEM_ID) &&
          stage >= STAGE_TRAIBORN_KEY &&
          !player.getInventory().isFull()
        ) {
          player.getInventory().adds(TRAIBORN_KEY_ITEM_ID, 1);
        }
        return; // leave "Traiborn hands you a key." to play
      }
      return;
    }

    if (PRYSIN_NPC_IDS.has(npcId)) {
      if (stepId === SILVERLIGHT_MESSAGE_ID) {
        if (!ownsItem(player, SILVERLIGHT_ITEM_ID) && hasAllKeys(player)) {
          player.getInventory().deleteNumber(TRAIBORN_KEY_ITEM_ID, 1);
          player.getInventory().deleteNumber(ROVIN_KEY_ITEM_ID, 1);
          player.getInventory().deleteNumber(PRYSIN_KEY_ITEM_ID, 1);
          player.getInventory().adds(SILVERLIGHT_ITEM_ID, 1);
          quest.setStage(player, STAGE_SILVERLIGHT);
          player.getPacketSender().sendVarbit(VARBIT_SILVERLIGHT_CASE, 1);
          player.performAnimation(new Animation(ANIMATION.sword));
          player.performGraphic(new Graphic(778));
          setDrainState(player, 3);
        }
        return; // leave the transcript's own message to play
      }
      if (stepId === PRYSIN_SELL_SILVERLIGHT_ACTION_ID) {
        if (
          player.getInventory().getAmount(COINS_ITEM_ID) >= 500 &&
          !ownsItem(player, SILVERLIGHT_ITEM_ID) &&
          !player.getInventory().isFull()
        ) {
          player.getInventory().deleteNumber(COINS_ITEM_ID, 500);
          player.getInventory().adds(SILVERLIGHT_ITEM_ID, 1);
        }
        event.handled = true;
        return;
      }
      return;
    }

    if (stepId === QUEST_COMPLETE_ACTION_ID) {
      const stage = quest.getStage(player);
      if (npcId === WEAKENED_DELRITH_NPC_ID && demonEncounters.get(player)?.weakened && stage === STAGE_SILVERLIGHT) {
        clearDemonEncounter(player);
        quest.complete(player);
      }
      event.handled = true;
      event.end = true;
    }
  }

  function handBonesToTraiborn(event) {
    if (event.itemId !== BONES_ITEM_ID || event.npcId !== TRAIBORN_NPC_ID) return;
    const stage = quest.getStage(event.player);
    if (stage < STAGE_COLLECTING_BONES || stage >= STAGE_TRAIBORN_KEY) return;
    const choice = selectDialogueVariant({ player: event.player, npcId: TRAIBORN_NPC_ID });
    event.handled = true;
    startTranscript(api, event.player, TRAIBORN_NPC_ID, choice.page, choice.variant,
      (steps) => steps[1].options[0].steps.slice(1));
  }

  // The lost-Silverlight branch of the pre-fight dialogue gives it back.
  function restoreSilverlightCondition({ player, npcId, stepId }) {
    if (!PRYSIN_NPC_IDS.has(npcId) || stepId !== PRYSIN_LOST_SILVERLIGHT_CONDITION_ID) return;
    if (ownsItem(player, SILVERLIGHT_ITEM_ID) || player.getInventory().isFull()) return;
    player.getInventory().adds(SILVERLIGHT_ITEM_ID, 1);
    if (quest.getStage(player) < STAGE_SILVERLIGHT) quest.setStage(player, STAGE_SILVERLIGHT);
    player.sendMessage("Sir Prysin returns Silverlight.");
  }

  // Kitchen drain: search it, or pour a bucket of water to wash the key down.
  function searchDrain(event) {
    if (!DRAIN_LOC_IDS.has(event.objectId)) return;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_KEY_HUNT) {
      player.sendMessage("You can see a key in the drain, but you cannot quite reach it.");
    } else if (stage >= STAGE_SILVERLIGHT || hasItem(player, PRYSIN_KEY_ITEM_ID)) {
      player.sendMessage("Nothing interesting seems to have been dropped down here today.");
    } else if (drainState(player) >= 2) {
      player.sendMessage("The key has been washed into the sewer.");
    } else {
      player.sendMessage(
        "You can see a key, but it is stuck just out of reach. Perhaps water could dislodge it."
      );
    }
    event.handled = true;
  }

  function pourWaterOnDrain(event) {
    const emptyContainer = WATER_CONTAINERS.get(event.itemId);
    if (!emptyContainer || !DRAIN_LOC_IDS.has(event.objectId)) return;
    const { player } = event;
    if (quest.getStage(player) >= STAGE_SILVERLIGHT) {
      player.sendMessage("There is no reason to pour water there.");
      event.handled = true;
      return;
    }
    if (player.getInventory().getAmount(event.itemId) <= 0) return;
    player.getInventory().deleteNumber(event.itemId, 1);
    player.getInventory().adds(emptyContainer, 1);
    player.sendMessage("You pour the liquid down the drain.");
    event.handled = true;
    if (hasItem(player, PRYSIN_KEY_ITEM_ID) || bankHasItem(player, PRYSIN_KEY_ITEM_ID)) return;
    if (drainState(player) === 2) return;
    setDrainState(player, 2);
    ensureSewerKey(player);
    startTranscript(api, player, ARIS_NPC_ID, "Demon Slayer", "searching-the-drain-near-the-palace-kitchen-pouring-water-in-the-drain");
  }

  function handlePlayerProcess({ player }) {
    if (!player || player.isPlayerBot?.() === true) return;
    const tracked = demonEncounters.get(player);
    if (
      tracked?.weakened &&
      tracked.weakenedExpiresAt !== undefined &&
      World.getProcessCycle() >= tracked.weakenedExpiresAt
    ) {
      pluginApi.removeNpc(tracked.weakened);
      tracked.weakened = null;
      demonEncounters.set(player, tracked);
    }
    ensureDelrith(player);
  }

  function silverlightEquipped(player) {
    return (player.getEquipment().getItems() || []).some(
      (item) => item && item.getId?.() === SILVERLIGHT_ITEM_ID
    );
  }

  /**
   * Delrith only appears in the stone circle once the player has Silverlight
   * obtained (quest stage SILVERLIGHT). The fight is owner-only: the spawned NPC is
   * hidden from, and never aggressive to, anyone but its owner.
   */
  function ensureDelrith(player) {
    if (!player || player.isPlayerBot?.() === true || quest.getStage(player) !== STAGE_SILVERLIGHT) return;
    const tracked = demonEncounters.get(player);
    if (tracked?.summoning || tracked?.delrith || tracked?.weakened) return;
    if (tracked) { summonDelrith(player); return; }
    const arena = new DemonSceneArea(player, false);
    arena.enter(player);
    const fight = { arena, actors: [], summoning: true };
    demonEncounters.set(player, fight);
    setSceneControls(player, true);
    for (const [id, x, y] of SUMMONERS) {
      const actor = api.spawnNpc({ id, x, y, z: 0, wanderRadius: 0, owner: player, ownerOnly: true });
      if (actor) { arena.enter(actor); actor.performAnimation(new Animation(ANIMATION.chant)); fight.actors.push(actor); }
    }
    player.getPacketSender().sendCameraMoveTo(3224, 3376, 475, { rate: 232, rate2: 232 });
    player.getPacketSender().sendCameraLookAt(3227, 3369, 300, { rate: 232, rate2: 232 });
    player.getPacketSender().sendCameraMoveTo(3231, 3376, 475, { rate: 1, rate2: 1 });
    startTranscript(api, player, DENATH_NPC_ID, "Demon Slayer", "the-final-battle");
  }

  function summonDelrith(player) {
    const tracked = demonEncounters.get(player);
    if (!tracked || tracked.delrith || tracked.weakened) return;
    if (tracked.summoning) {
      const table = new GameObject(ObjectIdentifiers.STONE_TABLE_2, new Location(3227, 3369, 0), 10, 0, tracked.arena);
      ObjectManager.register(table, true);
      table.performAnimation(new Animation(4622));
      later(tracked, 4, () => ObjectManager.register(new GameObject(ObjectIdentifiers.STONE_TABLE_4,
        new Location(3227, 3369, 0), 10, 0, tracked.arena), true));
    }
    const spawn = () => {
      if (demonEncounters.get(player) !== tracked || tracked.delrith || tracked.weakened) return;
      const npc = api.spawnNpc({ id: DELRITH_NPC_ID, x: 3227, y: 3369, z: 0,
        wanderRadius: DELRITH_WANDER_RADIUS, owner: player, ownerOnly: true });
      if (!npc) return;
      if (tracked.arena) tracked.arena.enter(npc);
      tracked.delrith = npc;
      npc.performAnimation(new Animation(ANIMATION.summoned));
    };
    if (!tracked.summoning) { spawn(); return; }
    player.getPacketSender().sendCameraLookAt(3227, 3369, 100, { rate: 232, rate2: 232 });
    player.getPacketSender().sendCameraMoveTo(3227, 3365, 500, { rate: 232, rate2: 232 });
    later(tracked, 2, () => player.getPacketSender().sendCameraShake(0, 15));
    later(tracked, 3, () => player.getPacketSender().sendCameraShake(0, 0));
    later(tracked, 6, () => {
      spawn();
      player.getPacketSender().sendCameraLookAt(3227, 3369, 400, { rate: 1, rate2: 1 });
    });
    later(tracked, 12, () => tracked.delrith?.getMovementQueue().addSteps(new Location(3227, 3368, 0)));
    later(tracked, 13, () => {
      tracked.delrith?.getMovementQueue().addSteps(new Location(3227, 3367, 0));
      player.getPacketSender().sendCameraMoveTo(3226, 3375, 500, { rate: 232, rate2: 232 });
      player.getPacketSender().sendCameraLookAt(3227, 3367, 300, { rate: 232, rate2: 232 });
    });
  }

  function spawnWeakenedDelrith(player, npc) {
    const tracked = demonEncounters.get(player);
    npc.setNpcTransformationId(WEAKENED_DELRITH_NPC_ID);
    npc.setHitpoints(1);
    npc.getCombat().reset();
    player.getCombat().reset();
    tracked.delrith = null;
    tracked.weakened = npc;
    tracked.weakenedExpiresAt = World.getProcessCycle() + WEAKENED_DELRITH_TICKS;
    startDialogue(api, player, { npcId: WEAKENED_DELRITH_NPC_ID }, [
      { player: ["Now what was that incantation again?"] },
      { exec: () => promptIncantation(player, npc, []) },
    ]);
  }

  function clearDemonEncounter(player) {
    const tracked = demonEncounters.get(player);
    if (!tracked) return;
    demonEncounters.delete(player);
    TaskManager.cancelTasks(tracked);
    if (tracked.delrith) api.removeNpc(tracked.delrith);
    if (tracked.weakened) api.removeNpc(tracked.weakened);
    for (const actor of tracked.actors ?? []) api.removeNpc(actor);
    if (tracked.arena && player.getArea() === tracked.arena) tracked.arena.leave(player, false);
    setSceneControls(player, false);
  }

  /** Delrith never dies: killing him swaps in the weakened form to be banished. */
  function handleDelrithBeforeDeath(event) {
    const npc = event?.npc;
    if (!npc || npc.getId?.() !== DELRITH_NPC_ID) return;
    const owner = npc.getOwner?.();
    if (!owner || quest.getStage(owner) !== STAGE_SILVERLIGHT) return;
    const tracked = demonEncounters.get(owner);
    if (!tracked || tracked.delrith !== npc) return;
    spawnWeakenedDelrith(owner, npc);
    event.preventDeath = true;
  }

  function chooseIncantation(player, npc, selected) {
    const tracked = demonEncounters.get(player);
    if (!tracked || tracked.weakened !== npc) return;
    if (selected.every((word, index) => word === INCANTATION_WORDS[incantationOrder(player)[index]])) {
      tracked.weakenedExpiresAt = undefined;
      npc.performAnimation(new Animation(ANIMATION.banished));
      StatementDialogue.send(player, "Delrith is sucked into the vortex...", false);
      later(tracked, 8, () => {
        StatementDialogue.send(player, "...back into the dark dimension from which he came.", false);
        later(tracked, 2, () => {
          clearDemonEncounter(player);
          player.getPacketSender().sendVarbit(VARBIT_SUMMONING_SEEN, 0);
          player.moveTo(new Location(3226, 3368, 0));
          player.performAnimation(new Animation(ANIMATION.sword));
          player.performGraphic(new Graphic(778));
          quest.complete(player);
        });
      });
      return;
    }
    player.sendMessage("The vortex collapses. That was the wrong incantation.");
    npc.setNpcTransformationId(-1);
    npc.setHitpoints(npc.getDefinition().getHitpoints());
    tracked.weakened = null;
    tracked.delrith = npc;
  }

  function banishWeakenedDelrith({ player, npc }) {
    if (!player || player.isPlayerBot?.() === true) return;
    const tracked = demonEncounters.get(player);
    if (!tracked || tracked.weakened !== npc) return;
    promptIncantation(player, npc, []);
  }

  function promptIncantation(player, npc, selected) {
    if (demonEncounters.get(player)?.weakened !== npc) return;
    if (selected.length === INCANTATION_WORDS.length) {
      chooseIncantation(player, npc, selected);
      return;
    }
    const options = [];
    for (const word of INCANTATION_WORDS) {
      options.push(word, () => promptIncantation(player, npc, [...selected, word]));
    }
    api.sendMultiChatboxPrompt(player, "Select a word", ...options);
  }

  class DelrithArea extends Area {
    process(mobile) {
      if (mobile.isPlayer()) handlePlayerProcess({ player: mobile });
    }
    canAttack(attacker, target) {
      if (target.getId?.() !== DELRITH_NPC_ID || !attacker.isPlayer()) return null;
      if (silverlightEquipped(attacker)) return null;
      startTranscript(api, attacker, ARIS_NPC_ID, "Demon Slayer", "the-final-battle-attempting-to-attack-delrith-without-silverlight");
      return false;
    }
  }

  function handlePlayerLogout({ player }) {
    if (player) { endVision(player); clearDemonEncounter(player); }
  }

  function handleSewerKeyPickup(event) {
    if (event.groundItem?.getItem?.()?.getId?.() !== PRYSIN_KEY_ITEM_ID || event.player.getInventory().isFull()) return;
    const tile = event.groundItem.getPosition();
    if (!tile.equals(SEWER_KEY_TILE)) return;
    setDrainState(event.player, 3);
  }

  function ensureSewerKeyOnMapChange({ player }) {
    ensureSewerKey(player);
  }

  function handlePlayerLogin({ player }) {
    refreshQuestList(player);
    ensureSewerKey(player);
    if (player.getAttribute(INCANTATION_ATTRIBUTE)) sendIncantation(player);
    player.getPacketSender().sendVarbit(VARBIT_DRAIN_KEY, Math.max(0, Math.min(2, drainState(player) - 1)));
    player.getPacketSender().sendVarbit(VARBIT_SILVERLIGHT_CASE, quest.getStage(player) >= STAGE_SILVERLIGHT ? 1 : 0);
  }

  quest = registerQuest(api, {
    key: "demon_slayer",
    name: "Demon Slayer",
    varpId: VARP_DEMON_SLAYER,
    varbitId: VARBIT_DEMON_SLAYER,
    varbitValue: (stage) => stage >= STAGE_COMPLETE ? 3 : Math.min(stage, STAGE_KEY_HUNT),
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 3,
    scrollItemId: SILVERLIGHT_ITEM_ID,
    rewardItemLabel: "Silverlight",
    buildJournal,
  });

  itemOnGroundManager = api.getItemOnGroundManager();
  pluginApi = api;
  api.persistAttribute(DRAIN_ATTRIBUTE, 0);
  api.persistAttribute(INCANTATION_ATTRIBUTE);

  api.onNpcDialogueVariant(selectDialogueVariant);
  api.onNpcDialogueCondition(answerDialogueCondition);
  api.onCustomEvent("npc-dialogue:line", renderDialogueLine);
  api.onCustomEvent("npc-dialogue:choice", handleDialogueChoice);
  api.onCustomEvent("npc-dialogue:hook", handleDialogueHook);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("npc-dialogue:condition", restoreSilverlightCondition);
  api.onItemOnNpc(handBonesToTraiborn);
  api.onGroundItemPickup(handleSewerKeyPickup);

  // Delrith: owner-only summon in the stone circle, weaken then banish.
  api.registerArea(new DelrithArea([new Boundary(DELRITH_ZONE.minX, DELRITH_ZONE.maxX, DELRITH_ZONE.minY, DELRITH_ZONE.maxY, 0)]));
  api.onNpcBeforeDeath(handleDelrithBeforeDeath);
  api.onNpcInteraction("Weakened Delrith", { Banish: banishWeakenedDelrith });

  // Kitchen drain: search it, or pour a bucket of water to wash the key down.
  api.onObjectInteraction("Drain", { Search: searchDrain });
  api.onItemOnObject(pourWaterOnDrain, { noted: false });

  api.onPlayerLogin(handlePlayerLogin);
  api.onPlayerLogout(handlePlayerLogout);
  api.onPlayerMapSquareChange(ensureSewerKeyOnMapChange);
};
