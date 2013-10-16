# throttle

Nodejs module that monitors the total number of requests served by the process and the memory vsize consumed.
When asked to limit one or both of these (through configuration), this module will kill the process.

This module is best used in cluster mode where the master process would take care of bringing back the worker process,
up and running again.

This package is tested only with Node versions 8 and 10.

# install

With [npm](http://npmjs.org) do:

```
npm install process-throttle
```

# usage
```js
var http = require('http'),
    throttle = require('throttle');

//Set limits
var myThrottler = new throttler({
    'max_requests':2 
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


```

# Output

```
% node throttle-usage.js  &
% curl 'http://localhost.om:8000'
>> I have served 1 requests so far. My limit is 2
% curl 'http://localhost.om:8000'
>> I have served 2 requests so far. My limit is 2
>> Server received exit command, shutting down
```

# Build Status

[![Build Status](https://secure.travis-ci.org/yahoo/process-throttle.png?branch=master)](http://travis-ci.org/yahoo/process-throttle)

# Node Badge

[![NPM](https://nodei.co/npm/process-throttle.png)](https://nodei.co/npm/process-throttle/)
