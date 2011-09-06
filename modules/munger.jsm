// Copyright (c) 2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

var EXPORTED_SYMBOLS = ["Munger", "Script"];

var { Addon, Stager, Stream } = require("addon");
var { File } = require("io");
var { services } = require("services");
var { util } = require("util");

let Munger = Class("Munger", XPCOM(Ci.nsIRequestObserver), {
    init: function init(root, urls, callbacks, truncate) {
        this.processed = {};
        this.mungeQueue = [];
        this.transferQueue = [];
        this.callbacks = callbacks;

        this.metadata = {
            id: "",
            name: "",
            description: "",
            version: "",
            set creator(val) this.authors = val.split(/, /g),
            get creator() this.authors.join(", "),
            authors: [],
            developers: [],
            contributors: [],
            match: [],
            include: [],
            exclude: [],
            "run-at-startup": true,
            "run-when": "ready",
            paths: [],
            charset: "UTF-8",
            targetApplications: Addon.getMetadata(util.newURI("resource://scriptify/install.rdf"))
                                     .targetApplications
        };

        this.root = root;

        this.stager = Stager(this.root, truncate);

        for each (let url in Array.concat(urls))
            this.processScript(url);

        this.stager.finish(this);
    },

    get errors() this.stager.errors,

    cancel: function cancel() {
        this.dispatch("cancel");
        this.canceled = true;
        this.callbacks = null;
    },

    dispatch: function dispatch(event) {
        event = "on" + event[0].toUpperCase() + event.slice(1);
        if (this.callbacks && event in this.callbacks)
            util.trapErrors.apply(util, [event, this.callbacks, this].concat(Array.slice(arguments, 1)));
    },

    contentURI: function contentURI(file) this.stager.getResourceURI("content/" + file),

    process: function process(uri, target) {
        if (isString(uri))
            uri = util.newURI(uri);

        if (Set.add(this.processed, uri.spec))
            return;

        this.dispatch("transferStarted", uri.spec, target);
        this.transferQueue.push(uri);

        this.stager.add(target, uri);
    },

    processStream: function processStream(stream, target) {
        this.stager.add(target, stream, true);
    },

    processScript: function processScript(uri) {
        if (isString(uri))
            uri = util.newURI(uri);
        else if (uri instanceof Ci.nsIFile)
            uri = File(uri).URI;

        if (!this.principal) {
            this.principal = uri;
            if (!this.metadata.id && uri instanceof Ci.nsIURL)
                this.metadata.id = uri.fileBaseName.replace(/\.user$/, "")
                                 + "@" + uri.host;
        }

        this.mungeQueue.push(uri.QueryInterface(Ci.nsIURL).fileName);
        this.process(uri, "content/" + uri.fileName);
    },

    onStartRequest: function onStartRequest(request, context) {
    },

    onStopRequest: function onStopRequest(request, context, status) {
        if (this.canceled)
            return;

        for (let url in values(this.transferQueue))
            this.dispatch("transferComplete", url.spec || url.path);
        this.transferQueue.length = 0;

        let queue = this.mungeQueue;
        this.mungeQueue = [];
        for (let script in values(queue)) {
            let uri = this.contentURI(script);
            this.metadata.paths.unshift("content/" + script);

            let getURI = function getURI(spec) util.newURI(spec, null, uri).spec;

            try {
                for (let [k, v] in Script(uri).metadata) {
                    switch (k) {
                    case "resource":
                        let [name, uri] = v.split(/\s+/);
                        this.process(getURI(uri), name);
                        break;
                    case "require":
                        this.processScript(getURI(v));
                        break;
                    }

                    if (script == this.principal.fileName)
                        switch (k) {
                        case "id":
                        case "name":
                        case "description":
                        case "version":
                            this.metadata[k] = v;
                            break;
                        case "run-at":
                            this.metadata["run-when"] = v;
                            break;
                        case "run-at-startup":
                            this.metadata["run-at-startup"] = !~["false", "no", 0].indexOf(v);
                            break;
                        case "homepage":
                        case "homepageURL":
                        case "website":
                            this.metadata.homepage = v;
                            break;
                        case "match":
                            this.metadata[k].push(v);
                            break;
                        case "include":
                        case "exclude":
                            this.metadata[k].push(Munger.mungeURLFilter(v));
                            break;
                        case "author":
                        case "developer":
                        case "contributor":
                            this.metadata[k + "s"].push(v);
                            break;
                        case "icon":
                        case "iconURL":
                            let [icon, icon64] = v.split(/\s+/);
                            this.process(getURI(icon), "icon.png");
                            if (icon64)
                                this.process(getURI(icon64), "icon64.png");
                            break;
                        case "icon64":
                        case "icon64URL":
                            this.process(getURI(v), "icon64.png");
                        }
                }
            }
            catch (e) {
                this.errors.push([script, e]);
            }

            if (script == this.principal.fileName)
                this.stager.add("install.rdf", Addon.InstallRDF(this.metadata, true));
        }

        if (this.stager.queue)
            this.stager.finish(this);
        else {
            this.complete = true;
            this.dispatch("complete");
        }
    }
}, {
    /**
     * Fix some common incompatibilities in URL filters.
     */
    mungeURLFilter: function mungeURLFilter(filter) {
        if (filter[0] == "/")
            return filter;

        if (RegExp("^(?:[a-z-*]+)://(?:[^/])+\\*$").test(filter))
            filter += "/*";

        filter = filter.replace(/^http\*:/, "*:")
                       .replace(RegExp("^([a-z-*]+://[^/]+)\\.\\*/"),
                                "$1.tld/");

        return filter;
    },

    bootstrap: Class.Memoize(function () {
        let bootstrap = {};
        services.scriptLoader.loadSubScript("resource://scriptify/scriptified/bootstrap.js",
                                            bootstrap);
        return bootstrap;
    }),

    validateMatcher: function validateMatcher(str) {
        return str.split(/\n+/).filter(util.identity)
                  .every(bind("URIMatcher", Munger.bootstrap.util));
    }
});

let Script = Class("Script", {
    init: function init(uri) {
        this.uri = uri;
    },

    get lines() {
        return File.readLines(Stream(this.uri));
    },

    get metadata() {
        let lines = { __iterator__: function () this, next: bind("next", this.lines) };

        for (let line in lines)
            if (/^\s*\/\/\s+==UserScript==\s*$/.test(line))
                break;

        for (let line in lines) {
            if (/^\s*\/\/\s+==\/UserScript==\s*$/.test(line))
                return;

            if (/\s*\/\/\s*@(\S+)(?:\s+(.*?)\s*)?$/.test(line))
                yield [RegExp.$1, RegExp.$2 || ""]
        }
    },
});

// vim:se sts=4 sw=4 et ft=javascript:
