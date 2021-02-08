/**
 * This controller returns info used to support logged user
 */

import * as express from "express";
import {
  IResponseErrorInternal,
  IResponseErrorValidation,
  IResponseSuccessJson,
  ResponseErrorInternal,
  ResponseSuccessJson
} from "@pagopa/ts-commons/lib/responses";

import { SupportToken } from "../../generated/backend/SupportToken";
import {
  JWT_SUPPORT_TOKEN_EXPIRATION,
  JWT_SUPPORT_TOKEN_ISSUER,
  JWT_SUPPORT_TOKEN_PRIVATE_RSA_KEY
} from "../../src/config";
import TokenService from "../../src/services/tokenService";
import { withUserFromRequest } from "../types/user";

export default class SupportController {
  constructor(private readonly tokenService: TokenService) {}
  public readonly getSupportToken = (
    req: express.Request
  ): Promise<
    | IResponseErrorInternal
    | IResponseErrorValidation
    | IResponseSuccessJson<SupportToken>
  > =>
    withUserFromRequest(req, async user =>
      this.tokenService
        .getJwtSupportToken(
          JWT_SUPPORT_TOKEN_PRIVATE_RSA_KEY,
          user.fiscal_code,
          JWT_SUPPORT_TOKEN_EXPIRATION,
          JWT_SUPPORT_TOKEN_ISSUER
        )
        .map(token =>
          SupportToken.encode({
            access_token: token,
            expires_in: JWT_SUPPORT_TOKEN_EXPIRATION
          })
        )
        .fold<IResponseErrorInternal | IResponseSuccessJson<SupportToken>>(
          e => ResponseErrorInternal(e.message),
          ResponseSuccessJson
        )
        .run()
    );
}
