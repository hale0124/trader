/* Dependencies */
var BitfinexWS = require('bitfinex-api-node');
var Order = require('./order');

function bitfinex(logTradePrices, logOrderUpdate)
{
    var self = this;

    self.rest = new BitfinexWS(process.env.BIT_REST_KEY, process.env.BIT_REST_SECRET).rest;
    self.logTradePrices = logTradePrices;
    self.logOrderUpdate = logOrderUpdate;
    self.getUpdatedBalances = getUpdatedBalances;

    var updatingBalances = false;
    var bws = new BitfinexWS(process.env.BIT_WS_KEY, process.env.BIT_WS_SECRET).ws;

    bws.on('trade', onTrade);
    bws.on('ts', onSnapshot);
    bws.on('error', console.error);

    self.start = function ()
    {
        bws.subscribeTrades('BTCUSD');
        bws.auth();
    };

    return self;


    function onTrade(pair, trade)
    {
        var tradePrice = parseFloat(trade.price);
        self.logTradePrices(tradePrice);
    }

    function onSnapshot(snapshot)
    {
        if (!snapshot || !snapshot.length) return;
        var order = new Order.fromSocket(snapshot);
        self.logOrderUpdate(order);
    }

    function getUpdatedBalances(callback)
    {
        if (updatingBalances) return;

        updatingBalances = true;
        self.rest.wallet_balances(function (err, res)
        {
            if (err || !res || !res.length)
            {
                updatingBalances = false;
                return callback();
            }

            var btcBalance = res.find(function (b)
            {
                return b.currency === "btc";
            });
            var usdBalance = res.find(function (b)
            {
                return b.currency === "usd";
            });
            var balances = {};
            try
            {
                if (btcBalance) balances.balanceBTC = parseFloat(btcBalance.available);
                if (usdBalance) balances.balanceUSD = parseFloat(usdBalance.available);
            }
            catch (e)
            {
                console.log("Error parsing balances");
                console.log(e);
            }

            updatingBalances = false;
            return callback(balances);
        });
    }
}

module.exports = bitfinex;