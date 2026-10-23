import { useMemo, useState, useSyncExternalStore } from "react";
import { NavigationButton } from "@runelite/client/ui/NavigationButton";
import type { QuestHelperPlugin } from "./QuestHelperPlugin";
import type { HelperWidget, PixelBounds, RequirementState } from "./QuestHelperProtocol";
const row = { display: "block", width: "100%", textAlign: "left" as const, padding: "8px", marginBottom: 4, background: "#282828", color: "#eee", border: "1px solid #555", borderRadius: 3, cursor: "pointer" };
const clean = (text: string): string => text.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, "");
function Requirements({ items }: {
    items: readonly RequirementState[];
}): JSX.Element {
    return <ul style={{ paddingLeft: 18 }}>{items.map((requirement, index) => <li key={index} style={{ color: requirement.met ? "#8ade8a" : "#edb86d", marginBottom: 5 }}><span aria-label={requirement.met ? "Met" : "Not met"}>{requirement.met ? "✓" : "○"}</span> {clean(requirement.name)}{requirement.quantity !== undefined ? ` × ${requirement.quantity}` : ""}</li>)}</ul>;
}
export function QuestHelperPanel({ plugin }: {
    plugin: QuestHelperPlugin;
}): JSX.Element {
    const state = useSyncExternalStore(plugin.subscribe, plugin.getState, plugin.getState);
    const [search, setSearch] = useState("");
    const quests = useMemo(() => [...(state.catalog?.quests ?? [])].filter(quest => quest.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name)), [state.catalog, search]);
    const step = state.result?.activeStep;
    const selected = state.catalog?.quests.find(quest => quest.questKey === state.selected && quest.helperVariant === state.variant);
    return <div className="rl-sidebar-panel-content" style={{ padding: 12, color: "#ddd", fontSize: 13, overflowY: "auto" }}>
        <h2 style={{ fontSize: 18, margin: "0 0 12px" }}>Quest Helper</h2>
        <p role="status" style={{ color: "#e4c27a" }}>{state.status}</p>
        {state.selected && <section aria-label="Selected quest"><h3>{selected?.name ?? state.selected}</h3><button style={row} onClick={() => plugin.selectQuest("")}>Stop helping</button></section>}
        {state.result?.status === "active" && step && <section aria-label="Current quest step">
            {step.text.map((text, index) => <p key={index} style={{ whiteSpace: "pre-line", lineHeight: 1.5 }}>{clean(text)}</p>)}
            {!!step.requirements.length && <><h3>Requirements</h3><Requirements items={step.requirements}/></>}
            {!!step.dialogueChoices.length && <><h3>Dialogue choices</h3><ol>{step.dialogueChoices.map((choice, index) => <li key={index}>{clean(choice.text)}</li>)}</ol></>}
            {!!step.targets.length && <details><summary>Targets ({step.targets.length})</summary><ul>{step.targets.map((target, index) => <li key={index}>{target.label ? clean(target.label) : `${target.kind}${target.id !== undefined ? ` ${target.id}` : ""}`}{target.x !== undefined ? ` (${target.x}, ${target.y}, ${target.plane ?? "?"})` : ""}</li>)}</ul></details>}
        </section>}
        {state.result?.panels.map((panel, index) => <details key={index}><summary>{clean(panel.title)}</summary>{panel.text?.map((text, index) => <p key={index}>{clean(text)}</p>)}{panel.requirements && <Requirements items={panel.requirements}/>}</details>)}
        {!!state.result?.diagnostics.length && <section aria-label="Helper diagnostics"><h3>Helper diagnostics</h3>{state.result.diagnostics.map((diagnostic, index) => <p key={index} style={{ color: "#edb86d", overflowWrap: "anywhere" }}>{diagnostic.code}: {diagnostic.message}{diagnostic.method ? ` (${diagnostic.method})` : ""}</p>)}</section>}
        <button style={row} onClick={() => plugin.retry()}>Reconnect helper</button>
        <label htmlFor="quest-helper-search" style={{ display: "block", margin: "16px 0 6px" }}>Find a quest ({new Set(state.catalog?.quests.map(quest => quest.questKey)).size})</label>
        <input id="quest-helper-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search quests…" style={{ boxSizing: "border-box", width: "100%", padding: 8, marginBottom: 10, background: "#202020", border: "1px solid #666", color: "white" }}/>
        <div aria-label="Quest catalog">{quests.map(quest => <button key={`${quest.questKey}:${quest.helperVariant ?? ""}`} style={{ ...row, borderColor: quest.questKey === state.selected && quest.helperVariant === state.variant ? "#e4c27a" : "#555" }} aria-pressed={quest.questKey === state.selected && quest.helperVariant === state.variant} onClick={() => plugin.selectQuest(quest.questKey, quest.helperVariant)}>{quest.name}{quest.helperVariant ? ` — ${quest.helperVariant}` : ""}<small style={{ display: "block", color: quest.supported ? "#aaa" : "#edb86d" }}>{quest.supported ? "Guided route" : "Unsupported route"}</small></button>)}{state.catalog && !quests.length && <p>No matching quests.</p>}</div>
        {state.catalog && <p style={{ fontSize: 10, color: "#999", overflowWrap: "anywhere" }}>Helper source: {state.catalog.sourceCommit}</p>}
    </div>;
}
function QuestHelperIcon({ label }: {
    label: string;
}): JSX.Element { return <svg className="rl-sidebar-icon-svg" viewBox="0 0 24 24" role="img" aria-label={label}><path d="M6 3h12v18l-6-4-6 4V3zm3 5h6m-6 4h6"/></svg>; }
export function createQuestHelperNavigationButton(plugin: QuestHelperPlugin): NavigationButton { return NavigationButton.builder().tooltip("Quest Helper").icon(QuestHelperIcon).priority(6).panel(() => <QuestHelperPanel plugin={plugin}/>).build(); }
export function visibleHelperWidgetBounds(widgets: readonly HelperWidget[], ids: ReadonlySet<number>, itemIds: ReadonlySet<number>): PixelBounds[] {
    const result: PixelBounds[] = [];
    const walk = (widget: HelperWidget, ancestorHidden = false) => { const hidden = ancestorHidden || widget.hidden; if (!hidden && widget.bounds && (ids.has(widget.id) || (widget.itemId !== undefined && itemIds.has(widget.itemId))))
        result.push(widget.bounds); for (const child of widget.children ?? [])
        walk(child, hidden); };
    widgets.forEach(widget => walk(widget));
    return result;
}
export function QuestHelperOverlay({ plugin }: {
    plugin: QuestHelperPlugin;
}): JSX.Element | null {
    const state = useSyncExternalStore(plugin.subscribe, plugin.getState, plugin.getState);
    const snapshot = plugin.getSnapshot();
    const config = plugin.getConfig();
    const step = state.result?.activeStep;
    if (!plugin.isStarted() || !plugin.isEnabled() || state.result?.status !== "active" || !snapshot?.geometry || !step)
        return null;
    const widgetIds = new Set([...step.widgets.map(widget => widget.id), ...step.targets.filter(target => target.kind === "widget").flatMap(target => [...(target.id === undefined ? [] : [target.id]), ...(target.ids ?? [])])]);
    const itemIds = new Set(step.targets.filter(target => target.kind === "item").flatMap(target => [...(target.id === undefined ? [] : [target.id]), ...(target.ids ?? [])]));
    const bounds = config.highlightWidgets ? visibleHelperWidgetBounds(snapshot.widgets, widgetIds, itemIds) : [];
    const color = `#${(config.highlightColor >>> 0).toString(16).padStart(6, "0").slice(-6)}`;
    return <svg aria-hidden="true" viewBox={`0 0 ${snapshot.geometry.width} ${snapshot.geometry.height}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "hidden" }}>
        {bounds.map((rect, index) => <rect key={index} {...rect} fill="none" stroke={color} strokeWidth="2"/>)}
        {config.showOverlays && step.overlays.map((overlay, index) => {
            const stroke = overlay.color === undefined ? color : typeof overlay.color === "string" ? overlay.color : `#${(overlay.color >>> 0).toString(16).padStart(6, "0").slice(-6)}`;
            if (overlay.kind === "path")
                return <path key={index} d={overlay.path?.map(part => `${part.op}${part.values.join(" ")}`).join(" ")} fill={overlay.fill ?? "none"} stroke={overlay.stroke} strokeWidth={overlay.lineWidth ?? 1}/>;
            if (overlay.kind === "image")
                return <image key={index} href={overlay.dataUrl} x={overlay.x} y={overlay.y} width={overlay.width} height={overlay.height}/>;
            if (overlay.kind === "rect")
                return <rect key={index} x={overlay.x} y={overlay.y} width={overlay.width} height={overlay.height} fill="none" stroke={stroke} strokeWidth="2"/>;
            if (overlay.kind === "line")
                return <line key={index} x1={overlay.x} y1={overlay.y} x2={overlay.x2} y2={overlay.y2} stroke={stroke} strokeWidth="2"/>;
            if (overlay.kind === "text")
                return <text key={index} x={overlay.x} y={overlay.y} fill={stroke} stroke="#111" paintOrder="stroke" strokeWidth="2" fontSize={overlay.fontSize ?? 14}>{overlay.text}</text>;
            return <polygon key={index} points={overlay.points?.map(point => `${point.x},${point.y}`).join(" ")} stroke={stroke} fill="none" strokeWidth="2"/>;
        })}
    </svg>;
}
