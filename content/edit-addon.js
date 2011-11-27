// Copyright (c) 2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE file included with this file.
/* use strict */

Components.utils.import("resource://scriptify/bootstrap.jsm");

require("base", this);
let { Addon } = require("addon");
let { dialogs } = require("config");
let { Dialog } = require("dialog");
let { DOM } = require("dom");
let { File } = require("io");
let { _ } = require("messages");
let { services } = require("services");
let { util } = require("util");

function $(sel, context) DOM(sel, context || document);

var dialog = Dialog(window, {
    init: function init(metadata, manifest, root, install) {
        if (metadata instanceof Addon)
            var { manifest, metadata, addon, root } = metadata;

        if (addon)
            document.title = _("edit.title.edit");

        this.install = install != null ? install : !!addon;
        this.addon = addon;
        this.root = root;
        this.metadata = metadata || {};
        this.manifest = manifest || {};
        this.manifest.scripts = this.manifest.scripts || [];

        this.rename = {};
        this.remove = {};
    },

    onload: function onload(event) {
        if (this.addon)
            this.field("id").attr("readonly", true);

        [this.scripts] = this.field("scripts");
        dialog.updateValues(true);
        dialog.updateButtons();
    },

    validators: {
        id: Addon.idTest,
        name: util.identity,
        version: util.identity,
        homepageURL: function (str) !str || util.newURI(str)
    },

    commands: {
        add: function add(event) {
            let { manifest, metadata } = dialogs.createModal(window, {
                target: this.root
            });

            if (manifest) {
                let idx = this.manifest.scripts.length;

                this.manifest.scripts = this.manifest.scripts.concat(manifest.scripts);
                manifest.scripts = this.manifest.scripts;
                this.updateValues(false, { manifest: manifest, metadata: metadata });
                this.editScript(idx);
            }
        },
        edit: function edit(event) {
            this.editScript(this.scripts.selectedItem);
        },
        moveUp: function moveUp(event) {
            this.moveSelected(-1);
        },
        moveDown: function moveDown(event) {
            this.moveSelected(+1);
        },
        remove: function remove(event) {
            let { children, selectedIndex: idx, selectedItem: item } = this.scripts;

            Set.add(this.remove, item.value);
            DOM(item).remove();
            this.scripts.selectedItem = idx ? children[idx - 1] : children[idx];
            this.updateButtons();
        }
    },

    moveSelected: function moveSelected(offset) {
        let { children, selectedIndex: idx, selectedItem: item } = this.scripts;

        this.scripts.insertBefore(item, children[idx + offset + (offset > 0)]);
        this.scripts.selectedItem = item;
        this.updateButtons();
    },

    editScript: function editScript(item) {
        if (!(item instanceof Element))
            item = this.scripts.getElementsByAttribute("value", item)[0];

        let script = this.manifest.scripts[item.value];
        dialogs.editScript(window, script, this.root);

        item.label = script.name || item.label;

        update(this.rename, script.renamed);
        update(this.move, Set(script.removed));
        delete script.renamed;
        delete script.removed;
    },

    oncancel: function oncancel() {
        util.flushCache(this.root);
        if (this.install && this.addon == null)
            this.root.remove(true);
    },

    fields: {
        list:   ["developers", "contributors"],
        string: ["creator", "description", "homepageURL", "id", "name", "version"]
    },

    onaccept: function onaccept() {
        let scripts = [];
        for (let [, { label, value }] in iter(this.scripts.children))
            scripts.push(this.manifest.scripts[value])

        this.manifest.scripts = scripts;

        for each (let key in this.fields.string)
            this.metadata[key] = this.field(key).val().trim();

        for each (let key in this.fields.list)
            this.metadata[key] = this.field(key).val().trim().split(/\s*\n\s*/)
                                     .filter(util.identity);

        Addon(this.addon || this.root, { metadata: this.metadata, manifest: this.manifest })
            .restage(this.addon != null || this.install);

        util.flushCache(this.root);
        if (this.addon == null && !this.install)
            this.root.remove(true);
    },

    scriptName: function scriptName(script) script.name
                                         || script.paths && script.paths[0]
                                         || _("addon.untitled"),

    updateValues: function updateValues(force, obj) {
        let { metadata, manifest } = obj || this;

        for each (let key in this.fields.string)
            this.field(key).val(function (elem) !force && elem.value || metadata[key]);

        for each (let key in this.fields.list)
            this.field(key).val(function (elem) !force && elem.value || (metadata[key] || []).join("\n"));

        for (let [i, script] in Iterator(manifest.scripts))
            if (i >= this.scripts.children.length)
                this.scripts.appendItem(this.scriptName(script), i);

        if (!this.scripts.selectedItem)
            this.scripts.selectedIndex = 0;
    },

    updateButtons: util.wrapCallback(function () {
        let keys = {
            selected: this.scripts.selectedItem
        };

        $("[enabled-when]").attr("disabled", function () !this.attr("enabled-when").split(/\s+/)
                                                              .every(function (key) keys[key]));
    })
});

// vim:se sts=4 sw=4 et ft=javascript:
