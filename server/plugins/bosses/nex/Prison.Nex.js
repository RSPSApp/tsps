/**
 * The Ancient Prison under the God Wars Dungeon (docs/nex.md): its Area, the frozen key and doors,
 * the prison's two doors, the plaque, the scoreboard and Nex's altar.
 *
 * - Area: part of the God Wars Dungeon (its essence overlay stays up, Zaros's counter on varbit
 *   13080), multi-combat; the Zarosian followers attack anyone not wearing something of Zaros's and
 *   each one killed is a point of ancient essence (Wiki). A login inside the prison proper wakes the
 *   player in its entry room (Wiki).
 * - Frozen key (Wiki): the four generals' pieces "Assemble" into it; used on the Frozen Door from the
 *   God Wars side it unseals the door for good; without it the door laments (six lines, Wiki).
 * - The outer prison door asks once, as captured ("Go through the door? It could be dangerous.");
 *   the inner one, into the safe room, takes 40 ancient essence (or an ecumenical key) and refuses
 *   with the captured message. Both swing open as the God Wars doors do, as captured.
 * - Altar (Wiki): Pray restores Prayer and, wearing something Zarosian, also hitpoints, run and
 *   special attack energy, once every ten minutes; Teleport leads out of the chamber to the safe
 *   room's door.
 */
const Common = require("./Common.Nex");
const GodWars = require("../godwars/Common.GodWars");
const Rules = require("../godwars/Rules.GodWars");

const ALTAR_COOLDOWN_MS = 10 * 60 * 1000;
const PRAY_ANIMATION = 645;
const DOOR_OPEN = 26506;
const DOOR_OPEN_WALL = 26507;
const DOOR_SOUNDS = [71, 70];
const EAST = 1536;
const SKIP_DOOR_ATTRIBUTE = "nex:skip-door-warning";

let prisonArea = null;

// ------------------------------------------------------------------ the Area

let AreaClass = null;

function areaClass() {
  if (AreaClass) return AreaClass;
  const { Area, Boundary } = Common.core;
  AreaClass = class AncientPrison extends Area {
    /** The prison around the chamber: an actor keeps its area while inside it, so the chamber is cut out. */
    constructor() {
      const { box } = Common.data.prison;
      const hole = Common.data.chamber.box;
      const parts = [
        [box.minX, hole.minX - 1, box.minY, box.maxY],
        [hole.maxX + 1, box.maxX, box.minY, box.maxY],
        [hole.minX, hole.maxX, box.minY, hole.minY - 1],
        [hole.minX, hole.maxX, hole.maxY + 1, box.maxY],
      ].filter(([minX, maxX, minY, maxY]) => minX <= maxX && minY <= maxY);
      super(parts.map(([minX, maxX, minY, maxY]) => new Boundary(minX, maxX, minY, maxY, box.z)));
      this.isGodWarsArea = true;
    }

    getName() {
      return "Ancient Prison";
    }

    isMulti() {
      return true;
    }

    postEnter(mobile) {
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer();
      require("../godwars/Dungeon.GodWars").openOverlay(player);
      require("./Chamber.Nex").sendBarrier(player);
    }

    postLeave(mobile, logout) {
      if (!mobile.isPlayer() || logout) return;
      const player = mobile.getAsPlayer();
      const Dungeon = require("../godwars/Dungeon.GodWars");
      Common.later(1, () => player.isRegistered() && !Dungeon.inGodWars(player) && Dungeon.closeOverlay(player));
    }

    /** The prison's followers ignore anyone wearing something of Zaros's (Wiki). */
    npcAggression(player, npc) {
      if (!isFollower(npc.getId())) return null;
      return !Common.wearsZarosian(player);
    }
  };
  return AreaClass;
}

function isFollower(id) {
  return Common.data.npcs.followers.some(([lo, hi]) => id >= lo && id <= hi);
}

/** A point of ancient essence for each follower killed in the prison. */
function creditKill({ killer, npc }) {
  if (!killer?.isPlayer?.() || !npc || !isFollower(npc.getId())) return;
  const player = killer.getAsPlayer();
  if (!Common.inBox(Common.data.prison.box, player.getLocation())) return;
  Common.setEssence(player, Common.getEssence(player) + 1);
}

/** Wiki: logging out in the prison proper (not the entry room) wakes the player in its entry room. */
function wakeInEntryRoom({ player }) {
  const { prison, chamber } = Common.data;
  const at = player.getLocation();
  if (Common.inBox(prison.camp, at) || Common.inBox(chamber.box, at)) player.moveTo(Common.toLocation(prison.entryRoom));
}

