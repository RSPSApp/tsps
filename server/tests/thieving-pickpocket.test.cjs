// Run after `yarn build`: node --test tests/thieving-pickpocket.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { Sounds } = require('../dist/game/Sounds');
const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
const { Equipment } = require('../dist/game/model/container/impl/Equipment');
const Thieving = require('../plugins/skills/Thieving.plugin');
const Pickpocket = require('../plugins/skills/thieving/Pickpocket.Thieving');
const CoinPouch = require('../plugins/skills/thieving/CoinPouch.Thieving');
const DATA = require('../data/definitions/pickpocketing.json');

const log = [];
const submitted = [];
const interactions = [];
const combat = {
    inCombat: () => false,
    stunTicks: (_player, ticks, _force, options) => log.push(`stun ${ticks} ticks, graphic ${options?.graphic?.id}/${options?.graphic?.height}, message ${options?.message}`),
};
Thieving.register({
    getTaskManager: () => ({ submit: (task) => { task.setRunning(true); submitted.push(task); } }),
    getCombatFactory: () => combat,
    onNpcInteraction: (name, actions) => interactions.push([name, Object.keys(actions)[0]]),
    onObjectInteraction: () => {},
    onItemAction: () => {},
    emitCustomEvent: (name) => { if (name === 'thieving:success') log.push(name); },
    log: () => {},
});
Sounds.sendSound = () => {};

// Item names for the fake definitions: the data file's items plus the gear the plugin checks.
const NAMES = new Map([
    [I.COINS, 'Coins'], [I.GLOVES_OF_SILENCE, 'Gloves of silence'], [I.DODGY_NECKLACE, 'Dodgy necklace'],
    [I.THIEVING_CAPE, 'Thieving cape'], [I.FIRE_CAPE, 'Fire cape'], [I.ROGUE_MASK, 'Rogue mask'], [I.ROGUE_TOP, 'Rogue top'],
    [I.ROGUE_TROUSERS, 'Rogue trousers'], [I.ROGUE_GLOVES, 'Rogue gloves'], [I.ROGUE_BOOTS, 'Rogue boots'],
    [I.CLUE_SCROLL_EASY_, 'Clue scroll (easy)'],
]);
for (const t of DATA.targets) for (const e of [...(t.always ?? []), ...(t.first ?? []), ...(t.table ?? [])]) if (e.id) NAMES.set(e.id, e.name);
for (const t of DATA.targets) if (t.coinPouch) NAMES.set(t.coinPouch.id, 'Coin pouch');
ItemDefinition.forId = (id) => ({ getName: () => NAMES.get(id) ?? '' });

function container(entries = {}, full = false) {
    const amounts = new Map(Object.entries(entries).map(([id, n]) => [Number(id), n]));
    return {
        amounts,
        isFull: () => full,
        full: () => log.push('inventory full'),
        getAmount: (id) => amounts.get(id) ?? 0,
        adds: (id, n) => { amounts.set(id, (amounts.get(id) ?? 0) + n); log.push(`add ${NAMES.get(id) ?? id} x${n}`); },
        delete: (id, n) => amounts.set(id, (amounts.get(id) ?? 0) - n),
        getItems: () => [...amounts].filter(([, n]) => n > 0).map(([id, n]) => ({ getId: () => id, getAmount: () => n })),
    };
}

function player({ level = 99, farming = 99, stunLeft = 0, worn = {}, inventory = {}, full = false, attributes = {} } = {}) {
    const slots = new Map(Object.entries(worn).map(([slot, id]) => [Number(slot), id]));
    const attrs = new Map(Object.entries(attributes));
    const inv = container(inventory, full);
    return {
        inv, slots, attrs,
        getClickDelay: () => ({ elapsedTime: () => true, reset: () => {} }),
        getSkillManager: () => ({
            getCurrentLevel: () => level,
            getMaxLevel: () => farming,
            addExperiences: (_skill, xp) => log.push(`xp ${xp}`),
        }),
        getTimers: () => ({ getTicks: () => stunLeft }),
        getInventory: () => inv,
        getBank: () => container(),
        getEquipment: () => ({
            get: (slot) => (slots.has(slot) ? { getId: () => slots.get(slot) } : null),
            set: (slot, item) => slots.set(slot, item.getId()),
            refreshItems: () => {},
        }),
        getMovementQueue: () => ({ reset: () => {} }),
        setPositionToFace: () => {},
        interacting: null,
        getInteractingMobile() { return this.interacting; },
        setMobileInteraction(mobile) { this.interacting = mobile; },
        performAnimation: (animation) => log.push(`anim ${animation.getId()}`),
        getBlockAnim: () => 420,
        sendMessage: (message) => log.push(message),
        getAttribute: (key) => attrs.get(key),
        setAttribute: (key, value) => attrs.set(key, value),
        getIndex: () => 1,
        isRegistered: () => true,
        getHitpoints: () => 10,
        getLocation: () => ({}),
        getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: ([hit]) => log.push(`hit ${hit.getDamage()}`) }) }),
    };
}

