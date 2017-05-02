"use strict";

const lua      = require('./lua.js');
const lauxlib  = require('./lauxlib.js');

const fs       = require('fs');


const LUA_IGMARK    = ["-".charCodeAt(0)];

const CLIBS         = lua.to_luastring("__CLIBS__", true);
const LUA_PATH_VAR  = "LUA_PATH";
const LUA_CPATH_VAR = "LUA_CPATH";

/*
** LUA_CSUBSEP is the character that replaces dots in submodule names
** when searching for a C loader.
** LUA_LSUBSEP is the character that replaces dots in submodule names
** when searching for a Lua loader.
*/
const LUA_CSUBSEP   = lua.LUA_DIRSEP;
const LUA_LSUBSEP   = lua.LUA_DIRSEP;

/* prefix for open functions in C libraries */
const LUA_POF       = "luaopen_";

/* separator for open functions in C libraries */
const LUA_OFSEP     = "_";
// const LIB_FAIL      = "open";

const AUXMARK       = [1];


const LIB_FAIL      = "absent";
const DLMSG         = "dynamic libraries not enabled; check your Lua installation";


const lsys_unloadlib = function(lib) {
};


const lsys_load = function(L, path, seeglb) {
    lua.lua_pushliteral(L, DLMSG);
    return null;
};


const lsys_sym = function(L, lib, sym) {
    lua.lua_pushliteral(L, DLMSG);
    return null;
};

/*
** return registry.LUA_NOENV as a boolean
*/
const noenv = function(L) {
    lua.lua_getfield(L, lua.LUA_REGISTRYINDEX, "LUA_NOENV");
    let b = lua.lua_toboolean(L, -1);
    lua.lua_pop(L, 1);  /* remove value */
    return b;
};

const readable = function(filename) {
    try {
        fs.openSync(lua.to_jsstring(filename), 'r');
    } catch (e) {
        return false;
    }

    return true;
};

/* error codes for 'lookforfunc' */
const ERRLIB  = 1;
const ERRFUNC = 2;

/*
** Look for a C function named 'sym' in a dynamically loaded library
** 'path'.
** First, check whether the library is already loaded; if not, try
** to load it.
** Then, if 'sym' is '*', return true (as library has been loaded).
** Otherwise, look for symbol 'sym' in the library and push a
** C function with that symbol.
** Return 0 and 'true' or a function in the stack; in case of
** errors, return an error code and an error message in the stack.
*/
const lookforfunc = function(L, path, sym) {
    let reg = checkclib(L, path);  /* check loaded C libraries */
    if (reg === null) {  /* must load library? */
        reg = lsys_load(L, path, sym[0] === '*'.charCodeAt(0));  /* a global symbols if 'sym'=='*' */
        if (reg === null) return ERRLIB;  /* unable to load library */
        addtoclib(L, path, reg);
    }
    if (sym[0] === '*'.charCodeAt(0)) {  /* loading only library (no function)? */
        lua.lua_pushboolean(L, 1);  /* return 'true' */
        return 0;  /* no errors */
    }
    else {
        let f = lsys_sym(L, reg, sym);
        if (f === null)
            return ERRFUNC;  /* unable to find function */
        lua.lua_pushcfunction(L, f);  /* else create new function */
        return 0;  /* no errors */
    }
};

/*
** Set a path
*/
const setpath = function(L, fieldname, envname, dft) {
    let nver = lua.lua_pushstring(L, lua.to_luastring(`${envname}${lua.LUA_VERSUFFIX}`, true));
    let path = process.env[nver];  /* use versioned name */
    if (path === undefined)  /* no environment variable? */
        path = process.env[envname];  /* try unversioned name */
    if (path === undefined || noenv(L))  /* no environment variable? */
        lua.lua_pushstring(L, lua.to_luastring(dft, true));  /* use default */
    else {
        /* replace ";;" by ";AUXMARK;" and then AUXMARK by default path */
        path = lauxlib.luaL_gsub(
            L,
            lua.to_luastring(path),
            lua.to_luastring(lua.LUA_PATH_SEP + lua.LUA_PATH_SEP, true),
            lua.to_luastring(lua.LUA_PATH_SEP, true)
                .concat(AUXMARK)
                .concat(lua.to_luastring(lua.LUA_PATH_SEP, true))
        );
        lauxlib.luaL_gsub(L, path, AUXMARK, dft);
        lua.lua_remove(L, -2); /* remove result from 1st 'gsub' */
    }
    lua.lua_setfield(L, -3, fieldname);  /* package[fieldname] = path value */
    lua.lua_pop(L, 1);  /* pop versioned variable name */
};

/*
** return registry.CLIBS[path]
*/
const checkclib = function(L, path) {
    lua.lua_rawgetp(L, lua.LUA_REGISTRYINDEX, CLIBS);
    lua.lua_getfield(L, -1, path);
    let plib = lua.lua_touserdata(L, -1);  /* plib = CLIBS[path] */
    lua.lua_pop(L, 2);  /* pop CLIBS table and 'plib' */
    return plib;
};

/*
** registry.CLIBS[path] = plib        -- for queries
** registry.CLIBS[#CLIBS + 1] = plib  -- also keep a list of all libraries
*/
const addtoclib = function(L, path, plib) {
    lua.lua_rawgetp(L, lua.LUA_REGISTRYINDEX, CLIBS);
    lua.lua_pushlightuserdata(L, plib);
    lua.lua_pushvalue(L, -1);
    lua.lua_setfield(L, -3, path);  /* CLIBS[path] = plib */
    lua.lua_rawseti(L, -2, lauxlib.luaL_len(L, -2) + 1);  /* CLIBS[#CLIBS + 1] = plib */
    lua.lua_pop(L, 1);  /* pop CLIBS table */
};

const pushnexttemplate = function(L, path) {
    while (path[0] === lua.LUA_PATH_SEP.charCodeAt[0]) path = path.slice(1);  /* skip separators */
    if (path.length === 0) return null;  /* no more templates */
    let l = path.indexOf(lua.LUA_PATH_SEP.charCodeAt(0));  /* find next separator */
    if (l < 0) l = path.length;
    lua.lua_pushlstring(L, path, l);  /* template */
    return l;
};

const searchpath = function(L, name, path, sep, dirsep) {
    let msg = [];  /* to build error message */
    if (sep[0] !== 0)  /* non-empty separator? */
        name = lauxlib.luaL_gsub(L, name, sep, dirsep);  /* replace it by 'dirsep' */
    while ((path = pushnexttemplate(L, path)) !== null) {
        let filename = lauxlib.luaL_gsub(L, lua.lua_tostring(L, -1), lua.LUA_PATH_MARK, name);
        lua.lua_remove(L, -2);  /* remove path template */
        if (readable(filename))  /* does file exist and is readable? */
            return filename;  /* return that file name */
        lua.lua_remove(L, -1);  /* remove file name */
        msg.push(...lua.to_luastring(`\n\tno file '${lua.to_jsstring(filename)}'`));
    }
    lua.lua_pushstring(msg);  /* create error message */
    return null;  /* not found */
};

const findfile = function(L, name, pname, dirsep) {
    lua.lua_getfield(L, lua.lua_upvalueindex(1), pname);
    let path = lua.lua_tostring(L, -1);
    if (path === null)
        lauxlib.luaL_error(L, `'package.${lua.to_jsstring(pname)}' must be a string`);
    return searchpath(L, name, path, ['.'.charCodeAt(0)], dirsep);
};

const checkload = function(L, stat, filename) {
    if (stat) {  /* module loaded successfully? */
        lua.lua_pushstring(L, filename);  /* will be 2nd argument to module */
        return 2;  /* return open function and file name */
    } else
        return lauxlib.luaL_error(L, lua.to_luastring(`error loading module '${lua.lua_tojsstring(L, 1)}' from file '${lua.to_jsstring(filename)}':\n\t${lua.lua_tojsstring(L, 1)}`));
};

const searcher_Lua = function(L) {
    let name = lauxlib.luaL_checkstring(L, 1);
    let filename = findfile(L, name, lua.to_luastring("path", true), LUA_LSUBSEP);
    if (filename === null) return 1;  /* module not found in this path */
    return checkload(L, lauxlib.luaL_loadfile(L, filename) === lua.LUA_OK, filename);
};

/*
** Try to find a load function for module 'modname' at file 'filename'.
** First, change '.' to '_' in 'modname'; then, if 'modname' has
** the form X-Y (that is, it has an "ignore mark"), build a function
** name "luaopen_X" and look for it. (For compatibility, if that
** fails, it also tries "luaopen_Y".) If there is no ignore mark,
** look for a function named "luaopen_modname".
*/
const loadfunc = function(L, filename, modname) {
    let openfunc;
    modname = lauxlib.luaL_gsub(L, modname, [".".charCodeAt(0)], LUA_OFSEP);
    let mark = modname.indexOf(LUA_IGMARK[0]);
    if (mark >= 0) {
        openfunc = lua.lua_pushlstring(L, modname, mark);
        openfunc = lua.lua_pushstring(L, lua.to_luastring(`${LUA_POF}${openfunc}`));
        let stat = lookforfunc(L, filename, openfunc);
        if (stat !== ERRFUNC) return stat;
        modname = mark + 1;  /* else go ahead and try old-style name */
    }
    openfunc = lua.lua_pushstring(L, lua.to_luastring(`${LUA_POF}${modname}`));
    return lookforfunc(L, filename, openfunc);
};

