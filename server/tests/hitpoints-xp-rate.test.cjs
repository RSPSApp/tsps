// Run after yarn build: node --test tests/hitpoints-xp-rate.test.cjs
// The client predicts a hit from the Hitpoints XP it paid, so the server tells it the rate that
// XP was paid at (plugins/interface/HitpointsXpRate.plugin.js): the world's on login, then the
// rate each Hitpoints gain actually came to (a league's on top), once per change.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const core = PluginManager.getCoreApi();
const { Skill, GameConstants } = core;
const HitpointsXpRate = require("../plugins/interface/HitpointsXpRate.plugin");

function registered() {
  const hooks = {};
  HitpointsXpRate.register(new Proxy({
    core,
    onPlayerLogin: (fn) => { hooks.login = fn; },
    onCustomEvent: (name, fn) => { hooks[name] = fn; },
  }, { get: (t, p) => (p in t ? t[p] : () => {}) }));
  return hooks;
}

function player() {
  const sent = [];
  return {
    sent,
    getPacketSender: () => ({ sendContentData: (source, datasets) => sent.push({ source, datasets }) }),
  };
}

test("login sends the world's rate; a gain at a new rate sends that rate once", () => {
  const hooks = registered();
  const gained = hooks["skills:experience-gained"];
  const p = player();
  hooks.login({ player: p });
  assert.deepEqual(p.sent, [{ source: "server", datasets: [{ key: "hitpointsXpRate", rows: [GameConstants.EXPERIENCE_MULTIPLIER] }] }]);

  const leagueRate = GameConstants.EXPERIENCE_MULTIPLIER * 5;
  gained({ player: p, skill: Skill.HITPOINTS, multiplied: true, rate: leagueRate, experience: 13.3 });
  gained({ player: p, skill: Skill.HITPOINTS, multiplied: true, rate: leagueRate, experience: 26.6 });
  assert.equal(p.sent.length, 2, "the same rate again sends nothing");
  assert.deepEqual(p.sent[1].datasets[0].rows, [leagueRate]);
});

test("other skills and unmultiplied gains (bonus XP) don't change the rate", () => {
  const hooks = registered();
  const gained = hooks["skills:experience-gained"];
  const p = player();
  hooks.login({ player: p });
  gained({ player: p, skill: Skill.STRENGTH, multiplied: true, rate: 99, experience: 40 });
  gained({ player: p, skill: Skill.HITPOINTS, multiplied: false, rate: 1, experience: 5 });
  assert.equal(p.sent.length, 1);
});

test("addExperience reports the rate it applied", () => {
  const events = [];
  const { SkillManager } = require("../dist/game/content/skill/SkillManager");
  const emit = PluginManager.emitCustomEvent;
  PluginManager.emitCustomEvent = (name, payload) => { if (name === "skills:experience-gained") events.push(payload); };
  try {
    const manager = Object.create(SkillManager.prototype);
    const experience = new Array(Skill.values().length).fill(0);
    const maxLevel = new Array(Skill.values().length).fill(1);
    manager.skills = { experience, maxLevel, level: maxLevel.slice() };
    manager.player = {
      getPacketSender: () => ({ sendExpDrop: () => {} }),
      getAttribute: () => undefined,
      getUpdateFlag: () => ({ flag: () => {} }),
    };
    manager.updateSkill = () => manager;
    manager.addExperience(Skill.HITPOINTS, 4 / 3, true);
    manager.addExperience(Skill.HITPOINTS, 4 / 3, false);
  } finally {
    PluginManager.emitCustomEvent = emit;
  }
  assert.equal(events[0].rate, GameConstants.EXPERIENCE_MULTIPLIER);
  assert.equal(events[0].multiplied, true);
  assert.equal(events[1].rate, 1, "no rates applied: 1");
});
