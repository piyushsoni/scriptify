"use strict";

const SOURCE = "file:///home/kris/foobaz.user.js";
const ZIP    = "~/foobaz.zip";

Components.utils.import("resource://scriptify/bootstrap.jsm");

require("base", this);
var { XUL, DOM } = require("dom");
var { dialogs } = require("config");
let { Dialog } = require("dialog");
var { _ } = require("messages");
var { Munger } = require("munger");
var { File } = require("io");
var { services } = require("services");
var { util } = require("util");

this.lazyRequire("io", ["io"]);

function $(sel, context) DOM(sel, context || document);

let dialog = Dialog(window, {
    init: function init(params) {
        this.params = params || {};
        this.source = this.params.source;
        this.target = this.params.target;
    },

    onload: function onload() {
        if (this.source)
            this.munge(this.source);

        function dragenter({ dataTransfer }) {
            return dialog.pane == "selector" && !dataTransfer.types.contains("text/x-moz-url");
        }

        $(":root").listen({
            dragenter: dragenter,
            dragover: dragenter,
            drop: function ({ dataTransfer }) {
                let files = iter(util.range(0, dataTransfer.mozItemCount))
                                .map(function (i) util.newURI(dataTransfer.mozGetDataAt("text/x-moz-url", i)
                                                                          .replace(/\n[^]*/, "")))
                                .toArray();

                dialog.timeout(bind("munge", dialog, files));
                return false;
            }
        });
    },

    validators: {
        file: function (val) val ? dialog.parseFile(val) : !this.params.valueRequired
    },

    parseFile: function parseFile(val) {
        try {
            let file = File(val);
            if (file.exists() && !file.isDirectory())
                return file;
        }
        catch (e) {
            let uri = util.newURI(val);
            if (!(uri instanceof Ci.nsIFileURL) || uri.file.exists())
                return uri;
        }
        return null;
    },

    onunload: function onunload() {
        if (this.munger && !this.munger.complete)
            this.munger.cancel();
    },

    onaccept: function onaccept() {
        if (this.pane == "selector")
            this.munge(this.parseFile(this.field("file").val()));
        else if (this.pane == "errors")
            this.finish();
        return false;
    },

    oncancel: function oncancel() {
        if (this.params.target && !this.target)
            this.params.target.remove(true);
        this.params.target = null;
        this.params.manifest = null;
        this.params.metadata = null;
    },

    browse: util.wrapCallback(function browse() {
        let picker = services.FilePicker(window, _("create.browse.title"),
                                         services.FilePicker.modeOpenMultiple);

        picker.appendFilter(_("browse.filter.js"), "*.js");
        picker.appendFilters(services.FilePicker.filterAll
                           | services.FilePicker.filterAllowURLs);

        if (picker.show() == services.FilePicker.returnOK)
            this.munge(iter(picker.files).toArray());
    }),

    munge: function munge(url) {
        if (url == null)
            url = [];

        this.pane = "progress";
        if (!this.target)
            this.params.target = io.createTempFile("munged.xpi");

        this.munger = Munger(this.target || this.params.target, url, this, true);
    },

    finish: function finish() {
        let script = {};
        for each (let key in ["name", "charset", "run-at-startup", "run-when",
                              "include", "exclude", "paths"])
            script[key] = this.munger.metadata[key];

        this.params.manifest = { scripts: [script] };
        this.params.metadata = this.munger.metadata;

        this.timeout(function () {
            if (!this.target) {
                if (!script.paths.length)
                    this.params.manifest.scripts.length = 0;

                dialogs.edit(window, this.munger.metadata, this.params.manifest, this.params.target, true);
            }
            window.close();
        }, this.target ? 500 : 250);
    },

    showErrors: function showErrors(errors) {
        $("#errors").val(errors.map(function ([path, error]) (path ? path + ": " : "") + error)
                               .join("\n"));

        this.pane = "errors";
    },

    urls: [],

    get pane() $("#deck")[0].selectedPanel.id.substr(5),
    set pane(val) {
        let pane = $("#pane-" + val).attr("selected", true);
        $(":root")[0].buttons = pane.attr('buttons');
        $("#deck")[0].selectedPanel.removeAttribute("selected");
        $("#deck")[0].selectedPanel = pane[0];
        window.sizeToContent();
    },

    get status() $("#status").val(),
    set status(val) { $("#status").val(val) },

    get progress() parseInt($("#progress").val()),
    set progress(val) {
        $("#progress").attr({
            mode: val >= 0 ? "determined" : "undetermined",
            value: val
        });
    },

    onTransferStarted: function onTransferStarted(munger, url) {
        this.urls.push(url);
        this.status = _("transfer.downloading", this.urls[0]);
    },

    onTransferComplete: function onTransferComplete(munger, url) {
        this.urls.splice(this.urls.indexOf(url));
        this.status = _("transfer." + (this.urls.length ? "downloading" : "complete"),
                        this.urls[0]);
    },

    onComplete: function onComplete(munger) {
        this.progress = 100;
        this.status = _("transfer.complete");

        if (!munger.errors.length)
            this.finish();
        else
            this.showErrors(munger.errors);
    }
});
