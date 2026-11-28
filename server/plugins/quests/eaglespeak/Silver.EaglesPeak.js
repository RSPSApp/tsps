/**
 * The silver feather's room, as the capture plays it (RSProx, rev 243, t1211-1326), in a copy of the map per visit.
 * eaglepeak_puzzle2_tracking (3099) is the trail; the room's footprints are the map's own multilocs on it, so the
 * client draws each stretch as the value reaches it.
 * - the tunnel (19903, 1986,4972,3): "You enter the tunnel.", 3112 set, the copy at 1947,4868,2; out by 19900
 *   (1947,4867) to 1987,4972,3;
 * - the pedestal (19473, 1947,4873): Inspect, 3099 0 -> 1 with the footprints' box (t1217); again, the "no
 *   further clues" box; under 27 Hunter (the Wiki), its low-level box and nothing set;
 * - the rocks: hunting_searching_bushes, then two ticks on the box and hunting_search; the first (19458,
 *   1961,4875) at 1 sets 2, the second (19461, 1967,4879) at 2 sets 3 (t1225-1245); the rest are rock;
 * - the opening (19456, 1971,4886) at 3: the camera over the tunnel, the search a tick on, the peer line, then
 *   3099 = 4 with a shake and a rumble, and the kebbit (1494) jumping out to 1971,4881 (its projanim 965 and
 *   spotanim 966) as the player stumbles back saying "Er..." (t1253-1261);
 * - the kebbit: Attack is a real fight (Wiki: level 13, 50 hitpoints, max hit 1; it drops bones and the
 *   feather); Threaten is "Hey, give me that!" said and shown, the stare's box and the menu: Taunt plays the two
 *   lines and it scurries back into the tunnel a tile a tick, dropping the silver feather (owner only) at
 *   1971,4885 with 3099 = 5 (t1273-1299); "Try something else." ends the talk;
 * - the opening after: the tunnel is too thin, or, without the feather, it is found again (Transcript).
 */
module.exports = function attachEaglesPeakSilver(api, ep) {
  const { state, TEXT, Scenes } = ep;
  const { STAGE, VARBIT, TRACK, ITEM, NPC } = state;
  const { Item, Location, Graphic, DialogueChainBuilder, PlayerDialogue, StatementDialogue, ActionDialogue, ForceMovement,
    ForceMovementTask, TaskManager, CacheDefinitions, Skill } = api.core;

  const SCENE = "eagles-peak-silver";
  const ROOM = Object.freeze({
    instance: { sourceChunk: [1920 >> 3, 4864 >> 3], size: 13 },
    bounds: [[1920, 1985, 4864, 4890, 2]],
    at: [1947, 4868, 2],
    exit: [1987, 4972, 3],
  });
  const LOC = Object.freeze({ ENTRANCE: 19903, EXIT: 19900, PEDESTAL: 19473, ROCK_1: 19458, ROCK_2: 19461, OPENING: 19456 });
  const WRONG_ROCKS = new Set([19464, 19467, 19470]);
  const HUNTER_REQUIREMENT = 27;
  const SEQ = Object.freeze({ SEARCH: 5216, STUMBLE: 5293, BECKON: 864 });
  const SOUND = Object.freeze({ SEARCH: 2643, RUMBLING: 1678, KEBBIT_APPEAR: 1501, FALL_LAND: 2455 });
  const SPOT = Object.freeze({ PROJECTILE: 965, LANDING: 966 });
  const KEBBIT_TILE = Object.freeze([1971, 4881, 2]);
  const DROP_TILE = Object.freeze([1971, 4885, 2]);
  const OPENING_TILE = Object.freeze([1971, 4886, 2]);
  const CAMERA = Object.freeze({ move: [1964, 4886, 600], look: [1970, 4883, 100] });
  /** The kebbit's escape (t1293-1299): a tile a tick from where it stands to the tunnel's mouth. */
  const ESCAPE_TICKS_PER_TILE = 1;

  const inRoom = (player) => Scenes.get(player)?.name === SCENE;
  const tracking = (player) => state.get(player, VARBIT.TRACKING);
  const seq = (name) => CacheDefinitions.getSeqId(name);

  function enter(event) {
    if (event.objectId !== LOC.ENTRANCE) return false;
    const { player } = event;
    if (state.stage(player) < STAGE.CAVE_OPEN) return false;
    player.sendMessage(TEXT.TUNNEL);
    if (!state.get(player, VARBIT.ENTERED_SILVER)) state.set(player, VARBIT.ENTERED_SILVER, 1);
    Scenes.open(player, SCENE, ROOM.bounds, { canTeleport: () => null, npcAggression: () => null },
      { instance: ROOM.instance, at: ROOM.at, exit: ROOM.exit });
    return true;
  }

  function leave(event) {
    if (event.objectId !== LOC.EXIT || !inRoom(event.player)) return false;
    const { player } = event;
    player.sendMessage(TEXT.TUNNEL);
    Scenes.end(player, false);
    player.moveTo(new Location(...ROOM.exit));
    return true;
  }

  function inspectPedestal(event) {
    if (event.objectId !== LOC.PEDESTAL || !inRoom(event.player)) return false;
    const { player } = event;
    if (tracking(player) >= TRACK.PEDESTAL) {
      ep.mesbox(player, TEXT.PEDESTAL_AGAIN);
      return true;
    }
    if ((Number(player.getSkillManager().getCurrentLevel(Skill.HUNTER)) || 0) < HUNTER_REQUIREMENT) {
      ep.mesbox(player, TEXT.PEDESTAL_LOW_HUNTER);
      return true;
    }
    state.set(player, VARBIT.TRACKING, TRACK.PEDESTAL);
    ep.mesbox(player, TEXT.PEDESTAL_TRACKS);
    return true;
  }

  /** The search, then two ticks on its answer (t1232-1234). */
  function search(player, answer) {
    ep.animate(player, SEQ.SEARCH);
    ep.later(player, 2, () => {
      if (!inRoom(player)) return;
      ep.sound(player, SOUND.SEARCH);
      answer();
    });
  }

  function inspectRock(event) {
    const id = event.objectId;
    if ((id !== LOC.ROCK_1 && id !== LOC.ROCK_2 && !WRONG_ROCKS.has(id)) || !inRoom(event.player)) return false;
    const { player } = event;
    const before = id === LOC.ROCK_1 ? TRACK.PEDESTAL : id === LOC.ROCK_2 ? TRACK.ROCK_1 : null;
    search(player, () => {
      const now = tracking(player);
      if (before === null || now < before) {
        player.sendMessage(TEXT.WRONG_ROCK);
        return;
      }
      if (now > before) {
        player.sendMessage(TEXT.ROCK_AGAIN);
        return;
      }
      state.set(player, VARBIT.TRACKING, before + 1);
      ep.mesbox(player, id === LOC.ROCK_1 ? TEXT.FIRST_ROCK : TEXT.SECOND_ROCK);
    });
    return true;
  }

  function inspectOpening(event) {
    if (event.objectId !== LOC.OPENING || !inRoom(event.player)) return false;
    const { player } = event;
    const scene = Scenes.get(player);
    const now = tracking(player);
    if (now < TRACK.ROCK_2) {
      search(player, () => player.sendMessage(TEXT.PEER_DOWN));
      return true;
    }
    if (now === TRACK.ROCK_2 || (now === TRACK.KEBBIT_OUT && !liveKebbit(scene))) {
      kebbitAppears(player, scene);
      return true;
    }
    if (now === TRACK.KEBBIT_OUT) return true;
    if (state.has(player, ITEM.SILVER_FEATHER)) {
      search(player, () => player.sendMessage(TEXT.TUNNEL_TOO_THIN));
      return true;
    }
    search(player, () => {
      player.getInventory().forceAdd(player, new Item(ITEM.SILVER_FEATHER, 1));
      ep.mesbox(player, TEXT.SILVER_RECLAIMED);
    });
    return true;
  }

  const liveKebbit = (scene) => scene?.kebbit && scene.kebbit.isRegistered?.() !== false && !scene.kebbit.isDying?.() ? scene.kebbit : null;

  /** The kebbit jumps out (t1253-1261). Ours on a second visit at 4: the same scene again, as it is not there. */
  function kebbitAppears(player, scene) {
    if (scene.appearing) return;
    scene.appearing = true;
    Scenes.camera(player, CAMERA.move, CAMERA.look, { rate: 0, rate2: 100 });
    Scenes.later(scene, 1, () => {
      ep.animate(player, SEQ.SEARCH);
      ep.sound(player, SOUND.SEARCH);
    });
    Scenes.later(scene, 2, () => player.sendMessage(TEXT.PEER_DOWN));
    Scenes.later(scene, 3, () => {
      state.set(player, VARBIT.TRACKING, TRACK.KEBBIT_OUT);
      player.getPacketSender().sendCameraShake(3, 1, 0, 0);
      ep.sound(player, SOUND.RUMBLING);
    });
    Scenes.later(scene, 4, () => {
      const sender = player.getPacketSender();
      sender.sendProjectile(Scenes.tileFor(scene, OPENING_TILE), Scenes.tileFor(scene, KEBBIT_TILE), 0, 110, SPOT.PROJECTILE, 0, 0, null, 70, 0, 0);
      const landing = new Graphic(SPOT.LANDING);
      landing.delay = 110;
      sender.sendGraphic(landing, Scenes.tileFor(scene, KEBBIT_TILE));
      scene.kebbit = Scenes.actor(scene, NPC.KEBBIT, KEBBIT_TILE, [KEBBIT_TILE[0], KEBBIT_TILE[1] - 1]);
      player.forceChat(TEXT.STARTLED);
      player.performAnimation(new api.core.Animation(SEQ.STUMBLE));
      TaskManager.submit(new ForceMovementTask(player, 1,
        new ForceMovement(player.getLocation().clone(), new Location(0, -2), 90, 120, 0, -1)));
      ep.sound(player, SOUND.KEBBIT_APPEAR);
      ep.sound(player, SOUND.FALL_LAND);
    });
    Scenes.later(scene, 7, () => {
      player.getPacketSender().sendCameraShake(3, 0, 0, 0);
      ep.sound(player, SOUND.RUMBLING);
    });
    Scenes.later(scene, 8, () => {
      player.getPacketSender().sendCameraReset();
      scene.appearing = false;
    });
  }

  function ownKebbit(event) {
    const scene = Scenes.get(event.player);
    return inRoom(event.player) && event.npc && liveKebbit(scene) === event.npc ? scene : null;
  }

  /** "Hey, give me that!" overhead and in the chatbox, the stare's box and the menu (t1273-1286). */
  function threaten(event) {
    const scene = ownKebbit(event);
    if (!scene) return false;
    const { player } = event;
    player.getCombat?.()?.reset?.();
    player.setPositionToFace(event.npc.getLocation());
    say(player, TEXT.THREAT, "chatang1", () => {
      ep.mesbox(player, TEXT.KEBBIT_STARES, () => {
        api.sendMultiChatboxPrompt(player, "Select an option",
          TEXT.TAUNT_MENU[0], () => taunt(player, scene),
          TEXT.TAUNT_MENU[1], () => player.getPacketSender().sendInterfaceRemoval());
      });
    }, SEQ.BECKON);
    return true;
  }

  /** A line said aloud: overhead with its chatbox line, as live shows both (t1273, t1288, t1290). */
  function say(player, text, expression, after, animation) {
    player.forceChat(text);
    if (animation) ep.animate(player, animation);
    const chain = new DialogueChainBuilder().add(new PlayerDialogue(0, text, seq(expression) ?? undefined));
    chain.add(new ActionDialogue(1, { execute: () => after(player) }));
    player.getDialogueManager().startDialogues(chain);
  }

  function taunt(player, scene) {
    say(player, TEXT.TAUNT_1, "chatang1", () => {
      say(player, TEXT.TAUNT_2, "chatang2", () => {
        player.getPacketSender().sendInterfaceRemoval();
        flee(player, scene);
      });
    });
  }

  /** It scurries back to the tunnel's mouth a tile a tick, and the feather drops as it goes (t1293-1299). */
  function flee(player, scene) {
    const kebbit = liveKebbit(scene);
    if (!kebbit || scene.fleeing) return;
    scene.fleeing = true;
    player.sendMessage(TEXT.KEBBIT_SCURRIES);
    kebbit.getCombat?.()?.reset?.();
    const mouth = Scenes.tileFor(scene, DROP_TILE);
    const steps = [];
    let at = kebbit.getLocation();
    while (at.getX() !== mouth.getX() || at.getY() !== mouth.getY()) {
      at = new Location(at.getX() + Math.sign(mouth.getX() - at.getX()), at.getY() + Math.sign(mouth.getY() - at.getY()), at.getZ());
      steps.push(at);
    }
    steps.forEach((step, index) => Scenes.later(scene, (index + 1) * ESCAPE_TICKS_PER_TILE, () => kebbit.moveTo(step)));
    Scenes.later(scene, steps.length * ESCAPE_TICKS_PER_TILE + 1, () => {
      Scenes.removeActor(scene, kebbit);
      dropFeather(player, scene, mouth);
      scene.fleeing = false;
    });
  }

  function dropFeather(player, scene, location) {
    state.set(player, VARBIT.TRACKING, TRACK.FEATHER_DROPPED);
    api.getItemOnGroundManager().registerLocation(player, new Item(ITEM.SILVER_FEATHER, 1), location, scene.area);
    player.sendMessage(TEXT.FEATHER_DROPS);
  }

  /**
   * Killed: its own drop table (npc-drops kebbit_eagles_peak: bones and the silver feather, Wiki) drops the feather;
   * here only the trail moves on, as after a taunt.
   */
  function handleDeath(event) {
    const npc = event.npc;
    const player = npc?.__questSceneOwner;
    if (!player || npc.getId?.() !== NPC.KEBBIT) return;
    const scene = Scenes.get(player);
    if (!scene || scene.name !== SCENE || scene.kebbit !== npc) return;
    scene.kebbit = null;
    if (tracking(player) === TRACK.KEBBIT_OUT) state.set(player, VARBIT.TRACKING, TRACK.FEATHER_DROPPED);
  }

  api.onObjectInteraction("Tunnel", { Enter: enter });
  api.onObjectInteraction("Tunnel", { Enter: leave });
  api.onObjectInteraction("Stone pedestal", { Inspect: inspectPedestal });
  api.onObjectInteraction("Rocks", { Inspect: inspectRock });
  api.onObjectInteraction("Opening", { Inspect: inspectOpening });
  api.onNpcInteraction("Kebbit", { Threaten: threaten });
  api.onNpcDeath(handleDeath);

  return { SCENE, ROOM, LOC };
};
