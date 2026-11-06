// Run with `node --test tests/pvp-arena-matchmaking.test.cjs`.
//
// PvP Arena match finding: the second sign-up pairs, only an invited player may climb the staging area
// steps, and the fight starts once both are up. Fake API; no server or cache needed.
const assert = require('node:assert/strict');
const { test } = require('node:test');

const Matchmaking = require('../plugins/minigames/duelarena/Matchmaking.DuelArena');

function fakePlayer(name) {
  return {
    name, messages: [], moved: null, location: { getX: () => 3366, getY: () => 3275, getZ: () => 0 },
    getDisplayName() { return name; },
    sendMessage(text) { this.messages.push(text); },
    moveTo(location) { this.moved = location; this.location = location; },
    getLocation() { return this.location; },
    getDueling() { return { inDuel: () => this.fighting === true }; },
    getAttribute() { return 0; },
    setAttribute() {},
  };
}

test('sign-ups pair, steps need an invitation, and both being up starts the fight', () => {
  const hooks = {};
  const started = [];
  const api = {
    core: {
      Location: class { constructor(x, y, z) { Object.assign(this, { x, y, z }); } getX() { return this.x; } getY() { return this.y; } getZ() { return this.z; } },
      World: { getProcessCycle: () => 0 },
      CacheDefinitions: { getInterfaceId: () => 762, getComponentId: (name) => [...name].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 65521, 7) },
    },
    getPluginConfig: (key) => key === 'DuelArena:pvpArenaWorld',
    persistAttribute() {}, onPlayerProcess() {}, onPlayerDisconnect() {}, onPlayerLogout() {}, onCustomEvent() {},
    onInterfaceActionClick(handler) { hooks.click = (hooks.click ?? []).concat(handler); },
    onObjectInteraction(_name, options) { Object.assign(hooks, options); },
    emitCustomEvent() {},
    sendMultiChatboxPrompt(player, _title, _first, signUp, _second, withdraw) { player.withdraw = withdraw; signUp(); },
  };
  Matchmaking.attach(api, { startArranged: (players) => { started.push(players); return true; } });
  const [a, b] = [fakePlayer('a'), fakePlayer('b')];
  const find = (player) => hooks.click[1]({ player, groupId: 0, childId: api.core.CacheDefinitions.getComponentId('pvp_arena_sidepanel:right') });

  hooks['Climb-up']({ player: a });
  assert.match(a.messages.at(-1), /need to be invited/);
  assert.equal(a.moved, null);

  find(a);
  assert.equal(Matchmaking.queue.length, 1);
  find(b);
  assert.equal(Matchmaking.queue.length, 0);
  assert.match(a.messages.at(-1), /against b is ready/);

  hooks['Climb-up']({ player: a });
  assert.equal(started.length, 0);
  a.moveTo(new api.core.Location(3200, 3900, 0));
  hooks['Climb-up']({ player: b });
  assert.equal(started.length, 0, 'leaving staging revokes readiness before the opponent climbs');
  hooks['Climb-up']({ player: a });
  assert.equal(started.length, 1);
  assert.equal(started[0].length, 2);
  a.fighting = true;
  a.withdraw();
  assert.equal(Matchmaking.matches.has(a), true, 'withdraw does not bypass fight forfeit');
  a.fighting = false;
  a.withdraw();
  assert.equal(Matchmaking.matches.has(a), false);
  assert.equal(Matchmaking.matches.has(b), false);
  assert.match(a.messages.at(-1), /cancelled/);
  assert.ok(b.messages.some(text => /cancelled/.test(text)));
});
