// Run with `node --test tests/emirs-arena.test.cjs`.
//
// Emir's Arena hospital heal (20% of total Hitpoints plus 2). The module takes their core API through attach(), so a minimal fake is
// enough; no server or cache is needed.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const Hospital = require('../plugins/minigames/duelarena/Hospital.DuelArena');

const HITPOINTS = 3;

function fakePlayer(hitpoints, max) {
  return {
    hitpoints,
    max,
    getHitpoints() { return this.hitpoints; },
    getSkillManager() { return { getMaxLevel: () => this.max, getCurrentLevel: () => this.hitpoints }; },
    heal(amount) { this.hitpoints = Math.min(this.max, this.hitpoints + amount); },
    sendMessage() {},
  };
}

function attachApi() {
  const noop = () => {};
  const api = {
    core: { Skill: { HITPOINTS } },
    onNpcsInteraction: noop,
    onCustomEvent: noop,
    onNpcDialogueCondition: noop,
  };
  Hospital.attach(api);
}

before(attachApi);

test('heal restores 20% of total Hitpoints plus 2, capped at full', () => {
  assert.equal(Hospital.healAmount(fakePlayer(44, 99)), 21);
  assert.equal(Hospital.healAmount(fakePlayer(10, 10)), 4);

  const player = fakePlayer(44, 50);
  const healed = Hospital.heal(player);
  assert.equal(healed, 6);
  assert.equal(player.hitpoints, 50);
});

test('the PvP/Deadman guards are false and the Hitpoints guards decide the heal branch', () => {
  const damaged = fakePlayer(44, 50);
  const npc = { definition: { getName: () => "A'abla" } };
  const answer = (text, player = damaged) => Hospital.answerCondition({ ...npc, player, text });

  assert.equal(answer('If the player is on a PvP world:'), false);
  assert.equal(answer('If the player is on a Deadman world:'), false);
  assert.equal(answer('If the player has full Hitpoints:'), false);
  assert.equal(answer('If the player does not have full Hitpoints:'), true);
  assert.equal(answer('If the player has full Hitpoints:', fakePlayer(50, 50)), true);
});

