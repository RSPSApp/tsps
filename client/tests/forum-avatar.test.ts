import assert from "node:assert/strict";
import { uploadForumAvatar } from "../game/ForumAvatar";
import { PlayerChatheadFactory } from "../render/PlayerChatheadFactory";
import { PlayerAppearance, Gender } from "../rs/config/player/PlayerAppearance";
import { Model2DRenderer } from "../ui/model/Model2DRenderer";

async function main(): Promise<void> {
    (globalThis as any).location = { origin: "https://rsps.app" };
    (globalThis as any).window = { location: (globalThis as any).location };
    const source = new PlayerAppearance(Gender.FEMALE, [1, 2, 3, 4, 5], [10, 11, 12, 13, 14, 15, 16], [1163]);
    const client: any = { controlledPlayerServerId: 42,
        playerEcs: { getIndexForServerId: () => 0, getAppearance: () => source },
        modelLoader: {}, textureLoader: {}, idkTypeLoader: {}, objTypeLoader: {},
        seqTypeLoader: { load: () => ({ isSkeletalSeq: () => false, frameIds: [10, 11, 12, 13, 14], chatFrameIds: [65535, 65535, 65535, 65535, 65535] }) },
        seqFrameLoader: { load: () => ({}) },
    };
    let session = { authenticated: true, hasAvatar: false, csrfToken: "forum-csrf" };
    const requests: { url: string; options?: RequestInit }[] = [];
    let captured: PlayerAppearance | undefined;
    let draws: number[][] = [];
    let missingModel = false;
    let rendered: any;
    const originalGet = PlayerChatheadFactory.prototype.get;
    const originalRender = Model2DRenderer.prototype.renderModelInstanceToCanvasExtents;
    PlayerChatheadFactory.prototype.get = function (appearance) {
        captured = appearance;
        return missingModel ? undefined : {} as any;
    };
    const pixels = new Uint8ClampedArray(80 * 100 * 4);
    for (let y = 20; y < 90; y++) for (let x = 10; x < 70; x++) pixels[(y * 80 + x) * 4 + 3] = 255;
    Model2DRenderer.prototype.renderModelInstanceToCanvasExtents = (_model, params) => {
        rendered = params;
        return { canvas: { width: 80, height: 100, getContext: () => ({ getImageData: () => ({ data: pixels }) }) } as any, offsetX: 0, offsetY: 0 };
    };
    (globalThis as any).document = { createElement: () => ({
        width: 0, height: 0,
        getContext: () => ({ drawImage: (_image: unknown, ...bounds: number[]) => draws.push(bounds) }),
        toBlob: (cb: (image: Blob) => void) => cb(new Blob(["png"], { type: "image/png" })),
    }) };
    globalThis.fetch = async (url, options) => {
        requests.push({ url: String(url), options });
        return new Response(JSON.stringify(String(url).endsWith("/session") ? session : { updated: true }));
    };
    const clear = () => { requests.length = 0; captured = undefined; draws = []; };
    try {
        await uploadForumAvatar(client, "wss://other.example/game");
        assert.equal(requests.length, 0, "other worlds must not set a forum avatar");
        (globalThis as any).location.origin = "https://another.example";
        await uploadForumAvatar(client, "wss://worlds.rsps.app/game");
        assert.equal(requests.length, 0, "only the same-origin official client uses the forum session");
        (globalThis as any).location.origin = "https://rsps.app";
        session.authenticated = false;
        await uploadForumAvatar(client, "wss://worlds.rsps.app/game");
        assert.equal(requests.length, 1); assert.equal(captured, undefined, "forum guests are skipped");
        clear(); session.authenticated = true; session.hasAvatar = true;
        await uploadForumAvatar(client, "wss://worlds.rsps.app/game");
        assert.equal(requests.length, 1); assert.equal(captured, undefined, "existing avatars are skipped before rendering");
        clear(); session.hasAvatar = false;
        const upload = uploadForumAvatar(client, "wss://worlds.rsps.app/game");
        source.equip[0] = -1; source.colors[0] = 0;
        await upload;
        assert.equal(captured?.gender, Gender.FEMALE);
        assert.equal(captured?.equip[0], 1163, "helmet at logout survives ECS reset");
        assert.equal(captured?.colors[0], 1, "appearance colours are snapshotted");
        assert.deepEqual(draws.map(bounds => bounds.map(value => Math.round(value * 10) / 10)), [[10, 20, 60, 70, 12.6, 4, 102.9, 120]], "visible head is centred and fills the square without cropping helmet or face");
        assert.ok([588, 592, 595, 605, 610, 614].includes(rendered.sequenceId), "uses a dialogue expression");
        assert.ok(rendered.sequenceFrame > 0 && rendered.sequenceFrame < 5, "captures an expression in progress");
        assert.equal(requests.length, 2);
        const posted = requests[1];
        assert.equal(posted.url, "/api/rsps/avatar");
        assert.equal(posted.options?.method, "POST");
        assert.equal(posted.options?.credentials, "same-origin");
        assert.deepEqual(posted.options?.headers, { "X-CSRF-Token": "forum-csrf" });
        const body = posted.options?.body as FormData;
        assert.equal((body.get("avatar") as File).name, "chat-head.png");
        assert.deepEqual([...body.keys()], ["avatar"], "target account comes only from the forum session");
        clear(); missingModel = true;
        await uploadForumAvatar(client, "wss://worlds.rsps.app/game");
        assert.equal(requests.length, 1, "unavailable/partial models must not create an avatar");
        clear(); missingModel = false; pixels.fill(0);
        await uploadForumAvatar(client, "wss://worlds.rsps.app/game");
        assert.equal(requests.length, 1, "fully transparent portraits are skipped");
        console.log("Forum avatar: official-world gating, login/avatar checks, logout appearance, portrait fit and CSRF upload passed.");
    } finally {
        PlayerChatheadFactory.prototype.get = originalGet;
        Model2DRenderer.prototype.renderModelInstanceToCanvasExtents = originalRender;
    }
}
void main();
