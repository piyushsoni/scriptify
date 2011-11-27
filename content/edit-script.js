// Copyright (c) 2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE file included with this file.
/* use strict */

Components.utils.import("resource://scriptify/bootstrap.jsm");

require("base", this);
let { Stager } = require("addon");
let { dialogs } = require("config");
let { Dialog } = require("dialog");
let { DOM } = require("dom");
let { File, io } = require("io");
let { _ } = require("messages");
let { Munger } = require("munger");
let { services } = require("services");
let { util } = require("util");

function $(sel, context) DOM(sel, context || document);

var dialog = Dialog(window, {
    init: function init(metadata, root) {
        this.root = root;
        this.metadata = metadata || {};
        this.metadata.removed = [];
        this.metadata.renamed = {};
    },

    validators: {
        name: util.identity,
        charset: function (name) !name || let ({ charset } = services)
                    charset.getCharsetTitle(charset.getCharsetAlias(name)),
        include: function (str) str && Munger.validateMatcher(str),
        exclude: Munger.validateMatcher
    },

    commands: {
        add: function add(event) {
            let { manifest } = dialogs.createModal(window, {
                target: this.root,
                valueRequired: true
            });

            if (manifest) {
                let script = manifest.scripts[0];
                this.updateValues(script);

                let extant = Set(iter(this.files.children).map(function ([i, { label }]) label));
                let n = 0;
                for each (let file in script.paths)
                    if (!Set.has(extant, file))
                        this.files.insertItemAt(n++, file, file);
            }
        },
        edit: function edit(event) {
            let path = this.files.selectedItem.value;
            io.edit(this.root.child(path));
        },
        moveUp: function moveUp(event) {
            this.moveSelected(-1);
        },
        moveDown: function moveDown(event) {
            this.moveSelected(+1);
        },
        remove: function remove(event) {
            let { children, selectedIndex: idx, selectedItem: item } = this.files;

            this.metadata.removed.push(item.value);
            DOM(item).remove();
            this.files.selectedItem = idx ? children[idx - 1] : children[idx];
            this.updateButtons();
        },
        rename: function rename(event) {
            let { selectedItem: item } = this.files;

            let val = dialogs.prompt(window, {
                title:  _("script.rename.title"),
                prompt: _("script.rename.prompt"),
                value: item.label
            });
            if (val != null)
                item.label = val;
        }
    },

    moveSelected: function moveSelected(offset) {
        let { children, selectedIndex: idx, selectedItem: item } = this.files;

        this.files.insertBefore(item, children[idx + offset + (offset > 0)]);
        this.files.selectedItem = item;
        this.updateButtons();
    },

    onload: function onload(event) {
        [this.files] = this.field("files");
        dialog.updateValues(this.metadata, true);
        this.updateButtons();
    },

    fields: {
        boolean: ["run-at-startup"],
        list:    ["include", "exclude"],
        string:  ["name", "charset", "run-when"]
    },

    onaccept: function onaccept() {
        for each (let key in this.fields.string)
            this.metadata[key] = this.field(key).val().trim();

        for each (let key in this.fields.boolean)
            this.metadata[key] = this.field(key).attr("checked");

        for each (let key in this.fields.list)
            this.metadata[key] = this.field(key).val().trim().split(/\s*\n\s*/)
                                     .filter(util.identity);

        this.metadata.paths = [];
        for (let [, { label, value }] in iter(this.files.children)) {
            this.metadata.paths.push(label);
            if (label != value)
                this.metadata.renamed[value] = label;
        }
    },

    updateValues: function updateValues(metadata, force) {
        if (!metadata.name && metadata.paths)
            metadata.name = metadata.paths[0];

        for each (let key in this.fields.string)
            this.field(key).val(function (elem) !force && !elem.itemCount && elem.value
                                             || metadata[key] || elem.value);

        if (force)
            for each (let key in this.fields.boolean)
                this.field(key).attr("checked", metadata[key]);

        for each (let key in this.fields.list)
            if (key in metadata)
                this.field(key).val(function (elem) !force && elem.value || metadata[key].join("\n"));

        if (force)
            for each (let file in metadata.paths || [])
                this.files.appendItem(file, file);

        if (!this.files.selectedItem)
            this.files.selectedIndex = 0;
    },

    updateButtons: util.wrapCallback(function () {
        let keys = {
            unpacked: this.root && this.root.isDirectory(),
            selected: this.files.selectedItem
        };

        $("[enabled-when]").attr("disabled", function () !this.attr("enabled-when").split(/\s+/)
                                                              .every(function (key) keys[key]));

        let idx = this.files.selectedIndex;
        this.button("move-up").attr("disabled", !(idx > 0));
        this.button("move-down").attr("disabled", !(~idx && idx < this.files.itemCount - 1));
    })
});
