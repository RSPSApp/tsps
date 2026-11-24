import { copyParts, pasteParts, PART_CLIPBOARD_FORMAT } from '/shared/part-clipboard.mjs';

export function createPartClipboard(ctx) {
    const textTarget=target=>target?.closest?.('input,textarea,select,[contenteditable=""],[contenteditable="true"],[role="textbox"]');
    const available=event=>ctx.state.project&&!textTarget(event.target)&&!event.target?.closest?.('dialog[open]');
    function copy(event){
        if(!available(event)||!event.clipboardData||!ctx.state.selected)return false;
        try{
            const payload=JSON.stringify(copyParts(ctx.state.project,ctx.state.selected));
            event.clipboardData.setData('text/plain',payload);event.clipboardData.setData('application/x-tsps-parts',payload);event.preventDefault();
            ctx.status('Piece copied with its placement and children. Paste into any item or project in this Creator.');return true;
        }catch(error){ctx.status(error.message,true);return false;}
    }
    function paste(event){
        if(!available(event)||!event.clipboardData)return false;
        const text=event.clipboardData.getData('application/x-tsps-parts')||event.clipboardData.getData('text/plain');
        if(text.length>24*1024*1024){ctx.status('Copied pieces exceed 24 MB.',true);return false;}
        let input;try{input=JSON.parse(text);}catch{return false;}
        if(input?.format!==PART_CLIPBOARD_FORMAT)return false;
        event.preventDefault();
        try{
            const plan=pasteParts(ctx.state.project,input,ctx.state.variant);ctx.stop?.();ctx.beforePaste?.();
            ctx.change(()=>{ctx.state.project.parts=plan.parts;ctx.state.project.attacks=plan.attacks;ctx.state.selected=plan.selected;ctx.state.isolate=false;});
            ctx.status(`Pasted ${plan.count===1?'piece':plan.count+' pieces'} with original size, rotation and position. Drag to move; Undo removes the paste.`);return true;
        }catch(error){ctx.status(error.message,true);return true;}
    }
    return {copy,paste};
}
