const _ = require('lodash');
const dotenv = require('dotenv');
const websocket = require('./socket/socket');
const User = require('./models/User');
const Order = require('./models/Order');
const { asyncForEach, sleep } = require('./utils');
const ExchangeClient = require('./exchangeClient');
const log = (msg, ...args) => { require('./utils').log(`Exchange`, msg, ...args) };
const logError = (msg, ...args) => { require('./utils').logError(`Exchange`, msg, ...args) };

dotenv.load({ path: '.env' });

const second = 1000; // ms
const minute = 60 * second;

class Exchange {
  constructor(test) {
    this.test = test;
    this.clients = {};

    // ...
  }

  async addUser(user) {
    let client = this.clients[user.username];

    const { username } = user;
    const isNewUser = !client;

    if (!!client) {
      log(`Stopping clients for ${username}`);
      try {
        await client.abortConnections();
      } catch (e) {
        logError(`Error while stopping clients: ${e}`);
      }
      this.clients[username] = null;
      delete this.clients[username];
    }

    log(`Starting clients for ${username}`);
    client = new ExchangeClient(this.test, user);
    try {
      await client.start();
      this.clients[username] = client;
    } catch (e) {
      logError(`Error starting the ExchangeClient for ${username}`);
      await this.removeUser(user);
    }

    return isNewUser;
  }

  async removeUser(user) {
    const { username } = user;
    let client = this.clients[username];
    if (!!client) {
      log(`Removing user and stopping client for ${username}`);
      try {
        await client.abortConnections();
      } catch (e) {
        logError(`Error while stopping clients: ${e}`);
      }
      client = null;
      this.clients[username] = null;
      delete this.clients[username];
    }

    await User.deleteOne({ username });
    await Order.deleteMany({ username });
  }

  async buy(symbol, price, users, percent, orderLeverage, stopLoss, trailingStopLoss, orderSetID) {
    await asyncForEach(Object.values(this.clients), async (client) => {
      const { username } = client.user;
      if (!users || !users.length || users.indexOf(username) === -1) {
        return;
      }

      try {
        const orders = await client.buy(symbol, percent, orderLeverage, price, stopLoss, trailingStopLoss);

        const options = {new: true, upsert: true};
        await asyncForEach(orders, async (order) => {
          const { timestamp, orderID } = order;
          order.lastTimestamp = timestamp;
          await Order.findOneAndUpdate({ orderID }, {$set: {orderSetID, username, ...order}}, options);
          websocket.sendOrderUpdate({ username, orderSetID, ...order });
        });
      } catch (error) {
        websocket.sendOrderUpdate({ username, orderSetID, error });
      }
    });

    await this.fetchRecentOrdersAfterSleep(users);
  }
  
  // ...
}

const bitmexExchange = new Exchange(process.env.BITMEX_TESTNET || false);

module.exports = bitmexExchange;
