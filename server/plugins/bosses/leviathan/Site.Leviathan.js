const Common = require('./Common.Leviathan');
const { Fight } = require('./Fight.Leviathan');
const Records = require('./Records.Leviathan');
// Revision241 cache locations, independently checked for Travel actions.
const CAMP_BOAT = 49212, ISLAND_BOAT = 49213, SCAR_STONE = 49209;
const sessions = new Map();
let AreaClass;
function areaClass() {
  if (AreaClass) return AreaClass;
  AreaClass = class LeviathanIsland extends Common.core.TemplatedInstanceArea {
    constructor() { super(Common.data.instance.width, Common.data.instance.height); }
    getName() { return "The Leviathan's island"; }
    /** Scar Tissue on the island; Colossus of the Deep while the Leviathan is fought, and Scar Tissue again after. */
    getMusicTrack() {
      const { music } = Common.data;
      return this.session?.fight?.alive() ? music.fight : music.island;
    }
    allowSummonPet() { return false; }
    postLeave(mobile, logout) {
      const session = this.session;
      if (mobile === session?.player) {
        if (logout) mobile.setLocation(Common.location(Common.data.site.campReturn));
        session.end();
      }
      super.postLeave(mobile, logout);
    }
  };
  return AreaClass;
}
class Session {
  constructor(player) {
    this.player = player; this.awakened = false; this.ended = false; this.fight = null; this.perfectKills = 0;
    this.previousNpcViewDistance = player.getNpcViewDistance();
    player.setNpcViewDistance(Math.max(this.previousNpcViewDistance, Common.data.npcViewDistance));
    this.area = new (areaClass())(); this.area.session = this;
    const { sourceChunkX, sourceChunkY, width, height, planes } = Common.data.instance;
    for (const z of planes) for (let x = 0; x < width; x++) for (let y = 0; y < height; y++)
      this.area.setChunk(z, x, y, { sourceChunkX: sourceChunkX + x, sourceChunkY: sourceChunkY + y, sourcePlane: z, rotation: 0 });
    this.tails = Common.data.tails.map(({ npc, tile, face }) => {
      const tail = this.spawn(Common.ids.npcs[npc], tile);
      if (tail) {
        tail.setScriptedMovement(true);
        tail.getMovementQueue().setBlockMovement(true);
        tail.setFace(Common.core.Direction[face]);
      }
      return tail;
    }).filter(Boolean);
  }
  tile(tile) { return Common.tile(this.area, tile); }
  sourceTile(tile) { return Common.sourceTile(this.area, tile); }
  spawn(id, tile) {
    const at = this.tile(tile), npc = Common.api.spawnNpc({ id, x: at.getX(), y: at.getY(), z: at.getZ(), owner: this.player, ownerOnly: true, wanderRadius: 0 });
    if (npc) { npc.__skipDefaultRespawn = true; this.area.add(npc); }
    return npc;
  }
  biteTails() {
    for (const tail of this.tails) {
      const entry = Common.data.tails.find(entry => Common.ids.npcs[entry.npc] === tail.getId());
      if (tail.isRegistered() && entry) Common.animate(tail, entry.bite);
    }
  }
  start() {
    if (this.ended || this.fight && !this.fight.over) return;
    this.fight?.stop();
    const fight = new Fight(this); this.fight = fight; fight.start();
    const { Task, TaskManager } = Common.core;
    TaskManager.submit(new (class extends Task {
      constructor() { super(1, null, false); }
      execute() {
        if (fight.stopped || fight.session.ended || fight.session.fight !== fight) { this.stop(); return; }
        fight.process();
      }
    })());
  }
  scheduleRespawn(fight) {
    Common.later(Common.data.inferred.respawnTicks, () => {
      if (!this.ended && this.fight === fight) this.start();
    });
  }
  end() {
    if (this.ended) return;
    this.ended = true; sessions.delete(this.player); this.fight?.stop();
    this.player.setNpcViewDistance(this.previousNpcViewDistance);
    for (const tail of this.tails) {
      if (tail.getPrivateArea() === this.area) this.area.remove(tail);
      Common.api.removeNpc(tail);
    }
    this.tails = [];
    this.player.setAttribute(Common.INSIDE_ATTRIBUTE, false);
    if (this.player.getPrivateArea() === this.area) this.area.remove(this.player);
    if (!this.area.isDestroyed()) this.area.destroy();
  }
}
const sessionOf = player => sessions.get(player) ?? null;
function complete(player) {
  const request = { player, key: Common.data.quest, complete: false };
  Common.api.emitCustomEvent('quest:is-complete', request);
  return request.complete === true;
}
function travel({ player, objectId }) {
  if (objectId === ISLAND_BOAT) {
    if (!sessionOf(player)) return false;
    leave(player); return true;
  }
  if (objectId !== CAMP_BOAT || !complete(player)) return false;
  if (sessionOf(player)) return true;
  const session = new Session(player); sessions.set(player, session);
  session.area.enter(player);
  player.moveTo(session.tile(Common.data.site.islandArrival));
  player.setAttribute(Common.INSIDE_ATTRIBUTE, true);
  return true;
}
function climb({ player, objectId }) {
  const session = sessionOf(player);
  if (!session || ![Common.ids.locs.entry, Common.ids.locs.questEntry].includes(objectId)) return false;
  const at = session.sourceTile(player.getLocation());
  if (at[0] >= Common.data.site.arenaArrival[0]) {
    player.moveTo(session.tile(Common.data.site.islandArrival));
    session.fight?.stop(); session.fight = null; session.perfectKills = 0;
  } else {
    // Awakened entry stays unavailable until its uncaptured timings and damage bounds are verified.
    if (player.getInventory().contains(Common.ids.awakenerOrb)) player.sendMessage("This encounter currently supports the normal Leviathan. Your awakener's orb has not been consumed.");
    player.moveTo(session.tile(Common.data.site.arenaArrival));
    session.start();
  }
  return true;
}
function leave(player) {
  const session = sessionOf(player);
  if (!session) return;
  player.moveTo(Common.location(Common.data.site.campReturn));
  session.end();
}
function guardian({ player }) {
  if (!complete(player) || sessionOf(player)) return false;
  player.moveTo(Common.location(Common.data.site.guardianArrival));
  return true;
}
function cross({ player, objectId, location }) {
  if (objectId !== SCAR_STONE || location?.y !== 6430 || location.z !== 0 ||
      ![2031, 2033].includes(location.x) || !complete(player)) return false;
  const at = player.getLocation();
  if (at.getZ() !== 0 || Math.abs(at.getY() - 6430) > 2 || at.getX() < 2027 || at.getX() > 2037) return false;
  // Finish on the verified shore, never on the blocked water between the two stones.
  player.getMovementQueue().reset();
  player.moveTo(new Common.core.Location(at.getX() <= 2032 ? 2035 : 2029, 6430, 0));
  return true;
}
function recover({ player }) {
  if (!player.getAttribute(Common.INSIDE_ATTRIBUTE) || sessionOf(player)) return;
  player.setAttribute(Common.INSIDE_ATTRIBUTE, false);
  player.moveTo(Common.location(Common.data.site.campReturn));
}
function grave(request) {
  if (!sessionOf(request.player)) return;
  const [x, y, z] = Common.data.site.campReturn;
  request.tile = { x, y, z };
  if (Common.normalKills(request.player) < 5) request.feeMultiplier = 0.25;
}
function death({ player }) {
  const session = sessionOf(player);
  if (!session) return;
  if (session.fight && !session.fight.awakened && !session.fight.over && !session.fight.stopped) Records.died(player);
  // As in OSRS, unprotected carried items use the outside grave; existing floor loot is lost.
  session.end();
}
function readScoreboard({ player, objectId }) {
  const locs = Common.ids.locs;
  if (![locs.scoreboard, locs.scoreboardNormal, locs.scoreboardAwakened].includes(objectId) || !complete(player)) return false;
  return Records.read(player);
}
function readScoreboardParent(event) {
  // Direct/native event producers may retain the map parent's null name.
  // Keep the fallback restricted to this parent and its normal Read option.
  if (event.objectId !== Common.ids.locs.scoreboard || event.clickType !== 1) return;
  if (readScoreboard(event)) event.handled = true;
}
function attach(api) {
  Records.attach(api);
  api.persistAttribute(Common.INSIDE_ATTRIBUTE, false);
  api.onObjectInteraction('Rowboat', { Travel: travel });
  api.onObjectInteraction('Handholds', { Climb: climb });
  api.onObjectInteraction('Stepping Stone', { Cross: cross });
  api.onObjectInteraction('Scoreboard', { Read: readScoreboard });
  api.onBeforeObjectInteraction(readScoreboardParent);
  api.onNpcInteraction('Catalytic Guardian', { 'Talk-to': guardian });
  api.onPlayerLogin(recover);
  api.onPlayerDeath(death);
  api.onCustomEvent('gravestones:grave-location', grave);
}
module.exports = { attach, Session, sessionOf, travel, climb, leave, cross };
