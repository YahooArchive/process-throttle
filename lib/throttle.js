/*
 * Copyright (c) 2013, Yahoo! Inc. All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */

// This module monitors the total number of requests server and the memory used
// if memory usage or requests served are beyond the specified limits, it kills itself.
// Exits with code 30

// Best used in cluster mode - where each worker process could be monitoredand shut down
// Master process would bring back the worker process up.

var EventEmitter = require('events').EventEmitter,
    util = require('util');

var memCont = null,
    reqCounter = null; //singleton

function MemoryController(maxRequests, maxMemory, reqCounter) {
    var that = this;
    this._state = 0;
    this._maxRequests = maxRequests;
    this._maxMemory = maxMemory;
    this._requestCount = 0;
    this._connections = 0;
    this._requests = 0;
    this._reqCounter = reqCounter;

    // register event functions
    reqCounter.on('connection', function () {
        that.onConnection.apply(that, arguments);
    });
    reqCounter.on('conn_closed', function () {
        that.onConnectionClosed.apply(that, arguments);
    });
    reqCounter.on('request', function () {
        that.onRequest.apply(that, arguments);
    });
    reqCounter.on('req_end', function () {
        that.onRequestEnd.apply(that, arguments);
    });
}

module.exports.__MemoryController = MemoryController;

MemoryController.prototype.onConnection = function (cons, reqs) {
    this._connections = cons;
    this._requests = reqs;

    if (this.checkState()) {
        this.throttle();
    }
};

MemoryController.prototype.onConnectionClosed = function (cons, reqs) {
    this._connections = cons;
    this._requests = reqs;
    if (cons === 0 || reqs === 0) {
        this.throttleDone();
    }
};

MemoryController.prototype.onRequest = function (cons, reqs, resp) {
    var origWriteHead = resp.writeHead,
        that = this;

    this._requests = reqs;
    this._connections = cons;

    if (typeof that._maxRequests === 'number' && that._maxRequests > 0) {
        // increase total number of served requests
        that._requestCount++;
    }

    resp.writeHead = function (status, reason, headers) {
        var realHeaders = headers,
            foundCon = false;
        // if reason is the actual headers
        if (typeof reason !== 'string') {
            if (!reason) {
                reason = {};
            }
            realHeaders = reason;
        } else {
            if (!headers) {
                realHeaders = headers = {};
            }
        }

        if (realHeaders instanceof Array) {
            realHeaders.forEach(function (l) {
                if (l instanceof Array && l.length >= 2 && l[0] === 'Connection') {
                    foundCon = true;
                    l[1] = 'close';
                }
            });
            if (!foundCon) {
                realHeaders.push(['Connection', 'close']);
            }
        } else {
            realHeaders.Connection = 'close';
        }
        // call the original function
        origWriteHead.call(resp, status, reason, headers);
    };
    if (that.checkState()) {
        that.throttle();
    }
};

MemoryController.prototype.onRequestEnd = function (cons, reqs, req) {
    var that = this;

    this._requests = reqs;
    this._connections = cons;

    if (that._throttle) {
        req.connection.end();
        req.connection.destroy();
    }
    if (that._requests === 0 || that._connections === 0) {
        that.throttleDone();
    }
};

MemoryController.prototype.throttleDone = function () {
    if (!this._throttle) {
        return;
    }

    // Sends an event before exit
    if (this.restartEvent) {
        process.emit(this.restartEvent, {});
    }

    // in this version - just kill the procs,
    // since another one has been respawned asynchronously.
    process.exit(30);
};

MemoryController.prototype.throttle = function () {
    var that = this;

    if (this._throttle || this._throttleRequested) {
        return;
    }

    // set throttle was requested and will
    // start after a timeout required for other process to be restarted.
    this._throttleRequested = true;
    // requet throttling delayed now
    setTimeout(function () {
        that._throttle = true;
        that._reqCounter._servers.forEach(function (l) {
            // stop accepting other connections
            l.close();
        });
        if (that._connections === 0 && that._requests === 0) {
            that.throttleDone();
        } else {
            that._timer = setTimeout(function () {
                that.throttleDone();
            }, 30000);
        }
    }, 200);
};

MemoryController.prototype.checkState = function () {
    if (this._maxMemory && process.memoryUsage().vsize > this._maxMemory) {
        this.restartEvent = 'memory-restart';
        return 1;
    }

    if (this._maxRequests && this._requestCount >= this._maxRequests) {
        this.restartEvent = 'count-restart';
        return 2;
    }
    if (this._timer) {
        clearTimeout(this._timer);
        this._timer = 0;
    }
    return false;
};


function ReqCounter() {
    this._requests = 0;
    this._totalRequests = 0;
    this._servers = [];
    this._connections = 0;
    this._transfered = 0;
}

util.inherits(ReqCounter, EventEmitter);

ReqCounter.prototype.addServer = function (server) {
    var found = false;
    this._servers.forEach(function (l) {
        if (l === server) {
            found = true;
        }
    });
    if (!found) {
        this._servers.push(server);
        this.registerEvents(server);
    }
};

ReqCounter.prototype.registerEvents = function (server) {
    var that = this,
        origEmit = server.emit,
        stream,
        req,
        resp,
        origEnd,
        origWrite;

    server.emit = function () {
        var args = arguments;
        if (args[0] !== 'connection' && args[0] !== 'request') {
            origEmit.apply(server, arguments);
            return;
        }

        if (args[0] === 'connection') {
            stream = args[1];
            origWrite = stream.write;

            // Add connection into the pool
            that._connections++;

            // get the number of bytes transferred
            stream.write = function (data) {
                if (data && data.length) {
                    that._transfered += data.length;
                }
                origWrite.apply(this, arguments);
            };

            stream.on('close', function () {
                that._connections--;
                if (that._connections < 0) {
                    that._connections = 0;
                }
                that.emit('conn_closed', that._connections, that._requests);
            });

            that.emit('connection', that._connections, that._requests);

            // in the case of http server
        } else if (args[0] === 'request') {

            req = args[1];
            resp = args[2];
            origEnd = resp.end;

            that._requests++;
            that._totalRequests++;
            that.emit('request', that._connections, that._requests, resp);

            resp.end = function () {
                that._requests--;
                if (that._requests < 0) {
                    that._requests = 0;
                }
                origEnd.apply(this, arguments);

                that.emit('req_end', that._connections, that._requests, req);
            };
        }
        origEmit.apply(this, arguments);
    };
};


// Instantiate the request counter
function setupReqCounter() {

    if (!reqCounter) {
        reqCounter = new ReqCounter();
    }

    if (!process.throttle) {
        process.throttle = {};
    }

    process.throttle.getRequestCount = function () {
        return reqCounter._requests;
    };

    process.throttle.getTotalRequestCount = function () {
        return reqCounter._totalRequests;
    };

    process.throttle.getTransferred = function () {
        return reqCounter._transfered;
    };

    process.throttle.getOpenConnections = function () {
        return reqCounter._connections;
    };
}

// Instantiate the MemoryController
function setupMemControl(config) {

    if (!config) {
        return;
    }
    var maxRequests = config.max_requests,
        maxMemory = config.max_memory;

    if (memCont) {
        // If object is already created
        // do not create again
        return;
    }

    if (maxRequests || maxMemory) {
        //else create a new instance
        memCont = new MemoryController(maxRequests, maxMemory, reqCounter);
    }
}


var Throttler = function (config) {
    // Initializations
    setupReqCounter();
    setupMemControl(config);
};

/*
 * All the servers need to be registered to compute the total number of requests
 * served by the application
 */
Throttler.prototype.addServer = function (server) {
    if (reqCounter) {
        reqCounter.addServer(server);
    }
};

/*
 * This allows the process to be started with just monitoring, and at a later point
 * application could decide to ask the process to be killed
 * upon reaching limits
 */
Throttler.prototype.setConfig = function (config) {
    if (!memCont) {
        setupMemControl(config);
        return;
    }
    if (config.max_requests) {
        memCont._maxRequests = config.max_requests;
    }
    if (config.max_memory) {
        memCont._maxMemory = config.max_memory;
    }
};

module.exports = Throttler;