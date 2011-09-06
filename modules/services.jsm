// Copyright (c) 2008-2011 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

var EXPORTED_SYMBOLS = "services";

lazyRequire("util", ["util"]);

/**
 * A lazily-instantiated XPCOM class and service cache.
 */
var services = Singleton("services", {
    init: function () {
        this.services = {};

        this.add("appStartup",          "@mozilla.org/toolkit/app-startup;1",               "nsIAppStartup");
        this.add("cache",               "@mozilla.org/network/cache-service;1",             "nsICacheService");
        this.add("charset",             "@mozilla.org/charset-converter-manager;1",         "nsICharsetConverterManager");
        this.add("chromeRegistry",      "@mozilla.org/chrome/chrome-registry;1",            "nsIXULChromeRegistry");
        this.add("console",             "@mozilla.org/consoleservice;1",                    "nsIConsoleService");
        this.add("directory",           "@mozilla.org/file/directory_service;1",            "nsIProperties");
        this.add("downloadManager",     "@mozilla.org/download-manager;1",                  "nsIDownloadManager");
        this.add("environment",         "@mozilla.org/process/environment;1",               "nsIEnvironment");
        this.add("externalApp",         "@mozilla.org/uriloader/external-helper-app-service;1", "nsPIExternalAppLauncher")
        this.add("externalProtocol",    "@mozilla.org/uriloader/external-protocol-service;1", "nsIExternalProtocolService");
        this.add("io",                  "@mozilla.org/network/io-service;1",                "nsIIOService");
        this.add("messages",            "@mozilla.org/globalmessagemanager;1",              "nsIChromeFrameMessageManager");
        this.add("mime",                "@mozilla.org/mime;1",                              "nsIMIMEService");
        this.add("observer",            "@mozilla.org/observer-service;1",                  "nsIObserverService");
        this.add("pref",                "@mozilla.org/preferences-service;1",               ["nsIPrefBranch2", "nsIPrefService"]);
        this.add("rdf",                 "@mozilla.org/rdf/rdf-service;1",                   "nsIRDFService");
        this.add("resource:",           "@mozilla.org/network/protocol;1?name=resource",    ["nsIProtocolHandler", "nsIResProtocolHandler"]);
        this.add("runtime",             "@mozilla.org/xre/runtime;1",                       ["nsIXULAppInfo", "nsIXULRuntime"]);
        this.add("scriptify:",          "@mozilla.org/network/protocol;1?name=scriptify");
        this.add("security",            "@mozilla.org/scriptsecuritymanager;1",             "nsIScriptSecurityManager");
        this.add("stringBundle",        "@mozilla.org/intl/stringbundle;1",                 "nsIStringBundleService");
        this.add("stylesheet",          "@mozilla.org/content/style-sheet-service;1",       "nsIStyleSheetService");
        this.add("scriptLoader",        "@mozilla.org/moz/jssubscript-loader;1",            "mozIJSSubScriptLoader");
        this.add("tld",                 "@mozilla.org/network/effective-tld-service;1",     "nsIEffectiveTLDService");
        this.add("threading",           "@mozilla.org/thread-manager;1",                    "nsIThreadManager");
        this.add("urifixup",            "@mozilla.org/docshell/urifixup;1",                 "nsIURIFixup");
        this.add("versionCompare",      "@mozilla.org/xpcom/version-comparator;1",          "nsIVersionComparator");
        this.add("windowMediator",      "@mozilla.org/appshell/window-mediator;1",          "nsIWindowMediator");
        this.add("windowWatcher",       "@mozilla.org/embedcomp/window-watcher;1",          "nsIWindowWatcher");
        this.add("zipReader",           "@mozilla.org/libjar/zip-reader-cache;1",           "nsIZipReaderCache");

        this.addClass("CharsetConv",  "@mozilla.org/intl/scriptableunicodeconverter", "nsIScriptableUnicodeConverter", "charset");
        this.addClass("CharsetStream","@mozilla.org/intl/converter-input-stream;1",   ["nsIConverterInputStream",
                                                                                       "nsIUnicharLineInputStream"], "init");
        this.addClass("ConvOutStream","@mozilla.org/intl/converter-output-stream;1", "nsIConverterOutputStream", "init", false);
        this.addClass("File",         "@mozilla.org/file/local;1",                 "nsILocalFile");
        this.addClass("FileInStream", "@mozilla.org/network/file-input-stream;1",  "nsIFileInputStream", "init", false);
        this.addClass("FileOutStream","@mozilla.org/network/file-output-stream;1", "nsIFileOutputStream", "init", false);
        this.addClass("FilePicker",   "@mozilla.org/filepicker;1",                 "nsIFilePicker", "init");
        this.addClass("InterfacePointer", "@mozilla.org/supports-interface-pointer;1", "nsISupportsInterfacePointer", "data");
        this.addClass("InputStream",  "@mozilla.org/scriptableinputstream;1",      "nsIScriptableInputStream", "init");
        this.addClass("Persist",      "@mozilla.org/embedding/browser/nsWebBrowserPersist;1", "nsIWebBrowserPersist");
        this.addClass("Pipe",         "@mozilla.org/pipe;1",                       "nsIPipe", "init");
        this.addClass("Process",      "@mozilla.org/process/util;1",               "nsIProcess", "init");
        this.addClass("StreamChannel","@mozilla.org/network/input-stream-channel;1",
                      ["nsIInputStreamChannel", "nsIChannel"], "setURI");
        this.addClass("StreamCopier", "@mozilla.org/network/async-stream-copier;1","nsIAsyncStreamCopier", "init");
        this.addClass("String",       "@mozilla.org/supports-string;1",            "nsISupportsString", "data");
        this.addClass("StringStream", "@mozilla.org/io/string-input-stream;1",     "nsIStringInputStream", "data");
        this.addClass("Transfer",     "@mozilla.org/transfer;1",                   "nsITransfer", "init");
        this.addClass("Timer",        "@mozilla.org/timer;1",                      "nsITimer", "initWithCallback");
        this.addClass("URL",          "@mozilla.org/network/standard-url;1",       ["nsIStandardURL", "nsIURL"], "init");
        this.addClass("Xmlhttp",      "@mozilla.org/xmlextras/xmlhttprequest;1",   "nsIXMLHttpRequest", "open");
        this.addClass("ZipReader",    "@mozilla.org/libjar/zip-reader;1",          "nsIZipReader", "open");
        this.addClass("ZipWriter",    "@mozilla.org/zipwriter;1",                  "nsIZipWriter", "open");
    },

    _create: function (name, args) {
        try {
            var service = this.services[name];

            let res = Cc[service.class][service.method || "getService"]();
            if (!service.interfaces.length)
                return res.wrappedJSObject;

            service.interfaces.forEach(function (iface) res.QueryInterface(Ci[iface]));
            if (service.init && args.length) {
                if (service.callable)
                    res[service.init].apply(res, args);
                else
                    res[service.init] = args[0];
            }
            return res;
        }
        catch (e if service.quiet !== false) {
            require("util").util.reportError(e);
            return null;
        }
    },

    /**
     * Adds a new XPCOM service to the cache.
     *
     * @param {string} name The service's cache key.
     * @param {string} class The class's contract ID.
     * @param {string|[string]} ifaces The interface or array of
     *     interfaces implemented by this service.
     * @param {string} meth The name of the function used to instantiate
     *     the service.
     */
    add: function (name, class_, ifaces, meth) {
        const self = this;
        this.services[name] = { method: meth, class: class_, interfaces: Array.concat(ifaces || []) };
        if (name in this && ifaces && !this.__lookupGetter__(name) && !(this[name] instanceof Ci.nsISupports))
            throw TypeError();
        memoize(this, name, function () self._create(name));
    },

    /**
     * Adds a new XPCOM class to the cache.
     *
     * @param {string} name The class's cache key.
     * @param {string} class_ The class's contract ID.
     * @param {string|[string]} ifaces The interface or array of
     *     interfaces implemented by this class.
     * @param {string} init Name of a property or method used to initialize the
     *     class.
     */
    addClass: function (name, class_, ifaces, init, quiet) {
        const self = this;
        this.services[name] = { class: class_, interfaces: Array.concat(ifaces || []), method: "createInstance", init: init, quiet: quiet };
        if (init)
            memoize(this.services[name], "callable",
                    function () callable(XPCOMShim(this.interfaces)[this.init]));

        this[name] = function () self._create(name, arguments);
        update.apply(null, [this[name]].concat([Ci[i] for each (i in Array.concat(ifaces))]));
        return this[name];
    },
    /**
     * Returns true if the given service is available.
     *
     * @param {string} name The service's cache key.
     */
    has: function (name) Set.has(this.services, name) && this.services[name].class in Cc &&
        this.services[name].interfaces.every(function (iface) iface in Ci)
});

// vim: set fdm=marker sw=4 sts=4 et ft=javascript:
