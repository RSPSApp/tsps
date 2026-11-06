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
    let resets = 0;
    const attributes = new Map();
    const sender = {
        sendVarbit: (id, value) => (log(`varbit ${id}=${value}`), sender),
        sendConfig: (id, value) => (log(`varp ${id}=${value}`), sender),
        sendInterface: (id) => (log(`interface ${id}`), sender),
        sendInterfaceFlagsRange: (uid, from, to, flags) => (log(`flags ${uid} ${from}..${to}=${flags}`), sender),
        sendInterfaceRemoval: () => (log('close'), sender),
        sendClientScript: (id) => (log(`script ${id}`), sender),
    };
    const player = {
        getLocation: () => location,
        getMovementQueue: () => ({
            size: () => queued,
            reset: () => { resets++; },
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
        resets: () => resets,
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
  CacheDefinitions,
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

test('a moving home teleport click never starts the cast and never clears the walk', (t) => {
    stubWorld(t)(() => {});
    const { player, ticks, log, nextTick, walk, resets } = recordingPlayer();
    walk();
    assert.equal(
        Sequence.startHomeTeleport(core, player, new Location(2609, 3121, 0), () => log('arrived')),
        null,
        'the cast only starts while standing still'
    );
    run(ticks, nextTick, 3);
    assert.deepEqual(ticks.flat(), ['varbit 12393=0'], 'busy is cleared but no cast begins');
    assert.equal(resets(), 0, "the player's walk is left alone");
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
  attachPlugins([]);
    const { minigameAt } = MinigameTeleports._test;
    assert.equal(minigameAt(13), 'Nightmare Zone', 'as captured: 951:13');
    assert.equal(minigameAt(11), 'Rat Pits', 'as captured: 951:11');
    const data = require('../plugins/interface/data/minigame-teleports.json').minigames;
    const names = [];
    for (let child = 5; child <= 25; child++) names.push(minigameAt(child));
    assert.equal(names.length, 21);
    assert.deepEqual(names.filter((name) => !data[name]), [], 'missing from minigame-teleports.json');
});

function attachPlugins(prompts, quests = [], zones = [], customHooks = [], interfaceHooks = []) {
    const api = {
        core,
        persistAttribute: () => {},
    onInterfaceActionClick: (handler) => interfaceHooks.push(handler),
    onItemAction: () => {},
    onCustomEvent: (name, handler) => customHooks.push({ name, handler }),
    emitCustomEvent: (name, request) => {
      if (name === 'quest:is-complete') {
        const quest = quests.find((entry) => entry.key === request.key);
        if (quest) request.complete = quest.isComplete(request.player);
        return;
      }
      for (const hook of customHooks) if (hook.name === name) hook.handler(request);
    },
    onNpcInteraction: () => {},
    onNpcDialogueVariant: () => {},
    onNpcDialogueCondition: () => {},
    onObjectClick: () => {},
    onObjectInteraction: () => {},
    onZoneEnter: (zone, handler) => zones.push({ zone, handler }),
        onPlayerLogin: () => {},
        sendMultiChatboxPrompt: (player, title, ...pairs) => (prompts.push({ title, pairs }), true),
    };
    HomeTeleports.register(api);
    MinigameTeleports.register(api);
    return api;
}

test('known missing quest gates and unvisited destinations fail closed', async (t) => {
  stubWorld(t)(() => {});
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  const customHooks = [];
  attachPlugins([], [], [], customHooks);
  const playerRecord = recordingPlayer();
  const { refusal, VISITED_KELDAGRIM_ATTRIBUTE, VISITED_TITHE_FARM_ATTRIBUTE } = MinigameTeleports._test;
  assert.match(refusal(playerRecord.player, { quests: ['Temple of the Eye'] }), /Temple of the Eye/);
  assert.match(refusal(playerRecord.player, { visited: ['Keldagrim'] }), /visited Keldagrim/);
  assert.match(refusal(playerRecord.player, { visited: ['Tithe Farm'] }), /visited Tithe Farm/);
  const blastFurnaceChild = Array.from({ length: 21 }, (_, index) => index + 5)
    .find((child) => MinigameTeleports._test.minigameAt(child) === 'Blast Furnace');
  MinigameTeleports._test.chooseMinigame({
    player: playerRecord.player, groupId: MINIGAMES_WIDGET, childId: blastFurnaceChild, handled: false,
  });
  assert.equal(playerRecord.player.getAttribute(MinigameTeleports._test.LAST_MINIGAME_TELEPORT_ATTRIBUTE), undefined,
    'rejection does not start a cooldown');

  const enteredKeldagrim = customHooks.find(({ name }) => name === 'keldagrim:entered-city');
  assert.ok(enteredKeldagrim, 'Keldagrim entry is tracked through the shared event');
  enteredKeldagrim.handler({ player: playerRecord.player });
  const enteredTitheFarm = customHooks.find(({ name }) => name === 'tithe-farm:entered');
  assert.ok(enteredTitheFarm, 'Tithe Farm entry is tracked by its real game-entry event');
  enteredTitheFarm.handler({ player: playerRecord.player });
  assert.equal(playerRecord.player.getAttribute(VISITED_KELDAGRIM_ATTRIBUTE), true);
  assert.equal(playerRecord.player.getAttribute(VISITED_TITHE_FARM_ATTRIBUTE), true);
  assert.equal(refusal(playerRecord.player, { visited: ['Keldagrim', 'Tithe Farm'] }), null);

});

test("Sorceress Garden Minigame Teleport also requires Osman's unlock", async (t) => {
  stubWorld(t)(() => {});
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  let questComplete = true;
  const customHooks = [];
  const api = attachPlugins([], [{ key: 'prince_ali_rescue', isComplete: () => questComplete }], [], customHooks);
  require('../plugins/minigames/sorceressgarden/Apprentice.SorceresssGarden')(api);
  const garden = require('../plugins/interface/data/minigame-teleports.json').minigames["Sorceress's Garden"];
  const { refusal } = MinigameTeleports._test;

  const locked = recordingPlayer().player;
  assert.match(refusal(locked, garden), /speak to Osman/);

  locked.setAttribute('sorceress-s-garden:osman-help-asked', true);
  assert.equal(refusal(locked, garden), null, 'the recorded post-quest conversation unlocks Minigame Teleport');

  const returning = recordingPlayer().player;
  returning.setAttribute('sorceress-s-garden:teleported', true);
  assert.equal(refusal(returning, garden), null, 'existing Apprentice users keep access');

  questComplete = false;
  assert.match(refusal(returning, garden), /complete Prince Ali Rescue/,
    'the previous teleport does not bypass the quest requirement');
});

test('cooldowns: the captured messages, and the varps set on landing', async (t) => {
    stubWorld(t)(() => {});
    await CachePipeline.initialize(path.resolve(__dirname, '..'));
    t.mock.method(Date, 'now', () => 1_800_000_000_000);
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
        player: fresh.player, buttonId: lumbridge.widgetId, itemId: lumbridge.itemId, opId: 1, handled: false,
    });
    run(fresh.ticks, fresh.nextTick, 26);
    assert.ok(fresh.ticks.flat().includes(`varp 892=${Sequence.dateMinutes()}`));
});

test('Animation opens the native picker for every home spell without casting or checking its cooldown', async (t) => {
    stubWorld(t)(() => { throw new Error('Animation must not start a teleport'); });
    await CachePipeline.initialize(path.resolve(__dirname, '..'));
    attachPlugins([]);
    for (const name of ['Lumbridge Home Teleport', 'Edgeville Home Teleport', 'Lunar Home Teleport', 'Arceuus Home Teleport']) {
        const f = recordingPlayer();
        const spell = CacheDefinitions.getSpellByName(name);
        assert.ok(spell, name);
        const minute = Sequence.dateMinutes();
        f.player.setAttribute(HomeTeleports._test.LAST_HOME_TELEPORT_ATTRIBUTE, minute);
        const event = { player: f.player, buttonId: spell.widgetId, itemId: spell.itemId, opId: 10, handled: false };
        HomeTeleports._test.castHomeTeleport(event);
        assert.equal(event.handled, true, name);
        assert.deepEqual(f.ticks.flat(), ['varp 4559=4093', 'varp 4560=1', 'interface 525', 'flags 34406408 0..10=2', 'script 7707'], name);
        assert.equal(f.player.getAttribute(HomeTeleports._test.LAST_HOME_TELEPORT_ATTRIBUTE), minute);
    }
});

test('the spell opens the minigame list with busy set; Rat Pits asks which pit', async (t) => {
    stubWorld(t)(() => {});
    await CachePipeline.initialize(path.resolve(__dirname, '..'));
    const prompts = [];
    attachPlugins(prompts, [{ key: 'ratcatchers', isComplete: () => true }]);
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
    MinigameTeleports._test.chooseMinigame({ player: recordingPlayer().player, groupId: 76, childId: 32, slot: 18, action: 1 });
    assert.equal(prompts.length, 2, 'Grouping keeps the same Rat Pits choice menu');
});

test('native Grouping selections use the existing teleport, cooldown and refusal paths', async t => {
    await CachePipeline.initialize(path.resolve(__dirname, '..'));
    const { PluginManager } = require('../dist/plugins/PluginManager');
    const { Player } = require('../dist/game/entity/impl/player/Player');
    const { PlayerSession } = require('../dist/net/PlayerSession');
    const { ClientConnection } = require('../dist/net/NetworkBuilder');
    const api = PluginManager.createApi('native-grouping-teleports-test');
    MinigameTeleports.register(api);
    require('../plugins/interface/SideChannels.plugin').register(api);
    let nextIndex = 1700;
    function who() {
        const channel = { kind: 'test', isOpen: () => true, send: () => true, close() {}, onData() {}, onClose() {}, onError() {} };
        const session = new PlayerSession(channel), player = new Player(session, new Location(3222, 3218, 0));
        session.setPlayer(player); player.setRegistered(true); player.setIndex(nextIndex++); player.setUsername('grouping' + player.getIndex()); player.needsPlacement = false;
        const connection = new ClientConnection(channel); connection.player = player;
        const messages = []; t.mock.method(player, 'sendMessage', message => messages.push(message));
        t.after(() => { player.setRegistered(false); TaskManager.cancelTasks(player); TaskManager.cancelTasks(player.getIndex()); });
        return { player, connection, messages };
    }
    const position = f => [f.player.getLocation().getX(), f.player.getLocation().getY(), f.player.getLocation().getZ()];
    const slots = CacheDefinitions.getEnumValues(848);
    const slotFor = name => [...slots].find(([, value]) => value === name)?.[0];
    const click = async (f, slot, opId = 1) => {
        await f.connection.dispatch([{ type: 'widget_action', widgetId: (76 << 16) | 32, groupId: 76, childId: 32, buttonNum: opId, opId, slot, itemId: -1 }]);
        f.connection.processTurnPackets();
    };
    for (const slot of [0, -1, 999, slotFor('Shield of Arrav')]) {
        const f = who(); await click(f, slot);
        for (let tick = 0; tick < 26; tick++) TaskManager.process();
        assert.deepEqual(position(f), [3222, 3218, 0], `ineligible grouping slot ${slot} stays put`);
        assert.equal(f.player.getAttribute(MinigameTeleports._test.LAST_MINIGAME_TELEPORT_ATTRIBUTE), undefined);
    }
    const wrongOp = who(); await click(wrongOp, slotFor('Castle Wars'), 2);
    assert.equal(wrongOp.player.getAttribute(MinigameTeleports._test.LAST_MINIGAME_TELEPORT_ATTRIBUTE), undefined);
    assert.deepEqual(position(wrongOp), [3222, 3218, 0]);
    const castle = who(); await click(castle, slotFor('Castle Wars'));
    for (let tick = 0; tick < 26; tick++) TaskManager.process();
    assert.deepEqual(position(castle), [2442, 3093, 0]);
    assert.equal(castle.player.getAttribute(MinigameTeleports._test.LAST_MINIGAME_TELEPORT_ATTRIBUTE), Sequence.dateMinutes());
    await click(castle, slotFor('Castle Wars'));
    assert.match(castle.messages.at(-1), /wait another 20 minutes/);
    for (const [name, expected] of [
        ['Fishing Trawler', /Fishing level of 15/], ['Pest Control', /combat level of 40/], ['Blast Furnace', /visited Keldagrim/],
        ['Guardians of the Rift', /complete Temple of the Eye/], ['Sorceress Garden', /complete Prince Ali Rescue/],
    ]) {
        const f = who(); await click(f, slotFor(name));
        assert.match(f.messages.at(-1) ?? '', expected);
        assert.deepEqual(position(f), [3222, 3218, 0]);
        assert.equal(f.player.getAttribute(MinigameTeleports._test.LAST_MINIGAME_TELEPORT_ATTRIBUTE), undefined);
    }
    const busy = who(); busy.player.setInterfaceId(12); await click(busy, slotFor('Castle Wars'));
    assert.match(busy.messages.at(-1), /cannot do that right now/);
    assert.equal(busy.player.getInterfaceId(), 12, 'the grouping click cannot close a busy interface to bypass its gate');
    const blocked = who(); blocked.player.setLocation(new Location(3200, 3600, 0));
    blocked.player.getCombat().getTeleblockTimer().start(300); await click(blocked, slotFor('Castle Wars'));
    assert.match(blocked.messages.at(-1), /blocking you from teleporting/);
    assert.deepEqual(position(blocked), [3200, 3600, 0]);
    const vetoed = who();
    const { Area } = require('../dist/game/model/areas/Area');
    vetoed.player.setArea(new class extends Area { canTeleport() { return false; } }([]));
    await click(vetoed, slotFor('Castle Wars'));
    assert.deepEqual(position(vetoed), [3222, 3218, 0]);
    assert.equal(vetoed.player.getAttribute(MinigameTeleports._test.LAST_MINIGAME_TELEPORT_ATTRIBUTE), undefined);
    t.mock.method(WorldDefinition, 'isMembersWorld', () => false);
    const free = who(); await click(free, slotFor('Nightmare Zone'));
    assert.match(free.messages.at(-1), /members' world/);
});


test('home animation picker persists only valid toggle row operations and retains one enabled cast', () => {
    const handlers = [];
    attachPlugins([], [], [], [], handlers);
    const f = recordingPlayer();
    f.player.setAttribute('home-teleport:animations-unlocked', 1 << 5);
    const click = (overrides = {}) => {
        const event = { player: f.player, groupId: 525, childId: 8, opId: 1, slot: 5, ...overrides };
        for (const handler of handlers) handler(event);
        return event;
    };
    for (const invalid of [{ childId: 7 }, { opId: 2 }, { slot: -1 }, { slot: 32 }, { slot: 5.5 }]) {
        click(invalid);
        assert.equal(f.player.getAttribute(Sequence.TOGGLES_ATTRIBUTE), undefined);
    }
    click({ slot: 6 }); // Shattered is still locked.
    assert.equal(f.player.getAttribute(Sequence.TOGGLES_ATTRIBUTE), undefined);
    assert.equal(click().handled, true);
    assert.equal(f.player.getAttribute(Sequence.TOGGLES_ATTRIBUTE), 33);
    click({ slot: 0 });
    assert.equal(f.player.getAttribute(Sequence.TOGGLES_ATTRIBUTE), 32);
    click(); // Trailblazer is the last enabled animation.
    assert.equal(f.player.getAttribute(Sequence.TOGGLES_ATTRIBUTE), 32);
    assert.ok(f.ticks.flat().includes('varp 4560=32'));
});

test('enabled league casts use their own lock/landing ticks and release movement when cancelled', (t) => {
    stubWorld(t)(() => {});
    for (const [bit, animation, lockTick, landTick] of [[5, 8798, 22, 24], [6, 9209, 16, 19]]) {
        const f = recordingPlayer();
        f.player.setAttribute(Sequence.TOGGLES_ATTRIBUTE, 1 << bit);
        Sequence.startHomeTeleport(core, f.player, new Location(2609, 3121, 0), () => f.log('arrived'));
        run(f.ticks, f.nextTick, landTick + 2);
        assert.ok(f.ticks[1].includes(`anim ${animation}`));
        assert.ok(f.ticks[lockTick].includes('locked'));
        assert.ok(f.ticks[landTick].includes('arrived'));
        assert.ok(f.ticks[landTick].includes('free'));
        const cancelled = recordingPlayer();
        cancelled.player.setAttribute(Sequence.TOGGLES_ATTRIBUTE, 1 << bit);
        const task = Sequence.startHomeTeleport(core, cancelled.player, new Location(2609, 3121, 0));
        run(cancelled.ticks, cancelled.nextTick, lockTick + 1);
        task.stop();
        assert.ok(cancelled.ticks.flat().includes('free'));
        run(cancelled.ticks, cancelled.nextTick, landTick + 2);
        assert.ok(!cancelled.ticks.flat().some(e => e.startsWith('teleport')));
    }
});

test('Soul Wars lands in the lobby on the Isle of Souls, not the tutorial instance template', () => {
    const destinations = require('../plugins/interface/data/minigame-teleports.json').minigames;
    const soulWarsData = require('../plugins/minigames/data/soul-wars.json');
    const lobby = soulWarsData.lobby;
    const soulWars = destinations['Soul Wars'];
    assert.ok(soulWars, 'the Soul Wars teleport exists');
    assert.deepEqual([soulWars.x, soulWars.y], [lobby.arrive[0], lobby.arrive[1]],
        'the destination is the Soul Wars portal arrival the plugin itself uses');
    const [x0, y0, x1, y1] = lobby.bounds;
    assert.ok(soulWars.x >= x0 && soulWars.x <= x1 && soulWars.y >= y0 && soulWars.y <= y1,
        'the destination is inside the registered Soul Wars lobby Area');
    // 2018,5929 is inside the tutorial/arena template. No world map area covers it, so the map
    // and minimap cannot show the island there (issue #2724).
    const [templateChunkX, templateChunkY] = soulWarsData.tutorial.chunk;
    const [templateChunksX, templateChunksY] = soulWarsData.tutorial.size;
    const inTemplate = soulWars.x >= templateChunkX * 8 && soulWars.x < (templateChunkX + templateChunksX) * 8
        && soulWars.y >= templateChunkY * 8 && soulWars.y < (templateChunkY + templateChunksY) * 8;
    assert.ok(!inTemplate, 'never the tutorial instance template');
});
