import {
    isServerConnected,
    sendInventoryUse,
    sendInventoryUseOn,
    sendWidgetAction,
    sendWidgetActionMessage,
} from "../../network/ServerConnection";
import { ClientPacketId, createPacket, queuePacket } from "../../network/packet";
import type { Cs2Vm } from "../../rs/cs2/Cs2Vm";
import type { VarManager } from "../../rs/config/vartype/VarManager";
import type { Inventory } from "../../rs/inventory/Inventory";
import { buildSelectedSpellPayload } from "../../common/spells/selectedSpellPayload";
import {
    INTERFACE_ACHIEVEMENT_DIARY_ID,
    INTERFACE_QUEST_LIST_ID,
    SIDE_JOURNAL_GROUP_ID,
} from "../../common/ui/sideJournal";
import type { WidgetManager } from "../../widgets/WidgetManager";
import { isWidgetUseTarget } from "../../widgets/WidgetFlags";
import { ClientState } from "../ClientState";
import { createSelectedSpellOnWidgetPacket } from "../selectedSpellPackets";
import type { WidgetActionEvent } from "./widgetActionPayload";
import { spellWidgetChildSlot } from "./SpellSelectionController";

/** bankside: the inventory panel shown beside the open bank. */
const BANK_SIDE_GROUP = 15;

export type SelectedSpellInfo = {
    spellId: number;
    spellName: string;
    spellLevel?: number;
    runes?: Array<{ itemId: number; quantity: number; name?: string }>;
    sourceWidget?: any;
};

export type SpellSelectionState = {
    widgetId: number;
    childIndex: number;
    itemId: number;
};

export type WidgetActionHandlersDeps = {
    getWidgetManager: () => WidgetManager | undefined;
    getCs2Vm: () => Cs2Vm | undefined;
    getVarManager: () => VarManager | undefined;
    getInventory: () => Inventory | undefined;
    clearSelectedSpell: () => void;
    setSelectedSpell: (spell: SelectedSpellInfo | null, sourceWidget?: any) => void;
    normalizeSelectedSpellState: () => void;
    resolveSpellSelectionFromWidget: (
        widget: any,
        widgetUid: number,
        childId: number,
        itemId: number,
    ) => SpellSelectionState;
    getWidgetTargetMask: (widget: any) => number;
};

