// Run after `yarn build`: node --test tests/npc-contact.test.cjs
// NPC Contact as live casts it (rsprox 4045, 4056, 1698; docs/npc-contact.md): the cast on the click, the runes, XP
// and the lunar_contact_npc list 7 ticks later, and a contact opening its NPC's conversation.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { LunarSpells } = require("../dist/game/content/combat/magic/LunarSpells");
const { Spell } = require("../dist/game/content/combat/magic/Spell");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { PluginManager } = require("../dist/plugins/PluginManager");
const NpcContact = require("../plugins/interface/NpcContact.plugin");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

const emitted = [];
const original = PluginManager.emitCustomEvent;
afterEach(() => {
  PluginManager.emitCustomEvent = original;
  Spell.prototype.canCast = canCast;
  emitted.length = 0;
});
const canCast = Spell.prototype.canCast;

function caster() {
  const sender = new Proxy({}, { get: (_, key) => (...args) => { player.sent.push([key, ...args]); return sender; } });
  const player = {
    sent: [],
    animations: [],
    graphics: [],
    xp: [],
    messages: [],
    interfaceId: -1,
    getIndex: () => 7,
    isRegistered: () => true,
    getPrivateArea: () => null,
    getAttribute: () => null,
    setAttribute() {},
    performAnimation(animation) { this.animations.push(animation.getId()); },
    performGraphic(graphic) { this.graphics.push(graphic.getId()); },
    getSkillManager: () => ({ getMaxLevel: () => 99, getCurrentLevel: () => 99, addExperiences: (skill, xp) => player.xp.push(xp) }),
    getPacketSender: () => sender,
    getInterfaceId() { return this.interfaceId; },
    sendMessage(message) { this.messages.push(message); },
  };
  return player;
}

/** Counts paid casts; `runes` is whether the player still holds them. */
function runes(state) {
  Spell.prototype.canCast = function (player, del) {
    if (del) state.paid += 1;
    return state.has;
  };
}

function stubEvents(extra = () => {}) {
  PluginManager.emitCustomEvent = (name, event) => {
    if (name === "quest:is-complete") { event.complete = true; return; }
    emitted.push([name, event]);
    extra(name, event);
  };
}

test("the cast plays on the click; runes, XP and the contact list come 7 ticks later", () => {
  const player = caster();
  const state = { paid: 0, has: true };
  runes(state);
  stubEvents();
  assert.equal(LunarSpells.handleSelf(player, "NPC Contact"), true);
  assert.deepEqual(player.animations, [CacheDefinitions.getSeqId("lunar_human_magic_summon2")]);
  assert.deepEqual(player.graphics, [CacheDefinitions.getSpotanimId("quest_lunar_magic_flax_strim")]);
  for (let tick = 1; tick < 7; tick++) {
    TaskManager.process();
    assert.equal(state.paid, 0, `nothing paid at +${tick}`);
  }
  // Walking in between doesn't stop it (rsprox 4045 tick 746): the player's own tasks are cancelled, not this one.
  TaskManager.cancelTasks(player.getIndex());
  TaskManager.process();
  assert.equal(state.paid, 1);
  assert.deepEqual(player.xp, [63]);
  assert.deepEqual(emitted.filter(([name]) => name === "magic:npc-contact").map(([, event]) => event.player), [player]);
});

test("runes gone by the time the list would open: no XP, no list", () => {
  const player = caster();
  const state = { paid: 0, has: true };
  runes(state);
  stubEvents();
  LunarSpells.handleSelf(player, "NPC Contact");
  state.has = false;
  for (let tick = 0; tick < 7; tick++) TaskManager.process();
  assert.deepEqual(player.xp, []);
  assert.equal(emitted.some(([name]) => name === "magic:npc-contact"), false);
});

test("the list opens in the main modal as captured", () => {
  const player = caster();
  NpcContact._test.open({ player });
  assert.deepEqual(player.sent, [["sendInterfaceScript", 2524, [-1, -1]], ["sendInterface", 75]]);
});

