/**
 * The Telekinetic Theatre (Wiki: Mage_Training_Arena/Telekinetic_Theatre, Maze_Guardian,
 * Telekinetic_Guardian) and rsprox recording 1757:
 * - Magic 33 (Telekinetic Grab) to enter; the statue starts on a fixed tile in one of ten mazes;
 * - a cast pulls the statue towards the side of the maze its caster stands on, sliding it until a
 *   wall stops it; a cast from a corner spends its runes and moves nothing;
 * - a solved maze gives 2 Telekinetic Pizazz Points and 250 Magic XP; every fifth in a row gives
 *   another 8 points, 1,000 XP, 10 law runes and full run energy;
 * - New-maze on the completed guardian moves the player to the next maze; Reset returns the
 *   statue to its start without breaking the streak; leaving (and logging out) clears the maze
 *   but keeps the streak, as the Wiki says.
 */
const Common = require("./Common.MageTrainingArena");

const STREAK_ATTRIBUTE = "mage-training-arena:telekinetic-streak";
const TELEKINETIC_GRAB_SPELL_ID = 1168;
const MAZE_MOVE_CYCLES = 150;

const sessions = new Map();

const component = (interfaceId, child) => (interfaceId << 16) | child;
const pointsComponent = () => component(Common.data.telekinetic.interface, Common.data.telekinetic.pointsComponent);
const streakComponent = () => component(Common.data.telekinetic.interface, Common.data.telekinetic.streakComponent);

const sessionOf = (player) => sessions.get(player) ?? null;
const sameTile = (a, b) => a.getX() === b.getX() && a.getY() === b.getY() && a.getZ() === b.getZ();
/** A different maze each time, as the Wiki says leaving an incomplete maze picks a new one. */
function randomMazeIndex(current = null, random = Math.random) {
  const count = Common.data.telekinetic.mazes.length;
  if (current === null) return Math.floor(random() * count);
  return (current + 1 + Math.floor(random() * (count - 1))) % count;
}

// --- The statue and the maze

/** The direction from the maze's side the player stands on, or null on a corner. */
function directionFor(location, walls) {
  const [minX, maxX, minY, maxY] = walls;
  const x = location.getX();
  const y = location.getY();
  if (y >= maxY && x > minX && x < maxX) return [0, 1];
  if (y <= minY && x > minX && x < maxX) return [0, -1];
  if (x >= maxX && y > minY && y < maxY) return [1, 0];
  if (x <= minX && y > minY && y < maxY) return [-1, 0];
  return null;
}

/** Whether a one-tile step from (x, y, z) is free; the maze walls are the world's own. */
function canStep(x, y, z, dx, dy, area = null) {
  const RegionManager = Common.core.RegionManager;
  return RegionManager.canMove(x, y, x + dx, y + dy, z, 1, 1, area);
}

/** Pulls the statue in `direction` until the next tile is blocked. */
function slide(start, direction, step = canStep) {
  const [dx, dy] = direction;
  let x = start.getX();
  let y = start.getY();
  while (step(x, y, start.getZ(), dx, dy)) {
    x += dx;
    y += dy;
  }
  return new Common.core.Location(x, y, start.getZ());
}

// --- The overlay

function updateOverlay(player) {
  const sender = player.getPacketSender();
  sender.sendString?.(Common.points(player, "telekinetic").toLocaleString("en-GB"), pointsComponent());
  sender.sendString?.(String(Number(player.getAttribute(STREAK_ATTRIBUTE)) || 0), streakComponent());
}

function sendOverlay(player) {
  Common.sendOverlay(player, Common.data.telekinetic.interface);
  updateOverlay(player);
}

// --- The session

function startSession(player, index) {
  const { mazes } = Common.data.telekinetic;
  const mazeIndex = ((index % mazes.length) + mazes.length) % mazes.length;
  const maze = mazes[mazeIndex];
  const [x, y, z] = maze.start;
  const npc = Common.api.spawnNpc({
    id: Common.ids.npcs.mazeGuardian,
    x,
    y,
    z,
    wanderRadius: 0,
    face: 0,
    owner: player,
    ownerOnly: true,
  });
  const session = { player, mazeIndex, maze, npc, solved: false, moving: false, observed: false };
  sessions.set(player, session);
  sendOverlay(player);
  return session;
}

function removeSession(player) {
  const session = sessions.get(player);
  if (!session) return;
  sessions.delete(player);
  if (session.npc) Common.api.removeNpc(session.npc);
  if (session.observed) player.getPacketSender().sendCameraReset?.();
  Common.closeOverlay(player);
}