/** Settings cog, spell/item targeting, inventory ops. Returns true when fully handled. */
export function handleWidgetActionTargeting(
    deps: WidgetActionHandlersDeps,
    event: WidgetActionEvent,
    groupId: number,
    childId: number,
): boolean {
    if (!event.widget) return false;

    if (
        event.option === "Settings" &&
        (groupId === INTERFACE_QUEST_LIST_ID ||
            groupId === SIDE_JOURNAL_GROUP_ID ||
            groupId === INTERFACE_ACHIEVEMENT_DIARY_ID)
    ) {
        const widgetManager = deps.getWidgetManager();
        const varManager = deps.getVarManager();
        const cs2Vm = deps.getCs2Vm();
        const rootInterfaceId = widgetManager?.rootInterface ?? 161;
        let displayEnumId = 1130;
        if (rootInterfaceId === 165) displayEnumId = 1132;
        else if (rootInterfaceId === 548) displayEnumId = 1129;
        else if (rootInterfaceId === 164) displayEnumId = 1131;

        if (cs2Vm) {
            const script = (cs2Vm as any).context?.loadScript?.(914);
            if (script) {
                (cs2Vm as any).run(script, [1, displayEnumId, 11], []);
                console.log(
                    `[OsrsClient] Settings cog clicked - invoked script 914 to switch to Settings tab (enum=${displayEnumId})`,
                );
            } else {
                varManager?.setVarcInt(171, 11);
                console.log(
                    `[OsrsClient] Settings cog clicked (group=${groupId}, child=${childId}), set varcint171=11 (fallback)`,
                );
            }
        } else {
            varManager?.setVarcInt(171, 11);
            console.log(`[OsrsClient] Settings cog clicked - no VM, set varcint171=11 directly`);
        }
    }

    if (ClientState.isSpellSelected) {
        const timeSinceTargeting = Date.now() - ClientState.spellTargetEnteredFrame;
        if (timeSinceTargeting < 50) {
            console.log(
                `[OsrsClient] Ignoring spell-on-item in same click as targeting entry (${timeSinceTargeting}ms)`,
            );
            return true;
        }

        const targetItemId = event.itemId ?? event.widget.itemId ?? -1;
        const targetSlot = event.slot ?? event.widget.childIndex ?? childId;
        const targetWidgetUid = event.widget.uid;
        const isInventoryItem = targetItemId >= 0 || groupId === 149;

        if (ClientState.isItemSelected === 1 && isInventoryItem) {
            const isSameItem =
                targetSlot === ClientState.selectedItemSlot &&
                targetItemId === ClientState.selectedItemId;
            if (isSameItem) {
                console.log(
                    `[OsrsClient] Item clicked on itself - cancelling selection (slot=${targetSlot}, itemId=${targetItemId})`,
                );
                deps.clearSelectedSpell();
                ClientState.isItemSelected = 0;
                ClientState.selectedItemWidget = 0;
                ClientState.selectedItemSlot = 0;
                ClientState.selectedItemId = -1;
                return true;
            }
        }

        if (!isInventoryItem) {
            const widgetManager = deps.getWidgetManager();
            const targetFlags =
                widgetManager?.getWidgetFlags?.(event.widget) ??
                event.widget?.flags ??
                0;
            const targetHasWidgetUseTarget = isWidgetUseTarget(targetFlags);
            const spellCanTargetWidgets = (ClientState.selectedSpellTargetMask & 0x20) !== 0;

            if (spellCanTargetWidgets && !targetHasWidgetUseTarget) {
                console.log(
                    `[OsrsClient] Widget targeting rejected: target widget lacks WIDGET_USE_TARGET flag (targetFlags=0x${targetFlags.toString(
                        16,
                    )}, spellTargetMask=0x${ClientState.selectedSpellTargetMask.toString(16)})`,
                );
                deps.clearSelectedSpell();
                return true;
            }
        }

        if (isInventoryItem) {
            if (ClientState.isItemSelected === 1) {
                console.log(
                    `[OsrsClient] Item-on-item: "${ClientState.selectedSpellName}" (slot=${ClientState.selectedItemSlot}, itemId=${ClientState.selectedItemId}) -> item=${targetItemId}, slot=${targetSlot}`,
                );

                sendInventoryUseOn({
                    slot: ClientState.selectedItemSlot,
                    itemId: ClientState.selectedItemId,
                    target: {
                        kind: "inv",
                        slot: targetSlot,
                        itemId: targetItemId,
                    },
                });

                deps.clearSelectedSpell();
                ClientState.clearItemSelection();
                return true;
            }

            deps.normalizeSelectedSpellState();
            const selection = buildSelectedSpellPayload(
                ClientState.selectedSpellWidget,
                ClientState.selectedSpellChildIndex,
                ClientState.selectedSpellItemId,
            );
            if (!selection) {
                deps.clearSelectedSpell();
                return true;
            }

            console.log(
                `[OsrsClient] Spell-on-item: spell="${ClientState.selectedSpellName}" (group=${selection.spellbookGroupId}, child=${selection.widgetChildId}) -> item=${targetItemId}, slot=${targetSlot}`,
            );

            if (isServerConnected()) {
                queuePacket(
                    createSelectedSpellOnWidgetPacket(
                        targetWidgetUid,
                        targetSlot,
                        targetItemId,
                        selection,
                    ),
                );
            }

            deps.clearSelectedSpell();
            return true;
        }
    }

    const optionLower = (event.option || "").toLowerCase();
    const targetItemId = event.itemId ?? event.widget.itemId ?? -1;
    const isInventoryItem = targetItemId >= 0 || groupId === 149;
    const isEquipmentItem = (groupId === 387 || groupId === 84) && targetItemId >= 0;

    if (isEquipmentItem && (optionLower === "rub" || optionLower === "features")) {
        sendWidgetActionMessage({
            widgetId: ((groupId & 0xffff) << 16) | (childId & 0xffff),
            groupId,
            childId,
            option: event.option,
            target: event.target,
            opId: event.opIndex,
            slot: event.slot ?? event.widget.childIndex ?? childId,
            itemId: targetItemId,
        });
        return true;
    }

    if (isInventoryItem && optionLower === "use") {
        const targetSlot = event.slot ?? event.widget.childIndex ?? childId;
        const containerUid = event.widget.parentUid ?? event.widget.uid;

        ClientState.isItemSelected = 1;
        ClientState.selectedItemWidget = containerUid;
        ClientState.selectedItemSlot = targetSlot;
        ClientState.selectedItemId = targetItemId;

        ClientState.isSpellSelected = true;
        ClientState.selectedSpellWidget = containerUid;
        ClientState.selectedSpellChildIndex = targetSlot;
        ClientState.selectedSpellItemId = targetItemId;
        ClientState.selectedSpellActionName = "Use";
        ClientState.selectedSpellName = event.target || event.widget.name || "";
        ClientState.spellTargetEnteredFrame = Date.now();
        ClientState.selectedSpellTargetMask = 0x3f;

        console.log(
            `[OsrsClient] Entered item targeting mode: containerUid=${containerUid}, slot=${targetSlot}, itemId=${targetItemId}, name="${
                ClientState.selectedSpellName
            }", targetMask=0x${ClientState.selectedSpellTargetMask.toString(16)}`,
        );

        return true;
    }

    const inventoryItemActions = [
        "drop",
        "eat",
        "drink",
        "wear",
        "wield",
        "equip",
        "bury",
        "scatter",
        "light",
        "read",
        "open",
        "open-all",
        "empty",
        "destroy",
        "rub",
        "commune",
        "fill",
        "craft",
        "check",
        "boss log",
        "coin collection",
    ];
    // The bank's inventory panel (bankside, group 15) has its own ops: its op9 is the item's
    // bank op ("Empty" on a coal bag or fish barrel), which the server handles as a bank op.
    // Sent as a plain inventory option it would empty into the inventory, or do nothing for
    // items with no inventory "Empty".
    if (isInventoryItem && groupId !== BANK_SIDE_GROUP && inventoryItemActions.includes(optionLower)) {
        const targetSlot = event.slot ?? event.widget.childIndex ?? childId;
        const quantity = event.widget.itemQuantity ?? 1;
        console.log(
            `[OsrsClient] Inventory action: ${event.option} on slot=${targetSlot}, itemId=${targetItemId}`,
        );
        sendInventoryUse(targetSlot, targetItemId, quantity, event.option);
        return true;
    }

    let targetVerb = event.widget.targetVerb || event.widget.spellActionName;
    const isSpellbookWidget = groupId === 218 && childId > 0;
    const targetMask = deps.getWidgetTargetMask(event.widget);
    const needsTarget = targetMask > 0;

    if (
        isSpellbookWidget &&
        !needsTarget &&
        targetVerb &&
        (event.widget.name || event.widget.opBase || event.widget.spriteId >= 0)
    ) {
        sendWidgetAction({
            widgetId: ((groupId & 0xffff) << 16) | (childId & 0xffff),
            groupId: groupId | 0,
            childId: childId | 0,
            option: "Cast",
            target: event.target || event.widget.name || event.widget.opBase || "",
            opId: 1,
        });
        return true;
    }

    if (!targetVerb && isSpellbookWidget && needsTarget) {
        targetVerb = "null";
    }

    if (
        targetVerb &&
        typeof targetVerb === "string" &&
        targetVerb.length > 0 &&
        needsTarget
    ) {
        const spellSelection = deps.resolveSpellSelectionFromWidget(
            event.widget,
            event.widget.uid,
            spellWidgetChildSlot(event.widget),
            event.itemId ?? -1,
        );

        if (
            ClientState.isSpellSelected &&
            ClientState.selectedSpellWidget === spellSelection.widgetId
        ) {
            console.log(
                `[OsrsClient] Spell widget re-clicked while active, clearing selection: widget=${spellSelection.widgetId}`,
            );
            deps.clearSelectedSpell();
            return true;
        }

        ClientState.clearItemSelection();
        try {
            deps.getInventory()?.setSelectedSlot?.(null);
        } catch {}
        ClientState.isSpellSelected = true;
        ClientState.selectedSpellWidget = spellSelection.widgetId;
        ClientState.selectedSpellChildIndex = spellSelection.childIndex;
        ClientState.selectedSpellItemId = spellSelection.itemId;
        ClientState.selectedSpellActionName = targetVerb;
        ClientState.selectedSpellName =
            event.widget.opBase ||
            event.widget.dataText ||
            event.widget.name ||
            event.target ||
            "";
        ClientState.spellTargetEnteredFrame = Date.now();
        ClientState.selectedSpellTargetMask = targetMask;

        console.log(
            `[OsrsClient] Entered spell targeting mode: widget=${
                spellSelection.widgetId
            }, verb="${targetVerb}", name="${
                ClientState.selectedSpellName
            }", group=${(spellSelection.widgetId >>> 16) & 0xffff}, child=${
                spellSelection.childIndex
            }, targetMask=0x${ClientState.selectedSpellTargetMask.toString(16)}`,
        );

        deps.setSelectedSpell(
            {
                spellId: spellSelection.childIndex,
                spellName: ClientState.selectedSpellName,
                spellLevel: 1,
            },
            event.widget,
        );

        return true;
    }

    return false;
}

/** Pause/continue button widgets. Returns true when fully handled. */
export function handleWidgetActionPauseButton(
    deps: WidgetActionHandlersDeps,
    event: WidgetActionEvent,
): boolean {
    if (!event.widget) return false;

    const buttonText = String(event.widget.buttonText || "")
        .replace(/<[^>]+>/g, "")
        .toLowerCase();
    const isContinueButtonText = buttonText === "continue";
    const widgetText = String(event.widget.text || "")
        .replace(/<[^>]+>/g, "")
        .toLowerCase();
    const hasClickToContinue =
        widgetText.includes("click") && widgetText.includes("continue");

    const isPauseButtonWidget = isContinueButtonText || hasClickToContinue;

    if (!isPauseButtonWidget) return false;

    const widgetManager = deps.getWidgetManager();
    if (widgetManager?.canSendResumePauseButton(event.widget) ?? true) {
        const widgetUid =
            (typeof (event.widget as any).id === "number"
                ? (event.widget as any).id
                : (event.widget.uid ?? 0)) | 0;
        const childIndex =
            (typeof event.widget.childIndex === "number" &&
            (event.widget.childIndex | 0) >= 0
                ? event.widget.childIndex | 0
                : typeof event.widget.fileId === "number" && event.widget.fileId >= 0
                  ? event.widget.fileId | 0
                  : widgetUid & 0xffff) | 0;
        const pkt = createPacket(ClientPacketId.RESUME_PAUSEBUTTON);
        pkt.packetBuffer.writeShortAddLE(childIndex);
        pkt.packetBuffer.writeInt(widgetUid);
        queuePacket(pkt);
        if (widgetManager) {
            widgetManager.meslayerContinueWidget = event.widget;
            widgetManager.invalidateWidgetRender(event.widget);
        }
        console.log(
            `[OsrsClient] Pause button clicked: widget=${widgetUid}, childIndex=${childIndex}, buttonText=${isContinueButtonText}, textMatch=${hasClickToContinue}`,
        );
    }
    return true;
}
