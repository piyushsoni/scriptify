// Copyright (c) 2011-2014 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE file included with this file.
"use strict";

var EXPORTED_SYMBOLS = ["Addon", "ChannelStream", "Stager", "Stream"];

var BOOTSTRAP_JS = "resource://scriptify/scriptified/bootstrap.js";

var RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
var EM  = "http://www.mozilla.org/2004/em-rdf#";

var { AddonManager } = module("resource://gre/modules/AddonManager.jsm");

var { config } = require("config");
var { services } = require("services");
var { template, util } = require("util");

lazyRequire("dom", ["DOM"]);
lazyRequire("io", ["File", "io"]);

var COMPRESSABLE_WHITELIST = [
    "application/x-javascript",
    "application/javascript",
    /^text\//,
    /^application\/(.*\+|)xml$/
];

function GC() {
    util.trapErrors(function () {
        services.windowMediator.getMostRecentWindow(null)
                .QueryInterface(Ci.nsIInterfaceRequestor)
                .getInterface(Ci.nsIDOMWindowUtils)
                .garbageCollect();
    });
}

var Stream = function Stream(uri) {
    Cu.reportError(uri.spec);
    return util.withProperErrors("open", services.io.newChannelFromURI(uri));
};

// Hack
var ChannelStream = Class("ChannelStream", XPCOM(Ci.nsIStreamListener), {
    init: function init(uri, errors, needAsync) {
        this.errors = errors;
        this.channel = services.io.newChannelFromURI(uri);
        if (uri instanceof Ci.nsIFileURL || uri instanceof Ci.nsIJARURI)
            if (!needAsync)
                return Stream(uri);

        this.pipe = services.Pipe(false, true, 0, 0, null);
        this.channel.asyncOpen(this, null);
        return this.pipe.inputStream;
    },
    onStopRequest: function onStopRequest(request, context, status) {
        if (status && this.errors)
            this.errors.appendError(this.channel.URI.spec, status);

        this.pipe.outputStream.close();
    },
    onDataAvailable: util.wrapCallback(function onDataAvailable(request, context, stream, offset, count) {
        this.pipe.outputStream.writeFrom(stream, count);
    })
});

var StagerBase = Class("StagerBase", XPCOM(Ci.nsIRequestObserver), {
    init: function init() {
        this.errors = [];
    },

    appendError: function appendError(file, error) {
        if (typeof error == "number")
            error = services.stringBundle.formatStatusMessage(error, []);

        util.reportError(error && error.stack ? error : Error(error));

        if (file instanceof Ci.nsIURI)
            file = file.spec;

        this.errors.push([file, error]);
    }
});

var Stager = Class("Stager", StagerBase, {
    init: function init(xpi, truncate) {
        init.superapply(this, arguments);

        if (xpi.exists() && xpi.isDirectory())
            return BastardStagerFromHell(xpi);
        this.xpi = File(xpi);

        this.truncate = truncate ? File.MODE_TRUNCATE : 0;
    },

    getResourceURI: function getResourceURI(path) {
        return util.newURI("jar:" + this.xpi.URI.spec + "!/" + path)
                   .QueryInterface(Ci.nsIJARURI);
    },

    writer: Class.Memoize(function ()
        services.ZipWriter(this.xpi.file,
                           File.MODE_RDWR | (this.xpi.exists() ? this.truncate : File.MODE_CREATE))),

    compression: 9,

    add: function add(path, obj) {
        this.queue = this.queue || {};
        this.types = this.types || {};
        try {
            if (this.writer.hasEntry(path))
                this.writer.removeEntry(path, true);

            if (obj instanceof Ci.nsIFile || obj instanceof File)
                obj = File(obj).URI;

            if (obj instanceof Ci.nsIURI) {
                if (/^data:([^,;]+)/.test(obj.spec))
                    this.types[path] = RegExp.$1;
                else
                    try { this.types[path] = services.mime.getTypeFromURI(obj); } catch (e) {}
            }
            else
                this.types[path] = "text/plain";

            if (obj instanceof Ci.nsIURI)
                obj = ChannelStream(obj, this)
            else if (isString(obj))
                obj = services.CharsetConv("UTF-8").convertToInputStream(obj);

            this.queue[path] = obj;
        }
        catch (e) {
            this.appendError(path, e);
        }
    },

    getLevel: function getLevel(path) {
        let type = this.types[path];
        if (COMPRESSABLE_WHITELIST.some(function (pattern) pattern == type || pattern.test && pattern.test(type)))
            return this.compression;
        return 0;
    },

    finish: function finish(listener) {

        for (let [path, obj] in Iterator(this.queue || {}))
            if (obj instanceof Ci.nsIInputStream)
                this.writer.addEntryStream(path, 0, this.getLevel(path), obj, true);
            else if (obj instanceof Ci.nsIFile || obj instanceof File)
                this.writer.addEntryFile(path, this.getLevel(path), obj, true);

        this.listener = listener;
        this.timeout(bind("processQueue", this.writer, this, null));
    },

    onStartRequest: function onStartRequest(request, context) {
        if (this.listener && this.listener.onStartRequest)
            util.trapErrors("onStartRequest", this.listener, request, context);
    },

    onStopRequest: util.wrapCallback(function onStopRequest(request, context, status) {
        this.queue = 0;

        // Windows. Blech.
        try {
            if (config.OS.isWindows)
                GC();
            this.writer.close();
        }
        catch (e if config.OS.isWindows) {
            Cu.reportError(e);
        }

        util.flushCache(this.xpi);
        this.truncate = 0;
        delete this.writer;

        if (status)
            this.appendError(null, status);

        if (this.listener && this.listener.onStopRequest)
            util.trapErrors("onStopRequest", this.listener, request, context, status);
    })
});

var BastardStagerFromHell = Class("BastardStagerFromHell", StagerBase, {
    init: function init(root) {
        init.superapply(this, arguments);

        this.root = root;
        this.writes = [];
    },

    get queue() this.writes.length,

    getResourceURI: function getResourceURI(path) this.root.child(path).URI,

    add: function add(path, obj) {
        if (obj instanceof Ci.nsIURI && obj.equals(this.getResourceURI(path)))
            return;

        try {
            if (obj instanceof Ci.nsIURI)
                obj = ChannelStream(obj, this, true)
            else if (isString(obj))
                obj = services.CharsetConv("UTF-8").convertToInputStream(obj);

            this.writes.push([path, obj]);
        }
        catch (e) {
            this.appendError(path, e);
        }
    },

    finish: function finish(listener) {
        this.listener = listener;
        this.writeNext();
    },

    writeNext: util.wrapCallback(function () {
        if (this.writes.length) {
            let [path, stream] = this.writes.shift();

            this.currentFile = path;

            try {
                let file = this.root.child(path);
                if (!file.exists()) // OCREAT won't create the directory
                    file.create(file.NORMAL_FILE_TYPE, octal(666));

                let mode = File.MODE_WRONLY | File.MODE_CREATE | File.MODE_TRUNCATE;
                this.outputStream = services.FileOutStream(file, mode, octal(666), 0);

                services.StreamCopier(stream, this.outputStream, null,
                                      true, true, 4096, true, true)
                        .asyncCopy(this, null);
            }
            catch (e) {
                this.appendError(path, e);
            }
        }
        else if (this.listener && this.listener.onStopRequest)
            util.trapErrors("onStopRequest", this.listener);
    }),

    onStopRequest: util.wrapCallback(function (request, context, status) {
        if (status)
            this.appendError(this.currentFile, status);

        util.trapErrors("close", this.outputStream);
        this.writeNext();
    })
});

var Addon = Class("Addon", {
    init: function init(root, updates) {
        if (root instanceof Ci.nsIURI)
            root = util.getFile(uri);
        else if (root.getResourceURI) {
            this.addon = root;
            root = root.getResourceURI("");
        }

        this.rename = {};
        this.remove = {};
        this.root = File(root);

        this.update(updates);
    },

    get isProxy() this.addon
               &&  this.root.isDirectory()
               && !this.root.equals(File(services.directory.get("ProfD", Ci.nsIFile))
                                                 .child("extensions")
                                                 .child(this.addon.id)),

    getResourceURI: function getResource(path) {
        if (this.root.isDirectory())
            return this.root.child(path).URI;

        return util.newURI("jar:" + this.root.URI.spec + "!/" + path);
    },

    restage: function restage(xpi, listener) {
        let { isProxy } = this;

        if (xpi instanceof Ci.nsIFile || xpi instanceof File)
            this.xpi = xpi;
        else {
            this.listener = listener;
            this.install = xpi === undefined || xpi == true;
            if (isProxy)
                this.xpi = this.root;
            else
                this.xpi = io.createTempFile(this.root.leafName
                                                 .replace(/(\.xpi)?$/, ".xpi"),
                                             "file");

            listener = this;
        }

        let stager = Stager(this.xpi);

        if (isProxy)
            for (let path in keys(this.remove)) {
                let file = this.root.child(path);
                if (!/^\.\.(\/|\\|$)/.test(file.getRelativeDescriptor(this.root)))
                    // Paranoia yay.
                    file.remove(true);
            }
        else {
            util.flushCache(this.xpi);
            if (this.xpi.exists())
                this.xpi.remove(true);

            for (let file of this.contents)
                if (!Set.has(this.remove, file))
                    stager.add(Set.has(this.rename, file) ? this.rename[file] : file,
                               this.getResourceURI(file));
        }

        this.manifest["scriptify-version"] = config.addon.version;

        stager.add("bootstrap.js", util.newURI(BOOTSTRAP_JS));
        stager.add("scriptify.json", util.prettifyJSON(this.manifest));
        stager.add("install.rdf", this.installRDF);
        stager.finish(listener);
    },

    onStartRequest: function onStartRequest(request, context) {
        if (this.listener && this.listener.onStartRequest)
            util.trapErrors("onStartRequest", this.listener, request, context);
    },

    onStopRequest: function onStopRequest(request, context, status) {
        if (this.install) {
            // Alas, without this we wind up with dead objects holding file
            // descriptors open, and Windows, with its lovely mandatory
            // file locking, refuses to delete the previous version of
            // the add-on.
            if (!this.root.isDirectory())
                util.flushCache(this.root);
            if (config.OS.isWindows)
                GC();

            if (this.isProxy)
                util.rehash(this.addon);
            else {
                if (config.OS.isWindows) {
                    let { id } = this.metadata;
                    let dir = File(services.directory.get("ProfD", Ci.nsIFile))
                                    .child("extensions/trash");

                    for (let ext of [".xpi", ""]) {
                        let file = dir.child(id + ext);
                        if (file.exists())
                            try { file.remove(true); } catch (e) {}
                        if (file.exists())
                            try { file.moveTo(file.parent, Date.now() + file.leafName) } catch (e) {}
                    }
                }
                AddonManager.getInstallForFile(this.xpi.file, this.closure.installInstaller,
                                               "application/x-xpinstall");
            }

            if (this.listener && this.listener.onStopRequest)
                util.trapErrors("onStopRequest", this.listener, request, context, status);
        }
        else {
            if (this.root.exists() && this.root.isDirectory())
                this.root.remove(true);
            this.xpi.moveTo(this.root.parent, this.root.leafName);
        }
    },

    installInstaller: function installInstaller(installer) {
        installer.addListener(this);
        installer.install();
    },

    onInstallEnded: function onInstallEnded() {
        // Windows. Blech.
        util.flushCache(this.xpi);
        if (this.xpi.exists())
            this.xpi.remove(false);
    },
    get onInstallCancelled() this.onInstallEnded,
    get onInstallFailed() this.onInstallEnded,

    get installRDF() Addon.InstallRDF(
        update(this.metadata, {
            targetApplications: Addon.getMetadata(config.addon.getResourceURI("install.rdf"))
                                     .targetApplications
        }),
        this.unpack),

    get contents() {
        function rec(dir, path) {
            for (let elem in dir.iterDirectory())
                if (elem.isDirectory())
                    rec(elem, path + elem.leafName + "/");
                else
                    res.push(path + elem.leafName)
        }

        let res = [];
        if (this.root.isDirectory())
            rec(this.root, "");
        else {
            let jar = services.ZipReader(this.root.file);
            try {
                res = iter(jar.findEntries("*")).toArray();
            }
            finally {
                jar.close();
            }
        }
        return res;
    },

    manifest: Class.Memoize(function () JSON.parse(util.httpGet(this.getResourceURI("scriptify.json").spec).responseText)),

    metadata: Class.Memoize(function () Addon.getMetadata(this.getResourceURI("install.rdf")))
}, {
    // From XPIProvider.jsm
    idTest: /^(\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}|[a-z0-9-\._]*\@[a-z0-9-\._]+)$/i,

    getMetadata: function getMetadata(uri) {
        function em(tag) services.rdf.GetResource(EM + tag);
        function literal(resource, key)
                let (target = rdf.GetTarget(resource, em(key), true))
                    target instanceof Ci.nsIRDFLiteral ? target.Value : null;

        function stuff(resource) {
            let metadata = {};
            for (let key of ["bootstrap", "unpack"])
                metadata[key] = literal(resource, key) == "true";

            for (let key of ["aboutURL", "creator", "description", "homepageURL",
                             "icon64URL", "iconURL", "id", "name", "optionsType",
                             "optionsURL", "updateKey", "updateURL", "version"])
                metadata[key] = literal(resource, key);

            for (let key of ["contributor", "developer", "targetPlatform", "translator"])
                metadata[key + "s"] = iter(rdf.GetTargets(resource, em(key), true), Ci.nsIRDFLiteral)
                    .map(function (target) target.Value)
                    .toArray();

            return metadata;
        }

        var rdf = services.RDFSink();
        services.RDFParser().parseString(rdf, uri,
                                         util.httpGet(uri.spec).responseText);

        var install_manifest = services.rdf.GetResource("urn:mozilla:install-manifest");

        var metadata = stuff(install_manifest);
        metadata.targetApplications = {};

        metadata.localized = iter(rdf.GetTargets(install_manifest, em("localized"), true))
                .map(function (target) [literal(target, "locale"), stuff(target)])
                .toObject();

        for (let target in iter(rdf.GetTargets(install_manifest, em("targetApplication"), true)))
            metadata.targetApplications[literal(target, "id")] = {
                minVersion: literal(target, "minVersion"),
                maxVersion: literal(target, "maxVersion")
            };

        return metadata;
    },

    InstallRDF: function InstallRDF(metadata, unpack) {
        let rdf = ["RDF", { xmlns: RDF, "xmlns:em": EM },
            ["Description", { about: "urn:mozilla:install-manifest" },
                ["em:type", {}, 2],
                ["em:id", {}, metadata.id],
                ["em:name", {}, metadata.name],
                ["em:version", {}, metadata.version],
                ["em:unpack", {}, !!(unpack != null ? unpack : metadata.unpack)],
                ["em:bootstrap", {}, true],

                template.map(["creator", "description", "homepageURL",
                                "updateURL", "updateKey",
                                "optionsType", "optionsURL"],
                    function (key) metadata[key] ? ["em:" + key, {}, metadata[key]]
                                                 : undefined),

                template.map(metadata.developers || [], function (name)
                    ["em:developer", {}, name]),

                template.map(metadata.contributors || [], function (name)
                    ["em:contributor", {}, name]),

                template.map(Iterator(metadata.localized), function ([id, attr])
                    ["em:localized", {},
                        ["Description", {},
                            ["em:locale", {}, id,
                                template.map(Iterator(attr), function ([key, val]) {
                                    let singular = key.replace(/s$/, "");
                                    if (isArray(val))
                                        return template.map(val, function (val)
                                               ["em:" + singular, {}, val]);
                                    if (val)
                                        return ["em:" + key, {}, metadata[key]];
                              })]]]),

                template.map(metadata.targetApplications, function ([id, attr])
                    ["em:targetApplication", {},
                        ["Description", {},
                            ["em:id", {}, id],
                            ["em:minVersion", {}, attr.minVersion],
                            ["em:maxVersion", {}, attr.maxVersion]]])
        ]];

        return '<?xml version="1.0" encoding="UTF-8"?>\n' +
               DOM.toPrettyXML(rdf, true);
    }
});
