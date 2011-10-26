// Copyright (c) 2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE file included with this file.
"use strict";

Components.utils.import("resource://scriptify/bootstrap.jsm");

require("base", this);
let { Dialog } = require("dialog");
let { util } = require("util");

var dialog = Dialog(window, {
    init: function init(config) {
        this.config = config;
    },

    onload: function onload(event) {
        let { config } = this;

        let root = document.documentElement;
        if (config.buttons)
            root.buttons = config.buttons;
        root.title = config.title;

        this.$("#label").val(config.prompt);
        this.field("value").val(config.value);
    },

    onaccept: function onaccept() {
        this.config.value = this.field("value").val();
    },

    oncancel: function oncancel() {
        this.config.canceled = true;
    },
});
