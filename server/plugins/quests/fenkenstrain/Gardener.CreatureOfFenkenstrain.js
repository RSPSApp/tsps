/**
 * Creature of Fenkenstrain around the gardener: him showing the way to his grave, the shed and its
 * key, the broom cupboard, the canes and the extended brush, and the chimneys. Facts with capture
 * ticks are in docs/quests/creature-of-fenkenstrain.
 */
module.exports = function registerGardener(api, { state, common, quest }) {
  const { STAGE, FIELD } = state;
  const { NPC, ITEM, LOC, SEQ, SOUND, held, heldAny, baseId, box, later, hold, release, at } = common;
  const { Animation, GameObject, Location, ObjectManager, Task, TaskManager } = api.core;

  /** His grave in the Haunted Woods, where the head is (the dig tile is beside it, 3608,3490). */
  const GRAVE = [3608, 3491];
  /** Where the guide keeps up from: further back than this (Chebyshev) and he is put 2 tiles behind (ticks 709, 906, 922). */
  const CATCH_UP_DISTANCE = 15;
  const CATCH_UP_BEHIND = 2;
  /**
   * Ours: the castle grounds and the Haunted Woods as boxes. The Wiki gives only his lines, not the
   * area; the one recorded off-track (tick 720, 3594,3512) is inside these boxes and is not reproduced.
   */
  const CASTLE_GROUNDS = { minX: 3520, maxX: 3580, minY: 3523, maxY: 3585 };
  const HAUNTED_WOODS = { minX: 3540, maxX: 3660, minY: 3440, maxY: 3530 };
  /** Off the beaten track: his first words, the farewell 6 ticks later, gone 5 after that (ticks 720-731). */
  const FAREWELL_TICKS = 6;
  const GONE_TICKS = 5;

  const LINES = Object.freeze({
    OFF_TRACK: "Oi'm afraid you've gone well off the beaten track..",
    FAREWELL: "Fare thee well - oi must return to me' garden.",
    CASTLE: "You need to head off to them Haunted Woods, mate.",
    GRAVE: "This is the place where I met me' maker.",
  });
  const START_LINE = "Well, oi s'pose oi've got 10 minutes to spare.";

  /** The upstairs west chimney (3544,3555,1) has the mould (tick 1599). */
  const MOULD_CHIMNEY = [3544, 3555, 1];
  const BRUSH_STEPS = 5;

  /** player -> the walk to the grave in progress */
  const guides = new WeakMap();

  // ------------------------------------------------------------------------------------------
  // The guide
  // ------------------------------------------------------------------------------------------

  const inBox = (loc, box) => loc.getX() >= box.minX && loc.getX() <= box.maxX && loc.getY() >= box.minY && loc.getY() <= box.maxY;
  const onRoute = (loc) => loc.getZ() === 0 && (inBox(loc, CASTLE_GROUNDS) || inBox(loc, HAUNTED_WOODS));

  function direction(from) {
    const dx = GRAVE[0] - from.getX();
    const dy = GRAVE[1] - from.getY();
    const ns = dy > 2 ? "north" : dy < -2 ? "south" : "";
    const ew = dx > 2 ? "east" : dx < -2 ? "west" : "";
    return `${ns}${ew}` || "this way";
  }

  /** The gardener's last line before he sets off; the guide starts as it is continued (ticks 609-610). */
  function startOnLine(event) {
    if (baseId(event.npc) !== NPC.GARDENER || event.text !== START_LINE) return;
    const { player, npc } = event;
    event.after = () => startGuide(player, npc);
  }

  function startGuide(player, gardener) {
    if (guides.has(player) || state.stage(player) < STAGE.PARTS) return;
    state.set(player, FIELD.GARDENER_DIRECTIONS, 1);
    const from = gardener?.getLocation?.() ?? player.getLocation();
    const npc = api.spawnNpc({ id: NPC.GARDENER_GUIDE, x: from.getX(), y: from.getY(), z: from.getZ(), owner: player, ownerOnly: true, wanderRadius: 0 });
    if (!npc) {
      state.set(player, FIELD.GARDENER_DIRECTIONS, 0);
      return;
    }
    npc.__skipDefaultRespawn = true;
    npc.setFollowing?.(player);
    const guide = { npc, leaving: false, task: null, tile: null, previous: null };
    guides.set(player, guide);
    guide.task = new (class extends Task {
      constructor() { super(1, player, false); }
      execute() {
        if (guides.get(player) !== guide) return this.stop();
        tick(player, guide);
      }
    })();
    TaskManager.submit(guide.task);
  }

  function tick(player, guide) {
    const { npc } = guide;
    if (!player.isRegistered?.() || !npc.isRegistered?.()) return endGuide(player);
    const here = player.getLocation();
    if (guide.tile && !guide.tile.equals(here)) guide.previous = guide.tile;
    guide.tile = here;
    if (here.getZ() !== npc.getLocation().getZ() || here.getDistance(npc.getLocation()) > 64) return endGuide(player);
    if (guide.leaving) return;
    if (!onRoute(here)) return leave(player, guide);
    if (here.getDistance(npc.getLocation()) > CATCH_UP_DISTANCE) catchUp(player, guide);
  }

  /** Put him a couple of tiles behind the player, the way the player came. */
  function catchUp(player, { npc, previous }) {
    const here = player.getLocation();
    const last = previous ?? npc.getLocation();
    const dx = Math.sign(last.getX() - here.getX()) || Math.sign(npc.getLocation().getX() - here.getX());
    const dy = Math.sign(last.getY() - here.getY()) || Math.sign(npc.getLocation().getY() - here.getY());
    npc.getMovementQueue?.().reset?.();
    npc.moveTo(new Location(here.getX() + dx * CATCH_UP_BEHIND, here.getY() + dy * CATCH_UP_BEHIND, here.getZ()));
    npc.setFollowing?.(player);
  }

  function leave(player, guide) {
    guide.leaving = true;
    guide.npc.forceChat(LINES.OFF_TRACK);
    later(player, FAREWELL_TICKS, () => {
      if (guides.get(player) !== guide) return;
      guide.npc.forceChat(LINES.FAREWELL);
      later(player, GONE_TICKS, () => {
        if (guides.get(player) === guide) endGuide(player);
      });
    });
  }

  function endGuide(player) {
    const guide = guides.get(player);
    guides.delete(player);
    if (guide) {
      guide.task?.stop?.();
      guide.npc?.setFollowing?.(null);
      if (guide.npc?.isRegistered?.()) api.removeNpc(guide.npc);
    }
    if (state.get(player, FIELD.GARDENER_DIRECTIONS)) state.set(player, FIELD.GARDENER_DIRECTIONS, 0);
  }

  /** The head is dug up with him there: his line as it comes up, gone as its box is continued (ticks 934, 937). */
  function atGrave(player) {
    const guide = guides.get(player);
    if (!guide) return null;
    guide.leaving = true;
    guide.npc.forceChat(LINES.GRAVE);
    return () => endGuide(player);
  }

  /** Talking to him on the way: where to go (ticks 721-724). */
  function talkToGuide(event) {
    const { player } = event;
    if (baseId(event.npc) !== NPC.GARDENER_GUIDE) return false;
    const guide = guides.get(player);
    if (!guide || guide.npc !== event.npc) return true;
    const here = player.getLocation();
    guide.npc.forceChat(inBox(here, CASTLE_GROUNDS) && !inBox(here, HAUNTED_WOODS) ? LINES.CASTLE : `Go ${direction(here)}, mate.`);
    return true;
  }

  // ------------------------------------------------------------------------------------------
  // The shed (Doors.plugin opens it as a pass-through gate)
  // ------------------------------------------------------------------------------------------

  /** The rusty key opens it once and goes into the lock (tick 1515); after that it opens freely (1524). */
  function shedDoor(event) {
    const { player, objectId } = event;
    if (objectId !== LOC.SHED_DOOR) return;
    const unlocked = state.get(player, FIELD.UNLOCKED_SHED);
    if (!unlocked && !held(player, ITEM.SHED_KEY)) {
      event.handled = true;
      player.sendMessage("The door is locked.");
      return;
    }
    if (!unlocked) {
      player.getInventory().deleteNumber(ITEM.SHED_KEY, 1);
      state.set(player, FIELD.UNLOCKED_SHED, 1);
    }
    // Every opening also sends the lock's sound (ticks 1515, 1525).
    player.getPacketSender().sendSoundEffect(SOUND.LOCKED, 1, 0);
  }

  // ------------------------------------------------------------------------------------------
  // The broom cupboard and the canes
  // ------------------------------------------------------------------------------------------

  function swap(object, id) {
    const location = object.getLocation();
    ObjectManager.deregister(object, true);
    ObjectManager.register(new GameObject(id, new Location(location.getX(), location.getY(), location.getZ()),
      object.getType(), object.getFace(), object.getPrivateArea?.() ?? null), true);
  }

  /** The reach, then the doors open a tick later (ticks 1517-1520). */
  function openCupboard(event) {
    const { player, objectId, object } = event;
    if (objectId !== LOC.CUPBOARD || !object) return false;
    player.performAnimation(new Animation(SEQ.OPEN_HIGH_CUPBOARD));
    player.getPacketSender().sendSoundEffect(SOUND.CUPBOARD_OPEN, 1, 0);
    later(player, 1, () => swap(object, LOC.CUPBOARD_OPEN));
    return true;
  }

  /** Ours: no capture shuts it; the doors close with no sound. */
  function shutCupboard(event) {
    const { objectId, object } = event;
    if (objectId !== LOC.CUPBOARD_OPEN || !object) return false;
    swap(object, LOC.CUPBOARD);
    return true;
  }

  function searchCupboard(event) {
    const { player, objectId } = event;
    if (objectId !== LOC.CUPBOARD_OPEN) return false;
    if (heldAny(player, ITEM.BRUSHES)) {
      player.sendMessage("You search the cupboard but find nothing.");
      return true;
    }
    if (!common.room(player)) return true;
    player.getInventory().adds(ITEM.BRUSHES[0], 1);
    box(player, "You find a garden brush in the cupboard.", ITEM.BRUSHES[0]);
    return true;
  }

  function takeCane(event) {
    const { player, objectId } = event;
    if (objectId !== LOC.CANE_PILE) return false;
    if (player.getInventory().getFreeSlots() < 1) {
      // Ours: the usual full-inventory line; no capture takes a cane with a full pack.
      player.sendMessage("You don't have enough inventory space.");
      return true;
    }
    player.getInventory().adds(ITEM.CANE, 1);
    player.sendMessage("You take a garden cane from the pile.");
    return true;
  }

  /** A cane on the brush, held together with bronze wire (ticks 1554-1559; the refusals are the Wiki's). */
  function extendBrush(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const ids = [usedItemId, usedWithItemId];
    const brush = ids.find((id) => ITEM.BRUSHES.includes(id));
    const cane = ids.includes(ITEM.CANE);
    const wire = ids.includes(ITEM.BRONZE_WIRE);
    if (!(cane || brush !== undefined)) return false;
    if (!(cane && brush !== undefined) && !(wire && (cane || brush !== undefined))) return false;
    event.handled = true;
    if (wire) {
      player.sendMessage("Nothing interesting happens.");
      return true;
    }
    if (brush === ITEM.BRUSHES[3]) {
      player.sendMessage("The brush is too long to attach any more canes.");
      return true;
    }
    if (!held(player, ITEM.BRONZE_WIRE)) {
      player.sendMessage("You try to attach the canes, but you need something suitable to hold them together.");
      return true;
    }
    const inventory = player.getInventory();
    inventory.deleteNumber(ITEM.BRONZE_WIRE, 1);
    inventory.deleteNumber(ITEM.CANE, 1);
    inventory.deleteNumber(brush, 1);
    inventory.adds(ITEM.BRUSHES[ITEM.BRUSHES.indexOf(brush) + 1], 1);
    player.sendMessage("You attach the cane to the brush.");
    return true;
  }

  // ------------------------------------------------------------------------------------------
  // The chimneys
  // ------------------------------------------------------------------------------------------

  /** The three-cane brush up a chimney: the poke, then 5 ticks later the clean and maybe the mould (ticks 1599-1605). */
  function brushChimney(event) {
    const { player, itemId, objectId, location } = event;
    if (objectId !== LOC.FIREPLACE || !ITEM.BRUSHES.includes(itemId)) return false;
    event.handled = true;
    if (itemId !== ITEM.BRUSHES[3]) {
      // The Wiki's answer for the garden brush; Ours for one or two canes.
      player.sendMessage("Nothing interesting happens.");
      return true;
    }
    if (common.busy(player)) return true;
    const token = hold(player);
    player.performAnimation(new Animation(SEQ.POKE));
    player.getPacketSender().sendSoundEffect(SOUND.BRUSHING, 1, 0);
    later(player, BRUSH_STEPS, () => {
      release(player, token);
      player.sendMessage("You give the chimney a jolly good clean out.");
      if (!at(location, ...MOULD_CHIMNEY) || held(player, ITEM.MOULD) || !common.room(player)) return;
      player.getInventory().adds(ITEM.MOULD, 1);
      box(player, "A lightning conductor mould falls down out of the chimney.", ITEM.MOULD);
    });
    return true;
  }

  function forget({ player }) {
    endGuide(player);
  }

  api.onCustomEvent("npc-dialogue:line", startOnLine);
  api.onNpcInteraction("Gardener Ghost", { "Talk-to": talkToGuide });
  api.onCustomEvent("door:toggle", shedDoor);
  api.onObjectInteraction("Cupboard", { Open: openCupboard });
  api.onObjectInteraction("Open Cupboard", { Search: searchCupboard, Shut: shutCupboard });
  api.onObjectInteraction("Pile of canes", { "Take-from": takeCane });
  api.onItemOnItem(extendBrush);
  api.onItemOnObject(brushChimney, { noted: false });
  api.onPlayerLogout(forget);

  return { atGrave, endGuide, guiding: (player) => guides.has(player) };
};
