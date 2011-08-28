// Copyright © 2009-2011 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE file included with this file.
"use strict";

const { classes: Cc, interfaces: Ci, utils: Cu, results: Cr } = Components;

function module(uri) Cu.import(uri, {});

function debug() {
    dump((addon ? addon.id : "scriptify") + ": " + Array.join(arguments, ", ") + "\n");
}

const { AddonManager } = module("resource://gre/modules/AddonManager.jsm");
const { Services }     = module("resource://gre/modules/Services.jsm");
const { XPCOMUtils }   = module("resource://gre/modules/XPCOMUtils.jsm");

const services = {};
XPCOMUtils.defineLazyServiceGetter(services, "clipboard", "@mozilla.org/widget/clipboardhelper;1", "nsIClipboardHelper");
XPCOMUtils.defineLazyServiceGetter(services, "mime", "@mozilla.org/mime;1", "nsIMIMEService");
XPCOMUtils.defineLazyServiceGetter(services, "security", "@mozilla.org/scriptsecuritymanager;1", "nsIScriptSecurityManager");

const principal = Cc["@mozilla.org/nullprincipal;1"].createInstance(Ci.nsIPrincipal);

var addon;

function wrap(fn)
    function wrapper() {
        try {
            return fn.apply(this, arguments);
        }
        catch (e) {
            Cu.reportError(e);
            Services.console.logStringMessage(e.stack || Error().stack);
        }
    }

let manager = {
    TOPIC: "content-document-global-created",

    config: null,

    prefs: null,

    init: function init(reason) {
        this.prefs = prefs.Branch("extensions." + addon.id + ".");

        this.config = JSON.parse(httpGet(addon.getResourceURI("manifest.json").spec)
                                    .responseText);

        for (let window in contentWindows())
            this.load(window);

        Services.obs.addObserver(this, this.TOPIC, false);
    },

    uninstall: function uninstall() {
        if (this.prefs)
            this.prefs.clear();
    },

    load: wrap(function load(window) {
        let href = window.location.href;

        for each (let script in this.config.scripts) {
            if (!~["file:", "http:", "https:"].indexOf(window.location.protocol) && href != "about:home")
                continue;
            if (script.exclude && script.exclude.some(function (re) RegExp(re).test(href)))
                continue;
            if (script.include.some(function (re) RegExp(re).test(href)))
                this.makeSandbox(window, script);
        }
    }),

    makeSandbox: wrap(function makeSandbox(window, script) {

        let sandbox = Cu.Sandbox(window, { sandboxPrototype: window });
        sandbox.unsafeWindow = window.wrappedJSObject;

        let api = Object.create(apiBase);
        api.sandbox = sandbox;
        api.win = window;
        api.doc = window.document;

        Object.keys(apiBase).forEach(function (meth) {
            sandbox.importFunction(function wrapper() {
                let caller = Components.stack.caller.caller.filename;
                if (!/^resource:/.test(caller))
                    throw Error("Permission denied for <" + caller + "> to call method GM_" + meth)

                return api[meth].apply(api, arguments);
            }, "GM_" + meth);
        });

        for each (let path in script.paths)
            try {
                Services.scriptloader.loadSubScript(
                    addon.getResourceURI(path).spec,
                    sandbox);
            }
            catch (e if e instanceof Finished) {}

    }),

    cleanup: function cleanup() {
        Services.obs.removeObserver(this, this.TOPIC);
    },

    QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver]),

    observe: wrap(function observe(subject, topic, data) {
        if (topic == this.TOPIC)
            this.load(subject);
    })
};

