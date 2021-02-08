import { Either } from "fp-ts/lib/Either";
import { array, Errors } from "io-ts";
import { CIDR } from "@pagopa/ts-commons/lib/strings";

/**
 * Parse a comma separated string of CIDR(s) or IP(s) into an array
 */
export function decodeCIDRs(
  cidrs?: string
): Either<Errors, ReadonlyArray<CIDR>> {
  return array(CIDR).decode(
    cidrs
      // may be a comma separated list of CIDR(s) or IP(s)
      ?.split(",")
      .map(c => c.trim())
      // if we read a plain IP then append '/32'
      .map(c => (c.indexOf("/") !== -1 ? c : c + "/32"))
  );
}