test("every cache contact loads, and the configured ones name an NPC with a conversation", () => {
  NpcContact._test.init({ core: PluginManager.getCoreApi(), emitCustomEvent() {} });
  const contacts = NpcContact._test.getContacts();
  assert.equal(contacts.size, 23);
  const names = (ids) => ids.map((id) => contacts.get(id).name);
  assert.deepEqual(names([6, 7, 11, 13]), ["Turael", "Mazchna", "Duradel", "Cyrisus"]);
  const { NpcDefinition } = PluginManager.getCoreApi();
  for (const contact of contacts.values()) {
    if (contact.npcId === null) continue;
    const npcName = NpcDefinition.forId(contact.npcId).getName();
    assert.ok(npcName === contact.name || contact.name === "Konar" && npcName === "Konar quo Maten", `${contact.name}: ${npcName}`);
  }
});

/** The trigger cs2 9732 sends: 75:4 with [contact_id, alt] as zigzag varints. */
function trigger(player, contactId) {
  const zigzag = (value) => (value << 1) ^ (value >> 31);
  const event = { player, buttonId: (75 << 16) | 4, scriptTrigger: true, argsData: [zigzag(contactId), zigzag(0)], handled: false };
  NpcContact._test.choose(event);
  return event;
}

test("a Slayer master contact sets the last contact, closes the list and opens the master's Talk-to", () => {
  const starts = [];
  const api = { core: PluginManager.getCoreApi(), emitCustomEvent: (name, event) => {
    if (name === "npc-dialogue:start") { starts.push({ ...event }); event.handled = true; }
  } };
  NpcContact._test.init(api);
  const player = caster();
  player.interfaceId = 75;
  const event = trigger(player, 10);
  assert.equal(event.handled, true);
  assert.deepEqual(player.sent, [["sendVarbit", 5006, 10], ["sendInterfaceRemoval"]]);
  assert.equal(starts.length, 1);
  assert.equal(starts[0].npcId, CacheDefinitions.getNpcId("slayer_master_nieve"));
  assert.equal(starts[0].npc, null);
  assert.equal(starts[0].variant, undefined, "the master's own Talk-to, as captured");
  assert.deepEqual(player.messages, []);
});

test("a contact with a Wiki astral-contact conversation asks for exactly that one", () => {
  const starts = [];
  NpcContact._test.init({ core: PluginManager.getCoreApi(), emitCustomEvent: (name, event) => {
    if (name === "npc-dialogue:start") { starts.push({ ...event }); event.handled = true; }
  } });
  const player = caster();
  player.interfaceId = 75;
  trigger(player, 12);
  assert.equal(starts[0].npcId, CacheDefinitions.getNpcId("murphy"));
  assert.equal(starts[0].variant, "via-astral-contact");
  assert.equal(starts[0].exact, true);
});

test("content answering the contact first (While Guthix Sleeps) skips the NPC's own talk", () => {
  const seen = [];
  NpcContact._test.init({ core: PluginManager.getCoreApi(), emitCustomEvent: (name, event) => {
    seen.push(name);
    if (name === "magic:npc-contact-selected" && event.name === "Turael" && event.contactId === 6) event.handled = true;
  } });
  const player = caster();
  player.interfaceId = 75;
  trigger(player, 6);
  assert.deepEqual(seen, ["magic:npc-contact-selected"]);
});

test("a trigger without the list open, or for another component, is not a contact", () => {
  const seen = [];
  NpcContact._test.init({ core: PluginManager.getCoreApi(), emitCustomEvent: (name) => seen.push(name) });
  const player = caster();
  assert.equal(trigger(player, 6).handled, false);
  player.interfaceId = 75;
  const other = { player, buttonId: (75 << 16) | 5, scriptTrigger: true, argsData: [12, 0], handled: false };
  NpcContact._test.choose(other);
  assert.equal(other.handled, false);
  assert.deepEqual(seen, []);
  assert.deepEqual(player.sent, []);
});
