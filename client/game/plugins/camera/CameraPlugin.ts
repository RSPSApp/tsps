import { ConfigChanged } from "@runelite/api/events";
import {
    CAMERA_ZOOM_BIG,
    CAMERA_ZOOM_BIG_MAX,
    CAMERA_ZOOM_BIG_MIN,
    CAMERA_ZOOM_SMALL,
    CAMERA_ZOOM_SMALL_MAX,
    CAMERA_ZOOM_SMALL_MIN,
} from "@runelite/api/gameval/VarClientID";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { PluginManager } from "@runelite/client/plugins/PluginManager";
import { clamp } from "../../../common/utils/MathUtil";
import { SCROLL_WHEEL_ZOOM_EVENT, SCROLL_WHEEL_ZOOM_INCREMENT_EVENT } from "../../../rs/cs2/zoomCallbacks";
import type { InputKeyHandler } from "../../InputManager";
import type { OsrsClient } from "../../OsrsClient";
import type { CameraRotation, ClientPlugin, ScriptCallbackEvent } from "../ClientPluginManager";
import { FirstPersonPlugin } from "../firstperson/FirstPersonPlugin";
import {
    CameraConfig,
    ControlFunction,
    type ControlFunctionValue,
    DEFAULT_ZOOM_INCREMENT,
    EaseFrom,
    type EaseFromValue,
    INNER_ZOOM_LIMIT,
    OUTER_LIMIT_MAX,
    OUTER_LIMIT_MIN,
} from "./CameraConfig";
import { CameraEasing } from "./CameraEasing";

/** camera_do_zoom(small, big): clamps both zooms to their limits and applies them. */
const CAMERA_DO_ZOOM = 42;
/** camera_set_zoom_limits(smallMin, smallMax, bigMin, bigMax): writes the limit varcs. */
const CAMERA_SET_ZOOM_LIMITS = 605;
const PITCH_MAX = 512;

/**
 * RuneLite's Camera plugin: wider zoom limits, a zoom step, Control to zoom or to reset the
 * zoom, camera speed, inverted mouse axes and no camera shake. On top of it, camera easing:
 * turns speed up and slow down smoothly instead of starting and stopping at once.
 *
 * The zoom options work on the cache's own zoom scripts, as in RuneLite: the limits are the
 * varcs camera_set_zoom_limits writes, and the wheel's step and Control to zoom go through the
 * callbacks rs/cs2/zoomCallbacks.ts adds to the scroll-wheel script.
 */
export class CameraPlugin extends Plugin implements ClientPlugin, InputKeyHandler {
    static descriptor: PluginDescriptor = {
        name: "Camera",
        description: "Expands zoom limit, changes camera speed and eases camera rotation",
        tags: ["zoom", "limit", "vertical", "click", "mouse", "easing", "smooth"],
        enabledByDefault: true,
        configKey: "cameraplugin",
    };

    static config = CameraConfig;

    private readonly configManager = inject(ConfigManager);
    private readonly client: OsrsClient;
    private readonly pluginManager?: PluginManager;
    private readonly easing = new CameraEasing();
    private removeKeyHandler?: () => void;

    private innerLimit = false;
    private outerLimit = 0;
    private controlFunction: ControlFunctionValue = ControlFunction.NONE;
    private ctrlZoomValue = 512;
    private zoomIncrement = DEFAULT_ZOOM_INCREMENT;
    private cameraSpeed = 1;
    private invertYaw = false;
    private invertPitch = false;
    private easingEnabled = true;
    private easeIn = 30;
    private easeOut = 30;
    private easeFrom: EaseFromValue = EaseFrom.BOTH;
    private easePitch = true;

    /** The cache's limits, from camera_set_zoom_limits, once it has run. */
    private defaultLimits?: { smallMin: number; smallMax: number; bigMin: number; bigMax: number };
    /** The camera's forced angle count last frame, to tell when something else turns it. */
    private forcedAngleChanges = 0;

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
        this.removeKeyHandler = this.client.inputManager.addKeyHandler(this);
        if (this.client.isLoggedIn()) this.limitsChanged();
    }

    protected override async shutDown(): Promise<void> {
        this.removeKeyHandler?.();
        this.removeKeyHandler = undefined;
        this.client.cameraShakeDisabled = false;
        this.easing.stop();
        this.applyLimits(false, 0);
        this.reapplyZoom();
    }

    onConfigChanged(event: ConfigChanged): void {
        if (event.getGroup() !== CameraConfig.group) return;
        this.readConfig();
        this.applyLimits(this.innerLimit, this.outerLimit);
        this.reapplyZoom();
    }

    onScriptFinished(scriptId: number): void {
        if (scriptId === CAMERA_SET_ZOOM_LIMITS && this.isStarted()) this.limitsChanged();
    }

    onScriptCallback({ eventName, vm }: ScriptCallbackEvent): void {
        if (!this.isStarted()) return;
        switch (eventName) {
            case SCROLL_WHEEL_ZOOM_EVENT:
                if (this.controlFunction === ControlFunction.CONTROL_TO_ZOOM && !this.isControlDown()) {
                    vm.intStack[vm.intStackSize - 1] = 1;
                }
                break;
            case SCROLL_WHEEL_ZOOM_INCREMENT_EVENT:
                if (this.zoomIncrement !== DEFAULT_ZOOM_INCREMENT) {
                    vm.intStack[vm.intStackSize - 1] = this.zoomIncrement;
                }
                break;
        }
    }

    onKeyUp(event: KeyboardEvent): boolean {
        if (
            this.isStarted() &&
            isControlKey(event.code) &&
            this.controlFunction === ControlFunction.CONTROL_TO_RESET &&
            this.client.isLoggedIn()
        ) {
            const zoom = clamp(this.ctrlZoomValue, OUTER_LIMIT_MIN, INNER_ZOOM_LIMIT);
            this.client.runClientScriptWithInts(CAMERA_DO_ZOOM, [zoom, zoom]);
        }
        return false;
    }

    transformCameraRotation(rotation: CameraRotation): void {
        if (!this.isStarted()) return;
        rotation.keyYaw *= this.cameraSpeed;
        rotation.keyPitch *= this.cameraSpeed;
        rotation.dragYaw *= this.cameraSpeed * (this.invertYaw ? -1 : 1);
        rotation.dragPitch *= this.cameraSpeed * (this.invertPitch ? -1 : 1);
        this.easeRotation(rotation);
    }

    private easeRotation(rotation: CameraRotation): void {
        const { camera } = rotation;
        if (!this.easingEnabled || !this.client.isLoggedIn() || this.isFirstPersonActive()) {
            this.easing.stop();
            return;
        }
        // Something else turned the camera (a script, the server, a cutscene): drop the turn.
        // Counted, not compared: HD's follow camera rewrites the yaw every frame as it smooths.
        if (camera.forcedAngleChanges !== this.forcedAngleChanges) {
            this.forcedAngleChanges = camera.forcedAngleChanges;
            this.easing.stop();
        }

        // The eased input comes out of the rotation and goes back in as the eased turn.
        const keys = this.easeFrom !== EaseFrom.MOUSE;
        const mouse = this.easeFrom !== EaseFrom.KEYS;
        let yaw = 0;
        let pitch = 0;
        if (keys) {
            yaw += rotation.keyYaw;
            rotation.keyYaw = 0;
        }
        if (mouse) {
            yaw += rotation.dragYaw;
            rotation.dragYaw = 0;
        }
        if (this.easePitch && keys) {
            pitch += rotation.keyPitch;
            rotation.keyPitch = 0;
        }
        if (this.easePitch && mouse) {
            pitch += rotation.dragPitch;
            rotation.dragPitch = 0;
        }
        const eased = this.easing.update(yaw, pitch, rotation.deltaTime, this.easeIn, this.easeOut);
        rotation.dragYaw += eased.yaw;
        rotation.dragPitch += eased.pitch;

        const pitchTo = camera.pitch + rotation.keyPitch + rotation.dragPitch;
        if (eased.pitch !== 0 && (pitchTo <= 0 || pitchTo >= PITCH_MAX)) this.easing.stopPitch();
    }

    private readConfig(): void {
        const config = this.configManager.getConfig(CameraConfig);
        this.innerLimit = config.innerLimit();
        this.outerLimit = config.outerLimit();
        this.controlFunction = config.controlFunction();
        this.ctrlZoomValue = config.ctrlZoomValue();
        this.zoomIncrement = config.zoomIncrement();
        this.cameraSpeed = config.cameraSpeed();
        this.invertYaw = config.invertYaw();
        this.invertPitch = config.invertPitch();
        this.easingEnabled = config.easing();
        this.easeIn = config.easeIn();
        this.easeOut = config.easeOut();
        this.easeFrom = config.easeFrom();
        this.easePitch = config.easePitch();
        if (this.isStarted()) this.client.cameraShakeDisabled = config.disableCameraShake();
    }

    /** camera_set_zoom_limits just wrote the cache's limits: keep them, then widen them. */
    private limitsChanged(): void {
        const vars = this.client.varManager;
        if (!vars) return;
        const limits = {
            smallMin: vars.getVarcInt(CAMERA_ZOOM_SMALL_MIN),
            smallMax: vars.getVarcInt(CAMERA_ZOOM_SMALL_MAX),
            bigMin: vars.getVarcInt(CAMERA_ZOOM_BIG_MIN),
            bigMax: vars.getVarcInt(CAMERA_ZOOM_BIG_MAX),
        };
        // Unset varcs read -1: camera_set_zoom_limits hasn't run yet, and will call back here.
        if (Object.values(limits).some((value) => value <= 0)) return;
        this.defaultLimits = limits;
        this.applyLimits(this.innerLimit, this.outerLimit);
    }

    private applyLimits(innerLimit: boolean, outerLimitAdj: number): void {
        const vars = this.client.varManager;
        const limits = this.defaultLimits;
        if (!vars || !limits) return;
        const outer = clamp(outerLimitAdj, OUTER_LIMIT_MIN, OUTER_LIMIT_MAX);
        vars.setVarcInt(CAMERA_ZOOM_SMALL_MAX, innerLimit ? INNER_ZOOM_LIMIT : limits.smallMax);
        vars.setVarcInt(CAMERA_ZOOM_BIG_MAX, innerLimit ? INNER_ZOOM_LIMIT : limits.bigMax);
        vars.setVarcInt(CAMERA_ZOOM_SMALL_MIN, limits.smallMin - outer);
        vars.setVarcInt(CAMERA_ZOOM_BIG_MIN, limits.bigMin - outer);
    }

    /** Re-zooms to the current zoom so it's clamped to limits that just narrowed. */
    private reapplyZoom(): void {
        const vars = this.client.varManager;
        if (!this.defaultLimits || !vars || !this.client.isLoggedIn()) return;
        this.client.runClientScriptWithInts(CAMERA_DO_ZOOM, [
            vars.getVarcInt(CAMERA_ZOOM_SMALL),
            vars.getVarcInt(CAMERA_ZOOM_BIG),
        ]);
    }

    private isControlDown(): boolean {
        const input = this.client.inputManager;
        return input.isKeyDown("ControlLeft") || input.isKeyDown("ControlRight");
    }

    private isFirstPersonActive(): boolean {
        return this.pluginManager?.getPlugin(FirstPersonPlugin)?.isActive() === true;
    }
}

function isControlKey(code: string): boolean {
    return code === "ControlLeft" || code === "ControlRight";
}
