/**
 * This controller returns data about the current user session
 */

import * as express from "express";
import {
  IResponseErrorInternal,
  IResponseErrorValidation,
  IResponseSuccessJson,
  ResponseErrorInternal,
  ResponseErrorValidation,
  ResponseSuccessJson
} from "@pagopa/ts-commons/lib/responses";

import { sequenceT } from "fp-ts/lib/Apply";
import { toError } from "fp-ts/lib/Either";
import { identity } from "fp-ts/lib/function";
import { fromEither, taskEither, tryCatch } from "fp-ts/lib/TaskEither";
import { readableReport } from "@pagopa/ts-commons/lib/reporters";
import { FiscalCode } from "@pagopa/ts-commons/lib/strings";
import { SuccessResponse } from "src/types/commons";
import RedisSessionStorage from "../services/redisSessionStorage";
import RedisUserMetadataStorage from "../services/redisUserMetadataStorage";

export default class SessionLockController {
  constructor(
    private readonly sessionStorage: RedisSessionStorage,
    private readonly metadataStorage: RedisUserMetadataStorage
  ) {}

  /**
   * Lock a user account and clear all its session data
   *
   * @param req expects fiscal_code as a path param
   *
   * @returns a promise with the encoded response object
   */
  public readonly lockUserSession = (
    req: express.Request
  ): Promise<
    | IResponseErrorInternal
    | IResponseErrorValidation
    | IResponseSuccessJson<SuccessResponse>
  > =>
    taskEither
      .of<IResponseErrorInternal | IResponseErrorValidation, void>(void 0)
      .chain(_ =>
        fromEither(
          FiscalCode.decode(req.params.fiscal_code).mapLeft(err =>
            ResponseErrorValidation("Invalid fiscal code", readableReport(err))
          )
        )
      )
      .chain(fiscalCode =>
        sequenceT(taskEither)(
          // lock the account
          tryCatch(
            () => this.sessionStorage.setBlockedUser(fiscalCode),
            toError
          ).chain(fromEither),
          // removes all sessions
          tryCatch(
            () => this.sessionStorage.delUserAllSessions(fiscalCode),
            toError
          ).chain(fromEither),
          // removes all metadata
          tryCatch(() => this.metadataStorage.del(fiscalCode), toError).chain(
            fromEither
          )
        ).mapLeft(err => ResponseErrorInternal(err.message))
      )
      .fold<
        | IResponseErrorInternal
        | IResponseErrorValidation
        | IResponseSuccessJson<SuccessResponse>
      >(identity, _ => ResponseSuccessJson({ message: "ok" }))
      .run();

  /**
   * Unlock a user account
   *
   * @param req expects fiscal_code as a path param
   *
   * @returns a promise with the encoded response object
   */
  public readonly unlockUserSession = (
    req: express.Request
  ): Promise<
    | IResponseErrorInternal
    | IResponseErrorValidation
    | IResponseSuccessJson<SuccessResponse>
  > =>
    taskEither
      .of<IResponseErrorInternal | IResponseErrorValidation, void>(void 0)
      // eslint-disable-next-line sonarjs/no-identical-functions
      .chain(_ =>
        fromEither(
          FiscalCode.decode(req.params.fiscal_code).mapLeft(err =>
            ResponseErrorValidation("Invalid fiscal code", readableReport(err))
          )
        )
      )
      .chain(fiscalCode =>
        // unlock the account
        tryCatch(
          () => this.sessionStorage.unsetBlockedUser(fiscalCode),
          toError
        )
          .chain(fromEither)
          .mapLeft(err => ResponseErrorInternal(err.message))
      )
      .fold<
        | IResponseErrorInternal
        | IResponseErrorValidation
        | IResponseSuccessJson<SuccessResponse>
      >(identity, _ => ResponseSuccessJson({ message: "ok" }))
      .run();
}
