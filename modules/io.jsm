// Copyright (c) 2006-2008 by Martin Stubenschrott <stubenschrott@vimperator.org>
// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2011 by Kris Maglione <maglione.k@gmail.com>
// Some code based on Venkman
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

var EXPORTED_SYMBOLS = ["File", "io"];

var { services } = require("services");
var { util } = require("util");

lazyRequire("config", ["config"]);
lazyRequire("messages", ["_"]);

/**
 * @class File A class to wrap nsIFile objects and simplify operations
 * thereon.
 *
 * @param {nsIFile|string} path Expanded according to {@link IO#expandPath}
 * @param {boolean} checkPWD Whether to allow expansion relative to the
 *          current directory. @default true
 * @param {string} charset The charset of the file. @default File.defaultEncoding
 */
this.File = Class("File", {
    init: function init(path, checkPWD, charset) {
        let file = services.File();

        if (charset)
            this.charset = charset;

        if (path instanceof Ci.nsIFileURL)
            path = path.file;

        if (path instanceof Ci.nsIFile)
            file = path.clone();
        else if (/file:\/\//.test(path))
            file = services["file:"].getFileFromURLSpec(path);
        else {
            try {
                let expandedPath = File.expandPath(path);

                if (!File.isAbsolutePath(expandedPath) && !(checkPWD instanceof Ci.nsIFile))
                    checkPWD = File(services.directory.get("CurWorkD", Ci.nsIFile));

                if (!File.isAbsolutePath(expandedPath))
                    file = checkPWD.child(expandedPath);
                else
                    file.initWithPath(expandedPath);
            }
            catch (e) {
                util.reportError(e);
                return File.DoesNotExist(path, e);
            }
        }
        let self = XPCNativeWrapper(file.QueryInterface(Ci.nsILocalFile));
        self.__proto__ = this;
        return self;
    },

    charset: Class.Memoize(function () File.defaultEncoding),

    /**
     * @property {nsIFileURL} Returns the nsIFileURL object for this file.
     */
    get URI() services.io.newFileURI(this).QueryInterface(Ci.nsIFileURL).QueryInterface(Ci.nsIURL),

    /**
     * Iterates over the objects in this directory.
     */
    iterDirectory: function iterDirectory() {
        if (!this.exists())
            throw Error(_("io.noSuchFile"));
        if (!this.isDirectory())
            throw Error(_("io.eNotDir"));
        for (let file in iter(this.directoryEntries))
            yield File(file);
    },

    /**
     * Returns a new file for the given child of this directory entry.
     */
    child: function child(name) {
        let f = this.constructor(this);
        for each (let elem in name.split(File.pathSplit))
            f.append(elem);
        return f;
    },

    /**
     * Returns an iterator for all lines in a file.
     */
    get lines() File.readLines(services.FileInStream(this, -1, 0, 0),
                               this.charset),

    /**
     * Reads this file's entire contents in "text" mode and returns the
     * content as a string.
     *
     * @param {string} encoding The encoding from which to decode the file.
     *          @default #charset
     * @returns {string}
     */
    read: function read(encoding) {
        let ifstream = services.FileInStream(this, -1, 0, 0);

        return File.readStream(ifstream, encoding || this.charset);
    },

    /**
     * Returns the list of files in this directory.
     *
     * @param {boolean} sort Whether to sort the returned directory
     *     entries.
     * @returns {[nsIFile]}
     */
    readDirectory: function readDirectory(sort) {
        if (!this.isDirectory())
            throw Error(_("io.eNotDir"));

        let array = [e for (e in this.iterDirectory())];
        if (sort)
            array.sort(function (a, b) b.isDirectory() - a.isDirectory() || String.localeCompare(a.path, b.path));
        return array;
    },

    /**
     * Returns a new nsIFileURL object for this file.
     *
     * @returns {nsIFileURL}
     */
    toURI: function toURI() services.io.newFileURI(this),

    /**
     * Writes the string *buf* to this file.
     *
     * @param {string} buf The file content.
     * @param {string|number} mode The file access mode, a bitwise OR of
     *     the following flags:
     *       {@link #MODE_RDONLY}:   0x01
     *       {@link #MODE_WRONLY}:   0x02
     *       {@link #MODE_RDWR}:     0x04
     *       {@link #MODE_CREATE}:   0x08
     *       {@link #MODE_APPEND}:   0x10
     *       {@link #MODE_TRUNCATE}: 0x20
     *       {@link #MODE_SYNC}:     0x40
     *     Alternatively, the following abbreviations may be used:
     *       ">"  is equivalent to {@link #MODE_WRONLY} | {@link #MODE_CREATE} | {@link #MODE_TRUNCATE}
     *       ">>" is equivalent to {@link #MODE_WRONLY} | {@link #MODE_CREATE} | {@link #MODE_APPEND}
     * @default ">"
     * @param {number} perms The file mode bits of the created file. This
     *     is only used when creating a new file and does not change
     *     permissions if the file exists.
     * @default 0644
     * @param {string} encoding The encoding to used to write the file.
     * @default #charset
     */
    write: function write(buf, mode, perms, encoding) {
        function getStream(defaultChar) {
            return services.ConvOutStream(ofstream, encoding, 0, defaultChar);
        }
        if (buf instanceof File)
            buf = buf.read();

        if (!encoding)
            encoding = this.charset;

        if (mode == ">>")
            mode = File.MODE_WRONLY | File.MODE_CREATE | File.MODE_APPEND;
        else if (!mode || mode == ">")
            mode = File.MODE_WRONLY | File.MODE_CREATE | File.MODE_TRUNCATE;

        if (!perms)
            perms = octal(644);
        if (!this.exists()) // OCREAT won't create the directory
            this.create(this.NORMAL_FILE_TYPE, perms);

        let ofstream = services.FileOutStream(this, mode, perms, 0);
        try {
            var ocstream = getStream(0);
            ocstream.writeString(buf);
        }
        catch (e if e.result == Cr.NS_ERROR_LOSS_OF_SIGNIFICANT_DATA) {
            ocstream.close();
            ocstream = getStream("?".charCodeAt(0));
            ocstream.writeString(buf);
            return false;
        }
        finally {
            try {
                ocstream.close();
            }
            catch (e) {}
            ofstream.close();
        }
        return true;
    }
}, {
    /**
     * @property {number} Open for reading only.
     * @final
     */
    MODE_RDONLY: 0x01,

    /**
     * @property {number} Open for writing only.
     * @final
     */
    MODE_WRONLY: 0x02,

    /**
     * @property {number} Open for reading and writing.
     * @final
     */
    MODE_RDWR: 0x04,

    /**
     * @property {number} If the file does not exist, the file is created.
     *     If the file exists, this flag has no effect.
     * @final
     */
    MODE_CREATE: 0x08,

    /**
     * @property {number} The file pointer is set to the end of the file
     *     prior to each write.
     * @final
     */
    MODE_APPEND: 0x10,

    /**
     * @property {number} If the file exists, its length is truncated to 0.
     * @final
     */
    MODE_TRUNCATE: 0x20,

    /**
     * @property {number} If set, each write will wait for both the file
     *     data and file status to be physically updated.
     * @final
     */
    MODE_SYNC: 0x40,

    /**
     * @property {number} With MODE_CREATE, if the file does not exist, the
     *     file is created. If the file already exists, no action and NULL
     *     is returned.
     * @final
     */
    MODE_EXCL: 0x80,

    /**
     * @property {string} The current platform's path separator.
     */
    PATH_SEP: Class.Memoize(function () {
        let f = services.directory.get("CurProcD", Ci.nsIFile);
        f.append("foo");
        return f.path.substr(f.parent.path.length, 1);
    }),

    pathSplit: Class.Memoize(function () util.regexp("(?:/|" + util.regexp.escape(this.PATH_SEP) + ")", "g")),

    DoesNotExist: function DoesNotExist(path, error) ({
        path: path,
        exists: function () false,
        __noSuchMethod__: function () { throw error || Error("Does not exist"); }
    }),

    defaultEncoding: "UTF-8",

    /**
     * Expands "~" and environment variables in *path*.
     *
     * "~" is expanded to to the value of $HOME. On Windows if this is not
     * set then the following are tried in order:
     *   $USERPROFILE
     *   ${HOMDRIVE}$HOMEPATH
     *
     * The variable notation is $VAR (terminated by a non-word character)
     * or ${VAR}. %VAR% is also supported on Windows.
     *
     * @param {string} path The unexpanded path string.
     * @param {boolean} relative Whether the path is relative or absolute.
     * @returns {string}
     */
    expandPath: function expandPath(path, relative) {
        if (!relative && RegExp("~(?:$|[/" + util.regexp.escape(File.PATH_SEP) + "])").test(path))
            path = services.directory.get("Home", Ci.nsIFile).path
                 + path.substr(1);

        return path.replace("/", File.PATH_SEP, "g");
    },

    readStream: function readStream(ifstream, encoding) {
        try {
            var icstream = services.CharsetStream(
                    ifstream, encoding || File.defaultEncoding, 4096, // buffer size
                    services.CharsetStream.DEFAULT_REPLACEMENT_CHARACTER);

            let buffer = [];
            let str = {};
            while (icstream.readString(4096, str) != 0)
                buffer.push(str.value);
            return buffer.join("");
        }
        finally {
            icstream.close();
            ifstream.close();
        }
    },

    readLines: function readLines(ifstream, encoding) {
        try {
            var icstream = services.CharsetStream(
                    ifstream, encoding || File.defaultEncoding, 4096, // buffer size
                    services.CharsetStream.DEFAULT_REPLACEMENT_CHARACTER);

            var value = {};
            while (icstream.readLine(value))
                yield value.value;
        }
        finally {
            icstream.close();
            ifstream.close();
        }
    },


    isAbsolutePath: function isAbsolutePath(path) {
        try {
            services.File().initWithPath(path);
            return true;
        }
        catch (e) {
            return false;
        }
    },

    replacePathSep: function replacePathSep(path) path.replace("/", File.PATH_SEP, "g")
});

/**
 * Provides a basic interface to common system I/O operations.
 * @instance io
 */
var io = Singleton("io", {

    /**
     * Creates a temporary file.
     *
     * @returns {File}
     */
    createTempFile: function createTempFile(name) {
        if (name instanceof Ci.nsIFile) {
            var file = name.clone();
            if (file.exists() && file.isDirectory())
                file.createUnique(Ci.nsIFile.NORMAL_FILE_TYPE, octal(777));
            else
                file.createUnique(Ci.nsIFile.DIRECTORY_TYPE, octal(666));
        }
        else {
            file = services.directory.get("TmpD", Ci.nsIFile);
            file.append(name || config.addon.name);
            file.createUnique(Ci.nsIFile.NORMAL_FILE_TYPE, octal(666));
        }

        services.externalApp.deleteTemporaryFileOnExit(file);

        return File(file);
    },

    /**
     * Determines whether the resource at the given URI exists.
     */
    uriExists: function uriExists(uri) {
        if (isString(uri))
            uri = util.newURI(util.fixURI(url));

        if (uri instanceof Ci.nsIFileURL)
            return uri.file.exists();

        if (uri instanceof Ci.nsIJARURI)
            return services.zipReader.getZip(File(uri.JARFile))
                           .hasEntry(uri.JAREntry);

        try {
            let channel = services.io.newChannelFromURI(uri);
            channel.open();
            channel.cancel(Cr.NS_BINDING_ABORTED);
            return true;
        }
        catch (e) {}
        return false;
    },


    /**
     * Determines whether the given URL string resolves to a JAR URL and
     * returns the matching nsIJARURI object if it does.
     *
     * @param {string} url The URL to check.
     * @returns {nsIJARURI|null}
     */
    isJarURL: function isJarURL(url) {
        try {
            let uri = util.newURI(util.fixURI(url));
            if (uri instanceof Ci.nsIJARURI)
                return uri;

            let channel = services.io.newChannelFromURI(uri);
            channel.cancel(Cr.NS_BINDING_ABORTED);
            if (channel instanceof Ci.nsIJARChannel)
                return channel.URI.QueryInterface(Ci.nsIJARURI);
        }
        catch (e) {}
        return null;
    },

    /**
     * Returns a list of the contents of the given JAR file which are
     * children of the given path.
     *
     * @param {nsIURI|string} file The URI of the JAR file to list.
     * @param {string} path The prefix path to search.
     */
    listJar: function listJar(file, path) {
        file = util.getFile(file);
        if (file && file.exists() && file.isFile() && file.isReadable()) {
            // let jar = services.zipReader.getZip(file); Crashes.
            let jar = services.ZipReader(file);
            try {
                let filter = RegExp("^" + util.regexp.escape(decodeURI(path))
                                    + "[^/]*/?$");

                for (let entry in iter(jar.findEntries("*")))
                    if (filter.test(entry))
                        yield entry;
            }
            finally {
                if (jar)
                    jar.close();
            }
        }
    },

    get fallbackOpener() {
        for each (let fallback in ["xdg-open", "kde-open", "kfmclient",
                                   "gvfs-open", "gnome-open", "exo-open",
                                   "open"]) {
            let file = this.pathSearch(fallback);
            if (file)
                return [file, this._browseArgs[fallback] || []];
        }
        return [];
    },

    /**
     * Browse the given directory.
     *
     * @param {File} path The path of the directory to browse.
     */
    browse: function browse(path) {
        let dir = path.isDirectory() ? path : File(path.parent);

        let manager = config.prefs.get("file-manager", "").trim();
        if (manager) {
            manager = this.parseArgs(manager);
            return io.run(manager[0], manager.slice(1).concat(dir.path));
        }

        if (!path.isDirectory())
            try { return path.reveal() } catch (e) {}

        try { return dir.launch(); } catch (e) {}

        let [file, args] = this.fallbackOpener;
        if (file)
            return this.run(file, args.concat(dir.path));

        // Give up and fall back to the helper service.
        services.externalProtocol.loadURI(dir.URI);
    },

    _browseArgs: {
        kfmclient: ["exec"]
    },

    /**
     * Edits the given file.
     *
     * @param {File} file The file to edit.
     */
    edit: function edit(file) {
        let args = [];
        let editor = config.prefs.get("editor", "").trim();
        if (editor) {
            editor = this.parseArgs(editor);
            [editor, args] = [editor[0], editor.slice(1)];
        }

        if (!editor)
            [editor, args] = this.fallbackOpener;

        if (editor)
            return io.run(editor, args.concat(file.path));

        // Give up and fall back to the helper service.
        services.externalProtocol.loadURI(path.URI);
    },

    parseArgs: function parseArgs(str) {
        str = str.trim();
        let arg, res = [];
        while (str) {
            [arg, str] = this.parseArg(str);
            res.push(arg);
        }
        return res;
    },

    parseArg: function parseArg(str) {
        let res = [], match;
        let re = /('((?:[^']+|'')*)')|([^'\s]+|')/gy;
        while (match = re.exec(str)) {
            var lastIndex = re.lastIndex;
            res.push(match[1] ? match[2].replace(/''/g, "'")
                              : match[3]);
        }

        let ws = /\s*/y;
        ws.lastIndex = lastIndex;
        ws.test(str);

        return [res.join(""), str.slice(ws.lastIndex)];
    },

    quoteArg: function quoteArg(str) /[\s']/.test(str) ? "'" + str.replace(/'/g, "''") + "'" : str,

    /**
     * Searches for the given executable file in the system executable
     * file paths as specified by the PATH environment variable.
     *
     * On Windows, if the unadorned filename cannot be found, the
     * extensions in the semicolon-separated list in the PATHSEP
     * environment variable are successively appended to the original
     * name and searched for in turn.
     *
     * @param {string} bin The name of the executable to find.
     * @returns {File|null}
     */
    pathSearch: function pathSearch(bin) {
        if (bin instanceof File || File.isAbsolutePath(bin))
            return File(bin);

        let dirs = services.environment.get("PATH").split(config.OS.isWindows ? ";" : ":");
        // Windows tries the CWD first TODO: desirable?
        if (config.OS.isWindows)
            dirs = [io.cwd].concat(dirs);

        for (let [, dir] in Iterator(dirs))
            try {
                dir = File(dir);

                let file = dir.child(bin);
                if (file.exists() && file.isFile() && file.isExecutable())
                    return file;

                // TODO: couldn't we just palm this off to the start command?
                // automatically try to add the executable path extensions on windows
                if (config.OS.isWindows) {
                    let extensions = services.environment.get("PATHEXT").split(";");
                    for (let [, extension] in Iterator(extensions)) {
                        file = dir.child(bin + extension);
                        if (file.exists())
                            return file;
                    }
                }
            }
            catch (e) {}
        return null;
    },

    /**
     * Runs an external program.
     *
     * @param {File|string} program The program to run.
     * @param {[string]} args An array of arguments to pass to *program*.
     */
    run: function run(program, args, blocking, self) {
        args = args || [];

        let file = this.pathSearch(program);

        if (!file || !file.exists()) {
            if (callable(blocking))
                util.trapErrors(blocking);
            return -1;
        }

        let process = services.Process(file);
        process.run(false, args.map(String), args.length);
        try {
            if (callable(blocking))
                var timer = services.Timer(
                    function () {
                        if (!process.isRunning) {
                            timer.cancel();
                            util.trapErrors(blocking, self, process.exitValue);
                        }
                    },
                    100, services.Timer.TYPE_REPEATING_SLACK);
            else if (blocking)
                while (process.isRunning)
                    util.threadYield(false, true);
        }
        catch (e) {
            process.kill();
            throw e;
        }

        return process.exitValue;
    },

    // TODO: when https://bugzilla.mozilla.org/show_bug.cgi?id=68702 is
    // fixed use that instead of a tmpfile
    /**
     * Runs *command* in a subshell and returns the output in a string. The
     * shell used is that specified by the 'shell' option.
     *
     * @param {string} command The command to run.
     * @param {string} input Any input to be provided to the command on stdin.
     * @param {function(object)} callback A callback to be called when
     *      the command completes. @optional
     * @returns {object|null}
     */
    system: function system(command, input, callback) {

        let { shellEscape } = util.closure;

        return this.withTempFiles(function (stdin, stdout, cmd) {
            if (input instanceof File)
                stdin = input;
            else if (input)
                stdin.write(input);

            function result(status, output) ({
                __noSuchMethod__: function (meth, args) this.output[meth].apply(this.output, args),
                valueOf: function () this.output,
                output: output.replace(/^(.*)\n$/, "$1"),
                returnValue: status,
                toString: function () this.output
            });

            function async(status) {
                let output = stdout.read();
                [stdin, stdout, cmd].forEach(function (f) f.exists() && f.remove(false));
                callback(result(status, output));
            }

            let shell = io.pathSearch(storage["options"].get("shell").value);
            let shcf = storage["options"].get("shellcmdflag").value;
            util.assert(shell, _("error.invalid", "'shell'"));

            if (isArray(command))
                command = command.map(shellEscape).join(" ");

            // TODO: implement 'shellredir'
            if (config.OS.isWindows && !/sh/.test(shell.leafName)) {
                command = "cd /D " + this.cwd.path + " && " + command + " > " + stdout.path + " 2>&1" + " < " + stdin.path;
                var res = this.run(shell, shcf.split(/\s+/).concat(command), callback ? async : true);
            }
            else {
                cmd.write("cd " + shellEscape(this.cwd.path) + "\n" +
                        ["exec", ">" + shellEscape(stdout.path), "2>&1", "<" + shellEscape(stdin.path),
                         shellEscape(shell.path), shcf, shellEscape(command)].join(" "));
                res = this.run("/bin/sh", ["-e", cmd.path], callback ? async : true);
            }

            return callback ? true : result(res, stdout.read());
        }, this, true);
    },

    /**
     * Creates a temporary file context for executing external commands.
     * *func* is called with a temp file, created with {@link #createTempFile},
     * for each explicit argument. Ensures that all files are removed when
     * *func* returns.
     *
     * @param {function} func The function to execute.
     * @param {Object} self The 'this' object used when executing func.
     * @returns {boolean} false if temp files couldn't be created,
     *     otherwise, the return value of *func*.
     */
    withTempFiles: function withTempFiles(func, self, checked) {
        let args = array(util.range(0, func.length)).map(this.closure.createTempFile).array;
        try {
            if (!args.every(util.identity))
                return false;
            var res = func.apply(self || this, args);
        }
        finally {
            if (!checked || res !== true)
                args.forEach(function (f) f.remove(false));
        }
        return res;
    }
});

// vim: set fdm=marker sw=4 ts=4 et ft=javascript:
