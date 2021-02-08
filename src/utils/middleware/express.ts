import { NextFunction, Request, Response } from "express";
import { ResponseErrorInternal } from "@pagopa/ts-commons/lib/responses";
import { log } from "../logger";

/**
 * Error Handler method for Express Application.
 * Catch an express error and returns a ResponseErrorInternal response
 *
 * @ref https://expressjs.com/en/guide/error-handling.htmls
 */
export function expressErrorMiddleware(
  err: Error,
  _: Request,
  res: Response,
  __: NextFunction
): void {
  log.error("An exception occurred during http request: %s", err.message);
  // Send a ResponseErrorInternal only if a response was not already sent to the client
  if (!res.headersSent) {
    ResponseErrorInternal(err.message).apply(res);
  }
}
