/** Same-origin editor presence and revision-conflict recovery. No document data is broadcast. */
export function createSaveConflictRecovery(ctx,win=window){
    const {element:el,button}=ctx,prefix='tsps-creator-tab:',tabId=`creator-${win.crypto.randomUUID()}`,channel=typeof win.BroadcastChannel==='function'?new win.BroadcastChannel('tsps-creator-tabs-v1'):null;
    let dialog=null,latest=null,pending=null,disposed=false,lastSaved=null;
    try{lastSaved=JSON.parse(win.sessionStorage.getItem('tsps-creator-last-save'));if(win.top===win)win.name=tabId;}catch{}
    const metadata=()=>({tabId,label:ctx.label().slice(0,160),mode:ctx.state.mode,variant:ctx.state.variant,framed:win.top!==win});
    function update(){if(disposed)return;try{win.localStorage.setItem(prefix+tabId,JSON.stringify({...metadata(),projectId:ctx.document()?.id??null,revision:ctx.state.revision,lastSaved,seen:Date.now()}));}catch{}}
    function saved(result){if(!result?.project||!result.revision)return;lastSaved={projectId:result.project.id,revision:result.revision};try{win.sessionStorage.setItem('tsps-creator-last-save',JSON.stringify(lastSaved));}catch{}update();channel?.postMessage({type:'saved',tabId,projectId:result.project.id,revision:result.revision});}
    function peers(){const rows=[];try{for(let i=0;i<win.localStorage.length;i++){const key=win.localStorage.key(i);if(!key?.startsWith(prefix))continue;try{const row=JSON.parse(win.localStorage.getItem(key));if(row.tabId!==tabId&&/^creator-[a-f0-9-]{36}$/.test(row.tabId)&&Date.now()-row.seen<86400000)rows.push(row);}catch{}}}catch{}return rows;}
    function writer(){const id=pending?.error?.conflict?.editor?.tabId,projectId=pending?.projectId;return peers().find(row=>row.tabId===id)??peers().filter(row=>row.lastSaved?.projectId===projectId&&row.lastSaved.revision===latest?.revision).sort((a,b)=>b.seen-a.seen)[0];}
    function focusPeer(row){
        channel?.postMessage({type:'focus',to:row.tabId,from:tabId,label:ctx.label(),projectId:pending?.projectId});
        if(!row.framed)try{const target=win.open('',row.tabId);if(target){if(target.location.href==='about:blank')target.close();else{target.focus();return;}}}catch{}
        ctx.status(`Requested focus for ${row.label}. If your browser blocks switching, select that Creator tab manually.`);
    }
    if(channel)channel.onmessage=event=>{const message=event.data;if(!message||message.tabId===tabId)return;if(message.type==='ping')update();if(message.type==='focus'&&message.to===tabId){try{win.top.focus();win.focus();}catch{}const banner=el('div',{class:'creator-conflict-banner',role:'status'},el('span',{text:'Another Creator tab requested this newer version.'}),button('Return to other tab',()=>focusPeer({tabId:message.from,label:message.label,framed:false})),button('Dismiss',()=>banner.remove()));win.document.querySelector('.creator-conflict-banner')?.remove();win.document.body.append(banner);}};
    function close(){dialog?.close();dialog?.remove();dialog=null;pending=null;latest=null;}
    async function show(error,attempt){
        const projectId=error.conflict?.projectId??attempt.data?.project?.id;
        if(!projectId||ctx.document()?.id!==projectId)return;
        const local=structuredClone(ctx.document()),context={activeItemId:ctx.state.project.id,variant:ctx.state.variant,mode:ctx.state.mode};
        close();pending={...attempt,error,projectId,local,context};const request=pending;channel?.postMessage({type:'ping'});
        dialog=el('dialog',{class:'creator-conflict-dialog','aria-label':'Resolve project save conflict'});const content=el('div',{class:'creator-conflict-content'});
        dialog.append(el('header',{},el('h2',{text:'This project has a newer save'}),button('Keep editing',close)),content);win.document.body.append(dialog);dialog.showModal();dialog.addEventListener('cancel',()=>close(),{once:true});
        const message=el('p',{text:'Loading the saved version…'});content.append(message);
        try{latest=await ctx.request(`projects/${encodeURIComponent(projectId)}`);}catch(e){if(e.status!==404){message.textContent=e.message;return;}latest={project:null,revision:null};}
        if(pending!==request)return;
        const peer=writer(),owner=error.conflict?.editor;
        message.textContent=latest.project?`Your unsaved version is still intact. The saved version of “${latest.project.name}” changed after you opened it.`:'The saved project was removed. Your unsaved version is still intact.';
        const ownerLine=el('p',{class:'creator-conflict-owner',text:peer?`Editing tab: ${peer.label}`:owner?`Last saved from ${owner.label??owner.mode??'another editor'}.`:'The tab responsible is unavailable or uses an older Creator version.'});content.append(ownerLine);
        const go=button('Go to the tab that changed it',()=>{const peer=writer();if(peer)focusPeer(peer);else ctx.status('That editing tab is no longer available.',true);},{disabled:!peer});content.append(go);
        const choices=el('div',{class:'creator-conflict-choices'});content.append(choices);
        function choice(title,description,action,disabled=false){const section=el('section',{},el('h3',{text:title}),el('p',{text:description}),button(title,action,{disabled}));choices.append(section);}
        async function run(action){const expected=pending;dialog.querySelectorAll('button').forEach(button=>button.disabled=true);try{await action(expected);if(pending===expected)close();}catch(e){if(e.status===409){await show(e,expected);return;}ctx.status(e.message,true);if(pending===expected){dialog.querySelectorAll('button').forEach(button=>button.disabled=false);message.textContent=e.message;}}}
        choice('Discard this tab’s unsaved changes','Load the saved version shown here. The other tab’s saved changes are kept.',()=>run(async request=>{const fresh=await ctx.request(`projects/${encodeURIComponent(projectId)}`);if(fresh.revision!==latest.revision){await show({status:409,conflict:{projectId}},request);return;}if(pending===request&&ctx.document()?.id===projectId)ctx.load(fresh,request.context);ctx.status('Loaded the latest saved version.');}),!latest.project);
        choice(latest.project?'Replace saved changes with this tab’s version':'Restore the saved project from this tab',latest.project?'Save this tab’s version over the saved version shown here. A newer intervening save will reopen this dialog.':'Create the saved copy again using this tab’s version.',()=>run(async request=>{const result=await ctx.request('save',{project:request.local,revision:latest.revision,editor:metadata()});saved(result);if(ctx.document()?.id===request.projectId)ctx.accept(result,request.context);ctx.status('Saved this tab’s version.');}));
        const downloads=el('div',{class:'combat-actions'},button('Download this tab’s version',()=>ctx.download(JSON.stringify(local,null,2),`${projectId}-this-tab.json`)));if(latest.project)downloads.append(button('Download saved version',()=>ctx.download(JSON.stringify(latest.project,null,2),`${projectId}-saved.json`)));content.append(downloads);
    }
    const timer=win.setInterval(update,10000);win.addEventListener('pagehide',event=>{if(!event.persisted)dispose();});win.addEventListener('pageshow',update);
    function dispose(){if(disposed)return;disposed=true;win.clearInterval(timer);channel?.close();try{win.localStorage.removeItem(prefix+tabId);}catch{}close();}
    update();return {metadata,update,saved,show,dispose};
}
