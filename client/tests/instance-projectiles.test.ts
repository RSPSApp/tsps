import { strict as assert } from "node:assert";

import { ProjectileManager } from "../render/projectiles/ProjectileManager";

/**
 * An instance scene is drawn as one map square, so it must draw every projectile in the scene:
 * the Gauntlet's arena lies in another 64x64 square than the one the scene is often built as,
 * and its projectiles went missing once the scene re-centred.
 */
function instanceSceneDrawsEveryProjectile(): void {
    const renderer: any = { instanceActive: true, instanceSceneMap: { mapX: 128, mapY: 25 } };
    const manager = new ProjectileManager(renderer);
    const projectile = { startCycle: -1, getPosition: () => ({ x: (129 * 64 + 10) * 128, y: (25 * 64 + 5) * 128 }) };
    (manager as any).projectiles.set(1, projectile);
    (manager as any).simCycle = 0;
    assert.deepEqual(manager.getProjectilesForMap(128, 25), [projectile], "the instance scene's map draws it");
    assert.deepEqual(manager.getProjectilesForMap(129, 25), [], "not the square it happens to be in");

    renderer.instanceActive = false;
    assert.deepEqual(manager.getProjectilesForMap(129, 25), [projectile], "outside an instance: its own square");
}

instanceSceneDrawsEveryProjectile();
console.log("Instance projectile tests passed");
