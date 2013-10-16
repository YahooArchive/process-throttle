/*
 * Copyright (c) 2013, Yahoo! Inc. All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */
var http = require('http'),
    net = require('net'),
    throttler = require('../lib/throttle.js');


var max_requests = 2,
    myThrottler = new throttler({
        'max_requests': max_requests 
    });

process.on('exit', function () {
    console.log('Server received exit command, shutting down\n');
});

var server = http.createServer(function(req, res) {
   res.writeHead(200);
   res.end("I have served " + process.throttle.getTotalRequestCount() + " requests so far. My limit is " + max_requests + "\n");
}).listen(8000);

// Add servers that need to monitor, to the throttler
myThrottler.addServer(server);

/*
//Running this example
% node throttle-usage.js  &
% curl 'http://localhost.om:8000'
>> I have served 1 requests so far. My limit is 2
% curl 'http://localhost.om:8000'
>> I have served 2 requests so far. My limit is 2
>> Server received exit command, shutting down
*/

