// Run after `yarn build`: node --test tests/house-on-the-hill-chest.test.cjs
//
// The House on the Hill stone chest against rsprox.net recording 3040 (rev 231, ticks
// 11054-14378), with a real Player and Inventory.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");

let Chest;
let core;
const hooks = {};
const persisted = {};
const events = [];

before(() => {
  CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  const api = new Proxy({
    core,
    persistAttribute: (key, value) => { persisted[key] = value; },
    onObjectInteraction: (name, actions) => { hooks[name] = actions; },
    emitCustomEvent: (name, payload) => events.push({ name, payload }),
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
  Chest = require("../plugins/areas/HouseOnTheHillChest.plugin");
  Chest.register(api);
});

let nextIndex = 1900;
function player(t, { hitpoints = 99 } = {}) {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const p = new Player(null);
  Object.assign(p, { lines: [], said: [], hits: [], sounds: [], anims: [], removals: 0, chain: null });
  t.mock.method(p, "getSession", () => ({ sendClientPacket: () => true, write: () => true }));
  t.mock.method(p.getInventory(), "refreshItems", () => p.getInventory());
  t.mock.method(p, "sendMessage", (m) => p.lines.push(m));
  t.mock.method(p, "forceChat", (m) => p.said.push(m));
  t.mock.method(p, "performAnimation", (a) => p.anims.push(a.getId()));
  t.mock.method(p, "getHitpointsAfterPendingDamage", () => hitpoints);
  t.mock.method(p, "getCombat", () => ({ getHitQueue: () => ({ addPendingDamage: (h) => p.hits.push(...h.map((x) => x.getDamage())) }) }));
  t.mock.method(p.getPacketSender(), "sendSound", (id) => { p.sounds.push(id); return p.getPacketSender(); });
  t.mock.method(p.getPacketSender(), "sendInterfaceRemoval", () => { p.removals++; return p.getPacketSender(); });
  t.mock.method(p, "getDialogueManager", () => ({ startDialogues: (b) => { p.chain = [...b.getDialogues().values()]; } }));
  p.setIndex(++nextIndex);
  p.setRegistered(true);
  t.after(() => p.setRegistered(false));
  events.length = 0;
  return p;
}

const NUMULITE = () => core.ItemIdentifiers.NUMULITE;
const give = (p, id, n) => p.getInventory().add(new core.Item(id, n), false);
const count = (p, id) => p.getInventory().getAmount(id);
const search = (p, objectId = core.ObjectIdentifiers.STONE_CHEST) => hooks["Stone chest"].Search({ player: p, objectId });
const texts = (p) => p.chain.map((d) => d.getText?.() ?? (d.getOptions ? d.getOptions() : null));
/** Picks the menu entry (1-based) of the current chain's option dialogue. */
const choose = (p, option) => p.chain.find((d) => d.getOptions).execute(option);
const T = () => Chest._test.TEXT;
const withRoll = (value, fn) => { Chest._test.random = () => value; try { fn(); } finally { Chest._test.random = Math.random; } };
const OPEN = 0.1;
const CLUNK = 0.6;
const SPIKE = 0.9;

test("hooks the Stone chest's Search by name and saves the hole being found, starting unfound", () => {
  assert.deepEqual(Object.keys(hooks["Stone chest"]), ["Search"]);
  assert.equal(persisted[Chest._test.HOLE_FOUND_ATTRIBUTE], false);
  assert.equal(Chest.members, true);
});

test("before the hole is found and without numulites: only the hole's message box (t11054)", (t) => {
  const p = player(t);
  search(p);
  assert.deepEqual(texts(p).slice(0, 1), [T().hole]);
  assert.equal(p.chain.some((d) => d.getOptions), false);
});

test("with a numulite: the hole message, then the one-numulite menu; Yes inserts one and shows 100 (t11343-11353)", (t) => {
  const p = player(t);
  give(p, NUMULITE(), 150);
  search(p);
  assert.equal(texts(p)[0], T().hole);
  const menu = p.chain[1];
  assert.equal(menu.getTitle(), "Insert a numulite into the hole?");
  assert.deepEqual(menu.getOptions(), ["Yes, insert a numulite.", "No, keep my numulites!"]);
  choose(p, 1);
  assert.equal(count(p, NUMULITE()), 149);
  assert.deepEqual(p.anims, [832]);
  assert.deepEqual(p.sounds, [2402]);
  assert.deepEqual(p.chain.slice(0, 2).map((d) => [d.getItemId(), d.getText()]), [[NUMULITE(), T().inserted], [NUMULITE(), T().number]]);
  assert.equal(p.getAttribute(Chest._test.HOLE_FOUND_ATTRIBUTE), true);
});

test("No keeps the numulites and the hole unfound", (t) => {
  const p = player(t);
  give(p, NUMULITE(), 5);
  search(p);
  choose(p, 2);
  assert.equal(count(p, NUMULITE()), 5);
  assert.equal(p.removals, 1);
  assert.ok(!p.getAttribute(Chest._test.HOLE_FOUND_ATTRIBUTE));
});

test("once found, fewer than 100 numulites gets the player's line (t11896)", (t) => {
  const p = player(t);
  p.setAttribute(Chest._test.HOLE_FOUND_ATTRIBUTE, true);
  give(p, NUMULITE(), 99);
  search(p);
  assert.equal(p.chain[0].getText(), T().tooFew);
  assert.equal(p.chain[0].expression, 589);
  assert.equal(count(p, NUMULITE()), 99);
});

test("once found, 100 numulites offers the 100 menu; the clunk costs 100 and plays 2386 (t13097)", (t) => {
  const p = player(t);
  p.setAttribute(Chest._test.HOLE_FOUND_ATTRIBUTE, true);
  give(p, NUMULITE(), 250);
  search(p);
  assert.equal(p.chain[0].getTitle(), "Insert 100 numulites into the hole?");
  assert.deepEqual(p.chain[0].getOptions(), ["Yes, insert 100 numulites.", "Don't waste numulites!"]);
  withRoll(CLUNK, () => choose(p, 1));
  assert.equal(count(p, NUMULITE()), 150);
  assert.deepEqual(p.lines, [T().clunk]);
  assert.deepEqual(p.sounds, [2386]);
  assert.deepEqual(p.hits, []);
});

test("the spike says Ow! and hits 5 + a twentieth of the current Hitpoints (t11971 ... t14189)", (t) => {
  const captured = [[99, 9], [94, 9], [90, 9], [85, 9], [81, 9], [73, 8], [67, 8], [59, 7], [52, 7], [46, 7], [39, 6]];
  for (const [hitpoints, damage] of captured) assert.equal(Chest._test.spikeDamage(hitpoints), damage, `${hitpoints} HP`);
  assert.deepEqual([10, 5, 3, 1].map(Chest._test.spikeDamage), [5, 4, 2, 0], "never the last Hitpoint");
  const p = player(t, { hitpoints: 73 });
  p.setAttribute(Chest._test.HOLE_FOUND_ATTRIBUTE, true);
  give(p, NUMULITE(), 100);
  search(p);
  withRoll(SPIKE, () => choose(p, 1));
  assert.equal(count(p, NUMULITE()), 0);
  assert.deepEqual(p.lines, [T().spike]);
  assert.deepEqual(p.said, ["Ow!"]);
  assert.deepEqual(p.hits, [8]);
  assert.deepEqual(p.sounds, [2386]);
});

test("opening gives the notes in order, logs each, and skips the ones the player owns (t11588 ... t14077)", (t) => {
  const p = player(t);
  p.setAttribute(Chest._test.HOLE_FOUND_ATTRIBUTE, true);
  const notes = Chest._test.notes();
  assert.equal(notes.length, 10);
  assert.equal(new Set(notes).size, 10);
  give(p, NUMULITE(), 1000);
  search(p);
  withRoll(OPEN, () => choose(p, 1));
  assert.equal(count(p, notes[0]), 1);
  assert.deepEqual([p.chain[0].getItemId(), p.chain[0].getText()], [notes[0], T().opened]);
  assert.deepEqual(events.map(({ name, payload }) => [name, payload.itemId]), [["collection-log:obtain", notes[0]]]);
  assert.deepEqual(p.sounds, [2387]);
  // The second, held in the bank, is skipped: the chest hands out the third.
  p.getBank(0).add(new core.Item(notes[1], 1), false);
  search(p);
  withRoll(OPEN, () => choose(p, 1));
  assert.equal(count(p, notes[2]), 1);
  assert.equal(count(p, NUMULITE()), 800);
});

test("with all ten notes the open outcome finds nothing (t14378)", (t) => {
  const p = player(t);
  p.setAttribute(Chest._test.HOLE_FOUND_ATTRIBUTE, true);
  for (const note of Chest._test.notes()) give(p, note, 1);
  give(p, NUMULITE(), 100);
  search(p);
  withRoll(OPEN, () => choose(p, 1));
  assert.deepEqual(p.lines, [T().empty]);
  assert.equal(p.chain[0].getText(), T().allNotes);
  assert.equal(p.chain[0].expression, 554);
  assert.deepEqual(events, []);
  assert.deepEqual(p.sounds, [2387]);
});

test("the outcome roll covers open, clunk and spike", () => {
  const seen = new Set();
  for (const value of [0, 0.49, 0.5, 0.74, 0.75, 0.999]) withRoll(value, () => seen.add(Chest._test.rollOutcome()));
  assert.deepEqual([...seen].sort(), ["clunk", "open", "spike"]);
});

test("other Stone chests with Search (DT2 Stranglewood lore chest 48758) fall through untouched", (t) => {
  const p = player(t);
  p.setAttribute(Chest._test.HOLE_FOUND_ATTRIBUTE, true);
  give(p, NUMULITE(), 100);
  for (const objectId of [48758, 34580, 32053]) assert.equal(search(p, objectId), false, `loc ${objectId}`);
  assert.equal(p.chain, null);
  assert.equal(count(p, NUMULITE()), 100);
});
