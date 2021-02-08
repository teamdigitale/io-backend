/**
 * This file contains the ProfileWithEmail and ProfileWithoutEmail models and
 * some functions to validate and convert type to and from them.
 */
import { fromNullable } from "fp-ts/lib/Option";
import {
  IResponseErrorInternal,
  IResponseErrorNotFound,
  IResponseErrorTooManyRequests,
  IResponseSuccessJson,
  ResponseErrorInternal
} from "@pagopa/ts-commons/lib/responses";
import { InitializedProfile } from "../../generated/backend/InitializedProfile";

import { ExtendedProfile } from "../../generated/io-api/ExtendedProfile";

import { formatDate } from "../utils/date";
import { User } from "./user";

/**
 * Converts an existing ExtendedProfile to a Proxy profile.
 */
export const toInitializedProfile = (
  profile: ExtendedProfile,
  user: User
): InitializedProfile => ({
  accepted_tos_version: profile.accepted_tos_version,
  blocked_inbox_or_channels: profile.blocked_inbox_or_channels,
  date_of_birth:
    user.date_of_birth !== undefined
      ? new Date(formatDate(user.date_of_birth))
      : undefined,
  email: profile.email,
  family_name: user.family_name,
  fiscal_code: user.fiscal_code,
  has_profile: true,
  is_email_enabled: fromNullable(profile.is_email_enabled).getOrElse(true),
  is_email_validated: profile.is_email_validated,
  is_inbox_enabled: profile.is_inbox_enabled,
  is_webhook_enabled: profile.is_webhook_enabled,
  name: user.name,
  preferred_languages: profile.preferred_languages,
  spid_email: user.spid_email,
  spid_mobile_phone: user.spid_mobile_phone,
  version: profile.version
});

export const profileMissingErrorResponse = ResponseErrorInternal(
  "Profile Missing"
);

export const notFoundProfileToInternalServerError = (
  getProfileResponse:
    | IResponseErrorInternal
    | IResponseErrorTooManyRequests
    | IResponseErrorNotFound
    | IResponseSuccessJson<InitializedProfile>
) =>
  getProfileResponse.kind === "IResponseErrorNotFound"
    ? profileMissingErrorResponse
    : getProfileResponse;
