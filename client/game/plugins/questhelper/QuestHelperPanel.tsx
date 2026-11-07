import { useState, useSyncExternalStore } from "react";
import { NavigationButton } from "@runelite/client/ui/NavigationButton";
import { imageIcon, runeliteImage } from "@runelite/client/ui/runeliteImages";
import type { QuestHelperPlugin, QuestHelperSettings } from "./QuestHelperPlugin";
import type { HelperOverview, HelperQuest, HelperSection, HelperWidget, PixelBounds, RequirementState } from "./QuestHelperProtocol";
import { wikiHref } from "./QuestHelperProtocol";
import { recommendedQuests } from "./QuestHelperRecommendations";
import { questLabel } from "./QuestHelperMenus";
import { Difficulty, QuestFilter, QuestHelperConfig, QuestOrdering } from "./QuestHelperConfig";
import { FILTER_SKILLS, filterTitle, questListSections, type AssistanceLevel } from "./QuestHelperOrdering";

/** The plugin surface the panel uses; tests pass a partial one. */
type PanelPlugin = Pick<QuestHelperPlugin, "getState" | "subscribe" | "selectQuest" | "retry"> & Partial<Pick<QuestHelperPlugin,
    "getConfig" | "setConfig" | "lockSection" | "getDirection" | "applyAssistance" | "assistanceLevel" | "assistanceChosen" | "filteredSkills" | "setSkillFiltered">>;

const clean = (text: string): string => text.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, "");
const css = (argb: number): string => `#${(argb >>> 0).toString(16).padStart(8, "0").slice(2)}`;
const enumLabel = (value: string): string => value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, " ");

/** The config defaults, for a plugin that can't read config (and for the first render). */
export function defaultSettings(): QuestHelperSettings {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(QuestHelperConfig.items)) out[key] = item.default;
    return out as QuestHelperSettings;
}

/** QuestRequirementsPanel colours: pass, fail, partially passed (bank), boostable, or gray. */
function requirementColor(requirement: RequirementState, settings: QuestHelperSettings): string {
    const state = requirement.state ?? (requirement.met ? "pass" : "fail");
    if (state === "pass") return css(settings.passColour);
    if (state === "partial") return css(settings.partialSuccessColour);
    if (state === "boost") return css(settings.boostColour);
    if (state === "neutral") return "var(--rl-light-gray)";
    return css(settings.failColour);
}

function Requirements({ items, settings, none = "None" }: { items?: readonly RequirementState[]; settings: QuestHelperSettings; none?: string }): JSX.Element {
    if (!items?.length) return <p className="rl-qh-none">{none}</p>;
    return <ul className="rl-qh-reqs">{items.map((requirement, index) => {
        // QuestRequirementsPanel's "Go to wiki..": an item link lands on its Item sources. Only the
        // wiki is ever linked, so a payload cannot turn a requirement into a link elsewhere.
        const href = wikiHref(requirement.wikiUrl);
        return <li key={index} style={{ color: requirementColor(requirement, settings) }} title={requirement.tooltip}>
            <span aria-label={requirement.met ? "Met" : "Not met"} className="rl-qh-check">{requirement.met ? "✓" : "○"}</span>
            {href
                ? <a className="rl-qh-req-link" href={href} target="_blank" rel="noopener noreferrer" title={requirement.tooltip ?? "Open this item's sources on the wiki."}>{clean(requirement.name)}</a>
                : clean(requirement.name)}
        </li>;
    })}</ul>;
}

/** A RuneLite collapsible: a bold header that toggles its body, with Quest Helper's arrows. */
function Collapsible({ title, children, open: initial = true, active = false, extra }: { title: string; children: React.ReactNode; open?: boolean; active?: boolean; extra?: React.ReactNode }): JSX.Element {
    const [open, setOpen] = useState(initial);
    return <section className={`rl-qh-collapsible${active ? " rl-qh-active" : ""}`}>
        <div className="rl-qh-collapsible-header">
            <button type="button" className="rl-qh-collapsible-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
                <img src={runeliteImage(open ? "quest_helper_expanded.png" : "quest_helper_collapsed.png")} alt="" width={9} height={9}/>
                <span>{title}</span>
            </button>
            {extra}
        </div>
        {open && <div className="rl-qh-collapsible-body">{children}</div>}
    </section>;
}

/** QuestOverviewPanel's requirement, notes, rewards and wiki sections. */
function Overview({ overview, settings }: { overview: HelperOverview; settings: QuestHelperSettings }): JSX.Element {
    const rewards = overview.rewards ?? [];
    const group = (type: string) => rewards.filter(r => r.type === type).map(r => clean(r.text));
    // Same rule as a requirement link: only the wiki is ever linked.
    const wiki = wikiHref(overview.wikiUrl);
    return <Collapsible title="Quest overview" open={false}>
        <h4>Requirements</h4><Requirements items={overview.generalRequirements} settings={settings}/>
        <h4>Recommended</h4><Requirements items={overview.generalRecommended} settings={settings}/>
        <h4>Items required</h4><Requirements items={overview.itemRequirements} settings={settings}/>
        <h4>Items recommended</h4><Requirements items={overview.itemRecommended} settings={settings}/>
        <h4>Combat requirements</h4>
        {overview.combatRequirements?.length ? <p>{overview.combatRequirements.map(clean).join(", ")}</p> : <p className="rl-qh-none">None</p>}
        {!!overview.notes?.length && <><h4>Notes</h4>{overview.notes.map((note, i) => <p key={i} className="rl-qh-note">{clean(note)}</p>)}</>}
        <h4>Rewards</h4>
        {settings.hideQuestRewards ? <p className="rl-qh-none">Hidden by the "Hide quest rewards" config</p> : !rewards.length ? <p className="rl-qh-none">None</p> : <>
            {[["QUEST_POINT", "Quest points"], ["EXPERIENCE", "Experience"], ["ITEM", "Items"], ["UNLOCK", "Unlocks"]].map(([type, title]) => group(type).length ?
                <div key={type}><b>{title}</b><ul className="rl-qh-plain">{group(type).map((text, i) => <li key={i}>{text}</li>)}</ul></div> : null)}
        </>}
        {wiki && <><h4>External resources</h4><a className="rl-qh-link" href={wiki} target="_blank" rel="noopener noreferrer" title="Open the official wiki in your browser.">Open RuneScape Wiki</a></>}
    </Collapsible>;
}

/** QuestStepPanel: a section's header (orange while current), lock box, requirements and steps. */
function Section({ section, plugin, settings }: { section: HelperSection; plugin: PanelPlugin; settings: QuestHelperSettings }): JSX.Element | null {
    if (section.hidden) return null;
    const lock = section.lockable && plugin.lockSection ? <input type="checkbox" className="rl-qh-lock" checked={!!section.locked} disabled={section.unlockable === false}
        title={section.locked ? "Mark section as incomplete" : "Mark section as complete"} aria-label={section.locked ? "Mark section as incomplete" : "Mark section as complete"}
        onChange={event => plugin.lockSection!(section.index, event.target.checked)}/> : null;
    return <Collapsible key={`${section.index}:${section.active}`} title={clean(section.title)} active={section.active} open={section.active || !section.locked} extra={lock}>
        {!!section.requirements.length && <><b>Requirements:</b><Requirements items={section.requirements} settings={settings}/></>}
        {!!section.recommended.length && <><b>Recommended:</b><Requirements items={section.recommended} settings={settings}/></>}
        <ol className="rl-qh-steps">{section.steps.map((step, i) =>
            <li key={i} className={step.active ? "rl-qh-step-active" : step.faded ? "rl-qh-step-faded" : undefined} title={step.tooltip} aria-current={step.active ? "step" : undefined}>
                {step.text.map(clean).join("\n")}
            </li>)}</ol>
        {section.children?.map(child => <Section key={child.index} section={child} plugin={plugin} settings={settings}/>)}
    </Collapsible>;
}

/** AssistLevelPanel: three presets for how much the helper shows. */
function Assistance({ plugin, onDone }: { plugin: PanelPlugin; onDone?: () => void }): JSX.Element {
    const current = plugin.assistanceLevel?.();
    const levels: [AssistanceLevel, string, string][] = [
        ["minimum", "Minimum Assistance", "This disables most overlay-based help, and hides puzzle solutions. This is a good option if you just want the sidebar with helpful information, as it will still track where you are in the quest, and show items needed."],
        ["medium", "Medium Assistance", "This enables most overlay-based help, but hides puzzle solutions. This is a good option if you want to still have guidance, but still solve certain parts for yourself."],
        ["full", "Full Assistance", "Gives you the full helper experience, highlighting objects & dialogue options, puzzler solvers, and with arrows so you know where to go."],
    ];
    return <section aria-label="Assistance level" className="rl-qh-assist">
        {levels.map(([level, title, description]) => <div key={level} className="rl-qh-assist-level">
            <b>{title}</b><p className="rl-sidebar-panel-copy">{description}</p>
            <button type="button" className={`rl-qh-button${current === level ? " rl-qh-button-active" : ""}`} onClick={() => { plugin.applyAssistance?.(level); onDone?.(); }}>Use {level} assistance</button>
        </div>)}
    </section>;
}

