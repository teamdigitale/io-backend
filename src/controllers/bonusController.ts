/**
 * This controller handles the bonus requests from the
 * app by forwarding the call to the API system.
 */

import * as express from "express";
import {
  IResponseErrorGone,
  IResponseErrorInternal,
  IResponseErrorNotFound,
  IResponseErrorValidation,
  IResponseSuccessAccepted,
  IResponseSuccessJson
} from "@pagopa/ts-commons/lib/responses";

import { BonusActivationWithQrCode } from "generated/bonus/BonusActivationWithQrCode";
import { PaginatedBonusActivationsCollection } from "generated/io-bonus-api/PaginatedBonusActivationsCollection";
import { NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import BonusService from "src/services/bonusService";
import { EligibilityCheck } from "../../generated/io-bonus-api/EligibilityCheck";
import { InstanceId } from "../../generated/io-bonus-api/InstanceId";
import { withUserFromRequest } from "../types/user";
import { withValidatedOrValidationError } from "../utils/responses";

export const withBonusIdFromRequest = async <T>(
  req: express.Request,
  f: (bonusId: NonEmptyString) => Promise<T>
): Promise<IResponseErrorValidation | T> =>
  withValidatedOrValidationError(
    NonEmptyString.decode(req.param("bonus_id")),
    f
  );

export default class BonusController {
  constructor(private readonly bonusService: BonusService) {}

  /**
   * Starts a request for a bonus for the current user.
   * Returns either an error or a reference to the request
   *
   */
  public readonly getBonusEligibilityCheck = (
    req: express.Request
  ): Promise<
    | IResponseErrorValidation
    | IResponseErrorNotFound
    | IResponseErrorInternal
    | IResponseSuccessAccepted
    | IResponseErrorGone
    | IResponseSuccessJson<EligibilityCheck>
  > =>
    withUserFromRequest(req, user =>
      this.bonusService.getBonusEligibilityCheck(user)
    );

  /**
   * Get the activation details for the latest version
   * of the bonus entity identified by the provided id
   *
   */
  public readonly getLatestBonusActivationById = (
    req: express.Request
  ): Promise<
    | IResponseErrorValidation
    | IResponseErrorNotFound
    | IResponseErrorInternal
    | IResponseSuccessAccepted<InstanceId>
    | IResponseSuccessJson<BonusActivationWithQrCode>
  > =>
    withUserFromRequest(req, user =>
      withBonusIdFromRequest(req, bonusId =>
        this.bonusService.getLatestBonusActivationById(user, bonusId)
      )
    );

  /**
   * Get all IDs of the bonus activations requested by
   * the authenticated user or by any between his family member
   */
  public readonly getAllBonusActivations = (
    req: express.Request
  ): Promise<
    | IResponseErrorValidation
    | IResponseErrorInternal
    | IResponseSuccessJson<PaginatedBonusActivationsCollection>
  > =>
    withUserFromRequest(req, user =>
      this.bonusService.getAllBonusActivations(user)
    );
}