function npc() {
    return {
        getTimers: () => ({ registers: () => {} }),
        isRegistered: () => true,
        getLocation: () => ({}),
        setPositionToFace: () => {},
        forceChat: (line) => log.push(`npc: ${line}`),
        performAnimation: (animation) => log.push(`npc anim ${animation.getId()}`),
        getAttackAnim: () => 422,
    };
}

/** One pickpocket: what the click tick logs, then what each following tick logs (`next` is the first). */
function attempt(t, { name = 'Man', npcId = 0, random = 0, who = player({ level: 1 }) } = {}) {
    const original = Math.random;
    Math.random = () => random;
    t.after(() => { Math.random = original; });
    log.length = 0;
    submitted.length = 0;
    const event = { player: who, npc: npc(), npcId, definition: { getName: () => name } };
    const result = Thieving._test.pickpocket(event);
    const click = [...log];
    const ticks = [];
    for (let tick = 0; tick < 3; tick++) {
        log.length = 0;
        for (const task of [...submitted]) if (task.isRunning()) task.execute();
        ticks.push([...log]);
    }
    return { click, next: ticks[0], ticks, handled: event.handled, result };
}

test('the data file: every target is complete, its rates add up, and no NPC is claimed twice', () => {
    const { rateOf } = Pickpocket._test;
    const claimed = new Set();
    for (const t of DATA.targets) {
        assert.ok(t.level >= 1 && t.xp > 0 && t.low <= t.high && t.high <= 256, t.key);
        assert.ok(t.petBase > 0, `${t.key} pet rate`);
        for (const farming of [1, 99]) {
            const rate = (e) => (e.farmingRate ? e.farmingRate.base + e.farmingRate.perLevel * Math.min(85, farming) : rateOf(e.rate));
            const sum = (t.table ?? []).reduce((total, e) => total + rate(e), 0);
            assert.ok(sum <= 1.01, `${t.key} table adds up to ${sum}`);
        }
        for (const name of t.npcs) {
            const key = `${name}|${t.option ?? 'Pickpocket'}|${t.ids ?? ''}`;
            assert.ok(!claimed.has(key), `${name} is claimed twice`);
            claimed.add(key);
        }
    }
    assert.equal(new Set(interactions.map(([name, option]) => `${name}|${option}`)).size, interactions.length, 'each name and option is registered once');
    assert.ok(interactions.some(([name, option]) => name === 'Digsite workman' && option === 'Steal-from'));
});

test('the data file names items as the cache does', async () => {
    const { CachePipeline } = require('../dist/game/cache/CachePipeline');
    const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
    await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
    for (const t of DATA.targets) {
        for (const e of [...(t.always ?? []), ...(t.first ?? []), ...(t.table ?? [])].filter((e) => e.id)) {
            assert.equal(CacheDefinitions.getItem(e.id).name, e.name, `${t.key}: ${e.id}`);
        }
        if (t.coinPouch) assert.equal(CacheDefinitions.getItem(t.coinPouch.id).name, 'Coin pouch', `${t.key} pouch`);
    }
});

