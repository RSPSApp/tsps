/**
 * Troll Stronghold (members).
 *
 * The words come from the "Troll Stronghold" transcript page; this plugin
 * supplies the variant selector for Denulth, Tenzing, Dunstan, Eadgar, Godric,
 * Dad, Twig and Berry (all indexed), the start hook, the prose-condition
 * answers, the prison-key drops and the prison break that completes the quest.
 *
 * Stages (varp 317): 10 started, 20 Dad killed, 30 prison key looted, 40 both
 * cell keys, 45 Godric and Eadgar freed, 50 complete.
 *
 * Requires Death Plateau. The rock climbs and stile are the shared Agility
 * shortcuts; the arena gates and the prison door are Doors pass-through gates
 * that this plugin guards. Walking into the arena (or talking to Dad) plays his
 * challenge; he surrenders instead of dying ("Stop! You win."), which advances
 * the stage, and only the transcript's "Prepare to die!" kills him, turning the
 * spectators on the player. Dad's arena menu has a missing first option in the
 * dump ("Why are you called Dad?"), so it is replayed with that text patched in.
 * A Troll general's drop table carries the prison key; this plugin only says
 * whether the killer may have one. Twig and Berry can be pickpocketed
 * (30 Thieving) through their transcript variants or killed for the keys; the
 * cell doors unlock with Cell key 1 (Godric) and Cell key 2 (Eadgar), swing open
 * for a moment and lock again, so every player frees their own prisoners. The
 * prison's Exit and the Secret Door outside are the back way in and out.
 */
