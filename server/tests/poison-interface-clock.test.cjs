const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { Player } = require('../dist/game/entity/impl/player/Player');
const { CombatPoisonEffect } = require('../dist/game/task/impl/CombatPoisonEffect');
const { curePoisonAndVenom } = require('../plugins/items/ConsumableEffects');

function fixture(t, venom = false) {
  const player = new Player(null), hits = [];
  player.setRegistered(true);
  player.setPoisonDamage(venom ? 6 : 30);
  player.setVenomed(venom);
  player.setInterfaceId(1);
  t.mock.method(player.getCombat().getHitQueue(), 'addPendingDamage', values => hits.push(...values));
  const task = new CombatPoisonEffect(player);
  task.setRunning(true);
  t.after(() => task.stop());
  return { player, task, hits, setOpen(value) { player.setInterfaceId(value ? 1 : -1); },
    step(count = 1) { for (let i = 0; i < count; i++) task.tick(); } };
}

test('a long interface holds poison/venom without decay, then releases only one due hit', t => {
  for (const venom of [false, true]) {
    const h = fixture(t, venom);
    h.step(200);
    assert.equal(h.hits.length, 0);
    assert.equal(h.player.getPoisonDamage(), venom ? 6 : 30);
    h.setOpen(false); h.step();
    assert.deepEqual(h.hits.map(hit => hit.getDamage()), [6]);
    assert.equal(h.player.getPoisonDamage(), venom ? 8 : 29);
    h.step(2);
    assert.equal(h.hits.length, 1, 'elapsed interface time cannot queue a catch-up burst');
    h.setOpen(true); h.step(200);
    assert.equal(h.hits.length, 1);
    assert.equal(h.player.getPoisonDamage(), venom ? 8 : 29);
    h.setOpen(false); h.step();
    assert.deepEqual(h.hits.map(hit => hit.getDamage()), venom ? [6, 8] : [6, 6]);
  }
});

test('closing early does not invent a hit, while elapsed time across interfaces still counts', t => {
  for (const venom of [false, true]) {
    const h = fixture(t, venom);
    h.step(5); h.setOpen(false); h.step(2);
    assert.equal(h.hits.length, 0);
    assert.equal(h.player.getPoisonDamage(), venom ? 6 : 30);
    h.setOpen(true); h.step(35);
    assert.equal(h.hits.length, 0);
    h.setOpen(false); h.step();
    assert.deepEqual(h.hits.map(hit => hit.getDamage()), [6]);
  }
});

test('repeated short open/close cycles cannot postpone an otherwise due affliction', t => {
  for (const venom of [false, true]) {
    const h = fixture(t, venom);
    for (let tick = 0; tick < 40; tick++) {
      const open = tick % 2 === 0, before = h.hits.length, severity = h.player.getPoisonDamage();
      h.setOpen(open); h.step();
      if (open) { assert.equal(h.hits.length, before); assert.equal(h.player.getPoisonDamage(), severity); }
    }
    assert.deepEqual(h.hits.map(hit => hit.getDamage()), [6]);
  }
});

test('explicit cures, with or without protection, cancel the withheld hit', t => {
  for (const venom of [false, true]) for (const immunity of [false, true]) {
    const h = fixture(t, venom); h.step(50);
    curePoisonAndVenom(h.player);
    if (immunity) h.player.getCombat().getPoisonImmunityTimer().start(60);
    h.step(); h.setOpen(false); h.step(40);
    assert.equal(h.hits.length, 0); assert.equal(h.task.isRunning(), immunity);
    if (immunity) assert.equal(h.player.getCombat().getPoisonClock().hasCounter(), true);
  }
});

test('NPC poison does not enter a player-only interface gate', () => {
  let severity = 30;
  const hits = [], entity = { isRegistered: () => true, getHitpoints: () => 99,
    isPlayer: () => false, getAsPlayer() { throw new Error('NPC has no player interface'); },
    isPoisoned: () => severity > 0, isVenomed: () => false, setVenomed() {},
    getPoisonDamage: () => severity, setPoisonDamage: value => { severity = value; },
    getCombat: () => ({ getPoisonImmunityTimer: () => ({ finished: () => true }),
      getHitQueue: () => ({ addPendingDamage: values => hits.push(...values) }) }) };
  const task = new CombatPoisonEffect(entity); task.setRunning(true);
  try { for (let i = 0; i < 35; i++) task.tick(); assert.deepEqual(hits.map(hit => hit.getDamage()), [6]); }
  finally { task.stop(); }
});

