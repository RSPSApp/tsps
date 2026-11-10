import { ConfigChanged, GameStateChanged } from "@runelite/api/events";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { PluginManager } from "@runelite/client/plugins/PluginManager";
import { RS_TO_RADIANS } from "../../../rs/MathConstants";
import { Camera, ProjectionType } from "../../Camera";
import type { OsrsClient } from "../../OsrsClient";
import type {
    CameraFollowContext,
    CameraInputContext,
    CameraRotation,
    ClientPlugin,
    GamepadContext,
    ScriptCallbackEvent,
} from "../ClientPluginManager";
import { SCROLL_WHEEL_ZOOM_EVENT } from "../../../rs/cs2/zoomCallbacks";
import { FirstPersonPlugin } from "../firstperson/FirstPersonPlugin";
import { IsometricConfig } from "./IsometricConfig";

/** RS angle units: 2048 per turn. */
const QUARTER_TURN = 512;
/** A diagonal view, so the tile grid reads as diamonds, as in isometric games. */
const DIAGONAL_YAW = 256;
const DEGREES_TO_RS = 2048 / 360;
/** The camera aims at the player's chest, not their feet (tiles above the ground). */
const FOCUS_HEIGHT = 0.6;
/**
 * How far the camera sits from the player, in tiles: the framing at the game's default zoom.
 * The game's own zoom scales the view from there.
 */
const FRAMING = 20;
/** How quickly the camera catches up with the player (per second): a slight, soft trail. */
const FOLLOW_RATE = 16;
/** Further than this in one frame is a teleport: jump instead of gliding across the map. */
const SNAP_DISTANCE = 6;
/**
 * A sideways drag this far (RS angle units the drag would have turned the classic camera,
 * about 180 pixels) turns a quarter turn: middle mouse, or one finger on a touch screen.
 */
const DRAG_TURN = 160;
/** Controller (standard mapping): the bumpers, and how far a right-stick flick must go. */
const PAD_LB = 4;
const PAD_RB = 5;
const STICK_FLICK = 0.6;
const STICK_DEADZONE = 0.18;
/** How fast a quarter turn swings round (per second). */
const ROTATE_RATE = 9;
/** Roughly a one-storey building with its roof, in tiles: what can hide the player. */
const ROOF_OCCLUDER_HEIGHT = 4;
/** How far inside the draw distance (tiles) the view stops, clear of the fog's edge. */
const FOG_MARGIN = 3;
/**
 * How sharply the game's zoom eases into that limit: higher bends later and harder. At 2 the
 * whole zoom range still moves the view, even where the limit is close (phones).
 */
const ZOOM_LIMIT_EASE = 2;
/** The engine's default field of view (its own units, not script units), before any zoom. */
const CLASSIC_FOV = new Camera(0, 0, 0, 0, 0).getViewportFovScale();

/**
 * An action-RPG camera, framed like isometric games: a fixed, steep angle down at the player,
 * a diagonal view of the tile grid, and a true orthographic projection, so the world looks
 * flat rather than deep. The camera turns only a quarter turn at a time: arrow keys, a
 * sideways drag (middle mouse or touch), or a controller's bumpers and right stick. The
 * game's own scroll-wheel zoom still works: the projection scale follows it.
 */
export class IsometricCameraPlugin extends Plugin implements ClientPlugin {
    static descriptor: PluginDescriptor = {
        name: "Isometric Camera",
        description: "Fixed-angle action-RPG camera with an isometric look",
        tags: ["camera", "isometric", "orthographic", "arpg", "diablo", "path of exile"],
        enabledByDefault: false,
        configKey: "isometriccamera",
    };

    static config = IsometricConfig;

    private readonly configManager = inject(ConfigManager);
    private readonly client: OsrsClient;
    private readonly pluginManager?: PluginManager;

    private pitch = 35;
    private rotateKeys = true;

    /** The yaw the arrow keys picked, and the yaw the camera is at as it swings there. */
    private targetYaw = DIAGONAL_YAW;
    private yaw = DIAGONAL_YAW;
    private focus?: { x: number; y?: number; z: number };
    private lastFollowAt = 0;
    /** Whether this plugin drove the camera last frame, so it can hand it back once. */
    private driving = false;
    /** The view pitch this plugin last set, so handing back undoes only that. */
    private appliedPitch?: number;
    /** The player's FOV (engine units) while a scripted shot holds the classic one; set = locked. */
    private savedFov?: { low: number; high: number };
    /** The player's FOV on the last frame this plugin drove the camera (filled in place). */
    private readonly drivingFov = { low: 0, high: 0 };
    private hasDrivingFov = false;
    /** The tile roofCameraTile hands back, reused every frame. */
    private readonly roofTile = { x: 0, y: 0 };
    /** Sideways drag so far in this drag gesture, toward the next quarter turn. */
    private dragTravel = 0;
    /** Last frame's controller bumpers and right-stick flick, for edge detection. */
    private readonly padTurn = { left: false, right: false, flick: 0 };

