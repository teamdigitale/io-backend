/**
 * An Express middleware that checks if source IP falls into a CIDR range.
 */

import * as express from "express";
import { isLeft } from "fp-ts/lib/Either";
import { readableReport } from "@pagopa/ts-commons/lib/reporters";
import { CIDR, IPString } from "@pagopa/ts-commons/lib/strings";
import * as rangeCheck from "range_check";
import { log } from "../logger";

export default function checkIP(
  range: ReadonlyArray<CIDR>
): (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => void {
  return (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ): void => {
    // when the boolean flag "trust proxy" is enabled
    // express takes this from the leftmost value
    // contained in the x-forwarded-for header
    const errorOrIPString = IPString.decode(req.ip).alt(
      // use x-client-ip instead of x-forwarded-for
      // for internal calls (same vnet)
      IPString.decode(req.headers["x-client-ip"])
    );

    if (isLeft(errorOrIPString)) {
      log.error(
        `Cannot decode source IP: (req.ip=${req.ip},x-client-ip=${
          req.headers["x-client-ip"]
        },error=${readableReport(errorOrIPString.value)}.`
      );
      res.status(400).send("Bad request");
    } else {
      const IP = errorOrIPString.value;
      if (!rangeCheck.inRange(IP, Array.from(range))) {
        log.error(`Blocked source IP ${IP}.`);
        res.status(401).send("Unauthorized");
      } else {
        next();
      }
    }
  };
}
