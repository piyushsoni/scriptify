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
const { XPCOMUtils }   = module("resource://gre/modules/XPCOMUtils.jsm");

const Services = Object.create(module("resource://gre/modules/Services.jsm").Services);
XPCOMUtils.defineLazyServiceGetter(Services, "clipboard", "@mozilla.org/widget/clipboardhelper;1", "nsIClipboardHelper");
XPCOMUtils.defineLazyServiceGetter(Services, "mime", "@mozilla.org/mime;1", "nsIMIMEService");
XPCOMUtils.defineLazyServiceGetter(Services, "security", "@mozilla.org/scriptsecuritymanager;1", "nsIScriptSecurityManager");
XPCOMUtils.defineLazyServiceGetter(Services, "tld", "@mozilla.org/network/effective-tld-service;1", "nsIEffectiveTLDService");

const resourceProto = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);

const principal = Cc["@mozilla.org/nullprincipal;1"].createInstance(Ci.nsIPrincipal);

var addon;

function wrap(fn, throws)
    function wrapper() {
        try {
            return fn.apply(this, arguments);
        }
        catch (e) {
            Cu.reportError(e);
            Services.console.logStringMessage(e.stack || Error().stack);
            if (throws)
                throw e;
        }
    }

try {
    Services.wm.getMostRecentWindow("navigator:browser")
            .dactyl.modules.scriptify = this;
}
catch (e) {}

