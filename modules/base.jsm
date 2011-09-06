// Copyright (c) 2009-2011 by Kris Maglione <maglione.k@gmail.com>
//
// This work is licensed for reuse under an MIT license. Details are
// given in the LICENSE.txt file included with this file.
"use strict";

var EXPORTED_SYMBOLS = [
    "ErrorBase", "Cc", "Ci", "Class", "Cr", "Cu", "JSMLoader",
    "Set", "Singleton", "XPCOM", "XPCOMShim", "XPCOMUtils", "array",
    "bind", "call", "callable", "curry", "isArray", "isGenerator",
    "isinstance", "isObject", "isString", "isSubclass", "iter", "keys",
    "lazyRequire", "memoize", "module", "octal", "require", "update",
    "values"
];

var { classes: Cc, interfaces: Ci, results: Cr, utils: Cu } = Components;

function require(module, target) JSMLoader.load(module, target);

function lazyRequire(module, names, target) {
    for each (let name in names)
        memoize(target || this, name, function (name) require(module)[name]);
}

const { XPCOMUtils } = module("resource://gre/modules/XPCOMUtils.jsm");

lazyRequire("services", ["services"]);
lazyRequire("util", ["util"]);

let objproto = Object.prototype;
let { __lookupGetter__, __lookupSetter__, __defineGetter__, __defineSetter__,
      hasOwnProperty, propertyIsEnumerable } = objproto;


/**
 * Iterates over the names of all of the top-level properties of an
 * object or, if prototypes is given, all of the properties in the
 * prototype chain below the top. Uses the debugger if possible.
 *
 * @param {object} obj The object to inspect.
 * @param {boolean} properties Whether to inspect the prototype chain
 * @default false
 * @returns {Generator}
 */
function prototype(obj) obj.__proto__ || Object.getPrototypeOf(obj);

function properties(obj, prototypes) {
    let orig = obj;
    let seen = { dactylPropertyNames: true };

    try {
        if ("dactylPropertyNames" in obj && !prototypes)
            for (let key in values(obj.dactylPropertyNames))
                if (key in obj && !Set.add(seen, key))
                    yield key;
    }
    catch (e) {}

    for (; obj; obj = prototypes && prototype(obj)) {
        for (let key in values(Object.getOwnPropertyNames(obj)))
            if (!prototypes || !Set.add(seen, key) && obj != orig)
                yield key;
    }
}

/**
 * Iterates over all of the top-level, iterable property names of an
 * object.
 *
 * @param {object} obj The object to inspect.
 * @returns {Generator}
 */
function keys(obj) iter(function keys() {
    for (var k in obj)
        if (hasOwnProperty.call(obj, k))
            yield k;
}());

/**
 * Iterates over all of the top-level, iterable property values of an
 * object.
 *
 * @param {object} obj The object to inspect.
 * @returns {Generator}
 */
function values(obj) iter(function values() {
    if (isinstance(obj, ["Generator", "Iterator"]))
        for (let k in obj)
            yield k;
    else
        for (var k in obj)
            if (hasOwnProperty.call(obj, k))
                yield obj[k];
}());

/**
 * Utility for managing sets of strings. Given an array, returns an
 * object with one key for each value thereof.
 *
 * @param {[string]} ary @optional
 * @returns {object}
 */
function Set(ary) {
    let obj = {};
    if (ary)
        for (let val in values(ary))
            obj[val] = true;
    return obj;
}
/**
 * Adds an element to a set and returns true if the element was
 * previously contained.
 *
 * @param {object} set The set.
 * @param {string} key The key to add.
 * @returns boolean
 */
Set.add = curry(function set_add(set, key) {
    let res = this.has(set, key);
    set[key] = true;
    return res;
});
/**
 * Returns true if the given set contains the given key.
 *
 * @param {object} set The set.
 * @param {string} key The key to check.
 * @returns {boolean}
 */
Set.has = curry(function set_has(set, key) hasOwnProperty.call(set, key) &&
                                           propertyIsEnumerable.call(set, key));
/**
 * Returns a new set containing the members of the first argument which
 * do not exist in any of the other given arguments.
 *
 * @param {object} set The set.
 * @returns {object}
 */
Set.subtract = function set_subtract(set) {
    set = update({}, set);
    for (let i = 1; i < arguments.length; i++)
        for (let k in keys(arguments[i]))
            delete set[k];
    return set;
};
/**
 * Removes an element from a set and returns true if the element was
 * previously contained.
 *
 * @param {object} set The set.
 * @param {string} key The key to remove.
 * @returns boolean
 */
Set.remove = curry(function set_remove(set, key) {
    let res = set.has(set, key);
    delete set[key];
    return res;
});

/**
 * Curries a function to the given number of arguments. Each
 * call of the resulting function returns a new function. When
 * a call does not contain enough arguments to satisfy the
 * required number, the resulting function is another curried
 * function with previous arguments accumulated.
 *
 *     function foo(a, b, c) [a, b, c].join(" ");
 *     curry(foo)(1, 2, 3) -> "1 2 3";
 *     curry(foo)(4)(5, 6) -> "4 5 6";
 *     curry(foo)(7)(8)(9) -> "7 8 9";
 *
 * @param {function} fn The function to curry.
 * @param {integer} length The number of arguments expected.
 *     @default fn.length
 *     @optional
 * @param {object} self The 'this' value for the returned function. When
 *     omitted, the value of 'this' from the first call to the function is
 *     preserved.
 *     @optional
 */
function curry(fn, length, self, acc) {
    if (length == null)
        length = fn.length;
    if (length == 0)
        return fn;

    // Close over function with 'this'
    function close(self, fn) function () fn.apply(self, Array.slice(arguments));

    if (acc == null)
        acc = [];

    return function curried() {
        let args = acc.concat(Array.slice(arguments));

        // The curried result should preserve 'this'
        if (arguments.length == 0)
            return close(self || this, curried);

        if (args.length >= length)
            return fn.apply(self || this, args);

        return curry(fn, length, self || this, args);
    };
}

function bind(meth, self) let (func = callable(meth) ? meth : self[meth])
    func.bind.apply(func, Array.slice(arguments, 1));

/**
 * Returns true if both arguments are functions and
 * (targ() instanceof src) would also return true.
 *
 * @param {function} targ
 * @param {function} src
 * @returns {boolean}
 */
function isSubclass(targ, src) {
    return src === targ ||
        targ && typeof targ === "function" && targ.prototype instanceof src;
}

/**
 * Returns true if *object* is an instance of *interfaces*. If *interfaces* is
 * an array, returns true if *object* is an instance of any element of
 * *interfaces*. If *interfaces* is the object form of a primitive type,
 * returns true if *object* is a non-boxed version of the type, i.e., if
 * (typeof object == "string"), isinstance(object, String) is true. Finally, if
 * *interfaces* is a string, returns true if ({}.toString.call(object) ==
 * "[object <interfaces>]").
 *
 * @param {object} object The object to check.
 * @param {constructor|[constructor|string]} interfaces The types to check *object* against.
 * @returns {boolean}
 */
var isinstance_types = {
    boolean: Boolean,
    string: String,
    function: Function,
    number: Number
};
function isinstance(object, interfaces) {
    if (object == null)
        return false;

    return Array.concat(interfaces).some(function isinstance_some(iface) {
        if (typeof iface === "string") {
            if (objproto.toString.call(object) === "[object " + iface + "]")
                return true;
        }
        else if (typeof object === "object" && "isinstance" in object && object.isinstance !== isinstance) {
            if (object.isinstance(iface))
                return true;
        }
        else {
            if (object instanceof iface)
                return true;
            var type = isinstance_types[typeof object];
            if (type && isSubclass(iface, type))
                return true;
        }
        return false;
    });
}

/**
 * Returns true if obj is a non-null object.
 */
function isObject(obj) typeof obj === "object" && obj != null || obj instanceof Ci.nsISupports;

