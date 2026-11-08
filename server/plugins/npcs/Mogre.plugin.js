"use strict";

/**
 * Mogres at Mudskipper Point (docs/mogre.md): a fishing explosive thrown at one of the three
 * Ominous Fishing Spots lures a Mogre out of the water, and it attacks the thrower.
 *
 * Captured (rsprox 464, 3299; see the docs page): the throw (animation 929, graphic 50, sound
 * 2708, the vial's flight) uses one explosive and says "You hurl the shuddering vial into the
 * water..." at once; the blast sounds 3 ticks on; at 5 ticks "...and a Mogre appears!" shows,
 * the hint arrow points at the Mogre and it fights the thrower. While that Mogre is alive a
 * second throw only says "There is already one Mogre attacking you!" and keeps the explosive.
 * Wiki (Fishing explosive): before Skippy and the Mogres is finished the thrower refuses
 * ("Sinister as that fishing spot is..."), and within two squares of the spot they warn
 * themselves aloud. Wiki (Mogre): Lure and Bait do nothing ("Something seems to have scared all
 * the fishes away...").
 */

const SPOT_NAME = "Ominous Fishing Spot";
const EXPLOSIVE_NAME = "Fishing explosive";
const QUEST_KEY = "skippy_and_the_mogres";

const THROW_ANIMATION = 929; // human_stake2
const THROW_GRAPHIC = 50; // vial_launch
const THROW_GRAPHIC_HEIGHT = 96;
const VIAL_PROJECTILE = 49; // vial_travel
const THROW_SOUND = 2708;
const BLAST_SOUND = 1487;
const BLAST_SOUND_TICKS = 3;
const MOGRE_TICKS = 5;
/** Projectile packet values from the captures: start/end height, arc angle, start progress, launch delay. */
const VIAL_START_HEIGHT = 163;
const VIAL_END_HEIGHT = 30;
const VIAL_ANGLE = 15;
const VIAL_PROGRESS = 11;
const VIAL_LAUNCH_DELAY = 41;
/** Estimate: the captured flights (end 61, 66, 91 after a 41 launch) fit 5 cycles a tile. */
const VIAL_CYCLES_PER_TILE = 5;
/** Estimate: how far from the spot a throw is made without walking (no walk-up was captured). */
const THROW_RANGE = 10;
const NEAR_SPOT_RANGE = 2;
const SHORE_SEARCH = 5;
/** Estimate: a Mogre whose thrower has gone this far (or to another plane) is taken away. */
const LEASH = 20;

const HURL_MESSAGE = "You hurl the shuddering vial into the water...";
const APPEARS_MESSAGE = "...and a Mogre appears!";
const ALREADY_ONE_MESSAGE = "There is already one Mogre attacking you!";
const NOT_YET_MESSAGE = "Sinister as that fishing spot is, why would I want to explode it?";
const NEAR_SPOT_CHAT = "If this thing explodes, I think I should stand a liiiiittle further away...";
const SCARED_FISH_MESSAGE = "Something seems to have scared all the fishes away...";

let core = null;
let questApi = null;
/** The Mogre each player has out, so a second throw can be refused. */
const mogres = new Map();
/** Players with a vial in the air, so spamming the click does not throw twice. */
const throwing = new Set();

function initialize(api) {
  core = api.core;
  questApi = api;
}

