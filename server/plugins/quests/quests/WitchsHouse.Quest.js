/**
 * Witch's House (members).
 *
 * The words come from the "Witch's House" and "Boy" transcript pages; the Boy is
 * indexed, so this plugin selects his variant by stage, answers the combat-level
 * gate, runs the start hook and turns the final "Quest complete!" action into the
 * ball hand-in. The garden items (door key, magnet, shed key, diary) and the
 * shapeshifter are driven by object/item interactions.
 *
 * Stages (varp 226): 1 started, 2 magnet found, 3 back door unlocked, 5 diary
 * read, 6 experiment defeated, 7 complete.
 *
 * Live reference: RSProx capture 20261108T030409 (rev 242), the whole quest with four catches;
 * tick numbers below are from it. The doors and the basement gate are Doors.plugin
 * pass-through gates; this plugin only refuses them (door:toggle) and spawns the shapeshifter on
 * the way into the shed. Nora is never seen to change the stage: a catch only costs the ball and
 * the shed key, and the hand-in takes only the ball.
 *
 * The diary (2408) and ball (2407) are world ground spawns from the data definitions; this
 * plugin only consumes/reads them. The basement boxes supply in-quest leather gloves; the
 * east-room boxes are reachable straight after the ladder, so the pair can be found before the
 * electric gate.
 *
 * Nora walks the garden's middle row, 2904-2930 on y 3463, a tile a tick, turning at both ends
 * without a pause (turnarounds at ticks 90, 116, 461, 572). She sees a player at most 3 tiles away
 * when no tall hedge (a projectile-blocking tile) stands on the line between them, or between the
 * player and her row; the low hedge stretches don't hide anyone. That rule matches all 281 garden
 * ticks of the capture, the four catches included, whichever way she walks.
 *
 * The cache item is named SHED_KEY (4186) but the quest's shed key is 2411, exposed here as
 * ItemIdentifiers.KEY_9.
 */
