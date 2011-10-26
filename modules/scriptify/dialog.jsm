// Copyright (c) 2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE file included with this file.
"use strict";

var EXPORTED_SYMBOLS = ["Dialog"];

var { services } = require("services");
var { DOM, template } = require("util");

function Dialog(window, proto)
    Class(DialogBase, update({
        window: window,

        $: function $(sel, node) DOM(sel, node || window.document)
    },
    proto)).apply(null, window.arguments || []);

let DialogBase = Class("DialogBase", {
    _metaInit_: util.wrapCallback(function init() {
        let self = this;
        if (this.onload)
            DOM(this.window).load(function () { self.onload.apply(self, self.window.arguments); });

        if (this.onunload)
            DOM(this.window).unload(this.closure.onunload);

        if (this.oncancel)
            DOM(this.window).listen("dialogcancel", this.closure.oncancel);

        DOM(this.window).listen("dialogaccept", function (event) {
            if (self.ondialogaccept(event) === false)
                event.preventDefault();
        });

        DOM(this.window).command(function (event) {
            let command = self.commands[util.camelCase(DOM(event.originalTarget).attr("scriptify-command") || "")];
            if (command)
                return command.call(self, event);
        });
    }),

    utilityOverlay: Class.Memoize(function () Dialog.getUtilityOverlay(this.window)),

    button: function button(name) this.$("#button-" + name),

    field: function field(name) this.$("#input-" + name),

    commands: {},

    validators: {},

    validate: function validate() {
        let bad = 0;
        for (let [k, v] in Iterator(this.validators)) {
            let elem = this.field(k);
            let value = elem.val().trim();

            let ok = false;
            try {
                ok = !!(v.test ? bind("test", v) : v).call(this, value);
            }
            catch (e) {}

            elem.class.toggle("error", !ok);
            bad += !ok;
        }

        return !bad;
    },

    ondialogaccept: function ondialogaccept(event) {
        if (!this.validate())
            return false;
        if (this.onaccept)
            return this.onaccept();
    }
});

Dialog.getUtilityOverlay = function getUtilityOverlay(window) {
    let obj = window.Object.create(window);
    let pkg = services.runtime.name == "SeaMonkey" ? "communicator" : "browser";
    JSMLoader.loadSubScript("chrome://" + pkg + "/content/utilityOverlay.js", obj);
    return obj;
};

// vim:se sts=4 sw=4 et ft=javascript:
