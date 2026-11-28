/* eslint-disable no-restricted-globals */
import { runLandscapeRequest } from "./LandscapeRequest";
import type { LandscapeSnapshot } from "./LocalLandscape";

self.onmessage = ({ data }: MessageEvent<{ snapshot: LandscapeSnapshot; part: string }>) => {
    try {
        self.postMessage({ result: runLandscapeRequest(data.snapshot, data.part) });
    } catch (error) {
        self.postMessage({ error: error instanceof Error ? error.message : String(error) });
    }
};
