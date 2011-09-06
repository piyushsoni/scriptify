// Copyright (c) 2007-2011 by Doug Kearns <dougkearns@gmail.com>
// Copyright (c) 2008-2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

var EXPORTED_SYMBOLS = ["config"];

var ICON_SMALL = "resource://scriptify/icon16.png";
var HELP_URL   = "scriptify://locale/help/main.xhtml";

var { AddonManager } = module("resource://gre/modules/AddonManager.jsm");

var { Overlay, overlay } = require("overlay");
var { util } = require("util");
var { DOM, XUL } = require("dom");

lazyRequire("addon", ["Addon"]);
lazyRequire("config", ["config", "dialogs"]);
lazyRequire("dialog", ["Dialog"]);
lazyRequire("io", ["File", "io"]);
lazyRequire("messages", ["_"]);

overlay.overlayWindow(["about:addons",
                       "chrome://mozapps/content/extensions/extensions.xul"], 
    Class("AddonOverlay", Overlay, {
        before: <e4x xmlns={XUL}>
            <toolbarbutton id="header-utils-btn">
                <toolbarbutton id="scriptify-button" label="Scriptify"
                               type="menu" style="margin-right: 1ex">
                    <menupopup id="scriptify-menu">
                        <menuitem scriptify-command="update-all"
                                  label={_("addon.update-all.label")}
                                  accesskey={_("addon.update-all.accesskey")}/>
                        <menuitem scriptify-command="create"
                                  label={_("addon.create.label")}
                                  accesskey={_("addon.create.accesskey")}/>
                        <menuseparator/>
                        <menuitem scriptify-command="help"
                                  label={_("addon.help.label")}
                                  accesskey={_("addon.help.accesskey")}/>
                    </menupopup>
                </toolbarbutton>
            </toolbarbutton>
        </e4x>.elements(),

        addonButton: Class.Memoize(function () DOM.fromXML(
            <button anonid="scriptify" label={_("addon.scriptify")}
                    type="menu" xmlns={XUL}>
                <menupopup anonid="scriptify-menu">
                    <menuitem scriptify-command="edit"
                              label={_("addon.edit.label")}
                              accesskey={_("addon.edit.accesskey")}/>
                    <menuitem scriptify-command="browse"
                              label={_("addon.browse.label")}
                              accesskey={_("addon.browse.accesskey")}/>
                    <menuitem scriptify-command="export"
                              label={_("addon.export.label")}
                              accesskey={_("addon.export.accesskey")}/>
                    <menuseparator/>
                    <menuitem scriptify-command="update"
                              label={_("addon.update.label")}
                              accesskey={_("addon.update.accesskey")}
                              tooltiptext={_("addon.update.tooltip")}/>
                    <menuitem scriptify-command="refresh"
                              label={_("addon.refresh.label")}
                              accesskey={_("addon.refresh.accesskey")}
                              tooltiptext={_("addon.refresh.tooltip")}/>
                    <menuitem scriptify-command="pack"
                              label={_("addon.pack.label")}
                              accesskey={_("addon.pack.accesskey")}
                              tooltiptext={_("addon.pack.tooltip")}/>
                    <menuitem scriptify-command="unpack"
                              label={_("addon.unpack.label")}
                              accesskey={_("addon.unpack.accesskey")}
                              tooltiptext={_("addon.unpack.tooltip")}/>
                </menupopup>
            </button>, this.doc)),

        ready: function ready(window) {
            this.addonList = this.$("#addon-list")[0];

            AddonManager.addAddonListener(this);
            AddonManager.addInstallListener(this);
            this.cleanups.push(function () {
                AddonManager.removeAddonListener(this);
                AddonManager.removeInstallListener(this);
            });

            this.$("#scriptify-button").command(this.closure.onCommand);
            
            overlay.listen(window, "ViewChanged", this.closure.onViewChanged);
        },

        cleanup: function cleanup(reason) {
            cleanup.superapply(this, arguments);

            if (reason != "unload")
                for (let node in this.$("#addon-list > *")) {
                    overlay.getData(node, "scriptify-button", DOM)
                           .remove();
                    delete node[overlay.id];
                }
        },

        updateAddons: function updateAddons() {
            for (let node in this.$("#addon-list > *")) {
                let button = overlay.getData(node, "scriptify-button",
                                             bind("ScriptifyButton", this, node));

                if (button && button.length && !DOM(node).findAnon("anonid", "scriptify").length)
                    overlay.setData(node, "scriptify-button", undefined);
            }
        },

        commands: {
            create: function create() {
                dialogs.create(this.window);
            },
            browse: function browse(addon) {
                io.browse(File(addon.getResourceURI("")));
            },
            edit: function browse(addon) {
                dialogs.edit(this.window, Addon(addon));
            },
            export: function export_(addon) {
                let picker = services.FilePicker(this.window, _("export.browse.title"),
                                                 services.FilePicker.modeSave);

                picker.appendFilter(_("browse.filter.xpi"), "*.xpi");

                picker.defaultExtension = "xpi";
                picker.defaultString = addon.id.replace(/@/, "-" + addon.version + "@") + ".xpi";

                if (picker.show() == services.FilePicker.returnOK)
                    Addon(addon, { unpack: false }).restage(File(picker.file));
            },
            help: function help() {
                Dialog.getUtilityOverlay(this.window)
                      .openUILinkIn(HELP_URL, "tabshifted")
            },
            refresh: function refresh(addon) {
                util.rehash(addon);
            },
            pack: function unpack(addon) {
                Addon(addon, { unpack: false }).restage();
            },
            unpack: function unpack(addon) {
                Addon(addon, { unpack: true }).restage();
            },
            update: function update(addon) {
                this.repackAddons([addon]);
            },
            updateAll: function updateAll() {
                this.repackAddons(Array.map(this.$("#addon-list > *"), function (i) i.mAddon)
                                       .filter(bind("isScriptified", this)));
            }
        },

        repackAddons: function repackAddons(addons) {
            for each (let addon in addons)
                Addon(addon).restage();
        },

        onAddonCommand: function onAddonCommand(item, event) {
            let command = this.commands[util.camelCase(DOM(event.originalTarget).attr("scriptify-command"))];
            if (command)
                util.trapErrors(command, this, item.mAddon);
        },

        onCommand: function onCommand(event) {
            let command = this.commands[util.camelCase(DOM(event.originalTarget).attr("scriptify-command"))];
            if (command)
                util.trapErrors(command, this, event.originalTarget);
        },

        isScriptified: function isScriptified(addon)
            io.uriExists(addon.getResourceURI("scriptify.json")),

        ScriptifyButton: function ScriptifyButton(item) {
            if (!this.isScriptified(item.mAddon))
                return DOM();

            let controls = DOM(item).findAnon("anonid", "control-container");
            if (!controls.length) {
                DOM(item).rect; // Force binding application
                controls = DOM(item).findAnon("anonid", "control-container");
            }
            if (!controls.length)
                return undefined;

            return DOM(this.addonButton.cloneNode(true))
                .prependTo(controls)
                .command(bind("onAddonCommand", this, item))
                .popupshowing(bind("onPopupShowing", this, item));
        },

        onPopupShowing: function onPopupShowing(item, event) {
            let packed = item.mAddon.getResourceURI(".") instanceof Ci.nsIJARURI;
            for each (let command in ["pack", "unpack"])
                DOM(item).findAnon("scriptify-command", command)
                         .attr("hidden", (command == "unpack") ^ packed);

            DOM(item).findAnon("scriptify-command", "browse")
                     .attr({
                         disabled: packed,
                         tooltiptext: packed ? _("addon.unavailableWhenPacked") : null
                     });
        },

        load: function load(window, event) { this.timeout(this.updateAddons); },
        onViewChanged: function onViewChanged(window, event) { this.timeout(this.updateAddons); },

        onEnabling: function onEnabling() { this.timeout(this.updateAddons); },
        onEnabled: function onEnabled() { this.timeout(this.updateAddons); },
        onInstalling: function onInstalling() { this.timeout(this.updateAddons); },
        onInstalled: function onInstalled() { this.timeout(this.updateAddons); },
        onInstallEnded: function onInstallEnded() { this.timeout(this.updateAddons); },
        onOperationCanceled: function onOperationCanceled() { this.timeout(this.updateAddons); },
        onExternalInstall: function onExternalInstall() { this.timeout(this.updateAddons); }
    }));

overlay.overlayWindow(["chrome://browser/content/browser.xul"],
    Class("BrowserOverlay", Overlay, {
        after: <e4x xmlns={XUL}>
            <menuitem id="context-openlinkintab">
                <menuitem id="scriptify-create-addon" key="menuItem"
                          image={ICON_SMALL}
                          label={_("context.scriptify-script.label")}
                          accessskey={_("context.scriptify-script.accessskey")}/>
            </menuitem>
        </e4x>.elements(),

        load: function load(window) {
            if (!config.prefs.get("first-run")) {
                config.prefs.set("first-run", config.addon.version);

                window.gBrowser.loadOneTab(HELP_URL, { inBackground: false });
            }
        },

        ready: function ready(window) {
            let self = this;
            let { menuItem } = this.objects;

            overlay.listen(this.$("#contentAreaContextMenu")[0], "popupshowing", function (event) {
                let link = event.target.triggerNode;
                let isUserScript = link instanceof Ci.nsIDOMHTMLAnchorElement
                                        ? /\.user\.js$/.test(link.href)
                                        : /\.user\.js$/.test(link.ownerDocument.documentURI);

                self.$(menuItem).attr("hidden", !isUserScript);
            });

            this.$(menuItem).command(function (event) {
                let { gContextMenu } = window;

                if (!gContextMenu.onLink)
                    dialogs.create(window, { source: gContextMenu.target.ownerDocument.documentURI });
                else {
                    services.security.checkLoadURIStrWithPrincipal(gContextMenu.target.nodePrincipal,
                                                                   gContextMenu.linkURL,
                                                                   services.security.DISALLOW_SCRIPT_OR_DATA);

                    dialogs.create(window, { source: gContextMenu.linkURL });
                }
            });
        }
    }));

// vim: set sw=4 sts=4 et ft=javascript:
