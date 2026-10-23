import assert from "node:assert/strict";

import type { LoginRendererHost } from "../game/login/renderer/host";
import { getLogicalFirePositions, getTitleArtScene, getTitleBackgroundLayout } from "../game/login/renderer/layout/geometry";

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

// A viewport with the 765x503 scene centred in it at `sceneScale`, as the login layout puts it.
const host = (art: { w: number; h: number; cache: boolean }, w: number, h: number, sceneScale = 1) =>
    ({
        containerX: 0,
        containerWidth: w,
        containerHeight: h,
        contentOriginX: Math.floor((w - 765 * sceneScale) / 2),
        contentOriginY: Math.floor((h - 503 * sceneScale) / 2),
        contentScale: sceneScale,
        SCENE_WIDTH: 765,
        SCENE_HEIGHT: 503,
        titleBackgroundImage: { width: art.w, height: art.h },
        titleBackgroundFromCache: art.cache,
    }) as unknown as LoginRendererHost;

const TITLEWIDE = { w: 1089, h: 671, cache: true }; // titlewide.png and its mirror
const TITLE = { w: 765, h: 503, cache: true }; // title.jpg and its mirror
const BUNDLED = { w: 1089, h: 503, cache: false }; // public/images/loading-bg.jpg

// Large viewports: the cache's art is centred on the scene, whole, up to twice the scene's scale,
// and the flames stay on it.
for (const art of [TITLEWIDE, TITLE]) {
    for (const [w, h, sceneScale] of [[1920, 1080, 1], [2000, 1148, 1], [1200, 760, 1], [3840, 2160, 1.5]]) {
        const view = host(art, w, h, sceneScale);
        const bg = getTitleBackgroundLayout(view);
        const label = `${art.w}x${art.h} in ${w}x${h} at ${sceneScale}`;
        assert.ok(close(bg.drawX + bg.drawW / 2, view.contentOriginX + (765 * sceneScale) / 2), `${label}: centred`);
        assert.ok(bg.scale >= sceneScale && bg.scale <= sceneScale * 2, `${label}: between 1x and 2x the scene`);
        assert.ok(bg.drawX >= -1e-9 && bg.drawY >= -1e-9 && bg.drawX + bg.drawW <= w + 1e-9 && bg.drawY + bg.drawH <= h + 1e-9, `${label}: whole`);
        const fire = getLogicalFirePositions(view);
        const crop = (art.w - 765) / 2;
        assert.ok(close(fire.scale, bg.scale), `${label}: flames scale with the art`);
        assert.ok(close(fire.leftX, bg.drawX + (crop - 22) * bg.scale), `${label}: left flame on the art`);
        assert.ok(close(fire.rightX, bg.drawX + (crop + 659) * bg.scale), `${label}: right flame on the art`);
        assert.ok(close(fire.y, bg.drawY), `${label}: flames at the art's top`);
        const scene = getTitleArtScene(view);
        assert.ok(close(scene.scale, bg.scale) && close(scene.x, bg.drawX + crop * bg.scale), `${label}: the logo grows with the art`);
    }
}

// The wide art keeps the flames inside it, where title.jpg's edges cut them off.
const wide = getTitleBackgroundLayout(host(TITLEWIDE, 1920, 1080));
const wideFire = getLogicalFirePositions(host(TITLEWIDE, 1920, 1080));
assert.ok(wideFire.leftX >= wide.drawX && wideFire.rightX + 128 * wideFire.scale <= wide.drawX + wide.drawW, "flames inside titlewide");

// A viewport too small for the art whole: its classic part lies under the scene, flames at -22 and 659.
for (const art of [TITLEWIDE, TITLE, BUNDLED]) {
    const fire = getLogicalFirePositions(host(art, 765, 503));
    assert.equal(fire.leftX, -22, `${art.w}x${art.h}: left flame`);
    assert.equal(fire.rightX, 659, `${art.w}x${art.h}: right flame`);
    assert.equal(fire.y, 0, `${art.w}x${art.h}: flames at the scene's top`);
    assert.equal(fire.scale, 1, `${art.w}x${art.h}: flames drawn 1:1`);
    const scene = getTitleArtScene(host(art, 765, 503));
    assert.deepEqual([scene.x, scene.y, scene.scale], [0, 0, 1], `${art.w}x${art.h}: the logo stays on the scene`);
}

console.log("login-title-fire: ok");
