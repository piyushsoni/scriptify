// Copyright (c) 2010-2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
//
// See https://wiki.mozilla.org/Extension_Manager:Bootstrapped_Extensions
// for details.

const global = this;

var { classes: Cc, interfaces: Ci, results: Cr, utils: Cu } = Components;

function module(uri) Cu.import(uri, {});

const DEBUG = false;

const BOOTSTRAP = "resource://scriptify/bootstrap.jsm";
const MODULES   = "resource://scriptify/modules/";

const { AddonManager } = module("resource://gre/modules/AddonManager.jsm");
const { XPCOMUtils }   = module("resource://gre/modules/XPCOMUtils.jsm");
const { Services }     = module("resource://gre/modules/Services.jsm");

const resourceProto = Services.io.getProtocolHandler("resource")
                              .QueryInterface(Ci.nsIResProtocolHandler);
const categoryManager = Cc["@mozilla.org/categorymanager;1"].getService(Ci.nsICategoryManager);
const manager = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);

function reportError(e) {
    dump("\n" + name + ": bootstrap: " + e + "\n" + (e.stack || Error().stack) + "\n");
    Cu.reportError(e);
}
function debug() {
    if (DEBUG)
        dump(name + ": " + Array.join(arguments, ", ") + "\n");
}

function httpGet(url) {
    let xmlhttp = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);
    xmlhttp.overrideMimeType("text/plain");
    xmlhttp.open("GET", url, false);
    xmlhttp.send(null);
    return xmlhttp;
}

let name = "scriptify";
let initialized = false;
let addon = null;
let addonData = null;
let basePath = null;
let bootstrap;
let categories = [];
let resources = [];
let getURI = null;

let JSMLoader = {
    get addon() addon,

    modules: {},

    currentModule: null,

    factories: [],

    get name() name,

    modules: JSMLoader && JSMLoader.modules || {},

    getTarget: function getTarget(url) {
        if (url.indexOf(":") === -1)
            url = MODULES + url + ".jsm";

        let chan = Services.io.newChannel(url, null, null);
        chan.cancel(Cr.NS_BINDING_ABORTED);
        return chan.name;
    },

    _atexit: [],

    atexit: function atexit(arg, self) {
        if (typeof arg !== "string")
            this._atexit.push(arguments);
        else
            for each (let [fn, self] in this._atexit)
                try {
                    fn.call(self, arg);
                }
                catch (e) {
                    reportError(e);
                }
    },

    load: function load(name, target) {
        if (!this.modules.hasOwnProperty(name)) {
            let url = name;
            if (url.indexOf(":") === -1)
                url = MODULES + url + ".jsm";

            let currentModule = this.currentModule;
            this.modules[name] = this.modules.base ? bootstrap.create(this.modules.base)
                                                   : bootstrap.import({ JSMLoader: this, module: global.module });
            this.currentModule = this.modules[name];
            try {
                bootstrap.loadSubScript(url, this.modules[name]);
            }
            catch (e) {
                delete this.modules[name];
                reportError(e);
                throw e;
            }
            finally {
                this.currentModule = currentModule;
            }
        }

        let module = this.modules[name];
        if (target)
            for each (let symbol in module.EXPORTED_SYMBOLS)
                target[symbol] = module[symbol];

        return module;
    },

    // Cuts down on stupid, fscking url mangling.
    get loadSubScript() bootstrap.loadSubScript,

    cleanup: function unregister() {
        for each (let factory in this.factories.splice(0))
            manager.unregisterFactory(factory.classID, factory);
    },

    Factory: function Factory(clas) ({
        __proto__: clas.prototype,

        createInstance: function (outer, iid) {
            try {
                if (outer != null)
                    throw Cr.NS_ERROR_NO_AGGREGATION;
                if (!clas.instance)
                    clas.instance = new clas();
                return clas.instance.QueryInterface(iid);
            }
            catch (e) {
                Cu.reportError(e);
                throw e;
            }
        }
    }),

    registerFactory: function registerFactory(factory) {
        manager.registerFactory(factory.classID,
                                String(factory.classID),
                                factory.contractID,
                                factory);
        this.factories.push(factory);
    }
};

function startup(data, reason) {
    debug("bootstrap: startup " + reasonToString(reason));
    basePath = data.installPath;

    if (!initialized) {
        initialized = true;

        debug("bootstrap: init" + " " + data.id);

        addonData = data;
        addon = data;
        name = data.id;
        AddonManager.getAddonByID(addon.id, function (a) {
            addon = a;

            try {
                init();
            }
            catch (e) {
                reportError(e);
            }
        });

        if (basePath.isDirectory())
            getURI = function getURI(path) {
                let uri = Services.io.newFileURI(basePath);
                uri.path += path;
                return Services.io.newFileURI(uri.QueryInterface(Ci.nsIFileURL).file);
            };
        else
            getURI = function getURI(path)
                Services.io.newURI("jar:" + Services.io.newFileURI(basePath).spec.replace(/!/g, "%21") + "!" +
                                   "/" + path, null, null);
    }
}

function init() {
    debug("bootstrap: init");

    let manifestURI = getURI("chrome.manifest");
    let manifest = httpGet(manifestURI.spec)
            .responseText
            .replace(/^\s*|\s*$|#.*/g, "")
            .replace(/^\s*\n/gm, "");

    for each (let line in manifest.split("\n")) {
        let fields = line.split(/\s+/);
        switch(fields[0]) {
        case "category":
            categoryManager.addCategoryEntry(fields[1], fields[2], fields[3], false, true);
            categories.push([fields[1], fields[2]]);
            break;

        case "resource":
            resources.push(fields[1]);
            resourceProto.setSubstitution(fields[1], getURI(fields[2]));
        }
    }

    bootstrap = module(BOOTSTRAP);
    bootstrap.require = JSMLoader.load("base").require;

    try {
        JSMLoader.load("disable-acr").init(addon.id);
    }
    catch (e) {
        reportError(e);
    }

    JSMLoader.load("config");
    JSMLoader.load("main");
}

function shutdown(data, reason) {
    let strReason = reasonToString(reason);
    debug("bootstrap: shutdown " + strReason);

    if (reason != APP_SHUTDOWN) {
        try {
            JSMLoader.load("disable-acr").cleanup(addon.id);
        }
        catch (e) {
            reportError(e);
        }

        if (~[ADDON_UPGRADE, ADDON_DOWNGRADE, ADDON_UNINSTALL].indexOf(reason))
            Services.obs.notifyObservers(null, "scriptify-purge", null);

        Services.obs.notifyObservers(null, "scriptify-cleanup", strReason);

        JSMLoader.atexit(strReason);
        JSMLoader.cleanup(strReason);

        if (Cu.unload)
            Cu.unload(BOOTSTRAP);
        else
            bootstrap.require = null;

        for each (let [category, entry] in categories)
            categoryManager.deleteCategoryEntry(category, entry, false);
        for each (let resource in resources)
            resourceProto.setSubstitution(resource, null);
    }
}

function uninstall(data, reason) {
    debug("bootstrap: uninstall " + reasonToString(reason));
    if (reason == ADDON_UNINSTALL)
        Services.prefs.deleteBranch("extensions.scriptify.");
}

function reasonToString(reason) {
    for each (let name in ["disable", "downgrade", "enable",
                           "install", "shutdown", "startup",
                           "uninstall", "upgrade"])
        if (reason == global["ADDON_" + name.toUpperCase()] ||
            reason == global["APP_" + name.toUpperCase()])
            return name;
}

function install(data, reason) { debug("bootstrap: install " + reasonToString(reason)); }

// vim: set fdm=marker sw=4 ts=4 et:
