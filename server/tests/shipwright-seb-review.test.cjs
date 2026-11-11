// Independently selected gaps: non-active boat success, immediate remembered/PIN path,
// and aggregate coin balances versus the real container's first-slot deletion semantics.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { MultiChatboxPrompt: Prompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
let core, yard, hp, nextIndex = 1850;
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  new (require('../dist/game/definition/loader/impl/NpcDefinitionLoader').NpcDefinitionLoader)().load();
  core.RegionManager.init(); PM.emitServerStartup({});
  yard = require('../plugins/skills/sailing/Shipyard.Sailing');
  hp = require('../plugins/skills/sailing/seacombat/BoatHp.SeaCombat');
});
function actor(t) {
  const player = new Player(null); player.setIndex(nextIndex++); player.setUsername('SebReview' + nextIndex);
  player.setRegistered(true); player.setAttribute('bot-skip-persistence', true);
  player.getSession = () => ({sendClientPacket() {return true;}, write() {return true;}, getChannel() {return null;}});
  player.getSkillManager().setCurrentLevel(core.Skill.SAILING, 99);
  const original = core.Sailing.giveBoat(player, 'skiff', 'the_pandemonium');
  yard.beginVisit(player, core.Sailing.getDock('the_pandemonium'), original.slot); player.setNeedsPlacement(false);
  const npcId = core.CacheDefinitions.getNpcId('sailing_shipyard_manager_vis');
  const npc = core.NPC.create(npcId, player.getLocation().transform(1, 0)); npc.setRegistered(true);
  const coins = core.CacheDefinitions.getObjId('coins');
  t.after(() => { PM.emitPlayerLogout({player, username:player.getUsername()}); core.TaskManager.cancelTasks(player); player.setRegistered(false); npc.setRegistered(false); });
  return {player, original, npc, coins,
    repair() { assert.equal(PM.emitNpcInteraction({player,npc,npcId,definition:npc.getCurrentDefinition(player),option:'Repair-boat',clickType:4,handled:false}),true); }};
}
function confirm(player) {
  for (let n = 0; n < 12 && !Prompt.getPending(player); n++) {
    const current = player.getDialogueManager().getCurrent(); assert.ok(current);
    const group = current.groupId ?? current.constructor.GROUP_ID;
    assert.ok(group, 'visible canonical line supplies its actual native group');
    assert.equal(player.getDialogueManager().handleResume((group << 16) | 5, 0), true);
  }
  assert.ok(Prompt.getPending(player));
  assert.equal(PM.emitInterfaceActionClick({player,buttonId:Prompt.OPTIONS_WIDGET_ID,groupId:219,childId:1,action:1,handled:false}),true);
}
test('review: a non-active visited boat is repaired while the active boat and cargo stay unchanged', t => {
  const f = actor(t), p = f.player;
  hp.damage(p, f.original, 9);
  const selected = core.Sailing.giveBoat(p, 'raft', 'the_pandemonium');
  hp.damage(p, selected, 2);
  selected.cargo = [{id:core.CacheDefinitions.getObjId('knife'),amount:1,meta:{owner:'review'}}];
  const preserved = JSON.stringify({cargo:selected.cargo,parts:selected.parts,facilities:selected.facilities,location:selected.location});
  yard.beginVisit(p, core.Sailing.getDock('the_pandemonium'), selected.slot); p.setNeedsPlacement(false);
  assert.equal(p.getSailing().activeBoatSlot, f.original.slot);
  p.getInventory().add(new core.Item(f.coins, 1000));
  f.repair(); confirm(p);
  assert.equal(selected.damage, 0); assert.equal(f.original.damage, 9);
  assert.equal(p.getInventory().getAmount(f.coins), 900);
  assert.equal(JSON.stringify({cargo:selected.cargo,parts:selected.parts,facilities:selected.facilities,location:selected.location}), preserved);
  assert.equal(p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('sailing_boat_1_stored_hp') + selected.slot), hp.maxHitpoints(selected));
});
test('review: remembered repair starts immediately but a real locked bank PIN still authorises exactly one payment', t => {
  const f = actor(t), p = f.player;
  hp.damage(p, f.original, 5); p.getInventory().add(new core.Item(f.coins, 1000));
  p.getBank(0).open(); core.Bank.deposit(p, f.coins, p.getInventory().getSlotForItemId(f.coins), 1000, false);
  p.getPacketSender().sendInterfaceRemoval();
  const bank = p.getBank(core.Bank.getTabForItem(p, f.coins)); assert.equal(bank.getAmount(f.coins), 1000);
  const Pin = require('../plugins/interface/bankpin/Common.BankPin');
  Pin.set(p, 'hash', Pin.hash(p, '2468')); Pin.lock(p);
  p.setAttribute('sailing:repair-warning-dismissed', true); // Disclosed saved preference fixture.
  f.repair();
  assert.equal(Prompt.getPending(p), null); assert.equal(f.original.damage, 5); assert.equal(bank.getAmount(f.coins), 1000);
  const entry = p.getEnteredAmountAction(); assert.ok(entry, 'shared keypad waits despite remembered confirmation');
  p.setEnteredAmountAction(null); entry.execute(2468);
  for (let n=0;n<3;n++) {++core.World.processCycle;core.TaskManager.process();}
  assert.equal(f.original.damage, 0); assert.equal(bank.getAmount(f.coins), 750);
  assert.equal(p.getInventory().getAmount(f.coins), 0);
  assert.equal(p.getDialogueManager().getCurrent().getText(), 'Sounds good to me.');
});
test('review: supported metadata-distinct coin stacks pay the complete quoted fee', t => {
  const f = actor(t), p = f.player;
  hp.damage(p, f.original, 10);
  p.getInventory().add(new core.Item(f.coins, 100, {reviewBucket:'first'}));
  p.getInventory().add(new core.Item(f.coins, 900, {reviewBucket:'second'}));
  assert.equal(p.getInventory().getItems().filter(item=>item.getId()===f.coins).length,2,'real add preserves distinct metadata stacks');
  assert.equal(p.getInventory().getAmount(f.coins),1000);
  f.repair(); confirm(p);
  assert.equal(f.original.damage,0);
  assert.equal(p.getInventory().getAmount(f.coins),500,'repair must charge all500 coins, rather than only the first100 stack');
  assert.deepEqual(p.getInventory().getItems().find(item=>item.getId()===f.coins && item.getAmount()>0).getMeta(),{reviewBucket:'second'});
});

test('review: metadata-distinct coin stacks transferred through the real bank pay the complete fee', t => {
  const f = actor(t), p = f.player;
  hp.damage(p, f.original, 10);
  p.getInventory().add(new core.Item(f.coins, 100, {reviewBucket:'first'}));
  p.getInventory().add(new core.Item(f.coins, 900, {reviewBucket:'second'}));
  p.getBank(0).open();
  for (const amount of [100,900]) {
    core.Bank.deposit(p, f.coins, p.getInventory().getSlotForItemId(f.coins), amount, false);
  }
  p.getPacketSender().sendInterfaceRemoval();
  const bank = p.getBank(core.Bank.getTabForItem(p, f.coins));
  assert.equal(p.getInventory().getAmount(f.coins),0);
  assert.equal(bank.getItems().filter(item=>item.getId()===f.coins).length,2,'real deposit preserves both metadata stacks');
  assert.equal(bank.getAmount(f.coins),1000);
  f.repair(); confirm(p);
  assert.equal(f.original.damage,0);
  assert.equal(bank.getAmount(f.coins),500,'bank fallback must charge all500 coins across actual transferred stacks');
  assert.deepEqual(bank.getItems().find(item=>item.getId()===f.coins && item.getAmount()>0).getMeta(),{reviewBucket:'second'});
});
