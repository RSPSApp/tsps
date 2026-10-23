/** Facade – implementation in ./widgetsGl/ */
export {
    type WidgetNode,
    type GLRenderOpts,
    renderWidgetTreeGL,
    beginWidgetUiFrame,
    processWidgetUiInput,
    detachGLUI,
    cleanupInterfaceClickTargets,
    cleanupWidgetClickTarget,
    getVisibleWidgetSurfaceReason,
} from "./widgetsGl";
