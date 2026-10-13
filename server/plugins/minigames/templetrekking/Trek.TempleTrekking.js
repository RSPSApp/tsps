/**
 * A trek, from agreeing to escort a follower to the reward token, as captured:
 *
 * - The fade, then a one-chunk instance (the "hub") where the follower asks which route, and
 *   the route map (templetrek_map) plays the walk one trip at a time.
 * - At each of the ten stops an event may come up: the map flashes it, then the player and the
 *   follower are put in an instance of the event's room. Continue-trek (once it's done) and
 *   Evade-event go back to the hub and the walk goes on; Escape ends the trek.
 * - After the eleventh trip: "You reach your destination.", the follower thanks the player and
 *   hands over a reward token worth the trek's points.
 *
 * Event units register themselves with registerEvent; see Combat, Bridge, River, Boat and
 * Samaritan. docs/temple-trekking.md has the captured timings.
 */
const Common = require("./Common.TempleTrekking");

const CHUNK = 8;
/** Trip anims follow each other every 3 or 4 ticks (live: 10 ticks for three trips). */
const TRIP_TICKS = [3, 3, 4];

/** Per player: their trek while it lasts. */
const treks = new Map();
/** Event implementations by event key. */
const events = new Map();
/** Run every tick the player spends in a room (the follower eating). */
const tickHooks = [];

let AreaClass = null;

function areaClass() {
  if (AreaClass) return AreaClass;
  const { TemplatedInstanceArea } = Common.core;
  AreaClass = class TrekArea extends TemplatedInstanceArea {
    constructor(trek, spec, kind) {
      const [x0, y0, x1, y1] = spec.source;
      super((x1 - x0 + 1) / CHUNK, (y1 - y0 + 1) / CHUNK);
      this.trek = trek;
      this.kind = kind;
      this.origin = [x0, y0];
      this.spawned = [];
      for (const plane of spec.planes) {
        for (let cx = 0; cx < this.widthChunks; cx++) {
          for (let cy = 0; cy < this.heightChunks; cy++) {
            this.setChunk(plane, cx, cy, {
              sourceChunkX: (x0 >> 3) + cx, sourceChunkY: (y0 >> 3) + cy, sourcePlane: plane, rotation: 0,
            });
          }
        }
      }
    }

    getName() {
      return "Temple Trekking";
    }

    isMulti() {
      return this.kind === "room";
    }

    allowSummonPet() {
      return false;
    }

    /** The instance's copy of a template tile. */
    at([x, y, z]) {
      return this.tile(x - this.origin[0], y - this.origin[1], z ?? 0);
    }

    /** The template tile an instance tile copies. */
    templateOf(location) {
      return [location.getX() - this.getBaseX() + this.origin[0], location.getY() - this.getBaseY() + this.origin[1], location.getZ()];
    }

    canAttack(attacker, target) {
      return this.trek?.canAttack(attacker, target) ?? null;
    }

    process(mobile) {
      if (mobile.isPlayer?.() && this.trek?.player === mobile) this.trek.tick(this);
    }

    postLeave(mobile, logout) {
      if (mobile.isPlayer?.() && this.trek?.player === mobile) this.trek.left(this, logout);
      super.postLeave(mobile, logout);
    }

    destroy() {
      if (this.isDestroyed()) return;
      for (const npc of this.spawned) removeNpc(npc);
      this.spawned = [];
      super.destroy();
    }
  };
  return AreaClass;
}

function removeNpc(npc) {
  if (!npc) return;
  npc.__skipDefaultRespawn = true;
  if (npc.isRegistered?.()) Common.api.removeNpc(npc);
}

class Trek {
  constructor(player, follower) {
    this.player = player;
    this.follower = follower;
    this.direction = follower.direction;
    this.difficulty = Common.data.difficulties[follower.difficulty];
    this.route = null;
    this.trip = 0;
    this.events = 0;
    this.points = 0;
    this.afterEvade = false;
    this.area = null;
    this.room = null;
    this.npc = null;
    this.followerHp = null;
    this.generation = 0;
    this.moving = false;
    this.ended = false;
    this.forcedEvent = null;
    this.noEvents = false;
    this.tickCount = 0;
  }

  // ------------------------------------------------------------------ timing

  /** Runs `action` later unless the trek has moved on (or ended) since. */
  schedule(ticks, action) {
    const generation = this.generation;
    Common.later(ticks, () => {
      if (this.ended || generation !== this.generation || !this.player.isRegistered()) return;
      action();
    });
  }

  /** Cancels everything scheduled so far. */
  interrupt() {
    this.generation++;
  }

  // ------------------------------------------------------------------ places

  /** Moves the player into a fresh instance of `spec` at template tile `tile`. */
  move(spec, kind, tile) {
    const previous = this.area;
    const area = new (areaClass())(this, spec, kind);
    this.moving = true;
    area.enter(this.player);
    this.player.moveTo(area.at(tile));
    this.moving = false;
    this.area = area;
    if (previous && !previous.isDestroyed()) previous.destroy();
    this.npc = null;
    return area;
  }

  /** The follower, spawned next to the player in the current instance. */
  spawnFollower(tile) {
    const at = this.area.at(tile);
    const npc = Common.api.spawnNpc({ id: this.follower.id, x: at.getX(), y: at.getY(), z: at.getZ(), wanderRadius: 0, owner: this.player });
    if (!npc) return null;
    npc.__skipDefaultRespawn = true;
    npc.__templeTrek = this;
    // Live, the follower stands where it arrives and fights back from there.
    npc.getMovementCoordinator?.().setRadius?.(0);
    npc.getMovementQueue().setBlockMovement(true);
    if (this.followerHp == null) this.followerHp = npc.getHitpoints();
    else npc.setHitpoints(this.followerHp);
    this.area.add(npc);
    this.area.spawned.push(npc);
    this.npc = npc;
    Common.followerVarp(this.player, npc);
    return npc;
  }

  /** Spawns an npc of the trek in the current instance. */
  spawn(id, tile, extra = {}) {
    const at = this.area.at(tile);
    const npc = Common.api.spawnNpc({ id, x: at.getX(), y: at.getY(), z: at.getZ(), wanderRadius: 0, owner: this.player, ...extra });
    if (!npc) return null;
    npc.__skipDefaultRespawn = true;
    npc.__templeTrek = this;
    this.area.add(npc);
    this.area.spawned.push(npc);
    return npc;
  }

  despawn(npc) {
    if (!npc) return;
    this.area?.detach(npc);
    if (this.area) this.area.spawned = this.area.spawned.filter((entry) => entry !== npc);
    removeNpc(npc);
  }

  /** Puts a loc in the current instance (a path swapped, a tree cut, a bridge mended). */
  setLoc(id, [x, y, z], type, face) {
    const { GameObject, ObjectManager } = Common.core;
    const object = new GameObject(id, this.area.at([x, y, z ?? 0]), type, face, this.area);
    ObjectManager.register(object, true);
    return object;
  }

  saveFollowerHp() {
    if (this.npc && this.npc.isRegistered?.() && this.npc.getHitpoints() > 0) this.followerHp = this.npc.getHitpoints();
  }

  // ------------------------------------------------------------------ the walk

  /** The escort was agreed: fade into the hub, where the follower asks for a route. */
  begin() {
    const { player } = this;
    player.setAttribute(Common.RETURN_ATTRIBUTE, Common.data.directions[this.direction].returnTo);
    Common.varbit(player, "busy", 1);
    Common.varbit(player, "templetrek_button_control", 1);
    Common.fade(player, true);
    this.schedule(1, () => Common.minimap(player, "off"));
    this.schedule(2, () => {
      this.enterHub();
      this.schedule(1, () => {
        Common.fade(player, false);
        Common.chat(player, [["npc", this.follower.id, Common.data.dialogue.whichRoute]], () => this.openMap());
      });
    });
  }

  enterHub() {
    const { hub } = Common.data;
    this.saveFollowerHp();
    this.move(hub, "hub", hub.player);
    this.player.getMovementQueue().reset();
    this.spawnFollower(hub.follower);
    if (this.direction === "ramble") {
      for (const [x, y, face] of hub.returnPath.tiles) this.setLoc(hub.returnPath.ramble, [x, y, 0], 22, face);
    }
    Common.hideTabs(this.player);
    Common.song(this.player, "hub");
  }

  sequences() {
    return Common.data.trips[this.direction];
  }

  showMap(anim) {
    const { interfaces } = Common.data;
    const sender = this.player.getPacketSender();
    sender.sendInterface(interfaces.templetrek_map);
    if (this.route) sender.sendInterfaceDisplayState((interfaces.templetrek_map << 16) | interfaces["templetrek_map:templetrek_close_button"], true);
    if (anim > 0) sender.sendInterfaceAnimation((interfaces.templetrek_map << 16) | interfaces["templetrek_map:templetrek_player_counters"], anim);
  }

  openMap() {
    Common.closeFade(this.player);
    Common.varbit(this.player, "busy", 0);
    this.showMap(this.sequences().initial);
  }

  chooseRoute(route) {
    if (this.route || !Common.data.routes[route]) return;
    this.route = route;
    const { player } = this;
    player.sendMessage(Common.data.routes[route].message);
    Common.sound(player, Common.data.sounds.mapStart);
    Common.varbit(player, "busy", 1);
    this.walk(1);
  }

  /** Plays trip `n` on the map; at its end an event may come up, or the next trip starts. */
  walk(n) {
    this.trip = n;
    this.showMap(this.sequences().trip[this.route][n]);
    if (n === 11) {
      Common.jingle(this.player, "arrive");
      this.schedule(2, () => this.arrive());
      return;
    }
    this.schedule(TRIP_TICKS[n % TRIP_TICKS.length], () => {
      const event = this.rollEvent(n);
      if (event) this.flashEvent(event, n);
      else this.walk(n + 1);
    });
  }

  flash(n) {
    const position = Common.data.routes[this.route].flash[(this.direction === "temple" ? n : 11 - n) - 1];
    return position;
  }

  rollEvent(n) {
    const route = Common.data.routes[this.route];
    if (this.forcedEvent) {
      const forced = this.forcedEvent;
      this.forcedEvent = null;
      return forced;
    }
    if (this.noEvents || this.events >= route.maxEvents) return null;
    const chance = this.afterEvade ? Common.data.chanceAfterEvade : route.eventChance;
    this.afterEvade = false;
    if (Math.random() >= chance) return null;
    const candidates = [];
    for (const [key, event] of Object.entries(Common.data.events)) {
      if (key.startsWith("$") || !events.has(key) || !event.routes.includes(this.route)) continue;
      if (event.trips && !event.trips[this.direction].includes(n)) continue;
      candidates.push([key, event.weight]);
    }
    return Common.weighted(candidates);
  }

  flashEvent(key, n) {
    this.events++;
    Common.varbit(this.player, "templetrek_event_flash", this.flash(n));
    Common.jingle(this.player, "event");
    this.schedule(3, () => this.enterRoom(key));
  }

  // ------------------------------------------------------------------ rooms

  enterRoom(key) {
    const { player } = this;
    const impl = events.get(key);
    const spec = impl.room(this);
    this.saveFollowerHp();
    Common.varbit(player, "templetrek_last_event", Common.data.events[key].last);
    const entry = spec.entry[this.direction] ?? spec.entry;
    this.move(spec, "room", entry);
    this.room = { key, impl, spec, monsters: new Set(), kills: 0, complete: false, points: 0, state: {} };
    Common.restoreTabs(player);
    this.schedule(1, () => {
      player.getPacketSender().closeSubInterface((161 << 16) | 16);
      Common.minimap(player, "trek");
      Common.varbit(player, "busy", 0);
      Common.fade(player, false);
      const followerTile = spec.follower ?? [entry[0], entry[1] + 1, entry[2] ?? 0];
      this.spawnFollower(followerTile);
      impl.start(this, this.room);
      this.room.started = true;
      this.schedule(2, () => Common.closeFade(player));
    });
  }

  /** Every tick the player spends in a room. */
  tick(area) {
    if (area !== this.area || !this.room?.started || this.ended) return;
    this.tickCount++;
    this.room.impl.tick?.(this, this.room);
    for (const hook of tickHooks) hook(this);
  }

  addPoints(amount) {
    this.points = Math.min(Common.data.points.max, this.points + amount);
    Common.varbit(this.player, "templetrek_npc_point_value", this.points);
  }

  /** Continue-trek: back to the hub once the event is done. */
  succeed() {
    if (!this.room) return;
    if (!this.room.complete) {
      this.player.sendMessage("You have not succeeded at this event yet. You need to complete the event before you can leave along the success path.");
      return;
    }
    if (this.room.points > 0) this.addPoints(this.room.points);
    this.leaveRoom("success");
  }

  /** Evade-event: route 1 always, route 2 once half the enemies are dead, route 3 never. */
  evade() {
    if (!this.room) return;
    const { evade } = Common.data.routes[this.route];
    const total = this.room.total ?? 0;
    if (evade === "never") return;
    if (evade === "half" && total > 0) {
      const needed = Math.ceil(total / 2);
      if (this.room.kills < needed) {
        this.player.sendMessage(`You need to have defeated ${needed} enemies before you can evade the event. You have killed ${this.room.kills} enemies.`);
        return;
      }
    }
    this.player.sendMessage("You manage to evade the enemies.");
    this.afterEvade = true;
    this.leaveRoom("evade");
  }

  leaveRoom(how) {
    const { player } = this;
    this.interrupt();
    player.getMovementQueue().reset();
    if (how === "success") Common.varbit(player, "templetrek_button_control", 0);
    Common.jingle(player, how === "success" ? "success" : "evade");
    Common.sound(player, Common.data.sounds.fadeOut);
    Common.fade(player, true);
    const trip = this.trip;
    this.schedule(1, () => {
      Common.minimap(player, "off");
      Common.varbit(player, "busy", 1);
    });
    this.schedule(2, () => {
      this.room = null;
      this.enterHub();
      this.schedule(1, () => {
        Common.varbit(player, "templetrek_event_flash", 0);
        Common.closeFade(player);
        const start = this.sequences().start[this.route][trip + 1];
        this.showMap(start || this.sequences().trip[this.route][trip]);
        this.schedule(3, () => this.walk(trip + 1));
      });
    });
  }

  // ------------------------------------------------------------------ ends

  /** "You reach your destination.": the follower thanks the player and hands over a token. */
  arrive() {
    const { player } = this;
    const direction = Common.data.directions[this.direction];
    const [x, y] = direction.destination;
    player.sendMessage("You reach your destination.");
    this.moving = true;
    player.moveTo(new Common.core.Location(x, y, 0));
    this.moving = false;
    this.closeArea();
    const npc = Common.api.spawnNpc({ id: this.follower.id, x, y: y + 1, z: 0, wanderRadius: 0, owner: player, ownerOnly: true });
    if (npc) {
      npc.__skipDefaultRespawn = true;
      Common.followerVarp(player, npc);
    }
    this.schedule(1, () => {
      Common.minimap(player, "normal");
      Common.followerVarp(player, null);
      Common.restoreTabs(player);
      player.getPacketSender().closeSubInterface((161 << 16) | 16);
      Common.fade(player, false);
      Common.chat(player, [["npc", this.follower.id, direction.thanks]], () => {
        this.reward();
        Common.later(3, () => removeNpc(npc));
      });
    });
  }

  reward() {
    const { player } = this;
    const direction = Common.data.directions[this.direction];
    const token = direction.tokens[this.route];
    const points = Math.max(Common.data.points.min, this.points);
    Common.varbit(player, "templetrek_npc_point_value", 0);
    const saved = { ...(player.getAttribute(Common.TOKEN_POINTS_ATTRIBUTE) ?? {}) };
    saved[token] = [...(saved[token] ?? []), points];
    player.setAttribute(Common.TOKEN_POINTS_ATTRIBUTE, saved);
    let text = `${this.follower.short} gives you a reward token! `;
    if (player.getInventory().getFreeSlots() > 0) {
      player.getInventory().adds(token, 1);
    } else {
      Common.api.getItemOnGroundManager().registerLocation(player, new Common.core.Item(token, 1), player.getLocation());
      text += "You have no inventory space, the token is placed on the floor.";
    }
    Common.itemStatement(player, token, text);
    this.finish();
    Common.api.emitCustomEvent("temple-trekking:completed", { player, route: this.route, direction: this.direction, difficulty: this.follower.difficulty, points });
    if (this.follower.difficulty === "hard") {
      Common.api.emitCustomEvent("diary:task", { player, diary: "morytania", task: "complete-a-temple-trek-with-a-hard-companion" });
    }
  }

  /** Escape (or Escape-event): the follower is left behind and the player lands in the swamp. */
  escape() {
    const { player } = this;
    this.interrupt();
    player.getMovementQueue().reset();
    Common.fade(player, true);
    Common.sound(player, Common.data.sounds.fadeOut);
    this.schedule(1, () => Common.varbit(player, "busy", 1));
    this.schedule(3, () => {
      player.sendMessage("You escape from the encounter, leaving your companion to fend for themselves.");
      Common.jingle(player, "evade");
      const position = this.flash(this.trip);
      const [x, y] = Common.data.escapes[position] ?? Common.data.directions[this.direction].returnTo;
      this.leave(new Common.core.Location(x, y, 0));
      Common.later(1, () => {
        Common.fade(player, false);
        Common.varbit(player, "busy", 0);
      });
      Common.later(3, () => Common.closeFade(player));
    });
  }

  /** Return-to-Burgh / Return-to-Paterdomus at the hub: the trek is called off. */
  returnHome() {
    this.interrupt();
    const [x, y] = Common.data.directions[this.direction].returnTo;
    this.leave(new Common.core.Location(x, y, 0));
    Common.varbit(this.player, "busy", 0);
  }

  /** The follower died: the trek has failed. */
  followerDied() {
    if (this.ended) return;
    const { player } = this;
    this.interrupt();
    player.sendMessage("Your companion has been killed. You have failed to escort them to safety.");
    this.schedule(3, () => {
      const position = this.flash(this.trip);
      const [x, y] = Common.data.escapes[position] ?? Common.data.directions[this.direction].returnTo;
      this.leave(new Common.core.Location(x, y, 0));
    });
  }

  /** Takes the player out to `location` and ends the trek without a reward. */
  leave(location) {
    const { player } = this;
    this.moving = true;
    player.moveTo(location);
    this.moving = false;
    this.closeArea();
    Common.restoreTabs(player);
    player.getPacketSender().closeSubInterface((161 << 16) | 16);
    Common.minimap(player, "normal");
    Common.varbit(player, "templetrek_npc_point_value", 0);
    this.finish();
  }

  closeArea() {
    const area = this.area;
    this.area = null;
    this.room = null;
    this.npc = null;
    if (area && !area.isDestroyed()) area.destroy();
  }

  /** Clears the trek's state and varbits; the player is already wherever they end up. */
  finish() {
    if (this.ended) return;
    this.ended = true;
    this.interrupt();
    treks.delete(this.player);
    const { player } = this;
    player.setAttribute(Common.RETURN_ATTRIBUTE, null);
    Common.followerVarp(player, null);
    for (const name of ["templetrek_last_event", "templetrek_event_flash", "templetrek_button_control", "templetrek_debug_room_id"]) {
      Common.varbit(player, name, 0);
    }
    Common.varbit(player, "busy", 0);
    this.closeArea();
  }

  /**
   * The player left an instance of the trek. Our own moves between instances say so first;
   * anything else (a teleport, death, logging out) calls the trek off.
   */
  left(area, logout) {
    if (this.moving || area !== this.area || this.ended) return;
    if (logout) {
      const [x, y] = Common.data.directions[this.direction].returnTo;
      this.player.setLocation(new Common.core.Location(x, y, 0));
      // Wiki: the followers lose their food when the player logs out.
      this.player.setAttribute(Common.PACK_ATTRIBUTE, null);
    }
    this.area = null;
    this.finish();
  }

  // ------------------------------------------------------------------ combat rules

  canAttack(attacker, target) {
    const mine = (mobile) => mobile?.__templeTrek === this;
    if (attacker === this.player) return target?.isNpc?.() && mine(target) && target !== this.npc ? null : false;
    if (mine(attacker) && (target === this.player || target === this.npc)) return true;
    if (attacker === this.npc && mine(target)) return true;
    return null;
  }
}

function trekOf(player) {
  return treks.get(player) ?? null;
}

function start(player, follower) {
  trekOf(player)?.finish();
  const trek = new Trek(player, follower);
  treks.set(player, trek);
  trek.begin();
  return trek;
}

function registerEvent(key, impl) {
  events.set(key, impl);
}

function onTick(hook) {
  tickHooks.push(hook);
}

/** A player saved mid-trek (the server stopped) comes back at the trek's start. */
function recoverOnLogin({ player }) {
  const returnTo = player.getAttribute(Common.RETURN_ATTRIBUTE);
  if (!returnTo || trekOf(player)) return;
  player.setAttribute(Common.RETURN_ATTRIBUTE, null);
  player.moveTo(new Common.core.Location(returnTo[0], returnTo[1], 0));
}

/** Select on one of the map's three routes. */
function mapAction(event) {
  const { interfaces } = Common.data;
  if (event.groupId !== interfaces.templetrek_map) return;
  event.handled = true;
  const route = [1, 2, 3].find((n) => interfaces[`templetrek_map:templetrek_route_${n}`] === event.childId);
  if (route) trekOf(event.player)?.chooseRoute(route);
}

/** Continue-trek: the hub's paths pick the walk back up, a room's needs the event done. */
function continueTrek(event) {
  const trek = trekOf(event.player);
  if (!trek) return false;
  if (Common.data.locs.templetrek_swamp_continue.includes(event.objectId)) {
    if (!trek.room && !trek.route) trek.openMap();
    return true;
  }
  if (!trek.room) return false;
  trek.succeed();
  return true;
}

function evadeEvent({ player }) {
  const trek = trekOf(player);
  if (!trek?.room) return false;
  trek.evade();
  return true;
}

function escapeEvent({ player }) {
  const trek = trekOf(player);
  if (!trek?.room) return false;
  trek.escape();
  return true;
}

function returnHome({ player }) {
  const trek = trekOf(player);
  if (!trek || trek.room) return false;
  trek.returnHome();
  return true;
}

function attachTrek(api) {
  api.onInterfaceActionClick(mapAction);
  api.onObjectInteraction("Path", {
    "Continue-trek": continueTrek,
    "Evade-event": evadeEvent,
    Escape: escapeEvent,
    "Return-to-Burgh": returnHome,
    "Return-to-Paterdomus": returnHome,
  });
  api.onPlayerLogin(recoverOnLogin);
}

module.exports = { attachTrek, registerEvent, onTick, trekOf, start, Trek };
