// ==UserScript==
// @name        NaviButton.uc.js
// @description Customizes the navigation buttons with an enhanced tooltip
// @include     main
// ==/UserScript==

// @require Util.uc.js
// @require [optional][for referrer] TabEx.uc.js
// @note some default functions are modified. see @modified

/**
 * @usage
 * Click: go back or forward a step if the history exists
 * Shift+Click: go to the border of the same domain of the current page
 * Ctrl+Click: go to the stop of history
 * @note a new tab will open in *fore*ground with 'middle button click'
 *
 * special usage for the *back* button with a referrer
 * Shift+Ctrl+Click: select or open a tab in the referrer URL
 * @note does the same action with 'Click' if no backward and disabled
 * @note a new tab will open in *back*ground with 'middle button click'
 *
 * @see |History.jump()|
 */


(function(window, undefined) {


"use strict";


/**
 * Imports
 */
const {
  createNode: $E,
  getNodeById: $ID
} = window.ucjsUtil;

// for debug
function log(aMsg) {
  return window.ucjsUtil.logMessage('NaviButton.uc.js', aMsg);
}

/**
 * Identifiers
 */
const kID = {
  // default
  BACK_BUTTON: 'back-button',
  FORWARD_BUTTON: 'forward-button',

  // custom
  TOOLTIP: 'ucjs_navibutton_tooltip',
  REFERRER: 'ucjs_navibutton_referrer'
};

/**
 * UI settings
 */
const kUI = {
  title: {
    noTitle:   'No title',
    noHistory: 'No history',
    ditto:     'Ditto'
  },

  form: {
    near: '%dir %title',
    far:  '%dir(%distance) %title'
  },

  sign: {
    prev:        '<',
    next:        '>',
    rewind:      '<<',
    fastforward: '>>',
    start:       '|<',
    end:         '>|',
    referrer:    'From:'
  },

  style: {
    title: 'font-weight:bold;',
    referrer: 'color:blue;',
    url: ''
  }
};

/**
 * Handler of a navigation button
 */
const Button = {
  init: function(aButton) {
    if (!aButton) {
      return;
    }

    aButton.removeAttribute('tooltip');
    aButton.removeAttribute('onclick');
    aButton.removeAttribute('oncommand');

    this.preventCommand(aButton);

    aButton.addEventListener('mouseover', this, false);
    aButton.addEventListener('mouseout', this, false);
    aButton.addEventListener('click', this, false);
  },

  uninit: function(aButton) {
    if (!aButton) {
      return;
    }

    aButton.removeEventListener('mouseover', this, false);
    aButton.removeEventListener('mouseout', this, false);
    aButton.removeEventListener('click', this, false);
  },

  handleEvent: function(aEvent) {
    switch (aEvent.type) {
      case 'mouseover':
        Tooltip.show(aEvent);
        break;
      case 'mouseout':
        Tooltip.hide(aEvent);
        break;
      case 'click':
        if (aEvent.button !== 2) {
          Tooltip.hide(aEvent);
          History.jump(aEvent);
          Tooltip.delayShow(aEvent);
        }
        break;
    }
  },

  preventCommand: function(aButton) {
    let command = (aButton.id === kID.BACK_BUTTON) ?
      'BrowserBack' : 'BrowserForward';

    // @modified chrome://browser/content/browser.js::BrowserBack
    // @modified chrome://browser/content/browser.js::BrowserForward
    let $func = window[command];
    window[command] = function(aEvent) {
      if (aEvent &&
          aEvent.sourceEvent &&
          aEvent.sourceEvent.target.id === aButton.id) {
        return;
      }

      $func.apply(this, arguments);
    };
  }
};

/**
 * Progress listener
 * @see |NaviButton_init()|
 */
const BrowserProgressListener = {
  onLocationChange: function(aWebProgress, aRequest, aLocation, aFlag) {
    let back = $ID(kID.BACK_BUTTON);

    if (!gBrowser.canGoBack && Referrer.exists()) {
      back.setAttribute(kID.REFERRER, true);
    }
    else if (back.hasAttribute(kID.REFERRER)) {
      back.removeAttribute(kID.REFERRER);
    }
  },

  onProgressChange: function() {},
  onStateChange: function() {},
  onStatusChange: function() {},
  onSecurityChange: function() {}
};

/**
 * Handler of referrer
 * @require TabEx.uc.js
 */
const Referrer = {
  get referrer() {
    // lazy definition
    delete this.referrer;
    return this.referrer =
      window.ucjsTabEx &&
      window.ucjsTabEx.referrer;
  },

  exists: function() {
    if (this.referrer) {
      return this.referrer.exists(gBrowser.selectedTab);
    }
    return false;
  },

  fetchInfo: function(aCallback) {
    let info = {};

    info.URL = this.referrer.getURL(gBrowser.selectedTab);

    // the document title is fetched by async history API
    this.referrer.fetchTitle(gBrowser.selectedTab, function(aTitle) {
      info.title = aTitle;
      aCallback(info);
    });
  }
};

/**
 * Handler of a tooltip panel
 */
const Tooltip = {
  init: function() {
    this.tooltip = $ID('mainPopupSet').appendChild($E('tooltip'));
    this.tooltip.id = kID.TOOLTIP;
  },

  delayShow: function(aEvent) {
    const kTooltipShowDelay = 500; // [ms]

    this.timer = setTimeout(this.show.bind(this), kTooltipShowDelay, aEvent);
  },

  hide: function(aEvent) {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.tooltip.hidePopup();
  },

  show: function(aEvent) {
    let button = aEvent.target;

    let backward = button.id === kID.BACK_BUTTON;
    let referrer = backward && Referrer.exists();
    let disabled = button.disabled;

    History.scan({
      backward: backward,
      referrer: referrer,
      disabled: disabled
    },
    (aData) => {
      this.build(aData);
      this.tooltip.openPopup(button, 'after_start', 0, 0, false, false);
    });
  },

  build: function(aData) {
    let tooltip = this.tooltip;

    while (tooltip.hasChildNodes()) {
      tooltip.removeChild(tooltip.firstChild);
    }

    ['neighbor', 'border', 'stop', 'referrer'].
    forEach((key) => {
      let [title, URL] = this.formatData(aData, key);

      setLabel(title, {title: true, referrer: key === 'referrer'});
      setLabel(URL, {url: true});
    });

    function setLabel(aValue, aType) {
      if (!aValue) {
        return;
      }

      let label = $E('label');

      label.setAttribute('value', aValue);
      label.setAttribute('crop', 'center');

      let style = '';

      if (aType.title) {
        style += kUI.style.title
      }

      if (aType.referrer) {
        style += kUI.style.referrer
      }

      if (aType.url) {
        style += kUI.style.url
      }

      if (style) {
        label.setAttribute('style', style);
      }

      tooltip.appendChild(label);
    }
  },

  formatData: function(aData, aKey) {
    let backward = aData.backward;
    let {title, URL, distance} = aData[aKey];
    let dir = '';

    if (URL && title === URL) {
      title = kUI.title.noTitle;
    }

    switch (aKey) {
      case 'neighbor':
        dir = backward ? 'prev' : 'next';
        title = title || kUI.title.noHistory;
        break;
      case 'border':
        dir = backward ? 'rewind' : 'fastforward';
        if (distance === 1) {
          title = kUI.title.ditto;
          URL = '';
        }
        break;
      case 'stop':
        dir = backward ? 'start' : 'end';
        if (distance === 1) {
          title = '';
          URL = '';
        }
        else if (distance && aData.border.distance === distance) {
          title = kUI.title.ditto;
          URL = '';
        }
        break;
      case 'referrer':
        dir = 'referrer';
        break;
    }

    if (title) {
      title = kUI.form[(distance < 2) ? 'near' : 'far'].
        replace('%dir', kUI.sign[dir]).
        replace('%distance', distance).
        replace('%title', title);
    }

    return [title, URL];
  }
};

/**
 * Handler of history
 */
const History = {
  scan: function(aParam, aCallback) {
    this.initData(aParam, (aData) => {
      this.updateData(aParam, aData);
      aCallback(aData);
    });
  },

  initData: function(aParam, aCallback) {
    function Entry() {
      return {
        title: '',
        URL: '',
        index: -1,
        distance: 0
      };
    }

    let {backward, referrer} = aParam;

    // make a new property
    this.data = {
      backward: backward,
      neighbor: Entry(),
      border:   Entry(),
      stop:     Entry(),
      referrer: Entry()
    };

    if (referrer) {
      Referrer.fetchInfo((aInfo) => {
        this.data.referrer.title = aInfo.title;
        this.data.referrer.URL = aInfo.URL;

        aCallback(this.data);
      });

      return;
    }

    aCallback(this.data);
  },

  updateData: function(aParam, aData) {
    let {backward, disabled} = aParam;

    if (disabled) {
      return;
    }

    let sh = this.getSessionHistory();

    if (!sh ||
        (backward && sh.index === 0) ||
        (!backward && sh.index === sh.count - 1)) {
      return;
    }

    let step = backward ? -1 : 1;
    let border = sh.index + step;

    let within = backward ? function(i) -1 < i : function(i) i < sh.count;
    let host = sh.getEntryAt(sh.index).host;

    for (; within(border); border += step) {
      if (host !== sh.getEntryAt(border).host) {
        break;
      }
    }

    [
      [aData.neighbor, sh.index + step],
      [aData.border, border - step],
      [aData.stop, backward ? 0 : sh.count - 1]
    ].
    forEach(([entry, index]) => {
      if (sh.index !== index) {
        let info = sh.getEntryAt(index);
        entry.title = info.title;
        entry.URL = info.URL;
        entry.index = index;
        entry.distance = Math.abs(index - sh.index);
      }
    });
  },

  getSessionHistory: function() {
    let sh = gBrowser.sessionHistory;

    if (sh) {
      return {
        index: sh.index,
        count: sh.count,
        getEntryAt: getEntryAt
      };
    }
    return null;

    function getEntryAt(aIndex) {
      let info = {
        title: '',
        URL: '',
        host: ''
      };

      let entry = sh.getEntryAtIndex(aIndex, false);

      if (entry) {
        if (entry.title) {
          info.title = entry.title;
        }

        if (entry.URI) {
          info.URL = entry.URI.spec;
          try {
            info.host = entry.URI.host;
          }
          catch (ex) {
            info.host = entry.URI.scheme;
          }
        }
      }

      return info;
    }
  },

  jump: function(aEvent) {
    let {shiftKey, ctrlKey, button} = aEvent;

    let referrer = this.data.referrer.URL;

    if (referrer) {
      if (!gBrowser.canGoBack || (shiftKey && ctrlKey)) {
        selectOrOpen(referrer, {inBackground: button === 1});
        return;
      }
    }

    let index = -1;
    if (!shiftKey && !ctrlKey) {
      index = this.data.neighbor.index;
    }
    else if (shiftKey && !ctrlKey) {
      index = this.data.border.index;
    }
    else if (ctrlKey && !shiftKey) {
      index = this.data.stop.index;
    }

    if (index < 0) {
      return;
    }

    if (button === 1) {
      gBrowser.selectedTab = gBrowser.duplicateTab(gBrowser.selectedTab);
    }

    gBrowser.webNavigation.gotoIndex(index);
  }
};

function selectOrOpen(aURL, aOption) {
  function getURL(aTab) {
    let browser = gBrowser.getBrowserForTab(aTab);

    return browser.userTypedValue || browser.currentURI.spec;
  }

  let {inBackground} = aOption || {};

  let tabs = gBrowser.visibleTabs;

  for (let i = 0; i < tabs.length; i++) {
    if (getURL(tabs[i]) === aURL) {
      if (!inBackground) {
        gBrowser.selectedTab = tabs[i];
      }
      return;
    }
  }

  gBrowser.loadOneTab(aURL, {inBackground: inBackground});
}

/**
 * Entry point
 */
function NaviButton_init() {
  let back = $ID(kID.BACK_BUTTON),
      forward = $ID(kID.FORWARD_BUTTON);

  Button.init(back);
  Button.init(forward);

  Tooltip.init();

  gBrowser.addProgressListener(BrowserProgressListener);

  window.addEventListener('unload', function cleanup() {
    window.removeEventListener('unload', cleanup, false);
    gBrowser.removeProgressListener(BrowserProgressListener);
    Button.uninit(back);
    Button.uninit(forward);
  }, false);
}

NaviButton_init();


})(this);