module.exports = function registerTrollStrongholdQuest(api) {
  const {
    Skill, Location, GameObject, ObjectManager, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers,
    World, TaskManager, CountdownTask, Sound, Sounds, Area, Boundary,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");
  const { startDialogue } = require("../../npcs/NpcDialogues.plugin.js");

  const DENULTH_NPC_IDS = new Set([NpcIdentifiers.DENULTH, NpcIdentifiers.DENULTH_2]);
  const TENZING_NPC_ID = NpcIdentifiers.TENZING;
  const DUNSTAN_NPC_ID = NpcIdentifiers.DUNSTAN;
  const EADGAR_NPC_ID = NpcIdentifiers.EADGAR;
  const GODRIC_NPC_ID = NpcIdentifiers.GODRIC;
  const DAD_NPC_ID = NpcIdentifiers.DAD;
  const TWIG_NPC_IDS = new Set([NpcIdentifiers.TWIG_2, NpcIdentifiers.TWIG_3]);
  const BERRY_NPC_IDS = new Set([NpcIdentifiers.BERRY, NpcIdentifiers.BERRY_2]);
  const TROLL_GENERAL_NPC_IDS = new Set([
    NpcIdentifiers.TROLL_GENERAL,
    NpcIdentifiers.TROLL_GENERAL_2,
    NpcIdentifiers.TROLL_GENERAL_3,
  ]);

  const VARP_TROLL_STRONGHOLD = 317;
  const VARBIT_EADGAR_FREED = 0;
  const STAGE_STARTED = 10;
  const STAGE_DAD_KILLED = 20;
  const STAGE_HAS_PRISON_KEY = 30;
  const STAGE_HAS_CELL_KEYS = 40;
  const STAGE_GODRIC_FREED = 45;
  const STAGE_COMPLETE = 50;

  const PRISON_KEY_ITEM_ID = ItemIdentifiers.PRISON_KEY;
  const CELL_KEY_1_ITEM_ID = ItemIdentifiers.CELL_KEY_1;
  const CELL_KEY_2_ITEM_ID = ItemIdentifiers.CELL_KEY_2;
  const CLIMBING_BOOTS_ITEM_ID = ItemIdentifiers.CLIMBING_BOOTS;
  const SPIKED_BOOTS_ITEM_ID = ItemIdentifiers.SPIKED_BOOTS;
  const COINS_ITEM_ID = ItemIdentifiers.COINS;

  // Godric's locked cell door (3767) takes Cell key 1, Eadgar's (3765) Cell
  // key 2. Unlocking swings the door's nameless open leaf (closed id + 1) into
  // the cell tile west, and it locks again a moment later.
  const CELL_DOOR_GODRIC_ID = ObjectIdentifiers.CELL_DOOR_5;
  const CELL_DOOR_EADGAR_ID = ObjectIdentifiers.CELL_DOOR_4;
  const CELL_DOOR_OPEN_LEAF_IDS = new Map([[CELL_DOOR_GODRIC_ID, 3768], [CELL_DOOR_EADGAR_ID, 3766]]);
  const CELL_DOOR_OPEN_TICKS = 2;
  const GUARD_THIEVING_LEVEL = 30;

  const ARENA_ENTRANCE_IDS = new Set([ObjectIdentifiers.ARENA_ENTRANCE, ObjectIdentifiers.ARENA_ENTRANCE_2]);
  const ARENA_EXIT_IDS = new Set([ObjectIdentifiers.ARENA_EXIT, ObjectIdentifiers.ARENA_EXIT_2]);
  // The entrance is the arena's west wall (x 2897), the exit its north wall (y 3629).
  const ARENA_ENTRANCE_X = 2897;
  const ARENA_EXIT_Y = 3629;
  // Dad's challenge starts once the step through the entrance has landed.
  const ARENA_CHALLENGE_DELAY_TICKS = 2;
  const ARENA_SEARCH_RADIUS = 24;
  // Inside the arena's walls, where Dad and his spectators stand (the arena's multi-combat zone).
  const TROLL_ARENA = { minX: 2896, maxX: 2927, minY: 3595, maxY: 3630, z: 0 };
  const ARENA_SPECTATOR_IDS = new Set([
    NpcIdentifiers.TROLL_SPECTATOR, NpcIdentifiers.TROLL_SPECTATOR_2, NpcIdentifiers.TROLL_SPECTATOR_3,
    NpcIdentifiers.TROLL_SPECTATOR_4, NpcIdentifiers.TROLL_SPECTATOR_5, NpcIdentifiers.TROLL_SPECTATOR_6,
    NpcIdentifiers.TROLL_SPECTATOR_7,
  ]);
  const CAVE_ENTRANCE_ID = ObjectIdentifiers.CAVE_ENTRANCE_22;
  const CAVE_EXIT_ID = ObjectIdentifiers.CAVE_EXIT_11;
  const STRONGHOLD_ENTRANCE_ID = ObjectIdentifiers.STRONGHOLD;
  const STRONGHOLD_EXIT_IDS = new Set([ObjectIdentifiers.EXIT_2, ObjectIdentifiers.EXIT_3, ObjectIdentifiers.EXIT_4]);
  const PRISON_DOOR_ID = ObjectIdentifiers.PRISON_DOOR_9;
  const PRISON_EXIT_ID = ObjectIdentifiers.EXIT;
  const SECRET_DOOR_ID = ObjectIdentifiers.SECRET_DOOR;
  // Capture 740 tick 1471: the unlock sound plays with the door's own (Doors sends that one).
  const PRISON_DOOR_UNLOCK_SOUND_ID = 1631;
  // Cache-map tiles: the entrance emerges on the top floor beside the exits;
  // the cave tunnel's south and north mouths both surface beside the arena path.
  const STRONGHOLD_INTERIOR = new Location(2836, 10090, 2);
  const STRONGHOLD_SURFACE = new Location(2841, 3690, 0);
  const CAVE_SOUTH_INTERIOR = new Location(2907, 10035, 0);
  const CAVE_SOUTH_SURFACE = new Location(2904, 3643, 0);
  const CAVE_NORTH_INTERIOR = new Location(2907, 10019, 0);
  const CAVE_NORTH_SURFACE = new Location(2908, 3654, 0);
  // The prison's south Exit (2823,10048) and the Secret Door (2827,3647) in the
  // mountain pass: the tiles in front of each (cache map, no capture).
  const PRISON_EXIT_INTERIOR = new Location(2824, 10050, 0);
  const SECRET_DOOR_SURFACE = new Location(2827, 3646, 0);
  // The prison's cells and corridor, where Godric and Eadgar are held.
  const PRISON_CELLS = { minX: 2820, maxX: 2840, minY: 10070, maxY: 10095, z: 0 };
  const LAW_TALISMAN_PRICE = 1000;
  const BUY_LAW_TALISMAN_ACTION_ID = "JpNnpQ";

  const GODRIC_FREED_ATTRIBUTE = "troll-stronghold:godric-freed";
  const EADGAR_FREED_ATTRIBUTE = "troll-stronghold:eadgar-freed";
  const PRISON_DOOR_ATTRIBUTE = "troll-stronghold:prison-door-unlocked";

  const PAGE = "Troll Stronghold";
  const TWIG_KEY_VARIANT = "entering-the-prison-retrieving-the-keys-from-twig";
  const BERRY_KEY_VARIANT = "entering-the-prison-retrieving-the-keys-from-berry";
  const FREEING_VARIANT = "entering-the-prison-freeing-eadgar-and-godric";
  const DAD_ARENA_VARIANT = "getting-started-entering-dad-s-arena";
  const DAD_DEFEATED_VARIANT = "getting-started-after-dad-has-been-defeated";
  // The dump lost the first arena option's text ({{topt||Why are you called Dad?}}).
  const DAD_MISSING_OPTION_TEXT = "Why are you called Dad?";
  const DAD_BLOCKS_EXIT_TEXT = "No human pass through arena without defeating Dad!";
  const DAD_REFIGHT_MESSAGE = "You don't need to fight him again.";
  const DAD_WONT_TALK_MESSAGE = "He doesn't seem interested in talking right now.";
  /** "I accept your challenge!" and "I'm not done yet! Prepare to die!" */
  const DAD_ACCEPT_ACTION_ID = "AL-4op";
  const DAD_FATAL_BLOW_ACTION_ID = "yw_WWY";
  // Rsprox 740/741 (after the quest): the prisoners' Talk-to from inside their cells.
  const PRISONER_LINES = new Map([
    [NpcIdentifiers.GODRIC, { speaker: "Godric", text: "Don't worry about me, I'll be out again soon enough." }],
    [NpcIdentifiers.EADGAR, { speaker: "Eadgar", text: "Don't worry about me, I'll be out in a jiffy. Talk to me at my home." }],
  ]);

  const START_HOOK = "quest:troll-stronghold:start";
  /** Twig / Berry pocket messages that yield the cell keys. */
  const GIVE_TWIG_KEY_MESSAGE_ID = "UsQIS6";
  const GIVE_BERRY_KEY_MESSAGE_ID = "kUE-LP";
  /** Dunstan's family heirloom ("a Law talisman") ends the quest. */
  const COMPLETE_ACTION_ID = "GT_EpY";

  let quest;
  /** Dads being killed after surrendering ("Prepare to die!"), whose death goes ahead. */
  const dadExecutions = new WeakSet();

  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;
  const hasBothCellKeys = (player) =>
    held(player, CELL_KEY_1_ITEM_ID) && held(player, CELL_KEY_2_ITEM_ID);
  const agilityLevel = (player) => player.getSkillManager().getCurrentLevel(Skill.AGILITY);
  const godricFreed = (player) => player.getAttribute(GODRIC_FREED_ATTRIBUTE) === true;
  const eadgarFreed = (player) => player.getAttribute(EADGAR_FREED_ATTRIBUTE) === true;
  const prisonDoorUnlocked = (player) => player.getAttribute(PRISON_DOOR_ATTRIBUTE) === true;

  function syncFreedHelperState(player) {
    player.getPacketSender().sendVarbit(VARBIT_EADGAR_FREED, eadgarFreed(player) ? 1 : 0);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I entered the Troll Stronghold.</str>",
        "<str>I rescued Godric from the troll prison.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_GODRIC_FREED) {
      return [
        "I have freed <col=800000>Godric</col> and <col=800000>Eadgar</col>.",
        "I should return to <col=800000>Dunstan</col>.",
      ];
    }
    if (stage >= STAGE_HAS_CELL_KEYS) {
      return [
        "I have both cell keys.",
        "I should unlock <col=800000>Godric's</col> and <col=800000>Eadgar's</col> cells.",
      ];
    }
    if (stage >= STAGE_HAS_PRISON_KEY) {
      return [
        "I defeated a Troll General and found the prison key.",
        "I need the two cell keys carried by <col=800000>Twig and Berry</col>.",
      ];
    }
    if (stage >= STAGE_DAD_KILLED) {
      return [
        "I defeated Dad and may enter the stronghold.",
        "I should defeat a <col=800000>Troll General</col> for the prison key.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Dunstan's son Godric is held in the Troll Stronghold.",
        "I must climb the mountain and defeat <col=800000>Dad</col>.",
      ];
    }
    return ["I can start this quest by talking to <col=800000>Denulth</col> in <col=800000>Burthorpe</col>."];
  }

  function grantReward(_player) {
    // Reward item (Law talisman) is granted by registerQuest.
  }

  /** Pockets hold one key each; once both cell keys are held, the stage moves on. */
  function addCellKey(player, itemId) {
    if (quest.getStage(player) < STAGE_HAS_PRISON_KEY) return;
    if (!held(player, itemId)) {
      const inventory = player.getInventory();
      const before = inventory.getAmount(itemId);
      inventory.adds(itemId, 1);
      if (inventory.getAmount(itemId) <= before) {
        inventory.full?.();
        return;
      }
    }
    if (quest.getStage(player) >= STAGE_HAS_CELL_KEYS) return;
    if (hasBothCellKeys(player)) quest.setStage(player, STAGE_HAS_CELL_KEYS);
  }

  /** After a key/door interaction, stage 45 once both prisoners have been freed. */
  function updateFreedStage(player) {
    syncFreedHelperState(player);
    if (quest.getStage(player) >= STAGE_GODRIC_FREED) return;
    if (godricFreed(player) && eadgarFreed(player)) quest.setStage(player, STAGE_GODRIC_FREED);
  }

  /** Wiki: 30 Thieving; the first successful pocket holds the key. */
  function pickpocketGuard(event, keyId, variant) {
    const { player, npcId } = event;
    if (quest.getStage(player) < STAGE_HAS_PRISON_KEY) {
      player.sendMessage("You pick the guard's pocket but find nothing.");
      return;
    }
    if (player.getSkillManager().getCurrentLevel(Skill.THIEVING) < GUARD_THIEVING_LEVEL) {
      player.sendMessage(`You need a Thieving level of at least ${GUARD_THIEVING_LEVEL} to do this.`);
      return;
    }
    if (held(player, keyId)) {
      player.sendMessage("You pick the guard's pocket but find nothing.");
      return;
    }
    if (player.getInventory().isFull()) {
      player.getInventory().full();
      return;
    }
    startTranscript(api, player, npcId, PAGE, variant);
  }

  function pickpocketTwig(event) {
    pickpocketGuard(event, CELL_KEY_1_ITEM_ID, TWIG_KEY_VARIANT);
  }

  function pickpocketBerry(event) {
    pickpocketGuard(event, CELL_KEY_2_ITEM_ID, BERRY_KEY_VARIANT);
  }

  /** South mouth (arena side) and north mouth (Trollheim side) of the pass tunnel. */
  function enterCave(event) {
    const { player, object, objectId } = event;
    if (objectId !== CAVE_ENTRANCE_ID || !object) return false;
    const at = object.getLocation();
    const south = at.getY() <= 3648;
    player.moveTo(new Location(
      south ? CAVE_SOUTH_INTERIOR.getX() : CAVE_NORTH_INTERIOR.getX(),
      south ? CAVE_SOUTH_INTERIOR.getY() : CAVE_NORTH_INTERIOR.getY(),
      south ? CAVE_SOUTH_INTERIOR.getZ() : CAVE_NORTH_INTERIOR.getZ()
    ));
    event.handled = true;
    return true;
  }

  function exitCave(event) {
    const { player, object, objectId } = event;
    if (objectId !== CAVE_EXIT_ID || !object) return false;
    const at = object.getLocation();
    const north = at.getY() < 10030;
    player.moveTo(new Location(
      north ? CAVE_NORTH_SURFACE.getX() : CAVE_SOUTH_SURFACE.getX(),
      north ? CAVE_NORTH_SURFACE.getY() : CAVE_SOUTH_SURFACE.getY(),
      north ? CAVE_NORTH_SURFACE.getZ() : CAVE_SOUTH_SURFACE.getZ()
    ));
    event.handled = true;
    return true;
  }

  function enterStronghold(event) {
    const { player, objectId } = event;
    if (objectId !== STRONGHOLD_ENTRANCE_ID) return false;
    player.moveTo(new Location(STRONGHOLD_INTERIOR.getX(), STRONGHOLD_INTERIOR.getY(), STRONGHOLD_INTERIOR.getZ()));
    event.handled = true;
    return true;
  }

  function exitStronghold(event) {
    const { player, objectId } = event;
    if (!STRONGHOLD_EXIT_IDS.has(objectId)) return false;
    player.moveTo(new Location(STRONGHOLD_SURFACE.getX(), STRONGHOLD_SURFACE.getY(), STRONGHOLD_SURFACE.getZ()));
    event.handled = true;
    return true;
  }

  /** Cell Door "Unlock": key 1 for Godric's cell, key 2 for Eadgar's. */
  function unlockCellDoor(event) {
    const { player, objectId } = event;
    const isGodric = objectId === CELL_DOOR_GODRIC_ID;
    const isEadgar = objectId === CELL_DOOR_EADGAR_ID;
    if (!isGodric && !isEadgar) return false;
    const keyId = isGodric ? CELL_KEY_1_ITEM_ID : CELL_KEY_2_ITEM_ID;
    const otherKeyId = isGodric ? CELL_KEY_2_ITEM_ID : CELL_KEY_1_ITEM_ID;
    const alreadyFreed = isGodric ? godricFreed(player) : eadgarFreed(player);
    const npcId = isGodric ? GODRIC_NPC_ID : EADGAR_NPC_ID;
    const prisoner = isGodric ? "Godric" : "Eadgar";

    if (alreadyFreed) {
      player.sendMessage("You have no need to do this.");
      return true;
    }
    if (!held(player, keyId)) {
      player.sendMessage(held(player, otherKeyId) || held(player, PRISON_KEY_ITEM_ID)
        ? "This key doesn't open this door."
        : "You need a key to unlock this door.");
      return true;
    }
    player.getInventory().deleteNumber(keyId, 1);
    player.setAttribute(isGodric ? GODRIC_FREED_ATTRIBUTE : EADGAR_FREED_ATTRIBUTE, true);
    syncFreedHelperState(player);
    if (event.object) swingCellDoor(event.object);
    player.sendMessage(`You unlock the cell and free ${prisoner}.`);
    updateFreedStage(player);
    startTranscript(api, player, npcId, PAGE, FREEING_VARIANT);
    return true;
  }

  /**
   * Swings a cell door into its cell and locks it again a moment later. The
   * cell stays locked for everyone else, who free their own prisoners.
   */
  function swingCellDoor(object) {
    const location = object.getLocation();
    const privateArea = object.getPrivateArea() ?? null;
    const closed = new GameObject(object.getId(), new Location(location.getX(), location.getY(), location.getZ()),
      object.getType(), object.getFace(), privateArea);
    const opened = new GameObject(CELL_DOOR_OPEN_LEAF_IDS.get(object.getId()),
      new Location(location.getX() - 1, location.getY(), location.getZ()), object.getType(), 1, privateArea);
    ObjectManager.deregister(closed, true);
    ObjectManager.register(opened, true);
    TaskManager.submit(new CountdownTask(`troll-stronghold:cell-door:${location.getX()},${location.getY()}`,
      CELL_DOOR_OPEN_TICKS, () => relockCellDoor(opened, closed)));
  }

  function relockCellDoor(opened, closed) {
    ObjectManager.deregister(opened, true);
    ObjectManager.register(closed, true);
  }

  /** The prison key opens the prison door; once unlocked (or after the quest) it no longer needs one. */
  function unlockPrisonDoor(event) {
    const { player, object, objectId } = event;
    if (objectId !== PRISON_DOOR_ID) return false;
    event.handled = true;
    const firstUnlock = !prisonDoorUnlocked(player) && !quest.isComplete(player);
    if (firstUnlock && !held(player, PRISON_KEY_ITEM_ID)) {
      player.sendMessage("You need a key to unlock this door.");
      return true;
    }
    if (firstUnlock) {
      player.setAttribute(PRISON_DOOR_ATTRIBUTE, true);
      player.sendMessage("You unlock the door.");
    }
    Sounds.sendSound(player, new Sound(PRISON_DOOR_UNLOCK_SOUND_ID, 1, 0, 0));
    if (object) api.emitCustomEvent("door:open", { player, object, handled: false });
    return true;
  }

  /** The prison's back exit leads out to the Secret Door in the pass. */
  function leavePrison(event) {
    const { player, objectId } = event;
    if (objectId !== PRISON_EXIT_ID) return false;
    player.moveTo(new Location(SECRET_DOOR_SURFACE.getX(), SECRET_DOOR_SURFACE.getY(), SECRET_DOOR_SURFACE.getZ()));
    event.handled = true;
    return true;
  }

  /** The Secret Door is the back way into the prison once the prisoners have been freed. */
  function enterSecretDoor(event) {
    const { player, objectId } = event;
    if (objectId !== SECRET_DOOR_ID) return false;
    event.handled = true;
    if (quest.getStage(player) < STAGE_GODRIC_FREED) {
      // No capture of the refusal; the Wiki only says the way opens during the quest.
      player.sendMessage("The door won't open.");
      return true;
    }
    player.moveTo(new Location(PRISON_EXIT_INTERIOR.getX(), PRISON_EXIT_INTERIOR.getY(), PRISON_EXIT_INTERIOR.getZ()));
    return true;
  }

  const inPrisonCells = (location) => location.getZ() === PRISON_CELLS.z
    && location.getX() >= PRISON_CELLS.minX && location.getX() <= PRISON_CELLS.maxX
    && location.getY() >= PRISON_CELLS.minY && location.getY() <= PRISON_CELLS.maxY;

  /** Godric and Eadgar talk from behind their cell doors; Eadgar at home keeps his own pages. */
  function talkToPrisoner(event) {
    const { player, npc, npcId } = event;
    const line = PRISONER_LINES.get(npcId);
    if (!line || !npc || !inPrisonCells(npc.getLocation())) return false;
    startDialogue(api, event, [{ type: "line", ...line }], {},
      { player, npc, npcId, definition: event.definition });
    return true;
  }

  /**
   * The dump's arena menu dropped the first option's text, which makes the
   * multi-option prompt fail to send. Replay the variant with it restored.
   */
  function patchEmptyOptionText(steps) {
    return steps.map((step) => {
      const copy = { ...step };
      if (Array.isArray(copy.options)) {
        copy.options = copy.options.map((option) =>
          typeof option.text === "string" && option.text.trim()
            ? option
            : { ...option, text: DAD_MISSING_OPTION_TEXT }
        );
      }
      if (Array.isArray(copy.steps)) copy.steps = patchEmptyOptionText(copy.steps);
      return copy;
    });
  }

  const dadDefeated = (player) => quest.getStage(player) >= STAGE_DAD_KILLED;

  function findDad(location) {
    return World.getNpcsNear(location, ARENA_SEARCH_RADIUS, null)
      .find((npc) => npc.getId() === DAD_NPC_ID && npc.getHitpoints() > 0) ?? null;
  }

  function playDadChallenge(player, dad) {
    startTranscript(api, player, DAD_NPC_ID, PAGE, DAD_ARENA_VARIANT, patchEmptyOptionText, dad);
  }

  /** Before the fight, Dad's challenge; after his surrender he has nothing to say until the quest is done. */
  function talkToDad(event) {
    const { player } = event;
    if (quest.isComplete(player)) return false; // Dad's own post-quest page
    if (dadDefeated(player)) {
      player.sendMessage(DAD_WONT_TALK_MESSAGE);
      return true;
    }
    playDadChallenge(player, event.npc);
    return true;
  }

  /** Wiki: once Dad has been defeated he can no longer be attacked. */
  function attackDad(event) {
    const { player, npcId } = event;
    if (npcId !== DAD_NPC_ID || !dadDefeated(player)) return;
    player.sendMessage(DAD_REFIGHT_MESSAGE);
    event.handled = true;
  }

  const refusesRefight = (player, npc) => player?.isPlayer?.() && npc?.isNpc?.()
    && npc.getId() === DAD_NPC_ID && dadDefeated(player);

  /**
   * The troll arena keeps a player who has beaten Dad from fighting him again by any route:
   * a combat spell cast on him is refused like the Attack option (attackDad), and the combat
   * permission refuses whatever else would start the fight. Dad's own attacks, and the
   * scripted killing blow, are untouched.
   */
  function createArenaArea() {
    class TrollArena extends Area {
      getName() {
        return "Troll arena";
      }

      canCastOnNpc(player, npc) {
        if (!refusesRefight(player, npc)) return null;
        player.sendMessage(DAD_REFIGHT_MESSAGE);
        return false;
      }

      canAttack(attacker, target) {
        return refusesRefight(attacker, target) ? false : null;
      }
    }
    const { minX, maxX, minY, maxY, z } = TROLL_ARENA;
    return new TrollArena([new Boundary(minX, maxX, minY, maxY, z)]);
  }

  /**
   * Doors' arena gates ask before opening. Walking in sets off Dad's challenge;
   * he won't let anyone out through the north gate who hasn't defeated him.
   */
  function guardArenaGate(request) {
    const { player, objectId } = request;
    if (request.handled || dadDefeated(player)) return;
    if (ARENA_ENTRANCE_IDS.has(objectId) && player.getLocation().getX() < ARENA_ENTRANCE_X) {
      TaskManager.submit(new CountdownTask(player, ARENA_CHALLENGE_DELAY_TICKS, () => challengeEntrant(player)));
      return;
    }
    if (ARENA_EXIT_IDS.has(objectId) && player.getLocation().getY() < ARENA_EXIT_Y) {
      request.handled = true;
      const dad = findDad(player.getLocation());
      if (!dad) return;
      dad.forceChat(DAD_BLOCKS_EXIT_TEXT);
      dad.getCombat().attack(player);
    }
  }

  function challengeEntrant(player) {
    if (!player.isRegistered() || player.getLocation().getX() < ARENA_ENTRANCE_X) return;
    const dad = findDad(player.getLocation());
    if (dad) playDadChallenge(player, dad);
  }

  /**
   * Dad stops the fight just before he dies (Wiki: "Stop! You win."): he keeps
   * his life, the fight ends and the player may pass. Only the transcript's
   * "Prepare to die!" lets the killing blow through.
   */
  function spareDad(event) {
    const { npc } = event;
    if (npc?.getId?.() !== DAD_NPC_ID) return;
    // The killing blow goes through once; a respawned Dad surrenders again.
    if (dadExecutions.delete(npc)) return;
    const player = npc.getCombat().getKiller(false);
    if (!player) return;
    event.preventDeath = true;
    npc.setHitpoints(npc.getMaxHitpoints());
    endDadFight(npc, player);
    // Hits still in flight this tick retaliate and pick the fight up again; end it once more after them.
    TaskManager.submit(new CountdownTask(npc, 1, () => endDadFight(npc, player)));
    if (quest.getStage(player) >= STAGE_STARTED && !dadDefeated(player)) quest.setStage(player, STAGE_DAD_KILLED);
    startTranscript(api, player, DAD_NPC_ID, PAGE, DAD_DEFEATED_VARIANT, undefined, npc);
  }

  function endDadFight(dad, player) {
    dad.getCombat().reset();
    dad.getCombat().clearDamageMap();
    if (player.getCombat().getTarget() === dad) player.getCombat().reset();
  }

  /** Killing Dad after he surrendered turns the arena's spectators on the player. */
  function deliverFatalBlow(player) {
    const dad = findDad(player.getLocation());
    if (!dad) return;
    dadExecutions.add(dad);
    dad.setHitpoints(0);
    for (const npc of World.getNpcsNear(player.getLocation(), ARENA_SEARCH_RADIUS, null)) {
      if (ARENA_SPECTATOR_IDS.has(npc.getId()) && npc.getHitpoints() > 0) npc.getCombat().attack(player);
    }
  }

  /** After the dialogue has closed: closing it ends Dad's talk, which would also drop a target set now. */
  function dadAttacks(player) {
    TaskManager.submit(new CountdownTask(player, 1, () => {
      if (player.isRegistered()) findDad(player.getLocation())?.getCombat().attack(player);
    }));
  }

  /** Which transcript variant each speaker plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (DENULTH_NPC_IDS.has(npcId)) {
      if (stage === 0) return { page: "Troll Stronghold", variant: "getting-started-talking-to-denulth" }; // also on the Death Plateau page
      if (stage < STAGE_STARTED) return "getting-started-talking-to-denulth-after-starting-the-quest";
      if (stage >= STAGE_COMPLETE) {
        return { page: "Denulth", variant: "standard-dialogue-after-completing-troll-stronghold" };
      }
      if (stage < STAGE_GODRIC_FREED) {
        return "entering-the-prison-talking-to-denulth-again-before-freeing-the-prisoners";
      }
      return "after-freeing-the-prisoners-talking-to-denulth";
    }
    if (npcId === TENZING_NPC_ID) return "getting-started-talking-to-tenzig";
    if (npcId === DUNSTAN_NPC_ID) {
      // Post-quest Dunstan's own page carries the 1,000-coin Law talisman reclaim.
      if (stage >= STAGE_COMPLETE) return null;
      if (stage >= STAGE_GODRIC_FREED) return "after-freeing-the-prisoners-talking-to-dunstan";
      return "getting-started-talking-to-dunstan";
    }
    // Dad's Talk-to (talkToDad) and the arena gate pick his pages themselves.
    if (npcId === DAD_NPC_ID) return null;
    if (TWIG_NPC_IDS.has(npcId)) return TWIG_KEY_VARIANT;
    if (BERRY_NPC_IDS.has(npcId)) return BERRY_KEY_VARIANT;
    return null;
  }

  /** Answer the page's prose conditions. */
  function answerCondition({ player, npcId, text }) {
    const value = String(text).toLowerCase();
    const has = (itemId, amount = 1) => held(player, itemId, amount);
    if (value.includes("combat level is lower than 50")) {
      return player.getSkillManager().getCombatLevel() < 50;
    }
    // Post-quest Dunstan's own page: the 1,000-coin Law talisman reclaim.
    if (value.includes("less than five law talismans")) {
      const banked = (player.getBanks?.() ?? []).reduce(
        (total, bank) => total + (bank?.getAmount?.(ItemIdentifiers.LAW_TALISMAN) ?? 0), 0);
      return player.getInventory().getAmount(ItemIdentifiers.LAW_TALISMAN) + banked < 5;
    }
    if (npcId === DUNSTAN_NPC_ID && value.includes("does not have enough coins")) {
      return !has(COINS_ITEM_ID, LAW_TALISMAN_PRICE);
    }
    if (npcId === DUNSTAN_NPC_ID && value.includes("does not have enough inventory space")) {
      return player.getInventory().isFull();
    }
    if (value.includes("has 12 gp")) return has(COINS_ITEM_ID, 12);
    if (value.includes("does not have enough money")) return !has(COINS_ITEM_ID, 12);
    if (value.includes("does not have level 15 agility")) return agilityLevel(player) < 15;
    if (value.includes("does not have the climbing boots equipped")) {
      return agilityLevel(player) >= 15 && !has(CLIMBING_BOOTS_ITEM_ID) && !has(SPIKED_BOOTS_ITEM_ID);
    }
    if (value.includes("succeeds in climbing up the rocks")) return agilityLevel(player) >= 15;
    if (value.includes("slips whilst climbing up the rocks")) return agilityLevel(player) < 15;
    if (value.includes("attempts to attack dad again")) return true;
    if (value.includes("attempts to talk to dad")) return true;
    if (value.includes("chooses to pickpocket twig") || value.includes("chooses to pickpocket berry")) {
      return true;
    }
    if (value.includes("succeeds in pickpocketing twig")) return true;
    if (value.includes("succeeds in pickpocketing berry")) return true;
    if (value.includes("fails to pickpocket twig") || value.includes("fails to pickpocket berry")) {
      return false;
    }
    if (value.includes("pickpockets twig again") || value.includes("pickpockets berry again")) {
      return false;
    }
    if (value.includes("attempts to open the door without a key")) {
      return !has(PRISON_KEY_ITEM_ID) && !hasBothCellKeys(player) && !godricFreed(player) && !eadgarFreed(player);
    }
    if (value.includes("uses cell key 1 or 2 on either of the doors")) {
      return false; // wrong-key attempts are answered by the door itself
    }
    if (value.includes("opens eadgar's cell with cell key 2")) {
      return npcId === EADGAR_NPC_ID && eadgarFreed(player);
    }
    if (value.includes("opens godric's cell with cell key 1")) {
      return npcId === GODRIC_NPC_ID && godricFreed(player);
    }
    return null;
  }

  /** Wiki: 15 Agility and Death Plateau. */
  const START_AGILITY_REQUIREMENT = 15;

  function meetsStartSkillRequirements(player) {
    return player.getSkillManager().getMaxLevel(Skill.AGILITY) >= START_AGILITY_REQUIREMENT;
  }

  function notifyStartSkillRequirements(player) {
    if (!meetsStartSkillRequirements(player)) {
      player.sendMessage(
        `You need an Agility level of at least ${START_AGILITY_REQUIREMENT} to start this quest.`
      );
    }
  }

  function deathPlateauComplete(player) {
    const request = { player, key: "death_plateau", complete: undefined };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!DENULTH_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) {
      if (!meetsStartSkillRequirements(player)) {
        notifyStartSkillRequirements(player);
        return;
      }
      if (!deathPlateauComplete(player)) {
        player.sendMessage("You must complete Death Plateau to start this quest.");
        return;
      }
      quest.setStage(player, STAGE_STARTED);
    }
  }

  /**
   * Wiki (Troll general drops): the prison key drops "only before completion of the
   * Troll Stronghold quest if the player doesn't have one". Once the prison door is
   * unlocked it needs no key, so it is not needed either.
   */
  function owesPrisonKey(player) {
    const stage = quest.getStage(player);
    return stage >= STAGE_DAD_KILLED && stage < STAGE_COMPLETE
      && !prisonDoorUnlocked(player) && !held(player, PRISON_KEY_ITEM_ID);
  }

  /** The general's table always lists the key; it stays off the floor for anyone not owed one. */
  function withholdPrisonKey({ player, npcId, context }) {
    if (!TROLL_GENERAL_NPC_IDS.has(npcId) || !context) return;
    if (!player || !owesPrisonKey(player)) context.handledItemIds.add(PRISON_KEY_ITEM_ID);
  }

  /** Dad's death opens the stronghold; a Troll General drops the prison key. */
  function handleNpcDeath({ killer, npcId }) {
    if (!killer) return;
    const stage = quest.getStage(killer);
    if (npcId === DAD_NPC_ID && stage >= STAGE_STARTED) {
      if (stage < STAGE_DAD_KILLED) quest.setStage(killer, STAGE_DAD_KILLED);
      return;
    }
    if (TROLL_GENERAL_NPC_IDS.has(npcId) && stage >= STAGE_DAD_KILLED && stage < STAGE_HAS_PRISON_KEY) {
      quest.setStage(killer, STAGE_HAS_PRISON_KEY);
      return;
    }
    // QH supports killing Twig/Berry when the player lacks 30 Thieving.
    if (TWIG_NPC_IDS.has(npcId) && stage >= STAGE_HAS_PRISON_KEY) {
      addCellKey(killer, CELL_KEY_1_ITEM_ID);
      return;
    }
    if (BERRY_NPC_IDS.has(npcId) && stage >= STAGE_HAS_PRISON_KEY) {
      addCellKey(killer, CELL_KEY_2_ITEM_ID);
    }
  }

  function handleAction({ player, npcId, stepId }) {
    if (npcId === DUNSTAN_NPC_ID && stepId === BUY_LAW_TALISMAN_ACTION_ID) {
      if (quest.getStage(player) < STAGE_COMPLETE) return;
      if (!held(player, COINS_ITEM_ID, LAW_TALISMAN_PRICE)) return;
      if (player.getInventory().isFull()) {
        player.getInventory().full();
        return;
      }
      const inventory = player.getInventory();
      const talismansBefore = inventory.getAmount(ItemIdentifiers.LAW_TALISMAN);
      inventory.adds(ItemIdentifiers.LAW_TALISMAN, 1);
      if (inventory.getAmount(ItemIdentifiers.LAW_TALISMAN) <= talismansBefore) {
        inventory.full();
        return;
      }
      inventory.deleteNumber(COINS_ITEM_ID, LAW_TALISMAN_PRICE);
      return;
    }
    if (npcId === DUNSTAN_NPC_ID && stepId === COMPLETE_ACTION_ID) {
      if (quest.getStage(player) >= STAGE_GODRIC_FREED && !quest.isComplete(player)) {
        quest.complete(player);
      }
      return;
    }
    if (npcId === DAD_NPC_ID && stepId === DAD_ACCEPT_ACTION_ID) {
      dadAttacks(player);
      return;
    }
    if (npcId === DAD_NPC_ID && stepId === DAD_FATAL_BLOW_ACTION_ID) {
      deliverFatalBlow(player);
      return;
    }
    if (stepId === GIVE_TWIG_KEY_MESSAGE_ID) {
      addCellKey(player, CELL_KEY_1_ITEM_ID);
      return;
    }
    if (stepId === GIVE_BERRY_KEY_MESSAGE_ID) {
      addCellKey(player, CELL_KEY_2_ITEM_ID);
    }
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    syncFreedHelperState(player);
  }

  quest = registerQuest(api, {
    key: "troll_stronghold",
    name: "Troll Stronghold",
    varpId: VARP_TROLL_STRONGHOLD,
    varpValue: (stage) => stage === STAGE_GODRIC_FREED ? 40 : stage,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [],
    rewardItemId: ItemIdentifiers.LAW_TALISMAN,
    rewardItemLabel: "Law talisman",
    otherRewards: ["Access to the Troll Stronghold"],
    buildJournal,
    onReward: grantReward,
  });

  api.persistAttribute(GODRIC_FREED_ATTRIBUTE);
  api.persistAttribute(EADGAR_FREED_ATTRIBUTE);
  api.persistAttribute(PRISON_DOOR_ATTRIBUTE, false);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcInteraction("Dad", { "Talk-to": talkToDad });
  api.onNpcAttackOption(attackDad);
  api.registerArea(createArenaArea());
  api.onNpcBeforeDeath(spareDad);
  api.onNpcInteraction("Twig", { Pickpocket: pickpocketTwig });
  api.onNpcInteraction("Berry", { Pickpocket: pickpocketBerry });
  api.onNpcsInteraction(["Godric", "Eadgar"], { "Talk-to": talkToPrisoner });
  api.onObjectInteraction("Cell Door", { Unlock: unlockCellDoor });
  api.onObjectInteraction("Cave Entrance", { Enter: enterCave });
  api.onObjectInteraction("Cave Exit", { Exit: exitCave });
  api.onObjectInteraction("Stronghold", { Enter: enterStronghold });
  api.onObjectInteraction("Exit", { Use: exitStronghold, Leave: exitStronghold, Open: leavePrison });
  api.onObjectInteraction("Secret Door", { Open: enterSecretDoor });
  api.onObjectInteraction("Prison Door", { Unlock: unlockPrisonDoor });
  api.onCustomEvent("door:toggle", guardArenaGate);
  api.onCustomEvent("npc-drops:context", withholdPrisonKey);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
};
