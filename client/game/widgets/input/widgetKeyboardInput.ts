import { chatHistory } from "../../../rs/cs2/ChatHistory";
import type { ScriptEvent } from "../../../rs/cs2/Cs2Vm";
import { VARBIT_KEYBINDING_ESC_TO_CLOSE } from "../../../common/vars";
import { collectWidgetsWithKeyHandlers } from "../../../widgets/menu/utils";
import { ClientPacket, createPacket, queuePacket } from "../../../network/packet";
import type { WidgetInputControllerDeps, WidgetInputFrame } from "./widgetInputTypes";
import type { WidgetInteractionController } from "../WidgetInteractionController";
import type { WidgetManager } from "../../../widgets/WidgetManager";

export function processWidgetKeyboardInput(
    deps: WidgetInputControllerDeps,
    frame: WidgetInputFrame,
    widgetManager: WidgetManager,
): void {
    const { input, mx, my, allRoots, visibleMap, getStaticChildren } = frame;
    if (input.keyEvents.length > 0) {
        // When inputDialogType > 0, keyboard input is captured for the dialog
        // Type 0 = no dialog, Type 1 = default, Type 2 = interface-scoped, Type 3 = widget-scoped
        const dialogActive = deps.getCs2Vm().inputDialogType > 0;
        const customInterfaceSearchHandled =
        !dialogActive && deps.getCustomInterfaces().handleSearchKeyEvents(input.keyEvents);

        // Process keyboard input for active dialog before widget handlers
        if (dialogActive) {
            for (const keyEvent of input.keyEvents) {
                // OSRS internal key codes: 84 = Enter, 85 = Backspace, 13 = Escape
                const OSRS_KEY_ENTER = 84;
                const OSRS_KEY_BACKSPACE = 85;
                const OSRS_KEY_ESCAPE = 13;

                if (keyEvent.keyTyped === OSRS_KEY_BACKSPACE) {
                    // Backspace - remove last character
                    if (deps.getCs2Vm().inputDialogString.length > 0) {
                        deps.getCs2Vm().inputDialogString = deps.getCs2Vm().inputDialogString.slice(
                            0,
                            -1,
                        );
                        // Update VarC string 335 (chatbox input) for CS2 scripts to read
                        deps.getVarManager().setVarcString(335, deps.getCs2Vm().inputDialogString);
                        // The native chatbox input overlay reads VarC 335.
                        // Do not inject a history line for pending trade X input.
                        if (!deps.getPendingTradeQuantityAction()) {
                            chatHistory.addMessage(
                                "game",
                                `Enter amount: ${deps.getCs2Vm().inputDialogString}_`,
                            );
                        }
                    }
                } else if (keyEvent.keyTyped === OSRS_KEY_ESCAPE) {
                    // Escape - cancel dialog
                    deps.getCs2Vm().inputDialogType = 0;
                    deps.getCs2Vm().inputDialogWidgetId = -1;
                    deps.getCs2Vm().inputDialogString = "";
                    deps.getVarManager().setVarcString(335, "");
                    // Clear any pending widget action since user cancelled
                    if (deps.getPendingInputDialogAction() || deps.getPendingTradeQuantityAction()) {
                        chatHistory.addMessage("game", "Input cancelled.");
                        console.log("[InputDialog] Cancelled, clearing pending action");
                        deps.setPendingInputDialogAction(null);
                        deps.setPendingTradeQuantityAction(null);
                    }
                } else if (keyEvent.keyTyped === OSRS_KEY_ENTER) {
                    // Enter - submit dialog
                    if (
                        deps.getCs2Vm().inputDialogString.length > 0 &&
                        deps.getCs2Vm().onInputDialogComplete
                    ) {
                        const value = parseInt(deps.getCs2Vm().inputDialogString, 10) || 0;
                        console.log(`[InputDialog] Submitting value: ${value}`);
                        deps.getCs2Vm().onInputDialogComplete?.("count", value);
                    } else if (deps.getPendingInputDialogAction() || deps.getPendingTradeQuantityAction()) {
                        // No input but pending action - cancel
                        chatHistory.addMessage("game", "No amount entered.");
                        deps.setPendingInputDialogAction(null);
                        deps.setPendingTradeQuantityAction(null);
                    }
                    // Clear dialog state
                    deps.getCs2Vm().inputDialogType = 0;
                    deps.getCs2Vm().inputDialogWidgetId = -1;
                    deps.getCs2Vm().inputDialogString = "";
                    deps.getVarManager().setVarcString(335, "");
                } else if (keyEvent.keyPressed > 0) {
                    // Regular character input - only accept digits for quantity dialogs
                    const char = String.fromCharCode(keyEvent.keyPressed);
                    // For bank quantity dialogs, only accept digits
                    if (
                        (deps.getPendingInputDialogAction() || deps.getPendingTradeQuantityAction()) &&
                        !/^\d$/.test(char)
                    ) {
                        continue; // Skip non-digit characters
                    }
                    // Limit input length (OSRS limits vary by dialog type, 12 for counts, 80 for names)
                    const maxLen = deps.getCs2Vm().inputDialogType === 3 ? 80 : 12;
                    if (deps.getCs2Vm().inputDialogString.length < maxLen) {
                        deps.getCs2Vm().inputDialogString += char;
                        // Update VarC string 335 for CS2 scripts to read
                        deps.getVarManager().setVarcString(335, deps.getCs2Vm().inputDialogString);
                        // The native chatbox input overlay reads VarC 335.
                        if (!deps.getPendingTradeQuantityAction()) {
                            chatHistory.addMessage(
                                "game",
                                `Enter amount: ${deps.getCs2Vm().inputDialogString}_`,
                            );
                        }
                    }
                }
            }

            // The dialog above is the sole owner of these key events.
            // Do not forward them to widget onKey listeners as well: the
            // chatbox input script would append the same digit a second time.
            return;
        }

        if (customInterfaceSearchHandled) {
            return;
        }

        // Escape closes the open modal when the "Esc closes current interface"
        // keybinding is enabled (varbit 4681, set from All Settings).
        const OSRS_KEY_ESCAPE = 13;
        if (
            input.keyEvents.some((keyEvent) => keyEvent.keyTyped === OSRS_KEY_ESCAPE) &&
            deps.getVarManager().getVarbit(VARBIT_KEYBINDING_ESC_TO_CLOSE) !== 0
        ) {
            let hasOpenModal = false;
            for (const parent of widgetManager.interfaceParents.values()) {
                if (parent && (parent.type === 0 || parent.type === 3)) {
                    hasOpenModal = true;
                    break;
                }
            }
            if (hasOpenModal) {
                // Same IF_CLOSE packet MenuAction.ts already sends for
                // MenuOpcode.WidgetClose (verified against
                // ClientBinaryEncoder.ts/ClientProtocol.ts - IF_CLOSE = 55,
                // 0-byte payload, decodes server-side to {type:
                // "interface_close"}, handled in NetworkBuilder.ts via
                // Player.closeInterruptibleInterfaces()).
                const pkt = createPacket(ClientPacket.IF_CLOSE);
                queuePacket(pkt);
                deps.getCs2Vm().deferIfClose();
                return;
            }
        }

        // Collect ALL widgets with onKey handlers from all roots.
        // Note: some widget trees can reference the same widget via multiple traversal paths
        // (e.g., legacy IF1 `children` plus parentUid-indexed children), so de-duplicate by uid.
        const keyWidgetsByUid = new Map<number, any>();
        for (const root of allRoots) {
            const keyWidgets = collectWidgetsWithKeyHandlers(
                root,
                visibleMap,
                getStaticChildren,
            );
            for (const w of keyWidgets) {
                const uid = (w?.uid ?? 0) | 0;
                if (uid !== 0) keyWidgetsByUid.set(uid, w);
            }
        }
        // Also dispatch keys to InterfaceParent-mounted sub-interfaces
        // (e.g., chatbox input handlers). Mounted interfaces are separate widget trees.
        for (const [containerUid, parent] of widgetManager.interfaceParents) {
            if (!parent) continue;
            // Skip if the container (or any ancestor) is hidden.
            if (widgetManager.isEffectivelyHidden(containerUid)) continue;
            // Root interface is already covered by allRoots.
            if ((parent.group | 0) === (widgetManager.rootInterface | 0)) continue;

            const subRoots = widgetManager.getAllGroupRoots(parent.group);
            for (const root of subRoots) {
                const keyWidgets = collectWidgetsWithKeyHandlers(
                    root,
                    visibleMap,
                    getStaticChildren,
                );
                for (const w of keyWidgets) {
                    const uid = (w?.uid ?? 0) | 0;
                    if (uid !== 0) keyWidgetsByUid.set(uid, w);
                }
            }
        }

        // Process all key events for all widgets with onKey handlers.
        // Typed characters (keyTyped === -1) are text input and don't change
        // keybind varbits, so only real key presses force a widget refresh -
        // otherwise every keystroke would invalidate the whole tree.
        let invalidateNeeded = false;
        for (const keyEvent of input.keyEvents) {
            const keyPress = keyEvent.keyTyped !== -1;
            for (const w of keyWidgetsByUid.values()) {
                const keyCtx: Partial<ScriptEvent> = {
                    mouseX: mx - (w._absX ?? w.x ?? 0),
                    mouseY: my - (w._absY ?? w.y ?? 0),
                    keyTyped: keyEvent.keyTyped,
                    keyPressed: keyEvent.keyPressed,
                };
                if (w.eventHandlers?.onKey) {
                    deps.getCs2Vm().invokeEventHandler(w, "onKey", keyCtx);
                    invalidateNeeded ||= keyPress;
                } else if (w.onKey) {
                    deps.executeScriptListener(w, w.onKey, keyCtx);
                    invalidateNeeded ||= keyPress;
                }
            }
        }
        // onKey handlers (e.g. the side-tab keybind script) mutate varbits the
        // renderer caches, so force a refresh once a key press handler has run.
        if (invalidateNeeded) {
            widgetManager.invalidateAll();
        }
    }
}
