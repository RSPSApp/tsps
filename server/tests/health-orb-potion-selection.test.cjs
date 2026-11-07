const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const Potions = require('../plugins/items/Potions.plugin');
let core;
before(async () => {
  await CachePipeline.initialize(process.cwd()); core = PluginManager.getCoreApi();
  Potions.register(new Proxy({ core }, { get: (object, key) => object[key] ?? (() => {}) }));
});
function fixture(t, keys, venom = false) {
  const p = new Player(null), changes = [], messages = [];
  p.setPoisonDamage(venom ? 12 : 30); p.setVenomed(venom); p.setRunEnergy(50);
  const sender = new Proxy({}, { get: () => () => sender });
  t.mock.method(p, 'getPacketSender', () => sender);
  t.mock.method(p, 'sendMessage', message => messages.push(message));
  keys.forEach((key, slot) => p.getInventory().setItem(slot, new core.Item(core.ItemIdentifiers[key], 1)));
  const setItem = p.getInventory().setItem.bind(p.getInventory());
  t.mock.method(p.getInventory(), 'setItem', (slot, item) => { changes.push({ slot, id: item.getId() }); return setItem(slot, item); });
  return { p, changes, messages, cure() { Potions._test.cureFromHealthOrb({ player: p }); } };
}
const strengths = ['ANTIPOISON_1_', 'SUPERANTIPOISON_1_', 'ANTIDOTE_1_', 'ANTIDOTE_1__3', 'ANTI_VENOM_1_', 'ANTI_VENOM_1__3'];
test('a later stronger potion wins over an earlier weaker one for poison and venom', t => {
  for (const venom of [false, true]) for (let weak = 0; weak < strengths.length; weak++) {
    for (let strong = weak + 1; strong < strengths.length; strong++) {
      const f = fixture(t, [strengths[weak], strengths[strong]], venom); f.cure();
      assert.equal(f.changes.length, 1);
      assert.equal(f.changes[0].slot, 1, `${strengths[strong]} over ${strengths[weak]}`);
      const reversed = fixture(t, [strengths[strong], strengths[weak]], venom); reversed.cure();
      assert.equal(reversed.changes[0].slot, 0);
    }
  }
});
test('the least remaining dose is used within the chosen potion family', t => {
  for (const stem of ['ANTIPOISON_', 'SUPERANTIPOISON_', 'SANFEW_SERUM_', 'GUTHIX_REST_']) {
    const f = fixture(t, [`${stem}4_`, `${stem}2_`, `${stem}1_`, `${stem}3_`]); f.cure();
    assert.deepEqual(f.changes, [{ slot: 2, id: Potions._test.findPotionEntry(core.ItemIdentifiers[`${stem}1_`]).replacementId }]);
  }
});
test('equal doses of the chosen family use the first inventory slot', t => {
  const f = fixture(t, ['ENERGY_POTION_1_', 'ANTIPOISON_2_', 'ANTIPOISON_2_']); f.cure();
  assert.equal(f.changes.length, 1); assert.equal(f.changes[0].slot, 1);
});
test('potion strength precedes dose count', t => {
  const f = fixture(t, ['ANTIPOISON_1_', 'ANTI_VENOM_4__3', 'ANTI_VENOM_2__3']); f.cure();
  assert.equal(f.changes[0].slot, 2);
});
test('Guthix rest can be selected alone but a full antipoison takes precedence', t => {
  const alone = fixture(t, ['GUTHIX_REST_4_']); alone.cure();
  assert.deepEqual(alone.changes, [{ slot: 0, id: core.ItemIdentifiers.GUTHIX_REST_3_ }]);
  const mixed = fixture(t, ['GUTHIX_REST_1_', 'ANTIPOISON_4_']); mixed.cure();
  assert.equal(mixed.changes[0].slot, 1);
});
test('barbarian mixes retain their treatment strength and least-dose selection', t => {
  const f = fixture(t, ['ANTIPOISON_1_', 'ANTIDOTE_MIX_2_', 'ANTIDOTE_MIX_1_']); f.cure();
  assert.equal(f.changes[0].slot, 2);
});

test('extended anti-venom and supermix join the ordinary orb dose-selection rules', t => {
  const extended = fixture(t, ['ANTI_VENOM_1__3', 'EXTENDED_ANTI_VENOM_4_', 'EXTENDED_ANTI_VENOM_1_'], true);
  extended.cure(); assert.equal(extended.changes[0].slot, 2);
  const mix = fixture(t, ['ANTIPOISON_1_', 'ANTI_POISON_SUPERMIX_2_', 'ANTI_POISON_SUPERMIX_1_']);
  mix.cure(); assert.equal(mix.changes[0].slot, 2);
});
test('different equal-strength potion families retain their existing inventory precedence', t => {
  for (const keys of [['SANFEW_SERUM_4_', 'SUPERANTIPOISON_1_', 'SANFEW_SERUM_2_'],
    ['SUPERANTIPOISON_4_', 'SANFEW_SERUM_1_', 'SUPERANTIPOISON_2_']]) {
    const f = fixture(t, keys); f.cure();
    assert.equal(f.changes[0].slot, 2);
  }
});
test('unrelated and noted items are ignored, and potion cooldowns still block consumption', t => {
  assert.equal(core.ItemDefinition.forId(core.ItemIdentifiers.ANTIPOISON_4__2).isNoted(), true);
  const f = fixture(t, ['ANTIPOISON_4__2', 'ENERGY_POTION_4_', 'ANTIPOISON_3_']); f.cure();
  assert.equal(f.changes[0].slot, 2);
  const blocked = fixture(t, ['ANTI_VENOM_4__3']);
  blocked.p.getTimers().extendOrRegister(core.TimerKey.POTION, 3); blocked.cure();
  assert.deepEqual(blocked.changes, []);
});