function questComplete(player) {
  const request = { player, key: QUEST_KEY, complete: null };
  questApi.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function alive(npc) {
  return npc?.isRegistered?.() === true && npc.isDyingFunction?.() !== true;
}

/**
 * A Mogre still waiting in the add queue counts as out: it is not registered yet but will be.
 * One the world dropped from the queue without adding it (no free NPC slot) is gone for good.
 */
function present(npc) {
  if (!npc || npc.isDyingFunction?.() === true) return false;
  if (npc.__mogreAdded === true) return npc.isRegistered?.() === true;
  return core.World.getAddNPCQueue().includes(npc);
}

function mogreOf(player) {
  const npc = mogres.get(player);
  if (present(npc)) return npc;
  mogres.delete(player);
  return null;
}

/** Takes the player's Mogre away; one still in the add queue is removed the moment it is added. */
function dismiss(player) {
  const npc = mogres.get(player);
  mogres.delete(player);
  if (!npc) return;
  npc.__mogreCancelled = true;
  if (npc.__mogreAdded === true && alive(npc)) core.World.getRemoveNPCQueue().push(npc);
  if (player?.isRegistered?.() === true) player.getPacketSender().sendEntityHintRemoval(false);
}

function watchLeash(player, npc) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, null, false);
    }

    execute() {
      if (mogres.get(player) !== npc || !present(npc)) {
        this.stop();
        return;
      }
      if (npc.__mogreAdded !== true) return;
      const at = player.getLocation();
      const here = npc.getLocation();
      const gone = player.isRegistered?.() !== true || player.getHitpoints() <= 0
        || at.getZ() !== here.getZ() || distance(at, here) > LEASH;
      if (gone) {
        this.stop();
        dismiss(player);
      }
    }
  })());
}

function spotTile(event) {
  const at = event.object?.getLocation?.() ?? event.location;
  return new core.Location(at.x ?? at.getX(), at.y ?? at.getY(), at.z ?? at.getZ());
}

function distance(from, to) {
  return Math.max(Math.abs(from.getX() - to.getX()), Math.abs(from.getY() - to.getY()));
}

function later(ticks, action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), null, false);
    }

    execute() {
      this.stop();
      action();
    }
  })());
}

function sendSpam(player, text) {
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, text);
}

function holdsExplosive(player, itemId) {
  const { FISHING_EXPLOSIVE, FISHING_EXPLOSIVE_2 } = core.ItemIdentifiers;
  return (itemId === FISHING_EXPLOSIVE || itemId === FISHING_EXPLOSIVE_2)
    && player.getInventory().getAmount(itemId) > 0;
}

function throwVial(player, spot) {
  const { Animation, Graphic, Projectile } = core;
  player.performAnimation(new Animation(THROW_ANIMATION));
  player.performGraphic(new Graphic(THROW_GRAPHIC, 0, THROW_GRAPHIC_HEIGHT));
  player.getPacketSender().sendSoundEffect(THROW_SOUND, 1, 0);
  sendSpam(player, HURL_MESSAGE);
  const end = VIAL_LAUNCH_DELAY + VIAL_CYCLES_PER_TILE * distance(player.getLocation(), spot);
  new Projectile(
    player.getLocation(), spot, null, VIAL_PROJECTILE, VIAL_LAUNCH_DELAY, end,
    VIAL_START_HEIGHT, VIAL_END_HEIGHT, player.getPrivateArea?.() ?? null,
  ).withAngle(VIAL_ANGLE).withProgress(VIAL_PROGRESS).sendProjectile();
}

/**
 * The spot itself is water the Mogre cannot walk out of, so it comes up on the nearest free 2x2
 * of land (estimate: the captures do not show where it stands), the one closest to the player on a tie.
 */
function shoreTile(player, spot) {
  const { Location, RegionManager } = core;
  const area = player.getPrivateArea?.() ?? null;
  let best = null;
  for (let dx = -SHORE_SEARCH; dx <= SHORE_SEARCH; dx++) {
    for (let dy = -SHORE_SEARCH; dy <= SHORE_SEARCH; dy++) {
      const base = new Location(spot.getX() + dx, spot.getY() + dy, spot.getZ());
      const free = [[0, 0], [1, 0], [0, 1], [1, 1]]
        .every(([x, y]) => !RegionManager.blocked(new Location(base.getX() + x, base.getY() + y, base.getZ()), area));
      if (!free) continue;
      const score = [distance(base, spot), distance(base, player.getLocation())];
      if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && score[1] < best.score[1])) {
        best = { base, score };
      }
    }
  }
  return best ? best.base : spot;
}

