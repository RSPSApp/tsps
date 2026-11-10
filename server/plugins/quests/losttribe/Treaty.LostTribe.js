const { createQuestScenes } = require("../QuestScenes");
const { startTranscript } = require("../QuestRuntime");

const PAGE = "The Lost Tribe";
const VARIANT = "resolving-tensions-cut-scene-a-meeting-of-leaders";
const TITLE = "aZkZjG";
const CUTAWAY = "HosXce";
const COMPLETE = "_c-03w";
const TREATY_MUSIC = 410;
const HUMAN_WALK = 819;
const HUMAN_BOW = 858;
const CAVE_GOBLIN_BOW = 2122;
const ROOM_INSTANCE = { sourceChunk: [400, 401], size: 4 };
const ROOM_BOUNDS = [[3200, 3231, 3208, 3239, 0]];
const RECOVERY_ATTRIBUTE = "lost-tribe:treaty-scene-exit";
const DINING_DOOR = [3207, 3217];
const PLAYER_ENTRANCE = [3207, 3218];
const PLAYER_INTRO = [3207, 3220];
const PLAYER_WITNESS = [3207, 3223];
const DUKE_TILE = [3206, 3222];
const UR_TAG_TILE = [3206, 3220];

// The live scene opens by the fireplace, then pans across the dining table to the doors.
// OSRS Quest Guides (2025) 8:22–8:35 and Slayermusiq1 (2015) 17:28–17:44.
module.exports = function createTreatyScene(api, complete) {
  const { ActionDialogue, Animation, DialogueChainBuilder, ForceMovement, Location,
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

  // The player takes two short northbound walks while regular movement stays locked.
  function walkPlayer(scene, at, tiles, facing) {
    const { player } = scene;
    const start = player.getLocation().clone();
    player.setForceMovement(new ForceMovement(start, new Location(0, tiles), 0, 30 * tiles, 0, HUMAN_WALK));
    later(scene, tiles, () => {
      player.setForceMovement(null);
      Scenes.place(player, at);
      Scenes.face(player, facing);
    });
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
    Scenes.fade(player, true);
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
      scene.urTag = Scenes.actor(scene.instance, NpcIdentifiers.UR_TAG_3, [3206, 3218]);
      scene.mistag = Scenes.actor(scene.instance, NpcIdentifiers.MISTAG, PLAYER_ENTRANCE);
      scene.sigmund = Scenes.actor(scene.instance, NpcIdentifiers.SIGMUND_15, [3214, 3222]);
      if (!scene.duke || !scene.urTag || !scene.mistag || !scene.sigmund) {
        endAt(scene, scene.origin);
        return;
      }
      Scenes.face(scene.duke, UR_TAG_TILE);
      Scenes.face(scene.sigmund, [3213, 3222]);
      later(scene, 1, () => {
        const { area } = scene.instance;
        const door = area.resolveObject(ObjectIdentifiers.DOOR_302, area.sourceTile(...DINING_DOOR));
        const sender = player.getPacketSender();
        // The copy starts with the dining entrance open, as the party comes through it.
        if (door) sender.sendObjectRemoval(door);
        sender.sendSong(TREATY_MUSIC);
        Scenes.camera(player, [3209, 3225, 310], [3206, 3220, 100]);
        Scenes.fade(player, false);
        play(scene);
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
      walkPlayer(scene, PLAYER_INTRO, 2, DUKE_TILE);
      walkActor(scene, scene.urTag, UR_TAG_TILE);
      walkActor(scene, scene.mistag, [3207, 3219]);
      later(scene, 6, () => {
        Scenes.face(scene.urTag, DUKE_TILE);
        Scenes.face(scene.mistag, DUKE_TILE);
        scene.speaking = true;
        play(scene, TITLE);
      });
    } else if (stepId === CUTAWAY) {
      // The east hallway is between the dining doors at x=3213 and the wall at x=3217.
      Scenes.camera(player, [3216, 3224, 265], [3214, 3222, 105], { rate: 14, rate2: 9 });
    } else if (stepId === COMPLETE) {
      scene.speaking = false;
      event.end = true;
      Scenes.fade(player, true);
      later(scene, 2, () => {
        endAt(scene, new Location(...PLAYER_WITNESS, 0));
        complete(player);
      });
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
    if (event.step?.player?.startsWith("Your grace, I present")) {
      event.before = () => player.performAnimation(new Animation(HUMAN_BOW));
    } else if (event.text.startsWith("Welcome, Ur-tag")) {
      event.before = () => {
        walkPlayer(scene, PLAYER_WITNESS, 3, DUKE_TILE);
        scene.duke.performAnimation(new Animation(HUMAN_BOW));
        later(scene, 2, () => scene.urTag.performAnimation(new Animation(CAVE_GOBLIN_BOW)));
      };
    } else if (event.text.includes("Lumbridge is in your debt")) {
      event.before = () => {
        Scenes.face(scene.duke, PLAYER_WITNESS);
        Scenes.camera(player, [3210, 3222, 290], [3206, 3222, 100], { rate: 8, rate2: 8 });
      };
    } else if (event.text.startsWith("I too thank you")) {
      event.before = () => Scenes.face(scene.urTag, PLAYER_WITNESS);
    } else if (event.step?.speaker === "Sigmund" && event.text.startsWith("Prattle on")) {
      event.holdTicks = 3;
    }
  }

  return { start, action, line };
};