function forget({ player }) {
  removeSession(player);
}

/** The Telekinetic Teleport: Magic 33. */
function enter(player) {
  const existing = sessionOf(player);
  if (existing) {
    player.moveTo(Common.toLocation(existing.maze.arrive));
    return true;
  }
  const { level } = Common.data.telekinetic;
  if (player.getSkillManager().getCurrentLevel(Common.core.Skill.MAGIC) < level) {
    player.sendMessage(Common.message("level", { level, room: "Telekinetic Theatre" }));
    return true;
  }
  const index = randomMazeIndex();
  if (!startSession(player, index)) return true;
  player.moveTo(Common.toLocation(Common.data.telekinetic.mazes[index].arrive));
  player.sendMessage(Common.message("telekineticEntered"));
  return true;
}

function enterObject({ player, objectId }) {
  if (objectId !== Common.ids.locs.telekineticPortal) return false;
  return enter(player);
}

// --- The guardian's options

/** Observe: the overhead view the Wiki and capture show; selecting it again restores the camera. */
function observe({ player, npc }) {
  const session = sessionOf(player);
  if (!session || session.npc !== npc) return false;
  session.observed = !session.observed;
  const sender = player.getPacketSender();
  if (session.observed) {
    sender.sendCameraLookAt?.(3342, 9716, 0, true);
    sender.sendCameraMoveTo?.(3342, 9717, 2275, true);
  } else {
    sender.sendCameraReset?.();
  }
  return true;
}

/** Reset: the statue goes back to its start; the streak is not broken. */
function reset({ player, npc }) {
  const session = sessionOf(player);
  if (!session || session.npc !== npc || session.moving) return false;
  session.solved = false;
  npc.moveTo(Common.toLocation(session.maze.start));
  npc.setNpcTransformationId?.(Common.ids.npcs.mazeGuardian);
  return true;
}

/** New-maze: the completed guardian is replaced by the next maze's statue. */
function newMaze({ player, npc }) {
  const session = sessionOf(player);
  if (!session || session.npc !== npc || !session.solved) return false;
  if (session.npc) Common.api.removeNpc(session.npc);
  sessions.delete(player);
  const next = randomMazeIndex(session.mazeIndex);
  if (!startSession(player, next)) return true;
  player.moveTo(Common.toLocation(Common.data.telekinetic.mazes[next].arrive));
  return true;
}

/** The two Maze Guardian forms carry different cache names (one coloured), so match by id. */
function mazeGuardianAction(event) {
  const id = event.npc?.getId?.() ?? event.npcId;
  if (id !== Common.ids.npcs.mazeGuardian && id !== Common.ids.npcs.mazeGuardianComplete) return;
  const action = event.definition?.getActions?.()?.[event.clickType - 1];
  const handled =
    action === "Observe" ? observe(event) :
    action === "Reset" ? reset(event) :
    action === "New-maze" ? newMaze(event) :
    false;
  if (handled) event.handled = true;
}

// --- Casting Telekinetic Grab

function castVisuals(player, target) {
  const { Animation, Graphic, GraphicHeight, Projectile } = Common.core;
  player.performAnimation?.(new Animation(723));
  player.performGraphic?.(new Graphic(142, 0, GraphicHeight.HIGH));
  if (Projectile) {
    new Projectile(
      player.getLocation().clone(),
      target.clone(),
      null,
      143,
      40,
      80,
      43,
      31,
      player.getPrivateArea?.()
    ).sendProjectile();
  }
  player.getPacketSender().sendGlobalGraphic?.(new Graphic(144, 80, GraphicHeight.LOW), target);
  player.getPacketSender().sendSound?.(3006);
  Common.core.Sounds?.playAreaSound?.({
    soundId: 3007,
    x: target.getX(),
    y: target.getY(),
    level: target.getZ(),
    loops: 1,
    delay: 4,
    radius: 10,
  });
}

/** The statue moves, then either wakes the guardian or becomes a statue again. */
function moveStatue(session, destination) {
  const { player, npc, maze } = session;
  if (!npc) return;
  session.moving = true;
  npc.setNpcTransformationId?.(Common.ids.npcs.mazeGuardianMoving);
  npc.exactMove(destination, { endCycles: MAZE_MOVE_CYCLES });
  Common.later(Math.ceil(MAZE_MOVE_CYCLES / 30), () => {
    if (sessionOf(player) !== session) return;
    session.moving = false;
    if (sameTile(destination, Common.toLocation(maze.goal))) {
      complete(session);
    } else {
      npc.setNpcTransformationId?.(Common.ids.npcs.mazeGuardian);
    }
  });
}

