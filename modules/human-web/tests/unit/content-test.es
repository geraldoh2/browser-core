/* global chai */
/* global describeModule */

const fs = require('fs');
const zlib = require('zlib');
const R = require('ramda');

function loadFixture(name) {
  const html = zlib.gunzipSync(fs.readFileSync(`modules/human-web/tests/unit/fixtures/${name}/page.html.gz`)).toString();
  const expectedAds = JSON.parse(fs.readFileSync(`modules/human-web/tests/unit/fixtures/${name}/expected-ads.json`, 'utf8'));
  return { html, expectedAds };
}

export default describeModule('human-web/content',
  () => ({
    'human-web/logger': {
      default: {
        debug() {},
        log() {},
        error() {},
      },
    },
  }),
  () => {
    const expect = chai.expect;

    describe('parseDom', () => {
      let parseDom;
      let mockWindow;

      beforeEach(function () {
        parseDom = this.module().parseDom;
        mockWindow = require('mock-browser').mocks.MockBrowser.createWindow();
      });

      afterEach(function () {
        delete global.chrome;
      });

      const checkDetectedAds = function checkDetectedAds({ html, expectedAds }) {
        // Given
        const someUrl = 'http://example.com';
        const someWindowId = 1;

        const document = mockWindow.document;
        document.open();
        document.write(html);
        document.close();

        let messagesReceived = [];
        let unexpectedMessages = [];
        global.chrome = {
          runtime: {
            sendMessage: (...args) => {
              if (args.length === 1 && typeof args[0] === 'object') {
                messagesReceived.push(args[0]);
              } else {
                unexpectedMessages.push(args);
              }
            }
          }
        };

        // When
        parseDom(someUrl, mockWindow, someWindowId);

        // Then
        expect(unexpectedMessages).to.be.empty;

        let foundAds;

        const adClickMessages = messagesReceived.filter((msg) => msg.payload && msg.payload.action === 'adClick');
        if (adClickMessages.length === 0) {
          foundAds = [];
        } else {
          expect(adClickMessages).to.have.lengthOf(1);
          const msg = adClickMessages[0];

          expect(msg.source).to.be.a('string');
          expect(msg.windowId).to.equal(someWindowId);
          expect(msg.payload).to.include({
            module: 'human-web',
            action: 'adClick'
          });

          expect(msg.payload.args).to.have.length(1);
          const adDetails = msg.payload.args[0].ads;

          foundAds = Object.keys(adDetails)
            .map((key) => ({ key, url: adDetails[key].furl[1] }));
        }

        // To get a sane error message, only show a few examples.
        // Otherwise, it difficult to interpret the error messages.
        const numExamples = 4;
        const unexpectedAds = R.differenceWith(R.equals, foundAds, expectedAds);
        const missingAds    = R.differenceWith(R.equals, expectedAds, foundAds);
        if (unexpectedAds.length > 0 || missingAds.length > 0) {

          // uncomment to export expectations:
          // fs.writeFileSync('/tmp/failing-test-expected-ads.json', JSON.stringify(foundAds));

          let errorMsg = 'Failed to correctly detect the ads:';
          if (unexpectedAds.length > 0) {
            const examples = R.take(numExamples, R.sortWith([R.prop('key'), R.prop('url')], unexpectedAds));
            examples.forEach((example) => {
              errorMsg += `\n- This should not have detected: ${JSON.stringify(example)}`;
            });
          }
          if (missingAds.length > 0) {
            const examples = R.take(numExamples, R.sortWith([R.prop('key'), R.prop('url')], missingAds));
            examples.forEach((example) => {
              errorMsg += `\n- This was overlooked:           ${JSON.stringify(example)}`;
            });
          }
          const stats = {
            "found": {
              "#total": foundAds.length,
              "#urls": R.uniq(foundAds.map((x) => x.url)).length
            },
            "expected": {
              "#total": expectedAds.length,
              "#urls": R.uniq(expectedAds.map((x) => x.url)).length
            }
          };
          errorMsg += `\nSummary: ${JSON.stringify(stats)}`;
          throw new Error(errorMsg);
        }

        // sanity check: at this point, it should never fail
        expect(foundAds).to.deep.equals(expectedAds);
      };

      it('should not find any ads on a blank page', function () {
        checkDetectedAds({
          html: '<!DOCTYPE html><html lang="en"><head></head><body></body></html>',
          expectedAds: []
        });
      });

      // some regression tests
      it('should find all shoe ads on the Google results page of "Schuhe kaufen"', function () {
        checkDetectedAds(loadFixture('shoe-ads'));
      });

      it('should find all potato ads on the Google results page of "Kartoffeln kaufen"', function () {
        checkDetectedAds(loadFixture('potato-ads'));
      });

      it('should find all coffee ads on the Google results page of "Der beste Kaffee der Welt"', function () {
        checkDetectedAds(loadFixture('coffee-ads'));
      });

      it('should find nothing on a Google results page without ads (2017-09-21)', function () {
        checkDetectedAds(loadFixture('page-with-no-ads-2017-09-21'));
      });

      it('should find nothing on a Google results page without ads (2017-10-19)', function () {
        checkDetectedAds(loadFixture('page-with-no-ads-2017-10-19'));
      });

      it('should find all flight ads on the Google results page of "flight paris to london" (2017-09-21)', function () {
        checkDetectedAds(loadFixture('flight-page-2017-09-21'));
      });

      // TODO: sponsored links for flights are currently not detected
      // (They are a special case, as there is also no 'aclk' links on the page.)
      it('(status quo) sponsored links for flights are not detected (searching for "flight paris to london") (2017-10-19)', function () {
        checkDetectedAds(loadFixture('flight-page-2017-10-19'));
      });

      it('Android user agent: page without ads', function () {
        checkDetectedAds(loadFixture('android-user-agent-page-without-ads'));
      });

      // Note: I leave this test in, but only as a documentation if we
      // want to support mobile. It is not meant to define what is expected.
      // Even though the page/ shows ads, the list of expected urls in this
      // test is empty.
      //
      // On mobile, the mechanism is different from Desktop. The target url
      // does not show up the original html, instead you are redirected by
      // the Google link.
      //
      // To support it on Android, we would have to aggregate the state
      // between the redirects. In the example that I looked at there
      // were in total eight redirects until you finally end up on the
      // landing page of the shop. Ignoring internal redirects, it looked
      // like this:
      //
      //    https://www.googleadservices.com/pagead/aclk?...
      // -> http://clickserve.dartsearch.net/...
      // -> https://clickserve.dartsearch.net/...
      // -> https://clickserve.dartsearch.net/...
      // -> https://ad.doubleclick.net/...
      // -> https://www.jdsports.de/product/schwarz-adidas...
      //
      it('(status quo) Android user agent: page with ads', function () {
        checkDetectedAds(loadFixture('android-user-agent-page-with-ads'));
      });
    });
  }
);
