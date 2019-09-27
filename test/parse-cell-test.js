const test = require("tape");
const runtime = require("@observablehq/runtime");
const compiler = require("../index");

test("parse-cell", async t => {
    const rt = new runtime.Runtime();
    const compile = new compiler.Compiler();
    const main = rt.module();
    const aCell = compile.cell('a = 1');
    const bCell = compile.cell('b = a + 1');
    main.define(aCell.cellName, aCell.cellReferences, aCell.cellFunction);
    main.define(bCell.cellName, bCell.cellReferences, bCell.cellFunction);
  
    await rt._compute();

    t.equal(await main.value("a"), 1);
    t.equal(await main.value("b"), 2);

    rt.dispose();

    t.end();
});
