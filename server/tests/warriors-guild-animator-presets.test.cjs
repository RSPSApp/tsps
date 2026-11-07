// Run after `yarn build`: node --test tests/warriors-guild-animator-presets.test.cjs
// The Warriors' Guild animator never animates preset copies (untradeable, unbankable, preset meta, as
// Presets.PvpMode spawnPresetItem tags them): armour left behind comes back from Shanomi as plain armour, so
// animating preset rune armour would turn it tradeable. Real engine: every plugin loaded, a real Player and
// Inventory, the plugin's own handlers (Animate, use-on-animator, logout, Shanomi's hand-back) as it registers them.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
require("./helpers/pvp-mode-on.cjs");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let I;
let next = 9790;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("anim" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3200, 3200, 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return { p, inv: p.getInventory(), messages };
}

function preset(item) {
  item.setMetaValue(core.Item.UNTRADEABLE_META, true);
  item.setMetaValue(core.Item.UNBANKABLE_META, true);
  item.setMetaValue(core.Item.PRESET_META, true);
  return item;
}

const amount = (inv, id, wantPreset) => inv.getItems()
  .filter((item) => item?.getId() === id && item.isPresetItem() === wantPreset)
  .reduce((total, item) => total + item.getAmount(), 0);

const PRESET_TEXT = "Preset items cannot be used for this.";
const SHANOMI = 2462;

function animatorHandlers() {
  const attach = require("../plugins/areas/warriors-guild/Animator.WarriorsGuild");
  const h = {};
  const real = PM.createApi("AnimatorPresetTest");
  attach(new Proxy(real, {
    get: (target, key) => {
      if (key === "onObjectInteraction") return (name, actions) => { h.animate = actions.Animate; };
      if (key === "onItemOnObject") return (handler) => { h.useOn = handler; };
      if (key === "onPlayerLogout") return (handler) => { h.logout = handler; };
      if (key === "onCustomEvent") return (name, handler) => { if (name === "npc-dialogue:action") h.handBack = handler; else target.onCustomEvent(name, handler); };
      return target[key];
    },
  }));
  return h;
}

const pieces = () => [I.RUNE_FULL_HELM, I.RUNE_PLATEBODY, I.RUNE_PLATELEGS];
const at = { x: 2851, y: 3536, z: 0 };

test("a set held only as preset copies is not animated", (t) => {
  const f = actor(t);
  const h = animatorHandlers();
  pieces().forEach((id, slot) => f.inv.setItem(slot, preset(new core.Item(id, 1))));
  h.animate({ player: f.p, location: at });
  assert.deepEqual(f.messages, [PRESET_TEXT]);
  const useOn = { player: f.p, objectId: core.ObjectIdentifiers.MAGICAL_ANIMATOR, itemId: I.RUNE_PLATEBODY, location: at, handled: false };
  h.useOn(useOn);
  assert.equal(f.messages.at(-1), PRESET_TEXT, "using a piece on the animator refuses too");
  for (const id of pieces()) assert.equal(amount(f.inv, id, true), 1);
  h.logout({ player: f.p });
  h.handBack({ player: f.p, npcId: SHANOMI, text: "the set of lost armour" });
  for (const id of pieces()) assert.equal(amount(f.inv, id, false), 0, "Shanomi has nothing to hand back");
});

test("with plain and preset copies held only the plain set is animated, and Shanomi returns only it", (t) => {
  const f = actor(t);
  const h = animatorHandlers();
  pieces().forEach((id, slot) => f.inv.setItem(slot, preset(new core.Item(id, 1)))); // first in slot order
  pieces().forEach((id, slot) => f.inv.setItem(3 + slot, new core.Item(id, 1)));
  h.animate({ player: f.p, location: at });
  for (const id of pieces()) {
    assert.equal(amount(f.inv, id, true), 1, "the preset copies are left alone");
    assert.equal(amount(f.inv, id, false), 0);
  }
  h.logout({ player: f.p });
  h.handBack({ player: f.p, npcId: SHANOMI, text: "the set of lost armour" });
  for (const id of pieces()) {
    assert.equal(amount(f.inv, id, false), 1);
    assert.equal(amount(f.inv, id, true), 1);
  }
});

test("armour already dying when it's abandoned drops its set only: Shanomi keeps no second copy", (t) => {
  const f = actor(t);
  const h = animatorHandlers();
  pieces().forEach((id, slot) => f.inv.setItem(slot, new core.Item(id, 1)));
  h.animate({ player: f.p, location: at });
  for (let tick = 0; tick < 7; tick++) core.TaskManager.process(); // it rises
  const spawned = [...core.World.getAddNPCQueue(), ...core.World.getNpcs()].filter((npc) => npc && npc.getOwner?.() === f.p);
  assert.equal(spawned.length, 1, "the armour has risen");
  const armour = spawned[0];
  armour.isDying = true; // killed: its drop lands two ticks on, whatever happens to the owner
  h.logout({ player: f.p });
  h.handBack({ player: f.p, npcId: SHANOMI, text: "the set of lost armour" });
  for (const id of pieces()) assert.equal(amount(f.inv, id, false), 0, "no set from Shanomi as well");
  assert.deepEqual(f.p.getAttribute("warriors-guild:lost-armour") ?? [], []);
  const queue = core.World.getAddNPCQueue();
  if (queue.includes(armour)) queue.splice(queue.indexOf(armour), 1);
});
