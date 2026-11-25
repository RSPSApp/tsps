/** Shared card chrome keeps destructive actions separate from titles and reorder controls. */
export function mechanicHeader(ctx, title, caption, actions=[]){
 const {element:el}=ctx;
 return el('header',{class:'combat-card-header'},el('div',{class:'combat-card-title'},el('small',{text:caption}),el('h3',{text:title})),el('div',{class:'combat-card-tools'},...actions));
}
