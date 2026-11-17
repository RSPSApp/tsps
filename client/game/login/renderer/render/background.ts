import type { LoginRendererHost, RenderContext } from "../host";
import { getTitleBackgroundLayout } from "../layout/geometry";

export function drawTitleBackgroundToCtx(host: LoginRendererHost, ctx: RenderContext) {

        const image = host.customTitleBackgroundImage ?? host.titleBackgroundImage;
        if (!image) return;

        const bg = getTitleBackgroundLayout(host);
        ctx.drawImage(
            image,
            bg.drawX,
            bg.drawY,
            bg.drawW,
            bg.drawH,
        );
    
}
