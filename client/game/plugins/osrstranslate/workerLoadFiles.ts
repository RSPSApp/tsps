import type { DictionaryFile } from "./TranslationState";
import { TranslationLoadError, type LanguageRelease, type LoadFiles } from "./TranslationRepository";

export type TranslationWorkerReply =
    | { ok: true; files: Partial<Record<DictionaryFile, Record<string, string>>> }
    | { ok: false; error: string };

/**
 * Loads a release in a fresh Web Worker that ends once it replies, so the parsed JSON it held is
 * freed. When workers are unavailable or the worker fails to start, `fallback` runs here.
 */
export function workerLoadFiles(fallback: LoadFiles): LoadFiles {
    return (release: LanguageRelease) => {
        if (typeof Worker === "undefined") return fallback(release);
        let worker: Worker;
        try {
            // Keep this exact `new Worker(new URL(...))` shape so webpack emits a worker chunk.
            worker = new Worker(new URL("./TranslationWorker.ts", import.meta.url));
        } catch {
            return fallback(release);
        }
        return new Promise((resolve, reject) => {
            worker.onmessage = (event: MessageEvent<TranslationWorkerReply>) => {
                worker.terminate();
                const reply = event.data;
                if (reply.ok) resolve(reply.files);
                else reject(new TranslationLoadError(reply.error));
            };
            worker.onerror = (event) => {
                event.preventDefault?.();
                worker.terminate();
                // The worker script itself failed (blocked or not built): load on this thread.
                fallback(release).then(resolve, reject);
            };
            worker.postMessage({ release });
        });
    };
}