test('success follows the Wiki chart; gloves of silence and the Thieving cape scale it', () => {
    const { successChance } = Pickpocket._test;
    const man = DATA.targets.find((t) => t.key === 'man');
    assert.equal(successChance(player({ level: 1 }), man), 181 / 256, 'Man at 1: 180/256 + 1');
    assert.equal(successChance(player({ level: 99 }), man), 241 / 256);
    assert.equal(successChance(player({ level: 1, worn: { [Equipment.HANDS_SLOT]: I.GLOVES_OF_SILENCE } }), man), 190 / 256, 'Wiki: 189');
    const both = player({ level: 1, worn: { [Equipment.HANDS_SLOT]: I.GLOVES_OF_SILENCE, [Equipment.CAPE_SLOT]: I.THIEVING_CAPE } });
    assert.equal(successChance(both, man), 208 / 256, '189 * 1.1, rounded down');
    const tzhaar = DATA.targets.find((t) => t.key === 'tzhaar_hur');
    assert.equal(successChance(player({ level: 1 }), tzhaar), 0, 'a negative low stays at 0');
});

test('a success: the attempt message, then the animation, a coin pouch and the experience a tick later', (t) => {
    const { click, ticks } = attempt(t);
    assert.deepEqual(click, ["You attempt to pick the man's pocket."]);
    assert.deepEqual(ticks, [['anim 881', 'add Coin pouch x1', "You pick the man's pocket.", 'xp 8', 'thieving:success'], [], []]);
});

test('a failure, as captured on a hero: the message and line, then the strike and stun, then the stun message and damage', (t) => {
    const { click, ticks } = attempt(t, { random: 0.99 });
    assert.deepEqual(click, ["You attempt to pick the man's pocket."]);
    assert.deepEqual(ticks, [
        ["You fail to pick the man's pocket.", "npc: What do you think you're doing?"],
        ['npc anim 422', 'anim 420', 'stun 9 ticks, graphic 245/124, message false'],
        ["You've been stunned!", 'hit 1'],
    ]);
});

test('with the outcome the player stops tracking the NPC, so it is not followed round as it walks', (t) => {
    const who = player({ level: 1 });
    const target = npc();
    who.setMobileInteraction(target);
    const original = Math.random;
    Math.random = () => 0;
    t.after(() => { Math.random = original; });
    submitted.length = 0;
    Thieving._test.pickpocket({ player: who, npc: target, npcId: 0, definition: { getName: () => 'Man' } });
    assert.equal(who.getInteractingMobile(), target, 'still facing it while the attempt is pending');
    submitted[0].execute();
    assert.equal(who.getInteractingMobile(), null);
});

test('a caught player cannot start another pickpocket before the stun lands', (t) => {
    const who = player({ level: 1 });
    const original = Math.random;
    Math.random = () => 0.99;
    t.after(() => { Math.random = original; });
    submitted.length = 0;
    Thieving._test.pickpocket({ player: who, npc: npc(), npcId: 0, definition: { getName: () => 'Man' } });
    submitted[0].execute();
    log.length = 0;
    Thieving._test.pickpocket({ player: who, npc: npc(), npcId: 0, definition: { getName: () => 'Man' } });
    assert.deepEqual(log, [], 'no attempt between the failure and the stun');
});

test("a new click can't cancel a pending outcome or stun, and a lost stun never locks pickpocketing", (t) => {
    const who = player({ level: 1 });
    const original = Math.random;
    const now = Date.now;
    Math.random = () => 0.99;
    t.after(() => { Math.random = original; Date.now = now; });
    submitted.length = 0;
    Thieving._test.pickpocket({ player: who, npc: npc(), npcId: 0, definition: { getName: () => 'Man' } });
    submitted[0].execute();
    assert.ok(submitted.every((task) => task.key !== who.getIndex()), "not keyed to the player, whose tasks a click cancels (walkToReset)");
    // The stun task lost anyway: once the hold has passed, pickpocketing goes ahead.
    const start = Date.now();
    Date.now = () => start + 2000;
    log.length = 0;
    Thieving._test.pickpocket({ player: who, npc: npc(), npcId: 0, definition: { getName: () => 'Man' } });
    assert.deepEqual(log, ["You attempt to pick the man's pocket."]);
});

test('a stun blocks pickpocketing for 8 of its 9 ticks', (t) => {
    const blocked = attempt(t, { who: player({ level: 1, stunLeft: 2 }) });
    assert.deepEqual([blocked.click, blocked.next], [[], []], 'two ticks of the stun left: no attempt');
    assert.ok(attempt(t, { who: player({ level: 1, stunLeft: 1 }) }).next.includes('anim 881'), 'its last tick: the attempt goes ahead');
});

