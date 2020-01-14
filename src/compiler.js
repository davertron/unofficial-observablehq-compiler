import { parseCell, parseModule } from "@observablehq/parser";
import { Library } from "@observablehq/runtime";
import { extractPath } from "./utils";

const { Generators } = new Library();

const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const GeneratorFunction = Object.getPrototypeOf(function*() {}).constructor;
const AsyncGeneratorFunction = Object.getPrototypeOf(async function*() {})
    .constructor;

const createImportCellDefintion = async (cell, resolveModule) => {
    const source = cell.body.source.value;
    const from = await resolveModule(source);
    return { from };
};
const createRegularCellDefintion = cell => {
    let name = null;
    if (cell.id && cell.id.name) name = cell.id.name;
    else if (cell.id && cell.id.id && cell.id.id.name) name = cell.id.id.name;
    const bodyText = cell.input.substring(cell.body.start, cell.body.end);
    let code;
    if (cell.body.type !== "BlockStatement") {
        if (cell.async)
            code = `return (async function(){ return (${bodyText});})()`;
        else code = `return (function(){ return (${bodyText});})()`;
    } else code = bodyText;
    const references = (cell.references || []).map(ref => {
        if (ref.type === "ViewExpression") throw Error("ViewExpression wat");
        return ref.name;
    });

    let f;

    if (cell.generator && cell.async)
        f = new AsyncGeneratorFunction(...references, code);
    else if (cell.async) f = new AsyncFunction(...references, code);
    else if (cell.generator) f = new GeneratorFunction(...references, code);
    else f = new Function(...references, code);
    return {
        cellName: name,
        cellFunction: f,
        cellReferences: references
    };
};

const addCellToModule = async ({
    cell,
    module,
    observer,
    resolveModule,
    runtime,
    variable,
    viewOfVariable
}) => {
    let v = variable || module.variable(observer ? observer() : null);
    let vov = viewOfVariable;
    if (cell.body.type === "ImportDeclaration") {
        const specifiers = (cell.body.specifiers || []).map(specifier => ({
            name: specifier.imported.name,
            alias: specifier.local.name
        }));
        const injections = (cell.body.injections || []).map(injection => ({
            name: injection.imported.name,
            alias: injection.local.name
        }));
        v.define(
            null,
            ["md"],
            md => md`~~~javascript
import {${specifiers.map(
                specifier => `${specifier.name} as ${specifier.alias}`
            )}}  ${
                injections.length > 0
                    ? `with {${injections
                          .map(
                              injection =>
                                  `${injection.name} as ${injection.alias}`
                          )
                          .join(",")}} `
                    : ``
            }from "${cell.body.source.value}"
~~~`
        );
        const { from } = await createImportCellDefintion(
            cell,
            resolveModule
        ).catch(err => {
            throw Error("Error defining import cell", err);
        });

        const other = runtime.module(from);
        const child = other.derive(injections, module);
        specifiers.map(specifier => {
            module.import(specifier.name, specifier.alias, child);
        });
    } else {
        const {
            cellName,
            cellFunction,
            cellReferences
        } = createRegularCellDefintion(cell);
        if (cell.id && cell.id.type === "ViewExpression") {
            const reference = `viewof ${cellName}`;
            // This is for the viewof hidden cell
            v.define(reference, cellReferences, cellFunction);
            // TODO: Verify I don't have v and vov swapped here...
            if (!vov) {
                vov = module.variable();
            }
            vov.define(cellName, [reference], Generators.input);
        } else {
            v.define(cellName, cellReferences, cellFunction);
        }
    }

    return { variable: v, viewOfVariable: vov };
};

const createModuleDefintion = (m, resolveModule) => {
    return async function define(runtime, observer) {
        const { cells } = m;
        const main = runtime.module();

        const cellsPromise = cells.map(async cell =>
            addCellToModule({ cell, main, observer, resolveModule, runtime })
        );

        await Promise.all(cellsPromise);
    };
};

const defaultResolver = async path => {
    return import(
        /* webpackIgnore: true */ `https://api.observablehq.com/${path}.js?v=3`
    ).then(m => m.default);
};

export class Compiler {
    constructor(resolve = defaultResolver) {
        this.resolve = resolve;
    }
    async cell({ text, observer, module, runtime, variable, viewOfVariable }) {
        const parsedCell = parseCell(text);
        parsedCell.input = text;
        return addCellToModule({
            cell: parsedCell,
            module,
            resolveModule: this.resolve,
            runtime,
            observer,
            variable,
            viewOfVariable
        });
    }
    module(text) {
        const m1 = parseModule(text);
        return createModuleDefintion(m1, this.resolve);
    }
}