function Dropdown({ label, value, values, onChange, title = enumLabel }: { label: string; value: string; values: readonly string[]; onChange: (value: string) => void; title?: (value: string) => string }): JSX.Element {
    return <label className="rl-sidebar-field rl-qh-dropdown">
        <span>{label}</span>
        <select value={value} onChange={event => onChange(event.target.value)}>{values.map(v => <option key={v} value={v}>{title(v)}</option>)}</select>
    </label>;
}

/** QuestSelectPanel row: name in its state colour and the start button. */
function QuestRow({ quest, catalog, plugin, settings, selected }: { quest: HelperQuest; catalog: readonly HelperQuest[]; plugin: PanelPlugin; settings: QuestHelperSettings; selected: boolean }): JSX.Element {
    const color = quest.status === "FINISHED" ? css(settings.passColour) : quest.status === "IN_PROGRESS" ? "#f0cf7b" : "var(--rl-text)";
    const detail = quest.status === "FINISHED" ? "Complete" : !quest.supported ? "Unsupported route" : quest.eligibility?.eligible ? "Requirements met" : quest.eligibility?.missing.join("; ") || "Requirements not checked";
    return <button type="button" className="rl-qh-quest" aria-pressed={selected} onClick={() => plugin.selectQuest(quest.questKey, quest.helperVariant)}>
        <span className="rl-qh-quest-name" style={{ color }}>{questLabel(quest, catalog)}</span>
        <img src={runeliteImage("quest_helper_start.png")} alt="" width={16} height={16}/>
        <small className={quest.supported ? "rl-qh-quest-detail" : "rl-qh-quest-detail rl-qh-warn"}>{detail}</small>
    </button>;
}

