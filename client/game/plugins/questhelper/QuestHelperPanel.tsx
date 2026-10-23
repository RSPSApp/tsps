import { useMemo, useState, useSyncExternalStore } from "react";
import { NavigationButton } from "@runelite/client/ui/NavigationButton";
import type { QuestHelperPlugin } from "./QuestHelperPlugin";
import type { HelperQuest, HelperWidget, PixelBounds, RequirementState } from "./QuestHelperProtocol";
import {recommendedQuests} from './QuestHelperRecommendations';
const row = { display: "block", width: "100%", textAlign: "left" as const, padding: "8px", marginBottom: 4, background: "#282828", color: "#eee", border: "1px solid #555", borderRadius: 3, cursor: "pointer" };
const clean = (text: string): string => text.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, "");
const variantLabels: Readonly<Record<string,string>> = {
    SHIELD_OF_ARRAV_PHOENIX_GANG: "Phoenix Gang",
    SHIELD_OF_ARRAV_BLACK_ARM_GANG: "Black Arm Gang",
    RECIPE_FOR_DISASTER_START: "Start",
    RECIPE_FOR_DISASTER_DWARF: "Mountain Dwarf",
    RECIPE_FOR_DISASTER_WARTFACE_AND_BENTNOZE: "Wartface and Bentnoze",
    RECIPE_FOR_DISASTER_PIRATE_PETE: "Pirate Pete",
    RECIPE_FOR_DISASTER_LUMBRIDGE_GUIDE: "Lumbridge Guide",
    RECIPE_FOR_DISASTER_EVIL_DAVE: "Evil Dave",
    RECIPE_FOR_DISASTER_MONKEY_AMBASSADOR: "King Awowogei",
    RECIPE_FOR_DISASTER_SIR_AMIK_VARZE: "Sir Amik Varze",
    RECIPE_FOR_DISASTER_SKRACH_UGLOGWEE: "Skrach Uglogwee",
    RECIPE_FOR_DISASTER_FINALE: "Final battle",
};
function questLabel(quest:HelperQuest, quests:readonly HelperQuest[]):string {
    const branch=quest.helperVariant && variantLabels[quest.helperVariant];
    return branch && quests.filter(other=>other.questKey===quest.questKey).length>1 ? `${quest.name} — ${branch}` : quest.name;
}
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
    const catalog=state.catalog?.quests ?? [];
    const quests = useMemo(() => [...(state.catalog?.quests ?? [])].filter(quest => questLabel(quest,state.catalog?.quests ?? []).toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name)), [state.catalog, search]);
    const step = state.result?.activeStep;
    const selected = state.catalog?.quests.find(quest => quest.questKey === state.selected && (!state.variant || quest.helperVariant === state.variant));
    const recommendations = recommendedQuests(catalog,state.result?.status==='complete'?'':state.selected);
    const tutorial = recommendations.find(quest=>quest.questKey==='learning_the_ropes');
    const direction=plugin.getDirection?.();
    const technicalStatus=/(?:\b[A-Za-z_$]\w*\.){2,}|\b[A-Z]\w*\.[A-Za-z_$]\w*/.test(state.status);
    return <div className="rl-sidebar-panel-content" style={{ padding: 12, color: "#ddd", fontSize: 13, overflowY: "auto" }}>
        <h2 style={{ fontSize: 18, margin: "0 0 12px" }}>Quest Helper</h2>
        <p role="status" style={{ color: "#e4c27a" }}>{technicalStatus?"Quest Helper needs attention. Open helper diagnostics for details.":state.status}</p>
        {state.selected && <section aria-label="Selected quest"><h3>{selected?questLabel(selected,catalog):"Selected quest"}</h3><button style={row} onClick={() => plugin.selectQuest("")}>Stop helping</button></section>}
        {state.result?.status==='complete'&&<p role="alert" style={{color:'#8ade8a',fontWeight:'bold'}}>Quest complete! Choose your next guide below.</p>}
        {direction&&<section aria-label="Quest directions" style={{border:'1px solid #6d704b',padding:8,marginBottom:10}}><span aria-hidden="true" style={{display:'inline-block',transform:`rotate(${direction.bearing}deg)`,fontSize:24,color:'#00ffff'}}>↑</span><p>{direction.text}</p><small>Arrow points to the target; follow the step for doors, travel and obstacles.</small></section>}
        {state.result?.status === "active" && step && <section aria-label="Current quest step">
            {step.text.map((text, index) => <p key={index} style={{ whiteSpace: "pre-line", lineHeight: 1.5 }}>{clean(text)}</p>)}
            {!!step.requirements.length && <><h3>Requirements</h3><Requirements items={step.requirements}/></>}
            {!!step.dialogueChoices.length && <><h3>Dialogue choices</h3><ol>{step.dialogueChoices.map((choice, index) => <li key={index}>{clean(choice.text)}</li>)}</ol></>}
            {!!step.targets.length && <details><summary>Targets ({step.targets.length})</summary><ul>{step.targets.map((target, index) => <li key={index}>{target.label ? clean(target.label) : `${target.kind}${target.id !== undefined ? ` ${target.id}` : ""}`}{target.x !== undefined ? ` (${target.x}, ${target.y}, ${target.plane ?? "?"})` : ""}</li>)}</ul></details>}
        </section>}
        {state.result?.panels.map((panel, index) => <details key={index}><summary>{clean(panel.title)}</summary>{panel.text?.map((text, index) => <p key={index}>{clean(text)}</p>)}{panel.requirements && <Requirements items={panel.requirements}/>}</details>)}
        {!!recommendations.length && <section aria-label="Recommended quests">
            <h3>Recommended next</h3>
            <p>{tutorial ? "Finish Tutorial Island first. The guide follows your progress through each lesson." : "Based on your base levels, completed quests, quest points and combat level. These quests meet the cache's start requirements."}</p>
            {recommendations.map(quest => <button key={quest.questKey} style={row} onClick={() => plugin.selectQuest(quest.questKey, quest.helperVariant)}>
                <strong>{questLabel(quest, catalog)}</strong>
                <small style={{ display: "block", color: "#e4c27a", marginTop: 4 }}>{quest.status === "IN_PROGRESS" ? "Continue guide" : "Start guide"}</small>
                {!!quest.eligibility?.recommendedMissing.length&&<small style={{display:'block',color:'#edb86d'}}>Suggested preparation: {quest.eligibility.recommendedMissing.join('; ')}</small>}
            </button>)}
        </section>}
        {state.catalog&&!recommendations.length&&<p>No other eligible quests found yet. Check the quest list below for missing requirements.</p>}
        {(state.catalog||state.result?.diagnostics.length||technicalStatus) && <details aria-label="Helper diagnostics"><summary>Helper diagnostics</summary>{technicalStatus&&<p style={{overflowWrap:"anywhere"}}>{state.status}</p>}{state.result?.diagnostics.map((diagnostic, index) => <p key={index} style={{ color: "#edb86d", overflowWrap: "anywhere" }}>{diagnostic.code}: {diagnostic.message}{diagnostic.method ? ` (${diagnostic.method})` : ""}{diagnostic.helper?` — ${diagnostic.helper}`:""}</p>)}{state.catalog&&<p style={{fontSize:10,color:"#999",overflowWrap:"anywhere"}}>Helper source: {state.catalog.sourceCommit}</p>}</details>}
        <button style={row} onClick={() => plugin.retry()}>Reconnect helper</button>
        <label htmlFor="quest-helper-search" style={{ display: "block", margin: "16px 0 6px" }}>Find a quest ({new Set(state.catalog?.quests.map(quest => quest.questKey)).size})</label>
        <input id="quest-helper-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search quests…" style={{ boxSizing: "border-box", width: "100%", padding: 8, marginBottom: 10, background: "#202020", border: "1px solid #666", color: "white" }}/>
        <div aria-label="Quest catalog">{quests.map(quest => <button key={`${quest.questKey}:${quest.helperVariant ?? ""}`} style={{ ...row, borderColor: quest.questKey === state.selected && quest.helperVariant === state.variant ? "#e4c27a" : "#555" }} aria-pressed={quest.questKey === state.selected && quest.helperVariant === state.variant} onClick={() => plugin.selectQuest(quest.questKey, quest.helperVariant)}>{questLabel(quest,catalog)}<small style={{ display: "block", color: quest.supported ? "#aaa" : "#edb86d" }}>{quest.status==='FINISHED'?'Complete':!quest.supported?'Unsupported route':quest.eligibility?.eligible?'Requirements met':quest.eligibility?.missing.join('; ')||'Requirements not checked'}</small></button>)}{state.catalog && !quests.length && <p>No matching quests.</p>}</div>
    </div>;
}
function QuestHelperIcon({ label }: {
    label: string;
}): JSX.Element { return <svg className="rl-sidebar-icon-svg" viewBox="0 0 24 24" role="img" aria-label={label}><path d="M6 3h12v18l-6-4-6 4V3zm3 5h6m-6 4h6"/></svg>; }
export function createQuestHelperNavigationButton(plugin: QuestHelperPlugin): NavigationButton { return NavigationButton.builder().tooltip("Quest Helper").icon(QuestHelperIcon).priority(6).panel(() => <QuestHelperPanel plugin={plugin}/>).build(); }
export function visibleHelperWidgetBounds(widgets: readonly HelperWidget[], ids: ReadonlySet<number>, itemIds: ReadonlySet<number>): PixelBounds[] {
    const result: PixelBounds[] = [];
    const emitted=new Set<string>();
    const walk = (widget: HelperWidget, ancestorHidden = false) => {
        const hidden = ancestorHidden || widget.hidden;
        if (!hidden && widget.bounds && (ids.has(widget.id) || (widget.itemId !== undefined && itemIds.has(widget.itemId)))) {
            const key=`${widget.runtimeId ?? widget.id}:${widget.index ?? -1}`;
            if(!emitted.has(key)){result.push(widget.bounds);emitted.add(key);}
        }
        for(const child of [...(widget.children ?? []),...(widget.staticChildren ?? []),...(widget.dynamicChildren ?? []),...(widget.nestedChildren ?? [])])if(child)walk(child,hidden);
    };
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
