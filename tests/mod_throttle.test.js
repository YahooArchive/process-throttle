/*
 * Copyright (c) 2013, Yahoo! Inc. All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */
var assert = require('assert'),
    events = require('events'),
    mockery = require('mockery'),
    net = require('net'),
    Stream = require('stream'),
    timer = require('timers'),
    util = require('util'),
    vows = require('vows'),
    Throttler = require('../lib/throttle.js');
    
var EventEmitter = events.EventEmitter,
    Globals = {};

var srv = new (require('events').EventEmitter)(),
    testee = new Throttler({
        'max_memory': 100,
        'max_requests': 2
    });

//Add server to monitor
testee.addServer(srv);

//This is required for testing process
//exit due to memory size beyond specified limit
process.memoryUsage = function () {
    return {
        'rss': 10,
        'heapTotal': 100,
        'heapUsed': 1000,
        'vsize': 10
    };
};

function getReq(config) {
    return {
        mod_config: config,
        url : "www.yahoo.com",
        on : function (what, listener) {
            this.listener = listener;
        }
    };
}

function getResp() {
    return {
        statusCode : 200,
        headers : null,
        blob : "",
        write : function (data) {
            this.blob += data;
        },
        writeHead : function (stat, arg1, arg2) {
            this.statusCode = stat;
            this.headers = (typeof arg1 !== "string") ? arg1 : arg2;
        },
        end : function (data) {
            this.blob += data;
        }
    };
}

//Capture the events thrown by the module
//To verify the process was shut down
//for the expected reason
process.on('count-restart', function () {
    Globals.restart_event = 'count-restart';
});

process.on('memory-restart', function () {
    Globals.restart_event = 'memory-restart';
});

//Verify the exit code
process.exit = function (exitcode) {
    Globals.exit = true;
    Globals.exit_code = exitcode;
};

function MockStream() {}
util.inherits(MockStream, EventEmitter);
MockStream.prototype.write = function () {};

srv.close = function () {};

var tests = {

    //---------------------------------------------
    // Tests
    //---------------------------------------------

    'testing module load': {
        topic: function () {
            return '';
        },
        'test mock received data': function (topic) {
            assert.ok(process.throttle !== null);
            assert.ok(typeof(process.throttle.getRequestCount) === 'function');
        }
    },

    'Test module request counter single connection ' : {
        topic: function () {
            var req1 = getReq(),
                resp1 = getResp(),
                req2 = getReq(),
                resp2 = getResp(),
                next = false,
                stream1 = new MockStream(),
                self = this,
                processMetrics = {};

            req1.connection = stream1;
            req2.connection = stream1;
            // reset globals
            Globals = {};

            testee.setConfig({
                'max_requests': 2,
                'max_memory': 300
            });
            // Number of requests < max requests
            srv.emit('connection', stream1);
            srv.emit('request', req1, resp1);
            processMetrics.firstReqCount = process.throttle.getRequestCount();
            processMetrics.firstReqTotalCount = process.throttle.getTotalRequestCount();
            resp1.writeHead(1);
            resp1.writeHead(1, 'Headers');
            resp1.writeHead(1, ['Headers']);
            resp1.writeHead(1, 'reason', ['Headers']);
            stream1.write('Data');
            processMetrics.firstReqData = process.throttle.getTransferred();
            processMetrics.firstReqOpenConnections = process.throttle.getOpenConnections();
            resp1.end();
            stream1.emit('close');

            // Number of requests < max requests
            srv.emit('connection', stream1);
            srv.emit('request', req1, resp1);
            srv.emit('request', req2, resp2);
            srv.emit('something-else');
            processMetrics.secondReqCount = process.throttle.getRequestCount();
            resp1.end();
            resp2.end();
            stream1.emit('close');

            timer.setTimeout(function () {
                self.callback(null, {
                    processMetrics: processMetrics,
                });
            }, 1000);
        },
        'test process throttle methods': function (topic) {
            var processMetrics = topic.processMetrics;
            assert.equal(1, processMetrics.firstReqCount);
            assert.equal(1, processMetrics.firstReqTotalCount);
            assert.equal(4, processMetrics.firstReqData);
            assert.equal(1, processMetrics.firstReqOpenConnections);
            assert.equal(2, processMetrics.secondReqCount);
        },
        'test globals': function (topic) {
            assert.equal(Globals.restart_event, 'count-restart');
            assert.equal(Globals.exit_code, 30);
        },
        tearDown: function () {
            Globals = {};
        }
    },

    'Test module request counter multiple connection ' : {
        topic: function () {
            var req1 = getReq(),
            resp1 = getResp(),
            req2 = getReq(),
            resp2 = getResp(),
            req3 = getReq(),
            resp3 = getResp(),
            next = false,
            stream1 = new MockStream(),
            stream2 = new MockStream(),
            self = this,
            processMetrics = {};
            testee.setConfig({
                'max_requests': 2,
                'max_memory': 100
            });

            // Link requests and connections as these are mock objects
            // and need to receive events in order
            Globals = {};
            req1.connection = stream1;
            req2.connection = stream2;
            req3.connection = stream2;
            stream1.end = function () {};
            stream2.end = function () {};
            stream1.destroy = function () {};
            stream2.destroy = function () {};

            // Number of requests < max requests
            srv.emit('connection', stream1);
            srv.emit('request', req1, resp1);
            processMetrics.firstReqCount = process.throttle.getRequestCount();

            // Number of requests = max requests
            // in a single connection
            srv.emit('connection', stream2);
            srv.emit('request', req2, resp2);
            srv.emit('request', req3, resp3);

            processMetrics.thirdReqCount = process.throttle.getRequestCount();
            processMetrics.thirdReqTotalCount = process.throttle.getTotalRequestCount();
            resp1.end();
            resp2.end();
            resp3.end();
            stream1.emit('close');
            stream2.emit('close');
            timer.setTimeout(function () {
                self.callback(null, {
                    processMetrics: processMetrics,
                });
            }, 1000);
        },
        'test process throttle methods': function (topic) {
            var processMetrics = topic.processMetrics;
            assert.equal(processMetrics.firstReqCount, 1);
            assert.equal(processMetrics.thirdReqCount, 3);
            assert.equal(processMetrics.thirdReqTotalCount, 6);
        },
        tearDown: function () {
            Globals = {};
        }
    },

    'Test module vsize memory usage single connection ': {
        topic: function () {
            var req1 = getReq(),
                resp1 = getResp(),
                next = false,
                stream1 = new MockStream(),
                self = this,
                processMetrics = {};

            timer.setTimeout(function() {
                testee.setConfig({
                    'max_requests': 100,
                    'max_memory': 8
                });
                Globals = {};
                req1.connection = stream1;
                stream1.end = function () {};
                stream1.destroy = function () {};
    
                // Number of requests < max requests
                srv.emit('connection', stream1);
                srv.emit('request', req1, resp1);
                processMetrics.firstReqCount = process.throttle.getRequestCount();
                resp1.end();
                stream1.emit('close');
    
                timer.setTimeout(function () {
                    self.callback(null, {
                        processMetrics: processMetrics
                    });
                }, 1000);                
            }, 1000);
        },
        'test process throttle metrics': function (topic) {
            assert.equal(topic.processMetrics.firstReqCount, 1);
        },
        'test globals': function (topic) {
            assert.equal(Globals.restart_event, 'memory-restart');
            assert.equal(Globals.exit_code, 30)
        },
        tearDown: function () {
            Globals = {};
        }
    }
};

vows.describe('throttle').addBatch(tests).export(module);

