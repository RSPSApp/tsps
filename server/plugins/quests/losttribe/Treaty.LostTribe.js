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
const SOURCE_X = 3200;
const SOURCE_Y = 3208;
const SIZE = 4;
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
    NpcIdentifiers, ObjectIdentifiers, StatementDialogue, TaskManager, TemplatedInstanceArea } = api.core;
  const speakers = {
    "Duke Horacio": NpcIdentifiers.DUKE_HORACIO_2,
    "Ur-tag": NpcIdentifiers.UR_TAG_3,
    Sigmund: NpcIdentifiers.SIGMUND_15,
  };
  const Scenes = createQuestScenes(api);
  const active = new WeakMap();

  class TreatyRoom extends TemplatedInstanceArea {
    constructor(scene) {
      super(SIZE, SIZE);
      this.scene = scene;
      this.copySquare(SIZE, SOURCE_X / 8, SOURCE_Y / 8, 0, 0, 0, 0, 0);
    }

    sourceTile([x, y]) { return this.tile(x - SOURCE_X, y - SOURCE_Y, 0); }
    getName() { return "Lumbridge-Dorgeshuun Treaty"; }
    canTeleport() { return false; }
    canAttack() { return false; }
    npcAggression() { return false; }

    process(mobile) {
      const { player, speaking } = this.scene;
      if (mobile === player && speaking && !Scenes.chatOpen(player)) this.leave(player, false);
    }

    postLeave(mobile, logout) {
      const scene = this.scene;
      super.postLeave(mobile, logout);
      if (mobile !== scene.player || active.get(mobile) !== scene) return;
      active.delete(mobile);
      TaskManager.cancelTasks(scene);
      mobile.setForceMovement(null);
      Scenes.controls(mobile, false);
      if (logout) {
        mobile.setLocation(scene.origin);
        return;
      }
      mobile.getDialogueManager().reset();
      mobile.getPacketSender().sendCameraUnlock(false).sendCameraReset();
      if (scene.song >= 0) mobile.getPacketSender().sendSong(scene.song);
      if (this.contains(mobile.getLocation())) mobile.moveTo(scene.exit ?? scene.origin);
      Scenes.fade(mobile, false);
    }
  }

  function later(scene, ticks, action) {
    Scenes.later(scene, ticks, () => {
      if (active.get(scene.player) === scene && scene.player.isRegistered()) action();
    });
  }

  function face(scene, mobile, target) {
    mobile.setPositionToFace(scene.room.sourceTile(target));
  }

  function actor(scene, id, at) {
    const tile = scene.room.sourceTile(at);
    const npc = api.spawnNpc({ id, x: tile.getX(), y: tile.getY(), z: 0,
      owner: scene.player, ownerOnly: true, wanderRadius: 0 });
    if (npc) {
      npc.__skipDefaultRespawn = true;
      scene.room.add(npc);
    }
    return npc;
  }

  function walkActor(scene, npc, at) {
    const to = scene.room.sourceTile(at);
    npc.setSpawnPosition(to);
    npc.getMovementQueue().addSteps(to);
  }

  // The player takes two short northbound walks while regular movement stays locked.
  function walkPlayer(scene, at, tiles, facing) {
    const { player } = scene;
    const start = player.getLocation().clone();
    player.setForceMovement(new ForceMovement(start, new Location(0, tiles), 0, 30 * tiles, 0, HUMAN_WALK));
    later(scene, tiles, () => {
      player.setForceMovement(null);
      player.moveTo(scene.room.sourceTile(at));
      face(scene, player, facing);
    });
  }

  function camera(scene, from, look, rates) {
    const position = scene.room.sourceTile(from);
    const target = scene.room.sourceTile(look);
    Scenes.camera(scene.player, [position.getX(), position.getY(), from[2]],
      [target.getX(), target.getY(), look[2]], rates);
  }

  function play(scene, after) {
    const select = after ? (steps) => {
      const index = steps.findIndex((step) => step.id === after);
      return index === -1 ? [] : steps.slice(index + 1);
    } : undefined;
    if (!startTranscript(api, scene.player, NpcIdentifiers.DUKE_HORACIO_2, PAGE, VARIANT,
      select, scene.duke, { scoped: true })) scene.room.leave(scene.player, false);
  }

  function start(player) {
    if (active.has(player)) return;
    const scene = { player, origin: player.getLocation().clone(), song: player.getSession().getCurrentMusicTrack() };
    active.set(player, scene);
    Scenes.controls(player, true, true);
    Scenes.fade(player, true);
    later(scene, 2, () => {
      try {
        scene.room = new TreatyRoom(scene);
      } catch (error) {
        active.delete(player);
        Scenes.controls(player, false);
        Scenes.fade(player, false);
        throw error;
      }
      scene.room.enter(player);
      player.moveTo(scene.room.sourceTile(PLAYER_ENTRANCE));
      scene.duke = actor(scene, NpcIdentifiers.DUKE_HORACIO_2, DUKE_TILE);
      scene.urTag = actor(scene, NpcIdentifiers.UR_TAG_3, [3206, 3218]);
      scene.mistag = actor(scene, NpcIdentifiers.MISTAG, PLAYER_ENTRANCE);
      scene.sigmund = actor(scene, NpcIdentifiers.SIGMUND_15, [3214, 3222]);
      if (!scene.duke || !scene.urTag || !scene.mistag || !scene.sigmund) {
        scene.room.leave(player, false);
        return;
      }
      face(scene, scene.duke, UR_TAG_TILE);
      face(scene, scene.sigmund, [3213, 3222]);
      later(scene, 1, () => {
        const door = scene.room.resolveObject(ObjectIdentifiers.DOOR_302, scene.room.sourceTile(DINING_DOOR));
        const sender = player.getPacketSender();
        // The copy starts with the dining entrance open, as the party comes through it.
        if (door) sender.sendObjectRemoval(door);
        sender.sendSong(TREATY_MUSIC);
        camera(scene, [3209, 3225, 310], [3206, 3220, 100]);
        Scenes.fade(player, false);
        play(scene);
      });
    });
  }

  function action(event) {
    const { player, stepId } = event;
    const scene = active.get(player);
    if (!scene?.room || !event.pages?.some(({ page }) => page === PAGE)) return false;
    if (stepId === TITLE) {
      const title = new ActionDialogue(0, { execute: () => StatementDialogue.send(player, event.text, false) }, true);
      player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(title));
      walkPlayer(scene, PLAYER_INTRO, 2, DUKE_TILE);
      walkActor(scene, scene.urTag, UR_TAG_TILE);
      walkActor(scene, scene.mistag, [3207, 3219]);
      later(scene, 6, () => {
        face(scene, scene.urTag, DUKE_TILE);
        face(scene, scene.mistag, DUKE_TILE);
        scene.speaking = true;
        play(scene, TITLE);
      });
    } else if (stepId === CUTAWAY) {
      // The east hallway is between the dining doors at x=3213 and the wall at x=3217.
      camera(scene, [3216, 3224, 265], [3214, 3222, 105], { rate: 14, rate2: 9 });
    } else if (stepId === COMPLETE) {
      scene.speaking = false;
      event.end = true;
      Scenes.fade(player, true);
      later(scene, 2, () => {
        scene.exit = new Location(...PLAYER_WITNESS, 0);
        scene.room.leave(player, false);
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
        face(scene, scene.duke, PLAYER_WITNESS);
        camera(scene, [3210, 3222, 290], [3206, 3222, 100], { rate: 8, rate2: 8 });
      };
    } else if (event.text.startsWith("I too thank you")) {
      event.before = () => face(scene, scene.urTag, PLAYER_WITNESS);
    } else if (event.step?.speaker === "Sigmund" && event.text.startsWith("Prattle on")) {
      event.holdTicks = 3;
    }
  }

  return { start, action, line };
};
