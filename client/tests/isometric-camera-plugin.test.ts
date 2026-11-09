import assert from "node:assert/strict";

import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { Camera, ProjectionType } from "../game/Camera";
import type { CameraRotation } from "../game/plugins/ClientPluginManager";
import { IsometricCameraPlugin } from "../game/plugins/isometric/IsometricCameraPlugin";
import { IsometricConfig } from "../game/plugins/isometric/IsometricConfig";
import { SCROLL_WHEEL_ZOOM_EVENT } from "../rs/cs2/zoomCallbacks";

const configManager = inject(ConfigManager);
const camera = new Camera(3200, -5, 3200, 0, 0);
camera.viewportWidth = 765;
camera.viewportHeight = 503;
camera.viewportZoom = 512;
const client = {
    camera,
    followPlayerCamera: true,
    renderDistance: 25,
    clientPlugins: {} as { gpuSettings?: () => { drawDistance: number } },
    isLoggedIn: () => true,
    inputManager: { mouseWheelDown: false },
};
const plugin = new IsometricCameraPlugin(client as any);

async function main(): Promise<void> {
    // The defaults: true isometric (orthographic at 35 degrees), framed at 20 tiles.
    const defaults = configManager.getConfig(IsometricConfig);
    assert.deepEqual(
        [defaults.pitch(), defaults.rotateKeys()],
        [35, true],
    );
    const follow = () => plugin.handleCameraFollow({ camera, playerX: 3200.5, playerY: -1, playerZ: 3200.5 });
    const frame = () => {
        const rotation: CameraRotation = { camera, deltaTime: 16, keyYaw: 5, keyPitch: 5, dragYaw: 5, dragPitch: 5 };
        plugin.transformCameraRotation(rotation);
        return rotation;
    };

    // --- Plugin off (never enabled): every hook leaves the game exactly as it is ---------------
    const untouchedFov = { ...camera.getViewportFovScale() };
    assert.equal(follow(), false, "the follow camera stays the game's");
    assert.deepEqual(
        [frame().keyYaw, frame().dragYaw, frame().keyPitch, frame().dragPitch],
        [5, 5, 5, 5],
        "rotation passes through",
    );
    assert.equal(plugin.handleCameraKeys({ camera, input: { isKeyDownEvent: () => true } as any, deltaTime: 16 }), false);
    assert.equal(plugin.handleCameraMouse(), false);
    const idlePad = { buttons: Array.from({ length: 17 }, () => ({ pressed: true, value: 1 })), axes: [0, 0, 1, 0] };
    assert.equal(plugin.handleGamepad({ gamepad: idlePad as any, camera, input: {} as any, deltaTime: 16 }), false);
    assert.equal(plugin.roofCameraTile({ x: 1, y: 2 }, { x: 3, y: 4 }), undefined, "roof hiding uses the game's own tile");
    const offWheel = { intStack: [0, 0], intStackSize: 2 } as any;
    plugin.onScriptCallback({ eventName: SCROLL_WHEEL_ZOOM_EVENT, vm: offWheel });
    assert.equal(offWheel.intStack[1], 0, "the wheel isn't touched");
    assert.equal(camera.projectionType, ProjectionType.PERSPECTIVE);
    assert.equal(camera.getViewPitchOverride(), undefined);
    assert.deepEqual(camera.getViewportFovScale(), untouchedFov);

    await plugin.start();

    // --- Driving: orthographic, the fixed angle, no free rotation ------------------------------
    assert.equal(follow(), true);
    assert.equal(camera.projectionType, ProjectionType.ORTHO);
    assert.ok(camera.getViewPitchOverride() !== undefined);
    const turned = frame();
    assert.deepEqual([turned.keyYaw, turned.dragYaw, turned.keyPitch, turned.dragPitch], [0, 0, 0, 0]);

    const roofA = plugin.roofCameraTile({ x: 0, y: 0 }, { x: 3200, y: 3200 })!;
    assert.ok(roofA && Math.max(Math.abs(roofA.x - 3200), Math.abs(roofA.y - 3200)) <= 8, "the roof line stays short");
    assert.equal(plugin.roofCameraTile({ x: 0, y: 0 }, { x: 3200, y: 3200 }), roofA, "and allocates nothing per frame");

    // --- Quarter turns: arrow keys, a sideways drag (middle mouse / touch), controller ----------
    const target = () => (plugin as any).targetYaw as number;
    const start = target();
    const key = (code: string) => ({ isKeyDownEvent: (k: string) => k === code }) as any;
    plugin.handleCameraKeys({ camera, input: key("ArrowLeft"), deltaTime: 16 });
    assert.equal(target(), start + 512, "left arrow: a quarter turn");
    plugin.handleCameraKeys({ camera, input: key("ArrowRight"), deltaTime: 16 });
    assert.equal(target(), start);

    const drag = (dragYaw: number) =>
        plugin.transformCameraRotation({ camera, deltaTime: 16, keyYaw: 0, keyPitch: 0, dragYaw, dragPitch: 0 });
    client.inputManager.mouseWheelDown = true; // a one-finger touch drag holds the virtual middle button
    drag(-100);
    assert.equal(target(), start, "a short drag doesn't turn");
    drag(-100);
    assert.equal(target(), start - 512, "dragging on turns the way the right arrow does");
    drag(-100);
    assert.equal(target(), start - 512, "one turn per stretch of drag");
    client.inputManager.mouseWheelDown = false;
    drag(0);
    client.inputManager.mouseWheelDown = true;
    drag(150);
    client.inputManager.mouseWheelDown = false;
    drag(0);
    assert.equal(target(), start - 512, "the leftover travel is dropped when the drag ends");
    client.inputManager.mouseWheelDown = true;
    drag(170);
    client.inputManager.mouseWheelDown = false;
    drag(0);
    assert.equal(target(), start, "a long drag the other way turns back");

    const pad = (buttons: number[], axes = [0, 0, 0, 0]) => ({
        gamepad: {
            buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: buttons.includes(index), value: 0 })),
            axes,
        } as any,
        camera,
        input: {} as any,
        deltaTime: 16,
    });
    assert.equal(plugin.handleGamepad(pad([4])), true, "the bumpers belong to this camera");
    assert.equal(target(), start + 512, "LB turns like the left arrow");
    plugin.handleGamepad(pad([4]));
    assert.equal(target(), start + 512, "held, it turns once");
    plugin.handleGamepad(pad([]));
    plugin.handleGamepad(pad([5]));
    assert.equal(target(), start, "RB turns back");
    plugin.handleGamepad(pad([]));
    plugin.handleGamepad(pad([], [0, 0, 0.9, 0]));
    plugin.handleGamepad(pad([], [0, 0, 0.4, 0]));
    plugin.handleGamepad(pad([], [0, 0, 0.9, 0]));
    assert.equal(target(), start - 512, "a right-stick flick turns once, until the stick comes back");
    plugin.handleGamepad(pad([], [0, 0, 0, 0]));
    plugin.handleGamepad(pad([], [0, 0, -0.9, 0]));
    assert.equal(target(), start);
    assert.equal(plugin.handleGamepad(pad([0])), false, "other buttons go to controller play");
    assert.equal(plugin.handleGamepad(pad([], [0.5, 0, 0, 0])), false, "so does the left stick");
    assert.equal(plugin.handleGamepad(pad([])), true, "an idle controller stays here");
    configManager.setConfiguration("isometriccamera", "rotateKeys", false);
    plugin.onConfigChanged({ getGroup: () => "isometriccamera" } as any);
    assert.equal(plugin.handleGamepad(pad([4])), false, "quarter turns off: the controller isn't taken");
    client.inputManager.mouseWheelDown = true;
    drag(-400);
    client.inputManager.mouseWheelDown = false;
    drag(0);
    assert.equal(target(), start, "nor does a drag turn");
    configManager.setConfiguration("isometriccamera", "rotateKeys", true);
    plugin.onConfigChanged({ getGroup: () => "isometriccamera" } as any);

    // --- A cutscene takes the camera: the next frame is normal rendering, without the follow call -
    client.followPlayerCamera = false;
    const untouched = frame();
    assert.equal(untouched.dragYaw, 5, "the cutscene's own rotation passes through");
    assert.equal(camera.projectionType, ProjectionType.PERSPECTIVE, "cutscenes render in perspective");
    assert.equal(camera.getViewPitchOverride(), undefined);

    // The cutscene ends (cam_reset): the plugin takes over again.
    client.followPlayerCamera = true;
    assert.equal(follow(), true);
    assert.equal(camera.projectionType, ProjectionType.ORTHO);

    // --- A scripted shot that set its own pitch first keeps it -------------------------------
    client.followPlayerCamera = false;
    camera.setViewPitchOverride(77);
    frame();
    assert.equal(camera.getViewPitchOverride(), 77, "only the plugin's own pitch is undone");
    assert.equal(camera.projectionType, ProjectionType.PERSPECTIVE);
    camera.setViewPitchOverride(undefined);
    client.followPlayerCamera = true;

    // --- Orthographic never zooms out past the render distance -------------------------------
    camera.viewportZoom = 40; // far past the stock limits (Camera plugin's outer limit)
    follow();
    const pitch = (configManager.getConfiguration("isometriccamera", "pitch") as unknown as number ?? 35);
    const sinPitch = Math.sin((Number(pitch) || 35) * Math.PI / 180);
    const cornerTiles = Math.hypot(camera.viewportWidth, camera.viewportHeight / sinPitch) / camera.orthoZoom;
    assert.ok(cornerTiles <= client.renderDistance, `screen corner reaches ${cornerTiles.toFixed(1)} tiles`);
    // At 35 degrees the stock 25-tile render distance limits even normal zoom; a long one doesn't.
    client.clientPlugins = { gpuSettings: () => ({ drawDistance: 90 }) };
    camera.viewportZoom = 512;
    follow();
    assert.ok(Math.abs(camera.orthoZoom / ((2 * 512) / 20) - 1) < 0.05, "normal zoom keeps the framed scale (long draw distance)");
    // Low-end Device mode (phones) draws only 12 tiles out: the view stays inside that too.
    client.clientPlugins = { gpuSettings: () => ({ drawDistance: 12 }) };
    follow();
    const lowEndCorner = Math.hypot(camera.viewportWidth, camera.viewportHeight / sinPitch) / camera.orthoZoom;
    assert.ok(lowEndCorner <= 12 - 3 + 1e-6, `low-end corner reaches ${lowEndCorner.toFixed(1)} tiles`);
    // Every step of the game's zoom still changes the view there, even right against the limit.
    let previous = 0;
    for (const zoom of [40, 200, 477, 800, 1200, 2000, 3000, 3819]) {
        camera.viewportZoom = zoom;
        follow();
        assert.ok(camera.orthoZoom > previous * 1.01, `zoom ${zoom} changes the view (${camera.orthoZoom.toFixed(1)})`);
        previous = camera.orthoZoom;
    }
    assert.ok(Math.abs(camera.orthoZoom / ((2 * 3819) / 20) - 1) < 0.1, "zoomed right in, it is the plain framed scale");
    camera.viewportZoom = 512;
    client.clientPlugins = {};

    // --- A scripted shot gets the classic FOV, locked; the player's zoom comes back after ------
    const classic = new Camera(0, 0, 0, 0, 0).getViewportFovScale();
    camera.setViewportFovValues(700, 650); // the player zoomed in
    const playerFov = camera.getViewportFovScale();
    follow(); // a frame at that zoom
    client.followPlayerCamera = false;
    camera.setScriptedLook(3205.5, -1, 3205.5, 0, 100, () => undefined);
    const shot = frame();
    assert.deepEqual([shot.keyYaw, shot.dragYaw, shot.keyPitch, shot.dragPitch], [0, 0, 0, 0], "no turning");
    assert.deepEqual(camera.getViewportFovScale(), classic, "the shot plays at the classic FOV");
    assert.equal(plugin.handleCameraMouse(), true, "no free-camera mouse look");
    assert.equal(plugin.handleCameraKeys({ camera, input: { isKeyDownEvent: () => true } as any, deltaTime: 16 }), true);
    const wheel = { intStack: [0, 0], intStackSize: 2 } as any;
    plugin.onScriptCallback({ eventName: "scroll_wheel_zoom", vm: wheel });
    plugin.onScriptCallback({ eventName: SCROLL_WHEEL_ZOOM_EVENT, vm: wheel });
    assert.equal(wheel.intStack[1], 1, "the wheel's zoom is skipped");
    frame();
    assert.deepEqual(camera.getViewportFovScale(), classic, "locked across frames");
    // cam_reset
    camera.clearScriptedCamera();
    client.followPlayerCamera = true;
    frame();
    assert.deepEqual(camera.getViewportFovScale(), playerFov, "the player's zoom is back");
    assert.equal(plugin.handleCameraMouse(), false);
    const after = { intStack: [0, 0], intStackSize: 2 } as any;
    plugin.onScriptCallback({ eventName: SCROLL_WHEEL_ZOOM_EVENT, vm: after });
    assert.equal(after.intStack[1], 0, "the wheel zooms again");

    // A shot whose script zooms in the same tick it starts (a signpost) keeps the script's zoom;
    // the player's own zoom still comes back after.
    follow(); // a driving frame at the player's zoom
    client.followPlayerCamera = false;
    camera.setViewportFovScale(512, 512); // the shot's script
    camera.setScriptedLook(3205.5, -1, 3205.5, 0, 100, () => undefined);
    frame();
    assert.deepEqual(camera.getViewportFovScale(), { low: 512, high: 512 }, "the script's zoom is kept");
    camera.clearScriptedCamera();
    client.followPlayerCamera = true;
    frame();
    assert.deepEqual(camera.getViewportFovScale(), playerFov, "and the player's zoom is back after");

    // Edit mode's free camera (follow off, no shot) isn't locked.
    client.followPlayerCamera = false;
    frame();
    assert.equal(plugin.handleCameraMouse(), false, "edit mode keeps its free camera");
    client.followPlayerCamera = true;

    // --- Logging out hands the camera back to the login screen --------------------------------
    follow();
    assert.equal(camera.projectionType, ProjectionType.ORTHO);
    client.isLoggedIn = () => false;
    plugin.onGameStateChanged({} as any);
    assert.equal(camera.projectionType, ProjectionType.PERSPECTIVE, "the login screen is in perspective");
    assert.equal(camera.getViewPitchOverride(), undefined);
    client.isLoggedIn = () => true;
    assert.equal(follow(), true, "and it drives again after logging in");
    assert.equal(camera.projectionType, ProjectionType.ORTHO);

    // --- Turning the plugin off hands the camera back ----------------------------------------
    await plugin.stop();
    assert.equal(camera.projectionType, ProjectionType.PERSPECTIVE);
    assert.equal(camera.getViewPitchOverride(), undefined);

    console.log("isometric camera plugin: ok");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
