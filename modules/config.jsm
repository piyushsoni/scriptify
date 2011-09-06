// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

var EXPORTED_SYMBOLS = ["config"];

var { io } = require("io");
var { LocaleChannel, Protocol } = require("protocol");
var { services } = require("services");
var { util } = require("util");

lazyRequire("messages", ["Messages", "messages", "_"]);
lazyRequire("prefs", ["Prefs"]);

function Dialog(name, features, url)
    function dialog(window)
        window.openDialog.apply(window,
                                [url, name, "chrome,dialog," + (features || "")]
                                    .concat(Array.slice(arguments, 1)));

var dialogs = Singleton("dialogs", {
    create:      Dialog("scriptify-create-addon", "centerscreen",       "scriptify://content/processing-script.xul"),
    edit:        Dialog("scriptify-edit-addon",   "centerscreen",       "scriptify://content/edit-addon.xul"),
    editScript:  Dialog("scriptify-edit-script",  "centerscreen,modal", "scriptify://content/edit-script.xul"),

    createModal: function createModal(window, params) {
        Dialog("scriptify-create-addon", "centerscreen,modal", "scriptify://content/processing-script.xul")(window, params);
        return params;
    },

    prompt: function prompt(window, config) {
        config.canceled = false;
        window.openDialog("scriptify://content/prompt.xul", null, "chrome,dialog,centerscreen,modal",
                          config);
        return config.canceled ? null : config.value;
    }
});

var config = Singleton("config", {
    init: function init() {

        JSMLoader.registerFactory(JSMLoader.Factory(
            Protocol("scriptify", "{cc8c8fd5-2764-444f-992c-335bf3a7ff67}",
                     "resource://scriptify-content/")));

        update(services["scriptify:"].providers, {
            "dtd": function (uri, path) [null, util.makeDTD((path == "messages.dtd" ? messages
                                                                                    : Messages(uri.fileBaseName)
                                                             ).iterate())],
            "locale": function (uri, path) LocaleChannel("scriptify-locale", config.locale, path, uri)
        });
    },

    cleanup: function cleanup() {
        services["scriptify:"].purge();
    },

    get addon() JSMLoader.addon,

    prefs: Class.Memoize(function () Prefs("extensions." + this.addon.id.replace(/@.*/, "") + ".")),

    /**
     * The current application locale.
     */
    appLocale: Class.Memoize(function () services.chromeRegistry.getSelectedLocale("global")),

    /**
     * The current scriptify locale.
     */
    locale: Class.Memoize(function () this.bestLocale(this.locales)),

    /**
     * The current application locale.
     */
    locales: Class.Memoize(function () {
        function getDir(str) str.match(/^(?:.*[\/\\])?/)[0];

        let uri = "resource://scriptify-locale/";
        let jar = io.isJarURL(uri);
        if (jar) {
            let prefix = getDir(jar.JAREntry);
            var res = iter(s.slice(prefix.length).replace(/\/.*/, "")
                           for (s in io.listJar(jar.JARFile, prefix)))
                        .toArray();
        }
        else {
            res = array(f.leafName
                        for (f in util.getFile(uri).iterDirectory())
                        if (f.isDirectory())).array;
        }

        let exists = function exists(pkg) services["resource:"].hasSubstitution("scriptify-locale-" + pkg);

        return array.uniq([this.appLocale, this.appLocale.replace(/-.*/, "")]
                            .filter(exists)
                            .concat(res));
    }),

    /**
     * Returns the best locale match to the current locale from a list
     * of available locales.
     *
     * @param {[string]} list A list of available locales
     * @returns {string}
     */
    bestLocale: function (list) {
        return values([this.appLocale, this.appLocale.replace(/-.*/, ""),
                       "en", "en-US", list[0]])
            .nth(Set.has(Set(list)), 0);
    },

    /**
     * Returns true if the current Gecko runtime is of the given version
     * or greater.
     *
     * @param {string} min The minimum required version. @optional
     * @param {string} max The maximum required version. @optional
     * @returns {boolean}
     */
    haveGecko: function (min, max) let ({ compare } = services.versionCompare,
                                        { platformVersion } = services.runtime)
        (min == null || compare(platformVersion, min) >= 0) &&
        (max == null || compare(platformVersion, max) < 0),

    OS: memoize({
        _arch: services.runtime.OS,
        /**
         * @property {string} The normalised name of the OS. This is one of
         *     "Windows", "Mac OS X" or "Unix".
         */
        get name() this.isWindows ? "Windows" : this.isMacOSX ? "Mac OS X" : "Unix",
        /** @property {boolean} True if the OS is Windows. */
        get isWindows() this._arch == "WINNT",
        /** @property {boolean} True if the OS is Mac OS X. */
        get isMacOSX() this._arch == "Darwin",
        /** @property {boolean} True if the OS is some other *nix variant. */
        get isUnix() !this.isWindows,
        /** @property {RegExp} A RegExp which matches illegal characters in path components. */
        get illegalCharacters() this.isWindows ? /[<>:"/\\|?*\x00-\x1f]/g : /[\/\x00]/g,

        get pathListSep() this.isWindows ? ";" : ":"
    })
});

// vim: set fdm=marker sw=4 sts=4 et ft=javascript:
