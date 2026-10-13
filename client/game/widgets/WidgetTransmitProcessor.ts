import type { Cs2Vm, ScriptEvent } from "../../rs/cs2/Cs2Vm";
import { createScriptEvent } from "../../rs/cs2/Cs2Vm";
import type { WidgetManager } from "../../widgets/WidgetManager";
import type { TransmitCycles } from "../TransmitCycles";
import {
    isTransmitProcessingNeeded,
    resetTransmitDirtyFlags,
} from "../TransmitCycles";

export type WidgetTransmitProcessorDeps = {
    getWidgetManager: () => WidgetManager | undefined;
    getTransmitCycles: () => TransmitCycles;
    getCs2Vm: () => Cs2Vm | undefined;
    queueScriptEvent: (event: ScriptEvent, priority: number) => void;
    executeScriptListener: (widget: any, listener: any[]) => void;
};

/**
 * Timer scripts that rebuild a box at the mouse: 4725, the enhanced client's mouseover text
 * (set by 4726, built by 4728). These also run every frame the mouse moves. Other timers that
 * read the mouse stay on the client tick, since some of them count cycles.
 */
const MOUSE_FOLLOWING_TIMERS = new Set<number>([4725]);

/** The script event for a widget's onTimer handler, or undefined if it has none. */
function createTimerEvent(node: any): ScriptEvent | undefined {
    let args: any[] | undefined;
    if (Array.isArray(node.onTimer) && node.onTimer.length > 0) {
        args = node.onTimer;
    } else {
        const handler = node.eventHandlers?.onTimer;
        if (!handler || !(handler.scriptId > 0)) return undefined;
        const handlerObjectArgs =
            handler.objectArgs ?? (handler.stringArgs ? [...handler.stringArgs] : []);
        args = [handler.scriptId, ...handler.intArgs, ...handlerObjectArgs];
    }
    const event = createScriptEvent({ widget: node, args });
    (event as any).timerArgsSnapshot = node.onTimer;
    return event;
}

/**
 * Processes widget onTimer and transmit handlers at the engine level.
 */
export class WidgetTransmitProcessor {
    /** Widgets whose timer is one of MOUSE_FOLLOWING_TIMERS, as of the last timer pass. */
    private mouseFollowingTimers = new Set<any>();
    private mouseFollowingX = -1;
    private mouseFollowingY = -1;

    constructor(private readonly deps: WidgetTransmitProcessorDeps) {}

    /**
     * Re-runs the mouse-following timers when the mouse has moved since they last ran. Called
     * every frame: on the 20ms client tick alone the cursor box sits still between ticks and
     * trails the pointer on any display faster than 50Hz.
     */
    runMouseFollowingTimers(mouseX: number, mouseY: number): void {
        if (mouseX === this.mouseFollowingX && mouseY === this.mouseFollowingY) return;
        this.mouseFollowingX = mouseX;
        this.mouseFollowingY = mouseY;
        const cs2Vm = this.deps.getCs2Vm();
        if (!cs2Vm) return;
        for (const node of this.mouseFollowingTimers) {
            if (node.hidden) continue;
            const event = createTimerEvent(node);
            if (event && MOUSE_FOLLOWING_TIMERS.has(event.args[0] as number)) {
                cs2Vm.runScriptEvent(event);
            }
        }
    }

    processWidgetTimers(): void {
        this.mouseFollowingTimers.clear();
        // The tick's own run picks up this position; the next frame only re-runs on a move.
        this.mouseFollowingX = -1;
        this.mouseFollowingY = -1;
        const widgetManager = this.deps.getWidgetManager();
        if (!widgetManager || widgetManager.rootInterface === -1) return;
        const allRoots = widgetManager.getAllGroupRoots(widgetManager.rootInterface);
        if (!allRoots || allRoots.length === 0) return;

        const visited = new Set<number>();
        const stack: any[] = [];
        for (const r of allRoots) if (r) stack.push(r);

        for (const [containerUid, parent] of widgetManager.interfaceParents) {
            if (!parent) continue;
            if (widgetManager.isEffectivelyHidden(containerUid)) continue;
            if ((parent.group | 0) === (widgetManager.rootInterface | 0)) continue;
            const subRoots = widgetManager.getAllGroupRoots(parent.group);
            for (const r of subRoots) if (r) stack.push(r);
        }

        while (stack.length > 0) {
            const node = stack.pop();
            if (!node || typeof node !== "object") continue;
            const uid = (node.uid ?? 0) | 0;
            if (uid === 0 || visited.has(uid)) continue;
            visited.add(uid);
            if (node.hidden) continue;

            const event = createTimerEvent(node);
            if (event) {
                this.deps.queueScriptEvent(event, 1);
                if (MOUSE_FOLLOWING_TIMERS.has(event.args[0] as number)) {
                    this.mouseFollowingTimers.add(node);
                }
            }

            const staticChildren = widgetManager.getStaticChildrenByParentUid(uid);
            for (let i = staticChildren.length - 1; i >= 0; i--) {
                stack.push(staticChildren[i]);
            }

            if (Array.isArray(node.children)) {
                for (let i = node.children.length - 1; i >= 0; i--) {
                    stack.push(node.children[i]);
                }
            }
        }
    }

