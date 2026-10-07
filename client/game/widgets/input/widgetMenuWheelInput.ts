import type { WidgetInputControllerDeps, WidgetInputFrame } from "./widgetInputTypes";

export function processWidgetMenuWheelInput(
    deps: WidgetInputControllerDeps,
    frame: WidgetInputFrame,
): void {
    const { input } = frame;
    if (input.wheelDeltaY !== 0) {
        const menuUiState = (deps.getRenderer()?.canvas as any)?.__ui;
        const openMenu = menuUiState?.menu;
        const menuRt = menuUiState?.__menuRt;
        if (openMenu?.open && menuRt) {
            const canvasAny: any = deps.getRenderer()?.canvas;
            const inputScaleX = Number(canvasAny?.__uiInputScaleX ?? 1) || 1;
            const inputScaleY = Number(canvasAny?.__uiInputScaleY ?? 1) || 1;
            const menuMouseX = Math.round(input.mouseX * inputScaleX);
            const menuMouseY = Math.round(input.mouseY * inputScaleY);
            const rotation = input.wheelDeltaY > 0 ? 1 : -1;
            const margin = menuRt.closeMargin | 0 || 10;
            const withinRect = (r: any): boolean =>
                !!r &&
                menuMouseX >= r.x - margin &&
                menuMouseX <= r.x + r.w + margin &&
                menuMouseY >= r.y - margin &&
                menuMouseY <= r.y + r.h + margin;
            if (
                menuRt.submenuScrollMax > 0 &&
                menuRt.openSubMenuIndex > -1 &&
                withinRect(menuRt.subRect)
            ) {
                menuRt.submenuScroll = Math.min(
                    Math.max(menuRt.submenuScroll + rotation, 0),
                    menuRt.submenuScrollMax,
                );
                input.wheelDeltaY = 0;
            } else if (menuRt.menuScrollMax > 0 && withinRect(menuRt.mainRect)) {
                menuRt.menuScroll = Math.min(
                    Math.max(menuRt.menuScroll + rotation, 0),
                    menuRt.menuScrollMax,
                );
                input.wheelDeltaY = 0;
            }
        }
    }
}
