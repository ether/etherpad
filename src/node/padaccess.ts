'use strict';
const securityManager = require('./db/SecurityManager');
import settings from './utils/Settings';

// checks for padAccess
module.exports = async (req: { params?: any; cookies?: any; session?: any; }, res: { status: (arg0: number) => { (): any; new(): any; send: { (arg0: string): void; new(): any; }; }; }) => {
  const {session: {user} = {}} = req;
  const p = settings.cookie.prefix;
  const accessObj = await securityManager.checkAccess(
      req.params.pad,
      req.cookies[`${p}sessionID`] || req.cookies.sessionID,
      req.cookies[`${p}token`] || req.cookies.token,
      user);

  if (accessObj.accessStatus === 'grant') {
    // there is access, continue
    return true;
  } else {
    // no access
    res.status(403).send("403 - Can't touch this");
    return false;
  }
};