    processWidgetTransmits(): void {
        const widgetManager = this.deps.getWidgetManager();
        if (!widgetManager || widgetManager.rootInterface === -1) return;

        if (!isTransmitProcessingNeeded()) {
            return;
        }

        const cycles = this.deps.getTransmitCycles();
        const allRoots = widgetManager.getAllGroupRoots(widgetManager.rootInterface);
        if (!allRoots || allRoots.length === 0) {
            resetTransmitDirtyFlags();
            return;
        }

        const visited = new Set<number>();
        const visibleNodes: any[] = [];
        const queuedTransmitKeys = new Set<string>();
        const invRefreshGroupsAfterVarTransmit = new Set<number>();
        const stack: any[] = [];
        for (const r of allRoots) if (r) stack.push(r);

        for (const [containerUid, parent] of widgetManager.interfaceParents) {
            if (!parent) continue;
            if (widgetManager.isEffectivelyHidden(containerUid)) continue;
            if ((parent.group | 0) === (widgetManager.rootInterface | 0)) continue;
            const subRoots = widgetManager.getAllGroupRoots(parent.group);
            for (const r of subRoots) if (r) stack.push(r);
        }

        const queueTransmit = (
            node: any,
            handler: any,
            cacheHandler: any[],
            eventType?: string,
        ) => {
            if (eventType) {
                const key = `${((node?.uid ?? 0) as number) | 0}:${eventType}`;
                if (queuedTransmitKeys.has(key)) return;
                queuedTransmitKeys.add(key);
            }
            if (Array.isArray(cacheHandler) && cacheHandler.length > 0) {
                const event = createScriptEvent({
                    args: cacheHandler,
                    widget: node,
                });
                this.deps.queueScriptEvent(event, 0);
            } else if (handler) {
                const handlerObjectArgs =
                    handler.objectArgs ?? (handler.stringArgs ? [...handler.stringArgs] : []);
                const event = createScriptEvent({
                    args: [handler.scriptId, ...handler.intArgs, ...handlerObjectArgs],
                    widget: node,
                });
                this.deps.queueScriptEvent(event, 0);
            }
        };

        const shouldFire = (eventCycle: number, lastCycle: number): boolean => {
            return eventCycle > -1 && (lastCycle === -1 || eventCycle > lastCycle);
        };

        while (stack.length > 0) {
            const node = stack.pop();
            if (!node || typeof node !== "object") continue;
            const uid = (node.uid ?? 0) | 0;
            if (uid === 0 || visited.has(uid)) continue;
            visited.add(uid);

            if (node.hidden || node.isHidden) continue;
            visibleNodes.push(node);

            const lastCycle = node.lastTransmitCycle ?? -1;

            if (
                (node.onChatTransmit || node.eventHandlers?.onChatTransmit) &&
                shouldFire(cycles.chatCycle, lastCycle)
            ) {
                queueTransmit(
                    node,
                    node.eventHandlers?.onChatTransmit,
                    node.onChatTransmit,
                    "onChatTransmit",
                );
            }

            if (node.onStatTransmit || node.eventHandlers?.onStatTransmit) {
                const lastStatCount = node.lastChangedStatCount ?? 0;
                const currentStatCount = cycles.changedStatCount;

                if (currentStatCount > lastStatCount) {
                    let shouldFireStat = false;
                    const triggers = node.statTransmitTriggers;

                    if (triggers && triggers.length > 0 && currentStatCount - lastStatCount <= 32) {
                        scanStatLoop: for (let i = lastStatCount; i < currentStatCount; i++) {
                            const changedStatId = cycles.changedStatsBuffer[i & 31];
                            for (const triggerId of triggers) {
                                if (changedStatId === triggerId) {
                                    shouldFireStat = true;
                                    break scanStatLoop;
                                }
                            }
                        }
                    } else {
                        shouldFireStat = true;
                    }

                    if (shouldFireStat) {
                        queueTransmit(
                            node,
                            node.eventHandlers?.onStatTransmit,
                            node.onStatTransmit,
                            "onStatTransmit",
                        );
                    }

                    node.lastChangedStatCount = currentStatCount;
                }
            }

            if (node.onVarTransmit || node.eventHandlers?.onVarTransmit) {
                const lastVarpCount = node.lastChangedVarpCount ?? 0;
                const currentVarpCount = cycles.changedVarpCount;

                if (currentVarpCount > lastVarpCount) {
                    let shouldFireVar = false;
                    const triggers = node.varTransmitTriggers;

                    if (triggers && triggers.length > 0 && currentVarpCount - lastVarpCount <= 32) {
                        scanLoop: for (let i = lastVarpCount; i < currentVarpCount; i++) {
                            const changedVarpId = cycles.changedVarps[i & 31];
                            for (const triggerId of triggers) {
                                if (changedVarpId === triggerId) {
                                    shouldFireVar = true;
                                    break scanLoop;
                                }
                            }
                        }
                    } else {
                        shouldFireVar = true;
                    }

                    if (shouldFireVar) {
                        queueTransmit(
                            node,
                            node.eventHandlers?.onVarTransmit,
                            node.onVarTransmit,
                            "onVarTransmit",
                        );
                        const groupId =
                            typeof node.groupId === "number"
                                ? node.groupId | 0
                                : (((node.uid ?? 0) as number) >>> 16) | 0;
                        if (groupId > 0) {
                            invRefreshGroupsAfterVarTransmit.add(groupId);
                        }
                    }

                    node.lastChangedVarpCount = currentVarpCount;
                }
            }

            if (node.onInvTransmit || node.eventHandlers?.onInvTransmit) {
                const lastInvCount = node.lastChangedInvCount ?? 0;
                const currentInvCount = cycles.changedInvCount;

                if (currentInvCount > lastInvCount) {
                    let shouldFireInv = false;
                    const triggers = node.invTransmitTriggers;

                    if (triggers && triggers.length > 0 && currentInvCount - lastInvCount <= 32) {
                        scanInvLoop: for (let i = lastInvCount; i < currentInvCount; i++) {
                            const changedInvId = cycles.changedInvsBuffer[i & 31];
                            for (const triggerId of triggers) {
                                if (changedInvId === triggerId) {
                                    shouldFireInv = true;
                                    break scanInvLoop;
                                }
                            }
                        }
                    } else {
                        shouldFireInv = true;
                    }

                    if (shouldFireInv) {
                        queueTransmit(
                            node,
                            node.eventHandlers?.onInvTransmit,
                            node.onInvTransmit,
                            "onInvTransmit",
                        );
                    }

                    node.lastChangedInvCount = currentInvCount;
                }
            }

            if (
                (node.onMiscTransmit || node.eventHandlers?.onMiscTransmit) &&
                shouldFire(cycles.miscCycle, lastCycle)
            ) {
                queueTransmit(
                    node,
                    node.eventHandlers?.onMiscTransmit,
                    node.onMiscTransmit,
                    "onMiscTransmit",
                );
            }

            if (
                (node.onStockTransmit || node.eventHandlers?.onStockTransmit) &&
                shouldFire(cycles.stockCycle, lastCycle)
            ) {
                queueTransmit(
                    node,
                    node.eventHandlers?.onStockTransmit,
                    node.onStockTransmit,
                    "onStockTransmit",
                );
            }

            if (
                (node.onFriendTransmit || node.eventHandlers?.onFriendTransmit) &&
                shouldFire(cycles.friendCycle, lastCycle)
            ) {
                queueTransmit(
                    node,
                    node.eventHandlers?.onFriendTransmit,
                    node.onFriendTransmit,
                    "onFriendTransmit",
                );
            }

            if (
                (node.onClanTransmit || node.eventHandlers?.onClanTransmit) &&
                shouldFire(cycles.clanCycle, lastCycle)
            ) {
                queueTransmit(
                    node,
                    node.eventHandlers?.onClanTransmit,
                    node.onClanTransmit,
                    "onClanTransmit",
                );
            }

            if (
                (node.onClanSettingsTransmit || node.eventHandlers?.onClanSettingsTransmit) &&
                shouldFire(cycles.clanSettingsCycle, lastCycle)
            ) {
                queueTransmit(
                    node,
                    node.eventHandlers?.onClanSettingsTransmit,
                    node.onClanSettingsTransmit,
                    "onClanSettingsTransmit",
                );
            }

            if (
                (node.onClanChannelTransmit || node.eventHandlers?.onClanChannelTransmit) &&
                shouldFire(cycles.clanChannelCycle, lastCycle)
            ) {
                queueTransmit(
                    node,
                    node.eventHandlers?.onClanChannelTransmit,
                    node.onClanChannelTransmit,
                    "onClanChannelTransmit",
                );
            }

            node.lastTransmitCycle = cycles.cycleCntr;

            const staticChildren = widgetManager.getStaticChildrenByParentUid(uid);
            for (let i = staticChildren.length - 1; i >= 0; i--) {
                stack.push(staticChildren[i]);
            }

            if (Array.isArray(node.children)) {
                for (let i = node.children.length - 1; i >= 0; i--) {
                    stack.push(node.children[i]);
                }
            }
        }

        if (invRefreshGroupsAfterVarTransmit.size > 0) {
            for (const node of visibleNodes) {
                if (!node || !(node.onInvTransmit || node.eventHandlers?.onInvTransmit)) {
                    continue;
                }
                const groupId =
                    typeof node.groupId === "number"
                        ? node.groupId | 0
                        : (((node.uid ?? 0) as number) >>> 16) | 0;
                if (!invRefreshGroupsAfterVarTransmit.has(groupId)) continue;
                queueTransmit(
                    node,
                    node.eventHandlers?.onInvTransmit,
                    node.onInvTransmit,
                    "onInvTransmit",
                );
            }
        }

        resetTransmitDirtyFlags();
    }

