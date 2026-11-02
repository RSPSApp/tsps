import { strict as assert } from "node:assert";

import { setClientCycleProvider } from "../network/ServerConnection";
import { ProjectileManager } from "../render/projectiles/ProjectileManager";
import type { ProjectileLaunch } from "../common/projectiles/ProjectileLaunch";

/**
 * Projectiles fly on the client clock (issue 1862):
 * - a slow frame (a new area's maps loading) makes it catch up many cycles at once, and the
 *   projectile must still be where its flight puts it, not behind by the cycles it skipped;
 * - a relog without a page load restarts it, and a projectile launched after that must fly,
 *   not hang over its caster until the new clock passes the old one.
 */

let now = 1000;
setClientCycleProvider(() => now);

// A wind strike from 8 tiles east of its target, launching after 51 cycles and landing at 126.
const launch: ProjectileLaunch = {
    projectileId: 91,
    source: { tileX: 3230, tileY: 3368, plane: 0 },
    target: { tileX: 3222, tileY: 3368, plane: 0 },
    sourceHeight: 172,
    endHeight: 124,
    slope: 16,
    startPos: 64,
    startCycleOffset: 51,
    endCycleOffset: 126,
};

type Sample = { x: number; z: number } | null;

/**
 * Launches one projectile at `base` and renders a frame every half cycle, except one long frame
 * of `hitchCycles` at `hitchAt`; returns where it is (null once removed) at each `sampleAt`.
 */
function fly(
    manager: ProjectileManager,
    base: number,
    hitchAt: number,
    hitchCycles: number,
    sampleAt: number[],
): Map<number, Sample> {
    now = base;
    manager.update();
    const id = manager.launch(launch);
    const projectile = (manager as any).projectiles.get(id);
    const samples = new Map<number, Sample>();
    while (now < base + 140) {
        now += now - base === hitchAt ? hitchCycles : 0.5;
        manager.update();
        for (const at of sampleAt) {
            if (!samples.has(at) && now - base >= at) {
                const pos = projectile.getPosition();
                samples.set(at, (manager as any).projectiles.has(id) ? { x: pos.x, z: pos.z } : null);
            }
        }
    }
    return samples;
}

function assertSame(actual: Sample | undefined, expected: Sample | undefined, label: string): void {
    assert.ok(expected, `${label}: the smooth flight is in the air`);
    assert.ok(actual, `${label}: it is still in the air`);
    assert.ok(
        Math.abs(actual.x - expected.x) < 2 && Math.abs(actual.z - expected.z) < 2,
        `${label}: it is at x=${actual.x.toFixed(1)} z=${actual.z.toFixed(1)}, ` +
            `not x=${expected.x.toFixed(1)} z=${expected.z.toFixed(1)}`,
    );
}

// 126 is its end cycle: it is still in the air there, a cycle short of its target.
const sampleAt = [60, 100, 120, 126];
const smooth = fly(new ProjectileManager({} as any), 1000, -1, 0, sampleAt);

function slowFrameKeepsItOnItsFlight(): void {
    for (const [hitchAt, hitchCycles] of [
        [70, 30],
        [20, 45],
        [5, 50],
    ]) {
        const hitched = fly(new ProjectileManager({} as any), 1000, hitchAt, hitchCycles, sampleAt);
        for (const at of sampleAt) {
            if (at < hitchAt + hitchCycles) continue;
            assertSame(hitched.get(at), smooth.get(at), `a ${hitchCycles}-cycle frame at ${hitchAt}, cycle ${at}`);
        }
    }
}

function restartedClockStillFlies(): void {
    // The manager last ran at cycle 36617; the relog restarted the clock at 1000.
    const manager = new ProjectileManager({} as any);
    now = 36617;
    manager.update();
    now += 1;
    manager.update();
    const restarted = fly(manager, 1000, -1, 0, sampleAt);
    for (const at of sampleAt) {
        assertSame(restarted.get(at), smooth.get(at), `after a clock restart, cycle ${at}`);
    }
}

slowFrameKeepsItOnItsFlight();
restartedClockStillFlies();
setClientCycleProvider(undefined);
console.log("Projectile clock tests passed");
