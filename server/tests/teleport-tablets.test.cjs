// Run after `yarn build`: node --test tests/teleport-tablets.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { Location } = require('../dist/game/model/Location');
const { Sounds } = require('../dist/game/Sounds');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { TeleportHandler } = require('../dist/game/model/teleportation/TeleportHandler');
const { TeleportType } = require('../dist/game/model/teleportation/TeleportType');

/** A player that records, per tick, what the server would send about them. */
function recordingPlayer() {
    const ticks = [[]];
    const log = (entry) => ticks[ticks.length - 1].push(entry);
    const player = {
        getMovementQueue: () => ({
            setBlockMovement: (blocked) => {
                log(blocked ? 'locked' : 'free');
                return { reset: () => {} };
            },
            reset: () => {},
        }),
        getSkillManager: () => ({ stopSkillable: () => {} }),
        getPacketSender: () => ({
            sendInterfaceRemoval: () => {},
            sendVarbit: (id, value) => log(`varbit ${id}=${value}`),
        }),
        getCombat: () => ({ reset: () => {} }),
        getClickDelay: () => ({ reset: () => {} }),
        performAnimation: (animation) => log(`anim ${animation.getId()}${animation.getDelay() ? ` delay ${animation.getDelay()}` : ''}`),
        performGraphic: (graphic) => graphic && log(`spotanim ${graphic.getId()}`),
        setUntargetable: () => {},
        setTeleporting: () => {},
        moveTo: (location) => log(`teleport ${location.getX()},${location.getY()}`),
    };
    return { player, ticks, log, nextTick: () => ticks.push([]) };
}

test('a teleport tablet plays out as in the OSRS capture, tick by tick', (t) => {
    const sendSound = Sounds.sendSound;
    Sounds.sendSound = (_player, sound) => log(`sound ${sound.getId()} delay ${sound.getDelay()}`);
    t.after(() => { Sounds.sendSound = sendSound; });
    const { player, ticks, log, nextTick } = recordingPlayer();

    // The click is handled between ticks; its sends go out with tick 0.
    TeleportHandler.teleport(player, new Location(3213, 3424, 0), TeleportType.TELE_TAB, false,
        () => log('arrived'), () => log('tablet used'));
    for (let tick = 0; tick < 7; tick++) {
        TaskManager.process();
        nextTick();
    }

    assert.deepEqual(ticks.slice(0, 6), [
        ['locked', 'anim 4069 delay 16', 'sound 965 delay 15', 'varbit 12393=1'],
        [],
        ['anim 4071', 'spotanim 678', 'tablet used'],
        [],
        ['anim 65535', 'varbit 12393=0', 'teleport 3213,3424', 'free', 'arrived'],
        ['anim 65535'],
    ]);
    assert.deepEqual(ticks.slice(6).flat(), [], 'nothing after');
});

test('every teleport frees the player on the tick they land, not two ticks later', (t) => {
    const sendSound = Sounds.sendSound;
    Sounds.sendSound = () => {};
    t.after(() => { Sounds.sendSound = sendSound; });
    const { player, ticks, nextTick } = recordingPlayer();
    TeleportHandler.teleport(player, new Location(3213, 3424, 0), TeleportType.NORMAL, false);
    for (let tick = 0; tick < 6; tick++) {
        TaskManager.process();
        nextTick();
    }
    const landed = ticks.findIndex((sent) => sent.some((entry) => entry.startsWith('teleport')));
    assert.ok(landed > 0);
    assert.ok(ticks[landed].includes('free'), 'free on the landing tick');
    assert.deepEqual(ticks.slice(landed + 1).flat(), [], 'and nothing holds them after');
});
