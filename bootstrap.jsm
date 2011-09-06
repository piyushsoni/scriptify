
var EXPORTED_SYMBOLS = ["require"];

// Deal with cross-compartment XML passing issues.
function create(proto) Object.create(proto);
function import(obj) {
    let res = {};
    for each (let key in Object.getOwnPropertyNames(obj))
        Object.defineProperty(res, key, Object.getOwnPropertyDescriptor(obj, key));
    return res;
}
// Deal with subScriptLoader prepending crap to loaded URLs
Components.utils.import("resource://gre/modules/Services.jsm");
function loadSubScript() Services.scriptloader.loadSubScript.apply(null, arguments);

