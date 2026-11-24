import { AsyncLocalStorage } from 'node:async_hooks';

type ActorLook = {entity:object;animation?:number;suppressGraphics?:boolean;onGraphic?:(graphic:any,slot:number)=>boolean};
type Presentation = {actors:ActorLook[];valid:()=>boolean};
/** Scoped presentation overrides. Tasks and hit callbacks carry the scope, never other attacks. */
export class ActorPresentation {
    private static storage = new AsyncLocalStorage<Presentation>();
    private static bindings = new WeakMap<object,Presentation>();
    static with<T>(actors:ActorLook[],valid:()=>boolean,fn:()=>T):T {
        if(actors.length>2)throw new Error('An actor presentation scope supports two actors.');
        return this.storage.run({actors,valid},fn);
    }
    static for(entity:object):ActorLook|undefined {const scope=this.storage.getStore();return scope?.valid()?scope.actors.find(a=>a.entity===entity):undefined;}
    static capture(owner:object):void {const scope=this.storage.getStore();if(scope)this.bindings.set(owner,scope);}
    static inScope(owner:object):boolean {const bound=this.bindings.get(owner);return !bound||bound===this.storage.getStore();}
    static run<T>(owner:object,fn:()=>T):T {const bound=this.bindings.get(owner);return bound?this.storage.run(bound,fn):fn();}
    static bind<T extends (...args:any[])=>any>(fn:T):T {const scope=this.storage.getStore();return scope?((...args:any[])=>this.storage.run(scope,()=>fn(...args))) as T:fn;}
}
