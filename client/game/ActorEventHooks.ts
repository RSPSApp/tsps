import type { HitsplatEventPayload } from "./GameRenderer";
import type { HealthBarEvent } from "./plugins/ClientPluginManager";

export type ActorGraphicUpdate = { type: "player" | "npc"; serverId: number; graphic: number };
const graphicListeners = new Set<(event: ActorGraphicUpdate) => void>();
const hitsplatListeners = new Set<(event: HitsplatEventPayload) => void>();
const healthListeners = new Set<(event: HealthBarEvent) => void>();
export function subscribeActorHealth(listener: (event: HealthBarEvent) => void): () => void {
    healthListeners.add(listener); return () => { healthListeners.delete(listener); };
}
export function notifyActorHealth(event: HealthBarEvent): void {
    for (const listener of healthListeners) listener(event);
}
export function subscribeActorGraphics(listener: (event: ActorGraphicUpdate) => void): () => void {
    graphicListeners.add(listener); return () => { graphicListeners.delete(listener); };
}
export function subscribeActorHitsplats(listener: (event: HitsplatEventPayload) => void): () => void {
    hitsplatListeners.add(listener); return () => { hitsplatListeners.delete(listener); };
}
export function notifyActorGraphic(event: ActorGraphicUpdate): void {
    for (const listener of graphicListeners) listener(event);
}
export function notifyActorHitsplat(event: HitsplatEventPayload): void {
    for (const listener of hitsplatListeners) listener(event);
}
