/** Demon Slayer. Capture evidence and remaining presentation gaps: docs/demon-slayer.md. */
module.exports = function registerDemonSlayerQuest(api) {
  const { Item, Location, World, Area, PrivateArea, Boundary, Animation, Graphic, NpcDialogue, PlayerDialogue, DialogueChainBuilder, ActionDialogue, ForceMovement, ForceMovementTask, Task, TaskManager, StatementDialogue, ItemStatementDialogue, GameObject, ObjectManager, Music, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
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
  const VARBIT_DARK_WIZARDS_KILLED = 2572;
  const DENATH_NPC_ID = NpcIdentifiers.DENATH_4;
  const WALLY_NPC_ID = NpcIdentifiers.WALLY;
  const NPC_DIALOGUE_CONTINUE_UID = (231 << 16) | 5;
  const PLAYER_DIALOGUE_CONTINUE_UID = (217 << 16) | 5;
  /** The cutscene fade: interface 174 driven by clientscript 948 (capture 1723, 10409-10446). */
  const FADE_UID = (161 << 16) | 1;
  const FADE_INTERFACE = 174;
  const FADE_SCRIPT = 948;
  /** [id, x, y, the table tile it faces while chanting] (capture 1843). */
  const SUMMONERS = [
    [NpcIdentifiers.DARK_WIZARD_7, 3226, 3371, 3228, 3369], [NpcIdentifiers.DARK_WIZARD_8, 3229, 3371, 3227, 3369],
    [NpcIdentifiers.DARK_WIZARD_9, 3226, 3368, 3228, 3370], [DENATH_NPC_ID, 3229, 3368, 3227, 3370],
  ];
  const ANIMATION = {
    wally: 4603, sword: 4604, chant: 4617, summoned: 4623, banished: 4624, tableExplosion: 4622, pour: 827,
    boneRitual: 4602, openCloset: 536, wardrobeGone: 4600,
    caseOpens: 4596, prysinOpens: 4597, prysinTakes: 4598, prysinPresents: 4606, prysinHolds: 4607, prysinGives: 4608,
  };
  const GRAPHIC = { glint: 778, boneRitual: 777 };
  const SOUND = {
    coin: 2976, cut: 1678, wallyCharge: 2989, glint: 2990, pour: 2982, pourClink: 2983,
    boneRitual: 2973, wardrobe: 2977, closet: 52, wardrobeGone: 2978, caseKey: 58, caseOpens: 50,
    spell: 188, tableExplosion: 2988, delrithRising: 2974, delrithArrives: 2980,
    delrithWeakened: 2985, vortex: 2981, vortexCloses: 2986,
  };
  const SONG_WALLY = 196;
  const SONG_DELRITH = 195;
  const DEMON_SLAYER_JINGLE = 152;
  const RECOMMENDED_COMBAT_LEVEL = 15;
  /** Fade lead-ins and the banishment's holds, in ticks (capture 1723 10409, 10441; 1843 10179-10225). */
  const VISION_FADE_TICKS = 5;
  const VISION_END_FADE_TICKS = 4;
  const INCANTATION_WORD_TICKS = 3;
  const VORTEX_TICKS = 16;
  const WIZARDS_TILE = new Location(3227, 3367, 0);
  const DENATH_TILE = new Location(3229, 3368, 0);
  const DENATH_EXIT_TILE = new Location(3239, 3368, 0);
  const STONE_TABLE_TILE = new Location(3227, 3369, 0);
  const WIZARD_WANDER_RADIUS = 5;
  /** Traiborn's wardrobe and Prysin's sword case; tiles and shapes from capture 1843 (9883, 10058). */
  const WARDROBE_TILE = new Location(3111, 3163, 1);
  const WARDROBE_TICKS = 14;
  const SILVERLIGHT_CASE_LOC_ID = 17428;
  const SILVERLIGHT_CASE_TILE = new Location(3204, 3469, 0);
  const PRYSIN_CASE_APPROACH_TILE = new Location(3204, 3470, 0);
  const PRYSIN_CASE_FACE_TILE = new Location(3204, 3468, 0);
  const PRYSIN_WANDER_RADIUS = 1;
  const SUMMONER_CHATHEADS = Object.freeze({
    "Dark wizards": { npcId: NpcIdentifiers.DARK_WIZARD_8, expression: 567 }, // chathap1
    "Dark wizard": { npcId: NpcIdentifiers.DARK_WIZARD_7, expression: 571 }, // chatshock1
  });
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
  /** Shadow of the Storm dyes the sword (6745) and turns it into Darklight (6746): still the sword. */
  const SILVERLIGHT_FORMS = [SILVERLIGHT_ITEM_ID, ItemIdentifiers.SILVERLIGHT_2, ItemIdentifiers.DARKLIGHT];
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
  const SILVERLIGHT_CASE_ACTION_ID = "Y03t9O";
  const DRAIN_VARIANT = "searching-the-drain-near-the-palace-kitchen";
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
  const IGNORE_CLIPPING_FLAG = "movement:ignore-clipping";
  const WEAKENED_DELRITH_TICKS = 100;

  let quest;
  let itemOnGroundManager;
  let pluginApi;

  /** player -> { delrith, weakened, weakenedExpiresAt }; owner-only instanced fight. */
  const demonEncounters = new WeakMap();
  /** Players whose weakened Delrith slipped away: he returns once they leave the circle and come back. */
  const delrithEscaped = new WeakSet();
  /** The public stone circle (DELRITH_ZONE); its leave is what clears delrithEscaped. */
  let delrithCircle;
  const visions = new WeakMap();
  const prysinsAtCase = new WeakSet();

  function later(key, ticks, callback) {
    class SceneTask extends Task {
      constructor() { super(ticks, key, false); }
      execute() { this.stop(); callback(); }
    }
    TaskManager.submit(new SceneTask());
  }

  function fade(player, out) {
    player.getPacketSender().sendSubInterface(FADE_UID, FADE_INTERFACE, 1, {
      postScripts: [{ scriptId: FADE_SCRIPT, args: out ? [0, 255, 0, 0, 50] : [0, 0, 0, 255, 50] }],
    });
  }

  function blankChatbox(player) {
    player.getDialogueManager().reset();
    StatementDialogue.send(player, "", false);
  }

  function restoreAreaSong(player) {
    const at = player.getLocation();
    const track = Music.forRegion(((at.getX() >> 6) << 8) | (at.getY() >> 6));
    if (track !== undefined) player.getPacketSender().sendSong(track);
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
      const fight = demonEncounters.get(this.owner);
      if (this.vision || fight?.summoning) return false;
      // Live: combat stops when Delrith weakens; he is banished by the incantation alone.
      if (fight?.weakened && (attacker === fight.weakened || target === fight.weakened)) return false;
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
        if (!this.vision) {
          mobile.getPacketSender().sendCameraReset();
          restoreAreaSong(mobile);
        }
      }
      super.postLeave(mobile, logout);
    }
  }

  function startVision(player) {
    if (visions.has(player)) return;
    const scene = new DemonSceneArea(player, true);
    visions.set(player, scene);
    setSceneControls(player, true);
    blankChatbox(player);
    fade(player, true);
    later(scene, VISION_FADE_TICKS, () => {
      scene.enter(player);
      player.moveTo(new Location(3225, 3371, 0));
      player.setNpcTransformationId(WALLY_NPC_ID);
      player.getPacketSender().sendSong(SONG_WALLY);
      player.getPacketSender().sendCameraMoveTo(3227, 3369, 300, { rate: 232, rate2: 232 });
      player.getPacketSender().sendCameraLookAt(3229, 3367, 250, { rate: 232, rate2: 232 });
      player.getPacketSender().sendCameraShake(1, 0, 10, 10);
      player.getPacketSender().sendCameraShake(3, 0, 90, 1);
      player.getPacketSender().sendSound(SOUND.cut, 1, 0);
      fade(player, false);
      resumeVision(player, "Wally managed to arrive at the stone circle just as Delrith was summoned by a cult of chaos druids...");
    });
  }

  /** The vision's closing fade; the map returns under the black and the quest starts a tick later. */
  function closeVision(player) {
    const scene = visions.get(player);
    blankChatbox(player);
    fade(player, true);
    later(scene, VISION_END_FADE_TICKS, () => {
      scene.keepFade = true;
      endVision(player);
      later(player, 1, () => {
        if (player.isRegistered?.() === false) return;
        startQuest(player);
        fade(player, false);
        restoreAreaSong(player);
        resumeVision(player, "Delrith will come forth from the stone circle again.");
      });
    });
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
    if (!scene.keepFade) player.getPacketSender().closeSubInterface(FADE_UID);
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

  /** Sir Prysin replaces Silverlight only when the player has it in no form. */
  const ownsSilverlight = (player) => SILVERLIGHT_FORMS.some((itemId) => ownsItem(player, itemId));

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
      if (value.includes("does not have silverlight")) return !ownsSilverlight(player);
      if (value.includes("has silverlight")) return ownsSilverlight(player);
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

  // The scenes resume these transcripts; a normal Talk-to's page list starts with the NPC's own page.
  const LAST_BONES_VARIANT = "getting-the-key-from-traiborn-returning-with-the-last-of-the-bones-to-traiborn";
  const ALL_KEYS_VARIANT = "getting-the-key-from-traiborn-returning-to-sir-prysin-with-all-the-keys";

  function transcriptTail(steps, text) {
    for (let index = 0; index < steps.length; index++) {
      if (steps[index].text === text) return steps.slice(index);
      for (const option of steps[index].options ?? []) {
        const tail = transcriptTail(option.steps ?? [], text);
        if (tail) return tail;
      }
      if (steps[index].steps) {
        const tail = transcriptTail(steps[index].steps, text);
        if (tail) return tail;
      }
    }
    return null;
  }

  function resumeVision(player, text) {
    startTranscript(api, player, ARIS_NPC_ID, "Demon Slayer", "starting-demon-slayer",
      (steps) => transcriptTail(steps, text));
  }

  // The dump keeps wiki placeholders in a few spoken lines; render them.
  function renderDialogueLine(event) {
    const text = String(event.text || "");
    if (text === "Okay, here you go." && (event.npcId === ARIS_NPC_ID || event.npcId === ARIS_LEGACY_NPC_ID) &&
        quest.getStage(event.player) === 0) event.after = () => payAris(event.player);
    if (text === "I gave the other to the wizard Traiborn." && PRYSIN_NPC_IDS.has(event.npcId)) {
      event.after = () => {
        const stage = quest.getStage(event.player);
        if (stage >= STAGE_STARTED && stage < STAGE_KEY_HUNT) quest.setStage(event.player, STAGE_KEY_HUNT);
      };
    }
    if (text.startsWith("Wings of dark and colour too") && event.npcId === TRAIBORN_NPC_ID) playBoneRitual(event);
    if (visions.has(event.player)) {
      if (text === "Die, foul demon!") event.before = () => {
        const player = event.player;
        const scene = visions.get(player);
        scene.running = player.isRunningReturn();
        player.moveTo(new Location(3225, 3363, 0));
        player.setRunning(true);
        player.getPacketSender().sendSound(SOUND.cut, 1, 0);
        TaskManager.submit(new ForceMovementTask(player, 2, new ForceMovement(
          new Location(3225, 3363, 0), new Location(2, 4, 0), 0, 60, 0, 824)));

        later(scene, 4, () => {
          player.getMovementQueue().setBlockMovement(true);
          player.performAnimation(new Animation(ANIMATION.wally));
          player.getPacketSender().sendSound(SOUND.wallyCharge, 1, 10);
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
        event.player.getPacketSender().sendSound(SOUND.cut, 1, 0);
      };
      if (text === "[word 1]... [word 2]... [word 3]... [word 4]... [word 5]!") event.after = () => {
        const scene = visions.get(event.player);
        blankChatbox(event.player);
        fade(event.player, true);
        later(scene, 4, () => {
          if (visions.get(event.player) === scene) resumeVision(event.player, "I am the greatest demon slayer EVER!");
        });
      };
      if (text === "I am the greatest demon slayer EVER!") event.before = () => {
        event.player.getPacketSender().closeSubInterface(FADE_UID);
        event.player.performAnimation(new Animation(ANIMATION.sword));
        event.player.performGraphic(new Graphic(GRAPHIC.glint));
        event.player.getPacketSender().sendSound(SOUND.cut, 1, 0).sendSound(SOUND.glint, 1, 0).sendJingle(DEMON_SLAYER_JINGLE, 0);
        event.player.getPacketSender().sendCameraShake(1, 0, 0, 0);
        event.player.getPacketSender().sendCameraShake(3, 0, 0, 0);
        event.player.getPacketSender().sendCameraMoveTo(3225, 3363, 500, { rate: 232, rate2: 232 });
        event.player.getPacketSender().sendCameraLookAt(3227, 3367, 200, { rate: 232, rate2: 232 });
      };
      if (text.startsWith("By reciting the correct magical incantation")) event.after = () => closeVision(event.player);
    }
    // Capture 1843: the summoners' lines show qip_ds_young_dark_wizard2 (chathap1) for the
    // group and qip_ds_young_dark_wizard1 (chatshock1) for "Who's that?". The cache's first
    // "Dark wizard" (510) has no chathead.
    const summonerHead = SUMMONER_CHATHEADS[event.step?.speaker];
    if (summonerHead) {
      event.speakerId = summonerHead.npcId;
      event.expression = summonerHead.expression;
    }
    const fight = demonEncounters.get(event.player);
    // Capture 1843: all four summoners chant the group line overhead too; on Denath's laugh they
    // stop chanting and turn to Delrith, and on "Who's that?" the young wizards turn to the player.
    if (fight?.summoning && text === "Arise, Delrith!") {
      event.before = () => fight.actors.forEach((actor) => actor.forceChat(text));
    }
    if (fight?.summoning && text.startsWith("Ha ha ha! At last you are free")) {
      event.before = () => {
        for (const actor of fight.actors) {
          actor.performAnimation(new Animation(-1));
          actor.setPositionToFace(WIZARDS_TILE);
        }
        fight.delrith?.setPositionToFace(DENATH_TILE);
      };
    }
    if (fight?.summoning && text === "Who's that?") {
      event.before = () => fight.actors
        .filter((actor) => actor.getId?.() !== DENATH_NPC_ID)
        .forEach((actor) => actor.setPositionToFace(event.player.getLocation().clone()));
    }
    // Capture 1843 (10135-10145): Denath walks off east, the young wizards spread out and the
    // first one attacks the player at once, whatever their level.
    if (fight?.summoning && text.startsWith("I've got to get out of here")) {
      event.before = () => {
        event.player.getPacketSender().sendCameraMoveTo(3226, 3383, 1000, { rate: 1, rate2: 1 });
        fight.actors.at(-1)?.getMovementQueue().addSteps(DENATH_EXIT_TILE);
      };
      event.after = () => endSummoning(event.player, fight);
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
  function handleDialogueChoice({ player, npcId, option }) {
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
    endVision(player);
    startQuest(player);
  }

  function startQuest(player) {
    if (quest.getStage(player) >= STAGE_STARTED) return;
    quest.setStage(player, STAGE_STARTED);
    sendIncantation(player);
    player.sendMessage("You've started a new quest: <col=0ab0ff>Demon Slayer</col>");
  }

  /** The coin leaves as the player finishes saying "Okay, here you go." (capture 1723, 10369). */
  function payAris(player) {
    if (!hasItem(player, COINS_ITEM_ID)) return;
    player.getInventory().deleteNumber(COINS_ITEM_ID, 1);
    player.getPacketSender().sendSound(SOUND.coin, 1, 0);
  }

  function warnBeforeStart(event) {
    if (String(event.prompt).includes("Start the Demon Slayer quest") && event.player.getSkillManager().getCombatLevel() < RECOMMENDED_COMBAT_LEVEL) {
      event.warning = `Before starting this quest, be aware that your combat level is lower than the recommended level of ${RECOMMENDED_COMBAT_LEVEL}.`;
    }
  }

  /** Traiborn's ritual: the wardrobe appears as he chants, and he hands the key over 4 ticks after Continue. */
  function playBoneRitual(event) {
    const { player, npc } = event;
    const wardrobe = new GameObject(ObjectIdentifiers.WARDROBE_13, WARDROBE_TILE, 11, 3, null);
    event.before = () => {
      npc?.setPositionToFace(WARDROBE_TILE);
      npc?.performAnimation(new Animation(ANIMATION.boneRitual));
      npc?.performGraphic(new Graphic(GRAPHIC.boneRitual));
      ObjectManager.register(wardrobe, true);
      player.getPacketSender().sendSound(SOUND.boneRitual, 1, 0);
    };
    event.after = () => {
      player.getDialogueManager().reset();
      player.getPacketSender().sendSound(SOUND.wardrobe, 1, 0).sendInterfaceRemoval();
      later(wardrobe, 2, () => {
        npc?.performAnimation(new Animation(ANIMATION.openCloset));
        player.getPacketSender().sendSound(SOUND.closet, 1, 0);
      });
      later(wardrobe, 4, () => {
        wardrobe.performAnimation(new Animation(ANIMATION.wardrobeGone));
        npc?.setMobileInteraction(player);
        player.getPacketSender().sendSound(SOUND.wardrobeGone, 1, 0);
        if (player.isRegistered?.() === false) return;
        startTranscript(api, player, TRAIBORN_NPC_ID, "Demon Slayer", LAST_BONES_VARIANT, (steps) => transcriptTail(steps, "Traiborn hands you a key."), npc);
      });
      later(wardrobe, WARDROBE_TICKS, () => ObjectManager.deregister(wardrobe, true));
    };
  }

  /** Prysin walks to the case, opens it and presents the sword (capture 1843, 10049-10066). */
  function playSilverlightCase(event) {
    const { player, npc, npcId } = event;
    if (!npc || !hasAllKeys(player) || ownsItem(player, SILVERLIGHT_ITEM_ID) || prysinsAtCase.has(npc)) return false;
    prysinsAtCase.add(npc);
    const sender = player.getPacketSender();
    const scene = {};
    player.getDialogueManager().reset();
    sender.sendInterfaceRemoval();
    player.getMovementQueue().reset().setBlockMovement(true);
    npc.getMovementCoordinator().setRadius(0);
    npc.setMobileInteraction(null);
    npc.getMovementQueue().reset().addSteps(PRYSIN_CASE_APPROACH_TILE);
    later(scene, 2, () => { npc.moveTo(SILVERLIGHT_CASE_TILE); player.moveTo(PRYSIN_CASE_APPROACH_TILE); });
    later(scene, 3, () => { npc.setPositionToFace(PRYSIN_CASE_FACE_TILE); player.setPositionToFace(PRYSIN_CASE_FACE_TILE); });
    later(scene, 4, () => { npc.performAnimation(new Animation(ANIMATION.prysinOpens, 19)); sender.sendSound(SOUND.caseKey, 1, 19); });
    later(scene, 9, () => {
      new GameObject(SILVERLIGHT_CASE_LOC_ID, SILVERLIGHT_CASE_TILE, 4, 3, null).performAnimation(new Animation(ANIMATION.caseOpens));
      sender.sendSound(SOUND.caseOpens, 1, 0);
    });
    later(scene, 12, () => {
      sender.sendVarbit(VARBIT_SILVERLIGHT_CASE, 1);
      npc.setNpcTransformationId(NpcIdentifiers.SIR_PRYSIN_2);
      npc.performAnimation(new Animation(ANIMATION.prysinTakes));
    });
    later(scene, 15, () => { npc.setMobileInteraction(player); npc.performAnimation(new Animation(ANIMATION.prysinPresents)); });
    later(scene, 16, () => npc.performAnimation(new Animation(ANIMATION.prysinHolds)));
    later(scene, 17, () => {
      prysinsAtCase.delete(npc);
      npc.setNpcTransformationId(-1);
      npc.performAnimation(new Animation(ANIMATION.prysinGives));
      npc.getMovementCoordinator().setRadius(PRYSIN_WANDER_RADIUS);
      player.getMovementQueue().setBlockMovement(false);
      if (player.isRegistered?.() === false) return;
      startTranscript(api, player, npcId, "Demon Slayer", ALL_KEYS_VARIANT, (steps) => transcriptTail(steps, "Sir Prysin hands you a very shiny sword."), npc);
    });
    return true;
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
      }, true)));
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
        event.box = { items: [ROVIN_KEY_ITEM_ID] };
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
        event.text = `You give Traiborn ${available} set${available === 1 ? "" : "s"} of bones.`;
        event.box = { statement: true };
        event.handled = true;
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
          event.box = { items: [TRAIBORN_KEY_ITEM_ID] };
        }
        return; // leave "Traiborn hands you a key." to play
      }
      return;
    }

    if (PRYSIN_NPC_IDS.has(npcId)) {
      if (stepId === SILVERLIGHT_CASE_ACTION_ID) {
        if (playSilverlightCase(event)) event.handled = true;
        return;
      }
      if (stepId === SILVERLIGHT_MESSAGE_ID) {
        if (!ownsSilverlight(player) && hasAllKeys(player)) {
          player.getInventory().deleteNumber(TRAIBORN_KEY_ITEM_ID, 1);
          player.getInventory().deleteNumber(ROVIN_KEY_ITEM_ID, 1);
          player.getInventory().deleteNumber(PRYSIN_KEY_ITEM_ID, 1);
          player.getInventory().adds(SILVERLIGHT_ITEM_ID, 1);
          quest.setStage(player, STAGE_SILVERLIGHT);
          player.getPacketSender().sendVarbit(VARBIT_SILVERLIGHT_CASE, 1);
          player.performAnimation(new Animation(ANIMATION.sword));
          player.performGraphic(new Graphic(GRAPHIC.glint));
          player.getPacketSender().sendSound(SOUND.glint, 1, 0);
          setDrainState(player, 3);
          event.box = { items: [SILVERLIGHT_ITEM_ID] };
        }
        return; // leave the transcript's own message to play
      }
      if (stepId === PRYSIN_SELL_SILVERLIGHT_ACTION_ID) {
        if (
          player.getInventory().getAmount(COINS_ITEM_ID) >= 500 &&
          !ownsSilverlight(player) &&
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
      (steps) => steps[1].options[0].steps.slice(1), event.target);
  }

  // The lost-Silverlight branch of the pre-fight dialogue gives it back.
  function restoreSilverlightCondition({ player, npcId, stepId }) {
    if (!PRYSIN_NPC_IDS.has(npcId) || stepId !== PRYSIN_LOST_SILVERLIGHT_CONDITION_ID) return;
    if (ownsSilverlight(player) || player.getInventory().isFull()) return;
    player.getInventory().adds(SILVERLIGHT_ITEM_ID, 1);
    if (quest.getStage(player) < STAGE_SILVERLIGHT) quest.setStage(player, STAGE_SILVERLIGHT);
    player.sendMessage("Sir Prysin returns Silverlight.");
  }

  // Kitchen drain: search it, or pour a bucket of water to wash the key down.
  function searchDrain(event) {
    if (!DRAIN_LOC_IDS.has(event.objectId)) return;
    const { player } = event;
    if (keyIsInDrain(player)) startTranscript(api, player, ARIS_NPC_ID, "Demon Slayer", DRAIN_VARIANT);
    else player.sendMessage("Nothing interesting seems to have been dropped down here today.");
    event.handled = true;
  }

  /** Wiki: outside the quest, and once washed down, the drain holds nothing. */
  function keyIsInDrain(player) {
    const stage = quest.getStage(player);
    return stage >= STAGE_KEY_HUNT && stage < STAGE_SILVERLIGHT && drainState(player) !== 2 &&
      !hasItem(player, PRYSIN_KEY_ITEM_ID) && !bankHasItem(player, PRYSIN_KEY_ITEM_ID);
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
    player.performAnimation(new Animation(ANIMATION.pour));
    player.getPacketSender().sendSound(SOUND.pour, 1, 0).sendSound(SOUND.pourClink, 1, 0);
    event.handled = true;
    if (!keyIsInDrain(player)) return;
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
      // Wiki: taken too long, Delrith is gone until the player leaves and comes back. The fight's
      // private scene reaches past the circle; a player outside it has already left. One inside
      // is put straight back in the circle, so the exit that clears the mark is the one seen.
      const inCircle = inDelrithZone(player.getLocation());
      clearDemonEncounter(player);
      if (inCircle && delrithCircle) {
        delrithEscaped.add(player);
        delrithCircle.enter(player);
        player.setArea(delrithCircle);
      }
      return;
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
    if (delrithEscaped.has(player)) return;
    const tracked = demonEncounters.get(player);
    if (tracked?.summoning || tracked?.delrith || tracked?.weakened || tracked?.banished) return;
    if (tracked) { summonDelrith(player); return; }
    const arena = new DemonSceneArea(player, false);
    arena.enter(player);
    const fight = { arena, actors: [], summoning: true };
    demonEncounters.set(player, fight);
    setSceneControls(player, true);
    for (const [id, x, y, faceX, faceY] of SUMMONERS) {
      const actor = api.spawnNpc({ id, x, y, z: 0, wanderRadius: 0, owner: player, ownerOnly: true });
      if (!actor) continue;
      arena.enter(actor);
      actor.setPositionToFace?.(new Location(faceX, faceY, 0));
      actor.performAnimation(new Animation(ANIMATION.chant));
      fight.actors.push(actor);
    }
    player.getPacketSender().sendSong(SONG_DELRITH);
    player.getPacketSender().sendCameraMoveTo(3224, 3376, 475, { rate: 232, rate2: 232 });
    player.getPacketSender().sendCameraLookAt(3227, 3369, 300, { rate: 232, rate2: 232 });
    player.getPacketSender().sendCameraMoveTo(3231, 3376, 475, { rate: 1, rate2: 1 });
    startTranscript(api, player, DENATH_NPC_ID, "Demon Slayer", "the-final-battle");
  }

  function summonDelrith(player) {
    const tracked = demonEncounters.get(player);
    if (!tracked || tracked.delrith || tracked.weakened) return;
    if (tracked.summoning) {
      const placeTable = (id) => {
        const table = new GameObject(id, STONE_TABLE_TILE, 10, 0, tracked.arena);
        ObjectManager.register(table, true);
        return table;
      };
      const table = placeTable(ObjectIdentifiers.STONE_TABLE_2);
      later(tracked, 1, () => table.performAnimation(new Animation(ANIMATION.tableExplosion)));
      later(tracked, 6, () => placeTable(ObjectIdentifiers.STONE_TABLE_3));
      later(tracked, 11, () => placeTable(ObjectIdentifiers.STONE_TABLE_4));
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
    player.getPacketSender().sendSound(SOUND.spell, 1, 0).sendSound(SOUND.tableExplosion, 1, 0);
    player.getPacketSender().sendCameraLookAt(3227, 3369, 100, { rate: 232, rate2: 232 });
    player.getPacketSender().sendCameraMoveTo(3227, 3365, 500, { rate: 232, rate2: 232 });
    later(tracked, 2, () => player.getPacketSender().sendCameraShake(0, 15));
    later(tracked, 3, () => player.getPacketSender().sendCameraShake(0, 0));
    later(tracked, 6, () => {
      spawn();
      player.getPacketSender().sendSound(SOUND.delrithRising, 1, 10).sendSound(SOUND.delrithArrives, 1, 0);
      player.getPacketSender().sendCameraLookAt(3227, 3369, 400, { rate: 1, rate2: 1 });
    });
    // Live: Delrith walks off the altar to 3227,3367 before "Who's that?". He rises on the 2x2
    // table, whose clipping blocks every step his 2x2 footprint takes, so these two steps go
    // over it, as an NPC walks the map without collision (MovementQueue IGNORE_CLIPPING_FLAG).
    later(tracked, 12, () => {
      tracked.delrith?.setFlag?.(IGNORE_CLIPPING_FLAG, true);
      tracked.delrith?.getMovementQueue().addSteps(new Location(3227, 3368, 0));
    });
    later(tracked, 15, () => tracked.delrith?.setFlag?.(IGNORE_CLIPPING_FLAG, false));
    later(tracked, 13, () => {
      tracked.delrith?.getMovementQueue().addSteps(new Location(3227, 3367, 0));
      player.getPacketSender().sendCameraMoveTo(3226, 3375, 500, { rate: 232, rate2: 232 });
      player.getPacketSender().sendCameraLookAt(3227, 3367, 300, { rate: 232, rate2: 232 });
    });
  }

  /** Denath keeps walking off; the young wizards loosen up and the first turns on the player (1843, 10135). */
  function endSummoning(player, fight) {
    fight.summoning = false;
    TaskManager.cancelTasks(fight);
    const wizards = fight.actors.slice(0, -1);
    for (const wizard of wizards) wizard.getMovementCoordinator().setRadius(WIZARD_WANDER_RADIUS);
    wizards[0]?.getCombat().attack(player);
    player.getPacketSender().sendVarbit(VARBIT_SUMMONING_SEEN, 1);
    player.getPacketSender().sendCameraReset();
    setSceneControls(player, false);
  }

  function spawnWeakenedDelrith(player, npc) {
    const tracked = demonEncounters.get(player);
    player.getPacketSender().sendSound(SOUND.delrithWeakened, 1, 0);
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

  /**
   * Delrith never dies: killing him swaps in the weakened form to be banished, and a hit
   * already on its way to the weakened form (its id is then 5080) leaves him at 1 hitpoint.
   */
  function handleDelrithBeforeDeath(event) {
    const npc = event?.npc;
    const owner = npc?.getOwner?.();
    if (!owner || quest.getStage(owner) !== STAGE_SILVERLIGHT) return;
    const tracked = demonEncounters.get(owner);
    if (!tracked) return;
    if (tracked.actors?.includes(npc)) {
      tracked.wizardsKilled = (tracked.wizardsKilled ?? 0) + 1;
      owner.getPacketSender().sendVarbit(VARBIT_DARK_WIZARDS_KILLED, tracked.wizardsKilled);
      return;
    }
    // A hit already on its way can land on the weakened form; he is banished, never killed.
    if (tracked.weakened === npc) {
      npc.setHitpoints(1);
      event.preventDeath = true;
      return;
    }
    if (npc.getId?.() !== DELRITH_NPC_ID || tracked.delrith !== npc) return;
    spawnWeakenedDelrith(owner, npc);
    event.preventDeath = true;
  }

  function chooseIncantation(player, npc, selected) {
    const tracked = demonEncounters.get(player);
    if (!tracked || tracked.weakened !== npc) return;
    if (selected.every((word, index) => word === INCANTATION_WORDS[incantationOrder(player)[index]])) {
      tracked.weakenedExpiresAt = undefined;
      tracked.banished = true;
      setSceneControls(player, true);
      npc.performAnimation(new Animation(ANIMATION.banished));
      player.getPacketSender().sendSound(SOUND.vortex, 1, 10);
      player.getDialogueManager().reset();
      StatementDialogue.send(player, "Delrith is sucked into the vortex...", false);
      later(tracked, VORTEX_TICKS, () => {
        api.removeNpc(npc);
        tracked.weakened = null;
        player.getPacketSender().sendVarbit(VARBIT_SUMMONING_SEEN, 0);
        player.getPacketSender().sendSound(SOUND.vortexCloses, 1, 0);
        player.getDialogueManager().startDialogues(new DialogueChainBuilder()
          .add(new StatementDialogue(0, "...back into the dark dimension from which he came."))
          .add(new ActionDialogue(1, { execute: () => finishBanishment(player) })));
      });
      return;
    }
    player.getDialogueManager().startDialogues(new DialogueChainBuilder()
      .add(new StatementDialogue(0, "The vortex collapses. That was the wrong incantation.")));
    npc.setNpcTransformationId(-1);
    npc.setHitpoints(npc.getDefinition().getHitpoints());
    tracked.weakened = null;
    tracked.delrith = npc;
  }

  function finishBanishment(player) {
    clearDemonEncounter(player);
    player.moveTo(new Location(3226, 3368, 0));
    player.performAnimation(new Animation(ANIMATION.sword));
    player.performGraphic(new Graphic(GRAPHIC.glint));
    player.getPacketSender().sendSound(SOUND.glint, 1, 0);
    quest.complete(player);
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
      options.push(word, () => sayIncantationWord(player, npc, [...selected, word]));
    }
    api.sendMultiChatboxPrompt(player, "Select a word", ...options);
  }

  /**
   * Capture 1843 (10178-10209): a tick after a word is picked, the player says it overhead
   * ("Gabindo...", the last with "!") and in a chatbox with no Continue; the next "Select a word",
   * or the vortex after the last, comes three ticks after that.
   */
  function sayIncantationWord(player, npc, selected) {
    const tracked = demonEncounters.get(player);
    if (!tracked || tracked.weakened !== npc) return;
    const spoken = selected.at(-1) + (selected.length === INCANTATION_WORDS.length ? "!" : "...");
    player.getPacketSender().sendInterfaceRemoval();
    later(tracked, 1, () => {
      player.forceChat(spoken);
      player.getDialogueManager().reset();
      new PlayerDialogue(0, spoken).send(player);
      player.getPacketSender().sendString("", PLAYER_DIALOGUE_CONTINUE_UID).sendInterfaceFlagsRange(PLAYER_DIALOGUE_CONTINUE_UID, -1, -1, 0);
      later(tracked, INCANTATION_WORD_TICKS, () => promptIncantation(player, npc, selected));
    });
  }

  function inDelrithZone(location) {
    return DELRITH_ZONE.levels.includes(location.getZ()) &&
      location.getX() >= DELRITH_ZONE.minX && location.getX() <= DELRITH_ZONE.maxX &&
      location.getY() >= DELRITH_ZONE.minY && location.getY() <= DELRITH_ZONE.maxY;
  }

  class DelrithArea extends Area {
    process(mobile) {
      if (mobile.isPlayer()) handlePlayerProcess({ player: mobile });
    }
    postLeave(mobile) {
      if (mobile.isPlayer?.()) delrithEscaped.delete(mobile);
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
    event.player.getDialogueManager().startDialogues(new DialogueChainBuilder()
      .add(new ItemStatementDialogue(0, PRYSIN_KEY_ITEM_ID, "You pick up an old rusty key.")));
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
    completionJingleId: DEMON_SLAYER_JINGLE,
    buildJournal,
  });

  itemOnGroundManager = api.getItemOnGroundManager();
  pluginApi = api;
  api.persistAttribute(DRAIN_ATTRIBUTE, 0);
  api.persistAttribute(INCANTATION_ATTRIBUTE);

  api.onNpcDialogueVariant(selectDialogueVariant);
  api.onNpcDialogueCondition(answerDialogueCondition);
  api.onCustomEvent("npc-dialogue:menu", warnBeforeStart);
  api.onCustomEvent("npc-dialogue:line", renderDialogueLine);
  api.onCustomEvent("npc-dialogue:choice", handleDialogueChoice);
  api.onCustomEvent("npc-dialogue:hook", handleDialogueHook);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("npc-dialogue:condition", restoreSilverlightCondition);
  api.onItemOnNpc(handBonesToTraiborn);
  api.onGroundItemPickup(handleSewerKeyPickup);

  // Delrith: owner-only summon in the stone circle, weaken then banish.
  delrithCircle = new DelrithArea([new Boundary(DELRITH_ZONE.minX, DELRITH_ZONE.maxX, DELRITH_ZONE.minY, DELRITH_ZONE.maxY, 0)]);
  api.registerArea(delrithCircle);
  api.onNpcBeforeDeath(handleDelrithBeforeDeath);
  api.onNpcInteraction("Weakened Delrith", { Banish: banishWeakenedDelrith });

  // Kitchen drain: search it, or pour a bucket of water to wash the key down.
  api.onObjectInteraction("Drain", { Search: searchDrain });
  api.onItemOnObject(pourWaterOnDrain, { noted: false });

  api.onPlayerLogin(handlePlayerLogin);
  api.onPlayerLogout(handlePlayerLogout);
  api.onPlayerMapSquareChange(ensureSewerKeyOnMapChange);
};
