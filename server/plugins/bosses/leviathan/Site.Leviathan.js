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
    /** Scar Tissue on the island; Colossus of the Deep from the fight's start until the kill is counted. */
    getMusicTrack() {
      const { music } = Common.data, fight = this.session?.fight;
      const fought = fight && !fight.stopped && !fight.rewarded && !this.session.ended
        && fight.boss?.isRegistered() && fight.player.getHitpoints() > 0;
      return fought ? music.fight : music.island;
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
    // rsprox 227 (00100 tick 4743, 01751 tick 12491): on arrival the island rowboat is the
    // Escape/Quick-escape boat (49215); the kill turns it into the Travel boat (49214).
    Common.replaceLoc(this.area, Common.data.site.islandBoat, Common.ids.locs.boatEscape);
  }
  killed() {
    if (!this.ended) Common.replaceLoc(this.area, Common.data.site.islandBoat, Common.ids.locs.boatLeave);
  }
  /**
   * Wiki (Handholds): "The south-western handholds disintegrate as you use them to enter the arena."
   * rsprox 01751 ticks 12518/12521: the handholds become wall 49224 once climbed, for the instance.
   */
  sealArena() {
    Common.replaceLoc(this.area, Common.data.site.handholds, Common.ids.locs.handholdsWall);
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
  if (objectId === ISLAND_BOAT || objectId === Common.ids.locs.boatLeave) {
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
  // One way in: the climbed handholds are a wall, so there is no climbing back out.
  if (at[0] >= Common.data.site.arenaArrival[0]) return true;
  // Awakened entry stays unavailable until its uncaptured timings and damage bounds are verified.
  if (player.getInventory().contains(Common.ids.awakenerOrb)) player.sendMessage("This encounter currently supports the normal Leviathan. Your awakener's orb has not been consumed.");
  player.moveTo(session.tile(Common.data.site.arenaArrival));
  session.sealArena();
  session.start();
  return true;
}
/** rsprox 227/00100 tick 4749: Escape asks "Are you sure you want to leave?" (Yes./No.); Quick-escape doesn't. */
function escape({ player, objectId }) {
  if (objectId !== Common.ids.locs.boatEscape || !sessionOf(player)) return false;
  Common.api.sendMultiChatboxPrompt(player, "Are you sure you want to leave?", "Yes.", () => leave(player), "No.", () => {});
  return true;
}
function quickEscape({ player, objectId }) {
  if (objectId !== Common.ids.locs.boatEscape || !sessionOf(player)) return false;
  leave(player); return true;
}
/**
 * The climbed handholds are a wall, so the arena has no walk back to the island boat. Wiki
 * (Handholds (The Leviathan)): "Players who wish to leave the Leviathan without teleporting out can
 * click the rowboat after killing it once." From the arena floor the boat's op runs where the
 * player stands instead of routing to a loc they can no longer reach.
 */
function boatFromArena(event) {
  const locs = Common.ids.locs;
  if (![ISLAND_BOAT, locs.boatEscape, locs.boatLeave].includes(event.objectId)) return;
  const session = sessionOf(event.player);
  if (!session) return;
  const at = event.player.getLocation();
  if (session.sourceTile(at)[0] < Common.data.site.arenaArrival[0]) return;
  event.destination = { x: at.getX(), y: at.getY(), z: at.getZ() };
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
  api.onObjectInteraction('Rowboat', { Travel: travel, Escape: escape, 'Quick-escape': quickEscape });
  api.onObjectRoute(boatFromArena);
  api.onObjectInteraction('Handholds', { Climb: climb });
  api.onObjectInteraction('Stepping Stone', { Cross: cross });
  api.onObjectInteraction('Scoreboard', { Read: readScoreboard });
  api.onBeforeObjectInteraction(readScoreboardParent);
  api.onNpcInteraction('Catalytic Guardian', { 'Talk-to': guardian });
  api.onPlayerLogin(recover);
  api.onPlayerDeath(death);
  api.onCustomEvent('gravestones:grave-location', grave);
}
module.exports = { attach, Session, sessionOf, travel, climb, leave, cross, escape, quickEscape, boatFromArena };
