// Copyright © 2009-2011 Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE file included with this file.
"use strict";

var EXPORTED_SYMBOLS = ["Prefs", "prefs"];

var { services } = require("services");

var Prefs = Class("Prefs", {
    init: function init(branch, defaults) {
        this.constructor = Prefs; // Ends up Object otherwise... Why?

        this.branch = services.pref[defaults ? "getDefaultBranch" : "getBranch"](branch || "");
        if (this.branch instanceof Ci.nsIPrefBranch2)
            this.branch.QueryInterface(Ci.nsIPrefBranch2);

        this.defaults = defaults ? this : new this.constructor(branch, true);
    },

    /**
     * Returns a new Prefs object for the sub-branch *branch* of this
     * object.
     *
     * @param {string} branch The sub-branch to return.
     */
    Branch: function Branch(branch) new this.constructor(this.root + branch),

    /**
     * Clears the entire branch.
     *
     * @param {string} name The name of the preference branch to delete.
     */
    clear: function clear(branch) {
        this.branch.deleteBranch(branch || "");
    },

    /**
     * Returns the full name of this object's preference branch.
     */
    get root() this.branch.root,

    /**
     * Returns the value of the preference *name*, or *defaultValue* if
     * the preference does not exist.
     *
     * @param {string} name The name of the preference to return.
     * @param {*} defaultValue The value to return if the preference has no value.
     * @optional
     */
    get: function get(name, defaultValue) {
        let type = this.branch.getPrefType(name);

        if (type === Ci.nsIPrefBranch.PREF_STRING)
            return this.branch.getComplexValue(name, Ci.nsISupportsString).data;

        if (type === Ci.nsIPrefBranch.PREF_INT)
            return this.branch.getIntPref(name);

        if (type === Ci.nsIPrefBranch.PREF_BOOL)
            return this.branch.getBoolPref(name);

        return defaultValue;
    },

    /**
     * Returns true if the given preference exists in this branch.
     *
     * @param {string} name The name of the preference to check.
     */
    has: function has(name) this.branch.getPrefType(name) !== 0,

    /**
     * Returns an array of all preference names in this branch or the
     * given sub-branch.
     *
     * @param {string} branch The sub-branch for which to return preferences.
     * @optional
     */
    getNames: function getNames(branch) this.branch.getChildList(branch || "", { value: 0 }),

    /**
     * Returns true if the given preference is set to its default value.
     *
     * @param {string} name The name of the preference to check.
     */
    isDefault: function isDefault(name) !this.branch.prefHasUserValue(name),

    /**
     * Sets the preference *name* to *value*. If the preference already
     * exists, it must have the same type as the given value.
     *
     * @param {name} name The name of the preference to change.
     * @param {string|number|boolean} value The value to set.
     */
    set: function set(name, value) {
        let type = typeof value;
        if (type === "string")
            this.branch.setComplexValue(name, Ci.nsISupportsString, services.String(value));
        else if (type === "number")
            this.branch.setIntPref(name, value);
        else if (type === "boolean")
            this.branch.setBoolPref(name, value);
        else
            throw TypeError("Unknown preference type: " + type);
    },

    /**
     * Resets the preference *name* to its default value.
     *
     * @param {string} name The name of the preference to reset.
     */
    reset: function reset(name) {
        if (this.branch.prefHasUserValue(name))
            this.branch.clearUserPref(name);
    }
});

var prefs = Prefs("");

