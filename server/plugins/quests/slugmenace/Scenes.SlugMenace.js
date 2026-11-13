/**
 * The Slug Menace's cutscenes and the Slug Prince fight, as live plays them (RSProx capture
 * TheSlugMenace, rev 242.1; ticks below are that recording's):
 *
 * - Mayor Hobb leaves the church (ticks 2502-2525): walking by the church at native stage 7 fades
 *   out; three ticks later a copy of Witchaven (slug2_main goes to 8), Hobb (4785) appears at
 *   2720,3283 saying "Welcome to the family, Brother Maledict." overhead with jingle 228 after song
 *   147, the camera at 2711,3275 looking at 2719,3283 (rates 100), then drifting to 2711,3292 (rate
 *   4) as he walks to 2713,3289; a fade out at +12, the real map at +15 and the fade in at +21.
 * - The imposing door opens (ticks 4589-4657): the fifth rune fades out; three ticks later a copy
 *   of the cave (slug2_queen_door 1), the player one tile east, the camera at 2344,5100 (700) on
 *   2351,5096 (50), the fade in at +5, map_anim 798 at +7, the doors' seq 4822 with sounds 3033 and
 *   3030 and a camera shake at +10, the open doors (18414/18415) and Hobb (4786) teleporting in at
 *   2351,5091 (spotanim 342, sound 199) at +14. He walks to 2351,5095 and talks; the Prince (4798)
 *   appears at 2350,5088 with song 147 and jingle 229 as "You'd really like to know?" shows, and
 *   after it Hobb steps to 2350,5094, the camera to 2352,5103 (rate 5) and the Prince walks up to
 *   2351,5094 before "Behold". The tick after the last line the scene's controls come back and the
 *   Prince (now 4797, level 62) fights, with Hobb watching from 2351,5093.
 * - The Prince dies (ticks 4740-4893): he turns back to 4798 and the screen fades; three ticks later
 *   a new copy: the player at 2350,5098, the Prince at 2350,5096, Hobb at 2351,5095, the camera at
 *   2340,5100 (550) on 2350,5097 (500), the fade in. The player's blow (seq 4841) at +6, the Prince's
 *   death (seq 4830, map_anim 796) at +9, his goo (loc 18434) with map_anim 793, projectile 794 at
 *   the player and sound 3035 at +13, map_anim 792 and the player stuck (seq 4826) at +14/+16. Hobb's
 *   lines from +20; the Mother Mallum (4796) comes from 2358,5080 to 2349,5089 as they start. After
 *   "By your command" Hobb teleports out (spotanim 342, seq 1816, sound 199). Savant's three
 *   attempts: spotanim 342, then 342 with sound 3031 twice, then the Queen's seq 4842 and the
 *   player's teleport (seq 1816, spotanim 342, sound 200); the fade, Falador Park at 2997,3377
 *   (slug2_main 12 as Savant speaks again) and the fade in.
 *
 * The words are the transcript's ("The Slug Menace" page): each scene plays the lines it needs.
 * Re-entering the fight after leaving it is Ours (no capture): the open-door copy with Hobb and
 * the Prince and the transcript's "Reentering the fight" lines.
 */
const { createQuestScenes } = require("../QuestScenes");
const { loadTranscripts, startTranscript } = require("../QuestRuntime");

const PAGE = "The Slug Menace";
const SCENE_EXIT_ATTRIBUTE = "the-slug-menace:scene-exit";
const MARK = "slug-menace:scene-step";

const SILENCE_SONG = 147;

const CHURCH = {
  name: "church",
  sourceChunk: [2688 >> 3, 3264 >> 3],
  size: 8,
  bounds: [[2688, 2751, 3264, 3327, 0]],
  hobb: 4785, // slug2_hobb_cutscene
  hobbFrom: [2720, 3283, 0],
  hobbPath: [[2717, 3283, 0], [2713, 3287, 0], [2713, 3289, 0]],
  jingle: 228, // slug mayor cutscene
  variant: "the-pages-mayor-hobb-leaving-the-church",
  // Ticks from the fade out (2502).
  open: 3, show: 5, fadeOut: 12, end: 15, fadeIn: 21,
};

const DOOR = {
  name: "imposing-door",
  sourceChunk: [2328 >> 3, 5080 >> 3],
  size: 6,
  bounds: [[2328, 2375, 5080, 5127, 0]],
  exit: [2350, 5098, 0],
  doorFx: 798, // slug2_door_fx_anim
  doorFxTile: [2351, 5093, 0],
  doorSeq: 4822, // slug2_cave_door_open
  door: { id: 18413, x: 2348, y: 5093, z: 0, type: 10, face: 2 },
  openRight: { id: 18414, x: 2348, y: 5093, z: 0, type: 10, face: 0 },
  openLeft: { id: 18415, x: 2353, y: 5093, z: 0, type: 10, face: 0 },
  rumble: 3033,
  bigDoor: 3030,
  teleportGfx: 342, // teleport_other_impact
  teleportSound: 199, // tele_other_cast
  hobb: 4786, // slug2_hobb_cutscene2
  hobbFrom: [2351, 5091, 0],
  hobbTalk: [2351, 5095, 0],
  hobbAside: [2350, 5094, 0],
  hobbWatch: [2351, 5093, 0],
  /** Where the player fights from (tick 4661). */
  fightTile: [2351, 5097, 0],
  prince: 4798, // slug2_prince_noncombat
  princeFight: 4797, // slug2_the_slug_prince
  princeFrom: [2350, 5088, 0],
  princeTo: [2351, 5094, 0],
  princeJingle: 229, // slug prince cutscene
  variant: "the-imposing-door-opening-the-door-with-the-runes-and-commorb",
  reentry: "the-imposing-door-reentering-the-fight",
  splitAt: "Behold, the beauteous visage",
  princeAt: "You'd really like to know?",
  // Ticks from the fifth rune (4589).
  open: 3, camera: 4, fadeIn: 5, fx: 7, opens: 10, hobbIn: 14, talk: 20,
  // Ticks from the continue past "You'd really like to know?" (4637) to "Behold" (4644).
  behold: 7,
};

const DEATH = {
  name: "prince-death",
  exit: [2350, 5098, 0],
  playerAt: [2350, 5098, 0],
  prince: [2350, 5096, 0],
  hobb: [2351, 5095, 0],
  queen: 4796, // slug2_the_slug_queen
  queenFrom: [2358, 5080, 0],
  queenTo: [2349, 5089, 0],
  queenNear: [2349, 5092, 0],
  blowSeq: 4841, // slug2_death_blow
  deathSeq: 4830, // slug2_prince_death
  explode: 796, // slug2_exploding_prince
  goo: { id: 18434, x: 2350, y: 5096, z: 0, type: 10, face: 0 }, // slug2_slug_prince_death
  blobLaunch: 793,
  blobProjectile: 794,
  blobLand: 792,
  stuckSeq: 4826, // slug2_human_blob_stuck
  deathSound: 3035,
  queenJingle: 230, // slug queen cutscene
  queenSeq: 4842, // slug2_queen_ready_2_attack
  teleportGfx: 342,
  teleportSeq: 1816, // human_teleport_other_impact
  teleportFail: 3031, // slug2_teleport_fail
  teleportSound: 200, // teleport_all
  falador: [2997, 3377, 0],
  variant: "the-imposing-door-after-killing-the-slug-prince",
  // Ticks from the Prince's death (4741).
  open: 3, fadeIn: 4, blow: 6, die: 9, gooTick: 13, blob: 14, stuck: 16, talk: 20,
};

/**
 * Where each part of the after-killing lines starts (the transcript's text, placeholders
 * included), searched in order: "Savant!" and "[player name], are you there?" also begin earlier
 * lines, so those two must match whole.
 */
const DEATH_PARTS = [
  { prefix: "No! Do you realise" },
  { prefix: "So then, [player name], it is just us." },
  { prefix: "Come with us, [player name]." },
  { exact: "Savant!" },
  { prefix: "Ahh, [player name], it is useless" },
  { exact: "[player name], are you there?" },
];

const SPEAKERS = { "Mayor Hobb": null, "Mother Mallum": DEATH.queen, Savant: 4931 };

module.exports = function createSlugMenaceScenes(api, { onChurchOpened, onChurchDone, onFightStart, onPrinceDeathScene, onReturned, onSceneEnd } = {}) {
  const { Animation, Graphic, Location, GameObject } = api.core;
  const Scenes = createQuestScenes(api, { recoveryAttribute: SCENE_EXIT_ATTRIBUTE, onEnd: sceneEnded });
  /** Per player: the scene's actors and the step a marker runs next. */
  const plays = new Map();
  const online = (player) => player.isRegistered?.() !== false;

  function steps(variant) {
    return loadTranscripts(api)?.[PAGE]?.variants?.[variant] ?? [];
  }

  function lineIndex(list, prefix) {
    return list.findIndex((step) => typeof (step?.text ?? step?.player) === "string"
      && String(step.text ?? step.player).startsWith(prefix));
  }

  /** Plays `list` from the page, then `next` once its last line is continued (an internal marker step). */
  function play(player, npcId, variant, list, next, npc = null) {
    if (!list.length) {
      next?.();
      return false;
    }
    const state = plays.get(player) ?? {};
    state.next = next ?? null;
    plays.set(player, state);
    return startTranscript(api, player, npcId, PAGE, variant, () => [...list, { type: "action", id: MARK }], npc);
  }

  /** The internal marker: the part's lines are done, the scene goes on. */
  function marker(event) {
    if (event.stepId !== MARK) return false;
    event.handled = true;
    event.end = true;
    const state = plays.get(event.player);
    const next = state?.next;
    if (state) state.next = null;
    // The chatbox closes as live's does between the parts.
    event.player.getPacketSender().sendInterfaceRemoval?.();
    next?.();
    return true;
  }

  function sound(player, id, delay = 0) {
    player.getPacketSender().sendSound(id, 1, delay);
  }

  function mapAnim(player, scene, id, tile, delay = 0, height = 0) {
    // Set directly: Graphic's (id, delay, height) overload reads a height of 0-2 as a priority.
    const graphic = new Graphic(id);
    graphic.delay = delay;
    graphic.height = height;
    player.getPacketSender().sendGraphic(graphic, Scenes.tileFor(scene, tile));
  }

  function jingle(player, id) {
    player.getPacketSender().sendSong?.(SILENCE_SONG);
    player.getPacketSender().sendJingle(id, 0);
  }

  function sceneTile(scene, tile) {
    return Scenes.tileFor(scene, tile);
  }

  /**
   * The doors open (tick 4603: 18414 on the closed door's tile, 18415 at its east end). The copy's
   * own closed door is a template loc the world registry doesn't hold, so it is taken out first or
   * its six tiles of clipping would still bar the doorway.
   */
  function openDoors(scene) {
    const { x, y, z, type } = DOOR.door;
    const closed = scene.area?.getTemplateObject?.(sceneTile(scene, [x, y, z]), type);
    if (closed) api.core.ObjectManager.deregister(closed, true);
    Scenes.loc(scene, DOOR.openRight);
    Scenes.loc(scene, DOOR.openLeft);
  }

  /** The chathead a cutscene line's speaker shows: the scene's own Hobb, the Queen, Savant. */
  function speakerFor(player, name) {
    const state = plays.get(player);
    if (!state || !Scenes.get(player) && !state.falador) return undefined;
    if (name === "Mayor Hobb") return state.hobbId;
    return SPEAKERS[name] ?? undefined;
  }

  // ==========================================================================
  // Mayor Hobb leaves the church
  // ==========================================================================

  function church(player) {
    if (Scenes.get(player) || plays.get(player)?.church) return;
    plays.set(player, { church: true });
    Scenes.fade(player, true);
    Scenes.controls(player, true);
    Scenes.later(player, CHURCH.open, () => { if (online(player)) openChurch(player); });
  }

  function openChurch(player) {
    const at = [player.getLocation().getX(), player.getLocation().getY(), 0];
    const scene = Scenes.open(player, CHURCH.name, CHURCH.bounds, {}, {
      instance: { sourceChunk: CHURCH.sourceChunk, size: CHURCH.size }, at, exit: at,
    });
    Scenes.controls(player, true, true);
    Scenes.hideTabs(player);
    onChurchOpened?.(player);
    Scenes.later(scene, CHURCH.show - CHURCH.open, () => {
      const [x, y, z] = CHURCH.hobbFrom;
      const hobb = Scenes.actor(scene, CHURCH.hobb, CHURCH.hobbFrom, [x, y - 1, z]);
      const line = steps(CHURCH.variant).find((step) => step?.presentation === "overhead" && step.text);
      if (hobb && line) hobb.forceChat(line.text);
      jingle(player, CHURCH.jingle);
      Scenes.camera(player, [2711, 3275, 500], [2719, 3283, 500], { rate: 100, rate2: 100 });
      Scenes.fade(player, false);
      Scenes.later(scene, 1, () => {
        Scenes.camera(player, [2711, 3292, 600], [2719, 3283, 500], { rate: 4, rate2: 4 });
        for (const tile of CHURCH.hobbPath) Scenes.walk(hobb, tile);
      });
    });
    Scenes.later(scene, CHURCH.fadeOut - CHURCH.open, () => Scenes.fade(player, true));
    Scenes.later(scene, CHURCH.end - CHURCH.open, () => {
      Scenes.end(player, false);
      player.moveTo(new Location(...at));
      Scenes.controls(player, true);
      Scenes.later(player, CHURCH.fadeIn - CHURCH.end, () => {
        Scenes.controls(player, false);
        Scenes.restoreTabs(player);
        Scenes.fade(player, false);
        plays.delete(player);
        onChurchDone?.(player);
      });
    });
  }

  // ==========================================================================
  // The imposing door and the Slug Prince
  // ==========================================================================

  function openDoor(player) {
    if (Scenes.get(player)) return;
    plays.set(player, { hobbId: DOOR.hobb });
    Scenes.fade(player, true);
    Scenes.controls(player, true);
    Scenes.later(player, DOOR.open, () => { if (online(player)) openDoorScene(player, false); });
  }

  /** Live moves the player a tile east as the copy opens (tick 4592); re-entering starts at the fight tile. */
  function doorScene(player, reentry) {
    const at = player.getLocation();
    const stand = reentry ? DOOR.fightTile : [at.getX() + 1, at.getY(), 0];
    const scene = Scenes.open(player, DOOR.name, DOOR.bounds, doorRules(player), {
      instance: { sourceChunk: DOOR.sourceChunk, size: DOOR.size }, at: stand, exit: DOOR.exit,
    });
    Scenes.controls(player, true, true);
    Scenes.hideTabs(player);
    return scene;
  }

  /** Inside the copy only the Prince fights, and only its owner. */
  function doorRules(player) {
    return {
      canAttack: (attacker, target) => {
        const prince = plays.get(player)?.prince;
        if (!prince) return null;
        return (attacker === player && target === prince) || (attacker === prince && target === player) ? true : false;
      },
      npcAggression: () => false,
      // Ours: a teleport out of the fight (the copy goes; the door lets the player back in).
      canTeleport: () => true,
    };
  }

  function openDoorScene(player, reentry) {
    const scene = doorScene(player, reentry);
    const state = plays.get(player) ?? { hobbId: DOOR.hobb };
    state.hobbId = DOOR.hobb;
    plays.set(player, state);
    const at = (tick) => tick - DOOR.open;
    if (reentry) {
      openDoors(scene);
      state.hobb = Scenes.actor(scene, DOOR.hobb, DOOR.hobbAside, [2351, 5097]);
      state.princeActor = Scenes.actor(scene, DOOR.prince, DOOR.princeTo, [2351, 5097]);
      Scenes.camera(player, [2352, 5103, 700], [2351, 5096, 50], { rate: 100, rate2: 100 });
      Scenes.fade(player, false);
      const list = steps(DOOR.reentry).filter((step) => step?.type !== "action");
      Scenes.later(scene, 2, () => play(player, DOOR.hobb, DOOR.reentry, list, () => fight(player, scene), state.hobb));
      return;
    }
    Scenes.later(scene, at(DOOR.camera), () =>
      Scenes.camera(player, [2344, 5100, 700], [2351, 5096, 50], { rate: 100, rate2: 100 }));
    Scenes.later(scene, at(DOOR.fadeIn), () => Scenes.fade(player, false));
    Scenes.later(scene, at(DOOR.fx), () => mapAnim(player, scene, DOOR.doorFx, DOOR.doorFxTile, 1));
    Scenes.later(scene, at(DOOR.opens), () => {
      const { id, x, y, z, type, face } = DOOR.door;
      const object = new GameObject(id, sceneTile(scene, [x, y, z]), type, face, scene.area);
      player.getPacketSender().sendObjectAnimation(object, new Animation(DOOR.doorSeq));
      sound(player, DOOR.rumble);
      sound(player, DOOR.bigDoor);
      player.getPacketSender().sendCameraShake?.(0, 6, 0, 0);
    });
    Scenes.later(scene, at(DOOR.hobbIn), () => {
      player.getPacketSender().sendCameraReset?.();
      Scenes.camera(player, [2344, 5100, 700], [2351, 5096, 50], { rate: 100, rate2: 100 });
      openDoors(scene);
      const [x, y, z] = DOOR.hobbFrom;
      state.hobb = Scenes.actor(scene, DOOR.hobb, DOOR.hobbFrom, [x, y + 1, z]);
      state.hobb?.performGraphic?.(new Graphic(DOOR.teleportGfx, 92));
      sound(player, DOOR.teleportSound);
      Scenes.later(scene, 3, () => Scenes.walk(state.hobb, DOOR.hobbTalk));
    });
    Scenes.later(scene, at(DOOR.talk), () => {
      const list = steps(DOOR.variant).filter((step) => step?.type !== "action");
      const split = lineIndex(list, DOOR.splitAt);
      const first = split < 0 ? list : list.slice(0, split);
      const rest = split < 0 ? [] : list.slice(split);
      play(player, DOOR.hobb, DOOR.variant, first, () => princeWalksUp(player, scene, rest), state.hobb);
    });
  }

  /** The line event's hook: the Prince appears as "You'd really like to know?" shows. */
  function doorLine(player, text) {
    const state = plays.get(player);
    const scene = Scenes.get(player);
    if (!state || scene?.name !== DOOR.name || state.princeActor || !String(text).startsWith(DOOR.princeAt)) return null;
    return () => {
      state.princeActor = Scenes.actor(scene, DOOR.prince, DOOR.princeFrom, [2351, 5097]);
      jingle(player, DOOR.princeJingle);
    };
  }

  function princeWalksUp(player, scene, rest) {
    const state = plays.get(player);
    // The player stands back for the fight (2351,5097 at tick 4661; Ours: when it moves).
    Scenes.place(player, DOOR.fightTile);
    Scenes.walk(state?.hobb, DOOR.hobbAside);
    Scenes.camera(player, [2352, 5103, 700], [2351, 5096, 50], { rate: 5, rate2: 5 });
    if (state?.princeActor) {
      Scenes.walk(state.princeActor, [2351, 5089, 0]);
      Scenes.walk(state.princeActor, DOOR.princeTo);
    }
    Scenes.later(scene, DOOR.behold, () => play(player, DOOR.hobb, DOOR.variant, rest, () => fight(player, scene), state?.hobb));
  }

  /** The tick after the last line: controls back, Hobb watches, the Prince (level 62) fights. */
  function fight(player, scene) {
    const state = plays.get(player);
    if (!state || Scenes.get(player) !== scene) return;
    Scenes.walk(state.hobb, DOOR.hobbWatch);
    Scenes.later(scene, 1, () => {
      Scenes.controls(player, false);
      Scenes.restoreTabs(player);
      Scenes.closeFade(player);
      player.getPacketSender().sendCameraReset();
      const tile = state.princeActor?.getLocation?.() ?? sceneTile(scene, DOOR.princeTo);
      const source = Scenes.toSource(player, tile);
      if (state.princeActor) Scenes.removeActor(scene, state.princeActor);
      state.princeActor = null;
      state.prince = Scenes.actor(scene, DOOR.princeFight, [source.getX(), source.getY(), 0], [2351, 5097]);
      onFightStart?.(player, state.prince);
      state.prince?.getCombat?.()?.attack?.(player);
    });
  }

  function reenterFight(player) {
    if (Scenes.get(player)) return;
    plays.set(player, { hobbId: DOOR.hobb });
    Scenes.fade(player, true);
    Scenes.controls(player, true);
    Scenes.later(player, DOOR.open, () => { if (online(player)) openDoorScene(player, true); });
  }

  function princeOf(player) {
    return plays.get(player)?.prince ?? null;
  }

  // ==========================================================================
  // The Prince's death, the Mother Mallum and Savant's teleport
  // ==========================================================================

  function princeDied(player) {
    const state = plays.get(player);
    if (!state || state.dying) return;
    state.dying = true;
    state.prince = null;
    Scenes.fade(player, true);
    Scenes.controls(player, true);
    Scenes.later(player, DEATH.open, () => { if (online(player)) openDeath(player); });
  }

  function openDeath(player) {
    const scene = Scenes.open(player, DEATH.name, DOOR.bounds, {}, {
      instance: { sourceChunk: DOOR.sourceChunk, size: DOOR.size }, at: DEATH.playerAt, exit: DEATH.exit,
    });
    const state = { hobbId: DOOR.hobb, dying: true };
    plays.set(player, state);
    Scenes.controls(player, true, true);
    Scenes.hideTabs(player);
    onPrinceDeathScene?.(player);
    Scenes.face(player, [DEATH.prince[0], DEATH.prince[1]]);
    openDoors(scene);
    const prince = Scenes.actor(scene, DOOR.prince, DEATH.prince, [DEATH.playerAt[0], DEATH.playerAt[1]]);
    state.hobb = Scenes.actor(scene, DOOR.hobb, DEATH.hobb, [DEATH.prince[0], DEATH.prince[1]]);
    const at = (tick) => tick - DEATH.open;
    Scenes.later(scene, at(DEATH.fadeIn), () => {
      Scenes.camera(player, [2340, 5100, 550], [2350, 5097, 500]);
      Scenes.fade(player, false);
    });
    Scenes.later(scene, at(DEATH.blow), () => player.performAnimation(new Animation(DEATH.blowSeq)));
    Scenes.later(scene, at(DEATH.die), () => {
      prince?.performAnimation?.(new Animation(DEATH.deathSeq));
      mapAnim(player, scene, DEATH.explode, DEATH.prince, 2);
    });
    Scenes.later(scene, at(DEATH.gooTick), () => {
      if (prince) Scenes.removeActor(scene, prince);
      Scenes.loc(scene, DEATH.goo);
      mapAnim(player, scene, DEATH.blobLaunch, DEATH.prince, 0, 1);
      player.getPacketSender().sendProjectile(sceneTile(scene, DEATH.prince), player.getLocation(), 0, 26,
        DEATH.blobProjectile, 150, 150, player, 30, 22, 10);
      sound(player, DEATH.deathSound);
    });
    Scenes.later(scene, at(DEATH.blob), () => mapAnim(player, scene, DEATH.blobLand, DEATH.playerAt, 23));
    Scenes.later(scene, at(DEATH.stuck), () => player.performAnimation(new Animation(DEATH.stuckSeq, 23)));
    Scenes.later(scene, at(DEATH.talk), () => deathPart(player, scene, 0));
  }

  function deathParts() {
    const list = steps(DEATH.variant).filter((step) => step?.type !== "action");
    const textOf = (step) => String(step?.text ?? step?.player ?? "");
    const starts = [];
    let from = 0;
    for (const part of DEATH_PARTS) {
      const index = list.findIndex((step, at) => at >= from
        && (part.exact !== undefined ? textOf(step) === part.exact : textOf(step).startsWith(part.prefix)));
      starts.push(index);
      if (index >= 0) from = index + 1;
    }
    return starts.map((start, index) => {
      if (start < 0) return [];
      const end = starts.slice(index + 1).find((next) => next > start) ?? list.length;
      return list.slice(start, end);
    });
  }

  function deathPart(player, scene, index) {
    const state = plays.get(player);
    if (!state || Scenes.get(player) !== scene) return;
    const parts = deathParts();
    const speaker = index === 0 ? DOOR.hobb : index === 5 ? 4931 : DEATH.queen;
    const after = {
      0: () => {
        // "By your command": Hobb teleports out.
        state.hobb?.performGraphic?.(new Graphic(DEATH.teleportGfx, 92));
        state.hobb?.performAnimation?.(new Animation(DEATH.teleportSeq));
        sound(player, DOOR.teleportSound);
        Scenes.later(scene, 2, () => { if (state.hobb) Scenes.removeActor(scene, state.hobb); state.hobb = null; });
        Scenes.later(scene, 3, () => Scenes.walk(state.queen, DEATH.queenNear));
        Scenes.later(scene, 4, () => {
          Scenes.camera(player, [2349, 5100, 400], [2350, 5094, 300], { rate: 1, rate2: 1 });
          deathPart(player, scene, 1);
        });
      },
      1: () => {
        // "Initiating emergency teleport."
        player.performGraphic(new Graphic(DEATH.teleportGfx, 92));
        Scenes.later(scene, 4, () => deathPart(player, scene, 2));
      },
      2: () => {
        player.performGraphic(new Graphic(DEATH.teleportGfx, 92));
        sound(player, DEATH.teleportFail);
        Scenes.later(scene, 4, () => deathPart(player, scene, 3));
      },
      3: () => Scenes.later(scene, 1, () => {
        player.performGraphic(new Graphic(DEATH.teleportGfx, 92));
        sound(player, DEATH.teleportFail);
        deathPart(player, scene, 4);
      }),
      4: () => Scenes.later(scene, 1, () => {
        state.queen?.performAnimation?.(new Animation(DEATH.queenSeq));
        Scenes.later(scene, 1, () => {
          player.performAnimation(new Animation(DEATH.teleportSeq));
          player.performGraphic(new Graphic(DEATH.teleportGfx, 92));
          sound(player, DEATH.teleportSound);
        });
        Scenes.later(scene, 3, () => Scenes.fade(player, true));
        Scenes.later(scene, 6, () => toFalador(player));
      }),
    }[index];
    play(player, speaker, DEATH.variant, parts[index] ?? [], after, index === 0 ? state.hobb : null);
  }

  /** The Queen comes as Hobb's first line shows; her jingle with "Calm yourself". */
  function deathLine(player, text) {
    const state = plays.get(player);
    const scene = Scenes.get(player);
    if (!state || scene?.name !== DEATH.name) return null;
    if (String(text).startsWith(DEATH_PARTS[0].prefix) && !state.queen) {
      return () => Scenes.later(scene, 1, () => {
        state.queen = Scenes.actor(scene, DEATH.queen, DEATH.queenFrom, [DEATH.playerAt[0], DEATH.playerAt[1]]);
        Scenes.walk(state.queen, DEATH.queenTo);
      });
    }
    if (String(text).startsWith("Calm yourself")) return () => jingle(player, DEATH.queenJingle);
    return null;
  }

  function toFalador(player) {
    const state = plays.get(player) ?? {};
    state.falador = true;
    plays.set(player, state);
    Scenes.end(player, false);
    player.moveTo(new Location(...DEATH.falador));
    Scenes.controls(player, true);
    Scenes.later(player, 7, () => {
      Scenes.restoreTabs(player);
      Scenes.fade(player, false);
      Scenes.later(player, 2, () => {
        onReturned?.(player);
        const parts = deathParts();
        play(player, 4931, DEATH.variant, parts[5] ?? [], () => {
          Scenes.controls(player, false);
          plays.delete(player);
        });
      });
    });
  }

  // ==========================================================================

  function sceneEnded(player, scene, logout) {
    const state = plays.get(player);
    // The Falador leg keeps its state; a scene left any other way drops it.
    if (state && !state.falador && !(scene.name === DOOR.name && state.dying)) plays.delete(player);
    onSceneEnd?.(player, scene, logout);
  }

  function interrupted({ player }) {
    Scenes.cancel(player);
    plays.delete(player);
  }

  function lineHook(player, text) {
    return doorLine(player, text) ?? deathLine(player, text);
  }

  return {
    church, openDoor, reenterFight, princeDied, princeOf, marker, lineHook, speakerFor, interrupted, deathParts,
    inScene: (player) => Scenes.get(player)?.name ?? null,
    busy: (player) => plays.has(player) || Scenes.get(player) !== null,
    SCENE_EXIT_ATTRIBUTE, DOOR, DEATH, CHURCH,
  };
};
