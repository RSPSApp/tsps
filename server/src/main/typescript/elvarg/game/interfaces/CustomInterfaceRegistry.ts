import { ContentApi } from "../../net/http/ContentApi";

/**
 * Interfaces that do not exist in the game cache, defined entirely by the server.
 *
 * A definition is the widget group plus the behaviour the client needs to drive it - which
 * component takes typing, where its rows come from, how they are laid out. Definitions are
 * addressable resources rather than something pushed down the socket on every open: they
 * are static, identical for every player, and tens of kilobytes each, so they are served
 * at /api/interfaces/<groupId> where the browser can revalidate them with an ETag.
 */
export type CustomInterfaceDefinition = {
    groupId: number;
    widgets: unknown[];
    /** Preserve this main panel during world interactions; explicit close/replacement still wins. */
    lifecycle?: { persistOnWorldInteraction?: boolean; blocksGameplay?: boolean };
    [key: string]: unknown;
};

export class CustomInterfaceRegistry {
    private static readonly definitions = new Map<number, CustomInterfaceDefinition>();
    private static endpointRegistered = false;

    public static register(definition: CustomInterfaceDefinition): void {
        const groupId = definition?.groupId | 0;
        if (!groupId || !Array.isArray(definition?.widgets)) {
            throw new Error("A custom interface needs a groupId and its widgets");
        }
        this.definitions.set(groupId, definition);
        this.ensureEndpoint();
    }

    public static get(groupId: number): CustomInterfaceDefinition | undefined {
        return this.definitions.get(groupId | 0);
    }

    public static clear(): void {
        this.definitions.clear();
    }

    /** GET /api/interfaces/<groupId>, registered once the first definition appears. */
    private static ensureEndpoint(): void {
        if (this.endpointRegistered) {
            return;
        }
        ContentApi.register("interfaces", (_query, segments) => {
            const groupId = Number.parseInt(segments[0] ?? "", 10);
            if (!Number.isInteger(groupId)) {
                return undefined;
            }
            return this.get(groupId);
        });
        this.endpointRegistered = true;
    }
}