/**
 * Returns true if and only if its sole argument is an
 * instance of the builtin Array type. The array may come from
 * any window, frame, namespace, or execution context, which
 * is not the case when using (obj instanceof Array).
 */
var isArray = Array.isArray;

/**
 * Returns true if and only if its sole argument is an
 * instance of the builtin Generator type. This includes
 * functions containing the 'yield' statement and generator
 * statements such as (x for (x in obj)).
 */
function isGenerator(val) objproto.toString.call(val) == "[object Generator]";

/**
 * Returns true if and only if its sole argument is a String,
 * as defined by the builtin type. May be constructed via
 * String(foo) or new String(foo) from any window, frame,
 * namespace, or execution context, which is not the case when
 * using (obj instanceof String) or (typeof obj == "string").
 */
function isString(val) objproto.toString.call(val) == "[object String]";

/**
 * Returns true if and only if its sole argument may be called
 * as a function. This includes classes and function objects.
 */
function callable(val) typeof val === "function";

function call(fn) {
    fn.apply(arguments[1], Array.slice(arguments, 2));
    return fn;
}

/**
 * Memoizes an object property value.
 *
 * @param {object} obj The object to add the property to.
 * @param {string} key The property name.
 * @param {function} getter The function which will return the initial
 * value of the property.
 */
function memoize(obj, key, getter) {
    if (arguments.length == 1) {
        let res = update(Object.create(obj), obj);
        for each (let prop in Object.getOwnPropertyNames(obj)) {
            let get = __lookupGetter__.call(obj, prop);
            if (get)
                memoize(res, prop, get);
        }
        return res;
    }

    try {
        Object.defineProperty(obj, key, {
            configurable: true,
            enumerable: true,

            get: function g_replaceProperty() (
                Class.replaceProperty(this.instance || this, key, null),
                Class.replaceProperty(this.instance || this, key, getter.call(this, key))),

            set: function s_replaceProperty(val)
                Class.replaceProperty(this.instance || this, key, val)
        });
    }
    catch (e) {
        try {
            obj[key] = getter.call(obj, key);
        }
        catch (e) {
            util.reportError(e);
        }
    }
}

/**
 * Updates an object with the properties of another object. Getters
 * and setters are copied as expected. Moreover, any function
 * properties receive new 'supercall' and 'superapply' properties,
 * which will call the identically named function in target's
 * prototype.
 *
 *    let a = { foo: function (arg) "bar " + arg }
 *    let b = { __proto__: a }
 *    update(b, { foo: function foo() foo.supercall(this, "baz") });
 *
 *    a.foo("foo") -> "bar foo"
 *    b.foo()      -> "bar baz"
 *
 * @param {Object} target The object to update.
 * @param {Object} src The source object from which to update target.
 *    May be provided multiple times.
 * @returns {Object} Returns its updated first argument.
 */
function update(target) {
    for (let i = 1; i < arguments.length; i++) {
        let src = arguments[i];
        Object.getOwnPropertyNames(src || {}).forEach(function (k) {
            let desc = Object.getOwnPropertyDescriptor(src, k);
            if (desc.value instanceof Class.Property)
                desc = desc.value.init(k, target) || desc.value;

            if (typeof desc.value === "function" && target.__proto__) {
                let func = desc.value.wrapped || desc.value;
                if (!func.superapply) {
                    func.__defineGetter__("super", function () Object.getPrototypeOf(target)[k]);
                    func.superapply = function superapply(self, args)
                        let (meth = Object.getPrototypeOf(target)[k])
                            meth && meth.apply(self, args);
                    func.supercall = function supercall(self)
                        func.superapply(self, Array.slice(arguments, 1));
                }
            }
            try {
                Object.defineProperty(target, k, desc);
            }
            catch (e) {}
        });
    }
    return target;
}

