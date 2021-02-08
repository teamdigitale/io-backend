/**
 * This controller returns data about the current user session
 */

import * as express from "express";
import {
  IResponseErrorInternal,
  IResponseErrorValidation,
  IResponseSuccessJson,
  ResponseErrorInternal,
  ResponseSuccessJson
} from "@pagopa/ts-commons/lib/responses";

import { isLeft } from "fp-ts/lib/Either";
import TokenService from "src/services/tokenService";
import { BPDToken, MyPortalToken } from "src/types/token";
import { SessionsList } from "../../generated/backend/SessionsList";
import { PublicSession } from "../../generated/backend/PublicSession";
import RedisSessionStorage from "../services/redisSessionStorage";
import { UserV2, UserV3, withUserFromRequest } from "../types/user";

import { log } from "../utils/logger";
import { SESSION_TOKEN_LENGTH_BYTES } from "./authenticationController";

export default class SessionController {
  constructor(
    private readonly sessionStorage: RedisSessionStorage,
    private readonly tokenService: TokenService
  ) {}
  public readonly getSessionState = (
    req: express.Request
  ): Promise<
    | IResponseErrorInternal
    | IResponseErrorValidation
    | IResponseSuccessJson<PublicSession>
  > =>
    withUserFromRequest(req, async user => {
      if (UserV3.is(user)) {
        // All required tokens are present on the current session, no update is required
        return ResponseSuccessJson({
          bpdToken: user.bpd_token,
          myPortalToken: user.myportal_token,
          spidLevel: user.spid_level,
          walletToken: user.wallet_token
        });
      }

      // If the myportal_token or bpd_token are missing into the user session,
      // new tokens are generated and the session is updated
      const bpdToken = this.tokenService.getNewToken(
        SESSION_TOKEN_LENGTH_BYTES
      ) as BPDToken;
      const updatedUser: UserV3 = {
        ...user,
        bpd_token: bpdToken,
        myportal_token: UserV2.is(user)
          ? user.myportal_token
          : (this.tokenService.getNewToken(
              SESSION_TOKEN_LENGTH_BYTES
            ) as MyPortalToken)
      };

      return (await this.sessionStorage.update(updatedUser)).fold<
        IResponseErrorInternal | IResponseSuccessJson<PublicSession>
      >(
        err => {
          log.error(`getSessionState: ${err.message}`);
          return ResponseErrorInternal(
            `Error updating user session [${err.message}]`
          );
        },
        _ =>
          ResponseSuccessJson({
            bpdToken: updatedUser.bpd_token,
            myPortalToken: updatedUser.myportal_token,
            spidLevel: updatedUser.spid_level,
            walletToken: updatedUser.wallet_token
          })
      );
    });

  public readonly listSessions = (
    req: express.Request
  ): Promise<
    | IResponseErrorInternal
    | IResponseErrorValidation
    | IResponseSuccessJson<SessionsList>
  > =>
    withUserFromRequest(req, async user => {
      const sessionsList = await this.sessionStorage.listUserSessions(user);
      if (isLeft(sessionsList)) {
        return ResponseErrorInternal(sessionsList.value.message);
      }
      if (sessionsList.value.sessions.length === 0) {
        return ResponseErrorInternal("No valid sessions found for the user");
      }
      return ResponseSuccessJson<SessionsList>(sessionsList.value);
    });
}
