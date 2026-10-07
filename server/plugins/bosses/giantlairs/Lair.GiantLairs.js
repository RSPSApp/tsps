/**
 * Obor's and Bryophyta's lairs, from data/definitions/giant-boss-lairs.json, as captured:
 * - a key-locked gate (the key is kept, and needed only until the gate is first unlocked)
 *   leads into a lair of the player's own, a private area over the lair's real tiles, with the
 *   boss waiting;
 * - the lair's chest opens once per kill with a key, which it uses up: the loot spills onto the
 *   floor, the chest count goes up, and the chest closes again a little later;
 * - the first click on the chest after a kill (key or not) brings the boss back 15 ticks later;
 * - the exit asks first, or Quick-exit leaves straight away. Leaving, teleporting, dying or
 *   logging out ends the lair; logging back in puts the player outside its gate.
 */
const Common = require("./Common.GiantLairs");

const { later, toLocation, UNLOCKED_ATTRIBUTE, CHESTS_ATTRIBUTE } = Common;

const BUSY_VARBIT = 12393;
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;
/** As captured: the move lands 2 ticks after the fade-out, the fade-in a tick later, closed 2 after. */
const FADE_MOVE_TICKS = 2;
const FADE_CLOSE_TICKS = 2;
const CHEST_ANIM = 536;
const CHEST_SOUND = 52;
const RESPAWN_TICKS = 15;
const CHEST_OPEN_TICKS = 19;

let api = null;
let core = null;

/** Per player: their lair while they are in one. */
const sessions = new Map();

const lairBy = (field, id) => Common.lairs.find((lair) => (Array.isArray(lair[field]) ? lair[field].includes(id) : lair[field] === id)) ?? null;
const inBounds = (lair, location) => {
  const { minX, maxX, minY, maxY } = lair.area;
  const x = location.getX();
  const y = location.getY();
  return location.getZ() === 0 && x >= minX && x <= maxX && y >= minY && y <= maxY;
};

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, {
    postScripts: [{ scriptId: FADE_SCRIPT, args }],
  });
}

/** Moves the player, behind the captured fade where the lair has one; `arrive` runs on landing. */
function travel(player, lair, to, arrive) {
  const sender = player.getPacketSender();
  if (!lair.fade) {
    player.moveTo(to);
    arrive?.();
    return;
  }
  sender.sendVarbit(BUSY_VARBIT, 1);
  fade(player, true);
  later(FADE_MOVE_TICKS, () => {
    if (!player.isRegistered()) return;
    player.moveTo(to);
    later(1, () => {
      if (!player.isRegistered()) return;
      fade(player, false);
      sender.sendVarbit(BUSY_VARBIT, 0);
      arrive?.();
      later(FADE_CLOSE_TICKS, () => player.isRegistered() && sender.closeSubInterface(OVERLAY_ATMOSPHERE_UID));
    });
  });
}

let AreaClass = null;

function areaClass() {
  if (AreaClass) return AreaClass;
  const { PrivateArea, Boundary } = core;
  AreaClass = class GiantLairArea extends PrivateArea {
    constructor(lair) {
      const { minX, maxX, minY, maxY } = lair.area;
      super([new Boundary(minX, maxX, minY, maxY, 0)]);
      this.lair = lair;
      this.session = null;
    }

    getName() {
      return this.lair.lairName;
    }

    /** Bryophyta's growthlings fight beside her; Obor fights alone. */
    isMulti() {
      return this.lair.slug === "bryophyta";
    }

    /** Leaving, teleporting, dying or logging out ends the lair. */
    postLeave(mobile, logout) {
      if (mobile.isPlayer?.() && this.session?.player === mobile.getAsPlayer()) this.session.end();
      super.postLeave(mobile, logout);
    }
  };
  return AreaClass;
}

class LairSession {
  constructor(player, lair) {
    this.player = player;
    this.lair = lair;
    this.area = new (areaClass())(lair);
    this.area.session = this;
    this.boss = null;
    /** The boss is dead and its chest not yet opened for that kill. */
    this.killed = false;
    /** The boss's return is already on its way (a chest click since the kill). */
    this.respawning = false;
    this.ended = false;
    this.tasks = [];
    this.chest = null;
  }

  begin() {
    sessions.set(this.player, this);
    this.area.enter(this.player);
    this.spawnBoss();
  }

  spawnBoss() {
    if (this.ended) return null;
    const { spawn } = this.lair;
    const npc = api.spawnNpc({ id: this.lair.boss, x: spawn.x, y: spawn.y, z: spawn.z ?? 0, wanderRadius: 0 });
    if (!npc) return null;
    npc.setFace?.(core.Direction.SOUTH);
    npc.__skipDefaultRespawn = true;
    npc.__giantLair = this;
    this.area.add(npc);
    this.boss = npc;
    this.killed = false;
    this.respawning = false;
    return npc;
  }

  bossAlive() {
    return this.boss != null && this.boss.isRegistered?.() !== false && this.boss.getHitpoints() > 0;
  }

  schedule(ticks, action) {
    const task = later(ticks, () => {
      if (!this.ended) action();
    });
    this.tasks.push(task);
    return task;
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    for (const task of this.tasks) task.stop();
    if (sessions.get(this.player) === this) sessions.delete(this.player);
    // Wherever the player went (the exit, a teleport, death), its region's song again.
    if (this.lair.music != null && this.player.isRegistered?.()) {
      const at = this.player.getLocation();
      const track = core.Music.forRegion(((at.getX() >> 6) << 8) | (at.getY() >> 6));
      if (track !== undefined) this.player.getPacketSender().sendSong(track);
    }
  }
}

const sessionOf = (player) => sessions.get(player) ?? null;
const sessionForNpc = (npc) => npc?.__giantLair ?? null;

function hasKey(player, lair) {
  return player.getInventory().contains(lair.key);
}

function unlocked(player, lair) {
  return player.getAttribute(UNLOCKED_ATTRIBUTE[lair.slug]) === true;
}

function options(player, prompt, onYes) {
  api.sendMultiChatboxPrompt(player, prompt.question, prompt.yes, () => onYes(), prompt.no, () => {
    player.getPacketSender().sendInterfaceRemoval();
  });
}

/** The gate in: locked without a key until first unlocked; the lair's questions; then in. */
function openGate(event) {
  const lair = lairBy("gates", event.objectId);
  if (!lair) return false;
  const { player } = event;
  const keyed = hasKey(player, lair);
  if (!keyed && !unlocked(player, lair)) {
    player.sendMessage(lair.messages.locked);
    return true;
  }
  const ask = () => options(player, lair.enter, () => enter(player, lair, keyed));
  if (!lair.warning) {
    ask();
    return true;
  }
  const { DialogueChainBuilder, StatementDialogue, ActionDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, lair.warning),
    new ActionDialogue(1, { execute: ask }),
  ));
  return true;
}

function enter(player, lair, keyed) {
  player.getPacketSender().sendInterfaceRemoval();
  sessionOf(player)?.end();
  if (keyed) player.setAttribute(UNLOCKED_ATTRIBUTE[lair.slug], true);
  const session = new LairSession(player, lair);
  sessions.set(player, session);
  const arrive = () => {
    // Obor's lair shares the dungeon's map region, so its own song is sent (as captured).
    if (lair.music != null) player.getPacketSender().sendSong(lair.music);
    if (keyed) player.sendMessage(lair.messages.unlocked);
    if (lair.attackOnEntry) session.boss?.getCombat?.().attack(player);
  };
  if (!lair.fade) {
    player.moveTo(toLocation(lair.inside));
    session.begin();
    arrive();
    return;
  }
  // The lair and its boss appear with the move, on the fade's landing tick, as captured.
  travel(player, lair, toLocation(lair.inside), arrive);
  session.schedule(FADE_MOVE_TICKS, () => session.begin());
}

/** The exit asks first. */
function exitLair(event) {
  const lair = lairBy("exits", event.objectId);
  if (!lair) return false;
  options(event.player, lair.leave, () => leave(event.player, lair));
  return true;
}

/** Quick-exit leaves straight away. */
function quickExit(event) {
  const lair = lairBy("exits", event.objectId);
  if (!lair) return false;
  leave(event.player, lair);
  return true;
}

/** "Open" on any gate: a lair's way in, or its way out. */
function gate(event) {
  return openGate(event) || exitLair(event);
}

function leave(player, lair) {
  player.getPacketSender().sendInterfaceRemoval();
  travel(player, lair, toLocation(lair.outside), () => {
    const session = sessionOf(player);
    if (session?.lair === lair) session.area.leave(player, false);
  });
}

function lootLocation(lair) {
  return toLocation(lair.loot);
}

function dropLoot(session, drops) {
  const { Item, ItemDefinition } = core;
  const manager = api.getItemOnGroundManager();
  const location = lootLocation(session.lair);
  for (const drop of drops) {
    if (!Number.isInteger(drop.itemId) || drop.amount <= 0) continue;
    const noteId = ItemDefinition.forId(drop.itemId).getNoteId();
    const itemId = drop.noted && noteId >= 0 && ItemDefinition.forId(noteId).isNoted() ? noteId : drop.itemId;
    const stackable = ItemDefinition.forId(itemId).isStackable();
    if (stackable) manager.registerLocation(session.player, new Item(itemId, drop.amount), location, session.area);
    else for (let i = 0; i < drop.amount; i++) manager.registerLocation(session.player, new Item(itemId, 1), location, session.area);
    api.emitCustomEvent("collection-log:obtain", { player: session.player, itemId: drop.itemId, amount: drop.amount });
  }
}

function setChest(session, open) {
  const { GameObject, ObjectManager } = core;
  const chest = session.lair.chest;
  const object = new GameObject(open ? chest.open : chest.closed, toLocation(chest), chest.type, chest.face, session.area);
  ObjectManager.register(object, true);
  session.area.add(object);
}

function count(player, lair) {
  return Number(player.getAttribute(CHESTS_ATTRIBUTE[lair.slug])) || 0;
}

function openChest(event) {
  const lair = Common.lairs.find((entry) => entry.chest.closed === event.objectId) ?? null;
  if (!lair) return false;
  const { player } = event;
  const session = sessionOf(player);
  if (!session || session.lair !== lair) return true;
  if (session.bossAlive()) {
    player.sendMessage(lair.messages.attacking);
    return true;
  }
  if (!session.respawning) {
    session.respawning = true;
    player.sendMessage(lair.messages.chestStir);
    session.schedule(RESPAWN_TICKS, () => session.spawnBoss());
  }
  if (!session.killed) return true;
  if (!hasKey(player, lair)) {
    player.sendMessage(lair.messages.needKey);
    return true;
  }
  session.killed = false;
  player.getInventory().delete(lair.key, 1);
  player.performAnimation(new core.Animation(CHEST_ANIM));
  player.getPacketSender().sendSound(CHEST_SOUND, 1, 0);
  session.schedule(1, () => {
    const opened = count(player, lair) + 1;
    player.setAttribute(CHESTS_ATTRIBUTE[lair.slug], opened);
    player.getPacketSender().sendConfig(lair.countVarp, opened);
    player.sendMessage(lair.messages.spill);
    player.sendMessage(lair.messages.count.replace("{count}", String(opened)));
    const request = { player, table: lair.chestTable, drops: [] };
    api.emitCustomEvent("npc-drops:roll-table", request);
    dropLoot(session, request.drops);
    setChest(session, true);
    session.schedule(CHEST_OPEN_TICKS, () => setChest(session, false));
  });
  return true;
}

function onBossDeath({ npc }) {
  const session = sessionForNpc(npc);
  if (!session || npc !== session.boss) return;
  session.boss = null;
  session.killed = true;
  session.respawning = false;
}

/** The chest count's varp, and a player who logged out in a lair put outside its gate. */
function restore({ player }) {
  for (const lair of Common.lairs) {
    const opened = count(player, lair);
    if (opened > 0) player.getPacketSender().sendConfig(lair.countVarp, opened);
    if (inBounds(lair, player.getLocation()) && !sessionOf(player)) player.moveTo(toLocation(lair.outside));
  }
}

/** The collection log's Obor and Bryophyta pages count chests opened. */
function collectionLogCount(request) {
  const lair = Common.lairs.find((entry) => entry.name === request.category);
  if (lair) request.count = count(request.player, lair);
}

/** The lairs' gates, exits and chests, their saved progress, and the bosses' deaths. */
function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  for (const key of [...Object.values(UNLOCKED_ATTRIBUTE), ...Object.values(CHESTS_ATTRIBUTE)]) pluginApi.persistAttribute(key);
  pluginApi.onPlayerLogin(restore);
  pluginApi.onObjectInteraction("Gate", { Open: gate, "Quick-exit": quickExit });
  pluginApi.onObjectInteraction("Rock Pile", { Clamber: exitLair, "Quick-exit": quickExit });
  pluginApi.onObjectInteraction("Chest", { Open: openChest });
  pluginApi.onNpcDeath(onBossDeath);
  pluginApi.onCustomEvent("collection-log:category-count", collectionLogCount);
}

module.exports = attach;
Object.assign(module.exports, {
  sessionOf, sessionForNpc, gate, openGate, exitLair, quickExit, openChest, onBossDeath, restore,
  collectionLogCount, enter, leave,
});
