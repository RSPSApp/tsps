/**
 * The golden feather's room, as the capture plays it (RSProx, rev 243, t1376-1903), in a copy of the map per visit.
 * eaglepeak_puzzle1_reset (3089) holds it all: gate1-4 (1, 2, 4, 8) are the four eagle levers, mechbird1-5
 * (16 ... 256) whether each metal bird has flown to its far feeder. The levers are the map's multilocs on their
 * gate bits; the five birds (19935, 2x2) and the wing gates (19870 shut, 19871 open) are placed in the copy from
 * those bits, as live adds them on entry (t1376).
 * - Each lever turns a fixed set of wings over, with human_pull_lever, its line, lever and a peak_eagle_door per
 *   wing (t1402, t1569, t1602, t1652, t1733): lever1 the south wing (A) and the west wing (C); lever2 C; lever3
 *   the east wing (B) and the north-west wing (D); lever4 the corridor's (E). At 0 only C and D are open. (This
 *   matches the Wiki's lever table; which wing each lever moves is read off the captured loc changes.)
 * - Seed in a feeder calls the bird whose rail ends there: human_pickuptable, the seed and peak_fill_feeder, the
 *   feeder's birdfeeder_full a tick on, then the bird's flight two ticks on with the camera over it: its bit, the
 *   flight (mecheagle_spot_ne out, mecheagle_spot_sw_180 back), its landing spotanim, the bird gone a tick on and
 *   back at the far end when the flight lands, the camera back a tick after (t1523-1533, t1537-1547, t1662-1693).
 *   A shut wing on its rail sends it up to the wing and back home (t1621-1626), and the feeder's other bird comes
 *   instead (t1627-1632). A feeder whose bird is already there has no effect (Transcript).
 * - The pedestal (19950, 1928,4907) at the corridor's end: human_pickuptable, the golden feather and pick, the
 *   pedestal empty (19911) for two ticks (t1888-1890). The birds and wings decide whether the player can get there.
 * - The reset lever outside (19945, 2022,4981,3): its box, then "Are you sure you wish to pull this lever?"; Yes
 *   sets 3089 to 0 with the lever's line and sounds (t1443-1453). With nothing to reset, the Transcript's
 *   "nothing much" line (Ours: when 3089 is already 0).
 */
module.exports = function attachEaglesPeakGold(api, ep) {
  const { state, TEXT, Scenes } = ep;
  const { STAGE, VARBIT, ITEM } = state;
  const { Item, Location, Graphic, ObjectManager } = api.core;

  const SCENE = "eagles-peak-gold";
  const ROOM = Object.freeze({
    instance: { sourceChunk: [1920 >> 3, 4864 >> 3], size: 13 },
    bounds: [[1920, 1983, 4888, 4927, 2]],
    at: [1956, 4907, 2],
    exit: [2022, 4982, 3],
  });
  const LOC = Object.freeze({
    ENTRANCE: 19897, EXIT: 19894, SEED_HOLDER: 19919, PEDESTAL: 19950, PEDESTAL_EMPTY: 19911, RESET_LEVER: 19945,
    BIRD: 19935, WING_SHUT: 19870, WING_OPEN: 19871,
  });
  const SEQ = Object.freeze({ PICK_UP: 827, PICK_UP_TABLE: 832, PULL_LEVER: 3611, FEEDER_FULL: 5306 });
  const SOUND = Object.freeze({ LEVER: 2400, EAGLE_DOOR: 1507, FILL_FEEDER: 1509, BIRD_MOVE: 1506, PICK: 2581 });
  const SPOT = Object.freeze({ OUT: 961, BACK: 964, LAND: { 0: 958, 1: 959, 2: 956, 3: 957 } });

  /** The wing gates, each a pair of locs (t1376). */
  const WINGS = Object.freeze({
    A: [[1945, 4901, 2], [1946, 4901, 0]],
    B: [[1954, 4901, 3], [1954, 4900, 1]],
    C: [[1938, 4899, 3], [1938, 4898, 1]],
    D: [[1929, 4915, 3], [1929, 4914, 1]],
    E: [[1927, 4915, 3], [1927, 4914, 1]],
  });
  /** lever loc -> its gate bit of 3089 and the wings it turns over. */
  const LEVERS = new Map([
    [19946, { bit: 1, wings: ["A", "C"] }],
    [19947, { bit: 2, wings: ["C"] }],
    [19948, { bit: 4, wings: ["B", "D"] }],
    [19949, { bit: 8, wings: ["E"] }],
  ]);
  const GATE1 = 1, GATE2 = 2, GATE3 = 4, GATE4 = 8;
  /** Whether each wing is open, from the gate bits (each lever turns its wings over). */
  const OPEN = Object.freeze({
    A: (gates) => (gates & GATE1) !== 0,
    B: (gates) => (gates & GATE3) !== 0,
    C: (gates) => ((gates & GATE1) !== 0) === ((gates & GATE2) !== 0),
    D: (gates) => (gates & GATE3) === 0,
    E: (gates) => (gates & GATE4) !== 0,
  });

  /**
   * The birds: home and far tile (rotation), the bit, the wing on the rail (if any), the flight's length in
   * cycles (t1526: 120, t1542: 120, t1627: 150, t1686: 180, t1861: 150) and, for a shut wing, where it turns back
   * (bird3, t1621; bird2's is Ours).
   */
  const BIRDS = Object.freeze([
    { bit: 16, home: [1931, 4914], far: [1943, 4914], face: 3, wing: null, cycles: 180 },
    { bit: 32, home: [1935, 4898], far: [1945, 4898], face: 3, wing: "C", cycles: 150, turn: [1937, 4898] },
    { bit: 64, home: [1945, 4906], far: [1945, 4898], face: 0, wing: "A", cycles: 150, turn: [1945, 4902] },
    { bit: 128, home: [1963, 4900], far: [1963, 4894], face: 0, wing: null, cycles: 120 },
    { bit: 256, home: [1971, 4890], far: [1967, 4890], face: 1, wing: null, cycles: 120 },
  ]);
  const BOUNCE_CYCLES = 45;
  const CAMERAS = Object.freeze({
    north: { move: [1947, 4909, 1025], look: [1940, 4914, 100] },
    west: { move: [1949, 4894, 1025], look: [1943, 4900, 125] },
    east: { move: [1959, 4888, 1050], look: [1966, 4894, 25] },
  });
  /** feeder loc -> the birds it calls (in order), whether to the far end, and the camera (the "a" and "b" feeders' are Ours). */
  const FEEDERS = new Map([
    [19936, { birds: [0], far: true, camera: "north" }],
    [19940, { birds: [0], far: false, camera: "north" }],
    [19937, { birds: [2, 1], far: true, camera: "west" }],
    [19941, { birds: [1], far: false, camera: "west" }],
    [19942, { birds: [2], far: false, camera: "west" }],
    [19938, { birds: [3], far: true, camera: "east" }],
    [19943, { birds: [3], far: false, camera: "east" }],
    [19939, { birds: [4], far: true, camera: "east" }],
    [19944, { birds: [4], far: false, camera: "east" }],
  ]);

  const inRoom = (player) => Scenes.get(player)?.name === SCENE;
  const puzzle = (player) => state.get(player, VARBIT.GOLD);
  const gates = (player) => puzzle(player) & 15;

  // ==========================================================================
  // The room
  // ==========================================================================

  function enter(event) {
    if (event.objectId !== LOC.ENTRANCE) return false;
    const { player } = event;
    if (state.stage(player) < STAGE.CAVE_OPEN) return false;
    player.sendMessage(TEXT.TUNNEL);
    if (!state.get(player, VARBIT.ENTERED_GOLD)) state.set(player, VARBIT.ENTERED_GOLD, 1);
    const scene = Scenes.open(player, SCENE, ROOM.bounds, { canTeleport: () => null, npcAggression: () => null },
      { instance: ROOM.instance, at: ROOM.at, exit: ROOM.exit });
    scene.wings = {};
    scene.birds = [];
    for (const name of Object.keys(WINGS)) placeWings(player, scene, name);
    BIRDS.forEach((bird, index) => placeBird(scene, index, (puzzle(player) & bird.bit) !== 0));
    return true;
  }

  function placeWings(player, scene, name) {
    for (const object of scene.wings[name] ?? []) removeLoc(scene, object);
    const id = OPEN[name](gates(player)) ? LOC.WING_OPEN : LOC.WING_SHUT;
    scene.wings[name] = WINGS[name].map(([x, y, face]) => Scenes.loc(scene, { id, x, y, z: 2, type: 10, face }));
  }

  function placeBird(scene, index, far) {
    const bird = BIRDS[index];
    const [x, y] = far ? bird.far : bird.home;
    scene.birds[index] = { far, object: Scenes.loc(scene, { id: LOC.BIRD, x, y, z: 2, type: 10, face: bird.face }) };
  }

  function removeLoc(scene, object) {
    if (!object) return;
    ObjectManager.deregister(object, true);
    const at = scene.locs.indexOf(object);
    if (at >= 0) scene.locs.splice(at, 1);
  }

  function leave(event) {
    if (event.objectId !== LOC.EXIT || !inRoom(event.player)) return false;
    const { player } = event;
    player.sendMessage(TEXT.TUNNEL);
    Scenes.end(player, false);
    player.moveTo(new Location(...ROOM.exit));
    return true;
  }

  function takeSeed(event) {
    if (event.objectId !== LOC.SEED_HOLDER || !inRoom(event.player)) return false;
    const { player } = event;
    if (player.getInventory().isFull()) {
      player.sendMessage("You don't have enough inventory space.");
      return true;
    }
    player.sendMessage(TEXT.SEED_TAKEN);
    ep.animate(player, SEQ.PICK_UP);
    player.getInventory().add(new Item(ITEM.BIRD_SEED, 1));
    return true;
  }

  // ==========================================================================
  // Levers
  // ==========================================================================

  function pullLever(event) {
    const lever = LEVERS.get(event.objectId);
    if (!lever || !inRoom(event.player)) return false;
    const { player } = event;
    const scene = Scenes.get(player);
    state.set(player, VARBIT.GOLD, puzzle(player) ^ lever.bit);
    player.sendMessage(TEXT.LEVER_MOVED);
    ep.animate(player, SEQ.PULL_LEVER);
    for (const name of lever.wings) placeWings(player, scene, name);
    ep.sound(player, SOUND.LEVER);
    for (let i = 0; i < lever.wings.length * 2; i++) ep.sound(player, SOUND.EAGLE_DOOR);
    return true;
  }

  function resetLever(event) {
    if (event.objectId !== LOC.RESET_LEVER) return false;
    const { player } = event;
    ep.mesbox(player, TEXT.RESET_LEVER, () => {
      api.sendMultiChatboxPrompt(player, TEXT.RESET_MENU_TITLE,
        TEXT.RESET_MENU[0], () => pullReset(player),
        TEXT.RESET_MENU[1], () => player.getPacketSender().sendInterfaceRemoval());
    });
    return true;
  }

  function pullReset(player) {
    player.getPacketSender().sendInterfaceRemoval();
    ep.animate(player, SEQ.PULL_LEVER);
    ep.sound(player, SOUND.LEVER);
    if (puzzle(player) === 0) {
      player.sendMessage(TEXT.RESET_NOTHING);
      return;
    }
    state.set(player, VARBIT.GOLD, 0);
    player.sendMessage(TEXT.LEVER_MOVED);
    ep.sound(player, SOUND.EAGLE_DOOR);
  }

  // ==========================================================================
  // Feeders and the birds
  // ==========================================================================

  function feed(event) {
    const feeder = FEEDERS.get(event.objectId);
    if (!feeder || !inRoom(event.player)) return false;
    const { player } = event;
    const scene = Scenes.get(player);
    if (scene.flying) return true;
    // A bird already at this feeder's end: nothing happens (Transcript).
    if (feeder.birds.some((index) => scene.birds[index]?.far === feeder.far)) {
      player.sendMessage(TEXT.FEEDER_NO_EFFECT);
      return true;
    }
    player.getInventory().deleteNumber(ITEM.BIRD_SEED, 1);
    ep.animate(player, SEQ.PICK_UP_TABLE);
    ep.sound(player, SOUND.FILL_FEEDER);
    scene.flying = true;
    const feederObject = event.object;
    Scenes.later(scene, 1, () => { if (feederObject) player.getPacketSender().sendObjectAnimation(feederObject, new api.core.Animation(SEQ.FEEDER_FULL)); });
    Scenes.later(scene, 2, () => {
      const camera = CAMERAS[feeder.camera];
      Scenes.camera(player, camera.move, camera.look, { rate: 0, rate2: 100 });
      const ticks = callBirds(player, scene, feeder, 0, 0);
      Scenes.later(scene, ticks + 1, () => {
        player.getPacketSender().sendCameraReset();
        scene.flying = false;
      });
    });
    return true;
  }

  /** Calls the feeder's birds in order; returns the ticks until the last lands. */
  function callBirds(player, scene, feeder, from, delay) {
    for (let i = from; i < feeder.birds.length; i++) {
      const index = feeder.birds[i];
      const bird = BIRDS[index];
      if (scene.birds[index].far === feeder.far) continue;
      const blocked = bird.wing && !OPEN[bird.wing](gates(player));
      if (!blocked) {
        Scenes.later(scene, delay, () => fly(player, scene, index, feeder.far));
        return delay + Math.ceil(bird.cycles / 30);
      }
      Scenes.later(scene, delay, () => bounce(player, scene, index));
      // The next bird flies once the first is home (t1621 -> t1627).
      delay += Math.ceil((BOUNCE_CYCLES * 2) / 30) + 3;
    }
    return delay;
  }

  /** The flight's ends: the bird's tile, offset by its turn as live sends them (t1526: r1 +y, t1627: r3 +x). */
  function flightTile(scene, [x, y], face) {
    const dx = face === 3 || face === 2 ? 1 : 0;
    const dy = face === 1 || face === 2 ? 1 : 0;
    return Scenes.tileFor(scene, [x + dx, y + dy, 2]);
  }

  function fly(player, scene, index, far) {
    if (!inRoom(player)) return;
    const bird = BIRDS[index];
    state.set(player, VARBIT.GOLD, far ? puzzle(player) | bird.bit : puzzle(player) & ~bird.bit);
    const from = flightTile(scene, far ? bird.home : bird.far, bird.face);
    const to = flightTile(scene, far ? bird.far : bird.home, bird.face);
    const sender = player.getPacketSender();
    sender.sendProjectile(from, to, 0, 60 + bird.cycles - 60, far ? SPOT.OUT : SPOT.BACK, 0, 0, null, 60, 0, 0);
    const land = new Graphic(SPOT.LAND[bird.face]);
    land.delay = bird.cycles;
    sender.sendGraphic(land, to);
    ep.sound(player, SOUND.BIRD_MOVE, 60, 4);
    Scenes.later(scene, 1, () => removeLoc(scene, scene.birds[index].object));
    Scenes.later(scene, Math.ceil(bird.cycles / 30), () => placeBird(scene, index, far));
  }

  /** Up the rail to the shut wing and home again (t1621-1626). */
  function bounce(player, scene, index) {
    if (!inRoom(player)) return;
    const bird = BIRDS[index];
    const home = flightTile(scene, bird.home, bird.face);
    const turn = Scenes.tileFor(scene, [bird.turn[0], bird.turn[1], 2]);
    const sender = player.getPacketSender();
    sender.sendProjectile(home, turn, 0, 60 + BOUNCE_CYCLES, SPOT.OUT, 0, 0, null, 60, 0, 0);
    sender.sendProjectile(turn, home, 0, 60 + BOUNCE_CYCLES * 2, SPOT.BACK, 0, 0, null, 60 + BOUNCE_CYCLES, 0, 0);
    const start = new Graphic(SPOT.LAND[bird.face]);
    start.delay = 20;
    sender.sendGraphic(start, home);
    const back = new Graphic(SPOT.LAND[bird.face]);
    back.delay = 60 + BOUNCE_CYCLES * 2;
    sender.sendGraphic(back, home);
    ep.sound(player, SOUND.BIRD_MOVE, 60, 4);
    Scenes.later(scene, 1, () => removeLoc(scene, scene.birds[index].object));
    Scenes.later(scene, Math.ceil((60 + BOUNCE_CYCLES * 2) / 30), () => placeBird(scene, index, false));
  }

  // ==========================================================================
  // The pedestal
  // ==========================================================================

  function takeFeather(event) {
    if (event.objectId !== LOC.PEDESTAL || !inRoom(event.player)) return false;
    const { player } = event;
    if (state.has(player, ITEM.GOLDEN_FEATHER)) {
      player.sendMessage(TEXT.SECOND_GOLDEN);
      return true;
    }
    if (player.getInventory().isFull()) {
      player.sendMessage("You don't have enough inventory space.");
      return true;
    }
    const scene = Scenes.get(player);
    ep.animate(player, SEQ.PICK_UP_TABLE);
    const at = event.object?.getLocation?.() ?? Scenes.tileFor(scene, [1928, 4907, 2]);
    if (event.object) ObjectManager.deregister(event.object, true);
    const empty = Scenes.loc(scene, { id: LOC.PEDESTAL_EMPTY, x: at.getX(), y: at.getY(), z: 2, type: 10, face: 0 });
    player.getInventory().add(new Item(ITEM.GOLDEN_FEATHER, 1));
    ep.sound(player, SOUND.PICK);
    Scenes.later(scene, 2, () => {
      removeLoc(scene, empty);
      if (event.object) ObjectManager.register(event.object, true);
    });
    return true;
  }

  api.onObjectInteraction("Tunnel", { Enter: enter });
  api.onObjectInteraction("Tunnel", { Enter: leave });
  api.onObjectInteraction("Birdseed holder", { "Take-from": takeSeed });
  api.onObjectInteraction("Eagle lever", { "Pull-down": pullLever, "Push-up": pullLever });
  api.onObjectInteraction("Reset Lever", { Pull: resetLever });
  api.onObjectInteraction("Stone pedestal", { "Take-from": takeFeather });
  api.onItemOnObject("Odd bird seed", "Bird feeder", feed);

  return { SCENE, ROOM, LOC, BIRDS, FEEDERS, WINGS, LEVERS, OPEN };
};