function nativeModalFixture(t, venom) {
  const h = fixture(t, venom);
  t.mock.method(h.player, 'getSession', () => ({ sendClientPacket: () => true }));
  h.setOpen(false);
  return { ...h, sender: h.player.getPacketSender() };
}

test('native chatbox dialogue replacements hold one overdue poison/venom hit until closing', t => {
  for (const venom of [false, true]) {
    const h = nativeModalFixture(t, venom);
    h.step(15);
    h.sender.sendChatboxInterface(231); // captured NPC dialogue, not a main interface
    assert.equal(h.player.getInterfaceId(), -1);
    h.step(40);
    h.sender.sendChatboxInterface(219); // replacing the same modal with options
    h.step(40);
    assert.equal(h.hits.length, 0);
    assert.equal(h.player.getPoisonDamage(), venom ? 6 : 30);
    h.sender.closeInterface(219);
    h.step();
    assert.deepEqual(h.hits.map(hit => hit.getDamage()), [6]);
    h.step(29);
    assert.equal(h.hits.length, 1, 'closing cannot release multiple accumulated hits');
    h.step();
    assert.equal(h.hits.length, 2);
  }
});

test('a short chatbox preserves the deadline and sidebar overlays never hold damage', t => {
  for (const venom of [false, true]) {
    const h = nativeModalFixture(t, venom);
    h.sender.sendSubInterface((161 << 16) | 82, 218, 1); // permanent spellbook overlay
    h.step(10);
    h.sender.sendChatboxInterface(231);
    h.step(5);
    h.sender.closeInterface(231);
    h.step(14);
    assert.equal(h.hits.length, 0);
    h.step();
    assert.deepEqual(h.hits.map(hit => hit.getDamage()), [6]);
    h.step(30);
    assert.equal(h.hits.length, 2, 'the remaining type-1 sidebar is not a modal');
  }
});

test('the captured continuous modal timeline holds a due pulse until close, then resumes thirty ticks later', t => {
  const capture = require('./fixtures/poison-protection-clock-1637.json');
  const h = nativeModalFixture(t, false), hitTicks = [];
  // Replay the modal schedule using this cache's chatbox mount. The capture's
  // negative protection counter is not being asserted as implemented here.
  const start = 5147, end = 5214;
  for (let tick = start + 1; tick <= end; tick++) {
    for (const event of capture.events.filter(e => e.tick === tick)) {
      if (event.event === 'openInterface') h.sender.sendChatboxInterface(event.group);
      if (event.event === 'closeInterface') h.sender.closeInterface(h.sender.getChatboxGroupId());
    }
    const previous = h.hits.length;
    h.step();
    if (h.hits.length !== previous) hitTicks.push(tick);
  }
  assert.deepEqual(hitTicks, [5184, 5214]);
});

test('a persistent non-blocking main panel lets poison/venom tick, even after a world interaction', t => {
  const { CustomInterfaceRegistry } = require('../dist/game/interfaces/CustomInterfaceRegistry');
  const groupId = 30197;
  CustomInterfaceRegistry.register({ groupId, widgets: [], lifecycle: { persistOnWorldInteraction: true, blocksGameplay: false } });
  const sideTarget = (161 << 16) | 79;
  for (const venom of [false, true]) {
    const h = nativeModalFixture(t, venom);
    h.sender.sendInterface(groupId);
    h.player.closeInterruptibleInterfaces();
    assert.equal(h.player.getInterfaceId(), groupId);
    assert.equal(h.sender.hasInterruptibleInterface(), true);
    h.step(30);
    assert.deepEqual(h.hits.map(hit => hit.getDamage()), [6]);

    h.sender.sendSubInterface(sideTarget, 387, 3);
    h.step(35);
    assert.equal(h.hits.length, 1, 'the side modal still holds damage');
    h.sender.closeInterface(387);
    h.step();
    assert.equal(h.hits.length, 2);

    h.sender.sendChatboxInterface(231);
    h.step(35);
    assert.equal(h.hits.length, 2, 'the chatbox still holds damage');
    h.sender.closeInterface(231);
    h.step();
    assert.equal(h.hits.length, 3);
    assert.equal(h.player.getInterfaceId(), groupId);
  }
});
