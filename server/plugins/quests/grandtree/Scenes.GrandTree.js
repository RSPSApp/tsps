/**
 * The Grand Tree's scripted moments outside the demon's cave, as rsprox capture local 1002189 (revision 242.1) plays
 * them. Ticks count from the continue that ends the line before each one; the capture ticks are in the comments and
 * in docs/quests/grand-tree/README.md.
 *
 * Each handler takes the transcript's stage direction (an `npc-dialogue:action` event) and holds the conversation
 * with `wait(resume)` while the scene plays, so the transcript's next line shows on the captured tick.
 */
const { createQuestScenes } = require("../QuestScenes");
const { startTranscript } = require("../QuestRuntime");

const PAGE = "The Grand Tree";

const REACH_FLOOR = 827;
const REACH_LADDER = 828;
const TRAPDOOR_OPEN_SOUND = 91;
const PRISON_DOOR_SOUND = 1631; // lockeddoor

/** Under the Grand Tree with the King (t10204-10222 down, t10346-10356 up). */
const FOUNDATIONS = {
  trapdoor: { closed: 2446, open: 2445, x: 2463, y: 3497, z: 0, type: 22, face: 0 },
  above: [2464, 3497, 0],
  below: [2463, 9896, 0],
  ladder: [2464, 9897, 0],
};

/** Glough's arrest and the cell (t11147-11190). */
const ARREST = {
  guard: 1433, // grandtree_spawnedguard
  guardFrom: [2477, 3462, 1],
  guardTo: [2479, 3463, 1],
  ladder: [2477, 3463, 1],
  cell: [2464, 3496, 3],
  kingFrom: [2467, 3495, 3],
  kingAtDoor: [2465, 3496, 3],
  kingAside: [2465, 3495, 3],
  door: { closed: 3367, open: 1548, x: 2465, y: 3496, z: 3, type: 0, face: 0, openFace: 1 },
  outside: [2465, 3496, 3],
};

/** The glider out of the stronghold (t11252-11256): the cache's map draws journey 7, Ta Quir Priw to the crash. */
const ESCAPE = {
  journey: 7,
  landing: [2918, 3058, 0],
  pilot: 6091,
};

/** The foreman takes the player to his office (t11400-11421). */
const OFFICE = {
  walk: [3001, 3047, 0],
  arrival: [2955, 3033, 0],
  foremanFrom: [2954, 3031, 0],
  seat: [2954, 3025, 0],
};

/** Femi's cart into the stronghold (t11606-11614). */
const CART = {
  boarding: [2461, 3379, 0],
  inside: [2459, 3409, 0],
  femi: [2458, 3409, 0],
  cart: { id: 308, x: 2458, y: 3410, z: 0, type: 10, face: 0 }, // cart_boxes
  /** Ours: no capture shows them go; they stay this long after the drop. */
  ticks: 100,
};

const GLIDER_MAP = 138;
const PILOT_JOURNEY_VARP = 153;
const FADE_UID = (161 << 16) | 1;
const FADE_INTERFACE = 174;
const FADE_SCRIPT = 948;
const GLIDER_FADE = [1512708, 20];

