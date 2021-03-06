"use strict";

DEPS.CliqzAttrackIntegrationTest = ["core/utils"];
TESTS.CliqzAttrackIntegrationTest = function(CliqzUtils) {
  var CLIQZ = CliqzUtils.getWindow().CLIQZ;
  if (!CLIQZ.app.modules.antitracking) {
    return;
  }
  var attrackBG = getModule("antitracking/background").default,
      CliqzHumanWeb = getModule("human-web/human-web").default,
      persist = getModule("core/persistent-state"),
      AttrackBloomFilter = getModule("antitracking/bloom-filter").AttrackBloomFilter,
      BloomFilter = getModule("antitracking/bloom-filter").BloomFilter,
      QSWhitelist = getModule("antitracking/qs-whitelists").default,
      datetime = getModule("antitracking/time"),
      trackertxt = getModule("antitracking/tracker-txt"),
      pipeline = getModule('webrequest-pipeline/background').default;
  var browser = getModule('core/browser');

  // make sure that module is loaded (default it is not initialised on extension startup)
  CliqzUtils.setPref('modules.antitracking.enabled', true);

  function getAttrack() {
    return getModule('antitracking/background').default.attrack;
  }

  describe('CliqzAttrack_integration', function() {
    this.retries(1);

    var echoed = [],
      md5 = CliqzHumanWeb._md5,
      module_enabled = CliqzUtils.getPref('modules.antitracking.enabled', true),
      window = CliqzUtils.getWindow(),
      hour = datetime.hourString(datetime.newUTCDate()),
      versionUnderTest = parseInt(getBrowserVersion().substring(0, 2));

    /** Collects metadata from the request and pushes it into the
      echoed array. Also sets cookie and access control headers.
    */
    var collect_request_parameters = function(request, response) {
      var r_obj = {
          method: request.method,
          host: request.host,
          path: request.path,
          qs: request.queryString
        },
        header_iter = request.headers,
        headers = {};

      while(header_iter.hasMoreElements()) {
        var header_name = header_iter.getNext().toString();
        headers[header_name] = request.getHeader(header_name);
      }
      r_obj['headers'] = headers;

      response.setHeader('Set-Cookie', 'uid=abcdefghijklmnop; Domain='+r_obj.host+'; Path=/');
      if(r_obj.host != "localhost") {
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Access-Control-Allow-Credentials', 'true');
      }

      // log request
      echoed.push(r_obj);
      console.log(r_obj);

      // prevent caching
      response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      response.setHeader('Pragma', 'no-cache');
      response.setHeader('Expires', '0');

      // send an appropriate response
      if (request.path.indexOf('.gif') > 0) {
        var imgFile = ['firefox-tests', 'mockserver', 'Transparent.gif'];
        console.log('send image');
        // send actual gif file
        testServer.writeFileResponse(request, imgFile, response);
      } else {
        response.write('{}');
      }
    }

    var attrackBloomFilterPref = null;

    before(function() {
      attrackBloomFilterPref = CliqzUtils.getPref('attrackBloomFilter');
    });

    var win = CliqzUtils.getWindow(),
              gBrowser = win.gBrowser,
              tabs = [];

    var openTestPage = function(testpage, domainname = 'localhost', requestId = '') {
      // open page in a new tab
      var url = "http://"+ domainname +":" + testServer.port + "/" + testpage + '?' + requestId;
      echoed = [];
      return browser.newTab(url).then((tabId) => { tabs.push(tabId); });
    };

    function setupAttrackTestServer() {
      // Add static resources from cliqz@cliqz.com/firefox-tests/mockserver directory
      testServer.registerDirectory('/', ['firefox-tests', 'mockserver']);
      testServer.registerDirectory('/bower_components/', ['bower_components']);
      // add specific handler for /test which will collect request parameters for testing.
      testServer.registerPathHandler('/test', collect_request_parameters);
      testServer.registerPathHandler('/test.gif', collect_request_parameters);

      var redirect302 = function(request, response) {
        console.log(request.path);
        response.setStatusLine('1.1', 302);
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        response.setHeader('Pragma', 'no-cache');
        response.setHeader('Expires', '0');
        var path = request.path.indexOf('.gif') > 0 ? 'test.gif' : 'test';
        response.setHeader('Location', 'http://127.0.0.1:'+ testServer.port +'/' + path + '?'+ request.queryString);
      };
      testServer.registerPathHandler('/tracker302', redirect302);
      testServer.registerPathHandler('/tracker302.gif', redirect302);
    }

    beforeEach(function() {
      setupAttrackTestServer();

      // clean preferences -> default everything to off, except Attrack module.
      getAttrack().config.cookieEnabled = false;
      getAttrack().config.qsEnabled = false;
      // clean tp_events
      return getAttrack().tp_events.commit(true).then(() => {
        getAttrack().tp_events._active = {};
        getAttrack().tp_events._staged = [];
        // clean up attrack caches
        getAttrack().recentlyModified.clear();
        getAttrack().urlWhitelist.whitelist.clear();

        // create 'up-to-date' whitelist
        getAttrack().qs_whitelist = new QSWhitelist();
        getAttrack().qs_whitelist.lastUpdate[0] = hour;
        getAttrack().qs_whitelist.lastUpdate[1] = hour;
        getAttrack().qs_whitelist.lastUpdate[2] = hour;
        getAttrack().qs_whitelist.lastUpdate[3] = hour;

        // enable token removal
        trackertxt.setDefaultTrackerTxtRule('replace');

        console.log("----- TEST ----");
      })// .then(() => getAttrack().initPipeline());
    });

    afterEach(function() {
      // close all tabs
      return Promise.all(
        tabs.map(tabId => browser.closeTab(tabId))
      ).then(() => { tabs = []; });
    });

    /** Helper function for testing each request to the /test endpoint after the expected
     *  number of requests have arrived. */
    var expectNRequests = function(n_requests, referrerId = '') {
      return {
        assertEach: function(test, done) {
          var _this = this;
          // wait for n_requests requests to be made to test path, then do tests on metadata
          this.then(function() {
            try {
              var e = _this._echoedFromTarget();
              chai.expect(e.length).to.equal(n_requests, "Number of requests exceeded.");
              for(var i=0; i<e.length; i++) {
                test(e[i]);
              }
              done();
            } catch(e) {
              done(e);
            }
          });
        },
        then: function(done) {
          waitFor(function() {
            return this._echoedFromTarget().length >= n_requests;
          }.bind(this)).then(function() {
            setTimeout(function() {
              done();
            }, 50);
          });
        },
        _echoedFromTarget: function() {
          if (!referrerId) {
            return echoed;
          } else {
            return echoed.filter( function(m) {
              return m.host != 'localhost' || m.headers.referer.indexOf(referrerId) > -1;
            });
          }
        }
      }
    };

    /** Asserts that the request metadata m contains the expected cookie value. */
    var hasCookie = function(m) {
      chai.expect(m.headers).to.have.property('cookie');
      chai.expect(m.headers['cookie']).to.contain('uid=abcdefghijklmnop');
    };

    /** Asserts that the request metadata m contains a cookie value iff the request
        was to localhost */
    var onlyLocalhostCookie = function(m) {
      if(m.host == 'localhost' || m.host == 'cliqztest.com') {
        chai.expect(m.headers).to.have.property('cookie');
        chai.expect(m.headers['cookie']).to.contain('uid=abcdefghijklmnop');
      } else {
        chai.expect(m.headers).to.not.have.property('cookie');
        // chai.expect(m.headers).to.have.property(getAttrack().cliqzHeader.toLowerCase());
      }
    };

    /** Asserts that the tp_event object from a request matches the provided specification */
    var test_tp_events = function(spec) {
      chai.expect(Object.keys(getAttrack().tp_events._active)).has.length(1);
      var tab_id = Object.keys(getAttrack().tp_events._active)[0],
        evnt = getAttrack().tp_events._active[tab_id];
      console.log(evnt, "xxx");
      // check first party is correct, and collected third parties match expectations
      chai.expect(evnt.url.split('?')[0]).to.eql(spec.url);
      chai.expect(evnt.tps).to.include.keys(Object.keys(spec.tps));
      // check expected third party contents
      for (var tp_domain in spec.tps) {
        // has all paths for this third party
        chai.expect(evnt.tps[tp_domain]).to.include.keys(Object.keys(spec.tps[tp_domain]));
        for (var tp_path in spec.tps[tp_domain]) {
          var expected_stats = spec.tps[tp_domain][tp_path],
            actual_stats = evnt.tps[tp_domain][tp_path];
          // must have all the stats we're testing
          //chai.expect(actual_stats).to.include.keys(Object.keys(expected_stats));
          for (var stat_key in actual_stats) {
            if (stat_key == 'paths' || stat_key == 'resp_ob' || stat_key == 'not_cached' || stat_key == 'cached') { continue; }
            // skip window_depth test for old FF versions
            if (stat_key.startsWith('window_depth') && versionUnderTest <= 38) { continue; }
            // stat should be 0 unless otherwise specified
            var expected = 0;
            if (stat_key in expected_stats) {
              expected = expected_stats[stat_key];
            } else if (stat_key === 'content_length') {
              continue;
            }
            chai.expect(actual_stats[stat_key]).to.equal(expected, 'tp_event['+ [tp_domain, tp_path, stat_key].join('][') +']');
          }
        }
      }
    };

    /** Helper class for generating tp_event expectations. */
    var tp_events_expectations = function(testpage, domainname = 'localhost') {
      this.url = "http://" + domainname + ":" + testServer.port + "/" + testpage;
      this.tps = page_specs[testpage].base_tps();
    }

    tp_events_expectations.prototype = {

      set_all: function(k, v) {
        this.if('c', 1).set(k, v);
      },

      if: function(test_k, test_v) {
        var self = this;
        return {
          set: function(set_k, set_v) {
            for (var tp in self.tps) {
              for (var path in self.tps[tp]) {
                var s = self.tps[tp][path];
                if(test_k in s && s[test_k] == test_v) {
                  s[set_k] = set_v;
                }
              };
            };
            return this;
          }
        }
      }
    };

    /** Specfies test pages, and the base expectations of these pages.
        The base_tps function provides an object describing the actions of the page, i.e.
        what third party resources should be requested, and what meta-data is expected in
        tp_events.
    */
    var page_specs = {
      'thirdpartyscript.html': {
        base_tps: function() {
          return {
            '127.0.0.1': {
              '/test': {
                'c': 1,
                'cookie_set': 1,
                'has_qs': 1,
                'type_2': 1,
                'content_length': 2,
                'status_200': 1,
                'scheme_http': 1,
                'window_depth_0': 1,
                'set_cookie_set': 1,
              }
            }
          }
        }
      },
      'injectedscript.html': {
        base_tps: function() {
          return {
            '127.0.0.1': {
              '/test': {
                'c': 1,
                'cookie_set': 1,
                'has_qs': 1,
                'type_2': 1,
                'content_length': 2,
                'status_200': 1,
                'scheme_http': 1,
                'window_depth_0': 1,
                'set_cookie_set': 1,
              }
            }
          }
        }
      },
      'imgtest.html': {
        base_tps: function() {
          return {
            '127.0.0.1': {
              '/test.gif': {
                'c': 1,
                'cookie_set': 1,
                'has_qs': 1,
                'type_3': 1,
                'content_length': 42,
                'status_200': 1,
                'scheme_http': 1,
                'window_depth_0': 1,
                'set_cookie_set': 1,
              }
            }
          }
        }
      },
      'crossdomainxhr.html': {
        base_tps: function() {
          return {
            '127.0.0.1': {
              '/test': {
                'c': 1,
                'cookie_set': 1,
                'has_qs': 1,
                'type_11': 1,
                'content_length': 2,
                'status_200': 1,
                'scheme_http': 1,
                'window_depth_0': 1,
                'set_cookie_set': 1,
              }
            }
          }
        }
      },
      'iframetest.html': {
        base_tps: function() {
          return {
            '127.0.0.1': {
              '/iframe.html': {
                'c': 1,
                'cookie_set': 1,
                'type_7': 1,
                'status_200': 1,
                'scheme_http': 1,
                'window_depth_1': 1,
                'set_cookie_set': 1,
              },
              '/test': {
                'c': 1,
                'cookie_set': 1,
                'has_qs': 1,
                'type_11': 1,
                'content_length': 2,
                'status_200': 1,
                'scheme_http': 1,
                'window_depth_1': 1,
                'set_cookie_set': 1,
              },
              '/bower_components/jquery/dist/jquery.js': {
                'c': 1,
                'type_2': 1,
                'cookie_set': 1,
                'status_200': 1,
                'scheme_http': 1,
                'window_depth_1': 1,
                'set_cookie_set': 1,
              }
            }
          }
        }
      },
      'image302test.html': {
        base_tps: function() {
          return {
            '127.0.0.1': {
              '/test.gif': {
                'c': 1,
                'cookie_set': 1,
                'has_qs': 1,
                'type_3': 1,
                'content_length': 42,
                'status_200': 1,
                'scheme_http': 1,
                'window_depth_0': 1,
                'set_cookie_set': 1,
              }
            }
          }
        }
      },
      'nestediframetest.html': {
        base_tps: function() {
          return {
            '127.0.0.1': {
              '/iframe2.html': {
                'c': 1,
                'cookie_set': 1,
                'type_7': 1,
                'status_200': 1,
                'scheme_http': 1,
                'window_depth_2': 1,
                'set_cookie_set': 1,
              },
              '/test': {
                'c': 1,
                'cookie_set': 1,
                'has_qs': 1,
                'type_11': 1,
                'content_length': 2,
                'status_200': 1,
                'scheme_http': 1,
                'window_depth_2': 1,
                'set_cookie_set': 1,
              },
              '/bower_components/jquery/dist/jquery.js': {
                'c': 1,
                'type_2': 1,
                'cookie_set': 1,
                'status_200': 1,
                'scheme_http': 1,
                'window_depth_2': 1,
                'set_cookie_set': 1,
              }
            },
            'cliqztest2.de': {
              '/proxyiframe.html': {
                'c': 1,
                'type_7': 1,
                'status_200': 1,
                'scheme_http': 1,
                'window_depth_1': 1,
                'set_cookie_set': 1,
              }
            }
          }
        }
      }
    };

    // Test each of the page_specs in various different configurations.
    Object.keys(page_specs).forEach(function (testpage) {
      // replaced by functional test, but still useful to have these cases
      // for manual testing
      describe.skip(testpage, function() {

        context('cookie tests', function() {

          before(function() {
            setupAttrackTestServer();

            var tmp_tabs;
            var tmp_tabs_urls = ['localhost', 'cliqztest.com'].map(function(d) {
              return "http://"+ d +":" + testServer.port + "/" + testpage;
            });

            var promise = waitFor(function () {
              var openUrls = [].slice.call(gBrowser.tabs).map(function (tab) {
                return tab.linkedBrowser.currentURI.spec;
              });
              return tmp_tabs_urls.every(function (url) {
                return openUrls.indexOf(url) !== -1;
              });
            }).then(function () {
              return Promise.all(
                tmp_tabs.map(function (t) {
                  return browser.closeTab(t);
                })
              );
            });

            // initial request to ensure cookies are set
            return Promise.all(
              tmp_tabs_urls.map(function (url) {
                return browser.newTab(url);
              })
            ).then((newTabs) => { tmp_tabs = newTabs; return promise; });
          });

          var testAllowsAllCookies = function(done) {
            return openTestPage(testpage).then(function () {
              // with no cookie blocking, all pages setting cookies should also set them.
              var tp_event_expectation = new tp_events_expectations(testpage);
              tp_event_expectation.if('cookie_set', 1).set('bad_cookie_sent', 1);

              expectNRequests(2).assertEach(hasCookie, function(e) {
                if(e) {
                  done(e);
                } else {
                  console.log(getAttrack().tokenExtWhitelist);
                  try {
                    test_tp_events(tp_event_expectation);
                    done();
                  } catch(e) { done(e); }
                }
              });
            });
          };

          context('cookie blocking disabled', function() {

            beforeEach(function() {
              getAttrack().config.cookieEnabled = true;
            });

            it('pref check', function() {
              chai.expect(getAttrack().isCookieEnabled()).to.be.false;
            });

            it('allows all cookies', testAllowsAllCookies);
          });

          context('cookie blocking enabled', function() {

            beforeEach(function() {
              getAttrack().config.cookieEnabled = true;
            });

            it('pref check', function() {
              chai.expect(getAttrack().isCookieEnabled()).to.be.true;
            });

            var test_domain = 'localhost',
              testBlockTPCookies = function(done) {
                return openTestPage(testpage, test_domain).then(function () {
                  // cookie blocking will be done by the 'tp1' block.
                  var tp_event_expectation = new tp_events_expectations(testpage, test_domain);
                  tp_event_expectation.if('cookie_set', 1).set('cookie_blocked', 1).set('cookie_block_tp1', 1).set('set_cookie_blocked', 1);

                  expectNRequests(2).assertEach(onlyLocalhostCookie, function(e) {
                    if(e) {
                      done(e);
                    } else {
                      try {
                        test_tp_events(tp_event_expectation);
                        done();
                      } catch(e) {
                        done(e);
                      }
                    }
                  });
                });
              };

            it('allows same-domain cookie and blocks third party domain cookie', function(done) {
              test_domain = 'localhost';
              testBlockTPCookies(done);
            });

            context('anti-tracking disabled for source domain', function() {

              beforeEach(function() {
                getAttrack().urlWhitelist.changeState('localhost', 'hostname', 'add');
              });

              afterEach(function() {
                getAttrack().urlWhitelist.changeState('localhost', 'hostname', 'remove');
              });

              it('allows all cookies on whitelisted site', testAllowsAllCookies);

              it('blocks cookies on other domains', function(done) {
                test_domain = 'cliqztest.com';
                testBlockTPCookies(done);
              });
            });
          });

        });

        var QSBlocking = function() {
          var uid = '04C2EAD03BAB7F5E-2E85855CF4C75134';
          beforeEach(function() {
            getAttrack().config.qsEnabled = true;
          });

          it('pref check', function() {
            chai.expect(getAttrack().isQSEnabled()).to.be.true;
            chai.expect(getAttrack().qs_whitelist.isTrackerDomain(md5('localhost').substring(0, 16))).to.be.false;
            chai.expect(getAttrack().qs_whitelist.isTrackerDomain(md5('127.0.0.1').substring(0, 16))).to.be.false;
          });

          it('allows query strings on domains not in the tracker list', function(done) {
            return openTestPage(testpage).then(function () {
              var tp_event_expectation = new tp_events_expectations(testpage);
              tp_event_expectation.if('cookie_set', 1).set('bad_cookie_sent', 1);

              expectNRequests(2).assertEach(function(m) {
                chai.expect(m.qs).to.contain('uid=' + uid);
                chai.expect(m.qs).to.contain('callback=func');
              }, function(e) {
                if(e) {
                  done(e);
                } else {
                  console.log(getAttrack().tp_events);
                  try {
                    test_tp_events(tp_event_expectation);
                    done();
                  } catch(e) { done(e); }
                }
              });
            });
          });

          describe('third party on tracker list', function() {

            beforeEach(function() {
              var tracker_hash = md5('127.0.0.1').substring(0, 16);
              getAttrack().qs_whitelist.addSafeToken(tracker_hash, "");
              getAttrack().pipelineSteps.tokenChecker.tokenDomain.clear();
            });

            it('pref check', function() {
              chai.expect(getAttrack().qs_whitelist.isTrackerDomain(md5('localhost').substring(0, 16))).to.be.false;
              chai.expect(getAttrack().qs_whitelist.isTrackerDomain(md5('127.0.0.1').substring(0, 16))).to.be.true;
            });

            it('allows QS first time on tracker', function(done) {
              return openTestPage(testpage).then(function () {
                var tp_event_expectation = new tp_events_expectations(testpage);
                tp_event_expectation.if('cookie_set', 1).set('bad_cookie_sent', 1);
                tp_event_expectation.if('has_qs', 1).set('token.has_qs_newToken', 1).set('token.qs_newToken', 1);

                expectNRequests(2).assertEach(function(m) {
                  chai.expect(m.qs).to.contain('uid=' + uid);
                  chai.expect(m.qs).to.contain('callback=func');
                }, function(e) {
                  if(e) {
                    done(e);
                  } else {
                    try {
                      test_tp_events(tp_event_expectation);
                      done();
                    } catch(e) {
                      done(e);
                    }
                  }
                });
              });
            });

            context('when domain count exceeded', function() {

              beforeEach(function() {
                // make an artificial tokenDomain list to trigger blocking
                var tok = md5(uid),
                  today = datetime.getTime().substr(0, 8);
                ['example.com', 'localhost', 'cliqz.com'].forEach(function(d) {
                  getAttrack().pipelineSteps.tokenChecker.tokenDomain.addTokenOnFirstParty(tok, md5(d).substring(0, 16));
                });
              });

              var test_domain = "localhost",
                testUIDisBlocked = function(done) {

                //chai.expect(getAttrack().getDefaultTrackerTxtRule()).to.equal('replace');

                var tp_event_expectation = new tp_events_expectations(testpage, test_domain);
                tp_event_expectation.if('cookie_set', 1).set('bad_cookie_sent', 1);
                tp_event_expectation.if('has_qs', 1).set('bad_tokens', 1).set('bad_qs', 1);
                // with an img tag we fallback to redirect, otherwise we just rewrite the channel URI.
                // with redirect we also see the cookie twice!
                if(testpage == "imgtest.html") {
                  tp_event_expectation.if('has_qs', 1).set('token_blocked_replace', 1).set('cookie_set', 2).set('bad_cookie_sent', 2);
                } else {
                  tp_event_expectation.if('has_qs', 1).set('token_blocked_replace', 1);
                }

                return openTestPage(testpage, test_domain).then(function () {
                  expectNRequests(2).assertEach(function(m) {
                    console.log(getAttrack().blockLog.tokenDomain._tokenDomain.value);
                    if(m.host == test_domain) {
                      chai.expect(m.qs).to.contain('uid=' + uid);
                    } else {
                      chai.expect(m.qs).to.not.contain('uid=' + uid);
                      // chai.expect(m.headers).to.have.property(getAttrack().cliqzHeader.toLowerCase());
                    }
                    chai.expect(m.qs).to.contain('callback=func');
                  }, function(e) {
                    if(e) {
                      console.log(getAttrack().tp_events);
                      done(e);
                    } else {
                      try {
                        test_tp_events(tp_event_expectation);
                        done();
                      } catch(e) {
                        done(e);
                      }
                    }
                  });
                });
              };

              it('blocks long tokens on tracker domain', function(done) {
                testUIDisBlocked(done);
              });

              it('does not block if safekey', function(done) {
                var key = md5('uid'),
                  tracker_hash = md5('127.0.0.1').substring(0, 16),
                  day = datetime.newUTCDate();

                getAttrack().qs_whitelist.addSafeKey(tracker_hash, key);

                var tp_event_expectation = new tp_events_expectations(testpage);
                tp_event_expectation.if('cookie_set', 1).set('bad_cookie_sent', 1);
                tp_event_expectation.if('has_qs', 1).set('token.safekey', 1).set('token.has_safekey', 1);

                return openTestPage(testpage).then(function () {
                  expectNRequests(2).assertEach(function(m) {
                    chai.expect(m.qs).to.contain('uid=' + uid);
                  }, function(e) {
                    if(e) {
                      done(e);
                    } else {
                      try {
                        test_tp_events(tp_event_expectation);
                        done();
                      } catch(e) {
                        done(e);
                      }
                    }
                  });
                });
              });

              it('blocks if key listed as unsafe', function(done) {
                var key = md5('uid'),
                  tracker_hash = md5('127.0.0.1').substring(0, 16),
                  day = datetime.newUTCDate();

                getAttrack().qs_whitelist.addSafeKey(tracker_hash, key);
                getAttrack().qs_whitelist.addUnsafeKey(tracker_hash, key);
                var tp_event_expectation = new tp_events_expectations(testpage);
                tp_event_expectation.if('cookie_set', 1).set('bad_cookie_sent', 1);
                if(testpage == "imgtest.html") {
                  tp_event_expectation.if('has_qs', 1).set('bad_qs', 1).set('bad_tokens', 1).set('token_blocked_replace', 1).set('cookie_set', 2).set('bad_cookie_sent', 2);
                }
                else {
                  tp_event_expectation.if('has_qs', 1).set('bad_qs', 1).set('bad_tokens', 1).set('token_blocked_replace', 1);
                }

                return openTestPage(testpage).then(function () {
                  expectNRequests(2).assertEach(function(m) {
                    console.log(getAttrack().blockLog.tokenDomain._tokenDomain.value);
                    if(m.host == test_domain) {
                      chai.expect(m.qs).to.contain('uid=' + uid);
                    } else {
                      chai.expect(m.qs).to.not.contain('uid=' + uid);
                      // chai.expect(m.headers).to.have.property(getAttrack().cliqzHeader.toLowerCase());
                    }
                    chai.expect(m.qs).to.contain('callback=func');
                  }, function(e) {
                    if(e) {
                      done(e);
                    } else {
                      try {
                        test_tp_events(tp_event_expectation);
                        done();
                      } catch(e) {
                        done(e);
                      }
                    }
                  });
                });
              });

              var allowWhiteListedToken = function(done) {
                var tok = md5(uid),
                  tracker_hash = md5('127.0.0.1').substring(0, 16),
                  day = datetime.newUTCDate();

                getAttrack().qs_whitelist.addSafeToken(tracker_hash, tok);

                var tp_event_expectation = new tp_events_expectations(testpage);
                tp_event_expectation.if('cookie_set', 1).set('bad_cookie_sent', 1);
                tp_event_expectation.if('has_qs', 1).set('token.whitelisted', 1).set('token.has_whitelisted', 1);

                return openTestPage(testpage, 'localhost', 'allowWhiteListedToken').then(function () {
                  expectNRequests(2, 'allowWhiteListedToken').assertEach(function(m) {
                    chai.expect(m.qs).to.contain('uid=' + uid);
                  }, function(e) {
                    if(e) {
                      done(e);
                    } else {
                      try {
                        test_tp_events(tp_event_expectation);
                        done();
                      } catch(e) {
                        done(e);
                      }
                    }
                  });
                });
              }

              it('does not block if whitelisted token', allowWhiteListedToken);

              context('anti-tracking disabled for source domain', function() {

                beforeEach(function() {
                  getAttrack().urlWhitelist.changeState('localhost', 'hostname', 'add');
                });

                afterEach(function() {
                  getAttrack().urlWhitelist.changeState('localhost', 'hostname', 'remove');
                });

                it('allows all tokens on whitelisted site', function(done) {
                  var rid = 'xxa';
                  return openTestPage(testpage, 'localhost', rid).then(function () {
                    var tp_event_expectation = new tp_events_expectations(testpage);
                    tp_event_expectation.if('cookie_set', 1).set('bad_cookie_sent', 1);
                    tp_event_expectation.if('has_qs', 1).set('bad_qs', 1).set('bad_tokens', 1).set('source_whitelisted', 1);

                    expectNRequests(2, rid).assertEach(function(m) {
                      chai.expect(m.qs).to.contain('uid=' + uid);
                      chai.expect(m.qs).to.contain('callback=func');
                    }, function(e) {
                      if(e) {
                        done(e);
                      } else {
                        try {
                          test_tp_events(tp_event_expectation);
                          done();
                        } catch(e) {
                          done(e);
                        }
                      }
                    });
                  });
                });

                it('still blocks tokens on other sites', function(done) {
                  test_domain = 'cliqztest.com';
                  testUIDisBlocked(done)
                });
              });
            });

            it('increments domain count when a tracker is visited', function(done) {
              getAttrack().obfuscateMethod = 'replace';
              getAttrack().pipelineSteps.tokenChecker.tokenDomain.clear();

              // open a page so that token domain will be incremented
              return openTestPage(testpage).then(function () {
                // open third page after a delay (so it will be after the first two)
                // the updated token domain list should cause a tracker block event.
                expectNRequests(2).assertEach(function(m) {
                  chai.expect(m.qs).to.contain('uid=' + uid);
                }, function(e) {
                  if(e) {
                    done(e);
                  } else {
                    echoed = [];
                    openTestPage(testpage, 'cliqztest.com').then(function () {
                      expectNRequests(2).assertEach(function(m) {
                        return true;
                      }, function(e) {
                        if(e) {
                          done(e);
                        } else {
                          var tok = md5(uid),
                              tokenDomain = getAttrack().blockLog.tokenDomain._tokenDomain.value;
                          chai.expect(tokenDomain).to.have.property(tok);
                          chai.expect(Object.keys(tokenDomain[tok])).to.have.length(2);
                          done();
                        }
                      });
                    });
                  }
                });
              });
            });
          }); // tp on tracker list
        };

        context("Bloom filter disabled", function() {
          beforeEach(function() {
            getAttrack().config.bloomFilterEnabled = false;
            // getAttrack().initPipeline();
          });
          describe('QS blocking enabled', QSBlocking);
        });

        context("Bloom filter enabled", function() {
          beforeEach(function() {
            getAttrack().config.bloomFilterEnabled = true;
            // add emptry bloom filter whitelist
            getAttrack().qs_whitelist = new AttrackBloomFilter();
            getAttrack().qs_whitelist.bloomFilter = new BloomFilter('0000000000000000000', 5);
            getAttrack().qs_whitelist.lastUpdate = hour;

            // getAttrack().initPipeline();
          });
          afterEach(function() {
            getAttrack().config.bloomFilterEnabled = false;
          });
          describe('QS blocking enabled', QSBlocking);
        });
      }); // describe testpage
    }); // for each page

    describe("local safeKey", function() {
      var win = CliqzUtils.getWindow(),
        gBrowser = win.gBrowser,
        tabs = [],
        testpage = 'localsafekey.html';

      beforeEach(function() {
        getAttrack().config.qsEnabled = true;
        getAttrack().config.safekeyValuesThreshold = 2;
        return waitFor(function() {
          return getAttrack().qs_whitelist && getAttrack().qs_whitelist.isReady();
        }).then(function() {
          return pipeline.init().then(() => getAttrack().initPipeline());
        });
      });

      it('adds local safekey if 3 different values seen', function(done) {
        var url_hash = md5('127.0.0.1').substring(0, 16),
            callback_hash = md5('callback'),
            uid_hash = md5('uid');
        // make loopback a tracker domain
        getAttrack().qs_whitelist.addSafeToken(url_hash, '');

        chai.expect(getAttrack().qs_whitelist.isSafeKey(url_hash, callback_hash)).to.be.false;
        chai.expect(getAttrack().qs_whitelist.isSafeKey(url_hash, uid_hash)).to.be.false;

        return openTestPage(testpage).then(function () {
          expectNRequests(3).then(function(m) {
            // the condition should pass within 1s
            var ctr = 0;
            var test = function() {
              try {
                chai.expect(getAttrack().qs_whitelist.isSafeKey(url_hash, callback_hash)).to.be.true;
                chai.expect(getAttrack().qs_whitelist.isSafeKey(url_hash, uid_hash)).to.be.false;
                done();
              } catch(e) {
                ctr++;
                if (ctr < 20) {
                  setTimeout(test, 50);
                } else {
                  done(e);
                }
              }
            };
            test();
          });
        });
      });

    });

  }); // describe integration test
};

TESTS.CliqzAttrackIntegrationTest.MIN_BROWSER_VERSION = 35;