export function QuestHelperPanel({ plugin }: { plugin: PanelPlugin }): JSX.Element {
    const state = useSyncExternalStore(plugin.subscribe, plugin.getState, plugin.getState);
    const settings = plugin.getConfig?.() ?? defaultSettings();
    const [search, setSearch] = useState("");
    const [showAssist, setShowAssist] = useState(false);
    const [showSkills, setShowSkills] = useState(false);
    const catalog = state.catalog?.quests ?? [];
    const skills = plugin.filteredSkills?.() ?? new Set<string>();
    const sections = questListSections(catalog, { ...settings, filteredSkills: skills, search, label: q => questLabel(q, catalog) });
    const step = state.result?.activeStep;
    const selected = catalog.find(quest => quest.questKey === state.selected && (!state.variant || quest.helperVariant === state.variant));
    const recommendations = recommendedQuests(catalog, state.result?.status === "complete" ? "" : state.selected);
    const tutorial = recommendations.find(quest => quest.questKey === "learning_the_ropes");
    const direction = plugin.getDirection?.();
    const technicalStatus = /(?:\b[A-Za-z_$]\w*\.){2,}|\b[A-Z]\w*\.[A-Za-z_$]\w*/.test(state.status);
    const showQuest = !!state.selected && !search;
    const needsAssist = showQuest && plugin.assistanceChosen && !plugin.assistanceChosen();
    const set = (key: keyof QuestHelperSettings) => (value: string | boolean) => plugin.setConfig?.(key, value);

    return <div className="rl-sidebar-scrollable rl-qh-panel">
        <div className="rl-qh-title">
            <span>Quest Helper</span>
            {plugin.applyAssistance && <button type="button" className="rl-qh-icon-button" aria-pressed={showAssist} title="Assistance level" onClick={() => setShowAssist(!showAssist)}>
                <img src={runeliteImage("quest_helper_settings_icon.png")} alt="Assistance level" width={16} height={16}/>
            </button>}
        </div>
        <p role="status" className="rl-qh-status">{technicalStatus ? "Quest Helper needs attention. Open helper diagnostics for details." : state.status}</p>
        {(showAssist || needsAssist) && <Assistance plugin={plugin} onDone={() => setShowAssist(false)}/>}
        <label className="rl-plugin-search rl-qh-search">
            <img className="rl-plugin-search-icon" src={runeliteImage("search.png")} alt="" width={24} height={24}/>
            <input type="search" value={search} aria-label="Search quests" placeholder="Search quests…" onChange={event => setSearch(event.target.value)}
                onKeyDown={event => { if (event.key === "Escape" && search) { event.stopPropagation(); setSearch(""); } }}/>
        </label>

        {showQuest ? <section aria-label="Selected quest" className="rl-qh-overview">
            <div className="rl-qh-quest-header">
                <h3>{selected ? questLabel(selected, catalog) : state.result?.overview?.name ?? "Selected quest"}</h3>
                <button type="button" className="rl-qh-icon-button" title="Stop helping" aria-label="Stop helping" onClick={() => plugin.selectQuest("")}>
                    <img src={runeliteImage("quest_helper_close.png")} alt="" width={14} height={14}/>
                </button>
            </div>
            {state.result?.status === "complete" && <p role="alert" className="rl-qh-complete">Quest complete! Choose your next guide below.</p>}
            {direction && <section aria-label="Quest directions" className="rl-qh-direction">
                <span aria-hidden="true" className="rl-qh-direction-arrow" style={{ transform: `rotate(${direction.bearing}deg)` }}>↑</span>
                <p>{direction.text}</p><small>Arrow points to the target; follow the step for doors, travel and obstacles.</small>
            </section>}
            {state.result?.status === "active" && step && <section aria-label="Current quest step" className="rl-qh-current">
                {step.text.map((text, index) => <p key={index} className="rl-qh-step-text">{clean(text)}</p>)}
                {!!step.requirements.length && <><b>Requirements:</b><Requirements items={step.requirements} settings={settings}/></>}
                {!!step.recommended?.length && <><b>Recommended:</b><Requirements items={step.recommended} settings={settings}/></>}
                {!!step.teleports?.length && <><b>Teleports:</b><Requirements items={step.teleports} settings={settings}/></>}
                {!!step.dialogueChoices.length && <><b>Dialogue choices</b><ol>{step.dialogueChoices.map((choice, index) => <li key={index}>{clean(choice.text)}</li>)}</ol></>}
            </section>}
            {state.result?.overview && <Overview overview={state.result.overview} settings={settings}/>}
            {state.result?.sections ? state.result.sections.map(section => <Section key={section.index} section={section} plugin={plugin} settings={settings}/>)
                : state.result?.panels.map((panel, index) => <details key={index}><summary>{clean(panel.title)}</summary>{panel.text?.map((text, i) => <p key={i}>{clean(text)}</p>)}{panel.requirements && <Requirements items={panel.requirements} settings={settings}/>}</details>)}
        </section> : <>
            {plugin.setConfig && <div className="rl-qh-filters">
                <Dropdown label="Filters" value={settings.filterListBy} values={Object.keys(QuestFilter)} onChange={set("filterListBy")} title={filterTitle}/>
                <Dropdown label="Difficulty" value={settings.difficulty} values={Object.keys(Difficulty)} onChange={set("difficulty")}/>
                <Dropdown label="Ordering" value={settings.orderListBy} values={Object.keys(QuestOrdering)} onChange={set("orderListBy")}/>
                <label className="rl-sidebar-check"><input type="checkbox" checked={settings.showCompletedQuests} onChange={event => set("showCompletedQuests")(event.target.checked)}/>Show completed quests</label>
                {plugin.setSkillFiltered && <>
                    <button type="button" className="rl-qh-button" aria-expanded={showSkills} onClick={() => setShowSkills(!showSkills)}>{skills.size ? `Skill filters (${skills.size})` : "Skill filters"}</button>
                    {showSkills && <div className="rl-qh-skills" aria-label="Skill filters">{FILTER_SKILLS.map(skill =>
                        <button type="button" key={skill} className={`rl-qh-skill${skills.has(skill) ? " rl-qh-skill-off" : ""}`} aria-pressed={skills.has(skill)}
                            title={skills.has(skill) ? `Show quests involving ${skill}` : `Hide quests involving ${skill}`} onClick={() => plugin.setSkillFiltered!(skill, !skills.has(skill))}>
                            <img src={runeliteImage(`skill_icons_small/${skill.toLowerCase()}.png`)} alt={skill} width={17} height={17}/>
                        </button>)}</div>}
                </>}
            </div>}
            {!search && !!recommendations.length && <section aria-label="Recommended quests">
                <h3>Recommended next</h3>
                <p className="rl-sidebar-panel-copy">{tutorial ? "Finish Tutorial Island first. The guide follows your progress through each lesson." : "Based on your base levels, completed quests, quest points and combat level. These quests meet the cache's start requirements."}</p>
                {recommendations.map(quest => <button type="button" key={quest.questKey} className="rl-qh-quest" onClick={() => plugin.selectQuest(quest.questKey, quest.helperVariant)}>
                    <span className="rl-qh-quest-name">{questLabel(quest, catalog)}</span>
                    <small className="rl-qh-quest-detail rl-qh-accent">{quest.status === "IN_PROGRESS" ? "Continue guide" : "Start guide"}</small>
                    {!!quest.eligibility?.recommendedMissing.length && <small className="rl-qh-quest-detail rl-qh-warn">Suggested preparation: {quest.eligibility.recommendedMissing.join("; ")}</small>}
                </button>)}
            </section>}
            {!search && state.catalog && !recommendations.length && <p className="rl-sidebar-panel-copy">No other eligible quests found yet. Check the quest list below for missing requirements.</p>}
            <div aria-label="Quest catalog">{sections.map((section, i) => <div key={i}>
                {section.title && <div className="rl-qh-section-title">{section.title}</div>}
                {section.quests.map(quest => <QuestRow key={`${quest.questKey}:${quest.helperVariant ?? ""}`} quest={quest} catalog={catalog} plugin={plugin} settings={settings}
                    selected={quest.questKey === state.selected && quest.helperVariant === state.variant}/>)}
            </div>)}
            {state.catalog && !sections.some(section => section.quests.length) && <p className="rl-sidebar-panel-copy">There are no quests available that match your current filters</p>}
            {!state.catalog && <p className="rl-sidebar-panel-copy">Please log in to see available quests</p>}
            </div>
        </>}

        {(state.catalog || state.result?.diagnostics.length || technicalStatus) && <details aria-label="Helper diagnostics" className="rl-qh-diagnostics"><summary>Helper diagnostics</summary>
            {technicalStatus && <p className="rl-qh-wrap">{state.status}</p>}
            {state.result?.diagnostics.map((diagnostic, index) => <p key={index} className="rl-qh-warn rl-qh-wrap">{diagnostic.code}: {diagnostic.message}{diagnostic.method ? ` (${diagnostic.method})` : ""}{diagnostic.helper ? ` — ${diagnostic.helper}` : ""}</p>)}
            {state.catalog && <p className="rl-sidebar-panel-copy rl-qh-wrap">Helper source: {state.catalog.sourceCommit}</p>}
        </details>}
        <button type="button" className="rl-qh-button" onClick={() => plugin.retry()}>Reconnect helper</button>
    </div>;
}

