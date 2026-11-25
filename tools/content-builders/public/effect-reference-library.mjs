import {ATTACK_RULES} from '../shared/attack-rules.mjs';
import {ATTACK_FEATURES} from '../shared/attack-features.mjs';
import {referencePicture} from './picker.mjs';
import {describeMechanic,resolveMechanics} from '../shared/native-mechanics.mjs';

/** Native references open at a readable width. Search, pages and mounted rows remain bounded. */
export function effectReferenceLibrary(ctx,parent,{kind,onChoose,onGraphic}){
    const {element:el,button}=ctx,host=el('div',{class:'combat-reference-library'}),title=kind==='special'?'Game special attacks':'Game set effects';parent.append(host);
    host.append(button(`Browse ${title.toLowerCase()}`,open,{class:'combat-browse-references'}));
    function open(){
        const input=el('input',{type:'search',placeholder:kind==='special'?'Search attack or weapon…':'Search set or effect…','aria-label':kind==='special'?'Search all special attacks':'Search all set effects'}),count=el('output',{'aria-live':'polite'}),scroll=el('div',{class:'combat-reference-scroll',tabIndex:0,'aria-label':'Native effect references'}),list=el('div',{class:'combat-reference-window'}),detail=el('section',{class:'combat-reference-detail'},el('h3',{text:'Select a reference'}),el('p',{text:'Read its complete description and inspect its available visual effects.'})),dialog=el('dialog',{class:'combat-reference-dialog','aria-label':title});
        dialog.append(el('header',{},el('h2',{text:title}),button('Close',()=>dialog.close(),{'aria-label':'Close reference library'})),el('div',{class:'combat-reference-search'},input,count),el('div',{class:'combat-reference-body'},scroll,detail));scroll.append(list);document.body.append(dialog);dialog.showModal();input.focus();
        let total=0,serial=0,timer,query='',selected=null,closed=false;const pages=new Map(),pending=new Set(),height=104;
        function show(row){
            selected=row;detail.replaceChildren(el('h3',{text:row.name}));
            if(kind==='special'){
                const picture=el('div',{class:'combat-reference-picture'});detail.append(picture);referencePicture(ctx,picture,'item',row.id,row.name);
                detail.append(el('p',{text:`${row.specialName.replaceAll('_',' ')}${row.energy===undefined?'':`. ${row.energy}% special energy.`}`}),button('Use this attack behavior',()=>{dialog.close();onChoose(row);},{class:'primary'}));
                if(row.recipe){detail.append(el('p',{text:'All features are copied into editable effects.'}));const effects=el('ul',{class:'combat-reference-recipe'});detail.append(effects);for(const modifier of row.recipe.modifiers??[{type:'damage',multiplier:row.damage},{type:'accuracy',multiplier:row.accuracy}])if(modifier.multiplier!==1)effects.append(el('li',{text:`${modifier.type==='damage'?'Damage':'Accuracy'} × ${Number(modifier.multiplier).toFixed(2)}`}));for(const rule of row.recipe.rules)effects.append(el('li',{text:ATTACK_RULES[rule.type].label}));for(const extra of row.recipe.extras)effects.append(el('li',{text:ATTACK_FEATURES[extra.type].name}));}
                const mechanics=resolveMechanics(row.mechanics),values=el('div',{class:'combat-reference-mechanics'});detail.append(values);for(const group of row.mechanics??[])values.append(el('h4',{text:group.name}),el('p',{text:describeMechanic(group,mechanics[group.id])}));
            }else detail.append(el('p',{class:'combat-reference-description',text:row.description}));
            if(kind!=='special'&&row.graphics.length)detail.append(button('Use this set’s VFX',()=>{dialog.close();onChoose(row);},{class:'primary'}));
            if(onGraphic&&row.graphics.length){const effects=el('div',{class:'combat-actions'});detail.append(el('h4',{text:'Referenced VFX'}),effects);for(const id of row.graphics)effects.append(button(`Add VFX ${id}`,()=>{dialog.close();onGraphic(row,id);}));}
            const source=el('details',{},el('summary',{text:'Reference source'}),el('small',{text:row.source}));detail.append(source);draw();
        }
        async function load(offset){const ticket=serial;if(closed||pages.has(offset)||pending.has(offset))return;pending.add(offset);
            try{const result=await ctx.api(`effect-references?kind=${kind}&q=${encodeURIComponent(query)}&offset=${offset}`);if(ticket!==serial||closed)return;total=result.total;pages.set(offset,result.rows);while(pages.size>4)pages.delete(pages.keys().next().value);list.style.height=`${total*height}px`;count.textContent=`${total} ${kind==='special'?'weapon references':'set effect references'}`;draw();}catch(error){if(ticket===serial&&!closed)count.textContent=error.message;}finally{if(ticket===serial)pending.delete(offset);}
        }
        function draw(){
            const first=Math.max(0,Math.floor(scroll.scrollTop/height)-1),end=Math.min(total,first+14),children=[];
            for(let index=first;index<end;index++){const offset=Math.floor(index/50)*50,row=pages.get(offset)?.[index-offset];if(!row){void load(offset);continue;}const card=button('',()=>show(row),{class:'combat-reference-row','aria-pressed':row.id===selected?.id});card.style.top=`${index*height}px`;if(kind==='special')referencePicture(ctx,card,'item',row.id,row.name);card.append(el('span',{},el('strong',{text:row.name}),el('small',{text:kind==='special'?`${row.specialName.replaceAll('_',' ')} • ${row.energy??'?'}% energy`:row.description.split('\n').filter(Boolean).slice(1).join(' ')})));children.push(card);}
            list.replaceChildren(...children);
        }
        scroll.addEventListener('scroll',draw,{passive:true});input.oninput=()=>{clearTimeout(timer);serial++;query=input.value.slice(0,100);pages.clear();pending.clear();total=0;scroll.scrollTop=0;list.replaceChildren();timer=setTimeout(()=>load(0),160);};
        dialog.addEventListener('close',()=>{closed=true;serial++;clearTimeout(timer);pages.clear();dialog.remove();},{once:true});void load(0);
    }
    return host;
}