// Registered desktop orb dispatch and real player inventory; controlled infection callback,
// not a decoded packet, player movement, full fight clock or rendered client.
test('native desktop health orb weakens an active Nightmare parasite after a committed dose', async t => {
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
  const Common = require('../plugins/bosses/nightmare/Common.Nightmare');
  const Dream = require('../plugins/bosses/nightmare/Dream.Nightmare');
  const Fight = require('../plugins/bosses/nightmare/Fight.Nightmare');
  const Parasites = require('../plugins/bosses/nightmare/Parasites.Nightmare');
  const api = PluginManager.createApi('native-nightmare-orb');
  const denied = new Set(), actors = [], dreams = [];
  const priorBots = process.env.DISABLE_PLAYER_BOTS;
  process.env.DISABLE_PLAYER_BOTS = '1';
  t.after(() => {
    try {
      for (const dream of dreams) if (!dream.ended) dream.end();
      for (const p of actors) {
        core.TaskManager.cancelTasks(p);
        core.TaskManager.cancelTasks(p.getIndex());
        if (p.isRegistered()) core.World.getPlayers().remove(p);
      }
      core.World.refreshActiveRegions();
    } finally {
      if (priorBots === undefined) delete process.env.DISABLE_PLAYER_BOTS;
      else process.env.DISABLE_PLAYER_BOTS = priorBots;
    }
  });
  core.RegionManager.init();
  core.ObjectDefinition.init();
  new NpcDefinitionLoader().load();
  Common.init(api);
  Potions.register(api);
  Parasites.attachParasites(api);
  // Deliberately after Nightmare's legacy can-drink hook: a later veto must not mutate infection.
  api.onCanDrink(event => { if (denied.has(event.player)) event.allow = false; });
  const component = core.CacheDefinitions.getComponentId('orbs:healthbutton');
  assert.equal(component, (160 << 16) | 9, 'active cache matches pinned desktop Cure component');
  const click = p => PluginManager.emitInterfaceActionClick({ player:p, buttonId:component, action:1, groupId:160, childId:9, handled:false });
  let serial = 0;
  function playerFor(test, keys, infected = true) {
    const channel = { kind:'test', isOpen:()=>true, send:()=>true, close(){}, onData(){}, onClose(){}, onError(){} };
    const session = new PlayerSession(channel), p = new Player(session); session.setPlayer(p);
    p.setUsername(`nmorb${serial++}`);
    test.mock.method(p, 'onAdd', () => {});
    test.mock.method(p, 'onRemove', () => {});
    let dream = null;
    const messages = [], sendMessage = p.sendMessage.bind(p);
    test.mock.method(p, 'sendMessage', message => { messages.push(message); return sendMessage(message); });
    test.after(() => {
      const npcs = dream ? [...dream.area.entities].filter(entity => entity.isNpc?.()) : [];
      try {
        if (dream && !dream.ended) dream.end();
      } finally {
        if (p.getArea?.()) p.setArea(null);
        if (p.isRegistered()) core.World.getPlayers().remove(p);
        core.TaskManager.cancelTasks(p);
        core.TaskManager.cancelTasks(p.getIndex());
      }
      assert.equal(p.isRegistered(), false, 'world actor released');
      if (dream) {
        assert.equal(Dream.dreamOf(p), null, 'dream registry released');
        assert.equal(dream.area.isDestroyed(), true, 'dream area destroyed');
      }
      for (const npc of npcs) assert.equal(npc.isRegistered(), false, 'dream NPC released');
    });
    actors.push(p);
    assert.equal(core.World.getPlayers().add(p), true);
    assert.equal(core.World.getPlayers().get(p.getIndex()), p);
    for (let slot = 0; slot < keys.length; slot++) p.getInventory().setItem(slot, new core.Item(core.ItemIdentifiers[keys[slot]], 1));
    for (let slot = 0; slot < keys.length; slot++) assert.equal(p.getInventory().getItems()[slot].getId(), core.ItemIdentifiers[keys[slot]]);
    if (!infected) return { p };
    dream = new Dream.Dream(true); dreams.push(dream);
    p.setLocation(dream.tile(Common.data.arena.centre));
    dream.area.add(p);
    dream.addPlayer(p);
    assert.equal(p.getArea(), dream.area, 'real dream area owns player');
    const fight = new Fight.Fight(dream); dream.fight = fight;
    assert.ok(fight.boss && fight.boss.isRegistered(), 'real fight boss spawned');
    assert.equal(core.World.getNpcs().get(fight.boss.getIndex()), fight.boss);
    assert.equal(Dream.dreamOf(p), dream);
    assert.deepEqual(dream.present(), [p]);
    Parasites.start(fight);
    const due = fight.events.filter(event => event.tick === Common.data.parasite.infectTicks);
    assert.equal(due.length, 1, 'actual parasite producer schedules infection');
    due[0].action();
    const state = fight.parasites.get(p);
    assert.ok(state && !state.weak, 'infection callback reached the active fight state');
    assert.equal(p.getPacketSender().getVarbit(Common.data.varbits.parasite), 1);
    return { p, fight, dream, state, messages };
  }
  const id = (p, slot) => p.getInventory().getItems()[slot].getId();
  const bit = p => p.getPacketSender().getVarbit(Common.data.varbits.parasite);
  const cancel = p => p.getTimers().cancel(core.TimerKey.POTION);
  await t.test('unpoisoned infected player prefers an unnoted balm dose over Sanfew', test => {
    const f = playerFor(test, ['SANFEW_SERUM_1_', 'RELICYMS_BALM_2_']);
    assert.equal(f.p.isPoisoned(), false); assert.equal(f.p.isVenomed(), false);
    assert.equal(click(f.p), true);
    assert.equal(id(f.p, 0), core.ItemIdentifiers.SANFEW_SERUM_1_);
    assert.equal(id(f.p, 1), core.ItemIdentifiers.RELICYMS_BALM_1_);
    assert.equal(f.state.weak, true); assert.equal(bit(f.p), 0);
    assert.equal(f.messages.filter(message => message === Common.data.parasite.weakened).length, 1);
  });
  await t.test('Sanfew alone is consumed and weakens the parasite', test => {
    const f = playerFor(test, ['SANFEW_SERUM_1_']);
    assert.equal(click(f.p), true);
    assert.equal(id(f.p, 0), core.ItemIdentifiers.VIAL);
    assert.equal(f.state.weak, true); assert.equal(bit(f.p), 0);
  });
  await t.test('cooldown refuses dose and weakening, then succeeds when cleared', test => {
    const f = playerFor(test, ['SANFEW_SERUM_1_']); f.p.setPoisonDamage(30);
    f.p.getTimers().extendOrRegister(core.TimerKey.POTION, 3);
    assert.equal(click(f.p), true);
    assert.equal(id(f.p, 0), core.ItemIdentifiers.SANFEW_SERUM_1_);
    assert.equal(f.state.weak, false); assert.equal(bit(f.p), 1);
    cancel(f.p); assert.equal(click(f.p), true);
    assert.equal(id(f.p, 0), core.ItemIdentifiers.VIAL);
    assert.equal(f.state.weak, true); assert.equal(bit(f.p), 0);
  });
  await t.test('later can-drink veto refuses dose and weakening, then allows it', test => {
    const f = playerFor(test, ['SANFEW_SERUM_1_']); f.p.setPoisonDamage(30); denied.add(f.p);
    test.after(() => denied.delete(f.p));
    assert.equal(click(f.p), true);
    assert.equal(id(f.p, 0), core.ItemIdentifiers.SANFEW_SERUM_1_);
    assert.equal(f.state.weak, false); assert.equal(bit(f.p), 1);
    denied.delete(f.p); assert.equal(click(f.p), true);
    assert.equal(id(f.p, 0), core.ItemIdentifiers.VIAL);
    assert.equal(f.state.weak, true); assert.equal(bit(f.p), 0);
  });
  await t.test('noted balm is ignored in favor of usable Sanfew', test => {
    const f = playerFor(test, ['RELICYMS_BALM_4__2', 'SANFEW_SERUM_1_']);
    assert.equal(core.ItemDefinition.forId(id(f.p, 0)).isNoted(), true);
    assert.equal(click(f.p), true);
    assert.equal(id(f.p, 0), core.ItemIdentifiers.RELICYMS_BALM_4__2);
    assert.equal(id(f.p, 1), core.ItemIdentifiers.VIAL);
    assert.equal(f.state.weak, true); assert.equal(bit(f.p), 0);
  });
  await t.test('only noted parasite remedies conserve both items and infection', test => {
    const f = playerFor(test, ['RELICYMS_BALM_4__2', 'SANFEW_SERUM_1__2']);
    assert.equal(core.ItemDefinition.forId(id(f.p, 0)).isNoted(), true);
    assert.equal(core.ItemDefinition.forId(id(f.p, 1)).isNoted(), true);
    assert.equal(click(f.p), true);
    assert.equal(id(f.p, 0), core.ItemIdentifiers.RELICYMS_BALM_4__2);
    assert.equal(id(f.p, 1), core.ItemIdentifiers.SANFEW_SERUM_1__2);
    assert.equal(f.state.weak, false); assert.equal(bit(f.p), 1);
  });
  await t.test('after weakening a second unpoisoned orb click does not consume another dose', test => {
    const f = playerFor(test, ['RELICYMS_BALM_3_']);
    assert.equal(click(f.p), true); assert.equal(f.state.weak, true);
    assert.equal(id(f.p, 0), core.ItemIdentifiers.RELICYMS_BALM_2_);
    cancel(f.p); assert.equal(click(f.p), true);
    assert.equal(id(f.p, 0), core.ItemIdentifiers.RELICYMS_BALM_2_); assert.equal(bit(f.p), 0);
    assert.equal(f.messages.filter(message => message === Common.data.parasite.weakened).length, 1);
  });
  await t.test('the preferred balm uses its least dose and first equal-dose slot', test => {
    const f = playerFor(test, ['RELICYMS_BALM_4_', 'RELICYMS_BALM_1_', 'RELICYMS_BALM_1_', 'SANFEW_SERUM_1_']);
    assert.equal(click(f.p), true);
    assert.equal(id(f.p, 0), core.ItemIdentifiers.RELICYMS_BALM_4_);
    assert.equal(id(f.p, 1), core.ItemIdentifiers.VIAL);
    assert.equal(id(f.p, 2), core.ItemIdentifiers.RELICYMS_BALM_1_);
    assert.equal(id(f.p, 3), core.ItemIdentifiers.SANFEW_SERUM_1_);
    assert.equal(f.state.weak, true); assert.equal(bit(f.p), 0);
  });
  await t.test('without a parasite remedy ordinary poison cure does not weaken the parasite', test => {
    const f = playerFor(test, ['ANTIPOISON_1_']); f.p.setPoisonDamage(30);
    assert.equal(click(f.p), true);
    assert.equal(id(f.p, 0), core.ItemIdentifiers.VIAL);
    assert.equal(f.p.isPoisoned(), false); assert.equal(f.state.weak, false); assert.equal(bit(f.p), 1);
  });
  await t.test('after weakening, a poisoned player uses the ordinary cure selector', test => {
    const f = playerFor(test, ['RELICYMS_BALM_1_', 'ANTIPOISON_1_']);
    assert.equal(click(f.p), true); assert.equal(f.state.weak, true);
    cancel(f.p); f.p.setPoisonDamage(30); assert.equal(click(f.p), true);
    assert.equal(id(f.p, 1), core.ItemIdentifiers.VIAL);
    assert.equal(f.p.isPoisoned(), false); assert.equal(bit(f.p), 0);
  });
  await t.test('uninfected and unpoisoned actor retains carried balm', test => {
    const { p } = playerFor(test, ['RELICYMS_BALM_1_'], false);
    p.getPacketSender().sendVarbit(Common.data.varbits.parasite, 1);
    assert.equal(click(p), true);
    assert.equal(id(p, 0), core.ItemIdentifiers.RELICYMS_BALM_1_);
  });
  await t.test('ordinary poison cure through the same registered button remains functional', test => {
    const { p } = playerFor(test, ['ANTIPOISON_1_'], false); p.setPoisonDamage(30);
    assert.equal(click(p), true);
    assert.equal(id(p, 0), core.ItemIdentifiers.VIAL); assert.equal(p.isPoisoned(), false);
  });
  await t.test('regular registered Sanfew drink weakens on commit', test => {
    const f = playerFor(test, ['SANFEW_SERUM_1_']); const item = f.p.getInventory().getItems()[0];
    assert.equal(PluginManager.emitItemAction({ player:f.p, item, itemId:item.getId(), slot:0, clickType:1, handled:false }), true);
    assert.equal(id(f.p, 0), core.ItemIdentifiers.VIAL);
    assert.equal(f.state.weak, true); assert.equal(bit(f.p), 0);
  });
});