let apiBase = {

    /**
     * Inserts a new <style/> node into the current document with the
     * given CSS text.
     *
     * @param {string} css The CSS styles to add.
     */
    addStyle: function addStyle(css) {
        let node = this.doc.createElement("style");
        node.setAttribute("type", "text/css");
        node.textContent = css;
        (this.doc.head || this.doc.querySelector("head") || this.doc.documentElement)
            .appendChild(node);
    },

    /**
     * Executes the given function when the document's DOM is ready.
     *
     * @param {function} func The function to execute.
     * @param {object} self The 'this' object with which to call *func*. 
     */
    ready: function ready(func, self) {
        self = self || this.sandbox;

        if (~["interactive", "complete"].indexOf(this.doc.readyState))
            func.call(self);
        else
            this.doc.addEventListener("DOMContentLoaded", function callback() {
                this.removeEventListener("DOMContentLoaded", callback, false);
                func.call(self);
            }, false);
    },

    /**
     * Returns the value of the preference *key* from the preference
     * branch "extensions.<addon-id>." where <addon-id> is the ID of the
     * current add-on.
     *
     * @param {string} key The name of the preference to retrieve.
     * @param {*} defaultValue The value to return if the preference
     *      does not exist. @optional
     * @returns {bool|int|string|type(defaultValue)}
     */
    getValue: function getValue(key, defaultValue) manager.prefs.get(key, defaultValue),

    /**
     * Sets the value of the preference *key* to *val.
     *
     * @param {string} key The name of the preference to retrieve.
     * @param {bool|int|string|null} value The value to set.
     * @see .getValue
     */
    setValue: function setValue(key, val) {
        manager.prefs.set(key, val);
    },

    /**
     * Deletes the preference *key*.
     *
     * @param {string} key The name of the preference to retrieve.
     * @param {bool|int|string|null} value The value to set.
     * @see .getValue
     */
    deleteValue: function deleteValue(key) {
        manager.prefs.reset(key);
    },

    /**
     * Returns a list of preference names.
     *
     * @param {[string]} value The value to set.
     * @see .getValue
     */
    listValues: function listValues() manager.prefs.getNames(),

    /**
     * Prematurely ends the loading of the current script.
     */
    finish: function finish() {
        throw new Finished;
    },

    /**
     * Sets the contents of the clipboard to the given string.
     *
     * @param {string} text The text to write to the clipboard.
     */
    setClipboard: function setClipboard(text) {
        services.clipboard.copyString(text);
    },

    /**
     * Opens the given URL in a new tab.
     *
     * @param {string} url The URL to load.
     */
    openInTab: function openInTab(url) {
        services.security.checkLoadURIStrWithPrincipal(principal, url, 0);

        let { gBrowser } = topWindow(this.win);

        let owner = gBrowser._getTabForContentWindow(this.win.top);
        let sendReferer = !/^(https?|ftp):/.test(url) || prefs.get("network.http.sendRefererHeader");

        let tab = gBrowser.addTab(url, {
            ownerTab: owner,
            referrerURI: sendReferer ? Services.io.newURI(this.win.location, null, null)
                                     : null
        });

        if (owner && owner == gBrowser.selectedTab && !prefs.get("browser.tabs.loadInBackground"))
            gBrowser.selectedTab = tab;
    },

    /**
     * Opens a new XMLHttpRequest with the given parameters.
     *
     * @param {object} params The parameters with which to open the
     *      XMLHttpRequest. Valid properties include:
     *
     *     url: (string) The URL to load.
     *     data: (string|File|FormData) The data to send.
     *     method: (string) The method with which to make the requests.
     *             Defaults to "GET".
     *     onload: (function(object)) The "load" event handler.
     *     onerror: (function(object)) The "error" event handler.
     *     onreadystatechange: (function(object)) The "readystatechange" event handler.
     *     headers: (object) An object with each property representig a
     *              request header value to set.
     *     user: (string) The username to send with HTTP authentication
     *           parameters.
     *     password: (string) The password to send with HTTP authentication
     *           paraneters.
     */
    xmlhttpRequest: function xmlhttpRequest(params) {
        let self = this;
        let uri = Services.io.newURI(params.url, null, null);
        if (!~["ftp", "http", "https"].indexOf(uri.scheme))
            throw URIError("Illegal URI");

        let xhr = XMLHttpRequest(params.method || "GET", uri.spec, true,
                                 params.user, params.password);

        ["load", "error", "readystatechange"].forEach(function (event) {
            if ("on" + event in params)
                xhr.addEventListener(event, function () {
                    params["on" + event](sanitizeRequest(this, self.sandbox));
                }, false);
        });

        for (let [k, v] in Iterator(params.headers || {}))
            xhr.setRequestHeader(k, v);

        // No need to invoke the XML parser as we won't be using the result.
        xhr.overrideMimeType("text/plain");

        xhr.send(params.data);
    },

    /**
     * Logs the stringified arguments to the Error Console.
     */
    log: function log() {
        Services.console.logStringMessage(addon.id + " (" + this.doc.location + "): " + Array.join(arguments, ", "));
    },

    /**
     * Logs the stringified arguments to the Error Console if the debug
     * preference is greater to or equal the given debug level.
     *
     * @param {int} level The debug level.
     * @param {*} ... The arguments to log.
     */
    debug: function debug(level) {
        if (this.getValue("debug", 0) >= level)
            this.log.apply(this, Array.slice(arguments, 1));
    },

    /**
     * Reports the given error to the Error Console.
     *
     * @param {object|string} error The error to report.
     */
    reportError: function reportError(error) {
        Cu.reportError(error);
        if ("stack" in error && error.stack)
            this.log(error.stack);
    },

    /**
     * Returns a data: URL representing the file inside this
     * extension at *path*.
     *
     * @param {string} path The path within this extension at which to
     *      find the resource.
     * @returns {string}
     * @see .getResourceText
     */
    getResourceURL: function getResourceURL(path) {
        let type = "text/plain";
        try {
            type = services.mime.getTypeFromExtension(/[^.]+$/.exec(path)[0]);
        }
        catch (e) {}

        return "data:" + type + "," + encodeURIComponent(this.getResourceText(path));
    },

    /**
     * Returns the text of the file inside this extension at *path*.
     *
     * @param {string} path The path within this extension at which to
     *      find the resource.
     * @see .getResourceURL
     */
    getResourceText: function getResourceText(path) {
        let uri = addon.getResourceURI(path).spec;

        // Should be impossible, but be paranoid
        if (uri.indexOf(addon.getResourceURI(".").spec))
            throw Error("Invalid path");

        return httpGet(uri).responseText;
    },

    registerMenuCommand: function () {}
};

function sanitizeRequest(xhr, sandbox) {
    // Use Greasemonkey's approximate method, as it's tried and tested.
    return {
        responseText: xhr.responseText,

        get responseJSON() {
            delete this.responseJSON;
            return this.responseJSON = JSON.parse(this.responseText);
        },

        get responseXML() {
            delete this.responseXML;
            return this.responseXML = sandbox.DOMParser().parseFromString(this.responseText, "text/xml");
        },

        readyState: xhr.readyState,

        get responseHeaders() xhr.getAllResponseHeaders(),

        status: xhr.readyState == 4 ? xhr.status : 0,

        statusText: xhr.readyState == 4 ? xhr.statusText : ""
    };
}

function Finished() {}
Finished.prototype.__exposedProps__ = {};

const XMLHttpRequest = Components.Constructor("@mozilla.org/xmlextras/xmlhttprequest;1", "nsIXMLHttpRequest", "open");
const SupportsString = Components.Constructor("@mozilla.org/supports-string;1", "nsISupportsString");

function Prefs(branch, defaults) {
    this.constructor = Prefs; // Ends up Object otherwise... Why?

    this.branch = Services.prefs[defaults ? "getDefaultBranch" : "getBranch"](branch || "");
    if (this.branch instanceof Ci.nsIPrefBranch2)
        this.branch.QueryInterface(Ci.nsIPrefBranch2);

    this.defaults = defaults ? this : new this.constructor(branch, true);
}
Prefs.prototype = {
    /**
     * Returns a new Prefs object for the sub-branch *branch* of this
     * object.
     *
     * @param {string} branch The sub-branch to return.
     */
    Branch: function Branch(branch) new this.constructor(this.root + branch),

    /**
     * Clears the entire branch.
     *
     * @param {string} name The name of the preference branch to delete.
     */
    clear: function clear(branch) {
        this.branch.deleteBranch(branch || "");
    },

    /**
     * Returns the full name of this object's preference branch.
     */
    get root() this.branch.root,

    /**
     * Returns the value of the preference *name*, or *defaultValue* if
     * the preference does not exist.
     *
     * @param {string} name The name of the preference to return.
     * @param {*} defaultValue The value to return if the preference has no value.
     * @optional
     */
    get: function get(name, defaultValue) {
        let type = this.branch.getPrefType(name);

        if (type === Ci.nsIPrefBranch.PREF_STRING)
            return this.branch.getComplexValue(name, Ci.nsISupportsString).data;

        if (type === Ci.nsIPrefBranch.PREF_INT)
            return this.branch.getIntPref(name);

        if (type === Ci.nsIPrefBranch.PREF_BOOL)
            return this.branch.getBoolPref(name);

        return defaultValue;
    },

    /**
     * Returns true if the given preference exists in this branch.
     *
     * @param {string} name The name of the preference to check.
     */
    has: function has(name) this.branch.getPrefType(name) !== 0,

    /**
     * Returns an array of all preference names in this branch or the
     * given sub-branch.
     *
     * @param {string} branch The sub-branch for which to return preferences.
     * @optional
     */
    getNames: function getNames(branch) this.branch.getChildList(branch || "", { value: 0 }),

    /**
     * Returns true if the given preference is set to its default value.
     *
     * @param {string} name The name of the preference to check.
     */
    isDefault: function isDefault(name) !this.branch.prefHasUserValue(name),

    /**
     * Sets the preference *name* to *value*. If the preference already
     * exists, it must have the same type as the given value.
     *
     * @param {name} name The name of the preference to change.
     * @param {string|number|boolean} value The value to set.
     */
    set: function set(name, value) {
        let type = typeof value;
        if (type === "string") {
            let string = SupportsString();
            string.data = value;
            this.branch.setComplexValue(name, Ci.nsISupportsString, string);
        }
        else if (type === "number")
            this.branch.setIntPref(name, value);
        else if (type === "boolean")
            this.branch.setBoolPref(name, value);
        else
            throw TypeError("Unknown preference type: " + type);
    },

    /**
     * Resets the preference *name* to its default value.
     *
     * @param {string} name The name of the preference to reset.
     */
    reset: function reset(name) {
        if (this.branch.prefHasUserValue(name))
            this.branch.clearUserPref(name);
    }
};