// ------------------------------------------------------------------ the frozen key and door

function assembleKey({ player }) {
  const { items } = Common.data;
  const inventory = player.getInventory();
  if (!items.keyPieces.every((id) => inventory.contains(id))) {
    player.sendMessage("You need all four frozen key pieces to assemble the key.");
    return true;
  }
  for (const id of items.keyPieces) inventory.delete(id, 1);
  inventory.adds(items.frozenKey, 1);
  player.sendMessage("You assemble the frozen key.");
  return true;
}

function openFrozenDoor({ player, objectId }) {
  const { objects, items, prison, prisonTexts } = Common.data;
  if (objects.frozenDoorInner.includes(objectId)) {
    Common.fadeMove(player, Common.toLocation(prison.gwdSide));
    return true;
  }
  if (!objects.frozenDoorOuter.includes(objectId)) return false;
  if (player.getAttribute(Common.UNLOCKED_ATTRIBUTE) !== true) {
    if (!player.getInventory().contains(items.frozenKey)) {
      player.sendMessage(`<col=7f007f>${Common.pick(prisonTexts.laments)}</col>`);
      return true;
    }
    player.getInventory().delete(items.frozenKey, 1);
    player.setAttribute(Common.UNLOCKED_ATTRIBUTE, true);
    player.sendMessage("The frozen key unseals the door, and crumbles away.");
  }
  Common.fadeMove(player, Common.toLocation(prison.prisonSide));
  return true;
}

// ------------------------------------------------------------------ the prison's doors

/** The door swings open for two ticks behind the player (captured on both prison doors). */
function swing(object) {
  const { GameObject, ObjectManager } = Common.core;
  const at = object.getLocation();
  const face = object.getFace();
  const open = new GameObject(DOOR_OPEN, at, 10, face, null);
  const wall = new GameObject(DOOR_OPEN_WALL, at, 0, (face + 1) % 4, null);
  ObjectManager.deregister(object, false);
  ObjectManager.register(open, true);
  ObjectManager.register(wall, true);
  Common.later(3, () => {
    ObjectManager.deregister(wall, true);
    ObjectManager.deregister(open, false);
    ObjectManager.register(new GameObject(object.getId(), at, object.getType(), face, null), true);
  });
}

/** Through a door two tiles along x, as captured: the turn, the swing a tick later, the step after. */
function walkThrough(player, object, dx) {
  player.getMovementQueue().reset();
  player.setPositionToFace?.(object.getLocation());
  player.getPacketSender().sendInterfaceRemoval();
  Common.later(1, () => {
    if (!player.isRegistered()) return;
    swing(object);
    for (const id of DOOR_SOUNDS) Common.areaSound([player], object.getLocation(), [id, 0, 5]);
    Common.later(1, () => player.isRegistered() && player.moveTo(player.getLocation().transform(dx, 0)));
  });
}

/** Between the entry room and the prison proper; asked once on the way in (captured). */
function outerDoor({ player, object }) {
  const westOf = player.getLocation().getX() < object.getLocation().getX();
  if (!westOf || player.getAttribute(SKIP_DOOR_ATTRIBUTE) === true) {
    walkThrough(player, object, westOf ? 2 : -2);
    return true;
  }
  Common.api.sendMultiChatboxPrompt(player, "Go through the door? It could be dangerous.",
    "Yes.", () => walkThrough(player, object, 2),
    "Yes, and don't ask again.", () => {
      player.setAttribute(SKIP_DOOR_ATTRIBUTE, true);
      walkThrough(player, object, 2);
    },
    "No.", () => player.getPacketSender().sendInterfaceRemoval());
  return true;
}

/** Into the safe room: 40 ancient essence (or an ecumenical key), spent on the way in. */
function innerDoor({ player, object }) {
  const { prison } = Common.data;
  const entering = player.getLocation().getX() < object.getLocation().getX();
  if (!entering) {
    walkThrough(player, object, -2);
    return true;
  }
  const { ItemIdentifiers } = Common.core;
  const result = Rules.canOpenBossDoor({
    killCount: Common.getEssence(player),
    hasKey: player.getInventory().contains(ItemIdentifiers.ECUMENICAL_KEY),
    required: prison.essenceRequired,
  });
  if (!result.ok) {
    player.sendMessage(`This door is locked by an ancient power!<br>You need to collect at least ${result.required} Ancient essence before it will open.`);
    return true;
  }
  if (result.consumesKey) {
    player.getInventory().delete(ItemIdentifiers.ECUMENICAL_KEY, 1);
    player.sendMessage("Your ecumenical key melts into the door.");
  } else {
    Common.setEssence(player, Common.getEssence(player) - result.spendsEssence);
  }
  walkThrough(player, object, 2);
  return true;
}

