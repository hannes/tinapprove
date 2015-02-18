var Q = require('q');
var cheerio = require('cheerio');
var request = require('request');
var readline = require('readline');
var fs = require('fs');


request = request.defaults({jar: true, useQuerystring: true});

var rl;
var writeFile = Q.denodeify(fs.writeFile);
var readFile  = Q.denodeify(fs.readFile);

function getUserHome() {
  return process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE;
}

var username = '';
var password = '';
var fname = getUserHome() + '/.tinapprove';

var loginurl = 'https://tina.cwi.nl/Synergy/Nlogon.aspx';
var workfurl = 'https://tina.cwi.nl/Synergy/docs/WflRequests.aspx';
var lgouturl = 'https://tina.cwi.nl/Synergy/docs/SysClearSession.aspx';

var approved = 0;

function cp(prompt) {
	var deferred = Q.defer();
	rl.question(prompt, function(answer) {
		deferred.resolve(answer);
	});
	return deferred.promise;
}

function rq(opts) {
	var deferred = Q.defer();
	request(opts, function(error, response, body) {
		 if (error || response.statusCode != 200) {
		 	deferred.reject(error);
		 }
		 else {
		 	deferred.resolve(body);
		 }
	});
	return deferred.promise;
}


readFile(fname).then(function(fcontent) {
	console.log('Using credentials from ' + fname);
	var up = JSON.parse(fcontent);
	username = up.username;
	password = up.password;
	return true;
}, function(err) {
 	rl = readline.createInterface({input: process.stdin, output: process.stdout});
	return cp('CWI username: ').then(function(nu) {
		username = nu;
		return cp('Password    : ');
	}).then(function(np) {
		password = np;
		return cp('Save both to ' + fname + '? [y/N] ');
	}).then(function(yn) {
		rl.close();
		if (yn.toLowerCase() == 'y') {
			return writeFile(fname, JSON.stringify({username: username, password: password}));
		} else {
			return true;
		}
	});
}).then(function(we) { 
	// start the http action
	return rq({url: loginurl});
}).then(function(loginpage) {
	var $ = cheerio.load(loginpage);
	var loginformfields = {};
	$('#form1 input').each(function(i, input) {
		loginformfields[$(input).attr('name')] = $(input).attr('value');
	});
	loginformfields.UserName = username;
	loginformfields.UserPass = password;
	return rq({url: loginurl, method: 'POST', formData: loginformfields, followAllRedirects: true});
}).then(function(loginresponse) {
	if (loginresponse.indexOf('Tina Login Page') > 0) {
		throw new Error('Authentication error. Perhaps remove ' + fname + '?');
	}
	return rq({url: workfurl});
}).then(function(wfpage) {
	var $ = cheerio.load(wfpage);
	var workflowformfields = {};
	$('#frm input').each(function(i, input) {
		var val = $(input).attr('value');
		if (val != undefined) {
			workflowformfields[$(input).attr('name')] = $(input).attr('value');
		}
	});
	workflowformfields['List$chkTick'] = [];
	$('#List_Header tr').each(function(i, tr) {
		var date;
		var action;
		var id;
		$(tr).find('td').each(function(j, td) {
			if (j == 0) {
				id = $(td).find('input').val();
			}
			if (j == 1) {
				date = $(td).text();
			}
			if (j == 3) {
				action = $(td).text();
			}
		});
		if (!id) return;
		if (action != 'Approve') return;
		var dateo = Date.parse(date.substring(6,10) + '-' + date.substring(3,5) + '-' + date.substring(0,2));
		if (dateo < new Date()) {
			workflowformfields['List$chkTick'].push(id);
			approved++;
		}
	});
	workflowformfields.BulkAction = 1; // "Bulk Approve"
	if (workflowformfields['List$chkTick'].length > 0) {
		return rq({url: workfurl, method: 'POST', formData: workflowformfields});
	} else {
		return true;
	}
}).then(function(postresponse){
	return rq({url: lgouturl});
}).then(function(logoutresponse) {
	console.log('OK, ' + approved + ' days approved.');
}, function(err) {
	console.error(err);
});