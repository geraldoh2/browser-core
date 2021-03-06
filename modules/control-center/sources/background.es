import ToolbarButton from '../core/ui/toolbar-button';
import config from '../core/config';
import { getMessage } from '../core/i18n';
import background from '../core/base/background';

const DD_HEIGHT = {
  'FC01': 246, // funnelcake
  '04': 379,   // amo
  '40': 419,   // Q browser
};

export default background({
  init(settings) {
    this.settings = settings;

    // we need to hide the toolbarBuuton in the FunnelCake build
    if (this.settings.id !== 'funnelcake@cliqz.com') {
      this.toolbarButton = new ToolbarButton({
        widgetId: 'control-center',
        default_title: getMessage('control-center-icon-tooltip'),
        default_popup: `${config.baseURL}control-center/index.html`,
        badgeBackgroundColor: '#471647',
        badgeText: '0',
        defaultHeight: DD_HEIGHT[this.settings.channel] || 246
      });
      this.toolbarButton.build();
    }

    if (this.settings.id === 'funnelcake@cliqz.com' || this.settings.id === 'description_test@cliqz.com') {
      this.pageAction = new ToolbarButton({
        widgetId: 'page-action',
        default_title: getMessage('control-center-icon-tooltip'),
        default_popup: `${config.baseURL}control-center/index.html`,
        default_icon: `${config.baseURL}control-center/images/search-settings-black.png`,
        defaultHeight: 251
      }, true);
      this.pageAction.build();
    }
  },

  unload() {
    if (this.toolbarButton) {
      this.toolbarButton.shutdown();
    }

    if (this.pageAction) {
      this.pageAction.shutdown();
    }
  },

  beforeBrowserShutdown() {

  },
  events: {

  },
  actions: {

  },
});
