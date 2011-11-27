// Copyright (c) 2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE file included with this file.
/* use strict */

Components.utils.import("resource://scriptify/bootstrap.jsm");

require("base", this);
let { Dialog } = require("dialog");
let { DOM } = require("dom");
let { _ } = require("messages");
let { services } = require("services");
let { util } = require("util");

this.lazyRequire("io", ["io"]);

function $(sel, context) DOM(sel, context || document);

let dialog = Dialog(window, {
    findApp: util.wrapCallback(function findApp(elem, title) {
        let picker = services.FilePicker(window, title,
                                         services.FilePicker.modeOpen);

        picker.appendFilters(services.FilePicker.filterApps);

        if (picker.show() == services.FilePicker.returnOK)
            $(elem).val(io.quoteArg(picker.file.path));
    })
});

// vim:se sts=4 sw=4 et ft=javascript:
