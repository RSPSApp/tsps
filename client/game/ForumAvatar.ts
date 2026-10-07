import type { OsrsClient } from "./OsrsClient";
import { PlayerChatheadFactory } from "../render/PlayerChatheadFactory";
import { PlayerAppearance } from "../rs/config/player/PlayerAppearance";
import { Model2DRenderer } from "../ui/model/Model2DRenderer";

// Existing dialogue expressions: happy, evil, annoyed, laughing, sad and angry.
const EXPRESSIONS = [588, 592, 595, 605, 610, 614];

/** Best-effort avatar capture after World 1 approves logout, without delaying logout. */
export async function uploadForumAvatar(client: OsrsClient, serverUrl: string): Promise<void> {
    if (window.location.origin !== "https://rsps.app" || serverUrl !== "wss://worlds.rsps.app/game") return;
    const index = client.playerEcs.getIndexForServerId(client.controlledPlayerServerId);
    const source = index === undefined ? undefined : client.playerEcs.getAppearance(index);
    if (!source) return;
    // Logout clears the ECS immediately; keep the appearance worn at that instant.
    const appearance = new PlayerAppearance(source.gender, [...source.colors], [...source.kits], [...source.equip]);

    const response = await fetch("/api/rsps/session", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!response.ok) return;
    const session = await response.json();
    if (!session.authenticated || session.hasAvatar) return;

    const factory = new PlayerChatheadFactory(client.modelLoader, client.textureLoader, client.idkTypeLoader, client.objTypeLoader);
    let model = factory.get(appearance);
    // Chat-head models stream separately from wearable models. Never upload a partial head.
    for (let attempt = 0; !model && attempt < 30; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        model = factory.get(appearance);
    }
    if (!model) return;
    const sequenceId = EXPRESSIONS[Math.floor(Math.random() * EXPRESSIONS.length)];
    const sequence = client.seqTypeLoader.load(sequenceId);
    if (!sequence) return;
    const frames = sequence.isSkeletalSeq() ? sequence.getSkeletalDuration() : sequence.frameIds?.length ?? 0;
    if (!frames) return;
    const sequenceFrame = Math.floor(frames * (0.2 + Math.random() * 0.6));
    // A static capture must wait for the expression's streamed animation frames.
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
        const overlay = sequence.chatFrameIds?.[sequenceFrame];
        ready = sequence.isSkeletalSeq()
            ? !!client.skeletalSeqLoader?.load(sequence.skeletalId)
            : !!client.seqFrameLoader.load(sequence.frameIds[sequenceFrame])
                && (overlay == null || (overlay & 0xffff) === 0xffff || !!client.seqFrameLoader.load(overlay));
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) return;
    const renderer = new Model2DRenderer(client.objTypeLoader, client.modelLoader, client.textureLoader,
        client.seqTypeLoader, client.seqFrameLoader, client.skeletalSeqLoader);
    const portrait = renderer.renderModelInstanceToCanvasExtents(model, { xan2d: 128, yan2d: 128, zoom2d: 600, orthographic: true, sequenceId, sequenceFrame });
    if (!portrait || portrait.canvas.width < 2 || portrait.canvas.height < 2) return;

    // Fit the visible head, not the model's invisible/back-facing vertex bounds.
    const pixels = portrait.canvas.getContext("2d")?.getImageData(0, 0, portrait.canvas.width, portrait.canvas.height).data;
    if (!pixels) return;
    let left = portrait.canvas.width, top = portrait.canvas.height, right = -1, bottom = -1;
    for (let y = 0; y < portrait.canvas.height; y++) {
        for (let x = 0; x < portrait.canvas.width; x++) {
            if (!pixels[(y * portrait.canvas.width + x) * 4 + 3]) continue;
            left = Math.min(left, x); right = Math.max(right, x);
            top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
    }
    if (right < left || bottom < top) return;
    const cropWidth = right - left + 1, cropHeight = bottom - top + 1;

    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const scale = 120 / Math.max(cropWidth, cropHeight);
    const width = cropWidth * scale;
    const height = cropHeight * scale;
    ctx.drawImage(portrait.canvas, left, top, cropWidth, cropHeight, (128 - width) / 2, (128 - height) / 2, width, height);
    const image = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!image) return;
    const body = new FormData();
    body.append("avatar", image, "chat-head.png");
    const uploaded = await fetch("/api/rsps/avatar", {
        method: "POST", credentials: "same-origin", headers: { "X-CSRF-Token": session.csrfToken },
        body, signal: AbortSignal.timeout(5000),
    });
    if (!uploaded.ok) throw new Error(`Forum avatar upload failed (${uploaded.status})`);
}
