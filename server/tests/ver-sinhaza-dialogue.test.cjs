// Build first: node --test tests/ver-sinhaza-dialogue.test.cjs
// Ver Sinhaza's residents (Theatre of Blood) play their own Talk-to transcript variants, driven
// through native npc_option packets with every plugin loaded.
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const path = require('node:path');
process.env.DISABLE_PLAYER_BOTS = '1';
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const dialogues = require('../data/definitions/npc-dialogues.json');
let core, index = 6400;
before(async () => {
  await CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3654, 3215);
  PluginManager.emitServerStartup({});
});
after(() => PluginManager.emitServerShutdown({}));
function setup(t, gameval) {
  const channel = {kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
  const player = new Player(new PlayerSession(channel));
  player.setIndex(index++); player.setUsername('versin'+player.getIndex()); player.setRegistered(true);
  player.setLocation(new core.Location(3654,3215,0)); player.needsPlacement = false;
  const connection = new ClientConnection(channel); connection.player = player;
  const npc = core.NPC.create(core.CacheDefinitions.getNpcId(gameval), new core.Location(3655,3215,0));
  assert.equal(core.World.getNpcs().add(npc),true);
  t.after(() => { player.closeInterruptibleInterfaces(); PluginManager.emitPlayerLogout({player,username:player.getUsername()}); player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); core.TaskManager.cancelTasks(player); core.World.getNpcs().remove(npc); });
  const turn=()=>{player.resetUpdating(); core.World.processCycle=(core.World.processCycle+1)&0x7fffffff; core.TaskManager.process(); connection.processTurnPackets(); const q=player.getMovementQueue();q.beginCycle();q.processEntityPursuit();if(q.hasPendingWork())q.process();core.TaskManager.processWalkTo(player.getIndex());};
  const talk=async()=>{await connection.dispatch([{type:'npc_option',index:npc.getIndex(),clickType:1}]); for(let i=0;i<8&&!player.getDialogueManager().getCurrent();i++) turn();};
  const text=()=>player.getDialogueManager().getCurrent()?.getText?.().replace(/<br>/g,' ').replace(/\s+/g,' ');
  return {player,npc,talk,text,turn};
}

const lines = (page, variant) => {
  const out = [];
  const walk = (steps) => { for (const step of steps ?? []) { if (typeof step.npc === 'string') out.push(step.npc); if (typeof step.player === 'string') out.push(step.player); walk(step.steps); for (const o of step.options ?? []) walk(o.steps); } };
  walk(dialogues[page].variants[variant]);
  return out;
};
const quest = () => require('../plugins/quests/QuestRuntime').getRegisteredQuests().find((q) => q.key === 'the_blood_moon_rises');
function completeQuest(t, player) { const q = quest(); q.setStage(player, q.completionValue); t.after(() => q.setStage(player, 0)); }
function disguise(player, pieces = ['VYRE_NOBLE_TOP', 'VYRE_NOBLE_LEGS', 'VYRE_NOBLE_SHOES']) {
  const { Equipment, Item, ItemIdentifiers } = core;
  const slots = [Equipment.BODY_SLOT, Equipment.LEG_SLOT, Equipment.FEET_SLOT];
  pieces.forEach((name, i) => player.getEquipment().setItem(slots[i], new Item(ItemIdentifiers[name], 1)));
}
const CITIZEN = 'Meiyerditch citizen';
const NOBLE = 'Vyrelord';

test('a Ver Sinhaza citizen speaks a Theatre of Blood line instead of "conversation isn\'t available"', async t => {
  for (const g of ['tob_citizen_1', 'tob_citizen_2', 'tob_citizen_3', 'tob_citizen_4']) await t.test(g, async st => {
    const f = setup(st, g); const msgs = []; const sm = f.player.sendMessage.bind(f.player);
    f.player.sendMessage = (m, ...r) => { msgs.push(m); return sm(m, ...r); };
    await f.talk();
    assert.ok(lines(CITIZEN, 'standard-dialogue-theatre-of-blood').includes(f.text()), f.text());
    assert.deepEqual(msgs, []);
  });
});

test('after The Blood Moon Rises the citizens speak the after-quest Theatre lines', async t => {
  const f = setup(t, 'tob_citizen_4'); completeQuest(t, f.player); await f.talk();
  assert.ok(lines(CITIZEN, 'standard-dialogue-after-the-blood-moon-rises-theatre-of-blood').includes(f.text()), f.text());
});

test('a citizen talked to in vyre noble clothing apologises for speaking to a noble', async t => {
  const f = setup(t, 'tob_citizen_2'); disguise(f.player); await f.talk();
  assert.equal(f.text(), 'Hello.');
});

test('the Vyrelords and Vyreladies pick their line by disguise or The Blood Moon Rises', async t => {
  const plain = lines(NOBLE, 'standard-dialogue-if-the-player-is-not-disguised');
  const friendly = lines(NOBLE, 'standard-dialogue-if-the-player-is-disguised-or-if-the-player-has-completed-the-blood-moon-rises');
  const only = (list, other) => list.filter((line) => !other.includes(line));
  // Random lines: talk until one only that variant has shows up (or 40 tries).
  const seen = async (f, wanted, forbidden) => {
    for (let i = 0; i < 40; i++) {
      f.player.closeInterruptibleInterfaces(); f.player.getDialogueManager().reset?.();
      await f.talk(); const text = f.text();
      assert.ok(!forbidden.includes(text), text);
      if (wanted.includes(text)) return true;
    }
    return false;
  };
  await t.test('undisguised', async st => { const f = setup(st, 'tob_noble_3'); assert.ok(await seen(f, only(plain, friendly), only(friendly, plain))); });
  await t.test('disguised', async st => { const f = setup(st, 'tob_noble_2'); disguise(f.player); assert.ok(await seen(f, only(friendly, plain), only(plain, friendly))); });
  await t.test('after the quest', async st => { const f = setup(st, 'tob_noble_1'); completeQuest(st, f.player); assert.ok(await seen(f, only(friendly, plain), only(plain, friendly))); });
  await t.test('two pieces are not a disguise', async st => { const f = setup(st, 'tob_noble_4'); disguise(f.player, ['VYRE_NOBLE_TOP', 'VYRE_NOBLE_LEGS']); assert.ok(await seen(f, only(plain, friendly), only(friendly, plain))); });
  await t.test('unscented clothing is not a disguise', async st => { const f = setup(st, 'tob_noble_4'); disguise(f.player, ['VYRE_NOBLE_TOP_UNSCENTED_', 'VYRE_NOBLE_LEGS_UNSCENTED_', 'VYRE_NOBLE_SHOES_UNSCENTED_']); assert.ok(await seen(f, only(plain, friendly), only(friendly, plain))); });
});

test('the gate guard inside Ver Sinhaza plays the inside transcript, the outer one the outside', async t => {
  await t.test('inside', async st => { const f = setup(st, 'tob_door_guard_inner'); await f.talk(); assert.equal(f.text(), 'Can I go through here?'); });
  await t.test('outside', async st => { const f = setup(st, 'tob_door_guard'); await f.talk(); assert.equal(f.text(), 'What do you want?'); });
});

