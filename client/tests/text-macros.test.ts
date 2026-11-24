import assert from "node:assert/strict";
import { test } from "node:test";

import { Opcodes } from "../rs/cs2/Opcodes";
import { createHandlerMap } from "../rs/cs2/handlers";
import { clearTextMacros, expandTextMacros, resolveTextTemplates, setTextMacro } from "../rs/font/textTemplates";

// OSRS text macros: a script names a piece of text (instruction 3228) and text drawn afterwards
// places it as @name@. An unset name draws nothing; <at> is a literal @.

test("a macro is placed wherever its name appears, and may hold tags", () => {
    clearTextMacros();
    setTextMacro("or4", "<col=ff981f>");
    setTextMacro("ttip_list", "<br>@or4@- ");
    assert.equal(resolveTextTemplates("@or4@Attack</col> XP"), "<col=ff981f>Attack</col> XP");
    assert.equal(resolveTextTemplates("Needs:@ttip_list@a bone"), "Needs:<br><col=ff981f>- a bone");
    assert.equal(resolveTextTemplates("@OR4@x"), "<col=ff981f>x", "names ignore case");
});

test("an unset name draws nothing; other @ signs are left alone", () => {
    clearTextMacros();
    assert.equal(resolveTextTemplates("@mes_hl_red@Danger"), "Danger");
    assert.equal(resolveTextTemplates("mail me@example.com"), "mail me@example.com");
    assert.equal(resolveTextTemplates("5 @ 10gp @ GE"), "5 @ 10gp @ GE", "a name has no spaces");
    assert.equal(resolveTextTemplates("user<at>home<at>x"), "user@home@x", "<at> is the escape");
    assert.equal(expandTextMacros("<img=@x@>"), "<img=@x@>", "nothing is replaced inside a tag");
});

test("setting a macro changes text already resolved once", () => {
    clearTextMacros();
    assert.equal(resolveTextTemplates("@red@stop"), "stop");
    setTextMacro("red", "<col=ff0000>");
    assert.equal(resolveTextTemplates("@red@stop"), "<col=ff0000>stop");
});

test("the instructions set and clear macros, and escape hides @ from them", () => {
    const handlers = createHandlerMap();
    const run = (opcode: number, strings: string[]) => {
        const out: string[] = [];
        const ctx: any = { stringStack: [...strings], stringStackSize: strings.length, pushString: (v: string) => out.push(v) };
        handlers.get(opcode)!(ctx, 0, null as any);
        return out;
    };
    run(Opcodes.TRANSLATIONS_SET, ["blue", "<col=0000ff>"]);
    assert.equal(resolveTextTemplates("@blue@sea"), "<col=0000ff>sea");
    const [escaped] = run(Opcodes.ESCAPE, ["@blue@ <b>"]);
    assert.equal(escaped, "<at>blue<at> <lt>b<gt>");
    assert.equal(resolveTextTemplates(escaped), "@blue@ <lt>b<gt>");
    run(Opcodes.TRANSLATIONS_CLEAR, []);
    assert.equal(resolveTextTemplates("@blue@sea"), "sea");
});

test("a template name may follow str directly", () => {
    assert.equal(resolveTextTemplates("<str0=5>You have <str0> bonds"), "You have 5 bonds");
    assert.equal(resolveTextTemplates("<str>gone</str> <str=ff0000>red</str>"), "<str>gone</str> <str=ff0000>red</str>");
});
