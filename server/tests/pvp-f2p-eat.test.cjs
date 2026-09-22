// Run after `yarn build`: node --test tests/pvp-f2p-eat.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const filename = path.resolve(__dirname, '../plugins/bots/behaviours/nodes/actions/EatFoodActionNode.js');
const localRequire = createRequire(filename);

function loadNode() {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    require: (name) => {
      if (name.endsWith('/PvpAssignment')) {
        return { getPvpProfile: () => ({ id: 'standard', foodCharges: 10, eatAtHpRatio: 0.45, comboEatChance: 0 }) };
      }
      if (name.endsWith('/Food.plugin')) return { isFoodItem: () => false };
      if (name.endsWith('/state/PlayerBotState')) return {
        computeEatThreshold: (maxHp, ratio, f2p) =>
          f2p ? Math.min(24, Math.max(1, maxHp - 1)) : Math.max(1, Math.ceil(maxHp * ratio)),
      };
      if (name.endsWith('/BotNodeContext')) return { resolveBotNodeContext: (ctx) => ctx };
      return localRequire(name);
    },
  }, { filename });
  return module.exports;
}

function buildHarness() {
  let hp = 30;
  let target = {};
  let attacker = null;
  let following = null;
  const combat = { getTarget: () => target, getAttacker: () => attacker };
  const player = {
    getSkillManager: () => ({ getCurrentLevel: () => hp, getMaxLevel: () => 60 }),
    getCombat: () => combat,
    getCombatFollowing: () => following,
    getInventory: () => ({ getItems: () => [], deleteAtSlot: () => {}, refreshItems: () => {} }),
    getTimers: () => ({ has: () => false, extendOrRegister: () => {} }),
    getPacketSender: () => ({ sendInterfaceRemoval: () => {} }),
    performAnimation: () => {},
    heal: () => {},
    getUsername: () => 'f2p-test',
  };
  const state = {
    mode: 'pvp',
    virtualFoodChargesRemaining: 10,
    pvp: {
      loadoutId: 'f2p_strength_pure',
      profileId: 'standard',
      f2pFoodPending: false,
      f2pFoodPendingHp: null,
    },
  };
  const node = new (loadNode().EatFoodActionNode)(null, { log: () => {} }, {});
  return {
    setHp: (value) => { hp = value; },
    engage: (value) => { target = value ? {} : null; attacker = null; following = null; },
    tick: () => node.tick({ player, state, nowMs: 1000 }),
    state,
  };
}

test('F2P bot only eats once engaged and after HP actually drops', () => {
  const h = buildHarness();

  h.setHp(30);
  assert.equal(h.tick(), 'failure', 'above the F2P threshold nothing happens');
  assert.equal(h.state.pvp.f2pFoodPending, false);

  h.setHp(20);
  h.engage(false);
  assert.equal(h.tick(), 'failure', 'low HP without a target never eats');

  h.engage(true);
  assert.equal(h.tick(), 'failure', 'first engaged low-HP tick just arms the pending flag');
  assert.equal(h.state.pvp.f2pFoodPending, true);
  assert.equal(h.state.pvp.f2pFoodPendingHp, 20);

  assert.equal(h.tick(), 'failure', 'same HP does not consume food');
  assert.equal(h.state.pvp.f2pFoodPending, true);

  h.setHp(15);
  assert.equal(h.tick(), 'failure', 'HP drop proceeds to eat (fails here on empty inventory)');
  assert.equal(h.state.pvp.f2pFoodPending, false);
  assert.equal(h.state.pvp.f2pFoodPendingHp, null);
  assert.equal(h.state.virtualFoodChargesRemaining, 0, 'empty inventory zeroes the retreat budget');
});

test('non-F2P bots never touch the F2P pending flag', () => {
  const h = buildHarness();
  h.state.pvp.loadoutId = 'edge_main_melee';
  h.setHp(20);
  h.engage(true);

  assert.equal(h.tick(), 'failure', 'below the member threshold with no food');
  assert.equal(h.state.pvp.f2pFoodPending, false);
  assert.equal(h.state.pvp.f2pFoodPendingHp, null);
});
