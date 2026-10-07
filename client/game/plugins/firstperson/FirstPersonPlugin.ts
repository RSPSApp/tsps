import type { OsrsClient } from "../../OsrsClient";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import type { Camera } from "../../Camera";
import type { InputKeyHandler, InputManager, InputMouseHandler } from "../../InputManager";
import type { CameraFollowContext, CameraInputContext, ClientPlugin } from "../ClientPluginManager";

if (typeof document !== "undefined") require("./FirstPersonPlugin.css");

type FirstPersonClient = {
    camera: Camera;
    inputManager: InputManager;
    renderSelf: boolean;
    firstPersonArmsVisible?: boolean;
    followPlayerCamera: boolean;
    menuOpen: boolean;
    isLoggedIn(): boolean;
    addGameMessage(message: string): void;
    closeMenu(): void;
};

type CursorMode = "none" | "alt" | "menu";
const MENU_ANCHOR_Y_OFFSET = 12;
const CONTROLS_HINT = "Press Alt for mouse look. Press Insert to hide arm visibility.";

export class FirstPersonPlugin extends Plugin implements ClientPlugin, InputKeyHandler, InputMouseHandler {
    static descriptor: PluginDescriptor = {
        name: "First Person",
        description: "First-person camera with mouse look.",
        tags: ["camera"],
        hidden: true,
        configKey: "firstpersonplugin",
    };

    private enabled = false;
    private cursorMode: CursorMode = "none";
    private awaitingMenuOpen = false;
    private menuOpenChecked = false;
    private menuPointerX = 0;
    private menuPointerY = 0;
    private restoreRenderSelf?: boolean;
    private restoreFollowPlayerCamera?: boolean;
    private controlsHintShown = false;
    private readonly client: FirstPersonClient;

    constructor(client?: FirstPersonClient) {
        super();
        this.client = client ?? inject<OsrsClient>(CLIENT_TOKEN);
        this.client.inputManager.addKeyHandler(this);
        this.client.inputManager.addMouseHandler(this);
    }

    onKeyDown(event: KeyboardEvent): boolean {
        if (event.code === "Backquote" && !event.repeat) {
            this.setEnabled(!this.enabled);
            return true;
        }
        if (
            event.code === "Insert" &&
            this.enabled &&
            this.cursorMode !== "menu" &&
            !event.repeat
        ) {
            this.client.firstPersonArmsVisible = !this.client.firstPersonArmsVisible;
            return true;
        }
        if (
            (event.code === "AltLeft" || event.code === "AltRight") &&
            this.enabled &&
            !event.repeat
        ) {
            if (this.cursorMode === "alt") this.resumeMouseLook();
            else this.unlockCursor();
            return true;
        }
        return false;
    }

    onKeyUp(event: KeyboardEvent): boolean {
        return this.enabled && (event.code === "AltLeft" || event.code === "AltRight");
    }

    onMouseDown(event: MouseEvent): void {
        if (!this.enabled || (event.button !== 0 && event.button !== 2)) return;
        if (event.button === 2 && this.cursorMode === "none") {
            this.awaitingMenuOpen = true;
            this.menuOpenChecked = false;
            this.menuPointerX = this.client.camera.viewportXOffset + this.client.camera.viewportWidth / 2;
            this.menuPointerY = this.client.camera.viewportYOffset + this.client.camera.viewportHeight / 2;
            this.client.inputManager.setContextMenuAnchorOverride(
                this.menuPointerX,
                this.menuPointerY - MENU_ANCHOR_Y_OFFSET,
            );
            this.cursorMode = "menu";
            return;
        }
        if (this.cursorMode !== "menu" || !this.client.menuOpen) return;
        if (event.button === 0) {
            // Leave the menu state intact until its existing click handler invokes or cancels it.
            this.setMenuClickPosition();
            this.resumeMouseLook();
        } else if (event.button === 2) {
            this.closeWorldMenu();
            this.client.inputManager.clickMode1 = 0;
            this.client.inputManager.clickMode2 = 0;
            if (this.cursorMode === "menu") this.resumeMouseLook();
        }
    }

    onMouseMove(event: MouseEvent): void {
        if (!this.enabled || this.cursorMode !== "menu") return;
        const canvas = this.client.inputManager.element as HTMLCanvasElement | undefined;
        const width = canvas?.width ?? 0;
        const height = canvas?.height ?? 0;
        this.menuPointerX = Math.max(0, Math.min(width, this.menuPointerX + event.movementX));
        this.menuPointerY = Math.max(0, Math.min(height, this.menuPointerY + event.movementY));
        this.client.inputManager.mouseX = this.menuPointerX;
        this.client.inputManager.mouseY = this.menuPointerY;
    }

    handleCameraKeys({ camera, input, deltaTime }: CameraInputContext): boolean {
        if (!this.enabled) return false;
        const deltaPitch = (64 * 8 * deltaTime) / 1000;
        const deltaYaw = (512 * deltaTime) / 1000;
        // First-person arrows intentionally run opposite to the normal camera controls.
        if (input.isKeyDown("ArrowUp")) camera.setViewPitchOverride((camera.getViewPitchOverride() ?? 0) - deltaPitch);
        if (input.isKeyDown("ArrowDown")) camera.setViewPitchOverride((camera.getViewPitchOverride() ?? 0) + deltaPitch);
        if (input.isKeyDown("ArrowRight")) camera.updateYaw(camera.yaw, deltaYaw);
        if (input.isKeyDown("ArrowLeft")) camera.updateYaw(camera.yaw, -deltaYaw);
        return true;
    }

    handleCameraMouse({ camera, input }: CameraInputContext): boolean {
        if (!this.enabled) return false;
        if (this.client.menuOpen) {
            if (this.cursorMode === "none") this.enterMenuMode();
            this.awaitingMenuOpen = false;
        } else if (
            this.cursorMode === "menu" &&
            (!this.awaitingMenuOpen || this.menuOpenChecked)
        ) {
            this.resumeMouseLook();
        }
        if (this.cursorMode !== "none" || !input.isPointerLock()) return true;
        const deltaX = input.getDeltaMouseX();
        const deltaY = input.getDeltaMouseY();
        if (deltaX !== 0 || deltaY !== 0) {
            camera.setViewPitchOverride((camera.getViewPitchOverride() ?? 0) - deltaY * 0.9);
            camera.updateYaw(camera.yaw, -deltaX * 0.9);
        }
        return true;
    }

    handleCameraScroll({ camera, input }: CameraInputContext): boolean {
        if (!this.enabled || input.wheelDeltaY === 0) return false;
        camera.setViewZoomScale(camera.getViewZoomScale() - input.wheelDeltaY * 0.001);
        return true;
    }

    updateInteractionPointer(camera: Camera): void {
        const input = this.client.inputManager;
        this.updateLoginSession();
        this.updateReticleVisibility();
        if (!this.client.isLoggedIn()) {
            input.clearInteractionPointerOverride();
            return;
        }
        if (this.cursorMode === "menu" && this.client.menuOpen) {
            input.clearInteractionPointerOverride();
            input.mouseX = this.menuPointerX;
            input.mouseY = this.menuPointerY;
            this.updateReticlePosition(input, this.menuPointerX, this.menuPointerY);
            return;
        }
        const waitingForMenu = this.cursorMode === "menu" && !this.client.menuOpen;
        if (
            !this.enabled ||
            (!waitingForMenu && this.cursorMode !== "none") ||
            (this.cursorMode === "none" && !input.isPointerLock())
        ) {
            input.clearInteractionPointerOverride();
            return;
        }
        const x = camera.viewportXOffset + camera.viewportWidth / 2;
        const y = camera.viewportYOffset + camera.viewportHeight / 2;
        input.mouseX = x;
        input.mouseY = y;
        input.setInteractionPointerOverride(x, y);
        if (waitingForMenu) this.menuOpenChecked = true;
        this.updateReticlePosition(input, x, y);
    }

    handleCameraFollow({ camera, playerX, playerY, playerZ }: CameraFollowContext): boolean {
        if (!this.enabled) return false;
        camera.snapToPosition(
            playerX,
            playerY === undefined ? undefined : Math.round((playerY - 1.5) * 128) / 128,
            playerZ,
        );
        return true;
    }

    shouldKeepWorldMenuOpen(): boolean {
        return this.enabled && this.client.menuOpen;
    }

    private setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        this.cursorMode = enabled ? "alt" : "none";
        this.awaitingMenuOpen = false;
        this.menuOpenChecked = false;
        const { inputManager: input, camera } = this.client;
        input.enablePointerLock = false;
        input.clearInteractionPointerOverride();
        input.clearContextMenuAnchorOverride();
        this.closeWorldMenu();
        this.updateReticleVisibility();
        if (enabled) {
            if (this.updateLoginSession() && !this.controlsHintShown) {
                this.client.addGameMessage(CONTROLS_HINT);
                this.controlsHintShown = true;
            }
            this.restoreRenderSelf = this.client.renderSelf;
            this.restoreFollowPlayerCamera = this.client.followPlayerCamera;
            this.client.renderSelf = false;
            this.client.firstPersonArmsVisible = true;
            this.client.followPlayerCamera = true;
            camera.setViewPitchOverride(0);
            return;
        }
        camera.setViewPitchOverride(undefined);
        camera.setViewZoomScale(1);
        if (this.restoreRenderSelf !== undefined) this.client.renderSelf = this.restoreRenderSelf;
        this.client.firstPersonArmsVisible = false;
        if (this.restoreFollowPlayerCamera !== undefined) this.client.followPlayerCamera = this.restoreFollowPlayerCamera;
        this.restoreRenderSelf = undefined;
        this.restoreFollowPlayerCamera = undefined;
        input.releasePointerLock();
    }

    private updateLoginSession(): boolean {
        const loggedIn = this.client.isLoggedIn();
        if (!loggedIn) this.controlsHintShown = false;
        return loggedIn;
    }

    private unlockCursor(): void {
        this.cursorMode = "alt";
        this.client.inputManager.enablePointerLock = false;
        this.client.inputManager.clearInteractionPointerOverride();
        this.client.inputManager.releasePointerLock();
    }

    private resumeMouseLook(): void {
        this.cursorMode = "none";
        this.awaitingMenuOpen = false;
        this.menuOpenChecked = false;
        this.client.inputManager.enablePointerLock = true;
        this.client.inputManager.clearInteractionPointerOverride();
        this.client.inputManager.clearContextMenuAnchorOverride();
        this.client.inputManager.requestPointerLock();
    }

    private closeWorldMenu(): void {
        this.client.closeMenu();
        const canvas = this.client.inputManager.element as
            | (HTMLCanvasElement & { __ui?: { menu?: { source?: string; open?: boolean } } })
            | undefined;
        if (canvas?.__ui?.menu?.source === "map") {
            canvas.__ui.menu.open = false;
            canvas.__ui.menu = undefined;
        }
    }

    private enterMenuMode(): void {
        this.cursorMode = "menu";
        this.menuPointerX = this.client.camera.viewportXOffset + this.client.camera.viewportWidth / 2;
        this.menuPointerY = this.client.camera.viewportYOffset + this.client.camera.viewportHeight / 2;
    }

    private setMenuClickPosition(): void {
        const input = this.client.inputManager;
        input.mouseX = this.menuPointerX;
        input.mouseY = this.menuPointerY;
        input.clickX = this.menuPointerX;
        input.clickY = this.menuPointerY;
    }

    private updateReticlePosition(input: InputManager, x: number, y: number): void {
        const canvas = input.element as HTMLCanvasElement | undefined;
        const host = canvas?.parentElement;
        if (host && canvas?.width && canvas.height) {
            host.style.setProperty("--first-person-reticle-x", `${(x / canvas.width) * 100}%`);
            host.style.setProperty("--first-person-reticle-y", `${(y / canvas.height) * 100}%`);
        }
    }

    private updateReticleVisibility(): void {
        this.client.inputManager.element?.parentElement?.classList.toggle(
            "first-person-reticle",
            this.enabled && this.client.isLoggedIn(),
        );
    }
}