function spawnMogre(player, spot) {
  const { NPC, NpcIdentifiers, World } = core;
  const npc = new NPC(NpcIdentifiers.MOGRE, shoreTile(player, spot).clone());
  npc.setOwner(player);
  npc.__skipDefaultRespawn = true;
  npc.onAdd = function onAdd() {
    core.NPC.prototype.onAdd.call(this);
    this.__mogreAdded = true;
    if (this.__mogreCancelled) {
      World.getRemoveNPCQueue().push(this);
      return;
    }
    this.getCombat().attack(player);
  };
  mogres.set(player, npc);
  World.getAddNPCQueue().push(npc);
  watchLeash(player, npc);
  return npc;
}

function emerge(player, spot) {
  throwing.delete(player);
  if (player.isRegistered?.() !== true || player.getHitpoints() <= 0) return;
  sendSpam(player, APPEARS_MESSAGE);
  const npc = spawnMogre(player, spot);
  player.getPacketSender().sendEntityHint(npc);
}

function blast(player) {
  if (player.isRegistered?.() === true) player.getPacketSender().sendSoundEffect(BLAST_SOUND, 1, 0);
}

function throwExplosive(event) {
  const { player, itemId } = event;
  if (!holdsExplosive(player, itemId)) return false;
  if (!questComplete(player)) {
    player.sendMessage(NOT_YET_MESSAGE);
    return true;
  }
  if (mogreOf(player)) {
    player.sendMessage(ALREADY_ONE_MESSAGE);
    return true;
  }
  if (throwing.has(player)) return true;
  const spot = spotTile(event);
  if (distance(player.getLocation(), spot) <= NEAR_SPOT_RANGE) player.forceChat(NEAR_SPOT_CHAT);
  throwing.add(player);
  player.getInventory().deleteNumber(itemId, 1);
  throwVial(player, spot);
  later(BLAST_SOUND_TICKS, () => blast(player));
  later(MOGRE_TICKS, () => emerge(player, spot));
  return true;
}

function scareFish({ player }) {
  player.sendMessage(SCARED_FISH_MESSAGE);
  return true;
}

/** The spot lies in the water: throws and its options are made from where the player stands, in range. */
function routeToSpot(event) {
  if (event.definition?.getName?.() !== SPOT_NAME) return;
  const at = event.player.getLocation();
  const spot = event.object.getLocation();
  if (distance(at, spot) > THROW_RANGE) return;
  event.destination = { x: at.getX(), y: at.getY(), z: at.getZ() };
}

function clearMogre(player, npc) {
  if (mogres.get(player) === npc) mogres.delete(player);
  if (player?.isRegistered?.() === true) player.getPacketSender().sendEntityHintRemoval(false);
}

function onNpcDeath({ npc, killer }) {
  const owner = npc.getOwner?.();
  if (owner && mogres.get(owner) === npc) clearMogre(owner, npc);
  else if (killer && mogres.get(killer) === npc) clearMogre(killer, npc);
}

function onLeave({ player }) {
  throwing.delete(player);
  dismiss(player);
}

function onDeath({ player }) {
  throwing.delete(player);
  dismiss(player);
}

module.exports = {
  name: "Mogre",
  members: true,
  register(api) {
    api.onServerStartup(initialize.bind(null, api));
    api.onItemOnObject(EXPLOSIVE_NAME, SPOT_NAME, throwExplosive, { noted: false });
    api.onObjectInteraction(SPOT_NAME, { Lure: scareFish, Bait: scareFish });
    api.onObjectRoute(routeToSpot);
    api.onNpcDeath(onNpcDeath);
    api.onPlayerDeath(onDeath);
    api.onPlayerLogout(onLeave);
    api.onPlayerDisconnect(onLeave);
  },
  _test: { throwExplosive, mogreOf },
};
