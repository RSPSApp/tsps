const { createQuestScenes } = require("../QuestScenes");
const { startTranscript } = require("../QuestRuntime");

const PAGE = "The Lost Tribe";
const VARIANT = "resolving-tensions-cut-scene-a-meeting-of-leaders";
const TITLE = "aZkZjG";
const COMPLETE = "_c-03w";
const TREATY_MUSIC = 410;
const HUMAN_WALK = 819;
const HUMAN_BOW = 858; // emote_bow
const HUMAN_NO = 856; // emote_no
const HUMAN_LAUGH = 861; // emote_laugh
const UR_TAG_BOW = 6000; // dttd_zanik_bow
const UR_TAG_BOW_DELAY = 20;
const ROOM_INSTANCE = { sourceChunk: [400, 401], size: 4 };
const ROOM_BOUNDS = [[3200, 3231, 3208, 3239, 0]];
const RECOVERY_ATTRIBUTE = "lost-tribe:treaty-scene-exit";
const DINING_DOOR = [3207, 3217];
const DINING_DOORWAY = [DINING_DOOR, [3207, 3218]];
const DINING_DOOR_OPEN = 1544; // elfdooropen
const DINING_DOOR_OPEN_TILE = [3207, 3218];
const DINING_DOOR_OPEN_ROTATION = 2;
const DOOR_OPEN_SOUND = 81; // nicedoor_open
// The opening fade only dims the screen; the fade back in, and the closing ones, are full.
const OPENING_FADE_ALPHA = 200;

// rsprox 20261112T152024-5ab63b4 (revision 242), ticks 1305-1376 (docs/quests/the-lost-tribe/README.md).
// Continuing Mistag's "I will summon Ur-tag" fades out; two ticks later the dining room copy opens
// with the title box (it has no continue), the treaty music and the minimap off, and a tick after
// that the camera is set and the screen fades in. Four ticks after the title the player walks five
// tiles north from the doorway and Ur-tag and Mistag follow a tick behind; the player's line comes
// ten ticks after the title, and its continue runs them two tiles on, beside the Duke.
const PLAYER_ENTRANCE = [3207, 3217];
const PLAYER_INTRO = [3207, 3222];
const PLAYER_WITNESS = [3207, 3224];
const DUKE_TILE = [3206, 3223];
const UR_TAG_START = [3207, 3216];
const UR_TAG_ARRIVAL = [3207, 3221];
const UR_TAG_TILE = [3206, 3221];
const UR_TAG_THANKS = [3207, 3223];
const MISTAG_START = [3207, 3215];
const MISTAG_TILE = [3207, 3220];
const SIGMUND_TILE = [3213, 3222];
const SIGMUND_FACING = [3214, 3222];
const SIGMUND_EXIT = [[3214, 3221], [3215, 3220], [3216, 3220]];
const PLAYER_WALK_TICK = 4;
const ESCORT_WALK_TICK = 5;
const UR_TAG_STEP_TICK = 10;
const PRESENT_TICK = 10;
// The last line's continue: Sigmund walks off, the screen fades out four ticks later (the quest
// completes then), and three ticks after that the player stands on the real map.
const CLOSING_FADE_TICKS = 4;
const CLOSING_MOVE_TICKS = 3;
const CAMERA_OPENING = { rate: 232, rate2: 232 };
const CAMERA_PAN = { rate: 1, rate2: 1 };
const CAMERA_TURN = { rate: 1, rate2: 2 };

