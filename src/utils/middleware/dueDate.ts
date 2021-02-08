import { NextFunction, Request, Response } from "express";
import { UTCISODateFromString } from "@pagopa/ts-commons/lib/dates";
import { ResponseErrorNotFound } from "@pagopa/ts-commons/lib/responses";
import { log } from "../logger";

/**
 * Due Date Middleware Factory
 * To be applied to endpoint which are available only until a certain date.
 * If the check fails, a 404 Not Found error is returned, meaning the resource is no longer available
 *
 * @param dueDate date until the resource is valid
 */
export function dueDateMiddleware(
  dueDate: Date
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const now = new Date();
    if (now.getTime() > dueDate.getTime()) {
      log.warn(
        `An ${req.method.toUpperCase()} ${
          req.path
        } request has landed at ${UTCISODateFromString.encode(
          now
        )} although it was supposed to expire at ${UTCISODateFromString.encode(
          dueDate
        )}.`
      );
      ResponseErrorNotFound(
        "Expired resource",
        "The resource you asked for is no longer available"
      ).apply(res);
    } else {
      next();
    }
  };
}
