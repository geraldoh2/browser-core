import {
  registerContentScript,
  CHROME_MSG_SOURCE,
  isCliqzContentScriptMsg,
} from '../core/content/helpers';

import CosmeticsInjection from '../core/adblocker-base/cosmetics-injection';
import platform from '../platform/platform';

registerContentScript('http*', (window, chrome, windowId) => {
  const url = window.location.href;
  if (!url) { return; }

  /**
   * Helper used to trigger action from the adblocker's background:
   * @param {string} action - name of the action found in the background.
   * @param {array} args - arguments to forward to the action.
   */
  const backgroundAction = (action, ...args) => {
    chrome.runtime.sendMessage({
      source: CHROME_MSG_SOURCE,
      windowId,
      payload: {
        module: 'adblocker',
        action,
        args,
      }
    });
  };

  /**
   * This class is in charge of managing the adblocking in content script:
   * - Script injection.
   * - Script blocking.
   * - CSS injection.
   * - Observing mutations in the page.
   */
  const cosmeticsInjection = new CosmeticsInjection(url, window, backgroundAction);

  // ------------------ //
  // Register listeners //
  // ------------------ //

  const onDOMContentLoaded = () => {
    cosmeticsInjection.onDOMContentLoaded();
  };

  const onMessage = (msg) => {
    // On chromium platform the windowid is a fake on (always === 1),
    // instead the message is sent to the tab through `tabs.sendMessage`
    const sameSourceWindow = msg.windowId === windowId || platform.isChromium;
    if (isCliqzContentScriptMsg(msg) && sameSourceWindow &&
        msg.response && msg.module === 'adblocker') {
      cosmeticsInjection.handleResponseFromBackground(msg.response);
    }
  };

  const onUnload = () => {
    cosmeticsInjection.unload();
    window.removeEventListener('DOMContentLoaded', onDOMContentLoaded);
    window.removeEventListener('unload', onUnload);
    chrome.runtime.onMessage.removeListener(onMessage);
  };

  window.addEventListener('DOMContentLoaded', onDOMContentLoaded);
  window.addEventListener('unload', onUnload);
  chrome.runtime.onMessage.addListener(onMessage);
});
