import { assemble } from '/shared/mesh.mjs';
import { generateGearViews } from '/shared/gear-views.mjs';

export function createGearViews(ctx) {
    const {state,element:el,button}=ctx;
    let target='both',pending=false,preview=null;
    const stamp=()=>JSON.stringify(state.project);
    async function generate() {
        if(pending||!state.project)return;
        const project=state.project,snapshot=stamp(),targets=target==='both'?['female','inventory']:[target];
        pending=true;ctx.renderProperties();ctx.status('Fitting the other views to your male-worn edits…');
        try {
            const references={},notes=[];
            for(const variant of ['male',...targets]){
                try { references[variant]=(await ctx.api(`source?kind=item&id=${project.baseId}&variant=${variant}`)).mesh; }
                catch {
                    if(variant==='inventory')references.inventory=assemble(project.parts,'inventory');
                    else {
                        references[variant]=(await ctx.api(`mannequin?gender=${variant}&slots=`)).mesh;
                        notes.push(`${variant==='male'?'Male':'Female'} fitting uses the player body because the template has no worn model.`);
                    }
                }
                if(state.project!==project||stamp()!==snapshot)throw new Error('The item changed while references loaded. Generate again.');
            }
            const plan=generateGearViews(project,targets,references);
            preview={project,snapshot,plan,notes:[...notes,...plan.notes]};
            ctx.status('Draft views ready. Review the pictures, then Apply. Male worn stays unchanged.');
        } finally {pending=false;ctx.renderProperties();}
    }
    async function apply() {
        if(!preview||preview.project!==state.project||preview.snapshot!==stamp())throw new Error('The item changed. Generate the draft again.');
        const {plan}=preview;preview=null;ctx.stop?.();
        ctx.change(()=>{state.project.parts=plan.parts;if(plan.iconSettings)Object.assign(state.project.settings,plan.iconSettings);state.variant=plan.targets[0];state.selected=plan.generated[0]?.id;
            state.reference=null;if(state.variant==='inventory')state.previewSet=false;});
        await ctx.updateReference?.();ctx.render();ctx.viewport.fit();
        ctx.status('Generated views applied. Tweak each view as needed. Undo restores the previous views.');
    }
    function render(parent) {
        if(state.project?.kind!=='gear')return;
        if(preview?.project!==state.project)preview=null;
        const area=el('section',{class:'property-section gear-view-generator'},el('h3',{text:'Generate from male worn'}));parent.append(area);
        area.append(el('p',{class:'build-hint',text:'Carry your shape and paint edits into the other views, then tweak the fit.'}));
        const choose=el('select',{'aria-label':'Generate gear views',onChange:e=>{target=e.target.value;}},
            ...[['both','Female worn + inventory'],['female','Female worn'],['inventory','Inventory']].map(([value,text])=>el('option',{value,text,selected:target===value})));
        area.append(choose,button(pending?'Generating…':'Generate draft views',generate,{disabled:pending}));
        if(!preview)return;
        const stale=preview.snapshot!==stamp();
        const cards=el('div',{class:'gear-view-drafts'});
        for(const variant of preview.plan.targets){
            const canvas=el('canvas',{width:180,height:160,'aria-label':`${variant} generated draft`});
            cards.append(el('figure',{},canvas,el('figcaption',{text:variant==='female'?'Female worn':'Inventory'})));
            const mesh=assemble(preview.plan.parts,variant);
            queueMicrotask(()=>{if(canvas.isConnected)ctx.thumbnail(canvas,mesh,{kind:'item',variant,fields:{...state.project.settings,...preview.plan.iconSettings},skinOverlay:true});});
        }
        area.append(cards,...preview.notes.map(text=>el('p',{class:'build-hint',text})),
            el('p',{class:'build-hint',text:stale?'Edits changed. Generate again before applying.':'Apply replaces the selected destination views. Male worn is preserved. One Undo restores them.'}),
            button('Apply generated views',apply,{disabled:stale||pending}),button('Cancel draft',()=>{preview=null;ctx.renderProperties();}));
    }
    return {render,generate,apply};
}
