// Copyright (c) 2009-2011 by Kris Maglione <maglione.k at Gmail>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE file included with this file.
"use strict";

// Don't ask me why this is necessary.
window.addEventListener("load", function () {
    if (location.hash)
        location.hash = location.hash;
}, false);

// vim: set fdm=marker sw=4 ts=4 et:
