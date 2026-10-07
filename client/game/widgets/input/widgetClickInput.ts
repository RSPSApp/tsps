import { sendResumeNameDialog, sendWidgetAction, sendWidgetActionMessage } from "../../../network/ServerConnection";
import { ClientPacketId, createPacket, queuePacket } from "../../../network/packet";
import type { ScriptEvent } from "../../../rs/cs2/Cs2Vm";
import { spawnSearchPick } from "../../../rs/cs2/spawnSearch";
import { shouldTransmitAction } from "../../../widgets/WidgetFlags";
import {
    isPauseButtonWidget as isPauseButtonWidgetUtil,
    sanitizeText,
} from "../../../widgets/menu/utils";
import { ClientState } from "../../ClientState";
import type { WidgetInteractionController } from "../WidgetInteractionController";
import type { WidgetManager } from "../../../widgets/WidgetManager";
import type { WidgetInputControllerDeps, WidgetInputFrame, WidgetInputState } from "./widgetInputTypes";
import type { PrimaryWidgetAction } from "./widgetPrimaryAction";
import { isCombatSkillWidgetAction } from "../widgetActionPayload";

export function processWidgetClickInput(
    deps: WidgetInputControllerDeps,
    state: WidgetInputState,
    frame: WidgetInputFrame,
    widgetManager: WidgetManager,
    widgetInteraction: WidgetInteractionController,
    getPrimaryWidgetAction: (w: any) => PrimaryWidgetAction,
    isNewClick: boolean,
): void {
    const { input, collectFromAllRoots, getWidgetFlags } = frame;
    if (isNewClick) {
        // New click - reset drag state
        widgetInteraction.widgetDragDuration = 0;
        widgetInteraction.dragClickCycle = deps.getTransmitCycles().cycleCntr | 0;
        widgetInteraction.isDraggingWidget = false;
        widgetInteraction.dragClickX = input.leftClickX;
        widgetInteraction.dragClickY = input.leftClickY;
        widgetInteraction.clickedWidgetParent = null;
        widgetInteraction.draggedOnWidget = null;
        // PERF: Reset drag hit cache
        widgetInteraction.lastDragHitX = -1;
        widgetInteraction.lastDragHitY = -1;
        // PERF: Invalidate hover cache - click may change widget visibility
        state.cachedHoverHits = null;

        if (!widgetInteraction.clickedWidget) {
            // Find widget with click handlers
            const clickHits = collectFromAllRoots(input.leftClickX, input.leftClickY);
            if (widgetInteraction.handleTradeRequestChatClick(clickHits)) {
                return;
            }
            for (let i = clickHits.length - 1; i >= 0; i--) {
                const w = clickHits[i];
                const hitWidgetGroupId =
                    (w.groupId ?? (typeof w.uid === "number" ? w.uid >>> 16 : 0)) | 0;
                const hasInventoryItem =
                    hitWidgetGroupId === 149 &&
                    typeof (w as any).itemId === "number" &&
                    (w as any).itemId > 0;
                // Check for actual handlers, not just empty arrays
                // Empty arrays are truthy but shouldn't count as having handlers.
                // OSRS lists an op only when it has text, and a left-click is the top menu
                // entry: a component whose ops are all empty (or the cache's "*" placeholder)
                // offers nothing, so the click falls through to what lies under it - e.g. the
                // bolt pouch slot (387:30), emptied by script 4039, over Dizana's quiver slot.
                const hasActionList = Array.isArray(w.actions) && w.actions.length > 0;
                const hasActions =
                    hasActionList && w.actions.some((action: any) => !!sanitizeText(action));
                const opsCleared = hasActionList && !hasActions;
                const getWidgetByUid = (uid: number) => widgetManager?.getWidgetByUid(uid);
                const isPauseButtonWidget = isPauseButtonWidgetUtil(
                    w,
                    getWidgetFlags,
                    getWidgetByUid,
                );
                // widgets can be clickable purely via IF_SETEVENTS transmit flags
                // (bits 1-10 for op1..op10), even if they have no actions[] or scripts attached.
                // This is required for interfaces like PlayerDesign (679) where button widgets
                // are often empty containers with only transmit flags set.
                const flags = getWidgetFlags(w) | 0;
                const hasTransmitOps = (flags & 0x7fe) !== 0;
                // spell widgets are actionable when target mask is non-zero
                // and spellActionName exists (Widget_getSpellActionName).
                const targetMask = (flags >>> 11) & 0x3f;
                const hasSpellAction =
                    targetMask > 0 &&
                    !!sanitizeText((w as any).spellActionName ?? (w as any).targetVerb);
                const isDynamicWidget = ((w as any).fileId | 0) === -1;
                const hasHandlers = !!(
                    w.eventHandlers?.onClick ||
                    w.eventHandlers?.onClickRepeat ||
                    w.eventHandlers?.onHold ||
                    w.eventHandlers?.onRelease ||
                    w.eventHandlers?.onOp ||
                    w.onClick ||
                    w.onClickRepeat ||
                    w.onHold ||
                    w.onRelease ||
                    w.onOp ||
                    hasActions ||
                    hasInventoryItem ||
                    // OSRS: any widget can be a drag source if it has drag listener or implicit drag
                    w.eventHandlers?.onDrag ||
                    w.onDrag ||
                    w.isDraggable ||
                    isPauseButtonWidget ||
                    // IF_SETEVENTS transmit bits can make otherwise-empty STATIC widgets
                    // clickable (e.g., server-authoritative tab controls). For dynamic children,
                    // transmit-only hit targets can incorrectly steal clicks from scripted row widgets.
                    (!isDynamicWidget && hasTransmitOps && !opsCleared) ||
                    hasSpellAction
                );
                if (hasHandlers) {
                    widgetInteraction.clickedWidget = w;
                    widgetInteraction.clickedWidgetParent = widgetInteraction.resolveClickedWidgetParent(w);
                    // Use absolute position (from hit detection) for event_mousey calculation
                    widgetInteraction.clickedWidgetX = input.leftClickX - (w._absX ?? w.x ?? 0);
                    widgetInteraction.clickedWidgetY = input.leftClickY - (w._absY ?? w.y ?? 0);
                    // Mark the clicked widget dirty immediately so the held-click
                    // translucency is visible on the same frame.
                    widgetManager.invalidateWidgetRender(w);

                    // Check for spell targeting BEFORE CS2 handlers run
                    // Spellbook widgets (group 218) with targetMask should enter targeting mode
                    const clickGroupId = (w.groupId ?? w.uid >>> 16) | 0;
                    const clickChildId = (w.fileId ?? w.uid & 0xffff) | 0;
                    const isSpellbookWidget = clickGroupId === 218 && clickChildId > 0;

                    if (isSpellbookWidget) {
                        // Get targetVerb from widget or use "Cast" as fallback for spell widgets
                        let targetVerb = w.targetVerb || w.spellActionName;

                        // Only enter targeting mode if targetMask > 0 (spell needs a target)
                        // Teleport spells have targetMask === 0 and should cast immediately.
                        const targetMask = deps.getSpellSelection().getWidgetTargetMask(w);
                        const needsTarget = targetMask > 0;

                        if (
                            !needsTarget &&
                            targetVerb &&
                            (w.name || w.opBase || w.spriteId >= 0)
                        ) {
                            // No-target spell (e.g., teleport) - send directly to server
                            console.log(
                                `[OsrsClient] No-target spell clicked: widget=${w.uid}, name="${
                                    w.name || w.opBase
                                }", group=${clickGroupId}, child=${clickChildId}`,
                            );

                            // Send widget action to server for teleport handling
                            sendWidgetAction({
                                widgetId: w.uid,
                                groupId: clickGroupId,
                                childId: clickChildId,
                                option: "Cast",
                                target: w.name || w.opBase || "",
                                opId: 1,
                            });
                            break;
                        }

                        if (!targetVerb && needsTarget) {
                            targetVerb = "null";
                        }

                        if (targetVerb && needsTarget) {
                            const spellSelection = deps.getSpellSelection().resolveSpellSelectionFromWidget(
                                w,
                                w.uid,
                                clickChildId,
                                -1,
                            );
                            // Clicking the currently selected spell deselects it.
                            if (
                                ClientState.isSpellSelected &&
                                ClientState.selectedSpellWidget === spellSelection.widgetId
                            ) {
                                console.log(
                                    `[OsrsClient] Spell widget re-clicked while active, clearing selection: widget=${spellSelection.widgetId}`,
                                );
                                deps.getSpellSelection().clearSelectedSpell();
                                break;
                            }

                            // Enter spell targeting mode (for combat spells that need a target)
                            ClientState.clearItemSelection();
                            ClientState.isSpellSelected = true;
                            ClientState.selectedSpellWidget = spellSelection.widgetId;
                            ClientState.selectedSpellChildIndex = spellSelection.childIndex;
                            ClientState.selectedSpellItemId = spellSelection.itemId;
                            ClientState.selectedSpellActionName = targetVerb;
                            ClientState.selectedSpellName =
                                w.opBase || w.dataText || w.name || "";
                            // Track when spell targeting was entered to prevent casting on same click
                            ClientState.spellTargetEnteredFrame = Date.now();
                            // Store the spell's target mask
                            ClientState.selectedSpellTargetMask = targetMask;

                            const clickGroupId = (spellSelection.widgetId >> 16) & 0xffff;
                            console.log(
                                `[OsrsClient] Spell targeting mode entered: widget=${
                                    spellSelection.widgetId
                                }, verb="${targetVerb}", name="${
                                    ClientState.selectedSpellName
                                }", group=${clickGroupId}, child=${
                                    spellSelection.childIndex
                                }, targetMask=0x${ClientState.selectedSpellTargetMask.toString(
                                    16,
                                )}`,
                            );

                            // Fire onTargetEnter on the source widget ( - use widget child ID, not hardcoded spell ID)
                            deps.getSpellSelection().setSelectedSpell(
                                {
                                    spellId: spellSelection.childIndex,
                                    spellName: ClientState.selectedSpellName,
                                    spellLevel: 1,
                                },
                                w,
                            );

                            // IMPORTANT: Stop processing this click after entering spell targeting mode
                            // Don't continue to onClick/onOp handlers which may switch tabs and trigger other actions
                            break;
                        }
                    }

                    // Pause button widgets send RESUME_PAUSEBUTTON and do not go through
                    // generic widget action dispatch.
                    // Pause button widgets send RESUME_PAUSEBUTTON - menu shows "Continue" with empty target
                    if (isPauseButtonWidget) {
                        // Only send if not already waiting for response
                        if (widgetManager?.canSendResumePauseButton(w) ?? true) {
                            const widgetUid =
                                (typeof (w as any).id === "number"
                                    ? (w as any).id
                                    : (w.uid ?? 0)) | 0;
                            const childIndex =
                                (typeof w.childIndex === "number" && (w.childIndex | 0) >= 0
                                    ? w.childIndex | 0
                                    : typeof w.fileId === "number" && w.fileId >= 0
                                      ? w.fileId | 0
                                      : widgetUid & 0xffff) | 0;
                            // Send RESUME_PAUSEBUTTON packet to server
                            const pkt = createPacket(ClientPacketId.RESUME_PAUSEBUTTON);
                            pkt.packetBuffer.writeShortAddLE(childIndex);
                            pkt.packetBuffer.writeInt(widgetUid);
                            queuePacket(pkt);
                            // Set meslayerContinueWidget to show "Please wait..."
                            if (widgetManager) {
                                widgetManager.meslayerContinueWidget = w;
                                widgetManager.invalidateWidgetRender(w);
                            }
                        }
                        widgetInteraction.clickedWidgetHandled = true;
                        break;
                    }

                    // For draggable widgets, DON'T fire onClick on mousedown
                    // Wait until mouseup to determine if it was a click or a drag
                    // onClick only fires on release if not dragging
                    if (widgetInteraction.isWidgetDraggable(w)) {
                        // Don't fire onClick yet - wait for mouseup to see if it's a drag
                        // The onClick will be fired in the release handler if no drag occurred
                        break;
                    }

                    // resolve the primary menu action before any onClick/onOp handlers run.
                    // Handlers can mutate widget ops (e.g., Mute -> Unmute), but the transmitted action
                    // should reflect what was clicked pre-mutation.
                    const primaryAction = getPrimaryWidgetAction(w);

                    // A ::items / ::npcs result row: send the pick ourselves and skip the
                    // cache search's select script, which resumes the dialog and closes the
                    // search. Keeps the results open for repeat spawns.
                    const spawnPick = spawnSearchPick(w, primaryAction.opIndex ?? 1);
                    if (spawnPick !== null) {
                        sendResumeNameDialog(spawnPick);
                        widgetInteraction.clickedWidgetHandled = true;
                        break;
                    }

                    // Trade item slots are draggable and reach handleWidgetAction on mouse-up,
                    // but the native Accept/Decline buttons are not. Route these primary button
                    // clicks through the same authoritative trade protocol before their cache
                    // onOp handlers can consume the click as a generic widget action.
                    const primaryWidgetGroupId =
                        (typeof w.groupId === "number" ? w.groupId : w.uid >>> 16) | 0;
                    const primaryWidgetChildId =
                        (typeof w.fileId === "number" && w.fileId >= 0
                            ? w.fileId
                            : typeof w.childIndex === "number"
                              ? w.childIndex
                              : w.uid & 0xffff) | 0;
                    if (primaryWidgetGroupId === 219) {
                        const payload = deps.buildWidgetActionPayload({
                            widget: w,
                            option: primaryAction.option,
                            target: primaryAction.target,
                            source: "primary",
                            cursorX: widgetInteraction.clickedWidgetX,
                            cursorY: widgetInteraction.clickedWidgetY,
                            slot: primaryAction.slot,
                            itemId: primaryAction.itemId,
                            opIndex: primaryAction.opIndex,
                        });
                        if (payload && typeof payload.slot === "number") {
                            sendWidgetActionMessage({ ...payload, slot: payload.slot + 1 });
                            widgetInteraction.clickedWidgetHandled = true;
                            break;
                        }
                    }
                    const skillPayload = deps.buildWidgetActionPayload({
                        widget: w,
                        option: primaryAction.option,
                        target: primaryAction.target,
                        source: "primary",
                        cursorX: widgetInteraction.clickedWidgetX,
                        cursorY: widgetInteraction.clickedWidgetY,
                        slot: primaryAction.slot,
                        itemId: primaryAction.itemId,
                        opIndex: primaryAction.opIndex,
                    });
                    if (skillPayload && isCombatSkillWidgetAction(skillPayload)) {
                        sendWidgetActionMessage(skillPayload);
                        widgetInteraction.clickedWidgetHandled = true;
                        break;
                    }
                    if (
                        deps.handleTradeWidgetAction(
                            w,
                            primaryAction,
                            primaryWidgetGroupId,
                            primaryWidgetChildId,
                        )
                    ) {
                        widgetInteraction.clickedWidgetHandled = true;
                        break;
                    }

                    // If the GL widgets layer is active, defer primary click handling to it.
                    // Primary left-click handling is driven by the game loop
                    // (clickedWidget + menuAction semantics), not by the GL widget click registry.

                    // Non-draggable widgets: Fire onClick immediately on press
                    const meslayerBeforePrimaryClick =
                        widgetManager?.meslayerContinueWidget ?? null;
                    const clickCtx: Partial<ScriptEvent> = {
                        mouseX: widgetInteraction.clickedWidgetX,
                        mouseY: widgetInteraction.clickedWidgetY,
                        opIndex: primaryAction.opIndex ?? 1,
                        targetName: primaryAction.target,
                    };
                    let handled = false;
                    let invokedAnyHandler = false;

                    // Try onClick first
                    if (w.eventHandlers?.onClick) {
                        invokedAnyHandler = true;
                        handled = deps.getCs2Vm().invokeEventHandler(w, "onClick", clickCtx);
                    }

                    // Fall back to onOp if onClick didn't handle it (tabs use onOp)
                    if (!handled && w.eventHandlers?.onOp) {
                        invokedAnyHandler = true;
                        handled = deps.getCs2Vm().invokeEventHandler(w, "onOp", clickCtx);
                    }

                    // Try legacy handlers
                    if (!handled && w.onClick) {
                        invokedAnyHandler = true;
                        deps.executeScriptListener(w, w.onClick, clickCtx);
                        handled = true;
                    }

                    if (!handled && w.onOp) {
                        invokedAnyHandler = true;
                        deps.executeScriptListener(w, w.onOp, clickCtx);
                        handled = true;
                    }

                    // CS2 handlers can mutate widgets (hide/text/position/etc). Ensure a repaint.
                    // This matches the behavior we already do for server-driven run_script events.
                    if (invokedAnyHandler && widgetManager) {
                        widgetManager.invalidateAll();
                    }

                    // If click handlers resumed a pause button, skip generic IF_BUTTON send.
                    const resumePauseTriggeredByHandler =
                        meslayerBeforePrimaryClick === null &&
                        (widgetManager?.meslayerContinueWidget ?? null) !== null;
                    if (resumePauseTriggeredByHandler) {
                        widgetInteraction.clickedWidgetHandled = true;
                        break;
                    }

                    // Mark that we already fired CS2 handlers for this widget click
                    // This prevents handleWidgetAction from firing them again on mouseup
                    if (handled) {
                        widgetInteraction.clickedWidgetHandled = true;
                    }

                    // Only transmit widget ops to the server when the transmit flag is set
                    // for the action (IF_SETEVENTS / Client.widgetFlags).
                    // Avoid double-send when the GL widget system already dispatches onWidgetAction.
                    const { option, target, slot, itemId, opIndex } = primaryAction;
                    try {
                        const payload = deps.buildWidgetActionPayload({
                            widget: w,
                            option,
                            target,
                            source: "primary",
                            cursorX: widgetInteraction.clickedWidgetX,
                            cursorY: widgetInteraction.clickedWidgetY,
                            slot,
                            itemId,
                            opIndex,
                        });
                        if (payload) {
                            // PlayerDesign (679): handle locally and do not transmit arrow/button ops.
                            // Confirm sends the OSRS appearance packet separately.
                            const groupId = (payload.widgetId >>> 16) & 0xffff;
                            const childId = payload.widgetId & 0xffff;
                            if (groupId === 182 && childId === 3) {
                                deps.handleWidgetAction({
                                    widget: w,
                                    option,
                                    target,
                                    source: "primary",
                                    cursorX: widgetInteraction.clickedWidgetX,
                                    cursorY: widgetInteraction.clickedWidgetY,
                                    slot,
                                    itemId,
                                    opIndex,
                                });
                                break;
                            }
                            if ((groupId | 0) === 679) {
                                if (deps.getPlayerDesign().handleWidgetAction(childId | 0)) {
                                    break;
                                }
                            }

                            const transmitFlagWidget = deps.resolveTransmitFlagWidget(
                                w,
                                payload,
                            );
                            const flags =
                                widgetManager?.getWidgetFlags?.(transmitFlagWidget) ??
                                transmitFlagWidget?.flags ??
                                0;
                            const opId = payload.opId ?? 0;
                            const actionIndex = opId > 0 ? opId - 1 : -1;
                            if (
                                actionIndex >= 0 &&
                                actionIndex <= 9 &&
                                !shouldTransmitAction(flags, actionIndex)
                            ) {
                                break;
                            }
                            sendWidgetAction(payload);
                        }
                    } catch (err) {
                        console.warn("[OsrsClient] widget action send failed", err);
                    }
                    break;
                }
            }
        }
    }
}
