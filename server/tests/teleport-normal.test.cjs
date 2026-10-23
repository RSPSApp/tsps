// Run after `yarn build`: node --test tests/teleport-normal.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { Location } = require('../dist/game/model/Location');
const { Sounds } = require('../dist/game/Sounds');
const { GraphicHeight } = require('../dist/game/model/GraphicHeight');
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

test('the standard teleport plays out as in the OSRS captures, tick by tick', (t) => {
    const sendSound = Sounds.sendSound;
    Sounds.sendSound = (_player, sound) => log(`sound ${sound.getId()} delay ${sound.getDelay()}`);
    t.after(() => { Sounds.sendSound = sendSound; });
    const { player, ticks, log, nextTick } = recordingPlayer();

    // World.process runs the task pass before packets, so the click is handled after tick 0's
    // task pass: its sends go out with tick 0, and the task's next step runs on tick 1.
    TeleportHandler.teleport(player, new Location(3213, 3424, 0), TeleportType.NORMAL, false,
        () => log('arrived'));
    nextTick();
    for (let tick = 0; tick < 6; tick++) {
        TaskManager.process();
        nextTick();
    }

    // Varrock Teleport and necklace of passage captures (docs/teleport-tablets.md).
    assert.deepEqual(ticks.slice(0, 5), [
        ['locked', 'anim 714', 'spotanim 111', 'sound 200 delay 0', 'varbit 12393=1'],
        [],
        [],
        ['anim 65535', 'varbit 12393=0', 'teleport 3213,3424', 'free', 'arrived'],
        ['anim 65535'],
    ]);
    assert.deepEqual(ticks.slice(5).flat(), [], 'nothing after');
});

test('NORMAL casts teleport_casting at height 92 with the arms, and nothing mid-teleport', () => {
    assert.equal(TeleportType.NORMAL.getStartTick(), 3, 'arrival step lands on tick 3');
    const casting = TeleportType.NORMAL.getStartGraphic();
    assert.equal(casting.getId(), 111, 'teleport_casting, whose own sequence leads in before the bubble');
    assert.equal(casting.getDelay(), 0);
    assert.equal(casting.getHeight(), 92);
    assert.equal(TeleportType.NORMAL.getMiddleGraphic(), null, 'no middle graphic');
    assert.equal(TeleportType.NORMAL.getEndGraphic(), null, 'no landing burst');
});
