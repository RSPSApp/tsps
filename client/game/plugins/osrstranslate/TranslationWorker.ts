/* eslint-disable no-restricted-globals */
// Downloads, verifies and parses one release's dictionaries off the main thread (about 25 MB of
// JSON per language), then posts the parsed objects back.
import { loadReleaseFiles, type LanguageRelease } from "./TranslationRepository";
import type { TranslationWorkerReply } from "./workerLoadFiles";

const scope = self as unknown as {
    postMessage(message: TranslationWorkerReply): void;
    onmessage: ((event: MessageEvent<{ release: LanguageRelease }>) => void) | null;
    caches?: CacheStorage;
};

scope.onmessage = (event) => {
    loadReleaseFiles(event.data.release, {
        fetch: (...args) => fetch(...args),
        caches: scope.caches,
        subtle: crypto.subtle,
    }).then(
        (files) => scope.postMessage({ ok: true, files }),
        (error) => scope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
};

export {};
