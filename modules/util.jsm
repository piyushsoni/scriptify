// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

var EXPORTED_SYMBOLS = ["DOM", "XBL", "XHTML", "XUL", "FailedAssertion", "template", "util"];

require("dom", this);

lazyRequire("config", ["config"]);
lazyRequire("services", ["services"]);
lazyRequire("io", ["File"]);

var FailedAssertion = Class("FailedAssertion", ErrorBase, {
    init: function init(message, level, noTrace) {
        if (noTrace !== undefined)
            this.noTrace = noTrace;
        init.supercall(this, message, level);
    },

    level: 3,

    noTrace: true
});

var wrapCallback = function wrapCallback(fn, isEvent) {
    if (!fn.wrapper)
        fn.wrapper = function wrappedCallback() {
            try {
                let res = fn.apply(this, arguments);
                if (isEvent && res === false) {
                    arguments[0].preventDefault();
                    arguments[0].stopPropagation();
                }
                return res;
            }
            catch (e) {
                util.reportError(e);
                return undefined;
            }
        };
    fn.wrapper.wrapped = fn;
    return fn.wrapper;
}

var util = Singleton("util", {
    /**
     * Registers a obj as a new observer with the observer service. obj.observe
     * must be an object where each key is the name of a target to observe and
     * each value is a function(subject, data) to be called when the given
     * target is broadcast. obj.observe will be replaced with a new opaque
     * function. The observer is automatically unregistered on application
     * shutdown.
     *
     * @param {object} obj
     */
    addObserver: update(function addObserver(obj) {
        if (!obj.observers)
            obj.observers = obj.observe;

        function register(meth) {
            for (let target in Set(["scriptify-cleanup", "quit-application"].concat(Object.keys(obj.observers))))
                try {
                    services.observer[meth](obj, target, true);
                }
                catch (e) {}
        }

        Class.replaceProperty(obj, "observe",
            function (subject, target, data) {
                try {
                    if (target == "quit-application" || target == "scriptify-cleanup")
                        register("removeObserver");
                    if (obj.observers[target])
                        obj.observers[target].call(obj, subject, data);
                }
                catch (e) {
                    if (typeof util === "undefined")
                        addObserver.dump("scriptify: error: " + e + "\n" + (e.stack || addObserver.Error().stack).replace(/^/gm, "scriptify:    "));
                    else
                        util.reportError(e);
                }
            });

        obj.observe.unregister = function () register("removeObserver");
        register("addObserver");
    }, { dump: dump, Error: Error }),

    /*
     * Tests a condition and throws a FailedAssertion error on
     * failure.
     *
     * @param {boolean} condition The condition to test.
     * @param {string} message The message to present to the
     *     user on failure.
     */
    assert: function (condition, message, quiet) {
        if (!condition)
            throw FailedAssertion(message, 1, quiet === undefined ? true : quiet);
        return condition;
    },

    /**
     * CamelCases a -non-camel-cased identifier name.
     *
     * @param {string} name The name to mangle.
     * @returns {string} The mangled name.
     */
    camelCase: function camelCase(name) String.replace(name, /-(.)/g, function (m, m1) m1.toUpperCase()),

    /**
     * Capitalizes the first character of the given string.
     * @param {string} str The string to capitalize
     * @returns {string}
     */
    capitalize: function capitalize(str) str && str[0].toUpperCase() + str.slice(1).toLowerCase(),

    /**
     * Clips a string to a given length. If the input string is longer
     * than *length*, an ellipsis is appended.
     *
     * @param {string} str The string to truncate.
     * @param {number} length The length of the returned string.
     * @returns {string}
     */
    clip: function clip(str, length) {
        return str.length <= length ? str : str.substr(0, length - 3) + "...";
    },

    /**
     * Compares two strings, case insensitively. Return values are as
     * in String#localeCompare.
     *
     * @param {string} a
     * @param {string} b
     * @returns {number}
     */
    compareIgnoreCase: function compareIgnoreCase(a, b) String.localeCompare(a.toLowerCase(), b.toLowerCase()),

    /**
     * Prints a message to the console. If *msg* is an object it is pretty
     * printed.
     *
     * @param {string|Object} msg The message to print.
     */
    dump: function dump_() {
        let msg = Array.map(arguments, function (msg) {
            if (typeof msg == "object")
                msg = util.objectToString(msg);
            return msg;
        }).join(", ");

        dump(String.replace(msg, /\n?$/, "\n")
                   .replace(/^./gm, JSMLoader.name + ": $&"));
    },

    /**
     * Returns a list of reformatted stack frames from
     * {@see Error#stack}.
     *
     * @param {string} stack The stack trace from an Error.
     * @returns {[string]} The stack frames.
     */
    stackLines: function (stack) {
        let lines = [];
        let match, re = /([^]*?)@([^@\n]*)(?:\n|$)/g;
        while (match = re.exec(stack))
            lines.push(match[1].replace(/\n/g, "\\n").substr(0, 80) + "@" +
                       util.fixURI(match[2]));
        return lines;
    },

    /**
     * Dumps a stack trace to the console.
     *
     * @param {string} msg The trace message.
     * @param {number} frames The number of frames to print.
     */
    dumpStack: function dumpStack(msg, frames) {
        let stack = util.stackLines(Error().stack);
        stack = stack.slice(1, 1 + (frames || stack.length)).join("\n").replace(/^/gm, "    ");
        util.dump((arguments.length == 0 ? "Stack" : msg) + "\n" + stack + "\n");
    },

    /**
     * Returns the file which backs a given URL, if available.
     *
     * @param {nsIURI} uri The URI for which to find a file.
     * @returns {File|null}
     */
    getFile: function getFile(uri) {
        try {
            if (isString(uri))
                uri = util.newURI(util.fixURI(uri));

            if (uri instanceof Ci.nsIFileURL)
                return File(uri.file);

            if (uri instanceof Ci.nsIFile)
                return File(uri);

            let channel = services.io.newChannelFromURI(uri);
            channel.cancel(Cr.NS_BINDING_ABORTED);
            if (channel instanceof Ci.nsIFileChannel)
                return File(channel.file);
        }
        catch (e) {
            util.reportError(e);
        }
        return null;
    },

    /**
     * Returns the host for the given URL, or null if invalid.
     *
     * @param {string} url
     * @returns {string|null}
     */
    getHost: function (url) {
        try {
            return util.createURI(url).host;
        }
        catch (e) {}
        return null;
    },

    /**
     * Sends a synchronous or asynchronous HTTP request to *url* and returns
     * the XMLHttpRequest object. If *callback* is specified the request is
     * asynchronous and the *callback* is invoked with the object as its
     * argument.
     *
     * @param {string} url
     * @param {function(XMLHttpRequest)} callback
     * @returns {XMLHttpRequest}
     */
    httpGet: function httpGet(url, callback, self) {
        let params = callback;
        if (!isObject(params))
            params = { callback: params && function () callback.apply(self, arguments) };

        try {
            let xmlhttp = services.Xmlhttp();
            xmlhttp.mozBackgroundRequest = true;

            let async = params.callback || params.onload || params.onerror;
            if (async) {
                xmlhttp.onload = function handler(event) { util.trapErrors(params.onload || params.callback, params, xmlhttp, event) };
                xmlhttp.onerror = function handler(event) { util.trapErrors(params.onerror || params.callback, params, xmlhttp, event) };
            }
            if (params.mimeType)
                xmlhttp.overrideMimeType(params.mimeType);

            xmlhttp.open(params.method || "GET", url, async,
                         params.user, params.pass);

            xmlhttp.send(null);
            return xmlhttp;
        }
        catch (e) {
            return null;
        }
    },

    /**
     * The identity function.
     *
     * @param {Object} k
     * @returns {Object}
     */
    identity: function identity(k) k,

    /**
     * Returns true if *url* is in the domain *domain*.
     *
     * @param {string} url
     * @param {string} domain
     * @returns {boolean}
     */
    isDomainURL: function isDomainURL(url, domain) util.isSubdomain(util.getHost(url), domain),

    /**
     * Returns true if *host* is a subdomain of *domain*.
     *
     * @param {string} host The host to check.
     * @param {string} domain The base domain to check the host against.
     * @returns {boolean}
     */
    isSubdomain: function isSubdomain(host, domain) {
        if (host == null)
            return false;
        let idx = host.lastIndexOf(domain);
        return idx > -1 && idx + domain.length == host.length && (idx == 0 || host[idx - 1] == ".");
    },

    /**
     * Iterates over all currently open documents, including all
     * top-level window and sub-frames thereof.
     */
    iterDocuments: function iterDocuments(types) {
        types = types ? types.map(function (s) "type" + util.capitalize(s))
                      : ["typeChrome", "typeContent"];

        let windows = services.windowMediator.getXULWindowEnumerator(null);
        while (windows.hasMoreElements()) {
            let window = windows.getNext().QueryInterface(Ci.nsIXULWindow);
            for each (let type in types) {
                let docShells = window.docShell.getDocShellEnumerator(Ci.nsIDocShellTreeItem[type],
                                                                      Ci.nsIDocShell.ENUMERATE_FORWARDS);
                while (docShells.hasMoreElements())
                    let (viewer = docShells.getNext().QueryInterface(Ci.nsIDocShell).contentViewer) {
                        if (viewer)
                            yield viewer.DOMDocument;
                    }
            }
        }
    },

    /**
     * Creates a DTD fragment from the given object. Each property of
     * the object is converted to an ENTITY declaration. SGML special
     * characters other than ' and % are left intact.
     *
     * @param {object} obj The object to convert.
     * @returns {string} The DTD fragment containing entity declaration
     *      for *obj*.
     */
    makeDTD: let (map = { "'": "&apos;", '"': "&quot;", "%": "&#x25;", "&": "&amp;", "<": "&lt;", ">": "&gt;" })
        function makeDTD(obj) iter(obj)
          .map(function ([k, v]) ["<!ENTITY ", k, " '", String.replace(v == null ? "null" : typeof v == "xml" ? v.toXMLString() : v,
                                                                       typeof v == "xml" ? /['%]/g : /['"%&<>]/g,
                                                                       function (m) map[m]),
                                  "'>"].join(""))
          .join("\n"),

    /**
     * Converts a URI string into a URI object.
     *
     * @param {string} uri
     * @returns {nsIURI}
     */
    newURI: function newURI(uri, charset, base) {
        let res = this.withProperErrors("newURI", services.io, uri, charset, base);
        res instanceof Ci.nsIURL;
        return res;
    },

    /**
     * Removes leading garbage prepended to URIs by the subscript
     * loader.
     */
    fixURI: function fixURI(url) String.replace(url, /.* -> /, ""),

    /**
     * Pretty print a JavaScript object. Use HTML markup to color certain items
     * if *color* is true.
     *
     * @param {Object} object The object to pretty print.
     * @returns {string}
     */
    objectToString: function objectToString(object) {
        // Use E4X literals so html is automatically quoted
        // only when it's asked for. No one wants to see &lt;
        // on their console or :map :foo in their buffer
        // when they expect :map <C-f> :foo.
        XML.prettyPrinting = false;
        XML.ignoreWhitespace = false;

        if (object == null)
            return object + "\n";

        if (!isObject(object))
            return String(object);

        if (object instanceof Ci.nsIDOMElement || object instanceof DOM) {
            let elem = object;
            if (elem.nodeType == elem.TEXT_NODE)
                return elem.data;

            return DOM(elem).repr();
        }

        try { // for window.JSON
            var obj = String(object);
        }
        catch (e) {
            obj = Object.prototype.toString.call(obj);
        }
        obj = util.clip(obj, 150).replace(/\n/g, "^J");
        let lines = [obj + "::"];

        let keys = [];

        // window.content often does not want to be queried with "var i in object"
        try {
            let hasValue = !("__iterator__" in object || isinstance(object, ["Generator", "Iterator"]));

            for (let i in object) {
                let value = <![CDATA[<no value>]]>;
                try {
                    value = object[i];
                }
                catch (e) {}
                if (!hasValue) {
                    if (isArray(i) && i.length == 2)
                        [i, value] = i;
                    else {
                        var noVal = true;
                        value = i;
                    }
                }

                let key = i;
                if (!isNaN(i))
                    i = parseInt(i);
                else if (/^[A-Z_]+$/.test(i))
                    i = "";
                keys.push([i, noVal ? value : key + ": " + value]);
            }
        }
        catch (e) {
            util.reportError(e);
        }

        function compare(a, b) {
            if (!isNaN(a[0]) && !isNaN(b[0]))
                return a[0] - b[0];
            return String.localeCompare(a[0], b[0]);
        }
        return lines.concat(keys.sort(compare).map(function (f) f[1])).join("\n");
    },

    prettifyJSON: function prettifyJSON(data, indent) {
        const INDENT = indent || "    ";

        function rec(data, level) {
            let prefix = level + INDENT;

            if (data === undefined)
                data = null;

            if (~["boolean", "number"].indexOf(typeof data) || data === null)
                res.push(String(data));
            else if (isString(data))
                res.push(data.quote());
            else if (isArray(data)) {
                if (data.length == 0)
                    res.push("[]");
                else {
                    res.push("[\n")
                    for (let [i, val] in Iterator(data)) {
                        if (i)
                            res.push(",\n");
                        res.push(prefix)
                        rec(val, prefix);
                    }
                    res.push("\n", level, "]");
                }
            }
            else if (isObject(data)) {
                res.push("{\n")

                let i = 0;
                for (let [key, val] in Iterator(data)) {
                    if (i++)
                        res.push(",\n");
                    res.push(prefix, String.quote(key), ": ")
                    rec(val, prefix);
                }
                if (i > 0)
                    res.push("\n", level, "}")
                else
                    res[res.length - 1] = "{}";
            }
            else
                throw Error("Invalid JSON object");
        }

        let res = [];
        rec(data, "");
        return res.join("");
    },

    /**
     * A generator that returns the values between *start* and *end*, in *step*
     * increments.
     *
     * @param {number} start The interval's start value.
     * @param {number} end The interval's end value.
     * @param {boolean} step The value to step the range by. May be
     *     negative. @default 1
     * @returns {Iterator(Object)}
     */
    range: function range(start, end, step) {
        if (!step)
            step = 1;
        if (step > 0) {
            for (; start < end; start += step)
                yield start;
        }
        else {
            while (start > end)
                yield start += step;
        }
    },

    /**
     * Creates a new RegExp object based on the value of expr stripped
     * of all white space and interpolated with the values from tokens.
     * If tokens, any string in the form of <key> in expr is replaced
     * with the value of the property, 'key', from tokens, if that
     * property exists. If the property value is itself a RegExp, its
     * source is substituted rather than its string value.
     *
     * Additionally, expr is stripped of all JavaScript comments.
     *
     * This is similar to Perl's extended regular expression format.
     *
     * @param {string|XML} expr The expression to compile into a RegExp.
     * @param {string} flags Flags to apply to the new RegExp.
     * @param {object} tokens The tokens to substitute. @optional
     * @returns {RegExp} A custom regexp object.
     */
    regexp: update(function (expr, flags, tokens) {
        flags = flags || [k for ([k, v] in Iterator({ g: "global", i: "ignorecase", m: "multiline", y: "sticky" }))
                          if (expr[v])].join("");

        if (isinstance(expr, ["RegExp"]))
            expr = expr.source;

        expr = String.replace(expr, /\\(.)/, function (m, m1) {
            if (m1 === "c")
                flags = flags.replace(/i/g, "") + "i";
            else if (m === "C")
                flags = flags.replace(/i/g, "");
            else
                return m;
            return "";
        });

        // Replace replacement <tokens>.
        if (tokens)
            expr = String.replace(expr, /(\(?P)?<(\w+)>/g, function (m, n1, n2) !n1 && Set.has(tokens, n2) ? tokens[n2].scriptifySource || tokens[n2].source || tokens[n2] : m);

        // Strip comments and white space.
        if (/x/.test(flags))
            expr = String.replace(expr, /(\\.)|\/\/[^\n]*|\/\*[^]*?\*\/|\s+/gm, function (m, m1) m1 || "");

        // Replace (?P<named> parameters)
        if (/\(\?P</.test(expr)) {
            var source = expr;
            let groups = ["wholeMatch"];
            expr = expr.replace(/((?:[^[(\\]|\\.|\[(?:[^\]]|\\.)*\])*)\((?:\?P<([^>]+)>|(\?))?/gy,
                function (m0, m1, m2, m3) {
                    if (!m3)
                        groups.push(m2 || "-group-" + groups.length);
                    return m1 + "(" + (m3 || "");
                });
            var struct = Struct.apply(null, groups);
        }

        let res = update(RegExp(expr, flags.replace("x", "")), {
            closure: Class.Property(Object.getOwnPropertyDescriptor(Class.prototype, "closure")),
            scriptifyPropertyNames: ["exec", "match", "test", "toSource", "toString", "global", "ignoreCase", "lastIndex", "multiLine", "source", "sticky"],
            iterate: function (str, idx) util.regexp.iterate(this, str, idx)
        });

        // Return a struct with properties for named parameters if we
        // have them.
        if (struct)
            update(res, {
                exec: function exec() let (match = exec.superapply(this, arguments)) match && struct.fromArray(match),
                scriptifySource: source, struct: struct
            });
        return res;
    }, {
        /**
         * Escapes Regular Expression special characters in *str*.
         *
         * @param {string} str
         * @returns {string}
         */
        escape: function regexp_escape(str) str.replace(/([\\{}()[\]^$.?*+|])/g, "\\$1"),

        /**
         * Given a RegExp, returns its source in the form showable to the user.
         *
         * @param {RegExp} re The regexp showable source of which is to be returned.
         * @returns {string}
         */
        getSource: function regexp_getSource(re) re.source.replace(/\\(.)/g, function (m0, m1) m1 === "/" ? "/" : m0),

        /**
         * Iterates over all matches of the given regexp in the given
         * string.
         *
         * @param {RegExp} regexp The regular expression to execute.
         * @param {string} string The string to search.
         * @param {number} lastIndex The index at which to begin searching. @optional
         */
        iterate: function iterate(regexp, string, lastIndex) iter(function () {
            regexp.lastIndex = lastIndex = lastIndex || 0;
            let match;
            while (match = regexp.exec(string)) {
                lastIndex = regexp.lastIndex;
                yield match;
                regexp.lastIndex = lastIndex;
                if (match[0].length == 0 || !regexp.global)
                    break;
            }
        }())
    }),

    /**
     * Flushes the startup or jar cache.
     */
    flushCache: function flushCache(file) {
        if (file)
            services.observer.notifyObservers(file, "flush-cache-entry", "");
        else
            services.observer.notifyObservers(null, "startupcache-invalidate", "");
    },

    /**
     * Reloads add-on in entirety by disabling the add-on and
     * re-enabling it.
     */
    rehash: function (addon) {
        this.timeout(function () {
            this.flushCache();
            addon = addon || config.addon;
            addon.userDisabled = true;
            addon.userDisabled = false;
        });
    },

    errorCount: 0,
    errors: Class.Memoize(function () []),
    maxErrors: 15,
    /**
     * Reports an error to the Error Console and the standard output,
     * along with a stack trace and other relevant information. The
     * error is appended to {@see #errors}.
     */
    reportError: update(function reportError(error) {
        if (error.noTrace)
            return;

        if (isString(error))
            error = Error(error);

        Cu.reportError(error);
        try {
            services.console.logStringMessage(error.stack || Error().stack);
        }
        catch (e) {}

        try {
            this.errorCount++;

            let obj = update({}, error, {
                toString: function () String(error),
                stack: <>{util.stackLines(String(error.stack || Error().stack)).join("\n").replace(/^/mg, "\t")}</>
            });

            this.errors.push([new Date, obj + "\n" + obj.stack]);
            this.errors = this.errors.slice(-this.maxErrors);
            this.errors.toString = function () [k + "\n" + v for ([k, v] in array.iterValues(this))].join("\n\n");

            this.dump(String(error));
            this.dump(obj);
            this.dump("");
        }
        catch (e) {
            try {
                this.dump(String(error));
                this.dump(util.stackLines(error.stack).join("\n"));
            }
            catch (e) {
                reportError.dump(String(error) + " -> " + e + "\n" + error.stack);
            }
        }

        // ctypes.open("libc.so.6").declare("kill", ctypes.default_abi, ctypes.void_t, ctypes.int, ctypes.int)(
        //     ctypes.open("libc.so.6").declare("getpid", ctypes.default_abi, ctypes.int)(), 2)
    }, { dump: dump }),

    /**
     * Given a domain, returns an array of all non-toplevel subdomains
     * of that domain.
     *
     * @param {string} host The host for which to find subdomains.
     * @returns {[string]}
     */
    subdomains: function subdomains(host) {
        if (/(^|\.)\d+$|:.*:/.test(host))
            // IP address or similar
            return [host];

        let base = host.replace(/.*\.(.+?\..+?)$/, "$1");
        try {
            base = services.tld.getBaseDomainFromHost(host);
        }
        catch (e) {}

        let ary = host.split(".");
        ary = [ary.slice(i).join(".") for (i in util.range(ary.length, 0, -1))];
        return ary.filter(function (h) h.length >= base.length);
    },

    /**
     * Escapes a string against shell meta-characters and argument
     * separators.
     */
    shellEscape: function shellEscape(str) '"' + String.replace(str, /[\\"$]/g, "\\$&") + '"',

    /**
     * Behaves like String.split, except that when *limit* is reached,
     * the trailing element contains the entire trailing portion of the
     * string.
     *
     *     util.split("a, b, c, d, e", /, /, 3) -> ["a", "b", "c, d, e"]
     *
     * @param {string} str The string to split.
     * @param {RegExp|string} re The regular expression on which to split the string.
     * @param {number} limit The maximum number of elements to return.
     * @returns {[string]}
     */
    split: function (str, re, limit) {
        re.lastIndex = 0;
        if (!re.global)
            re = RegExp(re.source || re, "g");
        let match, start = 0, res = [];
        while (--limit && (match = re.exec(str)) && match[0].length) {
            res.push(str.substring(start, match.index));
            start = match.index + match[0].length;
        }
        res.push(str.substring(start));
        return res;
    },

    /**
     * Wraps a callback function such that its errors are not lost. This
     * is useful for DOM event listeners, which ordinarily eat errors.
     * The passed function has the property *wrapper* set to the new
     * wrapper function, while the wrapper has the property *wrapped*
     * set to the original callback.
     *
     * @param {function} callback The callback to wrap.
     * @returns {function}
     */
    wrapCallback: wrapCallback,

    /**
     * Returns the top-level chrome window for the given window.
     *
     * @param {Window} win The child window.
     * @returns {Window} The top-level parent window.
     */
    topWindow: function topWindow(win)
            win.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIWebNavigation)
               .QueryInterface(Ci.nsIDocShellTreeItem).rootTreeItem
               .QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindow),

    /**
     * Traps errors in the called function, possibly reporting them.
     *
     * @param {function} func The function to call
     * @param {object} self The 'this' object for the function.
     */
    trapErrors: function trapErrors(func, self) {
        try {
            if (!callable(func))
                func = self[func];
            return func.apply(self || this, Array.slice(arguments, 2));
        }
        catch (e) {
            util.reportError(e);
            return undefined;
        }
    },

    /**
     * Returns the file path of a given *url*, for debugging purposes.
     * If *url* points to a file (even if indirectly), the native
     * filesystem path is returned. Otherwise, the URL itself is
     * returned.
     *
     * @param {string} url The URL to mangle.
     * @returns {string} The path to the file.
     */
    urlPath: function urlPath(url) {
        try {
            return util.getFile(url).path;
        }
        catch (e) {
            return url;
        }
    },

    /**
     * Wraps native exceptions thrown by the called function so that a
     * proper stack trace may be retrieved from them.
     *
     * @param {function|string} meth The method to call.
     * @param {object} self The 'this' object of the method.
     * @param ... Arguments to pass to *meth*.
     */
    withProperErrors: function withProperErrors(meth, self) {
        try {
            return (callable(meth) ? meth : self[meth]).apply(self, Array.slice(arguments, withProperErrors.length));
        }
        catch (e) {
            throw e.stack ? e : Error(e);
        }
    },

    xmlToDom: function () DOM.fromXML.apply(DOM, arguments)
});

var template = Singleton("template", {
    add: function add(a, b) a + b,
    join: function join(c) function (a, b) a + c + b,

    map: function map(iter, func, sep, interruptable) {
        XML.ignoreWhitespace = false; XML.prettyPrinting = false;

        if (iter.length) // FIXME: Kludge?
            iter = array.iterValues(iter);

        let res = <></>;
        let n = 0;
        for each (let i in Iterator(iter)) {
            let val = func(i, n);
            if (val == undefined)
                continue;
            if (n++ && sep)
                res += sep;
            if (interruptable && n % interruptable == 0)
                util.threadYield(true, true);
            res += val;
        }
        return res;
    }
});

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