const searcher_C = function(L) {
    let name = lauxlib.luaL_checkstring(L, 1);
    let filename = findfile(L, name, "cpath", LUA_CSUBSEP);
    if (filename === null) return 1;  /* module not found in this path */
    return checkload(L, (loadfunc(L, filename, name) === 0), filename);
};

const searcher_Croot = function(L) {
    let name = lauxlib.luaL_checkstring(L, 1);
    let p = name.indexOf('.'.charCodeAt(0));
    let stat;
    if (p < 0) return 0;  /* is root */
    lua.lua_pushlstring(L, name, p);
    let filename = findfile(L, lua.lua_tostring(L, -1), lua.to_luastring("cpath", true), LUA_CSUBSEP);
    if (filename === null) return 1;  /* root not found */
    if ((stat = loadfunc(L, filename, name)) !== 0) {
        if (stat != ERRFUNC)
            return checkload(L, 0, filename);  /* real error */
        else {  /* open function not found */
          lua.lua_pushstring(L, lua.to_luastring(`\n\tno module '${lua.to_jsstring(name)}' in file '${lua.to_jsstring(filename)}'`));
            return 1;
        }
    }
    lua.lua_pushstring(L, filename);  /* will be 2nd argument to module */
    return 2;
};

const searcher_preload = function(L) {
    let name = lauxlib.luaL_checkstring(L, 1);
    lua.lua_getfield(L, lua.LUA_REGISTRYINDEX, lauxlib.LUA_PRELOAD_TABLE);
    if (lua.lua_getfield(L, -1, name) === lua.LUA_TNIL)  /* not found? */
        lua.lua_pushliteral(L, `\n\tno field package.preload['${lua.to_jsstring(name)}']`);
    return 1;
};

const pk_funcs = {};

const ll_funcs = {};

const createsearcherstable = function(L) {
    let searchers = {searcher_preload, searcher_Lua, searcher_C, searcher_Croot, null};
    /* create 'searchers' table */
    lua.lua_createtable(L);
    /* fill it with predefined searchers */
    for (let i = 0; searchers[i]; i++) {
      lua.lua_pushvalue(L, -2);  /* set 'package' as upvalue for all searchers */
      lua.lua_pushcclosure(L, searchers[i], 1);
      lua.lua_rawseti(L, -2, i+1);
    }
    lua.lua_setfield(L, -2, lua.to_luastring("searchers", true));  /* put it in field 'searchers' */
};

/*
** create table CLIBS to keep track of loaded C libraries,
** setting a finalizer to close all libraries when closing state.
*/
const createclibstable = function(L) {
    lua.lua_newtable(L);  /* create CLIBS table */
    lua.lua_createtable(L, 0, 1);  /* create metatable for CLIBS */
    lua.lua_setmetatable(L, -2);
    lua.lua_rawsetp(L, lua.LUA_REGISTRYINDEX, CLIBS);  /* set CLIBS table in registry */
};

const luaopen_package = function(L) {
    createclibstable(L);
    lauxlib.luaL_newlib(L, pk_funcs);  /* create 'package' table */
    createsearcherstable(L);
    /* set paths */
    setpath(L, lua.to_luastring("path", true), LUA_PATH_VAR, lua.LUA_PATH_DEFAULT);
    setpath(L, lua.to_luastring("cpath", true), LUA_CPATH_VAR, lua.LUA_CPATH_DEFAULT);
    /* store config information */
    lua.lua_pushliteral(L, lua.LUA_DIRSEP + "\n" + lua.LUA_PATH_SEP + "\n" + lua.LUA_PATH_MARK + "\n" +
                        lua.LUA_EXEC_DIR + "\n" + LUA_IGMARK + "\n");
    lua.lua_setfield(L, -2, lua.to_luastring("config", true));
    /* set field 'loaded' */
    lauxlib.luaL_getsubtable(L, lua.LUA_REGISTRYINDEX, lua.to_luastring(lauxlib.LUA_LOADED_TABLE, true));
    lua.lua_setfield(L, -2, lua.to_luastring("loaded", true));
    /* set field 'preload' */
    lauxlib.luaL_getsubtable(L, lua.LUA_REGISTRYINDEX, lua.to_luastring(lauxlib.LUA_PRELOAD_TABLE, true));
    lua.lua_setfield(L, -2, lua.to_luastring("preload", true));
    lua.lua_pushglobaltable(L);
    lua.lua_pushvalue(L, -2);  /* set 'package' as upvalue for next lib */
    lauxlib.luaL_setfuncs(L, ll_funcs, 1);  /* open lib into global table */
    lua.lua_pop(L, 1);  /* pop global table */
    return 1;  /* return 'package' table */
};

module.exports.luaopen_package = luaopen_package;