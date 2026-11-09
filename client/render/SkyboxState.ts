/** The GL capabilities the skybox draw changes; enable/disable go through picogl's app so its cache stays in step. */
export type SkyboxStateApp = {
    gl: Pick<WebGL2RenderingContext, "isEnabled" | "getParameter" | "DEPTH_TEST" | "CULL_FACE" | "BLEND" | "DEPTH_WRITEMASK">;
    enable(cap: number): unknown;
    disable(cap: number): unknown;
    depthMask(mask: boolean): unknown;
};

/**
 * Runs `draw` with depth test, depth writes and face culling off and blending on, then puts each
 * back exactly as it was: the scene's passes after the skybox rely on the frame's own settings
 * (culling is set once per frame, before the skybox).
 */
export function withSkyboxState(app: SkyboxStateApp, draw: () => void): void {
    const { gl } = app;
    const depthTest = gl.isEnabled(gl.DEPTH_TEST);
    const cullFace = gl.isEnabled(gl.CULL_FACE);
    const blend = gl.isEnabled(gl.BLEND);
    const depthWrite = gl.getParameter(gl.DEPTH_WRITEMASK) !== false;
    app.disable(gl.DEPTH_TEST);
    app.disable(gl.CULL_FACE);
    app.enable(gl.BLEND);
    app.depthMask(false);
    try {
        draw();
    } finally {
        app.depthMask(depthWrite);
        if (depthTest) app.enable(gl.DEPTH_TEST);
        else app.disable(gl.DEPTH_TEST);
        if (cullFace) app.enable(gl.CULL_FACE);
        else app.disable(gl.CULL_FACE);
        if (blend) app.enable(gl.BLEND);
        else app.disable(gl.BLEND);
    }
}
