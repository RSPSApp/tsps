import { parseCustomDefinitions, replaceCustomDefinitions } from "../../../custom/definitions/CustomDefinitionStore";
import { CustomModelRegistry } from "../../../custom/items/CustomModelRegistry";
import type { OsrsClient } from "../../OsrsClient";

export const EDITOR_CUSTOM_CONTENT_REQUEST = "elvarg:custom-content-request";
export const EDITOR_CUSTOM_CONTENT_MESSAGE = "elvarg:custom-content";

export async function applyEditorCustomContent(client: OsrsClient, value: unknown): Promise<void> {
    const message = value as { type?: string; definitions?: unknown; models?: unknown } | null;
    if (message?.type !== EDITOR_CUSTOM_CONTENT_MESSAGE) throw new Error("Invalid editor custom content");
    const definitions = parseCustomDefinitions(message.definitions);
    // Validate both snapshots before changing either registry.
    CustomModelRegistry.replace(message.models);
    replaceCustomDefinitions(definitions);
    client.npcTypeLoader?.clearCache();
    client.locTypeLoader?.clearCache();
    client.objTypeLoader?.clearCache();
    client.objModelLoader?.clearCache();
    const payload = { gamemodeId: "editor", datasets: [
        { key: "customModels", rows: [] },
        { key: "customModels", rows: CustomModelRegistry.getAll() },
        { key: "customDefinitions", rows: definitions },
    ] };
    await client.workerPool?.runAll(worker => worker.setCustomContent(payload));
    client.renderer?.invalidateDefinitionCaches();
}

/** Only the parent host can supply editor content; old hosts can ignore the bounded requests. */
export function connectEditorCustomContent(client: OsrsClient, host: WindowProxy, origin: string, ready: () => void): () => void {
    let applying = false;
    let pending: unknown;
    let attempts = 0;
    const stop = () => {
        window.clearInterval(retry);
        window.removeEventListener("message", receive);
    };
    const receive = (event: MessageEvent) => {
        if (event.source !== host || event.origin !== origin || event.data?.type !== EDITOR_CUSTOM_CONTENT_MESSAGE) return;
        pending = event.data;
        if (applying) return;
        applying = true;
        void (async () => {
            while (pending) {
                const content = pending;
                pending = undefined;
                try {
                    await applyEditorCustomContent(client, content);
                    window.clearInterval(retry);
                    ready();
                } catch (error) {
                    console.warn("[edit-mode] could not load custom content", error);
                }
            }
            applying = false;
        })();
    };
    const request = () => {
        if (applying) return;
        if (host.closed || attempts++ >= 5) { window.clearInterval(retry); return; }
        host.postMessage({ type: EDITOR_CUSTOM_CONTENT_REQUEST }, origin);
    };
    window.addEventListener("message", receive);
    const retry = window.setInterval(request, 2000);
    request();
    return stop;
}
