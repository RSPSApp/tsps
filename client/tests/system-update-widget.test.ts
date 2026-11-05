import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { getTransmitCycles } from "../game/TransmitCycles";
import { initSocketCloseHandler } from "../network/serverConnection/connection/closeHandler";
import { handleInboundUi } from "../network/serverConnection/handlers/inboundUi";
import { state } from "../network/serverConnection/state";
import { getRebootTimer } from "../network/serverConnection/timing";
import { Opcodes } from "../rs/cs2/Opcodes";
import { createHandlerMap } from "../rs/cs2/handlers";
import { createCacheVm } from "../scripts/cache/cs2-sweep";

const realNow = Date.now;
let now = 1_000_000;
Date.now = () => now;
try {
    const receive = (remainingCentis: unknown) => {
        assert.equal(handleInboundUi({ type: "system_update", payload: { remainingCentis } }), true);
    };
    const cycles = getTransmitCycles();
    cycles.cycleCntr = 100;
    receive(6000);
    assert.ok(cycles.miscCycle >= 100, "SYSTEM_UPDATE wakes the native onMiscTransmit handler");
    assert.equal(getRebootTimer(), 3000, "60 seconds is 3000 OSRS 20ms client cycles");
    const ints: number[] = [];
    createHandlerMap().get(Opcodes.REBOOTTIMER)!({ pushInt: (n: number) => ints.push(n) } as any, 0);
    assert.deepEqual(ints, [3000], "CS2 reads the real timer rather than the inactive stub");
    now += 1020;
    assert.equal(getRebootTimer(), 2949, "counts down between server packets");
    now += 60_000;
    assert.equal(getRebootTimer(), 0, "expired timers stop at zero");
    for (const value of [0, -1, NaN, Infinity, undefined]) {
        receive(value);
        assert.equal(getRebootTimer(), 0, "cancelled and invalid countdowns are inactive");
    }

    if (existsSync(resolve(__dirname, "../../server/caches/caches.json"))) {
        const { scripts, vm } = createCacheVm();
        const wm = vm.context.widgetManager;
        for (const group of [162, 163]) {
            wm.getGroup(group);
            const root = wm.getAllGroupRoots(group)[0];
            root.width = 512;
            root.height = 334;
            vm.execute(scripts.load(group === 162 ? 925 : 926));
        }
        const chat = wm.getAllGroupRoots(162)[0];
        const splitChat = wm.getAllGroupRoots(163)[0];
        const rebuild = () => {
            cycles.cycleCntr += 25;
            const handler = chat.eventHandlers.onMiscTransmit;
            vm.execute(scripts.load(handler.scriptId), handler.intArgs);
        };
        const visibleLabels = () => splitChat.children.filter((w: any) => w && !w.hidden && w.text);
        receive(6000);
        rebuild();
        const [label] = visibleLabels();
        assert.equal(visibleLabels().length, 1, "only the native widget displays the countdown");
        assert.equal(label.text, "System update in: 1:00");
        assert.equal(label.fontId, 495, "uses the cache's OSRS font");
        assert.equal(label.textColor, 0xffff00);
        assert.equal(chat.eventHandlers.onTimer.scriptId, 664, "the native script maintains its own refresh timer");
        now += 1000;
        cycles.cycleCntr += 25;
        vm.execute(scripts.load(664), [0]);
        assert.equal(visibleLabels()[0].text, "System update in: 0:59");
        receive(0);
        rebuild();
        assert.equal(visibleLabels().length, 0, "cancelling clears the native label");
        receive(100);
        rebuild();
        now += 1000;
        rebuild();
        assert.equal(visibleLabels().length, 0, "expiry clears the native label");
    } else {
        console.log("Cache widget checks skipped: no server cache");
    }

    receive(6000);
    let close!: (event: unknown) => void;
    const socket = { addEventListener: (_: string, listener: typeof close) => { close = listener; } };
    state.socket = socket as any;
    state.sessionUsername = state.sessionPassword = null;
    initSocketCloseHandler(socket as any, () => assert.fail("must not reconnect without a session"));
    close({ code: 1000, wasClean: true, reason: "logout" });
    assert.equal(getRebootTimer(), 0, "disconnect clears the timer before another world can open");
} finally {
    Date.now = realNow;
    state.lastSystemUpdate = undefined;
}
console.log("Native system update widget tests passed");
