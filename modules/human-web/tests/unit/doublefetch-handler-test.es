/* global chai */
/* global describeModule */

const State = {
  DISABLED: 'DISABLED',
  INITIALIZING: 'INITIALIZING',
  READY: 'READY'
};

const mocks = {};
const expect = chai.expect;

function resetMocks() {
  mocks.getRequest = sinon.stub().resolves('');

  // simplified model: keeps track of installed headers, but makes the
  // assumption that only 'onHeadersReceived' (with spec='blocking') is used
  mocks._onHeadersReceivedHandlers = [];
  mocks.WebrequestPipelineStub = {
    isReady: () => {
      return Promise.resolve();
    },
    action: (method, event, arg) => {
      return Promise.resolve().then(() => {
        if (method === 'addPipelineStep' && event === 'onHeadersReceived') {
          expect(arg).to.have.all.keys('name', 'spec', 'fn');

          mocks._onHeadersReceivedHandlers.push(arg);
        } else if (method === 'removePipelineStep' && event === 'onHeadersReceived') {
          // here, "arg" is the name of the handler to be removed
          mocks._onHeadersReceivedHandlers = mocks._onHeadersReceivedHandlers.filter(x => x.name !== arg);
        } else {
          throw new Error(`Unexpected communication with request-pipeline: ${method}, ${event}, ${arg}`);
        }
      });
    }
  };
};

// Mocks the "getRequest" function and simulates calls
// to the registered "onHeadersReceived" handler.
//
// Expects a mapping from urls to a description of how
// the mocked "getRequest" should respond.
//
// Optionally, it allows to simulate other unrelated requests
// which will also call the "onHeadersReceived" handler.
// The code under test is expected to ignore these unrelated
// requests.
//
function scriptedRequests(scriptRequests, opts={}) {

  const mkFakeRequestContext = (url, requestInfo) => {
    const request = {
      responseHeaders: requestInfo.responseHeaders || [],
      statusCode: requestInfo.statusCode || 200,
      tabId: requestInfo.tabId || -1,
      url: requestInfo.overwrittenUrl || url,
      requestId: uniqueId++,

      getResponseHeader: function(name) {
        return request.responseHeaders
          .filter(x => x.name.toLowerCase() === name.toLowerCase())
          .map(x => x.value)[0];
      }
    };
    return request;
  };
  const mkFakeResponse = function() {
    return {
      block() {
        this.cancel = true;
      }
    };
  };

  let uniqueId = 1;
  mocks.getRequest = (url) => {
    const requestInfo = scriptRequests[url];
    if (requestInfo && mocks._onHeadersReceivedHandlers.length > 0) {
      // If more than one handler was registered, something went wrong.
      // So, ignore that case and assume that there is at most one handler.
      expect(mocks._onHeadersReceivedHandlers).to.have.lengthOf(1);
      const handler = mocks._onHeadersReceivedHandlers[0].fn;

      const response = mkFakeResponse();
      const fakeRequestContext = mkFakeRequestContext(url, requestInfo);

      // Simulate some other requests that have nothing to do with the current
      // doublefetch request. This requests should not be cancelled.
      const otherRequests = opts.simulateNonDoublefetchRequests || [];
      for (const otherUrl of otherRequests) {
        const otherResponse = mkFakeResponse();
        const proceed = handler(mkFakeRequestContext(otherUrl, scriptRequests[otherUrl]),
                                otherResponse);

        const wasAborted = !proceed || otherResponse.cancel;
        if (wasAborted && scriptRequests[otherUrl].onCancel) {
          scriptRequests[otherUrl].onCancel();
        }
      }

      // now back to the actual doublefetch request
      const proceed = handler(fakeRequestContext, response) !== false;

      const wasCancelled = !!response.cancel;
      expect(wasCancelled === !proceed).to.be.true;

      if (wasCancelled) {
        if (requestInfo.onCancel) {
          requestInfo.onCancel();
        }
        return Promise.reject(`${url} was aborted`);
      }

      if (requestInfo.statusCode &&
          requestInfo.statusCode >= 300 && requestInfo.statusCode < 400 &&
          requestInfo.responseHeaders) {

        for (const redirectTo of requestInfo.responseHeaders
                   .filter(x => x.name.toLowerCase() === 'location')
                   .map(x => x.value)) {
          return mocks.getRequest(redirectTo);
        }
      }
    }

    return Promise.resolve(`dummy content of ${url}`);
  };
}

export default describeModule('human-web/doublefetch-handler',
  () => ({
    'platform/human-web/doublefetch': {
      default: {
        getRequest: (...args) => mocks.getRequest(...args)
      },
      getRequest: (...args) => mocks.getRequest(...args)
    },
    'core/url': {
      // TODO: we could nice to use the real implementation, but that
      // is not so easy. This is an oversimplified implementation, but
      // for testing purposes, it should be sufficient.
      equals: (url1, url__) => url1 === url__
    },
    'core/kord/inject': {
      default: {
        module: (name) => {
          if (name === 'webrequest-pipeline') {
            return mocks.WebrequestPipelineStub;
          }
          throw new Error(`Stubbing error: ${name}`);
        }
      }
    },
    'human-web/logger': {
      default: {
        debug() {},
        log() {},
        error() {},
      }
    },
  }),
  () => {

    describe('DoublefetchHandler', function () {
      let DoublefetchHandler;
      let uut;

      beforeEach(function () {
        DoublefetchHandler = this.module().default;
        resetMocks();

        uut = new DoublefetchHandler();
      });

      afterEach(function () {
        return uut.unload();
      });

      it('should initially be disabled', function() {
        expect(uut._state).to.equal(State.DISABLED);
      });

      it('should init and unload successfully', function() {
        return Promise.resolve()
          .then(() => { expect(uut._state).to.equal(State.DISABLED); })
          .then(() => uut.init())
          .then(() => { expect(uut._state).to.equal(State.READY); })
          .then(() => uut.unload())
          .then(() => { expect(uut._state).to.equal(State.DISABLED); })
          .then(() => uut.init())
          .then(() => { expect(uut._state).to.equal(State.READY); });
      });

      it('init/unload should be safe to call multiple times in a row', function() {
        return Promise.resolve()
          .then(() => uut.unload())
          .then(() => uut.unload())
          .then(() => uut.init())
          .then(() => uut.init())
          .then(() => uut.unload())
          .then(() => uut.unload())
          .then(() => uut.init())
          .then(() => { expect(uut._state).to.equal(State.READY); })
          .then(() => uut.unload())
          .then(() => { expect(uut._state).to.equal(State.DISABLED); });
      });

      it('should never end up in an inconsistent state', function() {
        const uncoordinatedStartStopAttempts = [
          uut.init(),
          uut.init(),
          uut.unload(),
          uut.init(),
          uut.unload()];

        // should still be able to recover from the mess above
        return Promise.all(uncoordinatedStartStopAttempts)
          .then(() => uut.init())
          .then(() => { expect(uut._state).to.equal(State.READY); })
          .then(() => uut.unload())
          .then(() => { expect(uut._state).to.equal(State.DISABLED); });
      });

      it('should reject requests when state is DISABLED', function() {
        expect(uut._state).to.equal(State.DISABLED);

        let wasRejected = false;
        return uut.anonymousHttpGet('http://dummy.test')
          .catch(() => {
            wasRejected = true;
          }).then(() => {
            expect(wasRejected).to.be.true;
            expect(mocks.getRequest.called).to.be.false;
          });
      });

      it('should send requests when state is INITIALIZED', function() {
        return uut.init()
          .then(() => uut.anonymousHttpGet('http://dummy.test'))
          .then(() => {
            expect(mocks.getRequest.called).to.be.true;
          });
      });

      it('should send requests when state is INITIALIZED', function() {
        return uut.init()
          .then(() => uut.anonymousHttpGet('http://dummy.test'))
          .then(() => {
            expect(mocks.getRequest.called).to.be.true;
          });
      });

      it('should set "maxDoubleFetchSize"', function() {
        expect(uut.maxDoubleFetchSize).to.be.at.least(0);
      });

      it('should abort huge requests', function() {
        // scenario: 300MB request should be cancelled assuming our limit is 2MB
        let wasCancelled = false;
        scriptedRequests({
          'http://dummy.test': {
            responseHeaders: [{ name: 'Content-Length', value: '300000000' }],
            onCancel: () => { wasCancelled = true; }
          }
        });
        uut.maxDoubleFetchSize = 2 * 1024 * 1024;

        let doublefetchFailed = false;
        return uut.init()
          .then(() => uut.anonymousHttpGet('http://dummy.test'))
          .catch(() => { doublefetchFailed = true; })
          .then(() => {
            expect(wasCancelled).to.be.true;
            expect(doublefetchFailed).to.be.true;
          });
      });

      it('should allow small double fetch requests', function() {

        // scenario: 100K request should be allowed to complete assuming our limit is 2MB
        let wasCancelled = false;
        scriptedRequests({
          'http://dummy.test': {
            responseHeaders: [{ name: 'Content-Length', value: '100000' }],
            onCancel: () => { wasCancelled = true; }
          }
        });
        uut.maxDoubleFetchSize = 2 * 1024 * 1024;

        let doublefetchFailed = false;
        return uut.init()
          .then(() => uut.anonymousHttpGet('http://dummy.test'))
          .catch(() => { doublefetchFailed = true; })
          .then(() => {
            expect(wasCancelled).to.be.false;
            expect(doublefetchFailed).to.be.false;
          });
      });

      it('should should follow redirects, but block following request if it is too big', function() {
        this.timeout(1000000000);debugger;

        let cancelledBeforeRedirect = false;
        let cancelledAfterRedirect = false;
        scriptedRequests(
          {
            'https://goo.gl/xyz': {
              responseHeaders: [{ name: 'Location', value: 'http://dummy.test' }],
              statusCode: 301,
              onCancel: () => { cancelledBeforeRedirect = true; }
            },
            'http://dummy.test': {
              responseHeaders: [{ name: 'Content-Length', value: '1000000' }],
              onCancel: () => { cancelledAfterRedirect = true; }
            },
          });
        uut.maxDoubleFetchSize = 10;

        let doublefetchFailed = false;
        return uut.init()
          .then(() => uut.anonymousHttpGet('http://dummy.test'))
          .catch(() => { doublefetchFailed = true; })
          .then(() => {
            expect(cancelledBeforeRedirect).to.be.false;
            expect(cancelledAfterRedirect).to.be.true;
            expect(doublefetchFailed).to.be.true;
          });
      });

      it('should should follow redirects and allow following request if it is small', function() {

        let cancelledBeforeRedirect = false;
        let cancelledAfterRedirect = false;
        scriptedRequests(
          {
            'https://goo.gl/xyz': {
              responseHeaders: [{ name: 'Location', value: 'http://dummy.test' }],
              statusCode: 301,
              onCancel: () => { cancelledBeforeRedirect = true; }
            },
            'http://dummy.test': {
              responseHeaders: [{ name: 'Content-Length', value: '1' }],
              onCancel: () => { cancelledAfterRedirect = true; }
            },
          });
        uut.maxDoubleFetchSize = 10;

        let doublefetchFailed = false;
        return uut.init()
          .then(() => uut.anonymousHttpGet('http://dummy.test'))
          .catch(() => { doublefetchFailed = true; })
          .then(() => {
            expect(cancelledBeforeRedirect).to.be.false;
            expect(cancelledAfterRedirect).to.be.false;
            expect(doublefetchFailed).to.be.false;
          });
      });

      it('should never block non-doublefetch requests (scenario: doublefetch cancelled)', function() {
        let cancelledDoublefetchRequest = false;
        let cancelledWrongRequests = false;
        scriptedRequests(
          {
            'http://doublefetch.test': {
              responseHeaders: [{ name: 'Content-Length', value: '10000' }],
              onCancel: () => { cancelledDoublefetchRequest = true; }
            },
            'https://api.cliqz.test/foo': {
              responseHeaders: [{ name: 'Content-Length', value: '10000' }],
              onCancel: () => { cancelledWrongRequests = true; }
            },
            'https://api.cliqz.test/bar': {
              responseHeaders: [{ name: 'Content-Length', value: '10000' }],
              onCancel: () => { cancelledWrongRequests = true; }
            },
          },
          {
            simulateNonDoublefetchRequests: ['https://api.cliqz.test/foo', 'https://api.cliqz.test/bar']
          });
        uut.maxDoubleFetchSize = 10;

        let doublefetchFailed = false;
        return uut.init()
          .then(() => uut.anonymousHttpGet('http://doublefetch.test'))
          .catch(() => { doublefetchFailed = true; })
          .then(() => {
            expect(doublefetchFailed).to.be.true;
            expect(cancelledDoublefetchRequest).to.be.true;
            expect(cancelledWrongRequests).to.be.false;
          });
      });

      it('should never block non-doublefetch requests (scenario: doublefetch passed)', function() {

        let cancelledDoublefetchRequest = false;
        let cancelledWrongRequests = false;
        scriptedRequests(
          {
            'http://doublefetch.test': {
              responseHeaders: [{ name: 'Content-Length', value: '1' }],
              onCancel: () => { cancelledDoublefetchRequest = true; }
            },
            'https://api.cliqz.test/foo': {
              responseHeaders: [{ name: 'Content-Length', value: '10000' }],
              onCancel: () => { cancelledWrongRequests = true; }
            },
            'https://api.cliqz.test/bar': {
              responseHeaders: [{ name: 'Content-Length', value: '10000' }],
              onCancel: () => { cancelledWrongRequests = true; }
            },
          },
          {
            simulateNonDoublefetchRequests: ['https://api.cliqz.test/foo', 'https://api.cliqz.test/bar']
          });
        uut.maxDoubleFetchSize = 10;

        let doublefetchFailed = false;
        return uut.init()
          .then(() => uut.anonymousHttpGet('http://doublefetch.test'))
          .catch(() => { doublefetchFailed = true; })
          .then(() => {
            expect(doublefetchFailed).to.be.false;
            expect(cancelledDoublefetchRequest).to.be.false;
            expect(cancelledWrongRequests).to.be.false;
          });
      });

    });
  }
);
