import {Viewport} from './viewport.mjs';
import {visualFrame,visualDuration} from '../shared/visuals.mjs';

let openBrowser;
/** Windowed native assets, two model requests at a time. Audition never changes the document. */
export function browseVisuals(ctx,{kind='graphic',actor='player',npcId=-1,gender='male',value=-1,onChoose,onClose,settings=null,actionLabel}){
    openBrowser?.();
    const draft=structuredClone(settings??{});
    const {element:el,button}=ctx,movement=kind==='animation',title=movement?(actor==='player'?'Player movements':'Opponent movements'):'Visual effects';
    const dialog=el('dialog',{class:'combat-asset-dialog','aria-label':title}),heading=el('header',{},el('div',{},el('h2',{text:title}),el('p',{text:movement?'Preview a compatible movement before applying it.':'Browse animated effects at player scale. Select a tile to inspect it, then add it to your sequence.'})),button('Close',()=>closeDialog(),{'aria-label':`Close ${title.toLowerCase()}`}));
    const search=el('input',{type:'search',placeholder:movement?'Search movements or native IDs…':'Search VFX, weapons or native IDs…','aria-label':`Search ${title.toLowerCase()}`,autocomplete:'off'}),category=el('select',{'aria-label':'Movement category'},...Object.entries({all:'All movements',combat:'Combat',casting:'Casting',defence:'Defence',movement:'Idle and movement',emotes:'Emotes',other:'Other player actions'}).map(([id,name])=>el('option',{value:id,text:name}))),count=el('output',{'aria-live':'polite'}),toolbar=el('div',{class:'combat-browser-toolbar'},search);
    if(movement)toolbar.append(category);const animateTiles=el('input',{type:'checkbox',checked:!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches,'aria-label':'Animate preview tiles'});if(!movement)toolbar.append(el('label',{class:'combat-animate-tiles'},animateTiles,'Animate tiles'));toolbar.append(count);
    const scroll=el('div',{class:'combat-asset-scroll',tabIndex:0,'aria-label':`${title} results`}),grid=el('div',{class:'combat-asset-grid'});scroll.append(grid);
    const canvas=el('canvas',{width:640,height:420,'aria-label':'Selected asset preview'}),view=new Viewport(canvas,{passive:true});view.background='#353c43';view.outline=false;view.gizmo=false;view.grid=true;
    const selectedName=el('h3',{text:'Select a preview'}),meta=el('p'),error=el('p',{class:'combat-error',role:'alert'}),use=button(actionLabel??(movement?'Use movement':'Use visual effect'),()=>{if(!selected||!selectedAsset)return;if([...detail.querySelectorAll('input,select')].some(input=>!input.reportValidity()))return;const row=selected;try{onChoose(row.id,row,settings?{...draft,id:row.id}:undefined);closeDialog();}catch(e){error.textContent=e.message;}},{class:'primary',disabled:true}),play=button('Pause',()=>{playing=!playing;play.textContent=playing?'Pause':'Play';}),previous=button('Previous',()=>cycle(-1)),next=button('Next',()=>cycle(1)),seek=el('input',{type:'range',min:0,max:1000,step:10,value:0,'aria-label':'Scrub asset preview'}),time=el('output'),detail=el('section',{class:'combat-browser-preview'},canvas,selectedName,meta,el('div',{class:'combat-actions'},previous,play,next,time),seek,error);
    const framing=el('select',{'aria-label':'Preview framing'},el('option',{value:'reference',text:'Player scale'}),el('option',{value:'full',text:'Fit full effect'}));if(!movement)detail.querySelector('.combat-actions').insertBefore(framing,time);
    if(settings&&!movement){
        const options=el('section',{class:'combat-browser-draft'},el('h3',{text:'Effect settings'})),grid=el('div',{class:'combat-fields'});options.append(grid);detail.insertBefore(options,error);
        const change=()=>{if(selectedAsset){age=0;seek.max=previewDuration(selectedAsset);paint(view,selectedAsset,age);time.textContent=`0.00 / ${(previewDuration(selectedAsset)/1000).toFixed(2)} s`;}};
        for(const [label,key,choices] of [['Plays on','recipient',[['player','Player'],['target','Target'],['both','Player and target']]]]){const input=el('select',{'aria-label':label},...choices.map(([value,text])=>el('option',{value,text,selected:draft[key]===value})));input.onchange=()=>draft[key]=input.value;grid.append(el('label',{},label,input));}
        for(const [label,key,value,min,max] of [['Playback speed (%)','speed',(draft.speed??1)*100,10,400],['Hue shift (degrees)','hueShift',draft.hueShift??0,-180,180]]){const input=el('input',{type:'number',value,min,max,step:1,required:true,'aria-label':label});input.onchange=()=>{const n=Number(input.value);if(!input.value.trim()||!Number.isFinite(n)||n<min||n>max){input.setCustomValidity(`Enter a number from ${min} to ${max}.`);input.reportValidity();return;}input.setCustomValidity('');draft[key]=key==='speed'?n/100:n;change();};grid.append(el('label',{},label,input));}
        options.append(el('small',{text:'100% is normal speed. 50% plays twice as slowly. The preview reflects these settings. Timing and height can be edited after adding.'}));
    }
    detail.insertBefore(el('small',{text:'Drag to rotate. Scroll to zoom. Double-click to fit.'}),error);canvas.style.touchAction='none';
    const inspector=el('div',{class:'combat-browser-inspector'},detail,el('footer',{class:'combat-browser-footer'},use));
    dialog.append(heading,toolbar,el('div',{class:'combat-asset-body'},scroll,inspector));document.body.append(dialog);dialog.showModal();search.focus();
    let disposed=false,serial=0,query='',total=0,selected=null,selectedAsset=null,selectedIndex=-1,body=null,playing=true,age=0,last=performance.now(),lastPaint=0,frame,timer,hovered=-1,tileCursor=0;
    const pages=new Map(),pendingPages=new Set(),assets=new Map(),cards=new Map(),jobs=[],loading=new Set();let running=0,columns=3,first=-1,end=-1;
    const route=(offset=0)=>movement?`character-animations?actor=${actor}&npcId=${npcId}&category=${category.value}&q=${encodeURIComponent(query)}&offset=${offset}`:`search?kind=effect&q=${encodeURIComponent(query)}&offset=${offset}`;
    const duration=asset=>Math.max(20,asset?.duration??asset?.frames?.reduce((n,f)=>n+f.duration,0)??1000);
    const closeDialog=()=>{dialog.close();close();};
    function close(){if(disposed)return;disposed=true;serial++;cancelAnimationFrame(frame);clearTimeout(timer);observer.disconnect();pages.clear();assets.clear();cards.clear();jobs.length=0;selectedAsset=null;body=null;view.setItems([]);dialog.remove();if(openBrowser===closeDialog)openBrowser=null;onClose?.();}
    dialog.addEventListener('close',close,{once:true});openBrowser=closeDialog;
    const previewDuration=asset=>settings?visualDuration({...draft,delayMs:0,speed:draft.speed??1},duration(asset)):duration(asset);
    function items(asset,at,style={speed:1,loop:true}){
        const f=visualFrame(asset,style,at),mesh=f?{...asset.mesh,vertices:f.vertices,...(f.alpha?.length?{alpha:f.alpha}:{})}:asset.mesh;
        return movement?[{id:'movement',mesh}]:[{id:'dummy',mesh:body,reference:true,opacity:.4},{id:'vfx',mesh:style.height?{...mesh,vertices:mesh.vertices.map(([x,y,z])=>[x,y-style.height,z])}:mesh,hueShift:style.hueShift??0}];
    }
    function paint(target,asset,at,fit=false){const current=items(asset,at,target===view&&settings?draft:undefined);target.setItems(current);if(fit){
        if(!asset.previewBounds){const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];for(const frame of asset.frames??[{vertices:asset.mesh.vertices}])for(const point of frame.vertices)for(let i=0;i<3;i++){low[i]=Math.min(low[i],point[i]);high[i]=Math.max(high[i],point[i]);}asset.previewBounds=[low,high];}
        target.setItems(!movement&&(target!==view||framing.value==='reference')?[{id:'dummy',mesh:body}]:[...current,{id:'bounds',mesh:{vertices:asset.previewBounds,faces:[]}}]);target.fit();target.setItems(current);
    }target.draw(at);}
    framing.onchange=()=>{if(selectedAsset)paint(view,selectedAsset,age,true);};
    let drag=null;canvas.onpointerdown=event=>{canvas.setPointerCapture(event.pointerId);drag={x:event.clientX,y:event.clientY};};canvas.onpointermove=event=>{if(!drag)return;view.yaw+=(event.clientX-drag.x)*.01;view.pitch=Math.max(-1.4,Math.min(1.4,view.pitch+(event.clientY-drag.y)*.01));drag={x:event.clientX,y:event.clientY};if(selectedAsset)paint(view,selectedAsset,age);};canvas.onpointerup=canvas.onpointercancel=()=>drag=null;canvas.addEventListener('wheel',event=>{event.preventDefault();view.distance=Math.max(20,Math.min(18000,view.distance*Math.exp(event.deltaY*.001)));if(selectedAsset)paint(view,selectedAsset,age);},{passive:false});canvas.ondblclick=()=>{if(selectedAsset)paint(view,selectedAsset,age,true);};
    async function assetFor(id){
        if(!assets.has(id)){
            const token=serial,request=ctx.api(movement?`animation-preview?id=${id}&actor=${actor}&npcId=${npcId}&gender=${gender}`:`visual-effect?id=${id}`).then(asset=>{if(disposed||token!==serial)throw new Error('Preview changed.');return asset;}).catch(e=>{assets.delete(id);throw e;});
            assets.set(id,request);while(assets.size>14){const key=[...assets.keys()].find(key=>key!==selected?.id&&key!==id);if(key===undefined)break;assets.delete(key);}
        }
        return assets.get(id);
    }
    function pump(){while(running<2&&jobs.length){const job=jobs.shift();if(disposed||job.token!==serial||!job.card.isConnected){loading.delete(job.card);continue;}running++;assetFor(job.id).then(asset=>{
        if(disposed||job.token!==serial||!job.card.isConnected)return;
        const small=new Viewport(job.canvas,{passive:true});small.background='#30363c';small.outline=false;small.gizmo=false;small.grid=false;paint(small,asset,duration(asset)*.35,true);job.card._asset={view:small,asset};job.card.classList.remove('loading');
    }).catch(error=>{if(job.card.isConnected){job.card.classList.remove('loading');job.card.title=error.message;job.card.querySelector('small').textContent=`ID ${job.id} · Preview unavailable`;}}).finally(()=>{running--;loading.delete(job.card);pump();});}}
    function schedule(row,card,canvas){if(loading.has(card)||card._asset)return;loading.add(card);jobs.push({id:row.id,card,canvas,token:serial});pump();}
    async function load(offset){if(disposed||pendingPages.has(offset)||pages.has(offset))return;const token=serial;pendingPages.add(offset);try{const result=await ctx.api(route(offset));if(disposed||token!==serial)return;total=result.total;pages.set(offset,result.rows);while(pages.size>4)pages.delete(pages.keys().next().value);count.textContent=`${total.toLocaleString()} ${movement?(total===1?'movement':'movements'):'VFX'}`;draw();if(!total)grid.replaceChildren(el('p',{class:'combat-browser-empty',text:'No compatible results. Try another name or native ID.'}));}catch(e){if(!disposed&&token===serial)error.textContent=e.message;}finally{if(token===serial)pendingPages.delete(offset);}}
    const rowAt=index=>pages.get(Math.floor(index/50)*50)?.[index%50];
    async function choose(row,index){
        selected=row;selectedIndex=index;selectedAsset=null;use.disabled=true;error.textContent='';selectedName.textContent=row.name;meta.textContent=`${movement?'Movement':'VFX'} ID ${row.id}${row.category?` • ${row.category}`:''}`;age=0;playing=true;play.textContent='Pause';view.setItems([]);view.draw(0);
        for(const [i,card] of cards)card.setAttribute('aria-pressed',String(i===index));
        try{const asset=await assetFor(row.id);if(disposed||selected!==row)return;selectedAsset=asset;seek.max=previewDuration(asset);paint(view,asset,0,true);use.disabled=false;}catch(e){if(!disposed&&selected===row)error.textContent=e.message;}
    }
    async function cycle(delta){const index=Math.max(0,Math.min(total-1,selectedIndex<0?0:selectedIndex+delta));await load(Math.floor(index/50)*50);const row=rowAt(index);if(row){scroll.scrollTop=Math.floor(index/columns)*192;draw();void choose(row,index);}}
    function draw(){
        if(disposed)return;columns=Math.max(1,Math.floor(scroll.clientWidth/155));const start=Math.max(0,Math.floor(scroll.scrollTop/192)-1)*columns,stop=Math.min(total,start+(Math.ceil(scroll.clientHeight/192)+2)*columns);first=start;end=stop;grid.style.height=`${Math.ceil(total/columns)*192}px`;
        for(const [index,card] of cards)if(index<start||index>=stop){card._asset?.view.setItems([]);card._asset=null;card.remove();cards.delete(index);const row=rowAt(index);if(row&&row.id!==selected?.id)assets.delete(row.id);}
        for(let index=start;index<stop;index++){
            const row=rowAt(index);if(!row){void load(Math.floor(index/50)*50);continue;}
            let card=cards.get(index);
            if(!card){const small=el('canvas',{width:190,height:136,'aria-label':`${row.name} thumbnail`});card=button('',()=>choose(row,index),{class:'combat-asset-card loading','aria-label':`Preview ${row.name}`,'aria-pressed':row.id===selected?.id});card.append(small,el('strong',{text:row.name}),el('small',{text:`ID ${row.id}`}));card.dataset.assetId=row.id;card.onmouseenter=()=>{hovered=index;};card.onmouseleave=()=>{hovered=-1;};card.onfocus=()=>choose(row,index);cards.set(index,card);grid.append(card);schedule(row,card,small);}
            card.style.top=`${Math.floor(index/columns)*192}px`;card.style.left=`${index%columns*100/columns}%`;card.style.width=`calc(${100/columns}% - 8px)`;
        }
    }
    function reset(){serial++;query=search.value.trim();pages.clear();pendingPages.clear();assets.clear();loading.clear();jobs.length=0;for(const card of cards.values())card._asset?.view.setItems([]);cards.clear();grid.replaceChildren();scroll.scrollTop=0;total=0;first=end=-1;void load(0);}
    search.oninput=()=>{clearTimeout(timer);timer=setTimeout(reset,160);};category.onchange=reset;scroll.addEventListener('scroll',draw,{passive:true});
    dialog.addEventListener('keydown',event=>{if(['INPUT','SELECT'].includes(event.target.tagName))return;if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();void cycle(event.key==='ArrowRight'?1:-1);}if(event.code==='Space'){event.preventDefault();play.click();}});
    seek.oninput=()=>{age=Number(seek.value);playing=false;play.textContent='Play';if(selectedAsset)paint(view,selectedAsset,age);};
    const observer=new ResizeObserver(draw);observer.observe(scroll);
    function tick(now){if(disposed)return;const delta=Math.min(100,Math.max(0,now-last));last=now;if(playing&&selectedAsset)age=(age+delta)%previewDuration(selectedAsset);if(now-lastPaint>65){lastPaint=now;if(selectedAsset){paint(view,selectedAsset,age);seek.value=age;time.textContent=`${(age/1000).toFixed(2)} / ${(previewDuration(selectedAsset)/1000).toFixed(2)} s`;}const candidates=[...cards.values()].filter(card=>card._asset&&card.offsetTop+184>=scroll.scrollTop&&card.offsetTop<=scroll.scrollTop+scroll.clientHeight),budget=performance.now()+7;if(!movement&&animateTiles.checked){for(let n=0;n<Math.min(4,candidates.length);n++){const card=candidates[tileCursor++%candidates.length];paint(card._asset.view,card._asset.asset,now%duration(card._asset.asset));if(performance.now()>budget)break;}}else{const card=cards.get(hovered);if(card?._asset)paint(card._asset.view,card._asset.asset,now%duration(card._asset.asset));}}frame=requestAnimationFrame(tick);}
    frame=requestAnimationFrame(tick);
    Promise.resolve(movement?null:ctx.api(`mannequin?gender=${gender}&style=dummy&slot=NONE`)).then(result=>{if(disposed)return;body=result?.mesh?{...result.mesh,faces:result.mesh.faces.map(f=>[f[0],f[1],f[2],110])}:null;return load(0);}).then(async()=>{if(disposed)return;if(value>=0){const result=await ctx.api(movement?`character-animations?actor=${actor}&npcId=${npcId}&q=${value}`:`search?kind=effect&q=${value}`);if(!disposed&&result.rows[0])void choose(result.rows[0],-1);}else if(rowAt(0))void choose(rowAt(0),0);}).catch(e=>{if(!disposed)error.textContent=e.message;});
    return {dialog,close:closeDialog};
}
