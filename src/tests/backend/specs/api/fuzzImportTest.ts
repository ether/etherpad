/*
 * Fuzz testing the import endpoint
 */
/*
const common = require('../../common');
const froth = require('mocha-froth');
const request = require('request');
const settings = require('../../../container/loadSettings.js').loadSettings();

const host = "http://" + settings.ip + ":" + settings.port;

var apiVersion = 1;
var testPadId = "TEST_fuzz" + makeid();

var endPoint = function(point, version){
  version = version || apiVersion;
  return '/api/'+version+'/'+point+'?apikey='+apiKey;
}

//console.log("Testing against padID", testPadId);
//console.log("To watch the test live visit " + host + "/p/" + testPadId);
//console.log("Tests will start in 5 seconds, click the URL now!");

setTimeout(function(){
  for (let i=1; i<5; i++) { // 5000 runs
    setTimeout( function timer(){
      runTest(i);
    }, i*100 ); // 100 ms
  }
  process.exit(0);
},5000); // wait 5 seconds

function runTest(number){
  request(host + endPoint('createPad') + '&padID=' + testPadId, function(err, res, body){
    var req = request.post(host + '/p/'+testPadId+'/import', function (err, res, body) {
      if (err) {
        throw new Error("FAILURE", err);
      }else{
        console.log("Success");
      }
    });

    var fN = '/tmp/fuzztest.txt';
    var cT = 'text/plain';

    if (number % 2 == 0) {
      fN = froth().toString();
      cT = froth().toString();
    }

    let form = req.form();

    form.append('file', froth().toString(), {
      filename: fN,
      contentType: cT
    });
console.log("here");
  });
}

function makeid() {
  var text = "";
  var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  for( var i=0; i < 5; i++ ){
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
*/
