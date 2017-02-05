/* Dependencies */
var Sheet = require('./lib/sheet');
var Trader = require('./lib/trader');
var Boot = require('./lib/boot');
var Order = require('./lib/order');
var Logger = require('./lib/logger');
var Bitfinex = require('./lib/bitfinex');

/**
 * Instanciate helpers
 */
var fees = {
    maker: 0.001,
    taker: 0.002
};
var boot = new Boot();
var sheet = new Sheet();
var trader = new Trader(fees);
var logger = new Logger(trader, sheet);
var bitfinex = new Bitfinex(gotTradePrices, gotOrderUpdate);


/**
 * Main datastructure recording state
 */
var data = {
    balanceUSD: 0,
    balanceBTC: 0,
    lastBuy: null,
    lastSell: null,
    activeBuy: null,
    activeSell: null
};
var minTradeBTC = 0.01;
var makingOrder = false;


boot.init(bitfinex, function (accountData, feesData)
{
    if (accountData) data = accountData;
    if (feesData) fees = feesData;

    bitfinex.start();
});


function gotTradePrices(tradePrice)
{
    checkShouldUpdate(tradePrice);
    checkShouldBuy(tradePrice);
    checkShouldSell();
}

function gotOrderUpdate(order)
{
    updateBalances(function ()
    {
        if (order.status === 'EXECUTED')
        {
            data.activeBuy = null;
            data.activeSell = null;
            if (order.type === 'buy') data.lastBuy = order;
            if (order.type === 'sell') data.lastSell = order;
        }
        else if (order.status === 'ACTIVE')
        {
            if (order.type === 'buy') data.activeBuy = order;
            if (order.type === 'sell') data.activeSell = order;
        }

        logger.orderUpdate(order);
    });
}

/**
 * Check the trader to find out if we should buy or sell
 */
function checkShouldSell()
{
    // If there is already an active order, exit
    if (hasActiveOrder()) return;

    // If you don't have any BTC in wallet, exit
    if (data.balanceBTC === 0) return;

    // If you don't have enough BTC to meet the min order amount on bitfinex, exit
    if (data.balanceBTC < minTradeBTC) return;

    // If you're already currently making an order, exit
    // basically a thread lock
    if (makingOrder) return;

    makingOrder = true;

    var sellPrice = trader.currentResistanceZone;
    if (!sellPrice || sellPrice < 0)
    {
        trader.currentResistanceZone = trader.resistanceZone(data.lastBuy.price);
        sellPrice = trader.currentResistanceZone;
    }
    var orderData = trader.sellOrder(sellPrice, data.balanceBTC);
    bitfinex.placeOrder(orderData, madeOrderCallback);
}

function checkShouldBuy(currentTicker)
{
    // If there is already an active order, exit
    if (hasActiveOrder()) return;

    // If you don't have any USD in wallet, exit
    if (data.balanceUSD === 0) return;

    // If you don't have enough USD to meet the min order amount on bitfinex, exit
    if (data.balanceUSD < (minTradeBTC * currentTicker)) return;

    // If you're already currently making an order, exit
    // basically a thread lock
    if (makingOrder) return;

    makingOrder = true;
    var orderData = trader.buyOrder(currentTicker, data.balanceUSD);
    trader.currentResistanceZone = trader.resistanceZone(orderData.price);
    bitfinex.placeOrder(orderData, madeOrderCallback);
}

function checkShouldUpdate(currentTicker)
{
    // If there is no active buy order, exit
    if (!data.activeBuy || !data.activeBuy.id) return;

    // If the new ticker is lower than the last buy time, exit
    var newPrice = trader.supportZone(currentTicker);
    if (newPrice <= data.activeBuy.price) return;

    // If you're already currently making an order, exit
    // basically a thread lock
    if (makingOrder) return;
    makingOrder = true;

    var oldBalance = (data.activeBuy.price * data.activeBuy.amount).toFixed(8);
    var orderData = trader.buyOrder(currentTicker, oldBalance);
    trader.currentResistanceZone = trader.resistanceZone(currentTicker);
    bitfinex.replaceOrder(data.activeBuy.id, orderData, madeOrderCallback);
}

/**
 * Utility to check whether there is an active order
 */
function hasActiveOrder()
{
    return data.activeBuy && data.activeSell;
}

/**
 * Callback to handle new order creation
 */
function madeOrderCallback(err, res)
{
    makingOrder = false;

    if (err || !res)
    {
        console.log("Could not perform trade or update");
        console.log(err);
        return;
    }

    var order = res;
    if (!(res instanceof Order)) order = new Order.fromRestA(order);

    // Record to active order
    if (order.type === 'buy') data.activeBuy = order;
    else if (order.type === 'sell') data.activeSell = order;

    // Log to active order to google sheets
    logger.orderUpdate(order);
}

/**
 * Utility to get wallet balances
 */
function updateBalances(callback)
{
    bitfinex.getUpdatedBalances(function (balances)
    {
        if (balances)
        {
            data.balanceBTC = balances.balanceBTC;
            data.balanceUSD = balances.balanceUSD;
        }
        if (callback) callback();
    });
}