let manager = {
    TOPIC: "content-document-global-created",

    init: function init(reason) {
        this.prefs = prefs.Branch("extensions." + addon.id + ".");

        this.package = addon.id.replace("@", ".");

        resourceProto.setSubstitution(this.package, addon.getResourceURI("."));

        this.config = JSON.parse(util.httpGet(addon.getResourceURI("scriptify.json").spec)
                                     .responseText);

        for each (let script in this.config.scripts)
            script.matchers = {
                include: (script.include || []).map(function (pat) util.URIMatcher(pat)),
                exclude: (script.exclude || []).map(function (pat) util.URIMatcher(pat)),
            };

        for (let [k, v] in Iterator(this.config.preferences || {}))
            this.prefs.defaults.set(k, v);

        for (let window in util.contentWindows)
            this.load(window, true);

        Services.obs.addObserver(this, this.TOPIC, false);
    },

    cleanup: function cleanup() {
        resourceProto.setSubstitution(this.package, null);
        Services.obs.removeObserver(this, this.TOPIC);
    },

    uninstall: function uninstall() {
        if (this.prefs)
            this.prefs.clear();
    },

    getResourceURI: function getResourceURI(path) {
        let uri = util.newURI("resource://" + this.package);
        uri.path = path;
        return uri;
    },

    load: wrap(function load(window, startup) {
        if (!window.location.href)
            return;

        let uri = util.newURI(window.location.href);

        for each (let script in this.config.scripts) {
            if (startup && !script["run-at-startup"])
                continue;
            if (!~["file", "http", "https"].indexOf(uri.scheme) && uri.spec != "about:home")
                continue;
            if (script.matchers.exclude.some(function (test) test(uri)))
                continue;
            if (script.matchers.include.some(function (test) test(uri)))
                this.makeSandbox(window, script);
        }
    }),

    states: {
        "ready": [["interactive", "complete"], "document", "DOMContentLoaded"],
        "idle":  [["interactive", "complete"], "document", "DOMContentLoaded", true],
        "end":   [["complete"], "window", "load"]
    },

    makeSandbox: wrap(function makeSandbox(window, script) {
        if (script["run-when"] in this.states) {
            let [states, target, event, delay] = this.states[script["run-when"]];

            let doc = window.document;
            if (!~states.indexOf(doc.readyState)) {
                let again = function () { manager.makeSandbox(window, script); }
                if (delay)
                    util.listenOnce(window[target], event, function () { util.delay(again) });
                else
                    util.listenOnce(window[target], event, again);
                return;
            }
        }


        // Prevent multiple loads into the same window.
        let win = window.wrappedJSObject || win;
        if (!(addon.id in win))
            win[addon.id] = {};

        if (script.name in win[addon.id])
            return;

        win[addon.id][script.name] = true;


        let sandbox = Cu.Sandbox(window, { sandboxPrototype: window });
        sandbox.unsafeWindow = window.wrappedJSObject;

        Cu.evalInSandbox(GM_makeDOM, sandbox, "1.8",
                         Components.stack.filename, GM_makeDOM_line);

        let api = Object.create(apiBase);
        api.sandbox = sandbox;
        api.win = window;
        api.doc = window.document;

        Object.keys(apiBase).forEach(function (meth) {
            if (meth[0] != "_")
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
                    this.getResourceURI(path).spec,
                    sandbox,
                    script.charset);
            }
            catch (e if e instanceof Finished) {}

    }),

    QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver]),

    observe: wrap(function observe(subject, topic, data) {
        if (topic == this.TOPIC)
            this.load(subject);
    })
};

    /**
     * Generates DOM nodes from the given E4X XML literal.
     *
     * @param {xml} xml The XML literal to convert.
     * @param {object} nodes If present, created elements with a "key"
     *      attribute will be stored as properties of this object.
     *      @optional
     */
    let GM_makeDOM_line = Components.stack.lineNumber + 1;
    let GM_makeDOM = String(<![CDATA[
    default xml namespace = Namespace("html", "http://www.w3.org/1999/xhtml");
    function GM_makeDOM(xml, nodes) {
       if (xml.length() != 1) {
           let domnode = document.createDocumentFragment();
           for each (let child in xml)
               domnode.appendChild(GM_makeDOM(child, nodes));
           return domnode;
       }
       switch (xml.nodeKind()) {
       case "text":
           return document.createTextNode(String(xml));
       case "element":
           let domnode = document.createElementNS(xml.namespace(), xml.localName());
           for each (let attr in xml.@*::*)
               domnode.setAttributeNS(attr.namespace(), attr.localName(), String(attr));

           for each (let child in xml.*::*)
               domnode.appendChild(GM_makeDOM(child, nodes));
           if (nodes && "@key" in xml)
               nodes[xml.@key] = domnode;
           return domnode;
       default:
           return null;
       }
    }
    ]]>);

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
            util.listenOnce(this.doc, "DOMContentLoaded",
                            function () { func.call(self); });
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
    setValue: function setValue(key, value) {
        manager.prefs.set(key, value);
    },

    /**
     * Sets the default value of the preference *key* to *val.
     *
     * @param {string} key The name of the preference to retrieve.
     * @param {bool|int|string|null} value The value to set.
     * @see .getValue
     */
    setDefValue: function setDefValue(key, value) {
        manager.prefs.defaults.set(key, value);
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
        Services.clipboard.copyString(text);
    },

    /**
     * Opens the given URL in a new tab.
     *
     * @param {string} url The URL to load.
     * @param {boolean} background If true, the tab is loaded in the
     *      background. @optional
     */
    openInTab: function openInTab(url, background) {
        Services.security.checkLoadURIStrWithPrincipal(principal, url, 0);

        let { gBrowser } = util.topWindow(this.win);

        let owner = gBrowser._getTabForContentWindow(this.win.top);
        let sendReferer = !/^(https?|ftp):/.test(url) || prefs.get("network.http.sendRefererHeader");

        let tab = gBrowser.addTab(url, {
            ownerTab: owner,
            referrerURI: sendReferer ? util.newURI(this.win.location)
                                     : null
        });

        if (owner && (arguments.length > 1 && !background ||
                      owner == gBrowser.selectedTab && !prefs.get("browser.tabs.loadInBackground")))
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
        let uri = util.newURI(params.url);

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
        xhr.overrideMimeType(params.mimeType || "text/plain");

        xhr.send(params.data);
    },

    /**
     * Logs the stringified arguments to the Error Console.
     */
    log: function log() {
        Services.console.logStringMessage(addon.id + " (" + this.doc.location + "): " + Array.join(arguments, ", "));
    },

    /**
     * Logs the stringified arguments to the Error Console if the "debug"
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
     * Loads the script resource from this package at the given *path*
     * into *object*.
     *
     * @param {string} path The path of the script to load.
     * @param {object} object The object into which to load the script.
     *      @default The current sandbox.
     * @param {string} charset The character set as which to parse the
     *      script.
     *      @default "ISO-8859-1"
     */
    loadScript: function loadScript(path, object) {
        function principal(win) Services.security.getCodebasePrincipal(win.document.documentURIObject);

        if (!object)
            object = this.sandbox;
        // Would like to use Cu.getGlobalForObject, but it doesn't work
        // with security wrappers.
        else if (object !== this.sandbox && !(
                    object instanceof Ci.nsIDOMWindow &&
                    principal(this.win).subsumes(principal(object))))
            throw Error("Illegal target object");

        Services.scriptloader.loadSubScript(
            manager.getResourceURI(path).spec,
            object);
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
    getResourceURL: function getResourceURL(path) manager.getResourceURI(path).spec,

    /**
     * Returns the text of the file inside this extension at *path*.
     *
     * @param {string} path The path within this extension at which to
     *      find the resource.
     * @param {string} charset The character set from which to decode
     *      the file.
     *      @default "UTF-8"
     * @see .getResourceURL
     */
    getResourceText: function getResourceText(path, charset) {
        return util.httpGet(manager.getResourceURI(path).spec,
                            "text/plain;charset=" + (charset || "UTF-8"))
                    .responseText;
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

let util = {
    get contentWindows() {
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
    },

    delay: function delay(callback) {
        Services.tm.mainThread.dispatch(callback, 0);
    },

    globToRegexp: function globToRegexp(glob) {
        return RegExp("^" + glob.replace(/([\\{}()[\]^$.?+|])/g, "\\$1")
                                .replace(/\*/g, ".*") + "$");
    },

    httpGet: function httpGet(url) {
        let xmlhttp = XMLHttpRequest("GET", url, false);
        xmlhttp.overrideMimeType("text/plain");
        xmlhttp.send(null);
        return xmlhttp;
    },

    listenOnce: function listenOnce(target, eventName, callback, self) {
        target.addEventListener(eventName, function listener(event) {
            if (event.originalTarget == target) {
                target.removeEventListener(eventName, listener, false);
                wrap(callback).call(self || target, event);
            }
        }, false);
    },

    newURI: wrap(function newURI(url, charset, base) Services.io.newURI(url, charset, base), true),

    topWindow: function topWindow(win)
            win.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIWebNavigation)
               .QueryInterface(Ci.nsIDocShellTreeItem).rootTreeItem
               .QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindow),

    URIMatcher: function URIMatcher(pattern) {
        if (pattern == "*" || pattern == "<all_urls>")
            return function () true;

        if (/^\/(.*?)(?:\/([i]*))?$/.test(pattern))
            return let (re = RegExp(RegExp.$1, RegExp.$2))
                function (uri) re.test(uri.spec);

        let patternURI = util.newURI(pattern.replace(/^\*:/, "http:")).QueryInterface(Ci.nsIURL);
        let anyScheme = pattern.slice(0, 2) == "*:";

        let host = function host(uri) uri.host;
        if (/\.tld$/.test(patternURI.host))
            host = function host(uri) uri.host.slice(0, -Services.tld.getPublicSuffix(uri).length);

        let hostRe = util.globToRegexp(host(patternURI));
        if (patternURI.host.slice(0, 2) == ".*")
            hostRe = RegExp(/^(?:.*\.)?/.source + hostRe.source.slice(5));

        let pathRe = this.globToRegexp(patternURI.path);

        return function URIMatcher(uri) {
            return (anyScheme || uri.scheme == patternURI.scheme)
                && hostRe.test(host(uri))
                && pathRe.test(uri.path);
        }
    }
};

function startup(data, reason) {
    addon = data;
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

