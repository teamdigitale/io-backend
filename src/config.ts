/**
 * Defines services and register them to the Service Container.
 */

import * as dotenv from "dotenv";
import { parseJSON, right, toError } from "fp-ts/lib/Either";
import { fromNullable, isSome } from "fp-ts/lib/Option";
import * as t from "io-ts";
import { agent } from "italia-ts-commons";

import {
  getNodeEnvironmentFromProcessEnv,
  NodeEnvironmentEnum
} from "italia-ts-commons/lib/environment";
import {
  errorsToReadableMessages,
  readableReport
} from "italia-ts-commons/lib/reporters";
import { UrlFromString } from "italia-ts-commons/lib/url";

import {
  IApplicationConfig,
  IServiceProviderConfig,
  SamlConfig
} from "@pagopa/io-spid-commons";

import { rights } from "fp-ts/lib/Array";
import {
  AbortableFetch,
  setFetchTimeout,
  toFetch
} from "italia-ts-commons/lib/fetch";
import { IntegerFromString } from "italia-ts-commons/lib/numbers";
import { NonEmptyString } from "italia-ts-commons/lib/strings";
import { FiscalCode } from "italia-ts-commons/lib/strings";
import { Millisecond, Second } from "italia-ts-commons/lib/units";
import { CgnAPIClient } from "./clients/cgn";
import { log } from "./utils/logger";
import urlTokenStrategy from "./strategies/urlTokenStrategy";
import { getRequiredENVVar, readFile } from "./utils/container";
import PagoPAClientFactory from "./services/pagoPAClientFactory";
import ApiClientFactory from "./services/apiClientFactory";
import { BonusAPIClient } from "./clients/bonus";
import { STRINGS_RECORD } from "./types/commons";
import { SpidLevelArray } from "./types/spidLevel";
import { decodeCIDRs } from "./utils/cidrs";

// Without this, the environment variables loaded by dotenv aren't available in
// this file.
dotenv.config();

// Server port.
log.info(`App service assigned port ${process.env.PORT}`);
const DEFAULT_SERVER_PORT = "80";
export const SERVER_PORT = process.env.PORT || DEFAULT_SERVER_PORT;

export const ENV = getNodeEnvironmentFromProcessEnv(process.env);

// Default cache control max-age value is 5 minutes
const DEFAULT_CACHE_MAX_AGE_SECONDS: string = "300";

// Resolve cache control default max-age value
export const CACHE_MAX_AGE_SECONDS: number = parseInt(
  process.env.CACHE_MAX_AGE_SECONDS || DEFAULT_CACHE_MAX_AGE_SECONDS,
  10
);

export const ENABLE_NOTICE_EMAIL_CACHE: boolean = fromNullable(
  process.env.ENABLE_NOTICE_EMAIL_CACHE
)
  .map(_ => _.toLowerCase() === "true")
  .getOrElse(false);

// Private key used in SAML authentication to a SPID IDP.
const samlKey = () =>
  fromNullable(process.env.SAML_KEY).getOrElseL(() =>
    readFile(process.env.SAML_KEY_PATH || "./certs/key.pem", "SAML private key")
  );
export const SAML_KEY = samlKey();

// Public certificate used in SAML authentication to a SPID IDP.
const samlCert = () =>
  fromNullable(process.env.SAML_CERT).getOrElseL(() =>
    readFile(
      process.env.SAML_CERT_PATH || "./certs/cert.pem",
      "SAML certificate"
    )
  );

export const SAML_CERT = samlCert();

// SAML settings.
const SAML_CALLBACK_URL =
  process.env.SAML_CALLBACK_URL ||
  "http://italia-backend/assertionConsumerService";
const SAML_LOGOUT_CALLBACK_URL =
  process.env.SAML_LOGOUT_CALLBACK_URL || "http://italia-backend/slo";
const SAML_ISSUER = process.env.SAML_ISSUER || "https://spid.agid.gov.it/cd";
const DEFAULT_SAML_ATTRIBUTE_CONSUMING_SERVICE_INDEX = "1";
const SAML_ATTRIBUTE_CONSUMING_SERVICE_INDEX =
  process.env.SAML_ATTRIBUTE_CONSUMING_SERVICE_INDEX ||
  DEFAULT_SAML_ATTRIBUTE_CONSUMING_SERVICE_INDEX;
