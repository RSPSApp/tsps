import { strict as assert } from "node:assert";
import { requestServerSprite, SERVER_SPRITE_START, type ServerSpriteDeps } from "../custom/sprites/ServerSprites";
import { state } from "../network/serverConnection/state";

// The world's own sprites (the welcome screen's rsps.app banner is 30000) load from the server the
// first time a component draws one, once per connection, as sprite overrides.
const fetched: string[] = [];
const added: Array<[number, string]> = [];
const removed: number[] = [];
const replies = new Map<string, Promise<any>>();
const deps: ServerSpriteDeps = {
    fetch: (path) => { fetched.push(path); return replies.get(path) ?? Promise.resolve(undefined); },
    add: (id, url) => added.push([id, url]),
    remove: (id) => removed.push(id),
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

(async () => {
    state.socket = { first: true } as any;
    replies.set("/api/sprites/30000", Promise.resolve({ id: 30000, png: "iVBORw0KGgo=" }));

    requestServerSprite(SERVER_SPRITE_START - 1, deps);
    assert.deepEqual(fetched, [], "cache sprites are never asked for");

    requestServerSprite(30000, deps);
    requestServerSprite(30000, deps);
    await tick();
    assert.deepEqual(fetched, ["/api/sprites/30000"], "asked for once");
    assert.deepEqual(added, [[30000, "data:image/png;base64,iVBORw0KGgo="]]);

    requestServerSprite(30001, deps);
    await tick();
    assert.equal(added.length, 1, "an id the world doesn't have draws nothing");

    // A new connection may be another world: its sprites replace the old ones.
    state.socket = { second: true } as any;
    requestServerSprite(30000, deps);
    await tick();
    assert.deepEqual(removed, [30000]);
    assert.deepEqual(fetched, ["/api/sprites/30000", "/api/sprites/30001", "/api/sprites/30000"]);
    assert.equal(added.length, 2);

    state.socket = null;
    console.log("server-sprites: ok");
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