test('a quest requirement blocks the target until the quest is complete', (t) => {
    const blocked = attempt(t, { name: 'Agnar', who: player() });
    assert.deepEqual([blocked.click, blocked.next], [['You need to complete The Fremennik Trials before you can do that.'], []]);
    const done = attempt(t, { name: 'Agnar', who: player({ attributes: { 'quest.fremennik_trials.stage': 2 } }) });
    assert.deepEqual(done.click, ["You attempt to pick Agnar's pocket."], 'a named citizen keeps its name');
    const elf = attempt(t, { name: 'Arvel', who: player() });
    assert.deepEqual(elf.click, ["You need to complete Mourning's End Part I before you can do that."], 'a quest not in the game yet stays locked');
});

test('coin pouches: 28 of a kind block pickpocketing; a full inventory only allows a coins-only target with a stack', (t) => {
    const capped = attempt(t, { who: player({ inventory: { [I.COIN_POUCH]: 28 } }) });
    assert.deepEqual(capped.click, ['You need to empty your coin pouches before you can continue pickpocketing.']);
    const stacked = attempt(t, { who: player({ inventory: { [I.COIN_POUCH]: 5 }, full: true }) });
    assert.deepEqual(stacked.click, ["You attempt to pick the man's pocket."]);
    const empty = attempt(t, { who: player({ full: true }) });
    assert.deepEqual(empty.click, ['inventory full']);
    const farmer = attempt(t, { name: 'Farmer', who: player({ inventory: { [I.COIN_POUCH_2]: 5 }, full: true }) });
    assert.deepEqual(farmer.click, ['inventory full'], 'a farmer can also give seeds');
});

test('opening coin pouches pays their coins', () => {
    const who = player({ inventory: { [I.COIN_POUCH]: 3 } });
    log.length = 0;
    CoinPouch._test.open(who, I.COIN_POUCH, 3);
    assert.equal(who.inv.getAmount(I.COIN_POUCH), 0);
    assert.equal(who.inv.getAmount(I.COINS), 9);
    assert.deepEqual(log.at(-1), 'You open all of the pouches and find 9 coins.');
});

test('the rogue outfit: the full set doubles loot; a doubled coin pouch adds its coins', () => {
    const { giveLoot } = Pickpocket._test;
    const rogueSet = { [Equipment.HEAD_SLOT]: I.ROGUE_MASK, [Equipment.BODY_SLOT]: I.ROGUE_TOP, [Equipment.LEG_SLOT]: I.ROGUE_TROUSERS,
        [Equipment.HANDS_SLOT]: I.ROGUE_GLOVES, [Equipment.FEET_SLOT]: I.ROGUE_BOOTS };
    const rogue = DATA.targets.find((t) => t.key === 'rogue');
    const who = player({ worn: rogueSet });
    giveLoot(who, rogue, [{ id: I.AIR_RUNE, amount: 8 }], () => 0.999);
    assert.equal(who.inv.getAmount(I.AIR_RUNE), 16);
    giveLoot(who, rogue, [{ id: I.COINS, amount: 30 }], () => 0.999);
    assert.equal(who.inv.getAmount(rogue.coinPouch.id), 1);
    assert.equal(who.inv.getAmount(I.COINS), 25, "one pouch, plus the pouch's coins");
    const noSet = player();
    giveLoot(noSet, rogue, [{ id: I.AIR_RUNE, amount: 8 }], () => 0);
    assert.equal(noSet.inv.getAmount(I.AIR_RUNE), 8);
});

test('the dodgy necklace prevents a stun and uses a charge; the tenth crumbles it', () => {
    const { dodgyNecklaceProtects } = Pickpocket._test;
    const who = player({ worn: { [Equipment.AMULET_SLOT]: I.DODGY_NECKLACE } });
    assert.equal(dodgyNecklaceProtects(who, () => 0.5), false, '75% of the time it does nothing');
    log.length = 0;
    assert.equal(dodgyNecklaceProtects(who, () => 0), true);
    assert.deepEqual(log, ['Your dodgy necklace protects you. It has 9 charges left.']);
    who.attrs.set('thieving.dodgy-necklace-charges', 1);
    dodgyNecklaceProtects(who, () => 0);
    assert.equal(who.slots.get(Equipment.AMULET_SLOT), -1);
    assert.equal(log.at(-1), 'Your dodgy necklace protects you. It then crumbles to dust.');
});

test('gloves of silence wear out after 62 failed pickpockets', () => {
    const { wearOutGloves } = Pickpocket._test;
    const who = player({ worn: { [Equipment.HANDS_SLOT]: I.GLOVES_OF_SILENCE } });
    for (let i = 0; i < 61; i++) wearOutGloves(who);
    assert.equal(who.slots.get(Equipment.HANDS_SLOT), I.GLOVES_OF_SILENCE);
    wearOutGloves(who);
    assert.equal(who.slots.get(Equipment.HANDS_SLOT), -1);
});

test('NPC ids pick between targets that share a name; anything else falls through', (t) => {
    const { targetFor } = Pickpocket._test;
    assert.equal(targetFor('Bandit', 695).key, 'desert_bandit');
    assert.equal(targetFor('Bandit', 735), null, 'a Pollnivneach bandit is left to blackjacking');
    const result = attempt(t, { name: 'Bandit', npcId: 735 });
    assert.equal(result.result, false);
    assert.notEqual(result.handled, true);
});

test('loot: Master Farmer herb seeds follow Farming level; the workman pays coins after The Dig Site', () => {
    const { rollLoot } = Pickpocket._test;
    const farmer = DATA.targets.find((t) => t.key === 'master_farmer');
    const guam = farmer.table.find((e) => e.name === 'Guam seed').farmingRate;
    const ranarr = farmer.table.find((e) => e.name === 'Ranarr seed').farmingRate;
    assert.ok(guam.base + guam.perLevel * 85 < guam.base + guam.perLevel * 1, 'fewer guam seeds at higher Farming');
    assert.ok(Math.abs(1 / (ranarr.base + ranarr.perLevel * 75) - 1 / ((69 / 81) * (81 / 1000) * (48 / 1000))) < 1, 'Wiki calculator at 75');
    const workman = DATA.targets.find((t) => t.key === 'digsite_workman');
    const pick = (who, value) => rollLoot(who, workman, () => value);
    assert.equal(pick(player(), 0.2)[0].id, I.SPECIMEN_BRUSH, 'before the quest coins are 1/11');
    assert.equal(pick(player({ attributes: { 'quest.the_dig_site.stage': 2 } }), 0.2)[0].id, I.COINS, 'after it, 4/11');
});

test('stunTicks lasts exactly its ticks; stun in seconds is unchanged', () => {
    const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
    const { TimerRepository } = require('../dist/util/timers/TimerRepository');
    const { TimerKey } = require('../dist/util/timers/TimerKey');
    const stunned = (stun) => {
        const timers = new TimerRepository();
        const mobile = {
            getTimers: () => timers,
            getCombat: () => ({ reset: () => {} }),
            getMovementQueue: () => ({ reset: () => {} }),
            performGraphic: () => {},
            isPlayer: () => false,
        };
        stun(mobile);
        let ticks = 0;
        while (timers.has(TimerKey.STUN)) {
            timers.process();
            ticks++;
        }
        return ticks;
    };
    assert.equal(stunned((mobile) => CombatFactory.stunTicks(mobile, 9, true)), 9);
    assert.equal(stunned((mobile) => CombatFactory.stun(mobile, 4, true)), 7, "Callisto's 4 s, as before");
    assert.equal(stunned((mobile) => CombatFactory.stun(mobile, 5.4, true)), 10, '5.4 s overshoots: why ticks');
    const { Graphic } = require('../dist/game/model/Graphic');
    const shown = [];
    const playerMobile = {
        getTimers: () => new TimerRepository(),
        getCombat: () => ({ reset: () => {} }),
        getMovementQueue: () => ({ reset: () => {} }),
        performGraphic: (graphic) => shown.push(`graphic ${graphic.id}/${graphic.height}`),
        isPlayer: () => true,
        getAsPlayer: () => ({ sendMessage: (message) => shown.push(message) }),
    };
    CombatFactory.stunTicks(playerMobile, 9, true);
    CombatFactory.stunTicks(playerMobile, 9, true, { graphic: new Graphic(245, 0, 124), message: false });
    assert.deepEqual(shown, ['graphic 348/100', "You've been stunned!", 'graphic 245/124'], 'defaults unchanged; options replace them');
});