module.exports = function createGrandTreeScenes(api, { onPrisonKing, onReleased, onLanded, onOffice } = {}) {
  const { Animation, GameObject, Location, ObjectManager, MapObjects, NpcIdentifiers } = api.core;
  const scenes = createQuestScenes(api);
  const kings = new WeakMap();
  const leftovers = new WeakMap();
  const cartFemis = new WeakMap();

  const loc = ([x, y, z]) => new Location(x, y, z);
  const later = (player, ticks, callback) => scenes.later(player, ticks, callback);
  const walk = (player, tile) => {
    player.getMovementQueue().setBlockMovement(false);
    scenes.walk(player, tile);
  };

  /**
   * Swaps a map loc for another at its tile, for everyone (live's loc_add_change). Null when `from` is not there
   * (another player's scene has it swapped already), so two scenes never stack a second loc on the tile.
   */
  function swap({ x, y, z, type }, from, to, face) {
    const here = new Location(x, y, z);
    const current = MapObjects.get(from, here, null);
    if (!current) return null;
    ObjectManager.deregister(current, true);
    const replacement = new GameObject(to, here, type, face ?? current.getFace?.() ?? 0, null);
    ObjectManager.register(replacement, true);
    return replacement;
  }

  /** Puts a swapped loc back after `ticks`, whatever happens to the player (a logout cancels their own tasks). */
  function restoreLater(spec, opened, from, to, face, ticks) {
    if (!opened) return;
    api.core.TaskManager.submit(new api.core.CountdownTask({}, ticks, () => {
      if (MapObjects.get(from, opened.getLocation(), null)) swap(spec, from, to, face);
    }));
  }

  /** Down: the King says "Down here." as the trapdoor opens, the player climbs in and the talk goes on below. */
  function foundationsDown(event, king, npcId) {
    const { player } = event;
    event.handled = event.end = true;
    player.getMovementQueue().reset().setBlockMovement(true);
    later(player, 5, () => {
      king?.forceChat("Down here.");
      const { trapdoor } = FOUNDATIONS;
      // Ours: the capture leaves before it shuts; it closes once the player is below.
      restoreLater(trapdoor, swap(trapdoor, trapdoor.closed, trapdoor.open, trapdoor.face),
        trapdoor.open, trapdoor.closed, trapdoor.face, 9);
      player.getPacketSender().sendSoundEffect(TRAPDOOR_OPEN_SOUND, 1, 0);
      walk(player, FOUNDATIONS.above);
    });
    later(player, 11, () => {
      player.getMovementQueue().setBlockMovement(true);
      player.setPositionToFace(new Location(FOUNDATIONS.trapdoor.x, FOUNDATIONS.trapdoor.y, 0));
      player.performAnimation(new Animation(REACH_FLOOR));
    });
    later(player, 12, () => player.moveTo(loc(FOUNDATIONS.below)));
    later(player, 18, () => {
      player.getMovementQueue().setBlockMovement(false);
      const below = nearby(player, npcId);
      startTranscript(api, player, npcId, PAGE, "the-dying-tree-foundations-cutscene", null, below);
    });
  }

  /** Up: "Up here.", the player walks to the ladder, reaches and is back beside the trapdoor. */
  function foundationsUp(event, npcId) {
    const { player } = event;
    event.handled = event.end = true;
    player.getMovementQueue().reset().setBlockMovement(true);
    later(player, 4, () => {
      nearby(player, npcId)?.forceChat("Up here.");
      walk(player, FOUNDATIONS.ladder);
    });
    later(player, 9, () => {
      player.getMovementQueue().setBlockMovement(true);
      player.performAnimation(new Animation(REACH_LADDER));
    });
    later(player, 10, () => {
      player.getMovementQueue().setBlockMovement(false);
      player.moveTo(loc(FOUNDATIONS.above));
    });
  }

  function nearby(player, npcId) {
    return api.getWorld()?.getNpcsNear?.(player.getLocation(), 6, player.getPrivateArea?.() ?? null)
      ?.find((npc) => npc.getContentId?.(player) === npcId || npc.getId() === npcId) ?? null;
  }

  /** "A gnome guard appears.": he comes up the ladder to the player before "Come with me!". */
  function guardAppears(event) {
    const { player } = event;
    const guard = api.spawnNpc({ id: ARREST.guard, x: ARREST.guardFrom[0], y: ARREST.guardFrom[1], z: ARREST.guardFrom[2],
      wanderRadius: 0, owner: player, ownerOnly: true });
    if (!guard) return;
    guard.__skipDefaultRespawn = true;
    leftovers.set(player, [...(leftovers.get(player) ?? []), guard]);
    guard.getMovementQueue().addCheckpoint(loc(ARREST.guardTo));
    event.wait = (resume) => later(player, 5, () => {
      guard.setPositionToFace(player.getLocation());
      resume();
    });
  }

  /** "You are escorted...": the player walks to the ladder, climbs and is in the cell; the King comes. */
  function escort(event) {
    const { player } = event;
    event.handled = event.end = true;
    player.getMovementQueue().reset().setBlockMovement(true);
    later(player, 6, () => walk(player, ARREST.ladder));
    later(player, 12, () => {
      player.getMovementQueue().setBlockMovement(true);
      player.performAnimation(new Animation(REACH_LADDER));
    });
    later(player, 13, () => {
      clearLeftovers(player);
      player.moveTo(loc(ARREST.cell));
      player.getMovementQueue().setBlockMovement(false);
    });
    later(player, 16, () => kingComes(player, () => onPrisonKing?.(player, kings.get(player))));
  }

  /** The King appears east of the cell and walks to its door (t11170-11173), then speaks. */
  function kingComes(player, then) {
    if (!kings.get(player)?.isRegistered()) {
      const king = api.spawnNpc({ id: NpcIdentifiers.KING_NARNODE_SHAREEN, x: ARREST.kingFrom[0], y: ARREST.kingFrom[1],
        z: ARREST.kingFrom[2], wanderRadius: 0, owner: player, ownerOnly: true });
      if (!king) return;
      king.__skipDefaultRespawn = true;
      kings.set(player, king);
      king.getMovementQueue().addCheckpoint(new Location(ARREST.kingFrom[0], ARREST.kingAtDoor[1], ARREST.kingFrom[2]));
      king.getMovementQueue().addCheckpoint(loc(ARREST.kingAtDoor));
    }
    later(player, 4, () => {
      kings.get(player)?.setPositionToFace(player.getLocation());
      then();
    });
  }

  /** "King Narnode appears." when Charlie's own talk reaches it (a player who came back to the cell). */
  function kingAppears(event) {
    const { player } = event;
    event.wait = (resume) => kingComes(player, resume);
  }

  /** "The player is let out of the cell.": the door opens, the King steps aside and the player walks out. */
  function release(event) {
    const { player } = event;
    const { door } = ARREST;
    restoreLater(door, swap(door, door.closed, door.open, door.openFace), door.open, door.closed, door.face, 6);
    player.getPacketSender().sendSoundEffect(PRISON_DOOR_SOUND, 1, 0);
    event.wait = (resume) => {
      later(player, 1, () => kings.get(player)?.moveTo(loc(ARREST.kingAside)));
      later(player, 2, () => walk(player, ARREST.outside));
      later(player, 3, () => {
        onReleased?.(player);
        resume();
      });
    };
  }

  function prisonKing(player) {
    return kings.get(player) ?? null;
  }

  function removePrisonKing(player) {
    const king = kings.get(player);
    kings.delete(player);
    if (king?.isRegistered()) api.removeNpc(king);
  }

  function gliderFade(player, out) {
    const [colour, cycles] = GLIDER_FADE;
    player.getPacketSender().sendSubInterface(FADE_UID, FADE_INTERFACE, 1, {
      postScripts: [{ scriptId: FADE_SCRIPT, args: out ? [colour, 255, colour, 0, cycles] : [colour, 0, colour, 255, cycles] }],
    });
  }

  /** "You fly on the glider.": the glider map draws the crash flight, the player lands, Errdo says sorry. */
  function flyToKaramja(event) {
    const { player } = event;
    event.handled = true;
    event.end = true;
    const sender = player.getPacketSender();
    player.getMovementQueue().reset().setBlockMovement(true);
    sender.sendConfig(PILOT_JOURNEY_VARP, ESCAPE.journey);
    sender.sendInterface(GLIDER_MAP);
    gliderFade(player, true);
    later(player, 1, () => player.moveTo(loc(ESCAPE.landing)));
    later(player, 3, () => gliderFade(player, false));
    later(player, 4, () => {
      sender.sendConfig(PILOT_JOURNEY_VARP, -1);
      sender.closeSubInterface(FADE_UID);
      sender.sendInterfaceRemoval();
      player.getMovementQueue().setBlockMovement(false);
      onLanded?.(player, nearby(player, ESCAPE.pilot));
    });
  }

  /** "You follow the Foreman to his office": a walk, the fade, the office, and his questions. */
  function followForeman(event) {
    const { player } = event;
    event.wait = (resume) => {
      later(player, 3, () => {
        scenes.fade(player, true);
        walk(player, OFFICE.walk);
      });
      later(player, 6, () => {
        player.getMovementQueue().reset();
        player.moveTo(loc(OFFICE.arrival));
        onOffice?.(player, OFFICE.foremanFrom);
      });
      // The walks start a tick after the move, as the capture's do (t11407, the foreman t11409).
      later(player, 7, () => walk(player, OFFICE.seat));
      later(player, 9, () => onOffice?.(player, OFFICE.foremanFrom)?.getMovementQueue().addCheckpoint(loc(OFFICE.seat)));
      later(player, 8, () => scenes.fade(player, false));
      later(player, 21, () => {
        player.getMovementQueue().reset();
        resume();
      });
    };
  }

  /** Femi's cart: the player walks to it, climbs in and is dropped inside the gate, Femi and the cart beside them. */
  function femiCart(event) {
    const { player } = event;
    event.wait = (resume) => {
      player.getMovementQueue().reset().setBlockMovement(true);
      later(player, 1, () => walk(player, CART.boarding));
      later(player, 7, () => {
        player.getMovementQueue().setBlockMovement(true);
        player.performAnimation(new Animation(REACH_LADDER));
      });
      later(player, 8, () => {
        player.moveTo(loc(CART.inside));
        player.getMovementQueue().setBlockMovement(false);
        const femi = api.spawnNpc({ id: NpcIdentifiers.FEMI, x: CART.femi[0], y: CART.femi[1], z: CART.femi[2],
          wanderRadius: 0, owner: player, ownerOnly: true });
        if (femi) {
          femi.__skipDefaultRespawn = true;
          femi.setPositionToFace(player.getLocation());
          cartFemis.set(player, femi);
        }
        const cart = new GameObject(CART.cart.id, new Location(CART.cart.x, CART.cart.y, CART.cart.z),
          CART.cart.type, CART.cart.face, null);
        player.getPacketSender().sendObject(cart);
        leftovers.set(player, [...(leftovers.get(player) ?? []), ...(femi ? [femi] : [])]);
        later(player, CART.ticks, () => {
          player.getPacketSender().sendObjectRemoval(cart);
          clearLeftovers(player);
        });
        resume();
      });
    };
  }

  function isCartFemi(player, npc) {
    return !!npc && cartFemis.get(player) === npc;
  }

  function clearLeftovers(player) {
    for (const npc of leftovers.get(player) ?? []) if (npc?.isRegistered?.()) api.removeNpc(npc);
    leftovers.delete(player);
  }

  function logout(player) {
    scenes.cancel(player);
    clearLeftovers(player);
    removePrisonKing(player);
  }

  return {
    ARREST, CART, ESCAPE, FOUNDATIONS, OFFICE,
    foundationsDown, foundationsUp, guardAppears, escort, kingAppears, kingComes, release, prisonKing, removePrisonKing,
    flyToKaramja, followForeman, femiCart, isCartFemi, logout,
  };
};