let prefs = new Prefs("");

function contentWindows() {
    let windows = Services.wm.getXULWindowEnumerator(null);
    while (windows.hasMoreElements()) {
        let window = windows.getNext().QueryInterface(Ci.nsIXULWindow);
        for each (let type in ["typeContent"]) {
            let docShells = window.docShell.getDocShellEnumerator(Ci.nsIDocShellTreeItem[type],
                                                                  Ci.nsIDocShell.ENUMERATE_FORWARDS);
            while (docShells.hasMoreElements())
                yield docShells.getNext().QueryInterface(Ci.nsIDocShell)
                               .contentViewer.DOMDocument.defaultView;
        }
    }
}

function httpGet(url) {
    let xmlhttp = XMLHttpRequest("GET", url, false);
    xmlhttp.overrideMimeType("text/plain");
    xmlhttp.send(null);
    return xmlhttp;
}

function topWindow(win)
        win.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIWebNavigation)
           .QueryInterface(Ci.nsIDocShellTreeItem).rootTreeItem
           .QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindow);

function startup(data, reason) {
    AddonManager.getAddonByID(data.id, function (addon_) {
        addon = addon_;
        manager.init(reason);
    });
}

function shutdown(data, reason) {
    if (reason != APP_SHUTDOWN)
        manager.cleanup();
}

function uninstall(data, reason) {
    if (reason == ADDON_UNINSTALL)
        manager.uninstall();
}

function install(data, reason) {}

