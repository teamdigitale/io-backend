import * as express from "express";
import * as t from "io-ts";
import { errorsToReadableMessages } from "@pagopa/ts-commons/lib/reporters";
import {
  HttpStatusCodeEnum,
  IResponse,
  IResponseErrorInternal,
  IResponseErrorValidation,
  ResponseErrorGeneric,
  ResponseErrorInternal,
  ResponseErrorNotFound,
  ResponseErrorValidation
} from "@pagopa/ts-commons/lib/responses";

/**
 * Interface for a no content response returning a empty object.
 */
export interface IResponseNoContent extends IResponse<"IResponseNoContent"> {
  // eslint-disable-next-line @typescript-eslint/ban-types
  readonly value: {};
}
/**
 * Returns a no content json response.
 */
export function ResponseNoContent(): IResponseNoContent {
  return {
    apply: (res: express.Response): unknown => res.status(204).json({}),
    kind: "IResponseNoContent",
    value: {}
  };
}

/**
 * A response error for when a feature has been dismissed.
 */
export const ResponseErrorDismissed = ResponseErrorNotFound(
  "Expired resource",
  "The resource you asked for is no longer available"
);

/**
 * Transforms async failures into internal errors
 */
export const withCatchAsInternalError = <T>(
  f: () => Promise<T>,
  message: string = "Exception while calling upstream API (likely a timeout)."
): Promise<T | IResponseErrorInternal> =>
  f().catch(_ => {
    // eslint-disable-next-line no-console
    console.error(_);
    return ResponseErrorInternal(`${message} [${_}]`);
  });

export const unhandledResponseStatus = (
  status: number
): IResponseErrorInternal =>
  ResponseErrorInternal(`unhandled API response status [${status}]`);

/**
 * Calls the provided function with the valid response, or else returns an
 * IResponseErrorInternal with the validation errors.
 */
export const withValidatedOrInternalError = <T, U>(
  validated: t.Validation<T>,
  f: (p: T) => U
): U | IResponseErrorInternal =>
  validated.isLeft()
    ? ResponseErrorInternal(
        errorsToReadableMessages(validated.value).join(" / ")
      )
    : f(validated.value);

/**
 * Calls the provided function with the valid response, or else returns an
 * IResponseErrorValidation with the validation errors.
 */
export const withValidatedOrValidationError = <T, U>(
  response: t.Validation<T>,
  f: (p: T) => U
): U | IResponseErrorValidation =>
  response.isLeft()
    ? ResponseErrorValidation(
        "Bad request",
        errorsToReadableMessages(response.value).join(" / ")
      )
    : f(response.value);

/**
 * Interface for unauthorized error response.
 */
export interface IResponseErrorUnauthorizedForLegalReasons
  extends IResponse<"IResponseErrorUnauthorizedForLegalReasons"> {
  readonly detail: string;
}
/**
 * Returns an unauthorized error response with status code 451.
 */
export function ResponseErrorUnauthorizedForLegalReasons(
  title: string,
  detail: string
): IResponseErrorUnauthorizedForLegalReasons {
  return {
    ...ResponseErrorGeneric(HttpStatusCodeEnum.HTTP_STATUS_451, title, detail),
    ...{
      detail: `${title}: ${detail}`,
      kind: "IResponseErrorUnauthorizedForLegalReasons"
    }
  };
}

export const ResponseErrorStatusNotDefinedInSpec = (response: never) =>
  // This case should not happen, so response is of type never.
  // However, the underlying api may not follow the specs so we might trace the unhandled status
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unhandledResponseStatus((response as any).status);

export const ResponseErrorUnexpectedAuthProblem = () =>
  // This case can only happen because of misconfiguration, thus it might be considered an error
  ResponseErrorInternal("Underlying API fails with an unexpected 401");
