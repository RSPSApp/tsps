// Varrock Museum fossil displays: Add to, the missing-part line, completion Kudos and lamps.
// From server/: node --test tests/museum-fossil-displays.test.cjs
//
// Recorded in rsprox local 1000338, local 1000342 and 1843 (rev 227): one piece a click, the
// state varbit the tick after the pick-up, "You're missing part of the display:  <piece>.", and
// at the fifth piece 2 Kudos and the display's lamp beside the completion line. Lamp experience
// is the Wiki's (Antique lamp (fossil display)).
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { TaskManager } = require("../dist/game/task/TaskManager");

let core;
let Displays;
const events = new Map();
const hooks = { items: [] };

before(() => {
  CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  const api = new Proxy({
    core,
    onCustomEvent: (name, fn) => { if (!events.has(name)) events.set(name, fn); },
    emitCustomEvent: (name, request) => events.get(name)?.(request),
    onObjectInteraction: (name, actions) => { hooks[name] = actions; },
    onItemAction: (name, actions) => hooks.items.push(actions),
    onPlayerLogin: (fn) => { (hooks.login ??= []).push(fn); },
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
  require("../plugins/world/Museum.plugin").register(api);
  Displays = require("../plugins/world/museum/FossilDisplays.Museum");
});

const defs = () => core.CacheDefinitions;
const obj = (name) => defs().getObjId(name);
const loc = (name) => defs().getLocId(name);
const varbit = (n) => defs().getVarbitId(`fossil_vm_display_${n}_state`);
const MISSING = "You're missing part of the display:  ";
const COMPLETE = "Congratulations, you have completed this display!";
const KUDOS = "You have earned Kudos with the Museum!";

let nextIndex = 1900;
function player(t) {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const p = new Player(null);
  Object.assign(p, { lines: [], spam: [], sounds: [], anims: [], boxes: [], varbits: new Map() });
  const sender = p.getPacketSender();
  t.mock.method(p, "getSession", () => ({ sendClientPacket: () => true, write: () => true }));
  t.mock.method(p.getInventory(), "refreshItems", () => p.getInventory());
  t.mock.method(p, "sendMessage", (m) => p.lines.push(m));
  t.mock.method(p, "performAnimation", (a) => p.anims.push(a.getId()));
  t.mock.method(sender, "sendVarbit", (id, v) => { p.varbits.set(id, v); return sender; });
  t.mock.method(sender, "sendSound", (id) => { p.sounds.push(id); return sender; });
  t.mock.method(sender, "sendTypedMessage", (_type, m) => { p.spam.push(m); return sender; });
  t.mock.method(p, "getDialogueManager", () => ({
    startDialogues: (b) => { for (const d of b.getDialogues().values()) p.boxes.push([d.getItemId?.(), d.getText?.()]); },
  }));
  p.setIndex(++nextIndex);
  p.setRegistered(true);
  t.after(() => { p.setRegistered(false); TaskManager.cancelTasks(p); });
  return p;
}

const give = (p, ...names) => { for (const name of names) p.getInventory().add(new core.Item(obj(name), 1)); };
const has = (p, name) => p.getInventory().getAmount(obj(name));
const addTo = (p, locName) => hooks["Small Fossil Display"]["Add to"]({ player: p, objectId: loc(locName), clickType: 1 });
const SMALL = [1, 2, 3, 4, 5].map((n) => `fossil_small_${n}`);

test("every display's Add to name is hooked, and other locs fall through", (t) => {
  for (const name of ["Small Fossil Display", "Medium Fossil Display", "Large Fossil Display", "Large Fossil Support", "Plant Fossil Display"]) {
    assert.equal(typeof hooks[name]?.["Add to"], "function", name);
  }
  assert.equal(hooks["Small Fossil Display"]["Add to"]({ player: player(t), objectId: loc("fossil_storage_crate1") }), false);
});

test("Add to picks the piece up, and the tick after it leaves the pack and the state rises", (t) => {
  const p = player(t);
  give(p, "fossil_small_1");
  assert.notEqual(addTo(p, "fossil_vm_display_6"), false);
  assert.deepEqual(p.anims, [defs().getSeqId("human_pickuptable")]);
  assert.deepEqual(p.sounds, [2739]);
  assert.equal(has(p, "fossil_small_1"), 1, "still carried on the click tick");
  assert.equal(p.varbits.get(varbit(6)), undefined);
  TaskManager.process();
  assert.equal(has(p, "fossil_small_1"), 0);
  assert.equal(p.varbits.get(varbit(6)), 1);
  assert.deepEqual(p.lines, []);
});

test("each state takes its own piece: limbs, spine, ribs, pelvis, skull; the wrong one is missing", (t) => {
  const p = player(t);
  give(p, "fossil_small_1", "fossil_small_3", "fossil_small_5");
  addTo(p, "fossil_vm_display_10");
  TaskManager.process();
  assert.equal(p.varbits.get(varbit(10)), 1);
  p.anims.length = 0;
  addTo(p, "fossil_vm_display_10");
  TaskManager.process();
  assert.deepEqual(p.lines, [`${MISSING}Small fossilised spine.`], "state 1 needs the spine (recorded on 1843 display 3)");
  assert.deepEqual(p.anims, [], "no pick-up without the piece");
  assert.equal(p.varbits.get(varbit(10)), 1);
  assert.equal(has(p, "fossil_small_3") + has(p, "fossil_small_5"), 2, "the other pieces stay");
});

test("the fifth piece completes it: 2 Kudos, the small lamp and the recorded box; then no more Add to", (t) => {
  const p = player(t);
  p.setAttribute("museum:kudos", 107);
  give(p, ...SMALL);
  for (let i = 0; i < 5; i++) {
    addTo(p, "fossil_vm_display_1");
    TaskManager.process();
  }
  assert.equal(p.varbits.get(varbit(1)), 5);
  for (const name of SMALL) assert.equal(has(p, name), 0, name);
  assert.equal(p.getAttribute("museum:kudos"), 109);
  assert.deepEqual(p.spam, [KUDOS]);
  assert.ok(p.sounds.includes(3653), "the Kudos sound");
  assert.equal(has(p, "fossil_display_reward_lamp_small"), 1);
  assert.deepEqual(p.boxes, [[obj("fossil_display_reward_lamp_small"), COMPLETE]]);
  assert.deepEqual(p.getAttribute(Displays.STATES_ATTRIBUTE).slice(0, 1), [5]);

  give(p, "fossil_small_1");
  p.anims.length = 0;
  addTo(p, "fossil_vm_display_1");
  TaskManager.process();
  assert.deepEqual([p.anims, has(p, "fossil_small_1"), p.lines], [[], 1, []], "a completed display takes nothing");
});

test("a second click before the tick adds one piece only", (t) => {
  const p = player(t);
  give(p, "fossil_medium_1", "fossil_medium_2");
  addTo(p, "fossil_vm_display_15");
  addTo(p, "fossil_vm_display_15");
  TaskManager.process();
  TaskManager.process();
  assert.equal(p.varbits.get(varbit(15)), 1);
  assert.equal(has(p, "fossil_medium_2"), 1);
});

test("a plant display gives the large lamp; the big displays are built from their support half", (t) => {
  const p = player(t);
  p.setAttribute(Displays.STATES_ATTRIBUTE, [...Array(27).fill(0), 4, ...Array(5).fill(0), 4]);
  give(p, "fossil_plant_5", "fossil_large_5");
  addTo(p, "fossil_vm_display_34");
  TaskManager.process();
  addTo(p, "fossil_vm_display_28b");
  TaskManager.process();
  assert.equal(p.varbits.get(varbit(34)), 5);
  assert.equal(p.varbits.get(varbit(28)), 5);
  assert.equal(has(p, "fossil_display_reward_lamp_large"), 2);
  assert.equal(p.getAttribute("museum:kudos"), 4);
});

test("the missing line names the plant piece; a display's state locs map back to it", (t) => {
  const p = player(t);
  const state0 = defs().getObject(loc("fossil_vm_display_32")).transforms[0];
  hooks["Plant Fossil Display"]["Add to"]({ player: p, objectId: state0, clickType: 1 });
  assert.deepEqual(p.lines, [`${MISSING}Fossilised roots.`]);
});

test("both halves of display 25 share its state", (t) => {
  const p = player(t);
  give(p, "fossil_medium_1", "fossil_medium_2");
  addTo(p, "fossil_vm_display_25_left");
  TaskManager.process();
  addTo(p, "fossil_vm_display_25_right");
  TaskManager.process();
  assert.equal(p.varbits.get(varbit(25)), 2);
});

test("login resends every started display's state", (t) => {
  const p = player(t);
  p.setAttribute(Displays.STATES_ATTRIBUTE, [5, 0, 3]);
  for (const fn of hooks.login) fn({ player: p });
  assert.equal(p.varbits.get(varbit(1)), 5);
  assert.equal(p.varbits.get(varbit(3)), 3);
  assert.equal(p.varbits.has(varbit(2)), false);
});

test("Rub: the fossil display lamps give the Wiki's experience at their level", (t) => {
  for (const [name, xp, minLevel] of [
    ["fossil_display_reward_lamp_small", 2000, 20],
    ["fossil_display_reward_lamp_medium", 3500, 30],
    ["fossil_display_reward_lamp_large", 5000, 35],
  ]) {
    const p = player(t);
    give(p, name);
    const slot = p.getInventory().getItems().findIndex((item) => item?.getId() === obj(name));
    const item = p.getInventory().getItems()[slot];
    let opened = null;
    events.set("xpreward:open", (request) => { opened = request; });
    const event = { player: p, item, itemId: obj(name), slot };
    assert.ok(hooks.items.some((actions) => actions.Rub?.(event) === true), name);
    assert.equal(opened?.minLevel, minLevel, name);
    const skill = core.Skill.RUNECRAFTING;
    p.getSkillManager().setMaxLevel?.(skill, 99);
    const before = p.getSkillManager().getExperience(skill);
    const text = opened.onConfirm(skill, "Runecraft");
    assert.match(text, new RegExp(`awarded ${xp.toLocaleString("en-GB")} Runecraft experience`), name);
    assert.ok(p.getSkillManager().getExperience(skill) > before, name);
    assert.equal(has(p, name), 0, name);
  }
});
