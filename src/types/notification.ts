/**
 * This file contains the CreatedMessageEventSenderMetadata and Notification models.
 */

import * as crypto from "crypto";
import * as t from "io-ts";
import { NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import { tag } from "@pagopa/ts-commons/lib/types";

import { FiscalCode } from "../../generated/backend/FiscalCode";

/**
 * An hashed fiscal code.
 *
 * The fiscal code is used as a tag in the Notification Hub installation,
 * to avoid expose the fiscal code to a third party system we use an hash instead.
 */
interface IFiscalCodeHashTag {
  readonly kind: "IFiscalCodeHashTag";
}

const FiscalCodeHash = tag<IFiscalCodeHashTag>()(NonEmptyString);

type FiscalCodeHash = t.TypeOf<typeof FiscalCodeHash>;

/**
 * Compute the sha256 hash of a string.
 */
export const toFiscalCodeHash = (fiscalCode: FiscalCode): FiscalCodeHash => {
  const hash = crypto.createHash("sha256");
  hash.update(fiscalCode);

  return hash.digest("hex") as FiscalCodeHash;
};
