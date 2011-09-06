// Copyright (c) 2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

var EXPORTED_SYMBOLS = ["Messages", "messages", "_"];

var { services } = require("services");

var Messages = Class("Messages", {

    init: function init(name) {
        let self = this;
        this.name = name || "messages";

        this._ = Class("_", String, {
            init: function _(message) {
                this.args = arguments;
            },
            instance: {},
            message: Class.Memoize(function () {
                let message = this.args[0];

                if (this.args.length > 1) {
                    let args = Array.slice(this.args, 1);
                    return self.format(message + "-" + args.length, args, null) || self.format(message, args);
                }
                return self.get(message);
            }),
            valueOf: function valueOf() this.message,
            toString: function toString() this.message
        });
    },

    bundles: Class.Memoize(function ()
        array.uniq([JSMLoader.getTarget("scriptify://locale/" + this.name + ".properties"),
                    "resource://scriptify-locale/en-US/" + this.name + ".properties"])
             .map(services.stringBundle.createBundle)
             .filter(function (bundle) { try { bundle.getSimpleEnumeration(); return true; } catch (e) { return false; } })),

    iterate: function () {
        let seen = {};
        for (let bundle in values(this.bundles))
            for (let { key, value } in iter(bundle.getSimpleEnumeration(), Ci.nsIPropertyElement))
                if (!Set.add(seen, key))
                    yield [key, value];
    },

    get: function get(value, default_) {
        for (let bundle in values(this.bundles))
            try {
                return bundle.GetStringFromName(value);
            }
            catch (e) {}

        // Report error so tests fail, but don't throw
        if (arguments.length < 2) // Do *not* localize these strings
            util.reportError(Error("Invalid locale string: " + value));
        return arguments.length > 1 ? default_ : value;
    },

    format: function format(value, args, default_) {
        for (let bundle in values(this.bundles))
            try {
                return bundle.formatStringFromName(value, args, args.length);
            }
            catch (e) {}

        // Report error so tests fail, but don't throw
        if (arguments.length < 3) // Do *not* localize these strings
            util.reportError(Error("Invalid locale string: " + value));
        return arguments.length > 2 ? default_ : value;
    }
});

JSMLoader.atexit(function cleanup() {
    services.stringBundle.flushBundles();
});

var messages = Messages();

var { _ } = messages;

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