const DEFAULT_SAML_ACCEPTED_CLOCK_SKEW_MS = "-1";
const SAML_ACCEPTED_CLOCK_SKEW_MS = parseInt(
  process.env.SAML_ACCEPTED_CLOCK_SKEW_MS ||
    DEFAULT_SAML_ACCEPTED_CLOCK_SKEW_MS,
  10
);

const SPID_TESTENV_URL = process.env.SPID_TESTENV_URL;

// Register the spidStrategy.
export const IDP_METADATA_URL = getRequiredENVVar("IDP_METADATA_URL");
const CIE_METADATA_URL = getRequiredENVVar("CIE_METADATA_URL");

export const STARTUP_IDPS_METADATA:
  | Record<string, string>
  | undefined = fromNullable(process.env.STARTUP_IDPS_METADATA)
  .map(_ =>
    parseJSON(_, toError)
      .chain<Record<string, string> | undefined>(_1 =>
        STRINGS_RECORD.decode(_1).mapLeft(
          err => new Error(errorsToReadableMessages(err).join(" / "))
        )
      )
      .getOrElse(undefined)
  )
  .getOrElse(undefined);

export const CLIENT_ERROR_REDIRECTION_URL =
  process.env.CLIENT_ERROR_REDIRECTION_URL || "/error.html";

export const CLIENT_REDIRECTION_URL =
  process.env.CLIENT_REDIRECTION_URL || "/login";

const SPID_LEVEL_WHITELIST = fromNullable(process.env.SPID_LEVEL_WHITELIST)
  .map(_ => _.split(","))
  .foldL(
    // SPID_LEVEL_WHITELIST is unset
    () => {
      if (ENV === NodeEnvironmentEnum.DEVELOPMENT) {
        // default config for development, all the spid levels are allowed
        return right<t.Errors, SpidLevelArray>(["SpidL1", "SpidL2", "SpidL3"]);
      }
      // default config for production, only L2 and L3 are allowed
      return right<t.Errors, SpidLevelArray>(["SpidL2", "SpidL3"]);
    },
    _ => SpidLevelArray.decode(_)
  )
  .getOrElseL(err => {
    log.error(
      "Invalid value for SPID_LEVEL_WHITELIST env [%s]",
      readableReport(err)
    );
    return process.exit(1);
  });

export const appConfig: IApplicationConfig = {
  assertionConsumerServicePath: "/assertionConsumerService",
  clientErrorRedirectionUrl: CLIENT_ERROR_REDIRECTION_URL,
  clientLoginRedirectionUrl: CLIENT_REDIRECTION_URL,
  loginPath: "/login",
  metadataPath: "/metadata",
  sloPath: "/slo",
  spidLevelsWhitelist: SPID_LEVEL_WHITELIST,
  startupIdpsMetadata: STARTUP_IDPS_METADATA
};

const maybeSpidValidatorUrlOption = fromNullable(
  process.env.SPID_VALIDATOR_URL
).map(_ => ({ [_]: true }));
const maybeSpidTestenvOption = fromNullable(SPID_TESTENV_URL).map(_ => ({
  [_]: true
}));

// Set default idp metadata refresh time to 7 days
export const DEFAULT_IDP_METADATA_REFRESH_INTERVAL_SECONDS = 3600 * 24 * 7;
export const IDP_METADATA_REFRESH_INTERVAL_SECONDS: number = process.env
  .IDP_METADATA_REFRESH_INTERVAL_SECONDS
  ? parseInt(process.env.IDP_METADATA_REFRESH_INTERVAL_SECONDS, 10)
  : DEFAULT_IDP_METADATA_REFRESH_INTERVAL_SECONDS;
log.info(
  "IDP metadata refresh interval set to %s seconds",
  IDP_METADATA_REFRESH_INTERVAL_SECONDS
);

export const serviceProviderConfig: IServiceProviderConfig = {
  IDPMetadataUrl: IDP_METADATA_URL,
  organization: {
    URL: "https://io.italia.it",
    displayName: "IO - l'app dei servizi pubblici BETA",
    name: "PagoPA S.p.A."
  },
  publicCert: samlCert(),
  requiredAttributes: {
    attributes: [
      "address",
      "email",
      "name",
      "familyName",
      "fiscalNumber",
      "mobilePhone"
    ],
    name: "Required attributes"
  },
  spidCieUrl: CIE_METADATA_URL,
  spidTestEnvUrl: SPID_TESTENV_URL,
  spidValidatorUrl: process.env.SPID_VALIDATOR_URL,
  strictResponseValidation: {
    ...(isSome(maybeSpidTestenvOption) ? maybeSpidTestenvOption.value : {}),
    ...(isSome(maybeSpidValidatorUrlOption)
      ? maybeSpidValidatorUrlOption.value
      : {})
  }
};

export const samlConfig: SamlConfig = {
  RACComparison: "minimum",
  acceptedClockSkewMs: SAML_ACCEPTED_CLOCK_SKEW_MS,
  attributeConsumingServiceIndex: SAML_ATTRIBUTE_CONSUMING_SERVICE_INDEX,
  // this value is dynamic and taken from query string
  authnContext: "https://www.spid.gov.it/SpidL1",
  callbackUrl: SAML_CALLBACK_URL,
  identifierFormat: "urn:oasis:names:tc:SAML:2.0:nameid-format:transient",
  issuer: SAML_ISSUER,
  logoutCallbackUrl: SAML_LOGOUT_CALLBACK_URL,
  privateCert: samlKey()
};

// Redirection urls
export const clientProfileRedirectionUrl =
  process.env.CLIENT_REDIRECTION_URL || "/profile.html?token={token}";

if (!clientProfileRedirectionUrl.includes("{token}")) {
  log.error("CLIENT_REDIRECTION_URL must contains a {token} placeholder");
}

// IP(s) or CIDR(s) allowed for notification
export const ALLOW_NOTIFY_IP_SOURCE_RANGE = decodeCIDRs(
  process.env.ALLOW_NOTIFY_IP_SOURCE_RANGE
).getOrElseL(errs => {
  log.error(
    `Missing or invalid ALLOW_NOTIFY_IP_SOURCE_RANGE environment variable: ${readableReport(
      errs
    )}`
  );
  return process.exit(1);
});

// IP(s) or CIDR(s) allowed for payment manager endpoint
export const ALLOW_PAGOPA_IP_SOURCE_RANGE = decodeCIDRs(
  process.env.ALLOW_PAGOPA_IP_SOURCE_RANGE
).getOrElseL(errs => {
  log.error(
    `Missing or invalid ALLOW_PAGOPA_IP_SOURCE_RANGE environment variable: ${readableReport(
      errs
    )}`
  );
  return process.exit(1);
});

// IP(s) or CIDR(s) allowed for myportal endpoint
export const ALLOW_MYPORTAL_IP_SOURCE_RANGE = decodeCIDRs(
  process.env.ALLOW_MYPORTAL_IP_SOURCE_RANGE
).getOrElseL(errs => {
  log.error(
    `Missing or invalid ALLOW_MYPORTAL_IP_SOURCE_RANGE environment variable: ${readableReport(
      errs
    )}`
  );
  return process.exit(1);
});

// IP(s) or CIDR(s) allowed for bpd endpoint
export const ALLOW_BPD_IP_SOURCE_RANGE = decodeCIDRs(
  process.env.ALLOW_BPD_IP_SOURCE_RANGE
).getOrElseL(errs => {
  log.error(
    `Missing or invalid ALLOW_BPD_IP_SOURCE_RANGE environment variable: ${readableReport(
      errs
    )}`
  );
  return process.exit(1);
});

// IP(s) or CIDR(s) allowed for handling sessions
export const ALLOW_SESSION_HANDLER_IP_SOURCE_RANGE = decodeCIDRs(
  process.env.ALLOW_SESSION_HANDLER_IP_SOURCE_RANGE
).getOrElseL(errs => {
  log.error(
    `Missing or invalid ALLOW_SESSION_HANDLER_IP_SOURCE_RANGE environment variable: ${readableReport(
      errs
    )}`
  );
  return process.exit(1);
});

const DEFAULT_REQUEST_TIMEOUT_MS = 10000 as Millisecond;

// HTTP-only fetch with optional keepalive agent
// @see https://github.com/pagopa/io-ts-commons/blob/master/src/agent.ts#L10
const abortableFetch = AbortableFetch(agent.getHttpFetch(process.env));
// HTTPS-only fetch with optional keepalive agent
const securedAbortableFetch = AbortableFetch(agent.getHttpsFetch(process.env));
const fetchWithTimeout = setFetchTimeout(
  DEFAULT_REQUEST_TIMEOUT_MS,
  abortableFetch
);
const securedFetchWithTimeout = setFetchTimeout(
  DEFAULT_REQUEST_TIMEOUT_MS,
  securedAbortableFetch
);
const httpApiFetch = toFetch(fetchWithTimeout);
const httpsApiFetch = toFetch(securedFetchWithTimeout);

export const API_KEY = getRequiredENVVar("API_KEY");
export const API_URL = getRequiredENVVar("API_URL");
export const API_BASE_PATH = getRequiredENVVar("API_BASE_PATH");
export const API_CLIENT = new ApiClientFactory(API_KEY, API_URL, API_URL.startsWith("https") ? httpsApiFetch : httpApiFetch);

export const BONUS_API_KEY = getRequiredENVVar("BONUS_API_KEY");
export const BONUS_API_URL = getRequiredENVVar("BONUS_API_URL");
export const BONUS_API_BASE_PATH = getRequiredENVVar("BONUS_API_BASE_PATH");
export const BONUS_API_CLIENT = BonusAPIClient(
  BONUS_API_KEY,
  BONUS_API_URL,
  BONUS_API_URL.startsWith("https") ? httpsApiFetch : httpApiFetch
);

export const CGN_API_KEY = getRequiredENVVar("CGN_API_KEY");
export const CGN_API_URL = getRequiredENVVar("CGN_API_URL");
export const CGN_API_BASE_PATH = getRequiredENVVar("CGN_API_BASE_PATH");
export const CGN_API_CLIENT = CgnAPIClient(
  CGN_API_KEY,
  CGN_API_URL,
  httpApiFetch
);

// Set default session duration to 30 days
const DEFAULT_TOKEN_DURATION_IN_SECONDS = 3600 * 24 * 30;
export const tokenDurationSecs: number = process.env.TOKEN_DURATION_IN_SECONDS
  ? parseInt(process.env.TOKEN_DURATION_IN_SECONDS, 10)
  : DEFAULT_TOKEN_DURATION_IN_SECONDS;
log.info("Session token duration set to %s seconds", tokenDurationSecs);

// HTTPs-only fetch with optional keepalive agent
// @see https://github.com/pagopa/io-ts-commons/blob/master/src/agent.ts#L10
const simpleHttpsApiFetch = agent.getHttpsFetch(process.env);

// Register a factory service to create PagoPA client.
const pagoPAApiUrlProd = getRequiredENVVar("PAGOPA_API_URL_PROD");
const pagoPAApiUrlTest = getRequiredENVVar("PAGOPA_API_URL_TEST");
export const PAGOPA_CLIENT = new PagoPAClientFactory(
  pagoPAApiUrlProd,
  pagoPAApiUrlTest,
  simpleHttpsApiFetch
);

// API endpoint mount.
export const AUTHENTICATION_BASE_PATH = getRequiredENVVar(
  "AUTHENTICATION_BASE_PATH"
);
export const PAGOPA_BASE_PATH = getRequiredENVVar("PAGOPA_BASE_PATH");

export const MYPORTAL_BASE_PATH = getRequiredENVVar("MYPORTAL_BASE_PATH");

export const BPD_BASE_PATH = getRequiredENVVar("BPD_BASE_PATH");

// Token needed to receive API calls (notifications, metadata update) from io-functions-services
export const PRE_SHARED_KEY = getRequiredENVVar("PRE_SHARED_KEY");

// Register the urlTokenStrategy.
export const URL_TOKEN_STRATEGY = urlTokenStrategy(PRE_SHARED_KEY);

export const getClientProfileRedirectionUrl = (
  token: string
): UrlFromString => {
  const url = clientProfileRedirectionUrl.replace("{token}", token);
  return {
    href: url
  };
};

// Needed to forward SPID requests for logging
export const SPID_LOG_STORAGE_CONNECTION_STRING = getRequiredENVVar(
  "SPID_LOG_STORAGE_CONNECTION_STRING"
);
export const SPID_LOG_QUEUE_NAME = getRequiredENVVar("SPID_LOG_QUEUE_NAME");

// Needed to forward SPID/CIE successful login
export const USERS_LOGIN_STORAGE_CONNECTION_STRING = getRequiredENVVar(
  "USERS_LOGIN_STORAGE_CONNECTION_STRING"
);
export const USERS_LOGIN_QUEUE_NAME = getRequiredENVVar(
  "USERS_LOGIN_QUEUE_NAME"
);

// Needed to forward push notifications actions events
export const NOTIFICATIONS_STORAGE_CONNECTION_STRING = getRequiredENVVar(
  "NOTIFICATIONS_STORAGE_CONNECTION_STRING"
);
export const NOTIFICATIONS_QUEUE_NAME = getRequiredENVVar(
  "NOTIFICATIONS_QUEUE_NAME"
);

// Push notifications
export const NOTIFICATION_DEFAULT_SUBJECT =
  "Entra nell'app per leggere il contenuto";
export const NOTIFICATION_DEFAULT_TITLE = "Hai un nuovo messaggio su IO";

export const BARCODE_ALGORITHM = NonEmptyString.decode(
  process.env.BARCODE_ALGORITHM
).getOrElse("code128" as NonEmptyString);

// Application insights sampling percentage
export const DEFAULT_APPINSIGHTS_SAMPLING_PERCENTAGE = 20;

// Password login params
export const TEST_LOGIN_FISCAL_CODES = NonEmptyString.decode(
  process.env.TEST_LOGIN_FISCAL_CODES
)
  .map(_ => _.split(","))
  .map(_ => rights(_.map(FiscalCode.decode)))
  .getOrElse([]);

export const TEST_LOGIN_PASSWORD = NonEmptyString.decode(
  process.env.TEST_LOGIN_PASSWORD
);

// Feature flags
export const FF_BONUS_ENABLED = process.env.FF_BONUS_ENABLED === "1";
export const FF_CGN_ENABLED = process.env.FF_CGN_ENABLED === "1";

// Support Token
export const JWT_SUPPORT_TOKEN_PRIVATE_RSA_KEY = NonEmptyString.decode(
  process.env.JWT_SUPPORT_TOKEN_PRIVATE_RSA_KEY
).getOrElseL(errs => {
  log.error(
    `Missing or invalid JWT_SUPPORT_TOKEN_PRIVATE_RSA_KEY environment variable: ${readableReport(
      errs
    )}`
  );
  return process.exit(1);
});
export const JWT_SUPPORT_TOKEN_ISSUER = NonEmptyString.decode(
  process.env.JWT_SUPPORT_TOKEN_ISSUER
).getOrElseL(errs => {
  log.error(
    `Missing or invalid JWT_SUPPORT_TOKEN_ISSUER environment variable: ${readableReport(
      errs
    )}`
  );
  return process.exit(1);
});

const DEFAULT_JWT_SUPPORT_TOKEN_EXPIRATION = 604800 as Second;
export const JWT_SUPPORT_TOKEN_EXPIRATION: Second = IntegerFromString.decode(
  process.env.JWT_SUPPORT_TOKEN_EXPIRATION
).getOrElse(DEFAULT_JWT_SUPPORT_TOKEN_EXPIRATION) as Second;
log.info(
  "JWT support token expiration set to %s seconds",
  JWT_SUPPORT_TOKEN_EXPIRATION
);