export function createQuestHelperNavigationButton(plugin: QuestHelperPlugin): NavigationButton { return NavigationButton.builder().tooltip("Quest Helper").icon(imageIcon(runeliteImage("quest_icon.png"))).priority(6).panel(() => <QuestHelperPanel plugin={plugin}/>).build(); }

export function visibleHelperWidgetBounds(widgets: readonly HelperWidget[], ids: ReadonlySet<number>, itemIds: ReadonlySet<number>): PixelBounds[] {
    const result: PixelBounds[] = [];
    const emitted = new Set<string>();
    const walk = (widget: HelperWidget, ancestorHidden = false) => {
        const hidden = ancestorHidden || widget.hidden;
        if (!hidden && widget.bounds && (ids.has(widget.id) || (widget.itemId !== undefined && itemIds.has(widget.itemId)))) {
            const key = `${widget.runtimeId ?? widget.id}:${widget.index ?? -1}`;
            if (!emitted.has(key)) { result.push(widget.bounds); emitted.add(key); }
        }
        for (const child of [...(widget.children ?? []), ...(widget.staticChildren ?? []), ...(widget.dynamicChildren ?? []), ...(widget.nestedChildren ?? [])]) if (child) walk(child, hidden);
    };
    widgets.forEach(widget => walk(widget));
    return result;
}

/** The engine's portable drawings: widget hints, world lines and puzzle solutions. */
export function QuestHelperOverlay({ plugin }: { plugin: QuestHelperPlugin }): JSX.Element | null {
    const state = useSyncExternalStore(plugin.subscribe, plugin.getState, plugin.getState);
    const snapshot = plugin.getSnapshot();
    const config = plugin.getConfig();
    const step = state.result?.activeStep;
    if (!plugin.isStarted() || !plugin.isEnabled() || state.result?.status !== "active" || !snapshot?.geometry || !step)
        return null;
    const widgetIds = new Set([...step.widgets.map(widget => widget.id), ...step.targets.filter(target => target.kind === "widget").flatMap(target => [...(target.id === undefined ? [] : [target.id]), ...(target.ids ?? [])])]);
    const bounds = config.showWidgetHints ? visibleHelperWidgetBounds(snapshot.widgets, widgetIds, new Set()) : [];
    const color = css(config.targetOverlayColor);
    return <svg aria-hidden="true" viewBox={`0 0 ${snapshot.geometry.width} ${snapshot.geometry.height}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "hidden" }}>
        {bounds.map((rect, index) => <rect key={index} {...rect} fill="none" stroke={color} strokeWidth="2"/>)}
        {step.overlays.map((overlay, index) => {
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
