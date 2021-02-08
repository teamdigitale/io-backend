/**
 * Main entry point for the Digital Citizenship proxy.
 */
import * as http from "http";
import * as https from "https";
import * as appInsights from "applicationinsights";
import { fromNullable } from "fp-ts/lib/Option";
import { NodeEnvironmentEnum } from "@pagopa/ts-commons/lib/environment";
import { newApp } from "./app";
import {
  ALLOW_BPD_IP_SOURCE_RANGE,
  ALLOW_MYPORTAL_IP_SOURCE_RANGE,
  ALLOW_NOTIFY_IP_SOURCE_RANGE,
  ALLOW_PAGOPA_IP_SOURCE_RANGE,
  ALLOW_SESSION_HANDLER_IP_SOURCE_RANGE,
  API_BASE_PATH,
  AUTHENTICATION_BASE_PATH,
  BONUS_API_BASE_PATH,
  BPD_BASE_PATH,
  CGN_API_BASE_PATH,
  DEFAULT_APPINSIGHTS_SAMPLING_PERCENTAGE,
  ENV,
  MYPORTAL_BASE_PATH,
  PAGOPA_BASE_PATH,
  SAML_CERT,
  SAML_KEY,
  SERVER_PORT
} from "./config";
import {
  initAppInsights,
  StartupEventName,
  trackStartupTime
} from "./utils/appinsights";

import { initHttpGracefulShutdown } from "./utils/gracefulShutdown";
import { log } from "./utils/logger";
import { getCurrentBackendVersion } from "./utils/package";
import { TimeTracer } from "./utils/timer";

const authenticationBasePath = AUTHENTICATION_BASE_PATH;
const APIBasePath = API_BASE_PATH;
const BonusAPIBasePath = BONUS_API_BASE_PATH;
const PagoPABasePath = PAGOPA_BASE_PATH;
const MyPortalBasePath = MYPORTAL_BASE_PATH;
const BPDBasePath = BPD_BASE_PATH;
const CGNAPIBasePath = CGN_API_BASE_PATH;

// Set default for graceful-shutdown
const DEFAULT_SHUTDOWN_SIGNALS = "SIGINT SIGTERM";
const DEFAULT_SHUTDOWN_TIMEOUT_MILLIS = 30000;

const shutdownSignals: string =
  process.env.SHUTDOWN_SIGNALS || DEFAULT_SHUTDOWN_SIGNALS;

const shutdownTimeout: number = process.env.DEFAULT_SHUTDOWN_TIMEOUT_MILLIS
  ? parseInt(process.env.DEFAULT_SHUTDOWN_TIMEOUT_MILLIS, 10)
  : DEFAULT_SHUTDOWN_TIMEOUT_MILLIS;

// eslint-disable-next-line functional/no-let
let server: http.Server | https.Server;
const timer = TimeTracer();

/**
 * If APPINSIGHTS_INSTRUMENTATIONKEY env is provided initialize an App Insights Client
 * WARNING: When the key is provided several information are collected automatically
 * and sent to App Insights.
 * To see what kind of informations are automatically collected
 *
 * @see: utils/appinsights.js into the class AppInsightsClientBuilder
 */
const maybeAppInsightsClient = fromNullable(
  process.env.APPINSIGHTS_INSTRUMENTATIONKEY
).map(k =>
  initAppInsights(k, {
    applicationVersion: getCurrentBackendVersion(),
    disableAppInsights: process.env.APPINSIGHTS_DISABLED === "true",
    samplingPercentage: process.env.APPINSIGHTS_SAMPLING_PERCENTAGE
      ? parseInt(process.env.APPINSIGHTS_SAMPLING_PERCENTAGE, 10)
      : DEFAULT_APPINSIGHTS_SAMPLING_PERCENTAGE
  })
);

newApp({
  APIBasePath,
  BPDBasePath,
  BonusAPIBasePath,
  CGNAPIBasePath,
  MyPortalBasePath,
  PagoPABasePath,
  allowBPDIPSourceRange: ALLOW_BPD_IP_SOURCE_RANGE,
  allowMyPortalIPSourceRange: ALLOW_MYPORTAL_IP_SOURCE_RANGE,
  allowNotifyIPSourceRange: ALLOW_NOTIFY_IP_SOURCE_RANGE,
  allowPagoPAIPSourceRange: ALLOW_PAGOPA_IP_SOURCE_RANGE,
  allowSessionHandleIPSourceRange: ALLOW_SESSION_HANDLER_IP_SOURCE_RANGE,
  appInsightsClient: maybeAppInsightsClient.toUndefined(),
  authenticationBasePath,
  env: ENV
})
  .then(app => {
    const startupTimeMs = timer.getElapsedMilliseconds();
    // In test and production environments the HTTPS is terminated by the Kubernetes Ingress controller. In dev we don't use
    // Kubernetes so the proxy has to run on HTTPS to behave correctly.
    if (ENV === NodeEnvironmentEnum.DEVELOPMENT) {
      log.info("Starting HTTPS server on port %d", SERVER_PORT);
      const options = { cert: SAML_CERT, key: SAML_KEY };
      server = https.createServer(options, app).listen(443, () => {
        log.info("Listening on port 443");
        log.info(`Startup time: %sms`, startupTimeMs.toString());
        maybeAppInsightsClient.map(_ =>
          trackStartupTime(_, StartupEventName.SERVER, startupTimeMs)
        );
      });
    } else {
      log.info("Starting HTTP server on port %d", SERVER_PORT);
      server = http.createServer(app).listen(SERVER_PORT, () => {
        log.info("Listening on port %d", SERVER_PORT);
        log.info(`Startup time: %sms`, startupTimeMs.toString());
        maybeAppInsightsClient.map(_ =>
          trackStartupTime(_, StartupEventName.SERVER, startupTimeMs)
        );
      });
    }
    server.on("close", () => {
      app.emit("server:stop");

      // If an AppInsights Client is initialized, flush all pending data and reset the configuration.
      maybeAppInsightsClient.map(appInsightsClient => {
        appInsightsClient.flush();
        appInsights.dispose();
      });
      log.info("HTTP server close.");
    });

    initHttpGracefulShutdown(server, app, {
      development: ENV === NodeEnvironmentEnum.DEVELOPMENT,
      finally: () => {
        log.info("Server graceful shutdown complete.");
      },
      signals: shutdownSignals,
      timeout: shutdownTimeout
    });
  })
  .catch(err => {
    log.error("Error loading app: %s", err);
    process.exit(1);
  });