/**
 * @constructor Class
 *
 * Constructs a new Class. Arguments marked as optional must be
 * either entirely elided, or they must have the exact type
 * specified.
 *
 * @param {string} name The class's as it will appear when toString
 *     is called, as well as in stack traces.
 *     @optional
 * @param {function} base The base class for this module. May be any
 *     callable object.
 *     @optional
 *     @default Class
 * @param {Object} prototype The prototype for instances of this
 *     object. The object itself is copied and not used as a prototype
 *     directly.
 * @param {Object} classProperties The class properties for the new
 *     module constructor. More than one may be provided.
 *     @optional
 *
 * @returns {function} The constructor for the resulting class.
 */
function Class() {

    var args = Array.slice(arguments);
    if (isString(args[0]))
        var name = args.shift();
    var superclass = Class;
    if (callable(args[0]))
        superclass = args.shift();

    var Constructor = function Constructor() {
        var self = Object.create(Constructor.prototype);
        self.instance = self;

        if ("_metaInit_" in self && self._metaInit_)
            self._metaInit_.apply(self, arguments);

        var res = self.init.apply(self, arguments);
        return res !== undefined ? res : self;
    };

    Constructor.className = name || superclass.className || superclass.name;
    Constructor.__proto__ = superclass;

    Class.extend(Constructor, superclass, args[0]);
    update(Constructor, args[1]);

    args.slice(2).forEach(function (obj) {
        if (callable(obj))
            obj = obj.prototype;
        update(Constructor.prototype, obj);
    });
    return Constructor;
}

/**
 * @class Class.Property
 * A class which, when assigned to a property in a Class's prototype
 * or class property object, defines that property's descriptor
 * rather than its value. If the desc object has an init property, it
 * will be called with the property's name before the descriptor is
 * assigned.
 *
 * @param {Object} desc The property descriptor.
 */
Class.Property = function Property(desc) update(
    Object.create(Property.prototype), desc || { configurable: true, writable: true });
Class.Property.prototype.init = function () {};
/**
 * Extends a subclass with a superclass. The subclass's
 * prototype is replaced with a new object, which inherits
 * from the superclass's prototype, {@see update}d with the
 * members of *overrides*.
 *
 * @param {function} subclass
 * @param {function} superclass
 * @param {Object} overrides @optional
 */
Class.extend = function extend(subclass, superclass, overrides) {
    subclass.superclass = superclass;

    subclass.prototype = Object.create(superclass.prototype);
    update(subclass.prototype, overrides);
    subclass.prototype.constructor = subclass;
    subclass.prototype._class_ = subclass;

    if (superclass.prototype.constructor === objproto.constructor)
        superclass.prototype.constructor = superclass;
}

/**
 * Memoizes the value of a class property to the value returned by
 * the passed function the first time the property is accessed.
 *
 * @param {function(string)} getter The function which returns the
 *      property's value.
 * @returns {Class.Property}
 */
Class.Memoize = function Memoize(getter, wait)
    Class.Property({
        configurable: true,
        enumerable: true,
        init: function (key) {
            this.get = function replace() {
                let obj = this.instance || this;
                Class.replaceProperty(obj, key, null);
                return Class.replaceProperty(obj, key, getter.call(this, key));
            };

            this.set = function replace(val) Class.replaceProperty(this.instance || this, val);
        }
    });

/**
 * Updates the given object with the object in the target class's
 * prototype.
 */
Class.Update = function Update(obj)
    Class.Property({
        configurable: true,
        enumerable: true,
        init: function (key, target) {
            this.value = update({}, target[key], obj);
        }
    });

Class.replaceProperty = function replaceProperty(obj, prop, value) {
    Object.defineProperty(obj, prop, { configurable: true, enumerable: true, value: value, writable: true });
    return value;
};
Class.toString = function toString() "[class " + this.className + "]";
Class.prototype = {
    /**
     * Initializes new instances of this class. Called automatically
     * when new instances are created.
     */
    init: function c_init() {},

    get instance() ({}),
    set instance(val) Class.replaceProperty(this, "instance", val),

    withSavedValues: function withSavedValues(names, callback, self) {
        let vals = names.map(function (name) this[name], this);
        try {
            return callback.call(self || this);
        }
        finally {
            names.forEach(function (name, i) this[name] = vals[i], this);
        }
    },

    toString: function C_toString() {
        if (this.toStringParams)
            var params = "(" + this.toStringParams.map(function (m) isArray(m)  ? "[" + m + "]" :
                                                                    isString(m) ? m.quote() : String(m))
                                   .join(", ") + ")";
        return "[instance " + this.constructor.className + (params || "") + "]";
    },

    /**
     * Executes *callback* after *timeout* milliseconds. The value of
     * 'this' is preserved in the invocation of *callback*.
     *
     * @param {function} callback The function to call after *timeout*
     * @param {number} timeout The time, in milliseconds, to wait
     *     before calling *callback*.
     * @returns {nsITimer} The timer which backs this timeout.
     */
    timeout: function timeout(callback, timeout) {
        const self = this;
        function timeout_notify(timer) {
            if (self.stale ||
                    util.rehashing && !isinstance(Cu.getGlobalForObject(callback), ["BackstagePass"]))
                return;
            util.trapErrors(callback, self);
        }
        return services.Timer(timeout_notify, timeout || 0, services.Timer.TYPE_ONE_SHOT);
    },

    /**
     * Updates this instance with the properties of the given objects.
     * Like the update function, but with special semantics for
     * localized properties.
     */
    update: function update() {
        let self = this;
        // XXX: Duplication.

        for (let i = 0; i < arguments.length; i++) {
            let src = arguments[i];
            Object.getOwnPropertyNames(src || {}).forEach(function (k) {
                let desc = Object.getOwnPropertyDescriptor(src, k);
                if (desc.value instanceof Class.Property)
                    desc = desc.value.init(k, this) || desc.value;

                if (typeof desc.value === "function") {
                    let func = desc.value.wrapped || desc.value;
                    if (!func.superapply) {
                        func.__defineGetter__("super", function () Object.getPrototypeOf(self)[k]);
                        func.superapply = function superapply(self, args)
                            let (meth = Object.getPrototypeOf(self)[k])
                                meth && meth.apply(self, args);
                        func.supercall = function supercall(self)
                            func.superapply(self, Array.slice(arguments, 1));
                    }
                }

                try {
                    if ("value" in desc && k in this.magicalProperties)
                        this[k] = desc.value;
                    else
                        Object.defineProperty(this, k, desc);
                }
                catch (e) {}
            }, this);
        }
    },

    magicalProperties: {}
};
Class.makeClosure = function makeClosure() {
    const self = this;
    function closure(fn) {
        function _closure() {
            try {
                return fn.apply(self, arguments);
            }
            catch (e) {
                util.reportError(e);
                throw e.stack ? e : Error(e);
            }
        }
        _closure.wrapped = fn;
        return _closure;
    }

    iter(properties(this), properties(this, true)).forEach(function (k) {
        if (!__lookupGetter__.call(this, k) && callable(this[k]))
            closure[k] = closure(this[k]);
        else if (!(k in closure))
            Object.defineProperty(closure, k, {
                configurable: true,
                enumerable: true,
                get: function get_proxy() self[k],
                set: function set_proxy(val) self[k] = val,
            });
    }, this);

    return closure;
};
memoize(Class.prototype, "closure", Class.makeClosure);

/**
 * A base class generator for classes which implement XPCOM interfaces.
 *
 * @param {nsIIID|[nsIJSIID]} interfaces The interfaces which the class
 *      implements.
 * @param {Class} superClass A super class. @optional
 * @returns {Class}
 */
function XPCOM(interfaces, superClass) {
    interfaces = Array.concat(interfaces);

    let shim = XPCOMShim(interfaces);

    let res = Class("XPCOM(" + interfaces + ")", superClass || Class,
        update(iter([k,
                     v === undefined || callable(v) ? stub : v]
                     for ([k, v] in Iterator(shim))).toObject(),
               { QueryInterface: XPCOMUtils.generateQI(interfaces) }));

    return res;
}
function XPCOMShim(interfaces) {
    let ip = services.InterfacePointer({
        QueryInterface: function (iid) {
            if (iid.equals(Ci.nsISecurityCheckedComponent))
                throw Cr.NS_ERROR_NO_INTERFACE;
            return this;
        },
        getHelperForLanguage: function () null,
        getInterfaces: function (count) { count.value = 0; }
    });
    return (interfaces || []).reduce(function (shim, iface) shim.QueryInterface(Ci[iface]),
                                     ip.data)
};
function stub() null;

/**
 * An abstract base class for classes that wish to inherit from Error.
 */
var ErrorBase = Class("ErrorBase", Error, {
    level: 2,
    init: function EB_init(message, level) {
        level = level || 0;
        let error = Error(message);
        update(this, error)
        this.stack = error.stack;
        this.message = message;

        let frame = Components.stack;
        for (let i = 0; i < this.level + level; i++) {
            frame = frame.caller;
            this.stack = this.stack.replace(/^.*\n/, "");
        }
        this.fileName = frame.filename;
        this.lineNumber = frame.lineNumber;
    },
    toString: function () String(this.message)
});

function Singleton(name, prototype) {
    let proto = arguments[callable(prototype) ? 2 : 1];

    proto._metaInit_ = function () {
        delete module.prototype._metaInit_;
        if (JSMLoader.currentModule)
            JSMLoader.currentModule[name] = this;
    };

    const module = Class.apply(Class, arguments);
    let instance = module();
    module.className = name;

    Singleton.instances.push(instance);
    return instance;
}
Singleton.instances = [];
JSMLoader.atexit(function () {
    for (let instance in values(Singleton.instances.reverse()))
        if (instance.cleanup)
            util.trapErrors("cleanup", instance);
});

function octal(decimal) parseInt(decimal, 8);

/**
 * Iterates over an arbitrary object. The following iterator types are
 * supported, and work as a user would expect:
 *
 *  • nsIDOMNodeIterator
 *  • mozIStorageStatement
 *
 * Additionally, the following array-like objects yield a tuple of the
 * form [index, element] for each contained element:
 *
 *  • nsIDOMHTMLCollection
 *  • nsIDOMNodeList
 *
 * and the following likewise yield one element of the form
 * [name, element] for each contained element:
 *
 *  • nsIDOMNamedNodeMap
 *
 * Duck typing is implemented for any other type. If the object
 * contains the "enumerator" property, iter is called on that. If the
 * property is a function, it is called first. If it contains the
 * property "getNext" along with either "hasMoreItems" or "hasMore", it
 * is iterated over appropriately.
 *
 * For all other cases, this function behaves exactly like the Iterator
 * function.
 *
 * @param {object} obj
 * @param {nsIJSIID} iface The interface to which to query all elements.
 * @returns {Generator}
 */