    constructor(client?: OsrsClient) {
        super();
        this.client = client ?? inject<OsrsClient>(CLIENT_TOKEN);
        try {
            this.pluginManager = inject(PluginManager);
        } catch {
            // Built standalone (tests): no First Person to defer to.
        }
        this.readConfig();
    }

    protected override async startUp(): Promise<void> {
        this.readConfig();
        this.focus = undefined;
        this.hasDrivingFov = false;
        this.yaw = this.targetYaw = nearestDiagonal(this.client.camera.yaw);
    }

    protected override async shutDown(): Promise<void> {
        this.release(this.client.camera);
        this.unlockScriptedView(this.client.camera);
    }

    /** While a scripted shot holds the classic camera, the wheel doesn't zoom it. */
    onScriptCallback({ eventName, vm }: ScriptCallbackEvent): void {
        if (this.savedFov && eventName === SCROLL_WHEEL_ZOOM_EVENT) vm.intStack[vm.intStackSize - 1] = 1;
    }

    /** No free-camera mouse look while a scripted shot holds the camera. */
    handleCameraMouse(): boolean {
        return this.savedFov !== undefined;
    }

    /** Logged out (or hopping): the login screen gets the classic camera back. */
    onGameStateChanged(_event: GameStateChanged): void {
        if (this.client.isLoggedIn()) return;
        this.unlockScriptedView(this.client.camera);
        if (this.driving) this.release(this.client.camera);
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() !== IsometricConfig.group) return;
        this.readConfig();
        if (!this.rotateKeys) this.targetYaw = nearestDiagonal(this.targetYaw);
    }

    /** Arrow keys turn a quarter turn instead of tilting and spinning freely. */
    handleCameraKeys({ input }: CameraInputContext): boolean {
        if (this.savedFov) return true; // a scripted shot: the arrow keys don't turn it
        if (!this.isDriving()) return false;
        if (this.rotateKeys) {
            if (input.isKeyDownEvent("ArrowLeft")) this.targetYaw += QUARTER_TURN;
            if (input.isKeyDownEvent("ArrowRight")) this.targetYaw -= QUARTER_TURN;
        }
        return true;
    }

    /**
     * Drags turn this camera only in quarter turns, and the Camera plugin's easing doesn't.
     *
     * This runs every frame, even when the follow camera doesn't: a cutscene or scripted
     * shot (cam_moveto, cam_lookat, ...), edit mode and First Person take the camera without
     * asking this plugin, so this is where it hands the camera back to normal rendering.
     */
    transformCameraRotation(rotation: CameraRotation): void {
        const { camera } = rotation;
        if (this.isScriptedShot(camera)) {
            if (this.driving) this.release(camera);
            this.lockScriptedView(camera);
            rotation.keyYaw = rotation.keyPitch = rotation.dragYaw = rotation.dragPitch = 0;
            return;
        }
        this.unlockScriptedView(camera);
        if (!this.isDriving()) {
            if (this.driving) this.release(camera);
            return;
        }
        this.dragTurn(rotation.dragYaw);
        rotation.keyYaw = rotation.keyPitch = rotation.dragYaw = rotation.dragPitch = 0;
    }

    /**
     * A sideways middle-mouse or one-finger touch drag ratchets the view round a quarter turn
     * each time it travels far enough, the way the classic camera would have turned that way.
     */
    private dragTurn(dragYaw: number): void {
        if (!this.client.inputManager?.mouseWheelDown) {
            this.dragTravel = 0;
            return;
        }
        if (!this.rotateKeys) return;
        this.dragTravel += dragYaw;
        while (Math.abs(this.dragTravel) >= DRAG_TURN) {
            const direction = Math.sign(this.dragTravel);
            this.targetYaw += direction * QUARTER_TURN;
            this.dragTravel -= direction * DRAG_TURN;
        }
    }

    /**
     * On a controller the bumpers, or a sideways flick of the right stick, turn a quarter
     * turn. Only those: any other controller input still goes to controller play (First
     * Person), which then holds the camera until it's left.
     */
    handleGamepad({ gamepad }: GamepadContext): boolean {
        if (!this.isDriving() || !this.rotateKeys) return false;
        const { buttons, axes } = gamepad;
        let other = Math.abs(axes[0] ?? 0) > STICK_DEADZONE || Math.abs(axes[1] ?? 0) > STICK_DEADZONE;
        for (let index = 0; index < buttons.length && !other; index++) {
            if (buttons[index].pressed && index !== PAD_LB && index !== PAD_RB) other = true;
        }
        const left = buttons[PAD_LB]?.pressed === true;
        const right = buttons[PAD_RB]?.pressed === true;
        const stick = axes[2] ?? 0;
        let flick = stick <= -STICK_FLICK ? -1 : stick >= STICK_FLICK ? 1 : 0;
        const pad = this.padTurn;
        const wasLeft = pad.left;
        const wasRight = pad.right;
        const wasFlick = pad.flick;
        // The stick re-arms only once it is back near the centre.
        if (flick === 0 && Math.abs(stick) > STICK_DEADZONE) flick = wasFlick;
        pad.left = left;
        pad.right = right;
        pad.flick = flick;
        if (other) return false;
        if (left && !wasLeft) this.targetYaw += QUARTER_TURN;
        if (right && !wasRight) this.targetYaw -= QUARTER_TURN;
        // Stick right turns the way the right arrow does.
        if (flick !== 0 && wasFlick === 0) this.targetYaw -= flick * QUARTER_TURN;
        return true;
    }

    /**
     * A cutscene's shots are framed for the classic camera at its default field of view, so
     * while one holds the camera it gets exactly that: the player's zoom is put aside, and the
     * wheel, arrow keys and mouse can't change the view. Shots a script zooms itself still zoom,
     * including a zoom the script set in the same tick the shot began (signposts do).
     */
    private lockScriptedView(camera: Camera): void {
        if (this.savedFov) return;
        const current = camera.getViewportFovScale();
        const player = this.hasDrivingFov ? { ...this.drivingFov } : current;
        this.savedFov = player;
        if (current.low === player.low && current.high === player.high) {
            camera.setViewportFovScale(CLASSIC_FOV.low, CLASSIC_FOV.high);
        }
    }

    /** The shot is over (or the plugin is off): the player's own zoom comes back. */
    private unlockScriptedView(camera: Camera): void {
        if (!this.savedFov) return;
        camera.setViewportFovScale(this.savedFov.low, this.savedFov.high);
        this.savedFov = undefined;
    }

    /** A server camera shot holds the camera (not edit mode's or First Person's free camera). */
    private isScriptedShot(camera: Camera): boolean {
        return (
            this.isStarted() &&
            this.client.isLoggedIn() &&
            !this.client.followPlayerCamera &&
            camera.isScripted() &&
            this.pluginManager?.getPlugin(FirstPersonPlugin)?.isActive() !== true
        );
    }

    handleCameraFollow({ camera, playerX, playerY, playerZ }: CameraFollowContext): boolean {
        if (!this.isDriving()) {
            if (this.driving) this.release(camera);
            return false;
        }
        this.driving = true;
        camera.getViewportFovScale(this.drivingFov);
        this.hasDrivingFov = true;
        const now = performance.now();
        const dt = Math.min(0.1, Math.max(0, (now - this.lastFollowAt) / 1000));
        this.lastFollowAt = now;

        const focus = this.followFocus(playerX, playerY, playerZ, dt);
        this.yaw += (this.targetYaw - this.yaw) * (1 - Math.exp(-dt * ROTATE_RATE));
        if (Math.abs(this.targetYaw - this.yaw) < 0.5) this.yaw = this.targetYaw;
        camera.setYaw(this.yaw);

        const pitchUnits = this.pitch * DEGREES_TO_RS;
        camera.setViewPitchOverride(pitchUnits);
        this.appliedPitch = camera.getViewPitchOverride();
        const pitch = pitchUnits * RS_TO_RADIANS;
        if (camera.projectionType !== ProjectionType.ORTHO) camera.setProjectionType(ProjectionType.ORTHO);
        camera.orthoZoom = this.orthoZoom(camera, pitch);

        const distance = FRAMING;
        const yaw = this.yaw * RS_TO_RADIANS;
        const reach = distance * Math.cos(pitch);
        const x = focus.x - Math.sin(yaw) * reach;
        const z = focus.z - Math.cos(yaw) * reach;
        const y = focus.y === undefined ? undefined : focus.y - distance * Math.sin(pitch);
        camera.snapToPosition(x, y, z);
        if (focus.y !== undefined) camera.setFocalPoint(focus.x, focus.y, focus.z);
        return true;
    }

    /**
     * The game hides roofs when the line from the camera's tile to the player's crosses one.
     * This camera is ~20 tiles out and circles the player while it turns, so that long line
     * swept on and off buildings and the planes above flickered. Use a short line instead,
     * just as far as a roof could still hide the player at this angle, pointing at the angle
     * the camera is settling on: it only changes when the player steps onto another tile.
     */
    roofCameraTile(
        _cameraTile: { x: number; y: number },
        playerTile: { x: number; y: number },
    ): { x: number; y: number } | undefined {
        if (!this.driving) return undefined;
        const pitch = this.pitch * DEGREES_TO_RS * RS_TO_RADIANS;
        const reach = Math.min(8, Math.max(2, ROOF_OCCLUDER_HEIGHT / Math.tan(pitch)));
        const yaw = this.targetYaw * RS_TO_RADIANS;
        this.roofTile.x = playerTile.x - Math.round(Math.sin(yaw) * reach);
        this.roofTile.y = playerTile.y - Math.round(Math.cos(yaw) * reach);
        return this.roofTile;
    }

    /** The point the camera looks at: the player's chest, trailing a little behind. */
    private followFocus(playerX: number, playerY: number | undefined, playerZ: number, dt: number) {
        const y = playerY === undefined ? undefined : playerY - FOCUS_HEIGHT;
        const focus = this.focus;
        const jumped = !focus || Math.hypot(playerX - focus.x, playerZ - focus.z) > SNAP_DISTANCE;
        if (jumped) {
            this.focus = { x: playerX, y, z: playerZ };
            return this.focus;
        }
        const t = 1 - Math.exp(-dt * FOLLOW_RATE);
        focus.x += (playerX - focus.x) * t;
        focus.z += (playerZ - focus.z) * t;
        if (y === undefined) focus.y = undefined;
        else focus.y = focus.y === undefined ? y : focus.y + (y - focus.y) * t;
        return focus;
    }

    /**
     * The orthographic scale: the framing the classic camera has at this distance, following
     * the game's zoom. Zoomed out, it eases into the scale where the screen's corners would
     * reach past the draw distance, so the fog's square edge and unloaded map squares never come
     * into view. That includes Low-end Device mode (phones), which draws only 12 tiles out.
     * Easing in rather than stopping hard means every wheel or pinch step still changes the
     * view, even where the limit is close (phones, large windows).
     */
    private orthoZoom(camera: Camera, pitch: number): number {
        const viewportZoom = camera.viewportZoom > 0 ? camera.viewportZoom : 512;
        const framed = (2 * viewportZoom) / FRAMING;
        const renderDistance = this.drawDistance();
        // Ground under the screen's corner, in tiles from the player: half the width across,
        // half the height stretched by the slant of the ground at this angle.
        const corner = Math.hypot(camera.viewportWidth, camera.viewportHeight / Math.max(0.1, Math.sin(pitch)));
        const limit = corner / Math.max(1, renderDistance - FOG_MARGIN);
        return Math.pow(Math.pow(framed, ZOOM_LIMIT_EASE) + Math.pow(limit, ZOOM_LIMIT_EASE), 1 / ZOOM_LIMIT_EASE);
    }

    /** How far out the scene is drawn, in tiles: the GPU or Low-end Device setting, else the game's. */
    private drawDistance(): number {
        return this.client.clientPlugins.gpuSettings?.()?.drawDistance ?? this.client.renderDistance;
    }

    /**
     * Hands the camera back to normal rendering. Only what this plugin set is undone: a
     * cutscene's shot or First Person may already have set their own pitch this frame.
     */
    private release(camera: Camera): void {
        this.driving = false;
        this.focus = undefined;
        if (this.appliedPitch !== undefined && camera.getViewPitchOverride() === this.appliedPitch) {
            camera.setViewPitchOverride(undefined);
        }
        this.appliedPitch = undefined;
        if (camera.projectionType !== ProjectionType.PERSPECTIVE) camera.setProjectionType(ProjectionType.PERSPECTIVE);
    }

    private isDriving(): boolean {
        return (
            this.isStarted() &&
            this.client.isLoggedIn() &&
            this.client.followPlayerCamera &&
            this.pluginManager?.getPlugin(FirstPersonPlugin)?.isActive() !== true
        );
    }

    private readConfig(): void {
        const config = this.configManager.getConfig(IsometricConfig);
        this.pitch = config.pitch();
        this.rotateKeys = config.rotateKeys();
    }
}

/** The diagonal (45°, 135°, ...) nearest a yaw, so the grid always reads as diamonds. */
function nearestDiagonal(yaw: number): number {
    return Math.round((yaw - DIAGONAL_YAW) / QUARTER_TURN) * QUARTER_TURN + DIAGONAL_YAW;
}
