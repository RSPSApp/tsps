// Registered Trawler net Inspect and the real Player dialogue manager. Run after yarn build.
// Wiki: https://oldschool.runescape.wiki/w/Transcript:Trawler_net
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const Shared = require('../plugins/minigames/fishingtrawler/Shared.FishingTrawler');
const Rewards = require('../plugins/minigames/fishingtrawler/Rewards.FishingTrawler');

test('registered dock net Inspect preserves catch controls and speaks when empty', async (t) => {
  const core = PM.getCoreApi(), errors = [], cleanupErrors = [];
  const oldError = console.error;
  let player;
  const attempt = (fn) => { try { fn(); } catch (error) { cleanupErrors.push(String(error)); } };
  console.error = (...args) => { errors.push(args.map(String).join(' ')); oldError(...args); };
  t.after(() => {
    if (player) {
      attempt(() => { if (player.isRegistered()) PM.emitPlayerLogout({ player, username: player.getUsername() }); });
      attempt(() => player.closeInterruptibleInterfaces());
      attempt(() => player.getDialogueManager().reset());
      attempt(() => player.getMovementQueue().setBlockMovement(false).reset());
      attempt(() => player.getMovementQueue().walkToReset());
      attempt(() => core.TaskManager.cancelTasks(player));
      attempt(() => core.TaskManager.cancelTasks(player.getIndex()));
      attempt(() => { if (player.isRegistered()) core.World.getPlayers().remove(player); });
      attempt(() => assert.equal(player.isRegistered(), false));
      attempt(() => assert.equal(core.TaskManager.hasActiveTask(player), false));
      attempt(() => assert.equal(core.TaskManager.hasActiveTask(player.getIndex()), false));
    }
    attempt(() => PM.emitServerShutdown({}));
    console.error = oldError;
    assert.deepEqual(cleanupErrors, [], 'each cleanup step completed');
    assert.deepEqual(errors, [], 'no swallowed plugin or setup errors');
  });
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core.ObjectDefinition.init();
  core.RegionManager.init();
  Rewards.attachRewards(PM.createApi('FishingTrawlerEmptyNetTest'));
  const ids = Shared.ids();
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  player = new Player(new PlayerSession(channel));
  player.setUsername('trawlernet');
  player.setLongUsername(core.Misc.stringToLongBigInt('trawlernet'));
  player.setAttribute('bot-skip-persistence', true);
  player.setLocation(new core.Location(2666, 3168, 0));
  assert.equal(core.World.getPlayers().add(player), true);
  player.setNeedsPlacement(false);
  player.setHitpoints(10);
  assert.equal(player.isRegistered(), true);
  assert.notEqual(player.isDyingReturn(), true);
  assert.equal(player.getMovementQueue().isMovementBlocked(), false);
  assert.equal(player.getDialogueManager().isActive(), false);
  function inspect(id, location) {
    const object = new core.GameObject(id, new core.Location(...location), 10, 0, null);
    const definition = core.ObjectDefinition.forId(id);
    assert.equal(definition.getName(), 'Trawler net');
    const click = definition.getInteractions().indexOf('Inspect') + 1;
    assert.ok(click > 0, 'active cache exposes Inspect');
    const event = { player, object, objectId: id, definition, clickType: click, handled: false };
    const handled = PM.emitObjectInteraction(event);
    assert.deepEqual(errors, [], 'the registered hook did not throw');
    return handled;
  }
  const manager = player.getDialogueManager(), fish = ids.fish[0];
  const bank = player.getBank(core.Bank.getTabForItem(player, fish.id));
  const inventoryBefore = player.getInventory().getAmount(fish.id);
  const bankBefore = bank.getAmount(fish.id);
  assert.equal(inspect(ids.locs.netLeft, [1887, 4820, 1]), false, 'boat net falls through this registered reward handler');
  assert.equal(manager.isActive(), false);
  assert.equal(player.getAttribute(Shared.REWARD_ATTRIBUTE), undefined);

  player.setAttribute(Shared.REWARD_ATTRIBUTE, { items: [[fish.id, 2]], xp: fish.xp * 2 });
  assert.equal(inspect(ids.locs.rewardNet, [2666, 3167, 0]), true);
  assert.equal(bank.getAmount(fish.id), bankBefore + 2, 'existing catch reaches the bank');
  assert.equal(player.getInventory().getAmount(fish.id), inventoryBefore);
  assert.equal(player.getAttribute(Shared.REWARD_ATTRIBUTE), null);
  assert.equal(manager.isActive(), false, 'collection does not start the empty dialogue');

  const emptyReward = player.getAttribute(Shared.REWARD_ATTRIBUTE);
  const bankAfterCollection = bank.getAmount(fish.id);
  assert.equal(inspect(ids.locs.rewardNet, [2666, 3167, 0]), true);
  assert.equal(player.getAttribute(Shared.REWARD_ATTRIBUTE), emptyReward, 'empty inspection preserves reward state');
  assert.equal(bank.getAmount(fish.id), bankAfterCollection);
  assert.equal(player.getInventory().getAmount(fish.id), inventoryBefore);
  assert.ok(manager.getCurrent() instanceof core.PlayerDialogue);
  assert.equal(manager.getCurrent().getText(), "I'd better not steal other people's fish!");
  assert.equal(player.getPacketSender().isChatboxInterface(217), true);
  assert.equal(manager.handleResume(217 << 16, 0), true);
  assert.equal(player.getPacketSender().isChatboxInterface(217), false, 'continue closes the chatbox');
});