    triggerInitialVarTransmitForGroup(groupId: number): void {
        const widgetManager = this.deps.getWidgetManager();
        const cs2Vm = this.deps.getCs2Vm();
        if (!widgetManager) return;

        const instance = widgetManager.getGroup(groupId);
        if (!instance) return;

        const currentVarpCount = this.deps.getTransmitCycles().changedVarpCount | 0;

        const allRoots = widgetManager.getAllGroupRoots(groupId);
        const stack: any[] = [...allRoots];
        while (stack.length > 0) {
            const node = stack.pop();
            if (!node || typeof node !== "object") continue;

            const triggers = node.varTransmitTriggers as number[] | undefined;
            if (triggers && triggers.length > 0) {
                if (node.eventHandlers?.onVarTransmit) {
                    cs2Vm?.invokeEventHandler(node, "onVarTransmit");
                } else if (Array.isArray(node.onVarTransmit) && node.onVarTransmit.length > 0) {
                    this.deps.executeScriptListener(node, node.onVarTransmit);
                }
                node.lastChangedVarpCount = currentVarpCount;
            }

            const staticChildren = widgetManager.getStaticChildrenByParentUid(node.uid);
            for (let i = staticChildren.length - 1; i >= 0; i--) {
                stack.push(staticChildren[i]);
            }

            if (Array.isArray(node.children)) {
                for (let i = node.children.length - 1; i >= 0; i--) {
                    stack.push(node.children[i]);
                }
            }
        }
    }
}