module.exports = function registerWitchsHouseQuest(api) {
  const {
    Skill,
    Item,
    Location,
    Area,
    Boundary,
    Animation,
    Graphic,
    Projectile,
    Sound,
    Sounds,
    HitDamage,
    HitMask,
    GameObject,
    ObjectManager,
    CountdownTask,
    RegionManager,
    TaskManager,
    DialogueChainBuilder,
    ItemStatementDialogue,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
    World,
  } = api.core;
  const { registerQuest, startTranscript, refreshQuestList, openBook } = require("../QuestRuntime");

  const PAGE = "Witch's House";
  const BOY_NPC_ID = NpcIdentifiers.BOY; // 3994
  const MOUSE_NPC_ID = NpcIdentifiers.MOUSE; // 4000
  const EXPERIMENT_NPC_IDS = [
    NpcIdentifiers.WITCHS_EXPERIMENT,
    NpcIdentifiers.WITCHS_EXPERIMENT_SECOND_FORM_,
    NpcIdentifiers.WITCHS_EXPERIMENT_THIRD_FORM_,
    NpcIdentifiers.WITCHS_EXPERIMENT_FOURTH_FORM_,
  ];

  const VARP_WITCHS_HOUSE = 226;
  const STAGE_STARTED = 1;
  const STAGE_FOUND_MAGNET = 2;
  const STAGE_UNLOCKED_BACK_DOOR = 3;
  const STAGE_READ_DIARY = 5;
  const STAGE_DEFEATED_EXPERIMENT = 6;
  const STAGE_COMPLETE = 7;

  const BALL_ITEM_ID = ItemIdentifiers.BALL;
  const DIARY_ITEM_ID = ItemIdentifiers.DIARY;
  const DOOR_KEY_ITEM_ID = ItemIdentifiers.DOOR_KEY;
  const MAGNET_ITEM_ID = ItemIdentifiers.MAGNET;
  const SHED_KEY_ITEM_ID = ItemIdentifiers.KEY_9; // 2411 (SHED_KEY is 4186)
  const CHEESE_ITEM_ID = ItemIdentifiers.CHEESE;
  const GLOVES_ITEM_ID = ItemIdentifiers.LEATHER_GLOVES;

  const FRONT_DOOR_LOC_ID = ObjectIdentifiers.DOOR_102;
  const BACK_DOOR_LOC_ID = ObjectIdentifiers.DOOR_103;
  const SHED_DOOR_LOC_ID = ObjectIdentifiers.DOOR_104;
  const FOUNTAIN_LOC_ID = ObjectIdentifiers.FOUNTAIN_4;
  const GATE_LOC_IDS = new Set([ObjectIdentifiers.GATE_66, ObjectIdentifiers.GATE_67]);
  const POTTED_PLANT_LOC_ID = ObjectIdentifiers.POTTED_PLANT_3;
  const CUPBOARD_SHUT_LOC_ID = ObjectIdentifiers.CUPBOARD_24; // magnetcbshut: Open
  const CUPBOARD_OPEN_LOC_ID = ObjectIdentifiers.CUPBOARD_25; // magnetcbopen: Search, Shut
  // 2870 has no ObjectIdentifiers constant; the other two are named.
  const MOUSE_HOLE_LOC_IDS = new Set([2870, ObjectIdentifiers.MOUSE_HOLE, ObjectIdentifiers.MOUSE_HOLE_2]);
  const LADDER_DOWN_LOC_ID = ObjectIdentifiers.LADDER_322;
  const LADDER_UP_LOC_ID = ObjectIdentifiers.LADDER_321;
  const BOXES_LOC_ID = 24692; // Boxes; no ObjectIdentifiers entry.
  const FULL_INVENTORY_MESSAGE = "You couldn't hold all those items.";
  /** Cache Boxes (24692) placements in the witch's house basement. */
  const BASEMENT_BOXES = [
    { x: 2899, y: 9871 }, // west room, behind the electric gate
    { x: 2899, y: 9872 },
    { x: 2900, y: 9872 },
    { x: 2905, y: 9872 }, // east room, the ladder drops into it
    { x: 2906, y: 9872 },
    { x: 2908, y: 9873 },
  ];
  /** The gate column splits the basement; the west room holds the cupboard. */
  const basementRoom = (x) => (x <= 2902 ? "west" : "east");

  /** Live tiles: the front door's outside is west of x 2901, the garden south of y 3466, the shed east of x 2933. */
  const HOUSE_INSIDE_MIN_X = 2901;
  const GARDEN_MAX_Y = 3465;
  const SHED_INSIDE_MIN_X = 2934;

  const MOUSE_TILE = { x: 2903, y: 3466, z: 0 };
  const EXPERIMENT_TILE = { x: 2935, y: 3462, z: 0 };
  const BALL_SPAWN_TILE = { x: 2935, y: 3460, z: 0 };
  /** Ladder landings (ticks 189 and 263). */
  const BASEMENT_TILE = { x: 2906, y: 9876, z: 0 };
  const GROUND_FLOOR_TILE = { x: 2906, y: 3476, z: 0 };

  /** Live animations and sounds (gamevals in comments). */
  const PICKUP_FLOOR_ANIMATION = 827; // human_pickupfloor: plant pot (132), cheese on the hole (307)
  const OPEN_CUPBOARD_ANIMATION = 542; // human_openhighcupboard (222)
  const READ_BOOK_ANIMATION = 1350; // human_readbook (357)
  const CUPBOARD_OPEN_SOUND = 58; // cupboard_open (222)
  const GATE_SHOCK_SOUND = 575; // killerwatt_ball_attack (204)
  /** The shock lands a tick after the message (204 -> 205): 13 at 69 Hitpoints here, 19 at 99 in rev 233. */
  const GATE_SHOCK_DELAY = 1;
  const GATE_SHOCK_FRACTION = 0.2;
  const CUPBOARD_OPEN_DELAY = 1;
  /** The mouse runs out a tick after the cheese goes down (307 -> 308). */
  const MOUSE_DELAY = 1;
  /** The glare drains 1 + 6% of the current Attack, Strength and Defence (78/75/71 -> 73/70/66, 72/69/65 -> 67/64/61). */
  const GLARE_DRAIN_BASE = 1;
  const GLARE_DRAIN_PERCENT = 6;

  const NORA_NPC_ID = NpcIdentifiers.NORA_T_HAGG;
  const NORA_ROW = 3463;
  const NORA_WEST_X = 2904;
  const NORA_EAST_X = 2930;
  const NORA_SIGHT = 3;
  /** Catch (ticks 409-415, 513-519, 952-958, 1010-1016): shout, cast two ticks later, teleport four after that. */
  const CAUGHT_CAST_TICKS = 2;
  const CAUGHT_TELEPORT_TICKS = 6;
  const NORA_CAST_GRAPHIC = 108; // curse_casting, height 92
  const NORA_CAST_GRAPHIC_HEIGHT = 92;
  const NORA_CURSE_PROJECTILE = 109; // curse_travel
  const NORA_CURSE_START = 61;
  const NORA_CURSE_END = 100;
  const NORA_CURSE_ANGLE = 16;
  const NORA_CURSE_PROGRESS = 128;
  const NORA_CURSE_HEIGHT = 124;
  const NORA_CURSE_IMPACT_GRAPHIC = 110; // curse_impact, delay 100, height 124
  const NORA_CAST_SOUND = 127; // curse_cast_and_fire, area range 10
  const NORA_HIT_SOUND = 126; // curse_hit, delay 100
  const NORA_SOUND_RADIUS = 10;
  /** Beside the Boy (2928,3456). */
  const CAUGHT_TILE = { x: 2929, y: 3456, z: 0 };

  /** Witches' Diary: the book 392 spreads as captured (ticks 357-361), keyed by text component. */
  const DIARY_TITLE = "Witches' Diary";
  const DIARY_PAGES = [
    {
      44: "<col=ff0000>2nd of Pentember", 45: "Experiment is growing larger", 46: "daily. Making excellent",
      47: "progress now. I am", 48: "currently feeding it on a", 49: "mixture of fungus, tar and", 50: "clay.",
      51: "It seems to like this", 52: "combination a lot!",
      60: "<col=ff0000>3rd of Pentember", 61: "Experiment still going", 62: "extremely well. Moved it to",
      63: "the wooden garden shed; it", 64: "does too much damage in the", 65: "house! It is getting very",
      66: "strong now, but", 67: "unfortunately is not too", 68: "intelligent yet. It has a really",
      69: "mean stare too!", 70: "<col=ff0000>4th of Pentember", 71: "Sausages for dinner tonight!",
      72: "Lovely!", 74: "<col=ff0000>5th of Pentember",
    },
    {
      44: "A guy called Professor", 45: "Oddenstein installed a new", 46: "security system for me in",
      47: "the basement. He seems to", 48: "have a lot of good security", 49: "ideas.",
      60: "<col=ff0000>6th of Pentember", 61: "Don't want people getting", 62: "into my back garden to see",
      63: "the experiment. Professor", 64: "Oddenstein is fitting me a", 65: "new security system, after",
      66: "his successful installation in", 67: "the cellar.",
    },
    {
      44: "<col=ff0000>7th of Pentember", 45: "That pesky kid keeps kicking", 46: "his ball into my garden. I",
      47: "swear, if he does it AGAIN,", 48: "I'm going to lock his ball", 49: "away in the shed.",
      51: "<col=ff0000>8th of Pentember", 52: "The security system is done.", 53: "By Zamorak! Wow, is it",
      54: "contrived! Now, to open my", 55: "own back door, I lure a", 56: "mouse out of a hole in the",
      57: "back porch, I fit a magic", 58: "curved piece of metal to the",
      60: "harness on its back, the", 61: "mouse goes back in the hole,", 62: "and the door unlocks! The",
      63: "prof tells me that this is", 64: "cutting edge technology! As", 65: "an added precaution I have",
      66: "hidden the key to the shed in", 67: "a secret compartment of the", 68: "fountain in the garden. No",
      69: "one will ever look there!", 71: "<col=ff0000>9th of Pentember", 72: "Still can't think of a good",
      73: "name for 'The Experiment'.", 74: "Leaning towards 'Fritz'...",
    },
    { 44: "Although am considering", 45: "Lucy as it reminds me of", 46: "my mother!" },
  ];

  const START_HOOK = "quest:witch-s-house:start";
  const COMPLETE_ACTION_ID = "uyv8q6";

  /** Live objectbox (193) lines, each with the item it shows. */
  const FOUND_DOOR_KEY = "You find a key hidden under the flower pot.";
  const FOUND_MAGNET = "You find a magnet in the cupboard.";
  const FOUND_SHED_KEY = "You search for the secret compartment mentioned in the diary. Inside it you find a small key. You take the key.";
  const HAVE_SHED_KEY = "You already have the key that was in the secret compartment in this fountain.";
  /** Game messages as each form dies (ticks 712, 775, 823, 886). */
  const FORM_MESSAGES = [
    ["The shapeshifters' body begins to deform!", "The shapeshifter turns into a spider!"],
    ["The shapeshifters' body begins to twist!", "The shapeshifter turns into a bear!"],
    ["The shapeshifters' body pulses!", "The shapeshifter turns into a wolf!"],
    ["You finally kill the shapeshifter once and for all."],
  ];

  let quest;
  let itemOnGroundManager;
  const experimentByPlayer = new Map();
  const mouseByPlayer = new Map();

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
  const wearingGloves = (player) =>
    player.getEquipment().get(api.core.Equipment.HANDS_SLOT)?.getId?.() === GLOVES_ITEM_ID;
  function later(key, ticks, fn) {
    TaskManager.submit(new CountdownTask(key, ticks, fn));
  }

  function objectBox(player, itemId, text) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text)));
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage <= 0) {
      return [
        "I can start this quest by speaking to the <col=800000>little boy</col>",
        "standing by the long garden just <col=800000>north of Taverley</col>.",
        "",
        "I must be able to defeat a <col=800000>level 53 enemy</col>.",
      ];
    }
    const history = [
      "<str>A small boy kicked his ball into the nearby garden.</str>",
      "<str>I agreed to retrieve it for him.</str>",
      "",
    ];
    if (stage === STAGE_STARTED) {
      return [...history, "I should find a way into the <col=800000>garden</col> where the ball is."];
    }
    if (stage === STAGE_FOUND_MAGNET) {
      return [...history, "I found a <col=800000>magnet</col> in a basement cupboard."];
    }
    if (stage >= STAGE_UNLOCKED_BACK_DOOR && stage < STAGE_DEFEATED_EXPERIMENT) {
      return [
        ...history,
        "<str>I found a magnet in a basement cupboard.</str>",
        "<str>I worked out how to unlock the back door to the garden.</str>",
        "",
        "The boy's ball is locked in the <col=800000>garden shed</col>.",
      ];
    }
    if (stage === STAGE_DEFEATED_EXPERIMENT) {
      return [
        ...history,
        "Now the <col=800000>shapeshifter</col> is dead, I should return the boy's <col=800000>ball</col>.",
      ];
    }
    return [
      ...history,
      "<str>I defeated the witch's strange experiment.</str>",
      "<str>I returned the child's ball to him.</str>",
      "",
      "<col=ff0000>QUEST COMPLETE!</col>",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.HITPOINTS, 6325);
  }

  function selectVariant({ npcId, player }) {
    if (npcId !== BOY_NPC_ID) return null;
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return { page: "Boy", variant: "after-witch-s-house" };
    if (stage >= STAGE_STARTED && held(player, BALL_ITEM_ID)) return "finishing-up";
    if (stage >= STAGE_STARTED) return "getting-started-talking-to-him-again";
    return "getting-started";
  }

  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    if (value.includes("below level 10 combat")) {
      return (player?.getSkillManager?.().getCombatLevel?.() ?? 10) < 10;
    }
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== BOY_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  /** The speech's "Quest complete!" action takes the ball only; the keys and diary stay (tick 1253). */
  function handleAction({ player, npcId, stepId }) {
    if (npcId !== BOY_NPC_ID || stepId !== COMPLETE_ACTION_ID) return;
    if (!held(player, BALL_ITEM_ID) || quest.isComplete(player)) return;
    player.getInventory().deleteNumber(BALL_ITEM_ID, 1);
    quest.complete(player);
  }

  /** With a full bag the key lands on the player's own tile instead (tick 144). */
  function searchPottedPlant(event) {
    const { player } = event;
    if (held(player, DOOR_KEY_ITEM_ID)) {
      startTranscript(api, player, BOY_NPC_ID, PAGE, "the-witch-s-house-searching-the-plant-pot-for-the-key-searching-the-plant-pot-with-a-key-already");
      return;
    }
    player.performAnimation(new Animation(PICKUP_FLOOR_ANIMATION));
    if (player.getInventory().getFreeSlots() > 0) player.getInventory().adds(DOOR_KEY_ITEM_ID, 1);
    else itemOnGroundManager?.registerLocation(player, new Item(DOOR_KEY_ITEM_ID, 1), player.getLocation().clone());
    objectBox(player, DOOR_KEY_ITEM_ID, FOUND_DOOR_KEY);
  }

  /**
   * QH: "If you don't have gloves, search the nearby boxes until you get a pair."
   * Cache Boxes (24692) placements in the basement: 2899,9871 / 2899,9872 / 2900,9872
   * sit in the west room behind the electric gate, while 2905,9872 / 2906,9872 /
   * 2908,9873 sit in the east room the ladder drops into, so the pair can be found
   * before the gate. Both rooms serve the handout; only the room the player is
   * standing in can be searched. With gloves already, live says the boxes are empty (236, 259).
   */
  function searchBoxes(event) {
    if (event.objectId !== BOXES_LOC_ID) return;
    const { player, location } = event;
    if (location.z !== 0) return;
    if (!BASEMENT_BOXES.some((box) => box.x === location.x && box.y === location.y)) return;
    const at = player.getLocation();
    if (at.getZ() !== 0 || at.getX() < 2897 || at.getX() > 2909 || at.getY() < 9870 || at.getY() > 9878) return;
    if (basementRoom(at.getX()) !== basementRoom(location.x)) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_COMPLETE) return;

    event.handled = true;
    if (held(player, GLOVES_ITEM_ID) || wearingGloves(player)) {
      player.sendMessage("You search the boxes but find nothing.");
      return;
    }
    if (player.getInventory().getFreeSlots() <= 0) {
      player.sendMessage(FULL_INVENTORY_MESSAGE);
      return;
    }
    player.getInventory().adds(GLOVES_ITEM_ID, 1);
    player.sendMessage("You find a pair of leather gloves in the boxes.");
  }

  function replaceObject(object, newId) {
    if (!object?.getLocation) return;
    const at = object.getLocation();
    ObjectManager.deregister(object, true);
    ObjectManager.register(new GameObject(newId, new Location(at.getX(), at.getY(), at.getZ()),
      object.getType(), object.getFace(), object.getPrivateArea?.() ?? null), true);
  }

  /**
   * The magnet comes from opening the cupboard (ticks 222-223): the reach animation and sound, the
   * open cupboard in its place, then the item box. A full bag must not advance the durable stage:
   * the magnet is only found once it is actually in the inventory, so the player can retry later.
   */
  function takeMagnet(player) {
    if (player.getInventory().getFreeSlots() <= 0) {
      player.sendMessage(FULL_INVENTORY_MESSAGE);
      return false;
    }
    player.getInventory().adds(MAGNET_ITEM_ID, 1);
    if (!held(player, MAGNET_ITEM_ID)) {
      player.sendMessage(FULL_INVENTORY_MESSAGE);
      return false;
    }
    if (quest.getStage(player) === STAGE_STARTED) quest.setStage(player, STAGE_FOUND_MAGNET);
    objectBox(player, MAGNET_ITEM_ID, FOUND_MAGNET);
    return true;
  }

  /** The reach and sound first; the open cupboard and the magnet a tick later (ticks 222-223). */
  function openCupboard(event) {
    const { player, object } = event;
    player.performAnimation(new Animation(OPEN_CUPBOARD_ANIMATION));
    Sounds.sendSound(player, new Sound(CUPBOARD_OPEN_SOUND, 1, 0, 0));
    later(player, CUPBOARD_OPEN_DELAY, () => {
      replaceObject(object, CUPBOARD_OPEN_LOC_ID);
      if (!held(player, MAGNET_ITEM_ID)) takeMagnet(player);
    });
  }

  function searchOpenCupboard(event) {
    const { player } = event;
    if (held(player, MAGNET_ITEM_ID)) {
      startTranscript(api, player, BOY_NPC_ID, PAGE, "the-witch-s-house-searching-the-cupboard-for-the-magnet-searching-the-cupboard-again-with-a-magnet-already");
      return;
    }
    takeMagnet(player);
  }

  function handleCupboard(event) {
    const option = event.option ?? event.definition?.getInteractions?.()?.[event.clickType - 1];
    if (event.objectId === CUPBOARD_SHUT_LOC_ID) {
      openCupboard(event);
      return;
    }
    if (option === "Shut") {
      replaceObject(event.object, CUPBOARD_SHUT_LOC_ID);
      return;
    }
    searchOpenCupboard(event);
  }

  function searchFountain(event) {
    const { player } = event;
    if (caughtPlayers.has(player)) return;
    if (held(player, SHED_KEY_ITEM_ID)) {
      objectBox(player, SHED_KEY_ITEM_ID, HAVE_SHED_KEY);
      return;
    }
    if (player.getInventory().getFreeSlots() <= 0) {
      player.sendMessage(FULL_INVENTORY_MESSAGE);
      return;
    }
    player.getInventory().adds(SHED_KEY_ITEM_ID, 1);
    if (!held(player, SHED_KEY_ITEM_ID)) return;
    objectBox(player, SHED_KEY_ITEM_ID, FOUND_SHED_KEY);
  }

  function spawnExperiment(player) {
    const npc = api.spawnNpc({
      id: EXPERIMENT_NPC_IDS[0],
      x: EXPERIMENT_TILE.x,
      y: EXPERIMENT_TILE.y,
      z: EXPERIMENT_TILE.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) {
      // Quest spawn: without this its death queues the definition's own respawn,
      // leaving an untracked shapeshifter behind in the shed.
      npc.__skipDefaultRespawn = true;
      experimentByPlayer.set(player, npc);
    }
  }

  function ensureExperiment(player) {
    if (!experimentByPlayer.has(player)) spawnExperiment(player);
  }

  /** Every way in brings out a fresh shapeshifter, the old one gone, even once it has been beaten (ticks 652, 900, 1150). */
  function enterShed(player) {
    if (quest.getStage(player) >= STAGE_COMPLETE) return;
    const old = experimentByPlayer.get(player);
    if (old) api.removeNpc(old);
    experimentByPlayer.delete(player);
    spawnExperiment(player);
  }

  function dropBall(player, location) {
    itemOnGroundManager?.registerLocation(
      player,
      new Item(BALL_ITEM_ID, 1),
      new Location(location.getX(), location.getY(), location.getZ())
    );
  }

  /** The shed's ball is a permanent ground spawn; only drop one if that is gone. */
  function ballSpawnPresent() {
    return World.getItems().some((ground) => {
      if (ground?.getItem?.().getId?.() !== BALL_ITEM_ID) return false;
      const position = ground.getPosition?.();
      return position?.getX?.() === BALL_SPAWN_TILE.x &&
        position?.getY?.() === BALL_SPAWN_TILE.y &&
        position?.getZ?.() === BALL_SPAWN_TILE.z;
    });
  }

  /** The glare (ticks 665, 793, 840, 909): 1 + 6% off the current Attack, Strength and Defence. */
  function weaken(player) {
    const skills = player.getSkillManager();
    for (const skill of [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE]) {
      const level = skills.getCurrentLevel(skill);
      const drain = GLARE_DRAIN_BASE + Math.floor((level * GLARE_DRAIN_PERCENT) / 100);
      skills.setCurrentLevel(skill, Math.max(0, level - drain), true);
    }
  }

  /**
   * Taking the shed's ball before the experiment dies leaves the player weakened and the ball
   * where it is. Quest Helper's grabBall step also uses the attempt to bring out an experiment that
   * is missing (for example after a relog inside the shed), so spawn one if none is tracked.
   */
  function handleBallPickup(event) {
    if (event.groundItemId !== BALL_ITEM_ID) return;
    const { x, y, z } = event.location ?? {};
    if (Math.abs(x - BALL_SPAWN_TILE.x) > 2 || Math.abs(y - BALL_SPAWN_TILE.y) > 2 || z !== BALL_SPAWN_TILE.z) return;
    if (quest.getStage(event.player) >= STAGE_DEFEATED_EXPERIMENT) return;
    event.handled = true;
    ensureExperiment(event.player);
    event.player.sendMessage("The shapeshifter glares at you. You feel slightly weakened.");
    weaken(event.player);
  }

  /** Each shapeshifter form dies into the next; the fourth one stays dead. */
  function handleExperimentBeforeDeath(event) {
    const npc = event?.npc;
    if (!npc) return;
    const index = EXPERIMENT_NPC_IDS.indexOf(npc.getId?.());
    if (index === -1) return;
    const owner = npc.getOwner?.();
    if (!owner || experimentByPlayer.get(owner) !== npc) return;

    if (index === EXPERIMENT_NPC_IDS.length - 1) {
      experimentByPlayer.delete(owner);
      if (quest.getStage(owner) < STAGE_DEFEATED_EXPERIMENT) {
        quest.setStage(owner, STAGE_DEFEATED_EXPERIMENT);
      }
      owner.sendMessage(FORM_MESSAGES[index][0]);
      if (!ballSpawnPresent()) dropBall(owner, npc.getLocation());
      return;
    }

    const location = npc.getLocation();
    experimentByPlayer.delete(owner);
    api.removeNpc(npc);
    const next = api.spawnNpc({
      id: EXPERIMENT_NPC_IDS[index + 1],
      x: location.getX(),
      y: location.getY(),
      z: location.getZ(),
      wanderRadius: 0,
      owner,
      ownerOnly: true,
    });
    if (next) {
      next.__skipDefaultRespawn = true;
      experimentByPlayer.set(owner, next);
    }
    for (const line of FORM_MESSAGES[index]) owner.sendMessage(line);
    event.preventDeath = true;
  }

  /** The front door wants the door key going in (tick 129); leaving is always free. */
  function refuseFrontDoor(player) {
    if (player.getLocation().getX() >= HOUSE_INSIDE_MIN_X) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_COMPLETE) {
      player.sendMessage("It would be rude to break into this house.");
      return true;
    }
    if (held(player, DOOR_KEY_ITEM_ID)) return false;
    player.sendMessage("This door is locked.");
    return true;
  }

  /** The back door stays locked until the mouse carries the magnet (tick 295). */
  function refuseBackDoor(player) {
    if (quest.getStage(player) >= STAGE_UNLOCKED_BACK_DOOR) return false;
    player.sendMessage("The door is locked.");
    startTranscript(api, player, BOY_NPC_ID, PAGE, "the-witch-s-house-attempting-to-open-the-garden-door-without-unlocking-it");
    return true;
  }

  /** The shed door wants the shed key on every way in, the experiment beaten or not (ticks 646, 1092). */
  function refuseShedDoor(player) {
    if (player.getLocation().getX() >= SHED_INSIDE_MIN_X) return false;
    if (held(player, SHED_KEY_ITEM_ID)) return false;
    player.sendMessage("The shed door is locked.");
    return true;
  }

  /** Bare hands: the message, then a fifth of the player's Hitpoints a tick later (ticks 204-205). */
  function shock(player) {
    player.sendMessage("As your hands touch the gate you feel a shock.");
    Sounds.sendSound(player, new Sound(GATE_SHOCK_SOUND, 1, 0, 0));
    const damage = Math.floor(player.getSkillManager().getMaxLevel(Skill.HITPOINTS) * GATE_SHOCK_FRACTION);
    later(player, GATE_SHOCK_DELAY, () => {
      player.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, HitMask.RED)]);
    });
  }

  /**
   * Doors.plugin asks here before opening a door (door:toggle); a refusal is handled here and an
   * allowed crossing is left to its pass-through gate, which walks the player across.
   */
  function handleDoorToggle(event) {
    const { player, objectId } = event;
    if (objectId === FRONT_DOOR_LOC_ID) {
      if (refuseFrontDoor(player)) event.handled = true;
      return;
    }
    if (objectId === BACK_DOOR_LOC_ID) {
      if (player.getLocation().getY() > GARDEN_MAX_Y && refuseBackDoor(player)) event.handled = true;
      return;
    }
    if (objectId === SHED_DOOR_LOC_ID) {
      if (refuseShedDoor(player)) {
        event.handled = true;
        return;
      }
      if (player.getLocation().getX() < SHED_INSIDE_MIN_X) enterShed(player);
      return;
    }
    if (GATE_LOC_IDS.has(objectId) && !wearingGloves(player)) {
      event.handled = true;
      shock(player);
    }
  }

  /**
   * The basement ladders land where live does (ticks 189, 263), not on the map's other end: Ladders
   * asks first (ladders:climb), then climbs with its animation and timing to the given tile.
   */
  function claimBasementLadder(request) {
    if (request.handled) return;
    const down = request.objectId === LADDER_DOWN_LOC_ID;
    if (!down && request.objectId !== LADDER_UP_LOC_ID) return;
    request.handled = true;
    const tile = down ? BASEMENT_TILE : GROUND_FLOOR_TILE;
    api.emitCustomEvent(down ? "ladders:climbDown" : "ladders:climbUp", {
      player: request.player,
      destination: new Location(tile.x, tile.y, tile.z),
    });
  }

  /** All the object interactions in and around the house; the doors, gate and ladders go through their plugins. */
  function handleObjectInteraction(event) {
    const { objectId } = event;
    if (objectId === BOXES_LOC_ID) {
      searchBoxes(event);
      return;
    }
    if (objectId === POTTED_PLANT_LOC_ID) {
      event.handled = true;
      searchPottedPlant(event);
      return;
    }
    if (objectId === CUPBOARD_SHUT_LOC_ID || objectId === CUPBOARD_OPEN_LOC_ID) {
      event.handled = true;
      handleCupboard(event);
      return;
    }
    if (objectId === FOUNTAIN_LOC_ID) {
      event.handled = true;
      searchFountain(event);
      return;
    }
  }

  /** Cheese on a mouse hole: the player bends down and the (owner-only) mouse runs out a tick later. */
  function useCheeseOnHole(event) {
    const { player } = event;
    event.handled = true;
    player.getInventory().deleteNumber(CHEESE_ITEM_ID, 1);
    player.performAnimation(new Animation(PICKUP_FLOOR_ANIMATION));
    later(player, MOUSE_DELAY, () => {
      const tracked = mouseByPlayer.get(player);
      if (tracked) api.removeNpc(tracked);
      const mouse = api.spawnNpc({
        id: MOUSE_NPC_ID,
        x: MOUSE_TILE.x,
        y: MOUSE_TILE.y,
        z: MOUSE_TILE.z,
        wanderRadius: 1,
        owner: player,
        ownerOnly: true,
      });
      if (mouse) mouseByPlayer.set(player, mouse);
      startTranscript(api, player, BOY_NPC_ID, PAGE, "the-witch-s-house-after-dropping-cheese-in-front-of-the-mouse-hole");
    });
  }

  /** The shed key on the shed door opens it like Open with the key held. */
  function useShedKeyOnDoor(event) {
    const { player } = event;
    event.handled = true;
    if (player.getLocation().getX() < SHED_INSIDE_MIN_X) enterShed(player);
    api.emitCustomEvent("door:open", { player, object: event.object, handled: false });
  }

  function handleItemOnObject(event) {
    if (event.itemId === SHED_KEY_ITEM_ID && event.objectId === SHED_DOOR_LOC_ID) {
      useShedKeyOnDoor(event);
      return;
    }
    if (event.itemId === CHEESE_ITEM_ID && MOUSE_HOLE_LOC_IDS.has(event.objectId)) useCheeseOnHole(event);
  }

  function handleItemOnNpc(event) {
    if (event.itemId !== MAGNET_ITEM_ID) return;
    const { player } = event;
    const tracked = mouseByPlayer.get(player);
    if (!tracked || event.target !== tracked) return;
    event.handled = true;
    const stage = quest.getStage(player);
    if (stage >= STAGE_UNLOCKED_BACK_DOOR) {
      startTranscript(api, player, BOY_NPC_ID, PAGE, "the-witch-s-house-using-a-magnet-on-the-mouse-using-a-magnet-on-a-mouse-while-the-door-is-unlocked");
      return;
    }
    if (stage < STAGE_FOUND_MAGNET) {
      startTranscript(api, player, BOY_NPC_ID, PAGE, "the-witch-s-house-using-a-magnet-on-the-mouse-using-a-magnet-without-previously-searching-the-cupboard");
      return;
    }
    player.getInventory().deleteNumber(MAGNET_ITEM_ID, 1);
    api.removeNpc(tracked);
    mouseByPlayer.delete(player);
    quest.setStage(player, STAGE_UNLOCKED_BACK_DOOR);
    startTranscript(api, player, BOY_NPC_ID, PAGE, "the-witch-s-house-using-a-magnet-on-the-mouse");
  }

  /** Reading the diary opens the book and counts as read straight away (tick 357). */
  function handleItemAction(event) {
    if (event.itemId !== DIARY_ITEM_ID) return;
    if (event.option && !/read/i.test(event.option)) return;
    event.handled = true;
    const { player } = event;
    if (quest.getStage(player) === STAGE_UNLOCKED_BACK_DOOR) quest.setStage(player, STAGE_READ_DIARY);
    player.performAnimation(new Animation(READ_BOOK_ANIMATION));
    openBook(player, DIARY_TITLE, DIARY_PAGES);
  }

  // --- Nora and the garden

  const noraPatrol = { direction: 1, wait: 0 };
  const caughtPlayers = new WeakSet();

  function walkNora(npc) {
    if (noraPatrol.wait > 0) {
      noraPatrol.wait--;
      return;
    }
    const queue = npc.getMovementQueue();
    if (queue.size() > 0) return;
    const x = npc.getLocation().getX();
    if (x >= NORA_EAST_X) noraPatrol.direction = -1;
    else if (x <= NORA_WEST_X) noraPatrol.direction = 1;
    queue.walkStep(noraPatrol.direction, 0);
  }

  /** Only a player on the quest's way through the garden; the back door opens at this stage. */
  function noraHunts(player) {
    const stage = quest.getStage(player);
    return stage >= STAGE_UNLOCKED_BACK_DOOR && stage < STAGE_COMPLETE;
  }

  const tallHedge = (x, y, z) => (RegionManager.getClipping(x, y, z, null) & RegionManager.PROJECTILE_TILE_BLOCKED) !== 0;

  /** The tiles strictly between two tiles, along the straight line from one to the other. */
  function tilesBetween(fromX, fromY, toX, toY) {
    const steps = Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY));
    const tiles = [];
    for (let i = 1; i < steps; i++) {
      tiles.push([Math.round(fromX + ((toX - fromX) * i) / steps), Math.round(fromY + ((toY - fromY) * i) / steps)]);
    }
    return tiles;
  }

  /** Within 3 tiles, with no tall hedge between the player and her, nor between the player and her row. */
  function noraSees(npc, player) {
    const from = npc.getLocation();
    const to = player.getLocation();
    const z = to.getZ();
    if (from.getZ() !== z) return false;
    if (Math.max(Math.abs(to.getX() - from.getX()), Math.abs(to.getY() - from.getY())) > NORA_SIGHT) return false;
    const towardRow = Math.sign(from.getY() - to.getY());
    for (let y = to.getY() + towardRow; towardRow !== 0 && y !== from.getY(); y += towardRow) {
      if (tallHedge(to.getX(), y, z)) return false;
    }
    return !tilesBetween(to.getX(), to.getY(), from.getX(), from.getY()).some(([x, y]) => tallHedge(x, y, z));
  }

  /** Out next to the Boy with the ball and the shed key taken; the stage stays (tick 958). */
  function sendToBoy(player) {
    caughtPlayers.delete(player);
    player.getMovementQueue().setBlockMovement(false);
    if (player.isRegistered?.() === false) return;
    player.moveTo(new Location(CAUGHT_TILE.x, CAUGHT_TILE.y, CAUGHT_TILE.z));
    for (const itemId of [BALL_ITEM_ID, SHED_KEY_ITEM_ID]) {
      player.getInventory().deleteNumber(itemId, player.getInventory().getAmount(itemId));
    }
  }

  function castCurse(npc, player) {
    npc.forceChat("Klarata... Sepptento... Valkan!");
    const cast = new Graphic(NORA_CAST_GRAPHIC);
    cast.height = NORA_CAST_GRAPHIC_HEIGHT;
    npc.performGraphic(cast);
    Projectile.createProjectile(npc, player, NORA_CURSE_PROJECTILE, NORA_CURSE_START, NORA_CURSE_END, NORA_CURSE_HEIGHT, NORA_CURSE_HEIGHT)
      .withAngle(NORA_CURSE_ANGLE)
      .withProgress(NORA_CURSE_PROGRESS)
      .sendProjectile();
    const impact = new Graphic(NORA_CURSE_IMPACT_GRAPHIC, NORA_CURSE_END);
    impact.height = NORA_CURSE_HEIGHT;
    player.performGraphic(impact);
    const at = npc.getLocation();
    const target = player.getLocation();
    Sounds.playAreaSound({ soundId: NORA_CAST_SOUND, x: at.getX(), y: at.getY(), level: at.getZ(), radius: NORA_SOUND_RADIUS, source: npc });
    Sounds.playAreaSound({ soundId: NORA_HIT_SOUND, x: target.getX(), y: target.getY(), level: target.getZ(), delay: NORA_CURSE_END, radius: NORA_SOUND_RADIUS, source: npc });
  }

  /** She stops for the whole catch and walks on the tick after the teleport. */
  function catchPlayer(npc, player) {
    caughtPlayers.add(player);
    noraPatrol.wait = CAUGHT_TELEPORT_TICKS;
    npc.getMovementQueue().reset();
    player.getMovementQueue().setBlockMovement(true).reset();
    npc.setPositionToFace(player.getLocation());
    npc.forceChat("Stop! Thief!");
    later(npc, CAUGHT_CAST_TICKS, () => castCurse(npc, player));
    later(npc, CAUGHT_TELEPORT_TICKS, () => sendToBoy(player));
  }

  class WitchsGarden extends Area {
    constructor() {
      // The row Nora walks and the paths around its hedges, as far as the shed door.
      super([new Boundary(2901, 2933, 3460, 3466, 0)]);
    }

    getName() {
      return "WitchsGarden";
    }

    postEnter(mobile) {
      if (!mobile.isNpc?.() || mobile.getId() !== NORA_NPC_ID) return;
      const npc = mobile.getAsNpc();
      npc.setScriptedMovement(true);
      npc.getMovementCoordinator?.().setRadius(0);
    }

    process(mobile) {
      if (!mobile.isNpc?.() || mobile.getId() !== NORA_NPC_ID) return;
      const npc = mobile.getAsNpc();
      walkNora(npc);
      for (const player of this.getPlayers()) {
        if (caughtPlayers.has(player) || !noraHunts(player) || !noraSees(npc, player)) continue;
        catchPlayer(npc, player);
        break;
      }
    }
  }

  function handleLogout({ player }) {
    if (!player) return;
    const experiment = experimentByPlayer.get(player);
    if (experiment) api.removeNpc(experiment);
    const mouse = mouseByPlayer.get(player);
    if (mouse) api.removeNpc(mouse);
    experimentByPlayer.delete(player);
    mouseByPlayer.delete(player);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  itemOnGroundManager = api.getItemOnGroundManager();

  quest = registerQuest(api, {
    key: "witchs_house",
    name: "Witch's House",
    varpId: VARP_WITCHS_HOUSE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 4,
    xpRewards: [{ skillId: Skill.HITPOINTS.getIndex(), amount: 6325, label: "Hitpoints" }],
    buildJournal,
    onReward: grantReward,
  });

  api.registerArea(new WitchsGarden());
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("door:toggle", handleDoorToggle);
  api.onCustomEvent("ladders:climb", claimBasementLadder);
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcBeforeDeath(handleExperimentBeforeDeath);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemAction(handleItemAction);
  api.onGroundItemPickup(handleBallPickup);
  api.onPlayerLogout(handleLogout);
  api.onPlayerLogin(handleLogin);
};
