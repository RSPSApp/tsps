import type { PluginMessagePayload } from "../../../common/network/PluginMessage";

const listeners = new Set<(message: PluginMessagePayload) => void>();

export function subscribePluginMessages(listener: (message: PluginMessagePayload) => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function emitPluginMessage(message: PluginMessagePayload): void {
    for (const listener of listeners) listener(message);
}
