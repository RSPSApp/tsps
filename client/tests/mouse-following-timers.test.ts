import assert from "node:assert/strict";

import { WidgetTransmitProcessor } from "../game/widgets/WidgetTransmitProcessor";

// The enhanced client's cursor mouseover box is rebuilt at the mouse by a timer script (4725).
// Timers run on the 20ms client tick, so between ticks the box trailed the pointer. It is now
// also re-run on each frame the mouse moved; other timers stay on the tick.
const ROOT = 161;
const mouseBox: any = { uid: (ROOT << 16) | 1, groupId: ROOT, onTimer: [4725] };
const otherTimer: any = { uid: (ROOT << 16) | 2, groupId: ROOT, onTimer: [40, 7] };

const queued: number[] = [];
const ranNow: number[] = [];
const processor = new WidgetTransmitProcessor({
    getWidgetManager: () =>
        ({
            rootInterface: ROOT,
            interfaceParents: new Map(),
            getAllGroupRoots: () => [mouseBox, otherTimer],
            getStaticChildrenByParentUid: () => [],
            isEffectivelyHidden: () => false,
        }) as any,
    getTransmitCycles: () => ({}) as any,
    getCs2Vm: () =>
        ({
            runScriptEvent: (event: any) => {
                ranNow.push(event.args[0]);
                return true;
            },
        }) as any,
    queueScriptEvent: (event) => queued.push(event.args[0] as number),
    executeScriptListener: () => undefined,
});

// Before any client tick the processor knows no mouse-following widget.
processor.runMouseFollowingTimers(10, 10);
assert.deepEqual(ranNow, [], "nothing re-runs before a timer pass found the box");

processor.processWidgetTimers();
assert.deepEqual(queued.sort(), [40, 4725], "the tick still queues every timer");

processor.runMouseFollowingTimers(10, 10);
assert.deepEqual(ranNow, [4725], "the first frame after a tick re-runs the mouse box timer only");

processor.runMouseFollowingTimers(10, 10);
assert.deepEqual(ranNow, [4725], "a frame without mouse movement doesn't re-run it");

processor.runMouseFollowingTimers(12, 10);
assert.deepEqual(ranNow, [4725, 4725], "a frame after the mouse moved re-runs it");

mouseBox.hidden = true;
processor.runMouseFollowingTimers(14, 10);
assert.deepEqual(ranNow, [4725, 4725], "a hidden box isn't rebuilt");
mouseBox.hidden = false;

// The script replaced the timer (if_setontimer to something else): the frame must not run it.
mouseBox.onTimer = [40];
processor.runMouseFollowingTimers(16, 10);
assert.deepEqual(ranNow, [4725, 4725], "a widget whose timer changed isn't re-run");

console.log("mouse-following timers: ok");