/** The maze is solved: 2 points and 250 XP, plus the fifth-maze bonus. */
function complete(session) {
  const { player, npc } = session;
  const { telekinetic } = Common.data;
  session.solved = true;
  npc?.setNpcTransformationId?.(Common.ids.npcs.mazeGuardianComplete);
  const at = npc?.getLocation?.() ?? player.getLocation();
  for (const soundId of [1666, 1665]) {
    Common.core.Sounds?.playAreaSound?.({
      soundId,
      x: at.getX(),
      y: at.getY(),
      level: at.getZ(),
      loops: 1,
      radius: 10,
    });
  }

  const points = Common.awardPoints(player, "telekinetic", telekinetic.mazePoints);
  player.getSkillManager().addExperiences(Common.core.Skill.MAGIC, telekinetic.mazeXp);
  player.sendMessage(Common.message("mazeComplete", { points }));

  let streak = (Number(player.getAttribute(STREAK_ATTRIBUTE)) || 0) + 1;
  if (streak >= telekinetic.bonusEvery) {
    streak = 0;
    const bonus = Common.awardPoints(player, "telekinetic", telekinetic.bonusPoints);
    player.getSkillManager().addExperiences(Common.core.Skill.MAGIC, telekinetic.bonusXp);
    const law = Common.ids.items.law;
    const inventory = player.getInventory();
    if (inventory.contains(law) || inventory.getFreeSlots() > 0) {
      inventory.adds(law, telekinetic.bonusRunes);
    } else {
      const { Item, ItemOnGroundManager } = Common.core;
      ItemOnGroundManager.registerLocation(player, new Item(law, telekinetic.bonusRunes), player.getLocation().clone());
    }
    player.setRunEnergy?.(100);
    player.getPacketSender().sendRunEnergy?.();
    player.sendMessage(Common.message("mazeBonus", { points: bonus, runes: telekinetic.bonusRunes }));
  }
  player.setAttribute(STREAK_ATTRIBUTE, streak);
  updateOverlay(player);
}

function castTelekinetic(event) {
  const session = sessionOf(event.player);
  if (!session || session.npc !== event.npc || event.spellId !== TELEKINETIC_GRAB_SPELL_ID) return;
  event.handled = true;
  if (session.solved || session.moving || !session.npc) return;
  if (!event.consumeRunes()) return;

  const target = session.npc.getLocation();
  castVisuals(event.player, target);
  const direction = directionFor(event.player.getLocation(), session.maze.walls);
  if (!direction) return;

  const destination = slide(target, direction);
  if (sameTile(destination, target)) return;
  moveStatue(session, destination);
}

// --- The area

function defineArea() {
  const { Area, Boundary } = Common.core;
  const [minX, maxX, minY, maxY] = Common.data.telekinetic.bounds;
  return class TelekineticTheatre extends Area {
    constructor() {
      super(Common.data.telekinetic.levels.map((z) => new Boundary(minX, maxX, minY, maxY, z)));
    }

    getName() {
      return "Telekinetic Theatre";
    }

    postEnter(mobile) {
      if (!mobile?.isPlayer?.()) return;
      const player = mobile.getAsPlayer();
      if (sessionOf(player)) sendOverlay(player);
    }

    postLeave(mobile) {
      if (!mobile?.isPlayer?.()) return;
      removeSession(mobile.getAsPlayer());
    }
  };
}

let area = null;

function attach(api) {
  api.persistAttribute(STREAK_ATTRIBUTE, 0);
  area = new (defineArea())();
  Common.registerRoom("telekinetic", area);
  api.onObjectInteraction("Telekinetic Teleport", { Enter: enterObject });
  api.onNpcInteraction(mazeGuardianAction);
  api.onSpellOnNpc(castTelekinetic);
  api.onPlayerLogout(forget);
}

module.exports = {
  attach, enter, enterObject, observe, reset, newMaze, mazeGuardianAction, castTelekinetic, complete, moveStatue,
  startSession, removeSession, sessionOf, directionFor, randomMazeIndex, slide, canStep, updateOverlay, sendOverlay,
  pointsComponent, streakComponent, defineArea, STREAK_ATTRIBUTE, TELEKINETIC_GRAB_SPELL_ID, MAZE_MOVE_CYCLES,
  get area() { return area; },
  get sessions() { return sessions; },
};
