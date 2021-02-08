/**
 * This service post a notification to the Notification queue.
 */

import {
  IResponseErrorInternal,
  IResponseSuccessJson,
  ResponseErrorInternal,
  ResponseSuccessJson
} from "@pagopa/ts-commons/lib/responses";

import { QueueClient } from "@azure/storage-queue";
import { fromNullable } from "fp-ts/lib/Option";
import { FiscalCode } from "../../generated/backend/FiscalCode";
import { Installation } from "../../generated/backend/Installation";
import {
  CreateOrUpdateInstallationMessage,
  KindEnum as CreateOrUpdateKind
} from "../../generated/messages/CreateOrUpdateInstallationMessage";
import {
  DeleteInstallationMessage,
  KindEnum as DeleteKind
} from "../../generated/messages/DeleteInstallationMessage";
import { NotificationMessageKindEnum } from "../../generated/messages/NotificationMessageKind";
import {
  KindEnum as NotifyKind,
  NotifyMessage
} from "../../generated/messages/NotifyMessage";
import { Notification } from "../../generated/notifications/Notification";
import { SuccessResponse } from "../../generated/notifications/SuccessResponse";

import { toFiscalCodeHash } from "../types/notification";
import { base64EncodeObject } from "../utils/messages";

export default class NotificationService {
  private readonly notificationQueueClient: QueueClient;
  constructor(
    private readonly queueStorageConnectionString: string,
    private readonly queueName: string
  ) {
    this.notificationQueueClient = new QueueClient(
      this.queueStorageConnectionString,
      this.queueName
    );
  }

  public readonly notify = (
    notification: Notification,
    notificationSubject: string,
    notificationTitle?: string
  ): Promise<
    IResponseErrorInternal | IResponseSuccessJson<SuccessResponse>
  > => {
    const notifyMessage: NotifyMessage = {
      installationId: toFiscalCodeHash(notification.message.fiscal_code),
      kind: NotifyKind[NotificationMessageKindEnum.Notify],
      payload: {
        message: notificationSubject,
        message_id: notification.message.id,
        title: fromNullable(notificationTitle).getOrElse(
          `${notification.sender_metadata.service_name} - ${notification.sender_metadata.organization_name}`
        )
      }
    };
    return this.notificationQueueClient
      .sendMessage(base64EncodeObject(notifyMessage))
      .then(() => ResponseSuccessJson({ message: "ok" }))
      .catch(error =>
        ResponseErrorInternal(
          `Error while sending notify message to the queue [${error.message}]`
        )
      );
  };

  public readonly createOrUpdateInstallation = (
    fiscalCode: FiscalCode,
    installation: Installation
  ): Promise<
    IResponseErrorInternal | IResponseSuccessJson<SuccessResponse>
  > => {
    const azureInstallation: CreateOrUpdateInstallationMessage = {
      // When a single active session per user is allowed, the installation that must be created or updated
      // will have an unique installationId referred to that user.
      // The installationId provided by the client is ignored.
      installationId: toFiscalCodeHash(fiscalCode),
      kind:
        CreateOrUpdateKind[
          NotificationMessageKindEnum.CreateOrUpdateInstallation
        ],
      platform: installation.platform,
      pushChannel: installation.pushChannel,
      tags: [toFiscalCodeHash(fiscalCode)]
    };
    return this.notificationQueueClient
      .sendMessage(base64EncodeObject(azureInstallation))
      .then(() => ResponseSuccessJson({ message: "ok" }))
      .catch(error =>
        ResponseErrorInternal(
          `Error while sending create or update installation message to the queue [${error.message}]`
        )
      );
  };

  public readonly deleteInstallation = (
    fiscalCode: FiscalCode
  ): Promise<
    IResponseErrorInternal | IResponseSuccessJson<SuccessResponse>
  > => {
    const deleteMessage: DeleteInstallationMessage = {
      installationId: toFiscalCodeHash(fiscalCode),
      kind: DeleteKind[NotificationMessageKindEnum.DeleteInstallation]
    };
    return this.notificationQueueClient
      .sendMessage(base64EncodeObject(deleteMessage))
      .then(() => ResponseSuccessJson({ message: "ok" }))
      .catch(error =>
        ResponseErrorInternal(
          `Error while sending delete installation message to the queue [${error.message}]`
        )
      );
  };
}
