const _ = require('lodash');
const ccxt = require ('ccxt');
const retry = require('async-retry');
const interval = require('interval-promise');
const websocket = require('./socket/socket');
const waitUntil = require('async-wait-until');
const Order = require('./models/Order');
const Symbol = require('./models/Symbol');
const BitMEXClient = require('./bitmex-realtime-api');
const { round, sleep, asyncForEach, uuid4 } = require('./utils');
const log = (client, msg, ...args) => { require('./utils').log(`ExchangeClient ${client.user.username}`, msg, ...args) };
const logError = (client, msg, ...args) => { require('./utils').logError(`ExchangeClient ${client.user.username}`, msg, ...args) };

const mXBT_TO_XBT_FACTOR = 1 / 1000;
const XBt_TO_XBT_FACTOR = 1 / 100000000;

class ExchangeClient {
  constructor(test, user) {
    // ...
    
    // Websocket
    // ...

    this.apiRetryOptions = {
      factor: 1.2, // Retry interval is multiplied by factor each attempt
      retries: this.maxAttempts,
      minTimeout: this.exchangeRetryInterval
    };
  }

  async start() {
    // ...

    interval(async (iteration, stop) => {
      try {
        await this.restart();
      } catch (error) {
        logError(this, `Error in restart interval: ${JSON.stringify(error)}`);
        if (error.fatal) {
          websocket.sendExchangeError({ username: this.user.username, ...error});
          stop();
        }
      }
    }, this.clientRestartDuration);

    const exClient = this;
    clearTimeout(this.socketReconnectTimer);
    this.socketReconnectTimer = setTimeout(function checkSocket() {
      exClient.checkWebsocket();
      exClient.socketReconnectTimer = setTimeout(checkSocket, exClient.webSocketCheckInterval);
    }, this.webSocketCheckInterval);

    this.checkWebsocket();
  }

  // ...

  pushBackReconnectTime(code) {
    // If canRestartWebSocket() is true, this will be 0.
    const timeUntilNextReconnect = Math.max(this.socketNextReconnectTime - Date.now(), 0);

    let totalTimeoutDuration;
    const inWaitingPeriod = !this.canRestartWebSocket();

    switch (code) {
      case 1000: // Normal close code.
        totalTimeoutDuration = inWaitingPeriod ? this.socketReconnectTimeout : this.socketReconnectTimeout / 2;
        break;
      case 1012: // System down for maintenance. Wait a long time.
        totalTimeoutDuration = this.socketReconnectTimeout * 10;
        break;
      default:
        totalTimeoutDuration = this.socketReconnectTimeout * (inWaitingPeriod ? 2 : 1);
        break;
    }

    // Throw in an amount of time between now and the next possible reconnect time.
    // If two errors occur back-to-back this will ensure that the reconnect time really gets pushed back even more.
    totalTimeoutDuration += timeUntilNextReconnect;

    logError(this, `Setting a socket reconnect time ${totalTimeoutDuration / second} seconds in the future.`);

    this.socketNextReconnectTime = Date.now() + Math.round(totalTimeoutDuration);
  }

  async cancelOrder(orderID) {
    return await this.executeApiCall(this.httpClient.privateDeleteOrder, { orderID });
  }

  async executeApiCall(func, ...args) {
    try {
      await this.pauseIfHttpBusy();
    } catch (e) {
      logError(this, e);
    }

    if (!this.httpClient) await this.startHttpClient();

    let result;

    try {
      result = await retry(async bail => {
        try {
          this.hasActiveApiCall = true;
          const res = await func(...args);
          this.hasActiveApiCall = false;
          return res;
        } catch (error) {
          const parsedError = this.handleBitmexError(error);

          if (!parsedError.retry) {
            bail(parsedError);
            return;
          }

          throw parsedError;
        }
      }, this.apiRetryOptions);
    } catch (error) {
      // Enter here after bail() or hit retry limit
      this.hasActiveApiCall = false;
      if (error.fatal) {
        websocket.sendExchangeError({ username: this.user.username, ...error});
      }
      throw error;
    }

    return result;
  }

  handleBitmexError(error) {
    const parsedError = this.parseError(error);

    const errorsToRetry = ['errors', 'to', 'retry'];
    const fatalErrorTypes = ['fatal', 'error', 'types'];

    let fatal = fatalErrorTypes.includes(parsedError.type);

    const isErrorTypeToRetry = errorsToRetry.includes(parsedError.type);
    const isDelistedError = description.includes('is delisted');
    const invalidKeys = description.includes('invalid api key');
    // ...

    fatal = fatal || keysAreDisabled || invalidKeys;

    const retryClauses = [
      // To retry
      isErrorTypeToRetry,
      // ...

      // To not retry
      !fatal,
      !isDelistedError,
      // ...
    ];

    // ...

    const retry = retryClauses.reduce((a, b) => a && b);

    logError(this, `BitmexError: ${JSON.stringify({ retry, fatal, ...parsedError })}`);

    return { retry, fatal, ...parsedError };
  }
}

module.exports = ExchangeClient;
