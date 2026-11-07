import type { LoginRendererHost, RenderContext } from "./renderer/host";

/** A plugin may replace the login panel while retaining its layout, assets and scaling. */
export interface LoginScreenExtension {
    draw(host: LoginRendererHost, ctx: RenderContext): void;
    click(host: LoginRendererHost, x: number, y: number): void;
    key(key: string, char: string): boolean;
    hover(host: LoginRendererHost, x: number, y: number): void;
    submit(): void;
    hash(): string;
    textInput?(): { value: string; y: number; setValue(value: string): void } | undefined;
}
