import {
    NpcInteractionActionDefinition,
    NpcInteractionDefinition,
} from "../../NpcInteractionDefinition";
import { DefinitionLoader } from "../DefinitionLoader";

interface RawNpcInteractionDefinition {
    npcId?: unknown;
    firstClick?: unknown;
    first_click?: unknown;
    secondClick?: unknown;
    second_click?: unknown;
    thirdClick?: unknown;
    third_click?: unknown;
    fourthClick?: unknown;
    fourth_click?: unknown;
}

interface MutableNpcInteractionDefinition {
    firstClick: NpcInteractionActionDefinition | null;
    secondClick: NpcInteractionActionDefinition | null;
    thirdClick: NpcInteractionActionDefinition | null;
    fourthClick: NpcInteractionActionDefinition | null;
}

export class NpcInteractionDefinitionLoader extends DefinitionLoader {
    public static readonly DEFINITION_TYPE = "npc_interactions";

    public load(): boolean {
        const { sources, failures } = this.loadSources<RawNpcInteractionDefinition>(
            NpcInteractionDefinitionLoader.DEFINITION_TYPE
        );

        const mergedByNpcId = new Map<number, MutableNpcInteractionDefinition>();
        let candidates = 0;
        let invalid = 0;
        for (const source of sources) {
            candidates += source.definitions.length;
            for (const raw of source.definitions) {
                const npcId = Number(raw?.npcId);
                if (!Number.isInteger(npcId) || npcId < 0) {
                    invalid++;
                    continue;
                }
                const merged = mergedByNpcId.get(npcId) ?? {
                    firstClick: null,
                    secondClick: null,
                    thirdClick: null,
                    fourthClick: null,
                };
                this.mergeAction(raw, "firstClick", "first_click", source.owner, merged);
                this.mergeAction(raw, "secondClick", "second_click", source.owner, merged);
                this.mergeAction(raw, "thirdClick", "third_click", source.owner, merged);
                this.mergeAction(raw, "fourthClick", "fourth_click", source.owner, merged);
                if (merged.firstClick || merged.secondClick || merged.thirdClick || merged.fourthClick) {
                    mergedByNpcId.set(npcId, merged);
                } else {
                    invalid++;
                }
            }
        }

        const definitions = Array.from(mergedByNpcId.entries()).map(
            ([npcId, actions]) =>
                new NpcInteractionDefinition(
                    npcId,
                    actions.firstClick,
                    actions.secondClick,
                    actions.thirdClick,
                    actions.fourthClick
                )
        );
        NpcInteractionDefinition.replace(definitions);
        (invalid > 0 ? console.warn : console.debug)(
            `[npc-interactions] Loaded ${definitions.length} definitions from ` +
            `${sources.map((source) => source.name).join("+")} ` +
            `(candidates=${candidates}, invalid=${invalid})`
        );
        return failures === 0;
    }

    /** Plugins supply every definition, so there is no file; this only labels run()'s log. */
    public file(): string {
        return NpcInteractionDefinitionLoader.DEFINITION_TYPE;
    }

    private mergeAction(
        raw: RawNpcInteractionDefinition,
        camelCaseProperty: "firstClick" | "secondClick" | "thirdClick" | "fourthClick",
        snakeCaseProperty: "first_click" | "second_click" | "third_click" | "fourth_click",
        source: string,
        target: MutableNpcInteractionDefinition
    ): void {
        const hasCamelCase = Object.prototype.hasOwnProperty.call(
            raw,
            camelCaseProperty
        );
        const hasSnakeCase = Object.prototype.hasOwnProperty.call(
            raw,
            snakeCaseProperty
        );
        if (!hasCamelCase && !hasSnakeCase) {
            return;
        }
        const value = hasCamelCase
            ? raw[camelCaseProperty]
            : raw[snakeCaseProperty];
        const action = this.normalizeAction(value, source);
        if (action) {
            target[camelCaseProperty] = action;
        }
    }

    private normalizeAction(
        value: unknown,
        source: string
    ): NpcInteractionActionDefinition | null {
        if (!value || Array.isArray(value) || typeof value !== "object") {
            return null;
        }
        const raw = value as Record<string, unknown>;
        const explicitMethod = typeof raw.method === "string"
            ? raw.method.trim()
            : "";
        if (explicitMethod) {
            if (!/^[a-z][a-z0-9_]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(explicitMethod)) {
                return null;
            }
            const args = raw.args;
            if (args != null && (Array.isArray(args) || typeof args !== "object")) {
                return null;
            }
            return {
                method: explicitMethod,
                args: args == null ? {} : { ...(args as Record<string, unknown>) },
                source,
            };
        }
        const shopId = this.optionalId(raw.shopId ?? raw.shop_id);
        const dialogueId = this.optionalId(raw.dialogueId ?? raw.dialogue_id);
        const teleportLocation = this.location(
            raw.teleportLocation ?? raw.teleport_location
        );
        if (shopId !== null) {
            return { method: "core.shops.open", args: { shopId }, source };
        }
        if (teleportLocation !== null) {
            return {
                method: "core.player.teleport",
                args: {
                    destination: {
                        x: teleportLocation.x,
                        y: teleportLocation.y,
                        z: teleportLocation.z,
                    },
                },
                source,
            };
        }
        if (dialogueId !== null) {
            return {
                method: "core.dialogues.start",
                args: { dialogueId },
                source,
            };
        }
        return null;
    }

    private optionalId(value: unknown): number | null {
        return Number.isInteger(value) && (value as number) >= 0
            ? value as number
            : null;
    }

    private location(value: unknown): { x: number; y: number; z: number } | null {
        if (!value || Array.isArray(value) || typeof value !== "object") {
            return null;
        }
        const raw = value as Record<string, unknown>;
        const x = Number(raw.x);
        const y = Number(raw.y);
        const z = Number(raw.z ?? 0);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
            return null;
        }
        return { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) };
    }
}