function iter(obj, iface) {
    if (arguments.length == 2 && iface instanceof Ci.nsIJSIID)
        return iter(obj).map(function (item) item.QueryInterface(iface));

    let args = arguments;
    let res = Iterator(obj);

    if (args.length > 1)
        res = (function () {
            for (let i = 0; i < args.length; i++)
                for (let j in iter(args[i]))
                    yield j;
        })();
    else if (isinstance(obj, ["Iterator", "Generator"]))
        ;
    else if (isinstance(obj, [Ci.nsIDOMHTMLCollection, Ci.nsIDOMNodeList]))
        res = array.iterItems(obj);
    else if (obj instanceof Ci.nsIDOMNamedNodeMap)
        res = (function () {
            for (let i = 0; i < obj.length; i++)
                yield [obj.name, obj];
        })();
    else if (obj instanceof Ci.mozIStorageStatement)
        res = (function (obj) {
            while (obj.executeStep())
                yield obj.row;
            obj.reset();
        })(obj);
    else if ("getNext" in obj) {
        if ("hasMoreElements" in obj)
            res = (function () {
                while (obj.hasMoreElements())
                    yield obj.getNext();
            })();
        else if ("hasMore" in obj)
            res = (function () {
                while (obj.hasMore())
                    yield obj.getNext();
            })();
    }
    else if ("enumerator" in obj) {
        if (callable(obj.enumerator))
            return iter(obj.enumerator());
        return iter(obj.enumerator);
    }
    res.__noSuchMethod__ = function __noSuchMethod__(meth, args) {
        if (meth in iter)
            var res = iter[meth].apply(iter, [this].concat(args));
        else
            res = let (ary = array(this))
                ary[meth] ? ary[meth].apply(ary, args) : ary.__noSuchMethod__(meth, args);
        if (isinstance(res, ["Iterator", "Generator"]))
            return iter(res);
        return res;
    };
    return res;
}
update(iter, {
    toArray: function toArray(iter) array(iter).array,

    // See array.prototype for API docs.
    toObject: function toObject(iter) {
        let obj = {};
        for (let [k, v] in iter)
            if (v instanceof Class.Property)
                Object.defineProperty(obj, k, v.init(k, obj) || v);
            else
                obj[k] = v;
        return obj;
    },

    compact: function compact(iter) (item for (item in iter) if (item != null)),

    every: function every(iter, pred, self) {
        pred = pred || util.identity;
        for (let elem in iter)
            if (!pred.call(self, elem))
                return false;
        return true;
    },
    some: function every(iter, pred, self) {
        pred = pred || util.identity;
        for (let elem in iter)
            if (pred.call(self, elem))
                return true;
        return false;
    },

    filter: function filter(iter, pred, self) {
        for (let elem in iter)
            if (pred.call(self, elem))
                yield elem;
    },

    /**
     * Iterates over an iterable object and calls a callback for each
     * element.
     *
     * @param {object} iter The iterator.
     * @param {function} fn The callback.
     * @param {object} self The this object for *fn*.
     */
    forEach: function forEach(iter, func, self) {
        for (let val in iter)
            func.call(self, val);
    },

    indexOf: function indexOf(iter, elem) {
        let i = 0;
        for (let item in iter) {
            if (item == elem)
                return i;
            i++;
        }
    },

    /**
     * Returns the array that results from applying *func* to each property of
     * *obj*.
     *
     * @param {Object} obj
     * @param {function} func
     * @returns {Array}
     */
    map: function map(iter, func, self) {
        for (let i in iter)
            yield func.call(self, i);
    },

    /**
     * Returns the nth member of the given array that matches the
     * given predicate.
     */
    nth: function nth(iter, pred, n, self) {
        if (typeof pred === "number")
            [pred, n] = [function () true, pred]; // Hack.

        for (let elem in iter)
            if (pred.call(self, elem) && n-- === 0)
                return elem;
        return undefined;
    },

    sort: function sort(iter, fn, self)
        array(this.toArray(iter).sort(fn, self)),

    uniq: function uniq(iter) {
        let seen = {};
        for (let item in iter)
            if (!Set.add(seen, item))
                yield item;
    },

    /**
     * Zips the contents of two arrays. The resulting array is the length of
     * ary1, with any shortcomings of ary2 replaced with null strings.
     *
     * @param {Array} ary1
     * @param {Array} ary2
     * @returns {Array}
     */
    zip: function zip(iter1, iter2) {
        try {
            yield [iter1.next(), iter2.next()];
        }
        catch (e if e instanceof StopIteration) {}
    }
});

/**
 * Array utility methods.
 */
var array = Class("array", Array, {
    init: function (ary) {
        if (isinstance(ary, ["Iterator", "Generator"]) || "__iterator__" in ary)
            ary = [k for (k in ary)];
        else if (ary.length)
            ary = Array.slice(ary);

        return {
            __proto__: ary,
            __iterator__: function () this.iterItems(),
            __noSuchMethod__: function (meth, args) {
                var res = array[meth].apply(null, [this.array].concat(args));
                if (isArray(res))
                    return array(res);
                if (isinstance(res, ["Iterator", "Generator"]))
                    return iter(res);
                return res;
            },
            array: ary,
            toString: function () this.array.toString(),
            concat: function () this.__noSuchMethod__("concat", Array.slice(arguments)),
            filter: function () this.__noSuchMethod__("filter", Array.slice(arguments)),
            map: function () this.__noSuchMethod__("map", Array.slice(arguments))
        };
    }
}, {
    /**
     * Converts an array to an object. As in lisp, an assoc is an
     * array of key-value pairs, which maps directly to an object,
     * as such:
     *    [["a", "b"], ["c", "d"]] -> { a: "b", c: "d" }
     *
     * @param {[Array]} assoc
     * @... {string} 0 - Key
     * @...          1 - Value
     */
    toObject: function toObject(assoc) {
        let obj = {};
        assoc.forEach(function ([k, v]) {
            if (v instanceof Class.Property)
                Object.defineProperty(obj, k, v.init(k, obj) || v);
            else
                obj[k] = v;
        });
        return obj;
    },

    /**
     * Compacts an array, removing all elements that are null or undefined:
     *    ["foo", null, "bar", undefined] -> ["foo", "bar"]
     *
     * @param {Array} ary
     * @returns {Array}
     */
    compact: function compact(ary) ary.filter(function (item) item != null),

    /**
     * Returns true if each element of ary1 is equal to the
     * corresponding element in ary2.
     *
     * @param {Array} ary1
     * @param {Array} ary2
     * @returns {boolean}
     */
    equals: function (ary1, ary2)
        ary1.length === ary2.length && Array.every(ary1, function (e, i) e === ary2[i]),

    /**
     * Flattens an array, such that all elements of the array are
     * joined into a single array:
     *    [["foo", ["bar"]], ["baz"], "quux"] -> ["foo", ["bar"], "baz", "quux"]
     *
     * @param {Array} ary
     * @returns {Array}
     */
    flatten: function flatten(ary) ary.length ? Array.prototype.concat.apply([], ary) : [],

    /**
     * Returns an Iterator for an array's values.
     *
     * @param {Array} ary
     * @returns {Iterator(Object)}
     */
    iterValues: function iterValues(ary) {
        for (let i = 0; i < ary.length; i++)
            yield ary[i];
    },

    /**
     * Returns an Iterator for an array's indices and values.
     *
     * @param {Array} ary
     * @returns {Iterator([{number}, {Object}])}
     */
    iterItems: function iterItems(ary) {
        let length = ary.length;
        for (let i = 0; i < length; i++)
            yield [i, ary[i]];
    },

    /**
     * Returns the nth member of the given array that matches the
     * given predicate.
     */
    nth: function nth(ary, pred, n, self) {
        for (let elem in values(ary))
            if (pred.call(self, elem) && n-- === 0)
                return elem;
        return undefined;
    },

    /**
     * Filters out all duplicates from an array. If *unsorted* is false, the
     * array is sorted before duplicates are removed.
     *
     * @param {Array} ary
     * @param {boolean} unsorted
     * @returns {Array}
     */
    uniq: function uniq(ary, unsorted) {
        let res = [];
        if (unsorted) {
            for (let item in values(ary))
                if (res.indexOf(item) == -1)
                    res.push(item);
        }
        else {
            for (let [, item] in Iterator(ary.sort())) {
                if (item != last || !res.length)
                    res.push(item);
                var last = item;
            }
        }
        return res;
    },

    /**
     * Zips the contents of two arrays. The resulting array is the length of
     * ary1, with any shortcomings of ary2 replaced with null strings.
     *
     * @param {Array} ary1
     * @param {Array} ary2
     * @returns {Array}
     */
    zip: function zip(ary1, ary2) {
        let res = [];
        for (let [i, item] in Iterator(ary1))
            res.push([item, i in ary2 ? ary2[i] : ""]);
        return res;
    }
});

// vim: set sw=4 ts=4 et ft=javascript: