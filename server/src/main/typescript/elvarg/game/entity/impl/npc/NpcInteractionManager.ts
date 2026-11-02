import type { PluginNpcInteractionEvent } from "../../../../plugins/PluginTypes";
import { NpcInteractionDefinition } from "../../../definition/NpcInteractionDefinition";
import { Location } from "../../../model/Location";
import { ShopManager } from "../../../model/container/shop/ShopManager";
import { TeleportHandler } from "../../../model/teleportation/TeleportHandler";
import { TeleportType } from "../../../model/teleportation/TeleportType";
import type { Player } from "../player/Player";
import type { NPC } from "./NPC";

type NpcInteractionHandler = (
    event: PluginNpcInteractionEvent
) => void | boolean;

interface RegisteredNpcInteractionMethod {
    source: string;
    handler: NpcInteractionHandler;
}

interface RegisteredNpcInteractionBinding {
    npcId: number;
    clickType: number;
    method: string;
    source: string;
}

export interface NpcInteractionViewAction {
    method: string;
    source: string;
    args?: Record<string, unknown>;
}

export interface NpcInteractionView {
    npcId: number;
    firstClick?: NpcInteractionViewAction;
    secondClick?: NpcInteractionViewAction;
    thirdClick?: NpcInteractionViewAction;
    fourthClick?: NpcInteractionViewAction;
    fifthClick?: NpcInteractionViewAction;
}

export class NpcInteractionManager {
    private static readonly pluginMethods = new Map<
        string,
        RegisteredNpcInteractionMethod
    >();
    private static readonly pluginBindings = new Map<
        string,
        RegisteredNpcInteractionBinding
    >();

    public static registerPluginInteraction(
        pluginName: string,
        npcIds: number[],
        clickType: number,
        handler: NpcInteractionHandler
    ): string {
        const namespace = this.pluginNamespace(pluginName);
        const localName = this.handlerName(handler);
        const method = `${namespace}.${localName}`;
        const existing = this.pluginMethods.get(method);
        if (existing && existing.handler !== handler) {
            console.warn(
                `[npc-interactions] ${method} was registered by more than one function; ` +
                "use unique named handlers to keep editor references unambiguous"
            );
        } else if (!existing) {
            this.pluginMethods.set(method, { source: pluginName, handler });
        }

        for (const npcId of npcIds) {
            const key = `${npcId}:${clickType}:${method}`;
            this.pluginBindings.set(key, {
                npcId,
                clickType,
                method,
                source: pluginName,
            });
        }
        return method;
    }

    public static handle(
        player: Player,
        npc: NPC,
        npcIndex: number,
        clickType: number
    ): boolean {
        const npcId = npc.getContentId(player);
        const action = NpcInteractionDefinition.forNpcId(npcId)?.getAction(clickType);
        if (!action) {
            return false;
        }

        try {
            if (action.method === "core.shops.open") {
                const shopId = Number(action.args.shopId);
                return Number.isInteger(shopId) && shopId >= 0
                    ? ShopManager.open(player, shopId, true)
                    : false;
            }
            if (action.method === "core.player.teleport") {
                const raw = action.args.destination as Record<string, unknown> | undefined;
                const x = Number(raw?.x);
                const y = Number(raw?.y);
                const z = Number(raw?.z ?? 0);
                if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
                    return false;
                }
                const destination = new Location(Math.trunc(x), Math.trunc(y), Math.trunc(z));
                if (TeleportHandler.checkReqs(player, destination)) {
                    TeleportHandler.teleport(
                        player,
                        destination,
                        TeleportType.NORMAL,
                        false
                    );
                }
                return true;
            }
            if (action.method === "core.dialogues.start") {
                const dialogueId = Number(action.args.dialogueId);
                return Number.isInteger(dialogueId) && dialogueId >= 0
                    ? player.getDialogueManager().startStaticDialogue(dialogueId)
                    : false;
            }

            const pluginMethod = this.pluginMethods.get(action.method);
            if (!pluginMethod) {
                console.warn(
                    `[npc-interactions] Unknown method ${action.method} for NPC ${npcId}`
                );
                return false;
            }
            const event: PluginNpcInteractionEvent = {
                player,
                npc,
                npcId,
                npcIndex,
                clickType,
                location: {
                    x: npc.getLocation().getX(),
                    y: npc.getLocation().getY(),
                    z: npc.getLocation().getZ(),
                },
                handled: false,
            };
            pluginMethod.handler(event);
            return true;
        } catch (error) {
            console.error(
                `[npc-interactions] Failed NPC ${npcId} click ${clickType} ` +
                `using ${action.method} from ${action.source}.`,
                error
            );
            return false;
        }
    }

    public static all(): NpcInteractionView[] {
        const byNpcId = new Map<number, NpcInteractionView>();
        for (const definition of NpcInteractionDefinition.all()) {
            const row: NpcInteractionView = { npcId: definition.getNpcId() };
            this.setViewAction(row, 1, definition.getFirstClick());
            this.setViewAction(row, 2, definition.getSecondClick());
            this.setViewAction(row, 3, definition.getThirdClick());
            this.setViewAction(row, 4, definition.getFourthClick());
            this.setViewAction(row, 5, definition.getFifthClick());
            byNpcId.set(row.npcId, row);
        }

        for (const binding of this.pluginBindings.values()) {
            const row = byNpcId.get(binding.npcId) ?? { npcId: binding.npcId };
            const property = this.clickProperty(binding.clickType);
            if (property && !row[property]) {
                row[property] = {
                    method: binding.method,
                    source: binding.source,
                };
            }
            byNpcId.set(binding.npcId, row);
        }
        return Array.from(byNpcId.values()).sort((left, right) => left.npcId - right.npcId);
    }

    private static setViewAction(
        row: NpcInteractionView,
        clickType: number,
        action: { method: string; source: string; args: Record<string, unknown> } | null
    ): void {
        const property = this.clickProperty(clickType);
        if (!property || !action) {
            return;
        }
        row[property] = {
            method: action.method,
            source: action.source,
            ...(Object.keys(action.args).length ? { args: action.args } : {}),
        };
    }

    private static clickProperty(
        clickType: number
    ): "firstClick" | "secondClick" | "thirdClick" | "fourthClick" | "fifthClick" | null {
        if (clickType === 1) return "firstClick";
        if (clickType === 2) return "secondClick";
        if (clickType === 3) return "thirdClick";
        if (clickType === 4) return "fourthClick";
        if (clickType === 5) return "fifthClick";
        return null;
    }

    private static pluginNamespace(pluginName: string): string {
        const normalized = String(pluginName || "plugin")
            .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "");
        return normalized || "plugin";
    }

    private static handlerName(handler: NpcInteractionHandler): string {
        const name = String(handler.name || "anonymous").replace(/[^A-Za-z0-9_$]/g, "_");
        return /^[A-Za-z_$]/.test(name) ? name : `_${name}`;
    }
}
