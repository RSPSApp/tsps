import { processQuestListTouchScroll } from "./input/questListScrollbarInput";
import { shouldSkipWidgetClickInput } from "./input/widgetClickGuard";
import { processWidgetClickInput } from "./input/widgetClickInput";
import { processWidgetDragInput } from "./input/widgetDragInput";
import { processWidgetHoldInput } from "./input/widgetHoldInput";
import { processWidgetHoverInput } from "./input/widgetHoverInput";
import { processWidgetIf1ScrollbarInput } from "./input/widgetIf1ScrollbarInput";
import { buildWidgetInputFrame } from "./input/widgetInputSetup";
import {
    type WidgetInputControllerDeps,
    type WidgetInputState,
    createWidgetInputState,
} from "./input/widgetInputTypes";
import { processConstructionKeyboardInput, processWidgetKeyboardInput } from "./input/widgetKeyboardInput";
import { processWidgetMenuWheelInput } from "./input/widgetMenuWheelInput";
import { processWidgetMinimapWheelInput } from "./input/widgetMinimapWheelInput";
import { createPrimaryWidgetActionResolver } from "./input/widgetPrimaryAction";
import { processWidgetReleaseInput } from "./input/widgetReleaseInput";
import { processWidgetScrollWheelInput } from "./input/widgetScrollWheelInput";

export type { WidgetInputControllerDeps } from "./input/widgetInputTypes";

const ALL_SETTINGS_GROUP = 134;
const RESTORE_CHAT_KEYBOARD_SCRIPT = 2158;
const MOBILE_ROOT = 601;
/** 162:57 chatbox:chatdisplay - the messages and the input line. */
const CHAT_DISPLAY_UID = (162 << 16) | 57;

/** Per-frame widget hover/scroll/click/drag/keyboard input extracted from OsrsClient. */
export class WidgetInputController {
    private readonly state: WidgetInputState = createWidgetInputState();
    private worldMapTouchDrag = false;

    constructor(private readonly deps: WidgetInputControllerDeps) {}

    onInterfaceClosed(groupId: number): void {
        if (groupId === ALL_SETTINGS_GROUP) {
            // A search in All Settings takes the keyboard from chat (script 2157). Script 2158
            // gives it back (4079: varc 11 = 0 and chat's key listener re-added); run it on
            // every close - the close button, Esc or another interface - or chat stays deaf.
            const chat = this.deps.getWidgetManager().findWidget(162, 0);
            if (chat) this.deps.executeScriptListener(chat, [RESTORE_CHAT_KEYBOARD_SCRIPT]);
            return;
        }
        if (groupId !== 458) return;
        // Cache script 2157 removes chat's onKey listener. Restore it when
        // leaving the build menu, including menus opened by older servers.
        this.deps.getVarManager().setVarcInt(11, 0);
        const chat = this.deps.getWidgetManager().findWidget(162, 0);
        if (chat) {
            this.deps.executeScriptListener(chat, [927, 1]);
            this.deps.executeScriptListener(chat, [223]);
        }
    }

    handleConstructionKeyboardInput(): void {
        const input = this.deps.getInputManager();
        if (processConstructionKeyboardInput(this.deps, input, this.deps.getWidgetManager())) {
            input.keyEvents.length = 0;
        }
    }

    handleUiInput(): void {
        const input = this.deps.getInputManager();
        const widgetManager = this.deps.getWidgetManager();
        const widgetInteraction = this.deps.getWidgetInteraction();
        widgetInteraction.clearStaleWidgetInteractionState();

        const frame = buildWidgetInputFrame(
            this.deps,
            this.state,
            input,
            widgetManager,
            widgetInteraction,
        );
        if (!frame) return;

        processWidgetKeyboardInput(this.deps, frame, widgetManager);

        const transmitCycles = this.deps.getTransmitCycles();
        const hoverCycle = transmitCycles.cycleCntr | 0;
        if (this.state.lastHoverListenerCycle !== hoverCycle) {
            this.state.lastHoverListenerCycle = hoverCycle;
            processWidgetHoverInput(this.deps, this.state, frame, widgetManager, widgetInteraction);
        }

        processWidgetMenuWheelInput(this.deps, frame);
        processWidgetMinimapWheelInput(this.deps, frame, widgetManager, widgetInteraction);
        processWidgetIf1ScrollbarInput(
            this.deps,
            this.state,
            frame,
            widgetManager,
            widgetInteraction,
        );
        if (processQuestListTouchScroll(frame, widgetManager)) return;
        processWidgetScrollWheelInput(this.deps, frame, widgetManager, widgetInteraction);

        if (shouldSkipWidgetClickInput(this.deps, frame)) return;

        const isNewClick = input.leftClickX !== -1 && input.leftClickY !== -1;
        const isHolding = input.isDragging();
        // Touch has no held button (a one-finger drag orbits the camera), so a swipe that
        // starts on the world map pans it like a held left button, and the camera stays put.
        const touchDrag = input.isTouch && input.mouseWheelDown;
        const touchDragStarted = touchDrag && !this.worldMapTouchDrag;
        this.worldMapTouchDrag = touchDrag;
        const panningMap = this.deps
            .getWorldMap()
            .handleWorldMapDragInput(
                frame.hits,
                frame.mx,
                frame.my,
                isNewClick || touchDragStarted,
                isHolding || touchDrag,
            );
        if (panningMap && touchDrag) input.consumeCameraDrag();

        // The desktop chatbox has no keyboard button (the mobile layout's opens it through
        // CS2), so on touch a tap on the chat brings up the soft keyboard and a tap elsewhere
        // puts it away. A tablet on "desktop site" gets this layout.
        if (isNewClick && input.isTouch && widgetManager.rootInterface !== MOBILE_ROOT) {
            const keyboard = this.deps.getChatKeyboard();
            if (hitsInclude(frame.hits, CHAT_DISPLAY_UID, widgetManager)) keyboard.show();
            else keyboard.hide();
        }

        const getPrimaryWidgetAction = createPrimaryWidgetActionResolver(
            this.deps,
            input,
            widgetManager,
            widgetInteraction,
        );

        processWidgetClickInput(
            this.deps,
            this.state,
            frame,
            widgetManager,
            widgetInteraction,
            getPrimaryWidgetAction,
            isNewClick,
        );
        processWidgetDragInput(this.deps, frame, widgetManager, widgetInteraction, isHolding);
        processWidgetHoldInput(this.deps, frame, widgetInteraction, isHolding, isNewClick);
        processWidgetReleaseInput(
            this.deps,
            frame,
            widgetManager,
            widgetInteraction,
            getPrimaryWidgetAction,
            isHolding,
        );
    }
}

function hitsInclude(hits: any[] | undefined, uid: number, widgetManager: { getWidgetByUid(uid: number): any }): boolean {
    for (const hit of hits ?? []) {
        let current = hit;
        for (let depth = 0; current && depth < 16; depth++) {
            if ((current.uid ?? -1) === uid) return true;
            const parentUid = current.parentUid;
            if (typeof parentUid !== "number" || parentUid < 0) break;
            current = widgetManager.getWidgetByUid(parentUid);
        }
    }
    return false;
}
