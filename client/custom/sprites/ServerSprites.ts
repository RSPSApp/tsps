import { fetchContent } from "../../network/serverConnection/contentApi";
import { state } from "../../network/serverConnection/state";
import { addSpriteOverride, removeSpriteOverride } from "../../widgets/gl/spriteOverrides";

/**
 * The world's own sprites, which the cache doesn't have: the server's `data/sprites`, from id
 * 30000 like custom interfaces (the welcome screen's rsps.app banner is 30000). The first time a
 * component shows one, the client fetches `/api/sprites/<id>` and draws it as a sprite override.
 * runelite-gateway adds the same files to the cache it serves the official client.
 */
export const SERVER_SPRITE_START = 30000;
const RETRY_MS = 10_000;

export type ServerSpriteDeps = {
    fetch: (path: string) => Promise<any>;
    add: (id: number, url: string) => void;
    remove: (id: number) => void;
};

const DEFAULT_DEPS: ServerSpriteDeps = { fetch: fetchContent, add: addSpriteOverride, remove: removeSpriteOverride };
const requested = new Set<number>();
const loaded = new Set<number>();
let connection: unknown;

/** Fetches sprite [id] from the connected world once, if it is in the world's range. */
export function requestServerSprite(id: number, deps: ServerSpriteDeps = DEFAULT_DEPS): void {
    if (!(id >= SERVER_SPRITE_START)) return;
    if (state.socket !== connection) {
        // Another world may have other sprites under the same ids.
        connection = state.socket;
        requested.clear();
        for (const old of loaded) deps.remove(old);
        loaded.clear();
    }
    if (requested.has(id)) return;
    requested.add(id);
    const from = connection;
    deps.fetch(`/api/sprites/${id}`).then(
        (sprite) => {
            if (from !== connection || typeof sprite?.png !== "string") return;
            loaded.add(id);
            deps.add(id, `data:image/png;base64,${sprite.png}`);
        },
        (error) => {
            console.warn(`[sprites] couldn't load sprite ${id} from the world`, error);
            setTimeout(() => { if (from === connection) requested.delete(id); }, RETRY_MS);
        },
    );
}
