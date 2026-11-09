const assert = require("node:assert/strict");
const plugin = require("../plugins/areas/AncientPyramidMummies.plugin");
const Common = require("../plugins/modes/leaguetasks/Common.LeagueTasks");
const Complete = require("../plugins/modes/leaguetasks/Complete.LeagueTasks");

const handlers = [];
const custom = {};
const events = [];
const api = {
  core: {
    NpcIdentifiers: { MUMMY_2: 720, MUMMY_3: 721, MUMMY_4: 722, MUMMY_5: 723, MUMMY_7: 725, MUMMY_8: 726, MUMMY_9: 727, MUMMY_10: 728 },
    CombatType: { MAGIC: 2 },
    CombatSpells: { FIRE_STRIKE: {}, WATER_STRIKE: {}, ICE_BARRAGE: {} },
  },
  onCombatHitDamage(handler) { handlers.push(handler); },
  persistAttribute() {},
  onCustomEvent(name, handler) { (custom[name] ??= []).push(handler); },
  emitCustomEvent(name, event) {
    events.push([name, event]);
    if (name === "league:profile") event.league = event.player.getProfile() === "league" ? 6 : null;
    for (const handler of custom[name] ?? []) handler(event);
  },
};
Common.init(api);
require("../plugins/modes/LeaguePoints.plugin").register(api);
Complete(api);
plugin.register(api);
const [hitResolved] = handlers;
const player = {
  attributes: {}, messages: [], sent: [],
  getProfile: () => "league",
  getAttribute(key) { return key === "league:type" ? 6 : this.attributes[key]; },
  setAttribute(key, value) { this.attributes[key] = value; },
  getPacketSender() { return { sendConfig: (...args) => this.sent.push(["config", ...args]), sendVarbit: (...args) => this.sent.push(["varbit", ...args]) }; },
  sendMessage(message) { this.messages.push(message); },
};
const attacker = { isPlayer: () => true, getAsPlayer: () => player };
function target(id) {
  return { isNpc: () => true, id, getId() { return this.id; }, setNpcTransformationId(next) { this.id = next; } };
}
function dispatchHitDamage(target, spell, damage = 1, accurate = true) {
  // The PendingHit constructor emits before MagicCombatMethod calls setSpell; the cast context is already attached.
  const hit = { getSpell: () => null, getSpellContext: () => ({ spell }) };
  for (const handler of handlers) handler({ attacker, target, hit, combatType: 2, damage: { getDamage: () => damage }, accurate });
}

for (const [base, lit] of [[720, 725], [721, 726], [722, 727], [723, 728]]) {
  const mummy = target(base);
  dispatchHitDamage(mummy, api.core.CombatSpells.FIRE_STRIKE);
  assert.equal(mummy.id, lit);
  dispatchHitDamage(mummy, api.core.CombatSpells.WATER_STRIKE);
  assert.equal(mummy.id, base);
}
assert.deepEqual(player.attributes["league:tasks"], { "set-a-mummy-ablaze": 10 });
assert.ok(player.messages.some((message) => message.includes("Set a Mummy ablaze")));
assert.ok(player.sent.some(([kind]) => kind === "config"), "the actual task consumer updates completion varps and points");
assert.ok(events.some(([name, event]) => name === "league:task-completed" && event.player === player && event.league === 6 && event.id === "set-a-mummy-ablaze" && event.pactTask));

const splash = target(720);
dispatchHitDamage(splash, api.core.CombatSpells.FIRE_STRIKE, 0);
assert.equal(splash.id, 720);
dispatchHitDamage(splash, api.core.CombatSpells.ICE_BARRAGE);
assert.equal(splash.id, 720);
