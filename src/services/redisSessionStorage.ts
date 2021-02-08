/**
 * This service uses the Redis client to store and retrieve session information.
 */

import { isArray } from "util";
import { array } from "fp-ts/lib/Array";
import {
  Either,
  isLeft,
  isRight,
  left,
  parseJSON,
  right,
  toError
} from "fp-ts/lib/Either";
import { none, Option, some } from "fp-ts/lib/Option";
import { collect, StrMap } from "fp-ts/lib/StrMap";
import {
  fromEither,
  fromLeft,
  TaskEither,
  taskEither,
  taskify,
  tryCatch
} from "fp-ts/lib/TaskEither";
import { errorsToReadableMessages } from "@pagopa/ts-commons/lib/reporters";
import { EmailString, FiscalCode } from "@pagopa/ts-commons/lib/strings";
import * as redis from "redis";
import { SessionInfo } from "../../generated/backend/SessionInfo";
import { SessionsList } from "../../generated/backend/SessionsList";
import { assertUnreachable } from "../types/commons";
import {
  BPDToken,
  MyPortalToken,
  SessionToken,
  WalletToken
} from "../types/token";
import { User, UserV1, UserV2, UserV3 } from "../types/user";
import { multipleErrorsFormatter } from "../utils/errorsFormatter";
import { log } from "../utils/logger";
import { ISessionStorage } from "./ISessionStorage";
import RedisStorageUtils from "./redisStorageUtils";

const sessionKeyPrefix = "SESSION-";
const walletKeyPrefix = "WALLET-";
const myPortalTokenPrefix = "MYPORTAL-";
const bpdTokenPrefix = "BPD-";
const userSessionsSetKeyPrefix = "USERSESSIONS-";
const sessionInfoKeyPrefix = "SESSIONINFO-";
const noticeEmailPrefix = "NOTICEEMAIL-";
const blockedUserSetKey = "BLOCKEDUSERS";
export const sessionNotFoundError = new Error("Session not found");

