// Dummies you Attack (plugins/world/AttackDummies.plugin.js): 5 Attack experience a hit up to level
// 7, then the message; a hit every two ticks; ranged refused; Prifddinas' gives nothing.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");

let core;
let hit;
let tick = 100;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  core.World.getProcessCycle = () => tick;
  const plugin = require("../plugins/world/AttackDummies.plugin");
  plugin.register({ core, onObjectInteraction: () => {} });
  hit = plugin._test.hit;
});

function player() {
  const p = new Player(null);
  p.setUsername("dummyhitter");
  const sent = { messages: [], sounds: [] };
  const sender = new Proxy({}, { get: (target, key) => key === "sendSoundEffect" ? (id) => (sent.sounds.push(id), sender) : () => sender });
  p.getPacketSender = () => sender;
  p.sendMessage = (text) => sent.messages.push(text);
  return Object.assign(p, { sent });
}

const dummy = (id) => ({ objectId: id, object: { getId: () => id, getLocation: () => new core.Location(1659, 3148, 0) } });

test("Civitas's dummy: 5 Attack experience a hit, a hit every two ticks, nothing from level 8", () => {
  const p = player();
  const xp = () => p.getSkillManager().getExperience(core.Skill.ATTACK);
  assert.equal(hit({ player: p, ...dummy(52645) }), true);
  assert.equal(xp(), 5);
  assert.deepEqual(p.sent.messages, ["You hit the dummy."]);
  assert.deepEqual(p.sent.sounds, [2500]);
  tick += 1;
  hit({ player: p, ...dummy(52645) });
  assert.equal(xp(), 5, "a click a tick on: still the last hit");
  tick += 1;
  hit({ player: p, ...dummy(52645) });
  assert.equal(xp(), 10);
  p.getSkillManager().setMaxLevel(core.Skill.ATTACK, 8);
  p.getSkillManager().setExperience?.(core.Skill.ATTACK, 1154);
  const before = xp();
  tick += 2;
  hit({ player: p, ...dummy(52645) });
  assert.equal(xp(), before);
  assert.equal(p.sent.messages.at(-1), "There is nothing more you can learn from hitting a dummy.");
});

test("Prifddinas' dummy gives no experience; another loc of the name is not one", () => {
  const p = player();
  tick += 2;
  assert.equal(hit({ player: p, ...dummy(36566) }), true);
  assert.equal(p.getSkillManager().getExperience(core.Skill.ATTACK), 0);
  assert.deepEqual(p.sent.messages, ["You hit the dummy."]);
  assert.equal(hit({ player: p, ...dummy(2038) }), false, "the Combat Training Camp's 'Hit' dummy");
});