// ------------------------------------------------------------------ the safe room

function readPlaque({ player }) {
  Common.statement(player, Common.data.prisonTexts.plaque);
  return true;
}

function readScoreboard({ player }) {
  const state = require("./Chamber.Nex").state;
  const kills = Common.count(player, Common.KILLS_ATTRIBUTE);
  const deaths = Common.count(player, Common.DEATHS_ATTRIBUTE);
  const best = state.bestTicks > 0 ? Common.formatTicks(state.bestTicks) : "-";
  Common.statement(player, `Your Nex kills: ${kills}. Your deaths: ${deaths}.<br>This world: ${state.kills} kills, ${state.deaths} deaths, best time ${best}.`);
  return true;
}

// ------------------------------------------------------------------ the altar

function pray({ player }) {
  if (Common.core.CombatFactory.inCombat(player)) {
    player.sendMessage("You need to be out of combat to use this altar.");
    return true;
  }
  const now = Date.now();
  const since = now - (Number(player.getAttribute(Common.ALTAR_ATTRIBUTE)) || 0);
  if (since < ALTAR_COOLDOWN_MS) {
    const minutes = Math.ceil((ALTAR_COOLDOWN_MS - since) / 60000);
    player.sendMessage(`The gods blessed you recently. They will ignore your prayers for another ${minutes === 1 ? "minute" : `${minutes} minutes`}.`);
    return true;
  }
  player.setAttribute(Common.ALTAR_ATTRIBUTE, now);
  const { Skill, Sound, Sounds } = Common.core;
  const skills = player.getSkillManager();
  player.performAnimation(Common.animation(PRAY_ANIMATION));
  Sounds.sendSound(player, Sound.PRAYER_RECHARGE);
  skills.setCurrentLevel(Skill.PRAYER, skills.getMaxLevel(Skill.PRAYER), true);
  player.sendMessage("You recharge your Prayer points.");
  if (Common.wearsZarosian(player)) {
    player.heal(skills.getMaxLevel(Skill.HITPOINTS));
    player.setRunEnergy(100);
    player.getPacketSender().sendRunEnergy();
    player.setSpecialPercentage(100);
    player.getPacketSender().updateSpecialAttackOrb();
    player.sendMessage("Your affinity to the Empty Lord energizes you further.");
  }
  return true;
}

function teleport({ player }) {
  const Instance = require("./Instance.Nex");
  player.getMovementQueue().reset();
  player.getCombat().reset();
  if (!Instance.leave(player)) Common.fadeMove(player, Common.toLocation(Common.data.prison.altarExit));
  player.sendMessage("You are teleported to a place of relative safety.");
  return true;
}

function attachPrison(api) {
  const { objects, items } = Common.data;
  api.persistAttribute(Common.UNLOCKED_ATTRIBUTE, false);
  api.persistAttribute(Common.ALTAR_ATTRIBUTE, 0);
  api.persistAttribute(SKIP_DOOR_ATTRIBUTE, false);
  prisonArea = new (areaClass())();
  api.registerArea(prisonArea);
  api.onNpcDeath(creditKill);
  api.onPlayerLogin(wakeInEntryRoom);
  for (const name of items.keyPieceNames) api.onItemAction(name, { Assemble: assembleKey });
  api.onObjectFirstClick([...objects.frozenDoorOuter, ...objects.frozenDoorInner], openFrozenDoor);
  api.onObjectFirstClick(objects.outerPrisonDoor, outerDoor);
  api.onObjectFirstClick(objects.innerPrisonDoor, innerDoor);
  api.onObjectInteraction("Ancient Plaque", { Read: readPlaque });
  api.onObjectFirstClick(objects.scoreboard, readScoreboard);
  api.onObjectFirstClick(objects.altar, pray);
  api.onObjectSecondClick(objects.altar, teleport);
}

module.exports = { attachPrison, isFollower, assembleKey, openFrozenDoor, outerDoor, innerDoor, pray, teleport, creditKill, swing };