export default class RedisSessionStorage extends RedisStorageUtils
  implements ISessionStorage {
  private readonly mgetTask: (
    ...args: ReadonlyArray<string>
  ) => TaskEither<Error, ReadonlyArray<string>>;
  private readonly sismemberTask: (
    ...args: ReadonlyArray<string>
  ) => TaskEither<Error, number>;
  private readonly ttlTask: (key: string) => TaskEither<Error, number>;
  constructor(
    private readonly redisClient: redis.RedisClient,
    private readonly tokenDurationSecs: number
  ) {
    super();
    this.mgetTask = taskify(this.redisClient.mget.bind(this.redisClient));
    this.sismemberTask = taskify(
      this.redisClient.sismember.bind(this.redisClient)
    );
    this.ttlTask = taskify(this.redisClient.ttl.bind(this.redisClient));
  }

  /**
   * {@inheritDoc}
   */
  public async set(
    user: UserV3,
    expireSec: number = this.tokenDurationSecs
  ): Promise<Either<Error, boolean>> {
    const setSessionToken = new Promise<Either<Error, boolean>>(resolve => {
      // Set key to hold the string value. If key already holds a value, it is overwritten, regardless of its type.
      // @see https://redis.io/commands/set
      this.redisClient.set(
        `${sessionKeyPrefix}${user.session_token}`,
        JSON.stringify(user),
        "EX",
        expireSec,
        (err, response) =>
          resolve(
            this.falsyResponseToError(
              this.singleStringReply(err, response),
              new Error("Error setting session token")
            )
          )
      );
    });

    const setWalletToken = new Promise<Either<Error, boolean>>(resolve => {
      // Set key to hold the string value. If key already holds a value, it is overwritten, regardless of its type.
      // @see https://redis.io/commands/set
      this.redisClient.set(
        `${walletKeyPrefix}${user.wallet_token}`,
        user.session_token,
        "EX",
        expireSec,
        (err, response) =>
          resolve(
            this.falsyResponseToError(
              this.singleStringReply(err, response),
              new Error("Error setting wallet token")
            )
          )
      );
    });

    const setMyPortalToken = new Promise<Either<Error, boolean>>(resolve => {
      // Set key to hold the string value. If key already holds a value, it is overwritten, regardless of its type.
      // @see https://redis.io/commands/set
      this.redisClient.set(
        `${myPortalTokenPrefix}${user.myportal_token}`,
        user.session_token,
        "EX",
        expireSec,
        (err, response) =>
          resolve(
            this.falsyResponseToError(
              this.singleStringReply(err, response),
              new Error("Error setting MyPortal token")
            )
          )
      );
    });

    const setBPDToken = new Promise<Either<Error, boolean>>(resolve => {
      // Set key to hold the string value. If key already holds a value, it is overwritten, regardless of its type.
      // @see https://redis.io/commands/set
      this.redisClient.set(
        `${bpdTokenPrefix}${user.bpd_token}`,
        user.session_token,
        "EX",
        expireSec,
        (err, response) =>
          resolve(
            this.falsyResponseToError(
              this.singleStringReply(err, response),
              new Error("Error setting BPD token")
            )
          )
      );
    });

    // If is a session update, the session info key doesn't must be updated.
    // eslint-disable-next-line functional/no-let
    let saveSessionInfoPromise: Promise<Either<
      Error,
      boolean
    >> = Promise.resolve(right(true));
    if (expireSec === this.tokenDurationSecs) {
      const sessionInfo: SessionInfo = {
        createdAt: new Date(),
        sessionToken: user.session_token
      };
      saveSessionInfoPromise = this.saveSessionInfo(
        sessionInfo,
        user.fiscal_code
      );
    }

    const removeOtherUserSessionsPromise = this.removeOtherUserSessions(user);

    const setPromisesResult = await Promise.all([
      setSessionToken,
      setWalletToken,
      setMyPortalToken,
      setBPDToken,
      saveSessionInfoPromise,
      removeOtherUserSessionsPromise
    ]);
    const isSetFailed = setPromisesResult.some(isLeft);
    if (isSetFailed) {
      return left<Error, boolean>(
        multipleErrorsFormatter(
          setPromisesResult.filter(isLeft).map(_ => _.value),
          "RedisSessionStorage.set"
        )
      );
    }
    return right<Error, boolean>(true);
  }

  /**
   * {@inheritDoc}
   */
  public async getBySessionToken(
    token: SessionToken
  ): Promise<Either<Error, Option<User>>> {
    const errorOrSession = await this.loadSessionBySessionToken(token);

    if (isLeft(errorOrSession)) {
      if (errorOrSession.value === sessionNotFoundError) {
        return right(none);
      }
      return left(errorOrSession.value);
    }

    const user = errorOrSession.value;

    return right(some(user));
  }

  /**
   * {@inheritDoc}
   */
  public async getByWalletToken(
    token: WalletToken
  ): Promise<Either<Error, Option<User>>> {
    const errorOrSession = await this.loadSessionByToken(
      walletKeyPrefix,
      token
    );

    if (isLeft(errorOrSession)) {
      if (errorOrSession.value === sessionNotFoundError) {
        return right(none);
      }
      return left(errorOrSession.value);
    }

    const user = errorOrSession.value;

    return right(some(user));
  }

  /**
   * {@inheritDoc}
   */
  public async getByMyPortalToken(
    token: MyPortalToken
  ): Promise<Either<Error, Option<User>>> {
    const errorOrSession = await this.loadSessionByToken(
      myPortalTokenPrefix,
      token
    );

    if (isLeft(errorOrSession)) {
      if (errorOrSession.value === sessionNotFoundError) {
        return right(none);
      }
      return left(errorOrSession.value);
    }

    const user = errorOrSession.value;

    return right(some(user));
  }

  /**
   * {@inheritDoc}
   */
  public async getByBPDToken(
    token: BPDToken
  ): Promise<Either<Error, Option<User>>> {
    const errorOrSession = await this.loadSessionByToken(bpdTokenPrefix, token);

    if (isLeft(errorOrSession)) {
      if (errorOrSession.value === sessionNotFoundError) {
        return right(none);
      }
      return left(errorOrSession.value);
    }

    const user = errorOrSession.value;

    return right(some(user));
  }

  /**
   * {@inheritDoc}
   */
  public async del(user: User): Promise<Either<Error, boolean>> {
    const tokens: ReadonlyArray<string> = collect(
      this.getUserTokens(user),
      (_, { prefix, value }) => `${prefix}${value}`
    );

    const deleteTokensPromise = await new Promise<Either<Error, true>>(
      resolve => {
        // Remove the specified key. A key is ignored if it does not exist.
        // @see https://redis.io/commands/del
        this.redisClient.del(...tokens, (err, response) =>
          resolve(
            this.falsyResponseToError(
              this.integerReply(err, response, tokens.length),
              new Error(
                "Unexpected response from redis client deleting user tokens."
              )
            )
          )
        );
      }
    );

    if (isLeft(deleteTokensPromise)) {
      return left<Error, boolean>(
        new Error(
          `value [${deleteTokensPromise.value.message}] at RedisSessionStorage.del`
        )
      );
    }

    // Remove SESSIONINFO reference from USERSESSIONS Set
    // this operation is executed in background and doesn't compromise
    // the logout process.
    this.redisClient.srem(
      `${userSessionsSetKeyPrefix}${user.fiscal_code}`,
      `${sessionInfoKeyPrefix}${user.session_token}`,
      (err, _) => {
        if (err) {
          log.warn(`Error updating USERSESSIONS Set for ${user.fiscal_code}`);
        }
      }
    );
    return right<Error, boolean>(true);
  }

  public async listUserSessions(
    user: User
  ): Promise<Either<Error, SessionsList>> {
    // If some user session was expired we update the USERSESSION Redis set.
    await this.clearExpiredSetValues(user.fiscal_code);

    const sessionKeys = await this.readSessionInfoKeys(user.fiscal_code);
    // eslint-disable-next-line functional/prefer-readonly-type
    const initializedSessionKeys: string[] = [];
    if (isLeft(sessionKeys) && sessionKeys.value !== sessionNotFoundError) {
      return left(sessionKeys.value);
    } else if (isLeft(sessionKeys)) {
      const sessionInfo: SessionInfo = {
        createdAt: new Date(),
        sessionToken: user.session_token
      };
      const refreshUserSessionInfo = await this.saveSessionInfo(
        sessionInfo,
        user.fiscal_code
      );
      if (isLeft(refreshUserSessionInfo)) {
        return left(sessionNotFoundError);
      }
      // eslint-disable-next-line functional/immutable-data
      initializedSessionKeys.push(
        `${sessionInfoKeyPrefix}${user.session_token}`
      );
    }
    return this.mgetTask(...sessionKeys.getOrElse(initializedSessionKeys))
      .map(_ => this.parseUserSessionList(_))
      .run();
  }

  /**
   * Remove expired `SESSIONINFO` value from the `USERSESSION` redis set.
   *
   * @param fiscalCode
   */
  public async clearExpiredSetValues(
    fiscalCode: string
  ): Promise<ReadonlyArray<Either<Error, boolean>>> {
    const userSessionSetKey = `${userSessionsSetKeyPrefix}${fiscalCode}`;
    const keys = await new Promise<ReadonlyArray<string>>(resolve => {
      this.redisClient.smembers(userSessionSetKey, (err, response) => {
        if (err) {
          log.error("Error reading set members: %s", err);
          return resolve([]);
        }
        resolve(response);
      });
    });
    const activeKeys = await Promise.all(
      keys.map(
        _ =>
          new Promise<Either<string, string>>(resolve => {
            this.redisClient.exists(_, (err, response) => {
              if (err || !response) {
                return resolve(left(_));
              }
              return resolve(right(_));
            });
          })
      )
    );
    return await Promise.all(
      activeKeys.filter(isLeft).map(
        _ =>
          new Promise<Either<Error, boolean>>(resolve => {
            this.redisClient.srem(userSessionSetKey, _.value, (err, response) =>
              resolve(this.integerReply(err, response))
            );
          })
      )
    );
  }

  public async userHasActiveSessions(
    fiscalCode: FiscalCode
  ): Promise<Either<Error, boolean>> {
    const sessionKeys = await this.readSessionInfoKeys(fiscalCode);
    if (sessionKeys.value === sessionNotFoundError) {
      return right(false);
    } else if (isLeft(sessionKeys)) {
      return left(sessionKeys.value);
    }
    const errorOrSessionTokens = await this.mgetTask(...sessionKeys.value)
      .map(_ =>
        this.parseUserSessionList(_).sessions.map(__ => __.sessionToken)
      )
      .run();

    if (errorOrSessionTokens.isLeft()) {
      return left(errorOrSessionTokens.value);
    } else if (errorOrSessionTokens.value.length === 0) {
      return right(false);
    }

    return this.mgetTask(...errorOrSessionTokens.value)
      .map(_ => _.length > 0)
      .run();
  }

  /**
   * Insert a user in the list of blocked account
   *
   * @param fiscalCode id of the user
   *
   * @returns a promise with either an error or true
   */
  public setBlockedUser(fiscalCode: FiscalCode): Promise<Either<Error, true>> {
    return new Promise<Either<Error, true>>(resolve => {
      log.info(`Adding ${fiscalCode} to ${blockedUserSetKey} set`);
      this.redisClient.sadd(blockedUserSetKey, fiscalCode, err =>
        resolve(err ? left(err) : right(true))
      );
    });
  }

  /**
   * Remove a user from the list of blocked account
   *
   * @param fiscalCode id of the user
   *
   * @returns a promise with either an error or true
   */
  public unsetBlockedUser(
    fiscalCode: FiscalCode
  ): Promise<Either<Error, boolean>> {
    return new Promise<Either<Error, boolean>>(resolve => {
      log.info(`Removing ${fiscalCode} from ${blockedUserSetKey} set`);
      this.redisClient.srem(blockedUserSetKey, fiscalCode, (err, response) =>
        resolve(
          this.falsyResponseToError(
            this.integerReply(err, response, 1),
            new Error(
              "Unexpected response from redis client deleting blockedUserKey"
            )
          )
        )
      );
    });
  }

  /**
   * Check if a user is blocked
   *
   * @param fiscalCode id of the user
   *
   * @returns a promise with either an error or a boolean indicating if the user is blocked
   */
  public async isBlockedUser(
    fiscalCode: FiscalCode
  ): Promise<Either<Error, boolean>> {
    return this.sismemberTask(blockedUserSetKey, fiscalCode)
      .bimap(
        err => new Error(`Error accessing blocked users collection: ${err}`),
        result => result === 1
      )
      .run();
  }

  /**
   * Delete all user session data
   *
   * @param fiscalCode
   */
  public async delUserAllSessions(
    fiscalCode: FiscalCode
  ): Promise<Either<Error, boolean>> {
    const errorOrSessions = await this.readSessionInfoKeys(fiscalCode);

    const delEverySession = (
      sessionTokens: ReadonlyArray<SessionToken>
    ): TaskEither<Error, boolean> =>
      array
        .sequence(taskEither)<Error, boolean>(
          sessionTokens.map(sessionToken =>
            fromEither<Error, SessionToken>(
              SessionToken.decode(sessionToken).mapLeft(
                _ => new Error("Error decoding token")
              )
            ).chain<boolean>((token: SessionToken) =>
              tryCatch(() => this.delSingleSession(token), toError).chain(
                fromEither
              )
            )
          )
        )
        .map(() => true);

    return fromEither(errorOrSessions)
      .foldTaskEither<Error, boolean>(
        // as we're deleting stuff, a NotFound error can be considered as a success
        _ => (_ === sessionNotFoundError ? taskEither.of(true) : fromLeft(_)),
        sessionInfoKeys =>
          delEverySession(
            sessionInfoKeys.map(
              sessionInfoKey =>
                sessionInfoKey.replace(sessionInfoKeyPrefix, "") as SessionToken
            )
          )
      )
      .chain(_ =>
        tryCatch(() => this.delSessionsSet(fiscalCode), toError).chain(
          fromEither
        )
      )
      .run();
  }

  /**
   * Update an user session keeping the current session TTL
   *
   * @param updatedUser
   */
  public async update(updatedUser: UserV3): Promise<Either<Error, boolean>> {
    const errorOrSessionTtl = await this.getSessionTtl(
      updatedUser.session_token
    );

    if (isLeft(errorOrSessionTtl)) {
      return left(
        new Error(
          `Error retrieving user session ttl [${errorOrSessionTtl.value.message}]`
        )
      );
    }
    const sessionTtl = errorOrSessionTtl.value;
    if (sessionTtl < 0) {
      throw new Error(`Unexpected session TTL value [${sessionTtl}]`);
    }

    const errorOrIsSessionUpdated = await this.set(updatedUser, sessionTtl);
    if (isLeft(errorOrIsSessionUpdated)) {
      return left(
        new Error(
          `Error updating user session [${errorOrIsSessionUpdated.value.message}]`
        )
      );
    }
    return right(true);
  }

  /**
   * Cache on redis the notify email for pagopa
   */
  public async setPagoPaNoticeEmail(
    user: User,
    NoticeEmail: EmailString
  ): Promise<Either<Error, boolean>> {
    const errorOrSessionTtl = await this.getSessionTtl(user.session_token);

    if (isLeft(errorOrSessionTtl)) {
      return left(
        new Error(
          `Error retrieving user session ttl [${errorOrSessionTtl.value.message}]`
        )
      );
    }
    const sessionTtl = errorOrSessionTtl.value;
    if (sessionTtl < 0) {
      throw new Error(`Unexpected session TTL value [${sessionTtl}]`);
    }

    return new Promise<Either<Error, boolean>>(resolve => {
      this.redisClient.set(
        `${noticeEmailPrefix}${user.session_token}`,
        NoticeEmail,
        "EX",
        sessionTtl,
        // eslint-disable-next-line sonarjs/no-identical-functions
        (err, response) =>
          resolve(
            this.falsyResponseToError(
              this.singleStringReply(err, response),
              new Error("Error setting session token")
            )
          )
      );
    });
  }

  /**
   * Delete notify email cache related to an user
   */
  public async delPagoPaNoticeEmail(user: User): Promise<Either<Error, true>> {
    return new Promise<Either<Error, true>>(resolve => {
      log.info(
        `Deleting cashed notify email ${noticeEmailPrefix}${user.fiscal_code}`
      );
      this.redisClient.del(`${noticeEmailPrefix}${user.session_token}`, err =>
        resolve(err ? left(err) : right(true))
      );
    });
  }

  /**
   * Get the notify email value from cache
   */
  public async getPagoPaNoticeEmail(
    user: User
  ): Promise<Either<Error, EmailString>> {
    return new Promise<Either<Error, EmailString>>(resolve => {
      this.redisClient.get(
        `${noticeEmailPrefix}${user.session_token}`,
        (err, value) => {
          if (err) {
            // Client returns an error.
            return resolve(left<Error, EmailString>(err));
          }

          if (value === null) {
            return resolve(
              left<Error, EmailString>(
                new Error("Notify email value not found")
              )
            );
          }
          const errorOrNoticeEmail = EmailString.decode(value).mapLeft(
            validationErrors =>
              new Error(errorsToReadableMessages(validationErrors).join("/"))
          );
          return resolve(errorOrNoticeEmail);
        }
      );
    });
  }

  /**
   * Return the session token remaining time to live in seconds
   *
   * @param token
   */
  private async getSessionTtl(
    token: SessionToken
  ): Promise<Either<Error, number>> {
    // Returns the key ttl in seconds
    // -2 if the key doesn't exist or -1 if the key has no expire
    // @see https://redis.io/commands/ttl
    return this.ttlTask(`${sessionKeyPrefix}${token}`).run();
  }

  /**
   * Given a token, it removes user session token and wallet token
   *
   * @param token
   */
  private async delSingleSession(
    token: SessionToken
  ): Promise<Either<Error, boolean>> {
    try {
      const errorOrUser = await this.loadSessionBySessionToken(token);
      const user: User = errorOrUser.getOrElseL(err => {
        throw err;
      });
      return this.del(user);
    } catch (error) {
      // as it's a delete, if the query fails for a NotFoudn error, it might be considered a success
      return error === sessionNotFoundError
        ? right<Error, boolean>(true)
        : left(error);
    }
  }

  private delSessionsSet(fiscalCode: FiscalCode): Promise<Either<Error, true>> {
    return new Promise<Either<Error, true>>(resolve => {
      log.info(
        `Deleting sessions set ${userSessionsSetKeyPrefix}${fiscalCode}`
      );
      this.redisClient.del(`${userSessionsSetKeyPrefix}${fiscalCode}`, err =>
        resolve(err ? left(err) : right(true))
      );
    });
  }

  /*
   * Store session info and update session info set.
   * The returned promise will reject if either operation fail.
   * update session info set
   */
  private saveSessionInfo(
    sessionInfo: SessionInfo,
    fiscalCode: FiscalCode
  ): Promise<Either<Error, boolean>> {
    const sessionInfoKey = `${sessionInfoKeyPrefix}${sessionInfo.sessionToken}`;
    return new Promise<Either<Error, boolean>>(resolve => {
      this.redisClient.set(
        sessionInfoKey,
        JSON.stringify(sessionInfo),
        "EX",
        this.tokenDurationSecs,
        (err, response) => {
          const saveSessionInfoResult = this.falsyResponseToError(
            this.singleStringReply(err, response),
            new Error("Error setting user token info")
          );
          if (isLeft(saveSessionInfoResult)) {
            return resolve(saveSessionInfoResult);
          }
          this.redisClient.sadd(
            `${userSessionsSetKeyPrefix}${fiscalCode}`,
            sessionInfoKey,
            (infoSetUpdateErr, infoSetUpdateRes) =>
              resolve(
                this.falsyResponseToError(
                  this.integerReply(infoSetUpdateErr, infoSetUpdateRes),
                  new Error("Error updating user tokens info set")
                )
              )
          );
        }
      );
    });
  }

  /**
   * Return a Session for this token.
   */
  private async loadSessionBySessionToken(
    token: SessionToken
  ): Promise<Either<Error, User>> {
    return new Promise(resolve => {
      this.redisClient.get(`${sessionKeyPrefix}${token}`, (err, value) => {
        if (err) {
          // Client returns an error.
          return resolve(left<Error, User>(err));
        }

        if (value === null) {
          return resolve(left<Error, User>(sessionNotFoundError));
        }
        const errorOrDeserializedUser = this.parseUser(value);
        return resolve(errorOrDeserializedUser);
      });
    });
  }

  /**
   * Return a Session for this token.
   */
  private loadSessionByToken(
    prefix: string,
    token: WalletToken | MyPortalToken | BPDToken
  ): Promise<Either<Error, User>> {
    return new Promise(resolve => {
      this.redisClient.get(`${prefix}${token}`, (err, value) => {
        if (err) {
          // Client returns an error.
          return resolve(left<Error, User>(err));
        }

        if (value === null) {
          return resolve(left<Error, User>(sessionNotFoundError));
        }

        this.loadSessionBySessionToken(value as SessionToken).then(
          (errorOrSession: Either<Error, User>) => {
            errorOrSession.fold(
              error => resolve(left<Error, User>(error)),
              session => {
                resolve(right<Error, User>(session));
              }
            );
          },
          error => {
            resolve(left<Error, User>(error));
          }
        );
      });
    });
  }

  /**
   * Remove other user sessions and wallet tokens
   */
  private async removeOtherUserSessions(
    user: UserV3
  ): Promise<Either<Error, boolean>> {
    const errorOrSessionInfoKeys = await this.readSessionInfoKeys(
      user.fiscal_code
    );
    if (isRight(errorOrSessionInfoKeys)) {
      const oldSessionInfoKeys = errorOrSessionInfoKeys.value.filter(
        _ =>
          _.startsWith(sessionInfoKeyPrefix) &&
          _ !== `${sessionInfoKeyPrefix}${user.session_token}`
      );
      // Generate old session keys list from session info keys list
      // transforming pattern SESSIONINFO-token into pattern SESSION-token with token as the same value
      const oldSessionKeys = oldSessionInfoKeys.map(
        _ => `${sessionKeyPrefix}${_.split(sessionInfoKeyPrefix)[1]}`
      );

      // Retrieve all user data related to session tokens.
      // All the tokens are stored inside user payload.
      const errorOrSerializedUser = await new Promise<
        Either<Error, ReadonlyArray<string>>
      >(resolve => {
        this.redisClient.mget(...oldSessionKeys, (err, response) =>
          resolve(this.arrayStringReply(err, response))
        );
      });
      // Deserialize all available user payloads and skip invalid one
      const errorOrDeserializedUsers = errorOrSerializedUser.map(_ =>
        _.map(this.parseUser)
          .filter(isRight)
          .map(deserializedUser => deserializedUser.value)
      );

      // Extract all tokens inside the user payload
      // If the value is invalid or must be skipped, it will be mapped with none
      const externalTokens = errorOrDeserializedUsers.fold(
        _ => [],
        _ =>
          _.map(deserializedUser =>
            collect(
              this.getUserTokens(deserializedUser).filter(
                p =>
                  !(
                    p.prefix === sessionInfoKeyPrefix ||
                    p.prefix === sessionKeyPrefix
                  ) &&
                  !(
                    p.prefix === walletKeyPrefix &&
                    p.value === user.wallet_token
                  ) &&
                  !(
                    p.prefix === myPortalTokenPrefix &&
                    p.value === user.myportal_token
                  ) &&
                  !(p.prefix === bpdTokenPrefix && p.value === user.bpd_token)
              ),
              (_1, { prefix, value }) => `${prefix}${value}`
            )
          ).reduce((prev, tokens) => [...prev, ...tokens], [])
      );

      // Delete all active tokens that are different
      // from the new one generated and provided inside user object.
      const deleteOldKeysResponse = await new Promise<Either<Error, boolean>>(
        resolve => {
          const keys: ReadonlyArray<string> = [
            ...oldSessionInfoKeys,
            ...oldSessionKeys,
            ...externalTokens
          ];
          if (keys.length === 0) {
            return resolve(right(true));
          }
          this.redisClient.del(...keys, (err, response) =>
            resolve(this.integerReply(err, response))
          );
        }
      );
      await this.clearExpiredSetValues(user.fiscal_code);
      return deleteOldKeysResponse;
    }
    return errorOrSessionInfoKeys.value === sessionNotFoundError
      ? right(true)
      : left(errorOrSessionInfoKeys.value);
  }

  private readSessionInfoKeys(
    fiscalCode: FiscalCode
  ): Promise<Either<Error, ReadonlyArray<string>>> {
    return new Promise<Either<Error, ReadonlyArray<string>>>(resolve => {
      this.redisClient.smembers(
        `${userSessionsSetKeyPrefix}${fiscalCode}`,
        (err, response) => resolve(this.arrayStringReply(err, response))
      );
    });
  }

  private arrayStringReply(
    err: Error | null,
    replay: ReadonlyArray<string> | undefined
  ): Either<Error, ReadonlyArray<string>> {
    if (err) {
      return left(err);
    } else if (!isArray(replay) || replay.length === 0) {
      return left(sessionNotFoundError);
    }
    return right(replay);
  }

  private parseUser(value: string): Either<Error, User> {
    return parseJSON<Error>(value, toError).chain(data =>
      User.decode(data).mapLeft(
        err => new Error(errorsToReadableMessages(err).join("/"))
      )
    );
  }

  private parseUserSessionList(
    userSessionTokensResult: ReadonlyArray<string>
  ): SessionsList {
    return userSessionTokensResult.reduce(
      (prev: SessionsList, _) =>
        parseJSON<Error>(_, toError)
          .chain(data =>
            SessionInfo.decode(data).mapLeft(
              err => new Error(errorsToReadableMessages(err).join("/"))
            )
          )
          .fold(
            err => {
              log.warn("Unable to decode the session info: %s. Skipped.", err);
              return prev;
            },
            sessionInfo => ({
              sessions: [...prev.sessions, sessionInfo]
            })
          ),
      { sessions: [] } as SessionsList
    );
  }

  private getUserTokens(
    user: User
  ): StrMap<{ readonly prefix: string; readonly value: string }> {
    const requiredTokens = {
      session_info: {
        prefix: sessionInfoKeyPrefix,
        value: user.session_token
      },
      session_token: {
        prefix: sessionKeyPrefix,
        value: user.session_token
      },
      wallet_token: {
        prefix: walletKeyPrefix,
        value: user.wallet_token
      }
    };
    if (UserV3.is(user)) {
      return new StrMap({
        ...requiredTokens,
        bpd_token: {
          prefix: bpdTokenPrefix,
          value: user.bpd_token
        },
        myportal_token: {
          prefix: myPortalTokenPrefix,
          value: user.myportal_token
        }
      });
    }
    if (UserV2.is(user)) {
      return new StrMap({
        ...requiredTokens,
        myportal_token: {
          prefix: myPortalTokenPrefix,
          value: user.myportal_token
        }
      });
    }
    if (UserV1.is(user)) {
      return new StrMap({
        ...requiredTokens
      });
    }
    return assertUnreachable(user);
  }
}