module.exports = function createTreatyScene(api, complete) {
  const { ActionDialogue, Animation, DialogueChainBuilder, ForceMovement, GameObject, Location,
    NpcIdentifiers, ObjectIdentifiers, StatementDialogue } = api.core;
  const speakers = {
    "Duke Horacio": NpcIdentifiers.DUKE_HORACIO_2,
    "Ur-tag": NpcIdentifiers.UR_TAG_3,
    Sigmund: NpcIdentifiers.SIGMUND_15,
  };
  const active = new WeakMap();
  const Scenes = createQuestScenes(api, { recoveryAttribute: RECOVERY_ATTRIBUTE, onEnd });

  function onEnd(player, _instance, logout) {
    const scene = active.get(player);
    if (!scene) return;
    active.delete(player);
    player.setForceMovement(null);
    if (logout) return;
    player.getDialogueManager().reset();
    player.getPacketSender().sendCameraUnlock(false);
    if (scene.song >= 0) player.getPacketSender().sendSong(scene.song);
    if (scene.destination) player.moveTo(scene.destination);
    Scenes.fade(player, false);
  }

  function endAt(scene, destination) {
    scene.destination = destination;
    Scenes.end(scene.player, false);
  }

  function later(scene, ticks, action) {
    Scenes.later(scene.instance ?? scene, ticks, () => {
      if (active.get(scene.player) === scene && scene.player.isRegistered()) action();
    });
  }

  function walkActor(scene, npc, at) {
    npc.setSpawnPosition(scene.instance.area.sourceTile(...at));
    Scenes.walk(npc, at);
  }

  // The player walks north while regular movement stays locked: a tile a tick (30 cycles), or two
  // in one tick for the run beside the Duke.
  function walkPlayer(scene, at, tiles, ticks, facing) {
    const { player } = scene;
    const start = player.getLocation().clone();
    player.setForceMovement(new ForceMovement(start, new Location(0, tiles), 0, 30 * ticks, 0, HUMAN_WALK));
    later(scene, ticks, () => {
      player.setForceMovement(null);
      Scenes.place(player, at);
      Scenes.face(player, facing);
    });
  }

  // Tick 1312: the closed door goes, elfdooropen stands swung open on the room's side, nicedoor_open.
  function openDiningDoor(scene) {
    const sender = scene.player.getPacketSender();
    const { area } = scene.instance;
    if (scene.door) sender.sendObjectRemoval(scene.door);
    sender.sendObject(new GameObject(DINING_DOOR_OPEN, area.sourceTile(...DINING_DOOR_OPEN_TILE), 0, DINING_DOOR_OPEN_ROTATION, null));
    sender.sendSound(DOOR_OPEN_SOUND, 0, 0);
  }

  function play(scene, after) {
    const select = after ? (steps) => {
      const index = steps.findIndex((step) => step.id === after);
      return index === -1 ? [] : steps.slice(index + 1);
    } : undefined;
    if (!startTranscript(api, scene.player, NpcIdentifiers.DUKE_HORACIO_2, PAGE, VARIANT,
      select, scene.duke, { scoped: true })) endAt(scene, scene.origin);
  }

  function start(player) {
    if (active.has(player)) return;
    const scene = { player, origin: player.getLocation().clone(), song: player.getSession().getCurrentMusicTrack() };
    active.set(player, scene);
    Scenes.controls(player, true, true);
    Scenes.fade(player, true, undefined, OPENING_FADE_ALPHA);
    later(scene, 2, () => {
      try {
        const { origin } = scene;
        scene.instance = Scenes.open(player, "Lumbridge-Dorgeshuun Treaty", ROOM_BOUNDS, {
          canAttack: () => false,
          process(mobile) {
            if (mobile === player && scene.speaking && !player.isDyingReturn() && !Scenes.chatOpen(player)) {
              endAt(scene, origin);
            }
          },
        }, {
          instance: ROOM_INSTANCE,
          at: PLAYER_ENTRANCE,
          exit: [origin.getX(), origin.getY(), origin.getZ()],
        });
      } catch (error) {
        active.delete(player);
        Scenes.controls(player, false);
        Scenes.fade(player, false);
        throw error;
      }
      scene.duke = Scenes.actor(scene.instance, NpcIdentifiers.DUKE_HORACIO_2, DUKE_TILE);
      scene.urTag = Scenes.actor(scene.instance, NpcIdentifiers.UR_TAG_3, UR_TAG_START);
      scene.mistag = Scenes.actor(scene.instance, NpcIdentifiers.MISTAG, MISTAG_START);
      scene.sigmund = Scenes.actor(scene.instance, NpcIdentifiers.SIGMUND_15, SIGMUND_TILE);
      if (!scene.duke || !scene.urTag || !scene.mistag || !scene.sigmund) {
        endAt(scene, scene.origin);
        return;
      }
      Scenes.face(scene.duke, [DUKE_TILE[0], DUKE_TILE[1] - 1]);
      Scenes.face(scene.sigmund, [SIGMUND_TILE[0] - 1, SIGMUND_TILE[1] - 1]);
      const { area } = scene.instance;
      const door = area.resolveObject(ObjectIdentifiers.DOOR_302, area.sourceTile(...DINING_DOOR));
      const sender = player.getPacketSender();
      // The doorway is clear in the copy's collision from the start, for Ur-tag and Mistag walking
      // in behind the player; the door itself opens as the player sets off (openDiningDoor).
      scene.door = door;
      for (const tile of DINING_DOORWAY) area.removeClip?.(area.sourceTile(...tile));
      sender.sendSong(TREATY_MUSIC);
      play(scene);
      later(scene, 1, () => {
        Scenes.camera(player, [3208, 3226, 300], [3206, 3222, 100], CAMERA_OPENING);
        Scenes.fade(player, false);
      });
    });
  }

  function action(event) {
    const { player, stepId } = event;
    const scene = active.get(player);
    if (!scene?.instance || !event.pages?.some(({ page }) => page === PAGE)) return false;
    if (stepId === TITLE) {
      const title = new ActionDialogue(0, { execute: () => StatementDialogue.send(player, event.text, false) }, true);
      player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(title));
      later(scene, PLAYER_WALK_TICK, () => openDiningDoor(scene));
      later(scene, PLAYER_WALK_TICK, () => walkPlayer(scene, PLAYER_INTRO, PLAYER_INTRO[1] - PLAYER_ENTRANCE[1],
        PLAYER_INTRO[1] - PLAYER_ENTRANCE[1], DUKE_TILE));
      later(scene, ESCORT_WALK_TICK, () => {
        walkActor(scene, scene.urTag, UR_TAG_ARRIVAL);
        walkActor(scene, scene.mistag, MISTAG_TILE);
      });
      later(scene, UR_TAG_STEP_TICK, () => {
        walkActor(scene, scene.urTag, UR_TAG_TILE);
        Scenes.face(scene.mistag, DUKE_TILE);
      });
      later(scene, PRESENT_TICK, () => {
        scene.speaking = true;
        play(scene, TITLE);
      });
    } else if (stepId === COMPLETE) {
      scene.speaking = false;
      event.end = true;
      SIGMUND_EXIT.forEach((tile, index) => later(scene, index, () => walkActor(scene, scene.sigmund, tile)));
      later(scene, CLOSING_FADE_TICKS, () => {
        Scenes.fade(player, true);
        // Live completes as it fades (tick 1372); here the scene is left first, so ending it
        // cannot close the quest's reward scroll.
        later(scene, CLOSING_MOVE_TICKS, () => {
          endAt(scene, new Location(...PLAYER_WITNESS, 0));
          complete(player);
        });
      });
    } else if (event.pages?.some(({ page }) => page === PAGE) && /^(HosXce|NovY-8)$/.test(String(stepId))) {
      // The cutaway to Sigmund and the ring are the lines' own camera and the quest's reward.
    } else {
      return false;
    }
    event.handled = true;
    return true;
  }

  function line(event) {
    const scene = active.get(event.player);
    if (!scene?.speaking || !event.pages?.some(({ page }) => page === PAGE)) return;
    const { player } = scene;
    const speakerId = speakers[event.step?.speaker];
    if (speakerId) event.speakerId = speakerId;
    const text = String(event.text);
    if (event.step?.player?.startsWith("Your grace, I present")) {
      event.before = () => {
        player.performAnimation(new Animation(HUMAN_BOW));
        Scenes.camera(player, [3207, 3225, 300], [3206, 3222, 100], CAMERA_PAN);
      };
    } else if (text.startsWith("Welcome, Ur-tag")) {
      event.before = () => {
        walkPlayer(scene, PLAYER_WITNESS, PLAYER_WITNESS[1] - PLAYER_INTRO[1], 1, DUKE_TILE);
        scene.duke.performAnimation(new Animation(HUMAN_BOW));
        scene.urTag.performAnimation(new Animation(UR_TAG_BOW, UR_TAG_BOW_DELAY));
      };
    } else if (text.startsWith("I assure you")) {
      event.before = () => Scenes.camera(player, [3210, 3222, 250], [3206, 3222, 100], CAMERA_PAN);
    } else if (text.startsWith("No, let it stay")) {
      event.before = () => scene.duke.performAnimation(new Animation(HUMAN_NO));
    } else if (text.includes("Lumbridge is in your debt")) {
      event.before = () => {
        Scenes.face(scene.duke, PLAYER_WITNESS);
        Scenes.camera(player, [3213, 3222, 300], [3206, 3223, 100], CAMERA_TURN);
      };
    } else if (text.startsWith("I too thank you")) {
      event.before = () => walkActor(scene, scene.urTag, UR_TAG_THANKS);
    } else if (text.startsWith("These are strange times")) {
      event.before = () => Scenes.camera(player, [3216, 3221, 300], [3206, 3223, 100], CAMERA_PAN);
    } else if (event.step?.speaker === "Sigmund" && text.startsWith("Soon you will be destroyed")) {
      event.before = () => {
        Scenes.face(scene.sigmund, SIGMUND_FACING);
        scene.sigmund.performAnimation(new Animation(HUMAN_LAUGH));
      };
    }
  }

  return { start, action, line };
};
