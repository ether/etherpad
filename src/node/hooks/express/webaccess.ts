'use strict';

import {strict as assert} from "assert";
import log4js from 'log4js';
import {SocketClientRequest} from "../../types/SocketClientRequest";
import {WebAccessTypes} from "../../types/WebAccessTypes";
import {SettingsUser} from "../../types/SettingsUser";
const httpLogger = log4js.getLogger('http');
import settings from '../../utils/Settings';
const hooks = require('../../../static/js/pluginfw/hooks');
import readOnlyManager from '../../db/ReadOnlyManager';

hooks.deprecationNotices.authFailure = 'use the authnFailure and authzFailure hooks instead';

// Promisified wrapper around hooks.aCallFirst.
const aCallFirst = (hookName: string, context:any, pred = null) => new Promise((resolve, reject) => {
  hooks.aCallFirst(hookName, context, (err:any, r: unknown) => err != null ? reject(err) : resolve(r), pred);
});

const aCallFirst0 =
    // @ts-ignore
    async (hookName: string, context:any, pred = null) => (await aCallFirst(hookName, context, pred))[0];

exports.normalizeAuthzLevel = (level: string|boolean) => {
  if (!level) return false;
  switch (level) {
    case true:
      return 'create';
    case 'readOnly':
    case 'modify':
    case 'create':
      return level;
    default:
      httpLogger.warn(`Unknown authorization level '${level}', denying access`);
  }
  return false;
};

exports.userCanModify = (padId: string, req: SocketClientRequest) => {
  if (readOnlyManager.isReadOnlyId(padId)) return false;
  if (!settings.requireAuthentication) return true;
  const {session: {user} = {}} = req;
  if (!user || user.readOnly) return false;
  assert(user.padAuthorizations); // This is populated even if !settings.requireAuthorization.
  const level = exports.normalizeAuthzLevel(user.padAuthorizations[padId]);
  return level && level !== 'readOnly';
};

// Exported so that tests can set this to 0 to avoid unnecessary test slowness.
exports.authnFailureDelayMs = 1000;

const staticResources = [
  /^\/padbootstrap-[a-zA-Z0-9]+\.min\.js$/,
  /^\/timeSliderBootstrap-[a-zA-Z0-9]+\.min\.js$/,
  /^\/manifest.json$/
]

const checkAccess = async (req:any, res:any, next: Function) => {
  const requireAdmin = req.path.toLowerCase().startsWith('/admin-auth');
  for (const staticResource of staticResources) {
    if (req.path.match(staticResource)) {
      console.log(`Loading [${staticResource}] ${req.path}`);
      return next()
    }
  }


  // ///////////////////////////////////////////////////////////////////////////////////////////////
  // Step 1: Check the preAuthorize hook for early permit/deny (permit is only allowed for non-admin
  // pages). If any plugin explicitly grants or denies access, skip the remaining steps. Plugins can
  // use the preAuthzFailure hook to override the default 403 error.
  // ///////////////////////////////////////////////////////////////////////////////////////////////

  let results: null|boolean[];
  let skip = false;
  const preAuthorizeNext = (...args:any) => { skip = true; next(...args); };
  try {
    results = await aCallFirst('preAuthorize', {req, res, next: preAuthorizeNext},
        // This predicate will cause aCallFirst to call the hook functions one at a time until one
        // of them returns a non-empty list, with an exception: If the request is for an /admin
        // page, truthy entries are filtered out before checking to see whether the list is empty.
        // This prevents plugin authors from accidentally granting admin privileges to the general
        // public.
        // @ts-ignore
        (r) => (skip || (r != null && r.filter((x) => (!requireAdmin || !x)).length > 0))) as boolean[];
  } catch (err:any) {
    httpLogger.error(`Error in preAuthorize hook: ${err.stack || err.toString()}`);
    if (!skip) res.status(500).send('Internal Server Error');
    return;
  }
  if (skip) return;
  if (requireAdmin) {
    // Filter out all 'true' entries to prevent plugin authors from accidentally granting admin
    // privileges to the general public.
    results = results.filter((x) => !x);
  }
  if (results.length > 0) {
    // Access was explicitly granted or denied. If any value is false then access is denied.
    if (results.every((x) => x)) return next();
    if (await aCallFirst0('preAuthzFailure', {req, res})) return;
    // No plugin handled the pre-authentication authorization failure.
    return res.status(403).send('Forbidden');
  }

  // This helper is used in steps 2 and 4 below, so it may be called twice per access: once before
  // authentication is checked and once after (if settings.requireAuthorization is true).
  const authorize = async () => {
    const grant = async (level: string|false) => {
      level = exports.normalizeAuthzLevel(level);
      if (!level) return false;
      const user = req.session.user;
      if (user == null) return true; // This will happen if authentication is not required.
      const encodedPadId = (req.path.match(/^\/p\/([^/]*)/) || [])[1];
      if (encodedPadId == null) return true;
      let padId = decodeURIComponent(encodedPadId);
      if (readOnlyManager.isReadOnlyId(padId)) {
        // pad is read-only, first get the real pad ID
        padId = await readOnlyManager.getPadId(padId);
        if (padId == null) return false;
      }
      // The user was granted access to a pad. Remember the authorization level in the user's
      // settings so that SecurityManager can approve or deny specific actions.
      if (user.padAuthorizations == null) user.padAuthorizations = {};
      user.padAuthorizations[padId] = level;
      return true;
    };
    const isAuthenticated = req.session && req.session.user;
    if (isAuthenticated && req.session.user.is_admin) return await grant('create');
    const requireAuthn = requireAdmin || settings.requireAuthentication;
    if (!requireAuthn) return await grant('create');
    if (!isAuthenticated) return await grant(false);
    if (requireAdmin && !req.session.user.is_admin) return await grant(false);
    if (!settings.requireAuthorization) return await grant('create');
    return await grant(await aCallFirst0('authorize', {req, res, next, resource: req.path}));
  };

  // ///////////////////////////////////////////////////////////////////////////////////////////////
  // Step 2: Try to just access the thing. If access fails (perhaps authentication has not yet
  // completed, or maybe different credentials are required), go to the next step.
  // ///////////////////////////////////////////////////////////////////////////////////////////////

  if (await authorize()) {
    if(requireAdmin) {
        res.status(200).send('Authorized')
        return
    }
    return next();
  }

  // ///////////////////////////////////////////////////////////////////////////////////////////////
  // Step 3: Authenticate the user. (Or, if already logged in, reauthenticate with different
  // credentials if supported by the authn scheme.) If authentication fails, give the user a 401
  // error to request new credentials. Otherwise, go to the next step. Plugins can use the
  // authnFailure hook to override the default error handling behavior (e.g., to redirect to a login
  // page).
  // ///////////////////////////////////////////////////////////////////////////////////////////////

  if (settings.users == null) settings.users = {};
  const ctx:WebAccessTypes = {req, res, users: settings.users, next};
  // If the HTTP basic auth header is present, extract the username and password so it can be given
  // to authn plugins.
  const httpBasicAuth = req.headers.authorization && req.headers.authorization.startsWith('Basic ');
  if (httpBasicAuth) {
    const userpass =
        Buffer.from(req.headers.authorization.split(' ')[1], 'base64').toString().split(':');
    ctx.username = userpass.shift();
    // Prevent prototype pollution vulnerabilities in plugins. This also silences a prototype
    // pollution warning below (when setting settings.users[ctx.username]) that isn't actually a
    // problem unless the attacker can also set Object.prototype.password.
    if (ctx.username === '__proto__') ctx.username = null;
    ctx.password = userpass.join(':');
  }
  if (!(await aCallFirst0('authenticate', ctx))) {
    // Fall back to HTTP basic auth.
    // @ts-ignore
    const {[ctx.username]: {password} = {}} = settings.users as SettingsUser;

    if (!httpBasicAuth ||
        !ctx.username ||
        password == null || password.toString() !== ctx.password) {
      httpLogger.info(`Failed authentication from IP ${req.ip}`);
      if (await aCallFirst0('authnFailure', {req, res})) return;
      if (await aCallFirst0('authFailure', {req, res, next})) return;
      // No plugin handled the authentication failure. Fall back to basic authentication.
      if (!requireAdmin) {
        res.header('WWW-Authenticate', 'Basic realm="Protected Area"');
      }
      // Delay the error response for 1s to slow down brute force attacks.
      await new Promise((resolve) => setTimeout(resolve, exports.authnFailureDelayMs));
      res.status(401).send('Authentication Required');
      return;
    }
    if (ctx.username === '__proto__' || ctx.username === 'constructor' || ctx.username === 'prototype') {
      res.end(403);
      return;
    }
    settings.users[ctx.username].username = ctx.username;
    // Make a shallow copy so that the password property can be deleted (to prevent it from
    // appearing in logs or in the database) without breaking future authentication attempts.
    req.session.user = {...settings.users[ctx.username]};
    delete req.session.user.password;
  }
  if (req.session.user == null) {
    httpLogger.error('authenticate hook failed to add user settings to session');
    return res.status(500).send('Internal Server Error');
  }
  const {username = '<no username>'} = req.session.user;
  httpLogger.info(`Successful authentication from IP ${req.ip} for user ${username}`);

  // ///////////////////////////////////////////////////////////////////////////////////////////////
  // Step 4: Try to access the thing again. If this fails, give the user a 403 error. Plugins can
  // use the authzFailure hook to override the default error handling behavior (e.g., to redirect to
  // a login page).
  // ///////////////////////////////////////////////////////////////////////////////////////////////

  const auth = await authorize()
  if (auth && !requireAdmin) return next();
  if(auth && requireAdmin) {
    res.status(200).send('Authorized')
    return
  }

  if (await aCallFirst0('authzFailure', {req, res})) return;
  if (await aCallFirst0('authFailure', {req, res, next})) return;
  // No plugin handled the authorization failure.
  res.status(403).send('Forbidden');
};

/**
 * Express middleware to authenticate the user and check authorization. Must be installed after the
 * express-session middleware.
 */
exports.checkAccess = (req:any, res:any, next:Function) => {
  checkAccess(req, res, next).catch((err) => next(err || new Error(err)));
};
