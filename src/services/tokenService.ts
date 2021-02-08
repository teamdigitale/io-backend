/**
 * This file contains methods for dealing with session tokens.
 */

import * as crypto from "crypto";
import { promisify } from "util";
import { toError } from "fp-ts/lib/Either";
import { TaskEither, taskify } from "fp-ts/lib/TaskEither";
import { FiscalCode, NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import { Second } from "@pagopa/ts-commons/lib/units";
import * as jwt from "jsonwebtoken";
import { ulid } from "ulid";

const asyncRandomBytes = promisify(crypto.randomBytes);

export default class TokenService {
  /**
   * Generates a new random token.
   */
  public getNewToken(length: number): string {
    // Use the crypto.randomBytes as token.
    return crypto.randomBytes(length).toString("hex");
  }

  /**
   * Generates a new random token.
   */
  public getNewTokenAsync(length: number): Promise<string> {
    // Use the crypto.randomBytes as token.
    return asyncRandomBytes(length).then(_ => _.toString("hex"));
  }

  /**
   * Generates a new support token containing the logged user's fiscalCode.
   *
   * @param privateKey: The RSA's private key used to sign this JWT token
   * @param fiscalCode: The logged user's FiscalCode
   * @param tokenTtl: Token Time To live (expressed in seconds)
   * @param issuer: The Token issuer
   */
  public getJwtSupportToken(
    privateKey: NonEmptyString,
    fiscalCode: FiscalCode,
    tokenTtl: Second,
    issuer: NonEmptyString
  ): TaskEither<Error, string> {
    return taskify<Error, string>(cb =>
      jwt.sign(
        { fiscalCode },
        privateKey,
        {
          algorithm: "RS256",
          expiresIn: `${tokenTtl} seconds`,
          issuer,
          jwtid: ulid()
        },
        cb
      )
    )().mapLeft(toError);
  }
}
