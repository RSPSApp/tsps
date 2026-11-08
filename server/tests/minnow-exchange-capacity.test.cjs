const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { MAX_STACK_AMOUNT } = require('../dist/game/model/container/StackType');
const QuestRuntime = require('../plugins/quests/QuestRuntime');
const Platform = require('../plugins/skills/fishing/MinnowPlatform.Fishing');
let core, shark, npc, definition, clickType, quest;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  PM.emitServerStartup({});
  const { ItemIdentifiers: I, NpcIdentifiers: N, ItemDefinition, NpcDefinition, NPC, Location } = core;
  shark = ItemDefinition.forId(I.RAW_SHARK).getNoteId();
  assert.ok(ItemDefinition.forId(I.MINNOW).isStackable());
  assert.ok(ItemDefinition.forId(shark).isStackable());
  assert.ok(ItemDefinition.forId(shark).isNoted());
  definition = NpcDefinition.forId(N.KYLIE_MINNOW_2);
  assert.equal(definition.getName(), 'Kylie Minnow');
  clickType = definition.getActions().indexOf('Trade') + 1;
  assert.ok(clickType > 0, 'cache exposes Trade after admission');
  npc = NPC.create(N.KYLIE_MINNOW_2, new Location(2599, 3425, 0));
  quest = QuestRuntime.getRegisteredQuests().find(q => q.name === 'Fishing Contest');
  assert.ok(quest, 'Fishing Contest is registered');
});
after(() => PM.emitServerShutdown({}));

function fisher(t) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(2450);
  player.setUsername('minnowcapacity');
  player.setRegistered(true);
  player.setLocation(new core.Location(2600, 3425, 0));
  player.getSkillManager().setMaxLevel(core.Skill.FISHING, 82);
  player.getSkillManager().setCurrentLevel(core.Skill.FISHING, 82, true);
  quest.setStage(player, 5);
  const { Item, ItemIdentifiers: I, Equipment: E } = core;
  for (const [slot, id] of [[E.HEAD_SLOT, I.ANGLER_HAT], [E.BODY_SLOT, I.ANGLER_TOP],
    [E.LEG_SLOT, I.ANGLER_WADERS], [E.FEET_SLOT, I.ANGLER_BOOTS]]) {
    player.getEquipment().setItem(slot, new Item(id, 1));
  }
  assert.equal(quest.isComplete(player), true);
  assert.equal(player.getSkillManager().getMaxLevel(core.Skill.FISHING), 82);
  // Admission is seeded through the registered dialogue condition; no natural quest or travel is claimed.
  assert.equal(Platform.kylieCondition({ player, npcId: core.NpcIdentifiers.KYLIE_MINNOW,
    text: 'If the player meets all the requirements:' }), true);
  assert.equal(Platform.hasAccess(player), true);
  t.after(() => { player.closeInterruptibleInterfaces(); player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); });
  return player;
}
function trade(player) {
  return PM.emitNpcInteraction({ player, npc, npcId: core.NpcIdentifiers.KYLIE_MINNOW_2,
    definition, clickType, handled: false });
}
function seed(player, minnows, sharks = 0) {
  const inv = player.getInventory();
  inv.resetItems();
  inv.addItem(new core.Item(core.ItemIdentifiers.MINNOW, minnows));
  if (sharks) inv.addItem(new core.Item(shark, sharks));
  assert.equal(inv.getAmount(core.ItemIdentifiers.MINNOW), minnows);
  assert.equal(inv.getAmount(shark), sharks);
  return inv;
}

test('Kylie conserves minnows when the noted-shark stack cannot hold the requested output', t => {
  const player = fisher(t), I = core.ItemIdentifiers;
  const inv = seed(player, 80, MAX_STACK_AMOUNT - 1);
  assert.equal(trade(player), true);
  const prompt = player.getEnteredAmountAction();
  assert.ok(prompt, 'registered Trade opens the amount prompt');
  prompt.execute(2);
  assert.equal(inv.getAmount(I.MINNOW), 80);
  assert.equal(inv.getAmount(shark), MAX_STACK_AMOUNT - 1);
});

test('Kylie exchanges whole sharks and refuses fewer than 40 minnows', t => {
  const player = fisher(t), I = core.ItemIdentifiers;
  for (const [amount, requested, expected] of [[40, 1, 1], [80, 2, 2], [81, 2, 2]]) {
    const inv = seed(player, amount);
    assert.equal(trade(player), true);
    assert.ok(player.getEnteredAmountAction());
    player.getEnteredAmountAction().execute(requested);
    player.setEnteredAmountAction(null);
    assert.equal(inv.getAmount(I.MINNOW), amount - expected * 40);
    assert.equal(inv.getAmount(shark), expected);
  }
  const inv = seed(player, 39);
  assert.equal(trade(player), true);
  assert.equal(player.getEnteredAmountAction(), null);
  assert.equal(inv.getAmount(I.MINNOW), 39);
  assert.equal(inv.getAmount(shark), 0);
});

test('a full inventory can use a slot freed by the complete minnow stack, but not a partial stack', t => {
  const player = fisher(t), I = core.ItemIdentifiers;
  let inv = seed(player, 40);
  inv.addItem(new core.Item(I.SMALL_FISHING_NET, 27));
  assert.equal(inv.getFreeSlots(), 0);
  assert.equal(trade(player), true);
  assert.ok(player.getEnteredAmountAction());
  player.getEnteredAmountAction().execute(1);
  player.setEnteredAmountAction(null);
  assert.equal(inv.getAmount(I.MINNOW), 0);
  assert.equal(inv.getAmount(shark), 1);

  inv = seed(player, 80);
  inv.addItem(new core.Item(I.SMALL_FISHING_NET, 27));
  assert.equal(inv.getFreeSlots(), 0);
  assert.equal(trade(player), true);
  assert.ok(player.getEnteredAmountAction());
  player.getEnteredAmountAction().execute(1);
  assert.equal(inv.getAmount(I.MINNOW), 80);
  assert.equal(inv.getAmount(shark), 0);
});

test('capacity is checked again when the amount prompt is answered', t => {
  const player = fisher(t), I = core.ItemIdentifiers;
  const inv = seed(player, 80, MAX_STACK_AMOUNT - 2);
  assert.equal(trade(player), true);
  const prompt = player.getEnteredAmountAction();
  assert.ok(prompt);
  inv.addItem(new core.Item(shark, 1));
  assert.equal(inv.getAmount(shark), MAX_STACK_AMOUNT - 1);
  prompt.execute(2);
  assert.equal(inv.getAmount(I.MINNOW), 80);
  assert.equal(inv.getAmount(shark), MAX_STACK_AMOUNT - 1);
});
