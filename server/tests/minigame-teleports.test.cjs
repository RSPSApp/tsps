// Run after `yarn build`: node --test tests/minigame-teleports.test.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
const { TeleportHandler } = require('../dist/game/model/teleportation/TeleportHandler');
const { Location } = require('../dist/game/model/Location');
const { Sounds } = require('../dist/game/Sounds');
const { TaskManager } = require('../dist/game/task/TaskManager');
const WorldDefinition = require('../dist/game/definition/WorldDefinition');
const Sequence = require('../plugins/combat/HomeTeleportSequence');
const HomeTeleports = require('../plugins/combat/HomeTeleports.plugin');
const MinigameTeleports = require('../plugins/interface/MinigameTeleports.plugin');

const MINIGAMES_WIDGET = 951;
const SPELLBOOK = 218;

/** A player recording, per tick, what the server sends about them. */
function recordingPlayer(at = new Location(3222, 3218, 0)) {
    const ticks = [[]];
    const log = (entry) => ticks[ticks.length - 1].push(entry);
    let location = at;
    let queued = 0;
    const attributes = new Map();
    const sender = {
        sendVarbit: (id, value) => (log(`varbit ${id}=${value}`), sender),
        sendConfig: (id, value) => (log(`varp ${id}=${value}`), sender),
        sendInterface: (id) => (log(`interface ${id}`), sender),
        sendInterfaceRemoval: () => (log('close'), sender),
    };
    const player = {
        getLocation: () => location,
        getMovementQueue: () => ({
            size: () => queued,
            reset: () => {},
            setBlockMovement: (blocked) => (log(blocked ? 'locked' : 'free'), { reset: () => {} }),
        }),
        isRegistered: () => true,
        getHitpoints: () => 10,
        performAnimation: (animation) => log(`anim ${animation.getId()}`),
        performGraphic: (graphic) => log(`gfx ${graphic.getId()}${graphic.height ? ` h${graphic.height}` : ''}`),
        getPacketSender: () => sender,
        setTeleporting: () => {},
        moveTo: (to) => {
            location = to;
            log(`teleport ${to.getX()},${to.getY()}`);
        },
        getAttribute: (key) => attributes.get(key),
        setAttribute: (key, value) => attributes.set(key, value),
        sendMessage: (message) => log(message),
        getSkillManager: () => ({ getMaxLevel: () => 99, getCombatLevel: () => 126 }),
    };
    return {
        player,
        ticks,
        log,
        nextTick: () => ticks.push([]),
        walk: () => { queued = 1; },
    };
}

const core = {
    Animation: require('../dist/game/model/Animation').Animation,
    Graphic: require('../dist/game/model/Graphic').Graphic,
    Sounds,
    Task: require('../dist/game/task/Task').Task,
    TaskManager,
    CombatFactory,
    TeleportHandler,
    Location,
    WorldDefinition,
    Skill: require('../dist/game/model/Skill').Skill,
    GameConstants: require('../dist/game/GameConstants').GameConstants,
};

function stubWorld(t) {
    const saved = [Sounds.playAreaSound, CombatFactory.inCombat, TeleportHandler.checkReqs, WorldDefinition.isMembersWorld];
    t.after(() => {
        [Sounds.playAreaSound, CombatFactory.inCombat, TeleportHandler.checkReqs, WorldDefinition.isMembersWorld] = saved;
    });
    CombatFactory.inCombat = () => false;
    TeleportHandler.checkReqs = () => true;
    WorldDefinition.isMembersWorld = () => true;
    return (log) => { Sounds.playAreaSound = ({ soundId, radius }) => log(`sound ${soundId} r${radius}`); };
}

function run(ticks, nextTick, count) {
    for (let i = 0; i < count; i++) {
        TaskManager.process();
        nextTick();
    }
}

test('the home teleport cast plays out as in the OSRS captures, tick by tick', (t) => {
    const soundsTo = stubWorld(t);
    const { player, ticks, log, nextTick } = recordingPlayer();
    soundsTo(log);
    Sequence.startHomeTeleport(core, player, new Location(2609, 3121, 0), () => log('arrived'));
    run(ticks, nextTick, 26);
    const byTick = Object.fromEntries(ticks.map((sent, tick) => [tick, sent]).filter(([, sent]) => sent.length));
    assert.deepEqual(byTick, {
        0: ['anim 65535', 'gfx -1', 'varbit 12393=0'],
        1: ['gfx 800', 'anim 4847', 'sound 193 r4'],
        7: ['anim 4850', 'sound 196 r4'],
        13: ['gfx 802', 'anim 4853', 'sound 194 r4'],
        17: ['gfx 803 h-10', 'anim 4855', 'sound 195 r4'],
        21: ['gfx 804', 'anim 4857', 'varbit 12393=1', 'locked'],
        24: ['varbit 12393=0', 'free', 'teleport 2609,3121', 'anim 65535', 'gfx -1', 'arrived'],
        25: ['anim 65535'],
    });
});

test('walking interrupts the cast before its last ticks: no teleport, no cooldown', (t) => {
    stubWorld(t)(() => {});
    const { player, ticks, log, nextTick, walk } = recordingPlayer();
    Sequence.startHomeTeleport(core, player, new Location(2609, 3121, 0), () => log('arrived'));
    run(ticks, nextTick, 5);
    walk();
    run(ticks, nextTick, 25);
    const all = ticks.flat();
    assert.ok(!all.includes('arrived') && !all.some((e) => e.startsWith('teleport')));
    assert.deepEqual(ticks[5], ['anim 65535', 'gfx -1'], 'the cast is reset');
});

test('once the teleporting animation starts, walking no longer interrupts it', (t) => {
    stubWorld(t)(() => {});
    const { player, ticks, log, nextTick, walk } = recordingPlayer();
    Sequence.startHomeTeleport(core, player, new Location(2609, 3121, 0), () => log('arrived'));
    run(ticks, nextTick, 22);
    walk();
    run(ticks, nextTick, 5);
    assert.ok(ticks.flat().includes('arrived'));
});

test('interface 951 maps its components to the cache minigames, and every one has a destination', async () => {
    await CachePipeline.initialize(path.resolve(__dirname, '..'));
    const { minigameAt } = MinigameTeleports._test;
    assert.equal(minigameAt(13), 'Nightmare Zone', 'as captured: 951:13');
    assert.equal(minigameAt(11), 'Rat Pits', 'as captured: 951:11');
    const data = require('../data/definitions/minigame-teleports.json').minigames;
    const names = [];
    for (let child = 5; child <= 25; child++) names.push(minigameAt(child));
    assert.equal(names.length, 21);
    assert.deepEqual(names.filter((name) => !data[name]), [], 'missing from minigame-teleports.json');
});

function attachPlugins(prompts) {
    const api = {
        core,
        persistAttribute: () => {},
        onInterfaceActionClick: () => {},
        onCustomEvent: () => {},
        onPlayerLogin: () => {},
        sendMultiChatboxPrompt: (player, title, ...pairs) => (prompts.push({ title, pairs }), true),
    };
    HomeTeleports.register(api);
    MinigameTeleports.register(api);
}

test('cooldowns: the captured messages, and the varps set on landing', async (t) => {
    stubWorld(t)(() => {});
    await CachePipeline.initialize(path.resolve(__dirname, '..'));
    attachPlugins([]);
    const minigame = recordingPlayer();
    const now = Sequence.dateMinutes();
    minigame.player.setAttribute(MinigameTeleports._test.LAST_MINIGAME_TELEPORT_ATTRIBUTE, now);
    const spell = CacheDefinitions.getSpellByName('Minigame Teleport');
    MinigameTeleports._test.castMinigameTeleport({
        player: minigame.player, buttonId: spell.widgetId, itemId: spell.itemId, handled: false,
    });
    assert.deepEqual(minigame.ticks.flat(), ['You must wait another 20 minutes before you can use the minigame teleports.']);
    assert.equal(MinigameTeleports._test.minutesLeft(now - 19, now), 1);
    assert.equal(MinigameTeleports._test.minutesLeft(now - 20, now), 0);

    const home = recordingPlayer();
    home.player.setAttribute(HomeTeleports._test.LAST_HOME_TELEPORT_ATTRIBUTE, now - 5);
    const lumbridge = CacheDefinitions.getSpellByName('Lumbridge Home Teleport');
    HomeTeleports._test.castHomeTeleport({
        player: home.player, buttonId: lumbridge.widgetId, itemId: lumbridge.itemId, handled: false,
    });
    assert.deepEqual(home.ticks.flat(), ['You need to wait another 25 minutes to cast this spell.']);

    // Off cooldown: the home teleport lands and records the minute in varp 892.
    const fresh = recordingPlayer();
    HomeTeleports._test.castHomeTeleport({
        player: fresh.player, buttonId: lumbridge.widgetId, itemId: lumbridge.itemId, handled: false,
    });
    run(fresh.ticks, fresh.nextTick, 26);
    assert.ok(fresh.ticks.flat().includes(`varp 892=${Sequence.dateMinutes()}`));
});

test('the spell opens the minigame list with busy set; Rat Pits asks which pit', async (t) => {
    stubWorld(t)(() => {});
    await CachePipeline.initialize(path.resolve(__dirname, '..'));
    const prompts = [];
    attachPlugins(prompts);
    const { player, ticks } = recordingPlayer();
    const spell = CacheDefinitions.getSpellByName('Minigame Teleport');
    MinigameTeleports._test.castMinigameTeleport({ player, buttonId: spell.widgetId, itemId: spell.itemId, handled: false });
    assert.deepEqual(ticks.flat(), ['varbit 12393=1', `interface ${MINIGAMES_WIDGET}`]);

    MinigameTeleports._test.chooseMinigame({ player, groupId: MINIGAMES_WIDGET, childId: 11, handled: false });
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].title, 'Which rat pit would you like to visit?');
    assert.deepEqual(prompts[0].pairs.filter((x) => typeof x === 'string'), [
        'Ardougne (kittens)', 'Varrock (grown cats)', 'Keldagrim (overgrown cats)', 'Port Sarim (wily cats)', 'Cancel',
    ]);
    assert.equal(ticks.flat().at(-1), 'varbit 12393=1', 'busy stays set while the pit is chosen');
    assert.equal(SPELLBOOK, spell.widgetId >>> 16);
});
