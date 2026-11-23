// Run after `yarn build`: node --test tests/farming-willow-branches.test.cjs
// A farmed willow's branches (issue 6636). Wiki (Willow branch, Willow tree (Farming)): they start growing at the
// health check, one every 5 minutes up to 6, and a stump has none. rsprox local 1000402: the patch value is 22 after
// Check-health (tick 883), 197 down to 192 as the 1st to 6th branch grows (970-1470); a cut is pruning_high (2277) and
// sound 2440 as the secateurs are used, the branch and "You cut a branch from the willow tree." three ticks later
// (31153-31156). Auguste's sapling (Enlightened Journey) grows into a willow in a tree patch (Wiki: Auguste's sapling).
// Real Player, Inventory, cache and farming plugin; only the packets are stubbed.
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
let core, Data, Model, Patches, hooks;
before(async () => {
    await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
    core = PluginManager.getCoreApi();
    require('../plugins/skills/farming/Core.Farming').init({ core });
    Data = require('../plugins/skills/farming/Data.Farming');
    Model = require('../plugins/skills/farming/Model.Farming');
    Patches = require('../plugins/skills/farming/Patches.Farming');
    Data.initializeFarmingData();
    hooks = {};
    Patches.attach(new Proxy({}, { get: (_, name) => (...args) => {
        if (['onObjectInteraction', 'onItemOnObject'].includes(name)) hooks[name] = args[0];
        if (name === 'onPlayerLogin') hooks.onPlayerLogin ??= args[0]; // Patches' own login (Tithe's and Rewards' follow)
    } }));
});
const ticks = (n) => { for (let i = 0; i < n; i++) Patches.tick(); };
const MINUTE = 60_000;
const start = Date.UTC(2026, 10, 23, 12);

/** A player at a tree patch; `said` records [channel, text], `sounds` the synth ids, `anims` the sequences. */
function fixture(t, items = []) {
    let now = start;
    t.mock.method(Date, 'now', () => now);
    const player = new Player(null), said = [], sounds = [], anims = [];
    const sender = new Proxy({}, { get: (_, name) => name === 'sendTypedMessage' ? (_type, text) => { said.push(['spam', text]); return sender; }
        : name === 'sendSound' ? id => { sounds.push(id); return sender; }
        : ['getVarbit', 'getVarp'].includes(name) ? () => 0 : () => sender });
    player.getPacketSender = () => sender; player.sendMessage = text => said.push(['game', text]);
    player.performAnimation = animation => anims.push(animation.getId());
    player.busy = () => false; player.getClickDelay().elapsedTime = () => true;
    player.getSkillManager().setCurrentLevel(core.Skill.FARMING, 99, false);
    t.mock.method(core.MapObjects, 'get', () => null);
    const patch = Data.CACHE.patches.find(p => p.type === 'TREE');
    player.moveTo(new core.Location(patch.x, patch.y, patch.z));
    for (const name of items) player.getInventory().add(new core.Item(Data.itemId(name)), false);
    const state = Patches.stateFor(player, patch);
    state.weeds = 0;
    const event = extra => ({ player, object: { getId: () => patch.id }, location: { x: patch.x, y: patch.y, z: patch.z }, clickType: 1, ...extra });
    const use = name => hooks.onItemOnObject(event({ itemId: Data.itemId(name), itemSlot: player.getInventory().getSlotForItemId(Data.itemId(name)) }));
    const click = option => {
        t.mock.method(core.ObjectDefinition, 'forPlayer', () => ({ getInteractions: () => [option] }));
        hooks.onObjectInteraction(event());
    };
    const farm = () => Patches.farmFor(player);
    const wait = (ms) => { now += ms; Model.advanceFarm(farm(), now); };
    const value = () => Model.patchValue(patch, state);
    const branches = () => player.getInventory().getAmount(Data.itemId('Willow branch'));
    return { player, patch, state, said, sounds, anims, use, click, wait, value, branches };
}

/** A fully grown willow, its health not yet checked. */
function grownWillow(t, items = ['Secateurs']) {
    const f = fixture(t, items);
    Object.assign(f.state, { crop: 'WILLOW', stage: Data.CROPS.get('WILLOW').stages, status: 'grown', checked: false,
        lives: 1, nextAt: Number.MAX_SAFE_INTEGER, plantExperiencePending: false });
    return f;
}

test('a willow has no branches when its health is checked, then grows one every 5 minutes up to six', t => {
    const f = grownWillow(t);
    assert.equal(f.value(), 21, 'grown and unchecked: the Check-health willow');
    f.click('Check-health');
    assert.equal(f.state.branches, 0);
    assert.equal(f.value(), 22, 'checked with none grown');
    f.use('Secateurs');
    assert.deepEqual(f.said.at(-1), ['game', 'There are no branches ready to cut yet.']);
    assert.equal(f.anims.length, 0, 'nothing to cut: no pruning');
    f.wait(5 * MINUTE - 1);
    assert.equal(f.state.branches, 0);
    f.wait(1);
    assert.deepEqual([f.state.branches, f.value()], [1, 197]);
    f.wait(25 * MINUTE);
    assert.deepEqual([f.state.branches, f.value()], [6, 192]);
    f.wait(60 * MINUTE);
    assert.deepEqual([f.state.branches, f.value()], [6, 192], 'six at most');
});

test('the next branch is due on the farm schedule while the tree has fewer than six', t => {
    const f = grownWillow(t);
    f.click('Check-health');
    assert.equal(Model.nextDue(Patches.farmFor(f.player)), start + 5 * MINUTE);
    f.wait(30 * MINUTE);
    assert.equal(Model.nextDue(Patches.farmFor(f.player)), Infinity, 'full: nothing due');
});

test('a cut prunes at once and gives the branch with its line three ticks later', t => {
    const f = grownWillow(t);
    f.click('Check-health');
    f.wait(30 * MINUTE);
    f.said.length = 0; f.sounds.length = 0;
    f.use('Secateurs');
    assert.deepEqual([f.anims, f.sounds], [[2277], [2440]]);
    ticks(2);
    assert.equal(f.branches(), 0);
    ticks(1);
    assert.equal(f.branches(), 1);
    assert.deepEqual(f.said, [['spam', 'You cut a branch from the willow tree.']]);
    assert.deepEqual([f.state.branches, f.value()], [5, 193]);
    // The cut starts the next regrowth: five minutes on it is full again.
    f.wait(5 * MINUTE);
    assert.deepEqual([f.state.branches, f.value()], [6, 192]);
});

test('six cuts take every branch, and the tree is back to none', t => {
    const f = grownWillow(t);
    f.click('Check-health');
    f.wait(30 * MINUTE);
    for (let i = 0; i < 6; i++) { f.use('Secateurs'); ticks(3); }
    assert.equal(f.branches(), 6);
    assert.deepEqual([f.state.branches, f.value()], [0, 22]);
    f.use('Secateurs');
    assert.deepEqual(f.said.at(-1), ['game', 'There are no branches ready to cut yet.']);
});

test('chopped to a stump the willow loses its branches, and they start again from none as it grows back', t => {
    const f = grownWillow(t);
    f.click('Check-health');
    f.wait(30 * MINUTE);
    f.state.stump = true; f.state.branches = 0; f.state.nextAt = Date.now() + MINUTE;
    f.wait(MINUTE);
    assert.equal(f.state.stump, false, 'grown back');
    assert.deepEqual([f.state.branches, f.value()], [0, 22]);
    f.wait(5 * MINUTE);
    assert.equal(f.state.branches, 1);
});

test('a willow checked before branches were counted keeps all six', t => {
    const f = grownWillow(t);
    f.state.checked = true;
    assert.equal(f.value(), 192);
    f.use('Secateurs');
    ticks(3);
    assert.equal(f.branches(), 1);
    assert.equal(f.state.branches, 5);
});

test("Auguste's sapling is dug into a tree patch as a willow, its pot left over", t => {
    const f = fixture(t, ['Spade', "Auguste's sapling"]);
    f.use("Auguste's sapling");
    assert.deepEqual([f.anims, f.sounds], [[830], [1470]]);
    ticks(1);
    assert.equal(f.state.crop, 'WILLOW');
    assert.equal(f.player.getInventory().getAmount(Data.itemId("Auguste's sapling")), 0);
    assert.equal(f.player.getInventory().getAmount(Data.itemId('Plant pot')), 1);
    assert.deepEqual(f.said, [['spam', 'You plant the willow sapling in the tree patch.']]);
    assert.equal(f.value(), 15, 'the willow sapling on the patch');
});

test('the agent time skip grows the branches too', t => {
    const f = grownWillow(t);
    hooks.onPlayerLogin({ player: f.player });
    f.click('Check-health');
    const handledBy = [];
    Patches.advanceTime({ player: f.player, ms: 10 * MINUTE, handledBy });
    assert.deepEqual(handledBy, ['Farming']);
    assert.deepEqual([f.state.branches, f.value()], [2, 196]);
});
