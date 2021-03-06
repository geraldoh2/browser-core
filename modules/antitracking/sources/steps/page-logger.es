

export default class {

  constructor(tpEvents) {
    this.tpEvents = tpEvents;
  }

  logMainDocument(state) {
    if (state.isFullPage()) {
      this.tpEvents.onFullPage(state.urlParts, state.tabId, state.isPrivate);
      // if (CliqzAttrack.isTrackerTxtEnabled()) {
      //   TrackerTXT.get(url_parts).update();
      // }
      return false;
    }
    return true;
  }

  attachStatCounter(state) {
    const urlParts = state.urlParts;
    const request = this.tpEvents.get(state.url, urlParts, state.sourceUrl, state.sourceUrlParts, state.tabId);
    state.reqLog = request;
    const incrementStat = (statName, c) => {
      this.tpEvents.incrementStat(request, statName, c || 1);
    }
    state.incrementStat = incrementStat;
    state.getPageAnnotations = this.tpEvents.getAnnotations.bind(this.tpEvents, state.tabId);

    // add triggeringPrinciple info
    const pageLoad = this.tpEvents._active[state.tabId];
    if (pageLoad && state.trigger) {
      pageLoad.addTrigger(urlParts.hostname, state.trigger);
    }

    return true;
  }

  logRequestMetadata(state) {
    const urlParts = state.urlParts;
    const incrementStat = state.incrementStat;

    // add metadata for this request
    incrementStat('c');
    if (urlParts.query.length > 0) {
      incrementStat('has_qs');
    }
    if (urlParts.parameters.length > 0) {
      incrementStat('has_ps');
    }
    if (urlParts.fragment.length > 0) {
      incrementStat('has_fragment');
    }
    if (state.method === 'POST') {
      incrementStat('has_post');
    }
    const displayContentType = (contentType) => (!contentType ? 'unknown': '' + contentType);
    incrementStat('type_' + displayContentType(state.cpt));

    // log protocol (secure or not)
    const isHTTP = protocol => protocol === "http" || protocol === "https"
    const scheme = isHTTP(urlParts.protocol) ? urlParts.protocol : "other";
    incrementStat('scheme_' + scheme);

    // find frame depth
    incrementStat('window_depth_' + state.getWindowDepth());

    return true;
  }

}
