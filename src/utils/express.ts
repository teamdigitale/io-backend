import * as express from "express";
import {
  IResponse,
  ResponseErrorInternal
} from "@pagopa/ts-commons/lib/responses";

/**
 * Convenience method that transforms a function (handler),
 * which takes an express.Request as input and returns an IResponse,
 * into an express controller.
 */
export function toExpressHandler<T, P>(
  handler: (req: express.Request) => Promise<IResponse<T>>,
  object?: P
): (req: express.Request, res: express.Response) => void {
  return (req, res): Promise<void | undefined> =>
    handler
      .call(object, req)
      .catch(ResponseErrorInternal)
      .then(response => {
        // eslint-disable-next-line functional/immutable-data
        res.locals.detail = response.detail;
        response.apply(res);
      });
}

/**
 * An Express handler that always respond with the same response object
 */
export function constantExpressHandler<T>(
  response: IResponse<T>
): (req: express.Request, res: express.Response) => void {
  return (_, res) => {
    // eslint-disable-next-line functional/immutable-data
    res.locals.detail = response.detail;
    response.apply(res);
  };
}
