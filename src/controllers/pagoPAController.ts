/**
 * This controller handles requests made from the PagoPA backend.
 */

import * as express from "express";
import { fromNullable, isNone, Option, some } from "fp-ts/lib/Option";
import {
  fromEither,
  fromLeft,
  taskEither,
  tryCatch
} from "fp-ts/lib/TaskEither";
import {
  IResponseErrorInternal,
  IResponseErrorNotFound,
  IResponseErrorTooManyRequests,
  IResponseErrorValidation,
  IResponseSuccessJson,
  ResponseErrorInternal,
  ResponseErrorValidation,
  ResponseSuccessJson
} from "@pagopa/ts-commons/lib/responses";
import { EmailString } from "@pagopa/ts-commons/lib/strings";
import { ISessionStorage } from "src/services/ISessionStorage";

import { EmailAddress } from "../../generated/io-api/EmailAddress";
import { PagoPAUser } from "../../generated/pagopa/PagoPAUser";
import ProfileService from "../services/profileService";
import { withUserFromRequest } from "../types/user";

const VALIDATION_ERROR_TITLE = "Validation Error";

export default class PagoPAController {
  constructor(
    private readonly profileService: ProfileService,
    private readonly sessionStorage: ISessionStorage,
    private readonly enableNoticeEmailCache: boolean
  ) {}
  /**
   * Returns the profile for the user identified by the provided fiscal
   * code.
   */
  public readonly getUser = (
    req: express.Request
  ): Promise<
    | IResponseErrorValidation
    | IResponseErrorNotFound
    | IResponseErrorInternal
    | IResponseErrorTooManyRequests
    | IResponseSuccessJson<PagoPAUser>
  > =>
    withUserFromRequest(req, async user => {
      const getProfileAndSaveNoticeEmailCache = tryCatch(
        () => this.profileService.getProfile(user),
        () => new Error("Error getting the profile")
      )
        .foldTaskEither(
          _1 =>
            fromLeft<
              | IResponseErrorInternal
              | IResponseErrorTooManyRequests
              | IResponseErrorNotFound,
              Option<EmailString>
            >(ResponseErrorInternal("Internal server error")),
          response => {
            if (response.kind !== "IResponseSuccessJson") {
              // if getProfile returns a failure, we just return it
              return fromLeft(response);
            }
            // if no validated email is provided into InitializedProfile
            // spid_email will be used for notice email
            const maybeNoticeEmail: EmailAddress | undefined =
              response.value.email && response.value.is_email_validated
                ? response.value.email
                : user.spid_email;
            return taskEither.of(fromNullable(maybeNoticeEmail));
          }
        )
        // Save the value into the redis cache
        .chain(maybeNoticeEmail => {
          if (isNone(maybeNoticeEmail)) {
            return taskEither.of(maybeNoticeEmail as Option<EmailString>);
          }
          return tryCatch(
            () =>
              this.sessionStorage.setPagoPaNoticeEmail(
                user,
                maybeNoticeEmail.value
              ),
            () => new Error("Error caching the notify email value")
          ).foldTaskEither(
            _1 => taskEither.of(maybeNoticeEmail),
            _1 => taskEither.of(maybeNoticeEmail)
          );
        });

      const errorResponseOrNoticeEmail = await (this.enableNoticeEmailCache
        ? tryCatch(
            () => this.sessionStorage.getPagoPaNoticeEmail(user),
            _ => new Error("Error reading the notify email cache")
          )
            .foldTaskEither(_ => fromLeft<Error, EmailString>(_), fromEither)
            .foldTaskEither(
              _ => getProfileAndSaveNoticeEmailCache,
              _ => taskEither.of(some(_))
            )
        : getProfileAndSaveNoticeEmailCache
      ).run();

      if (errorResponseOrNoticeEmail.isLeft()) {
        return errorResponseOrNoticeEmail.value;
      }

      // If no valid notice_email is present a validation error is returned as response
      return PagoPAUser.decode({
        family_name: user.family_name,
        fiscal_code: user.fiscal_code,
        mobile_phone: user.spid_mobile_phone,
        name: user.name,
        notice_email: errorResponseOrNoticeEmail.value.toUndefined(),
        spid_email: user.spid_email
      }).fold<IResponseSuccessJson<PagoPAUser> | IResponseErrorValidation>(
        _ =>
          ResponseErrorValidation(VALIDATION_ERROR_TITLE, "Invalid User Data"),
        ResponseSuccessJson
      );
    });
}
