/**
 * The bronze feather's room, as the capture plays it (RSProx, rev 243, t1115-1170). Live builds a copy of the map
 * for each visit (rebuild_region); so does this, from the same source chunks, with the room's own locs placed
 * from the saved state:
 * - the tunnel (19909, 1986,4949,3): "You enter the tunnel.", eaglepeak_entered_puzzle3 (3113) set, the
 *   copy at 1974,4908,2; out by its own tunnel (19906, 1974,4907) to 1987,4949,3;
 * - the net trap's pedestal (19980, 1973,4914 r2, 3x3) while nothing is sprung; its Take-from is a camera
 *   move and the trap: human_pickuptable and disarm_trap_failure two ticks on, eaglepeak_stumble_fall and
 *   the trigger loc (19982) a tick later, then eaglepeak_puzzle3_nettrap (3105) = 1, the line and the
 *   raised trap (19981, 1974,4915) two ticks after that, and the camera back (t1123-1129);
 * - the winches (19976-19979, the room's corners): before the trap is sprung they do nothing (the Wiki has no
 *   line for it; "The winch doesn't seem to turn any further." is Ours there); after, each sets its bit of
 *   eaglepeak_puzzle3_allwinches (3100) with its line, eaglepeak_winch and peak_winch (t1136-1158); the
 *   fourth clears 3105 and drops the trap (19983, peak_nettrap_reset), and two ticks on the stone pedestal
 *   (19984, 1974,4915) is there to take from (t1158-1160);
 * - the pedestal: human_pickuptable, the bronze feather and pick, the pedestal empty (19911) for two ticks
 *   (t1162-1165). One is carried at a time (Transcript); a lost one comes from here again, during the quest or after.
 */
module.exports = function attachEaglesPeakBronze(api, ep) {
  const { state, TEXT, Scenes } = ep;
  const { STAGE, VARBIT, ITEM, ALL_WINCHES } = state;
  const { Item, ObjectManager } = api.core;

  const SCENE = "eagles-peak-bronze";
  const ROOM = Object.freeze({
    instance: { sourceChunk: [1920 >> 3, 4864 >> 3], size: 13 },
    bounds: [[1960, 1985, 4900, 4925, 2]],
    at: [1974, 4908, 2],
    exit: [1987, 4949, 3],
  });
  const LOC = Object.freeze({
    ENTRANCE: 19909, EXIT: 19906,
    TRAP_INACTIVE: 19980, TRAP_ACTIVE: 19981, TRAP_TRIGGER: 19982, TRAP_DROP: 19983, PEDESTAL: 19984, PEDESTAL_EMPTY: 19911,
  });
  /** winch loc -> its bit of 3100 (winch1-4 = 1, 2, 4, 8). */
  const WINCHES = new Map([[19976, 1], [19977, 2], [19978, 4], [19979, 8]]);
  const TRAP_TILE = Object.freeze({ x: 1973, y: 4914, z: 2, face: 2 });
  const PEDESTAL_TILE = Object.freeze({ x: 1974, y: 4915, z: 2, face: 2 });
  const SEQ = Object.freeze({ PICK_UP_TABLE: 832, STUMBLE_FALL: 5298, WINCH: 5299 });
  const SOUND = Object.freeze({ DISARM_FAIL: 2386, NET_TRAP: 1511, WINCH: 1514, TRAP_RESET: 1510, PICK: 2581 });
  const CAMERA = Object.freeze({ move: [1980, 4911, 500], look: [1974, 4915, 25] });

  const inRoom = (player) => Scenes.get(player)?.name === SCENE;

  function enter(event) {
    if (event.objectId !== LOC.ENTRANCE) return false;
    const { player } = event;
    if (state.stage(player) < STAGE.CAVE_OPEN) return false;
    player.sendMessage(TEXT.TUNNEL);
    if (!state.get(player, VARBIT.ENTERED_BRONZE)) state.set(player, VARBIT.ENTERED_BRONZE, 1);
    const scene = Scenes.open(player, SCENE, ROOM.bounds, { canTeleport: () => null, npcAggression: () => null },
      { instance: ROOM.instance, at: ROOM.at, exit: ROOM.exit });
    placeTrap(player, scene);
    return true;
  }

  /** What stands on the trap's spot, from the saved state. */
  function placeTrap(player, scene) {
    if (state.get(player, VARBIT.WINCHES) === ALL_WINCHES) setTrap(scene, LOC.PEDESTAL, PEDESTAL_TILE);
    else if (state.get(player, VARBIT.NET_TRAP) === 1) setTrap(scene, LOC.TRAP_ACTIVE, PEDESTAL_TILE);
    else setTrap(scene, LOC.TRAP_INACTIVE, TRAP_TILE);
  }

  function setTrap(scene, id, at) {
    if (scene.trap) {
      ObjectManager.deregister(scene.trap, true);
      scene.locs.splice(scene.locs.indexOf(scene.trap) >>> 0, 1);
    }
    scene.trap = Scenes.loc(scene, { id, x: at.x, y: at.y, z: at.z, type: 10, face: at.face });
    return scene.trap;
  }

  function leave(event) {
    if (event.objectId !== LOC.EXIT || !inRoom(event.player)) return false;
    const { player } = event;
    player.sendMessage(TEXT.TUNNEL);
    Scenes.end(player, false);
    player.moveTo(new api.core.Location(...ROOM.exit));
    return true;
  }

  /** The net trap springs (t1123-1129). */
  function takeFromTrap(event) {
    if (event.objectId !== LOC.TRAP_INACTIVE || !inRoom(event.player)) return false;
    const { player } = event;
    const scene = Scenes.get(player);
    if (scene.springing || state.get(player, VARBIT.NET_TRAP) === 1) return true;
    scene.springing = true;
    Scenes.camera(player, CAMERA.move, CAMERA.look, { rate: 0, rate2: 100 });
    Scenes.later(scene, 2, () => {
      ep.animate(player, SEQ.PICK_UP_TABLE);
      ep.sound(player, SOUND.DISARM_FAIL);
    });
    Scenes.later(scene, 3, () => {
      ep.animate(player, SEQ.STUMBLE_FALL);
      setTrap(scene, LOC.TRAP_TRIGGER, TRAP_TILE);
      ep.sound(player, SOUND.NET_TRAP);
    });
    Scenes.later(scene, 5, () => {
      state.set(player, VARBIT.NET_TRAP, 1);
      player.sendMessage(TEXT.NET_TRAP_SPRUNG);
      setTrap(scene, LOC.TRAP_ACTIVE, PEDESTAL_TILE);
      scene.springing = false;
    });
    Scenes.later(scene, 6, () => player.getPacketSender().sendCameraReset());
    return true;
  }

  function operateWinch(event) {
    const bit = WINCHES.get(event.objectId);
    if (!bit || !inRoom(event.player)) return false;
    const { player } = event;
    const wound = state.get(player, VARBIT.WINCHES);
    if (state.get(player, VARBIT.NET_TRAP) !== 1 || (wound & bit) !== 0) {
      player.sendMessage(TEXT.WINCH_AGAIN);
      return true;
    }
    const now = wound | bit;
    state.set(player, VARBIT.WINCHES, now);
    player.sendMessage(TEXT.WINCH_WOUND);
    ep.animate(player, SEQ.WINCH);
    ep.sound(player, SOUND.WINCH);
    if (now !== ALL_WINCHES) return true;
    // The fourth winch drops the trap; the pedestal is there two ticks on (t1158-1160).
    state.set(player, VARBIT.NET_TRAP, 0);
    const scene = Scenes.get(player);
    setTrap(scene, LOC.TRAP_DROP, TRAP_TILE);
    ep.sound(player, SOUND.TRAP_RESET);
    Scenes.later(scene, 2, () => setTrap(scene, LOC.PEDESTAL, PEDESTAL_TILE));
    return true;
  }

  function takeFeather(event) {
    if (event.objectId !== LOC.PEDESTAL || !inRoom(event.player)) return false;
    const { player } = event;
    if (state.has(player, ITEM.BRONZE_FEATHER)) {
      player.sendMessage(TEXT.SECOND_BRONZE);
      return true;
    }
    if (player.getInventory().isFull()) {
      player.sendMessage("You don't have enough inventory space.");
      return true;
    }
    const scene = Scenes.get(player);
    ep.animate(player, SEQ.PICK_UP_TABLE);
    setTrap(scene, LOC.PEDESTAL_EMPTY, PEDESTAL_TILE);
    player.getInventory().add(new Item(ITEM.BRONZE_FEATHER, 1));
    ep.sound(player, SOUND.PICK);
    Scenes.later(scene, 2, () => setTrap(scene, LOC.PEDESTAL, PEDESTAL_TILE));
    return true;
  }

  api.onObjectInteraction("Tunnel", { Enter: enter });
  api.onObjectInteraction("Tunnel", { Enter: leave });
  api.onObjectInteraction("Pedestal", { "Take-from": takeFromTrap });
  api.onObjectInteraction("Winch", { Operate: operateWinch });
  api.onObjectInteraction("Stone pedestal", { "Take-from": takeFeather });

  return { SCENE, ROOM, LOC };
};
