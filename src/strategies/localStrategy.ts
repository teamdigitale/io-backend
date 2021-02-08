import { FiscalCode } from "@pagopa/ts-commons/lib/strings";
import * as passport from "passport";
import { Strategy } from "passport-local";
import { SpidUser } from "src/types/user";
import { SpidLevelEnum } from "../../generated/backend/SpidLevel";

/**
 * Create a new Local Strategy with provided authorized fiscal code (user names)
 * and a fixed password. Returns unauthorized if validUsernameList does not contain
 * the fiscal code (user name) provided during login.
 */
export const localStrategy = (
  validUsernameList: ReadonlyArray<FiscalCode>,
  validPassword: string
): passport.Strategy =>
  new Strategy((username, password, done) => {
    if (
      FiscalCode.is(username) &&
      validUsernameList.includes(username) &&
      validPassword === password
    ) {
      // Fake test user for password based logins
      const testUser: SpidUser = {
        authnContextClassRef: SpidLevelEnum["https://www.spid.gov.it/SpidL2"],
        familyName: "Rossi",
        fiscalNumber: username,
        getAssertionXml: () => "",
        issuer: "IO",
        name: "Mario"
      };
      return done(null, testUser);
    }
    return done(null, false);
  });
