// ==UserScript==
// @name        TabEx.uc.js
// @description Extends the tab functions
// @include     main
// ==/UserScript==

// @require Util.uc.js
// @note Some about:config preferences are changed. see @pref
// @note A default function is modified. see @modified
// @note Some properties are exposed to the global scope.
// |window.ucjsTabEx.XXX|


var ucjsTabEx = (function(window, undefined) {


"use strict";


/**
 * Imports
 */
const {
  TimerHandler: {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  },
  setEventListener: addEvent,
  openTab,
  removeTab,
  setChromeStyleSheet,
  getPref,
  setPref
} = window.ucjsUtil;
// for debug
const log = window.ucjsUtil.logMessage.bind(null, 'TabEx.uc.js');

/**
 * Identifier
 */
const kID = {
  OPENTIME: 'ucjs_tabex_opentime',
  READTIME: 'ucjs_tabex_readtime',
  SELECTTIME: 'ucjs_tabex_selecttime',
  ANCESTORS: 'ucjs_tabex_ancestors',
  OPENQUERY: 'ucjs_tabex_openquery',
  SUSPENDED: 'ucjs_tabex_suspended',
  READ: 'ucjs_tabex_read',
  RESTORING: 'ucjs_tabex_restoring',
  TABCOLOR: 'ucjs_tabex_tabcolor',
  PARENTCOLOR: 'ucjs_tabex_parentcolor'
};

/**
 * Position for OPENPOS/SELECTPOS
 */
const kPosType = {
  // Firefox default
  DEFAULT: 1,
  // at the first
  FIRST_END: 2,
  // at the last
  LAST_END: 3,
  // at the previous adjacent
  // @note SELECTPOS: if no previous tab, no match
  PREV_ADJACENT: 4,
  // at the next adjacent
  // @note SELECTPOS: if no next tab, no match
  NEXT_ADJACENT: 5,

  //***** OPENPOS only

  // after the far end tab of the sequential followings that are descendants of
  // the base tab from its next adjacent, or at the next adjacent
  NEXT_INCREMENT_DESCENDANT: 6,

  //***** SELECTPOS only

  // the previous adjacent tab that is an ancestor of the closed tab
  // @note may be no match
  PREV_ADJACENT_ANCESTOR: 7,
  // the next adjacent tab that is a descendant of the closed tab or is a
  // sibling(has the same parent of the closed tab) or his descendant
  // @note may be no match
  NEXT_ADJACENT_EXTENDED_DESCENDANT: 8,
  // the parent tab of the closed tab
  // @note may be no match
  ANYWHERE_OPENER: 9,
  // tab that has been selected most recently before the closed tab
  // @note may be no match
  ANYWHERE_PREV_SELECTED: 10,
  // the oldest opened tab of unread tabs
  // @note may be no match
  ANYWHERE_OLDEST_UNREAD: 11
};

/**
 * User preference
 */
const kPref = {
  // where a new tab is opened
  // @value {kPosType}
  // @note The count of positioning starts from the first *un*pinned tab.
  // @note OPENPOS_LINKED works when the tab is opened by a link in the
  // content area or a command with 'relatedToCurrent', otherwise
  // OPENPOS_UNLINKED.
  OPENPOS_LINKED:    kPosType.NEXT_INCREMENT_DESCENDANT,
  OPENPOS_UNLINKED:  kPosType.LAST_END,
  OPENPOS_DUPLICATE: kPosType.NEXT_ADJACENT,
  // DEFAULT: a tab reopens at the same position where it closed
  OPENPOS_UNDOCLOSE: kPosType.DEFAULT,

  // which tab is selected after a *selected* tab is closed
  // @value {kPosType[]}
  // @note The default selection works if no matches (may be the same as
  // PREV_ADJACENT)
  SELECTPOS_TABCLOSE: [
    kPosType.NEXT_ADJACENT_EXTENDED_DESCENDANT,
    kPosType.PREV_ADJACENT_ANCESTOR,
    kPosType.ANYWHERE_OPENER,
    kPosType.ANYWHERE_PREV_SELECTED,
    kPosType.ANYWHERE_OLDEST_UNREAD,
    kPosType.FIRST_END
  ],
  // for closing a selected pinned tab
  SELECTPOS_PINNEDTABCLOSE: [
    kPosType.PREV_ADJACENT
  ],

  // delayed-stops the loading of a tab that is opened in background
  // @value {boolean}
  //   false: the same as the default 'tabs on demand' behavior
  //   true: stops the loading of the tab after SUSPEND_DELAY passes
  SUSPEND_LOADING: true,
  // the delay time until the loading is suspended
  // @value {integer} millisecond
  //   0: try to stop loading immediately
  // @note It may take time because our process works after the Fx default one
  // for a background tab.
  SUSPEND_DELAY: 0,
  // auto-reloads the suspended tab that is next adjacent of a selected tab
  // @value {boolean}
  SUSPEND_NEXTTAB_RELOAD: false,

  // the delay time until it considers that "a user has read it" after the tab
  // is selected and loaded completely
  // @value {integer} millisecond
  // @note The marking is canceled when the other tab is selected in a short
  // time. (e.g. while flipping tabs with a shortcut key or mouse wheeling)
  SELECTED_DELAY: 1000,

  // colors tabs to indicate the parent tab
  // @value {boolean}
  // @note The indicator is hidden if the location changes from where the tab
  // has been opened.
  showTabColor: true
};

/**
 * Utility for coloring tabs
 * @return {hash}
 *   setParentColor: {function}
 *
 * @note
 * sets the attribute of the color index to tabs
 *   index=0: the default color (gray)
 *   index=[1..kColorsNum]: the preset colors
 * disables coloring if index<0
 */
const TabColor = (function() {
  /**
   * the number of tab colors
   * @value {integer}
   *   a number that just divides 360 degrees of the hue in the HSL color form
   */
  const kColorsNum = 8;

  /**
   * Listener for tab icon ready
   */
  const ProgressListener = {
    init: function() {
      gBrowser.addTabsProgressListener(ProgressListener);
      addEvent([window, 'unload', function() {
        gBrowser.removeTabsProgressListener(ProgressListener);
      }, false]);
    },

    onLinkIconAvailable: function(aBrowser, aIconURL) {
      // skip an about: page or a background tab on pending to load
      if (aBrowser.currentURI.schemeIs('about') && !aIconURL) {
        return;
      }

      Array.some(gBrowser.tabs, function(tab) {
        if (tab.linkedBrowser === aBrowser) {
          // toggle showing the parent color when a page location changed
          if (tab.hasAttribute(kID.PARENTCOLOR)) {
            let index = tab.getAttribute(kID.PARENTCOLOR);
            if ((aBrowser.canGoBack && 0 <= index) ||
                (!aBrowser.canGoBack && index < 0)) {
              tab.setAttribute(kID.PARENTCOLOR, -index);
            }
          }

          setTabColor(tab, aIconURL);
          return true;
        }
        return false;
      });
    }
  };

  /**
   * Cache of the color index for icon URL
   */
  const IndexCache = {
    kMaxCount: 50,
    list: [],

    has: function(aIconURL) {
      return this.list.some(function(item) {
        return item.iconURL === aIconURL;
      });
    },

    get: function(aIconURL) {
      for (let i = 0, l = this.list.length; i < l; i++) {
        if (this.list[i].iconURL === aIconURL) {
          let index = this.list[i].index;
          if (i > 0) {
            // score up and move to the first
            this.list.unshift(this.list.splice(i, 1));
          }
          return index;
        }
      }
      return 0;
    },

    set: function(aIconURL, aIndex) {
      if (this.has(aIconURL)) {
        return;
      }

      // add to the first
      this.list.unshift({
        iconURL: aIconURL,
        index: aIndex
      });

      if (this.list.length > this.kMaxCount) {
        // 1.leave the newer items, only the same number as the number of tabs
        // 2.delete the oldest item if the number of tabs is greater
        if (gBrowser.tabs.length < this.list.length) {
          this.list.splice(gBrowser.tabs.length);
        } else {
          this.list.pop();
        }
      }
    }
  };

  /**
   * Initialize
   */
  if (kPref.showTabColor) {
    ProgressListener.init();
    setStyleSheet();
  }

  function setStyleSheet() {
    // index=0: the default color (gray)
    const kTabColorGray =
      '.tabbrowser-tab[' + kID.TABCOLOR + '="0"] .tab-icon-image{' +
        'box-shadow:0 0 4px hsla(0,0%,50%,.9);' +
      '}' +
      '.tabbrowser-tab[' + kID.PARENTCOLOR + '="0"] .tab-label{' +
        'box-shadow:-4px 0 2px -2px hsla(0,0%,50%,.9) inset;' +
      '}';

    // index=[1..kColorsNum]: the preset colors
    const kTabColor =
      '.tabbrowser-tab[' + kID.TABCOLOR + '="%index%"] .tab-icon-image{' +
        'box-shadow:0 0 4px hsla(%hue%,100%,50%,.9);' +
      '}' +
      '.tabbrowser-tab[' + kID.PARENTCOLOR + '="%index%"] .tab-label{' +
        'box-shadow:-4px 0 2px -2px hsla(%hue%,100%,50%,.9) inset;' +
      '}';

    let css = [kTabColorGray];
    let unitAngle = Math.floor(360 / kColorsNum);
    for (let i = 1; i <= kColorsNum; i++) {
      css.push(kTabColor.
        replace(/%index%/g, i).
        replace(/%hue%/g, (i - 1) * unitAngle));
    }

    setChromeStyleSheet(css.join(''));
  }

  function getColorIndex(aRGB) {
    let [H, S, L] = RGBToHSL(aRGB);

    // changes gray-tone/dark/light color to the default color
    if (S < 10 || L < 10 || 90 < L) {
      return 0;
    }

    let unitAngle = Math.floor(360 / kColorsNum);
    let index = Math.round(H / unitAngle) + 1;
    if (index > kColorsNum) {
      index = 1;
    }

    return index;
  }

  function setParentColor(aTab, aParentTab) {
    let index = aParentTab.getAttribute(kID.TABCOLOR);
    aTab.setAttribute(kID.PARENTCOLOR, index || 0);
  }

  function setTabColor(aTab, aIconURL) {
    function setAttribute(aTab, aIndex) {
      aTab.setAttribute(kID.TABCOLOR, aIndex);
    }

    if (!aIconURL) {
      // set the default color
      setAttribute(aTab, 0);
    }
    else if (IndexCache.has(aIconURL)) {
      setAttribute(aTab, IndexCache.get(aIconURL));
    }
    else {
      const {Cc, Ci} = window;
      const ColorAnalyzer =
        Cc['@mozilla.org/places/colorAnalyzer;1'].
        getService(Ci.mozIColorAnalyzer);
      try {
        // @note The image loading error will raise when aIconURL is a
        // non-existent '/favicon.ico' that is guessed by |useDefaultIcon|. It
        // is just a report not exception.
        // @see chrome://browser/content/tabbrowser.xml::useDefaultIcon
        // @see resource://gre/components/ColorAnalyzer.js::onImageError
        ColorAnalyzer.findRepresentativeColor(makeURI(aIconURL),
          function(success, color) {
            let index = success ? getColorIndex(color) : 0;
            IndexCache.set(aIconURL, index);
            setAttribute(aTab, index);
          }
        );
      } catch (ex) {
        IndexCache.set(aIconURL, 0);
        setAttribute(aTab, 0);
      }
    }
  }

  /**
   * converts RGB into HSL
   * @param aRGB {integer}
   *   0x012DEF: the representative color as an integer in RGB form
   * @return {integer[]} [H, S, L]
   *   H: hue [degrees]
   *   S: saturation [percent]
   *   L: lightness [percent]
   *
   * @see http://en.wikipedia.org/wiki/HSL_and_HSV#Formal_derivation
   */
  function RGBToHSL(aRGB) {
    let [R, G, B] = [(aRGB >> 16) & 255, (aRGB >> 8) & 255, aRGB & 255];

    R /= 255; G /= 255; B /= 255;

    let max = Math.max(R, G, B), min = Math.min(R, G, B);
    let sum = max + min, diff = max - min;
    let hue, saturation, lightness = sum / 2;

    if (diff === 0) {
      return [0, 0, lightness * 100];
    }

    if (lightness <= 0.5) {
      saturation = diff / sum;
    } else {
      saturation = diff / (2 - sum);
    }

    switch (max) {
      case R:
        hue = (G - B) / diff + (G < B ? 6 : 0);
        break;
      case G:
        hue = (B - R) / diff + 2;
        break;
      case B:
        hue = (R - G) / diff + 4;
        break;
    }
    hue *= 60;

    return [hue, saturation * 100, lightness * 100];
  }

  return {
    setParentColor: setParentColor
  };
})();

/**
 * Tab data manager
 */
var mTab = (function () {
  /**
   * Gets/Sets or Removes the tab data
   * @param aTab {Element}
   * @param aKey {string} a reserved key that corresponds to a data
   * @param aValue {} [optional] a value to set
   *   null: *remove* a data
   * @return {}
   *   get: a value that is requested if exists, null otherwise.
   *   set: a value that is set, null if removed.
   */
  function data(aTab, aKey, aValue) {
    function getInt(value) {
      return parseInt(value, 10);
    }

    var name, getter, setter;
    switch (aKey) {
      case 'query': // {hash}
        name = kID.OPENQUERY;
        getter = function(value) {
          return JSON.parse(htmlUnescape(value));
        };
        setter = function(value) {
          return htmlEscape(JSON.stringify(value));
        };
        break;
      case 'open': // {integer}
        name = kID.OPENTIME;
        getter = getInt;
        break;
      case 'select': // {integer}
        name = kID.SELECTTIME;
        getter = getInt;
        break;
      case 'read': // {integer}
        name = kID.READTIME;
        getter = getInt;
        break;
      case 'ancestors': // {integer[]}
        name = kID.ANCESTORS;
        getter = function(value) {
          return value.split(' ').map(getInt);
        };
        setter = function(value) {
          return value.join(' ');
        };
        break;
      default:
        throw new TypeError('unknown aKey of tab data');
    }

    // get a data
    if (aValue === undefined) {
      if (aTab.hasAttribute(name)) {
        return getter(aTab.getAttribute(name));
      }
      return null;
    }

    // remove or set a data
    if (aValue === null) {
      if (aTab.hasAttribute(name)) {
        aTab.removeAttribute(name);
      }
    } else {
      let value = setter ? setter(aValue) : aValue;
      aTab.setAttribute(name, value);
    }
    return aValue;
  }

  /**
   * Retrieves the data of a closed tab from the session store
   * @param aClosedTabData {hash} a parsed JSON of a closed tab
   * @param aKey {string} a reserved key that corresponds to a data
   * @return {}
   *
   * @note |aKey| is the same as the keys of |data|. Only the keys that is
   * called in the code is supported.
   */
  function SSdata(aClosedTabData, aKey) {
    function getInt(value) {
      return parseInt(value, 10);
    }

    var name, getter;
    switch (aKey) {
      case 'open': // {integer}
        name = kID.OPENTIME;
        getter = getInt;
        break;
      case 'select': // {integer}
        name = kID.SELECTTIME;
        getter = getInt;
        break;
      default:
        throw new TypeError('unsupported aKey of a closed tab data');
    }

    return getter(aClosedTabData.state.attributes[name]);
  }

  /**
   * Gets/Sets the state of a tab
   */
  var state = {
    // whether a user read a tab
    read: function(aTab, aValue) {
      return manageFlagAttribute(aTab, kID.READ, aValue);
    },

    // whether the loading of a tab is suspended
    suspended: function(aTab, aValue) {
      return manageFlagAttribute(aTab, kID.SUSPENDED, aValue);
    },

    // whether duplicated/undo-closed is opening
    restoring: function(aTab, aValue) {
      return manageFlagAttribute(aTab, kID.RESTORING, aValue);
    }
  };

  /**
   * Tests the state of a tab
   */
  var stateTest = {
    // whether a user read a tab
    // @return {boolean}
    read: function(aTab) {
      return manageFlagAttribute(aTab, kID.READ);
    },

    // whether the loading of a tab is suspended
    // @return {boolean}
    suspended: function(aTab) {
      return manageFlagAttribute(aTab, kID.SUSPENDED);
    }
  };


  /**
   * Gets/Sets or Removes the key attribute of a tab
   * @param aTab {Element}
   * @param aKey {string}
   * @param aValue {boolean} [optional]
   * @return {boolean}
   */
  function manageFlagAttribute(aTab, aKey, aValue) {
    var has = aTab.hasAttribute(aKey);
    if (aValue === undefined) {
      return has;
    }

    if (has && aValue === false) {
      aTab.removeAttribute(aKey);
    } else if (!has && aValue === true) {
      aTab.setAttribute(aKey, true);
    }
    return aValue;
  }

  return {
    data: data,
    SSdata: SSdata,
    state: state,
    stateTest: stateTest
  };
})();

/**
 * Session store handler
 */
var mSessionStore = {
  // whether a tab is in restoring (duplicated/undo-closed tab)
  isRestoring: false,

  init: function() {
    const {Cc, Ci} = window;

    this.SessionStore =
      Cc['@mozilla.org/browser/sessionstore;1'].
      getService(Ci.nsISessionStore);

    let savedAttributes = [
      kID.OPENTIME,
      kID.READTIME,
      kID.SELECTTIME,
      kID.ANCESTORS,
      kID.OPENQUERY
    ];

    if (kPref.showTabColor) {
      savedAttributes.push(
        kID.TABCOLOR,
        kID.PARENTCOLOR
      );
    }

    savedAttributes.forEach(function(key) {
      this.SessionStore.persistTabAttribute(key);
    }.bind(this));

    addEvent([window, 'SSWindowStateBusy', this, false]);
    addEvent([window, 'SSWindowStateReady', this, false]);
  },

  handleEvent: function(aEvent) {
    switch (aEvent.type) {
      case 'SSWindowStateBusy':
        this.isRestoring = true;
        break;
      case 'SSWindowStateReady':
        this.isRestoring = false;
        break;
    }
  },

  getClosedTabList: function() {
    if (this.SessionStore.getClosedTabCount(window) > 0) {
      return JSON.parse(this.SessionStore.getClosedTabData(window));
    }
    return null;
  }
};

/**
 * Tab opening handler
 */
var mTabOpener = {
  init: function() {
    // @modified chrome://browser/content/tabbrowser.xml::addTab
    var $addTab = gBrowser.addTab;
    gBrowser.addTab = function(
      aURI, // {string}
      aReferrerURI, // {nsIURI}
      aCharset,
      aPostData,
      aOwner,
      aAllowThirdPartyFixup
    ) {
      var newTab = $addTab.apply(this, arguments);

      // when a tab is duplicated or undo-closed, its data will be restored
      if (mSessionStore.isRestoring) {
        mTab.state.restoring(newTab, true);
        return newTab;
      }

      const {Ci} = window;

      var aRelatedToCurrent, aFromExternal, aIsUTF8;
      if (arguments.length === 2 &&
          typeof arguments[1] === 'object' &&
          !(arguments[1] instanceof Ci.nsIURI)) {
        let params = arguments[1];
        aReferrerURI          = params.referrerURI;
        aCharset              = params.charset;
        aAllowThirdPartyFixup = params.allowThirdPartyFixup;
        aFromExternal         = params.fromExternal;
        aRelatedToCurrent     = params.relatedToCurrent;
        aIsUTF8               = params.isUTF8;
      }

      var query;
      if (!aURI || aURI === 'about:blank') {
        query = {
          URL: 'about:blank',
          flags: Ci.nsIWebNavigation.LOAD_FLAGS_NONE
        };
      } else {
        // into URL string
        aReferrerURI = aReferrerURI && aReferrerURI.spec;

        let fromVisit;
        if (!aReferrerURI) {
          if (aRelatedToCurrent) {
            let currentURL = gBrowser.currentURI.spec;
            fromVisit = /^https?:/.test(currentURL) && currentURL;
          } else {
            fromVisit = /^https?:/.test(aURI) &&
              mReferrer.getFromVisit(aURI);
          }
        }

        let flags = Ci.nsIWebNavigation.LOAD_FLAGS_NONE;
        if (aAllowThirdPartyFixup) {
          flags |= Ci.nsIWebNavigation.LOAD_FLAGS_ALLOW_THIRD_PARTY_FIXUP;
        }
        if (aFromExternal) {
          flags |= Ci.nsIWebNavigation.LOAD_FLAGS_FROM_EXTERNAL;
        }
        if (aIsUTF8) {
          flags |= Ci.nsIWebNavigation.LOAD_FLAGS_URI_IS_UTF8;
        }

        // TODO: POST data handling. |aPostData| is a |nsIInputStream| object
        // that JSON does not support.
        query = {
          URL: aURI,
          flags: flags,
          referrerURL: aReferrerURI || undefined,
          charset: aCharset || undefined,
          relatedToCurrent: aRelatedToCurrent || undefined,
          fromVisit: fromVisit || undefined
        };
      }
      mTab.data(newTab, 'query', query);

      var event = document.createEvent('Events');
      event.initEvent('UcjsTabExTabOpen', true, false);
      newTab.dispatchEvent(event);

      return newTab;
    };
  },

  set: function(aTab, aType) {
    switch (aType) {
      case 'StartupTab':
        let browser = gBrowser.getBrowserForTab(aTab);
        // |userTypedValue| holds the URL of a document till it successfully
        // loads.
        let URL = browser.userTypedValue || browser.currentURI.spec;
        let query = {
          URL: URL,
          flags: window.Ci.nsIWebNavigation.LOAD_FLAGS_NONE
        };
        mTab.data(aTab, 'query', query);
        break;
      case 'NewTab':
        if (mReferrer.isRelatedToCurrent(aTab)) {
          // inherit the ancestors so that the opener tab becomes the parent
          let parent = gBrowser.selectedTab;
          let open = mTab.data(parent, 'open');
          let ancs = mTab.data(parent, 'ancestors') || [];
          mTab.data(aTab, 'ancestors', [open].concat(ancs));

          if (kPref.showTabColor) {
            TabColor.setParentColor(aTab, parent);
          }
        }
        break;
      case 'DuplicatedTab':
        // this duplicated tab has the same data of its original tab
        // renew the ancestors so that the original tab becomes the parent
        let open = mTab.data(aTab, 'open');
        let ancs = mTab.data(aTab, 'ancestors') || [];
        mTab.data(aTab, 'ancestors', [open].concat(ancs));
        break;
    }

    mTab.data(aTab, 'open', getTime());
  }
};

/**
 * Tab referrer handler
 */
var mReferrer = {
  getURL: function(aTab) {
    var query = mTab.data(aTab, 'query');
    if (!query) {
      return null;
    }

    return query.referrerURL || query.fromVisit;
  },

  getTitle: function(aTab) {
    return getPageTitle(this.getURL(aTab));
  },

  exists: function(aTab) {
    return !!this.getURL(aTab);
  },

  isRelatedToCurrent: function(aTab) {
    var query = mTab.data(aTab, 'query');
    if (!query) {
      return null;
    }

    return !!(query.referrerURL ||
      (query.relatedToCurrent && query.fromVisit));
  },

  getFromVisit: function(aURL) {
    if (!aURL) {
      return null;
    }

    // @see http://www.forensicswiki.org/wiki/Mozilla_Firefox_3_History_File_Format
    var sql =
      "SELECT p1.url " +
      "FROM moz_places p1 " +
      "JOIN moz_historyvisits h1 ON h1.place_id = p1.id " +
      "JOIN moz_historyvisits h2 ON h2.from_visit = h1.id " +
      "JOIN moz_places p2 ON p2.id = h2.place_id " +
      "WHERE p2.url = :page_url " +
      "ORDER BY h1.visit_date DESC";

    return scanHistoryDatabase(sql, {'page_url': aURL}, 'url');
  }
};

/**
 * Tab selecting handler
 */
var mTabSelector = {
  prevSelectedTime: 0,
  currentSelectedTime: 0,

  set: function(aTab) {
    this.clear();
    // repeatly observes a tab until its document completely loads while the
    // tab is selected
    this.timer = setInterval(function(tab) {
      this.select(tab);
    }.bind(this), kPref.SELECTED_DELAY, aTab);
  },

  clear: function() {
    if (this.timer) {
      clearInterval(this.timer);
      delete this.timer;
    }
  },

  select: function(aTab) {
    // in loading yet
    if (aTab && aTab.hasAttribute('busy')) {
      return;
    }

    this.clear();

    // cancel the dealing when the tab is removed or deselected while the timer
    // is waiting
    if (!aTab || !aTab.selected) {
      return;
    }

    this.update(aTab);
  },

  update: function(aTab, aOption) {
    var {reset, read} = aOption || {};

    if (reset) {
      mTab.data(aTab, 'select', null);
      mTab.data(aTab, 'read', null);
      mTab.state.read(aTab, false);
      return;
    }

    var time = getTime();
    mTab.data(aTab, 'select', time);
    if (read || !mTab.state.read(aTab)) {
      mTab.data(aTab, 'read', time);
      mTab.state.read(aTab, true);
    }

    this.prevSelectedTime = this.currentSelectedTime;
    this.currentSelectedTime = time;
  }
};

/**
 * Handler of suspending the loading of a tab
 */
var mTabSuspender = {
  timers: {},

  set: function(aTab, aDelay) {
    // wait until the default process for a background tab is done
    var timer = setTimeout(function(tab) {
      this.stop(tab);
    }.bind(this), aDelay, aTab);

    // the opened time of a tab is a unique value
    this.timers[mTab.data(aTab, 'open')] = timer;
  },

  clear: function(aTab) {
    var id = aTab && mTab.data(aTab, 'open');
    var timer = id && this.timers[id];
    if (timer) {
      clearTimeout(timer);
      delete this.timers[id];
    }
  },

  stop: function(aTab) {
    this.clear(aTab);

    // cancel suspending the tab when is removed or selected while the timer
    // is waiting
    if (!aTab || aTab.selected) {
      return;
    }

    var [browser, loadingURL] = this.getBrowserForTab(aTab);
    var isBusy = aTab.hasAttribute('busy');
    var isBlank = browser.currentURI.spec === 'about:blank';

    // 1.a document in loading
    // 2.a blank page when the default 'tabs on demand' works
    if (loadingURL && (isBusy || isBlank)) {
      mTab.state.suspended(aTab, true);

      if (isBusy) {
        browser.stop();
      }
      if (isBlank) {
        aTab.label = getPageTitle(loadingURL);
      }
    }
  },

  reload: function(aTab) {
    this.clear(aTab);

    // pass only the visible and suspended tab
    if (!aTab || aTab.hidden || aTab.closing ||
        !mTab.state.suspended(aTab)) {
      return;
    }

    mTab.state.suspended(aTab, false);

    var [browser, loadingURL, query] = this.getBrowserForTab(aTab);
    if (loadingURL) {
      if (query) {
        // TODO: POST data handling.
        browser.loadURIWithFlags(
          query.URL,
          query.flags,
          makeURI(query.referrerURL),
          query.charset,
          null
        );
      } else {
        browser.loadURI(loadingURL);
      }
    }
  },

  getBrowserForTab: function(aTab) {
    var browser = gBrowser.getBrowserForTab(aTab);
    var loadingURL;
    var query;

    // TODO: Use a certain detection
    var isNewTab = !browser.canGoBack;
    if (isNewTab) {
      query = mTab.data(aTab, 'query');
    }

    // 1.a new tab has no query when it bypassed our hooked |gBrowser.addTab|
    // 2.|userTypedValue| holds the URL of a document till it successfully
    // loads
    if (query && query.URL !== 'about:blank') {
      loadingURL = query.URL;
    } else {
      loadingURL = browser.userTypedValue;
    }

    return [browser, loadingURL, query];
  }
};

/**
 * Startup tabs handler
 * The boot startup opens the startup tabs (e.g. homepages). Some pinned tabs
 * may be restored too.
 * The resume startup restores tabs.
 */
var mStartup = {
  init: function() {
    // execute |setupTabs| just after all tabs open
    // TODO: Use a certain observer.
    // The first |DOMContentLoaded| fires on the document for a selected tab.
    // It seems enough after all tabs open.
    // XXX: All tabs may be opened before this user script runs. But I am not
    // sure.
    window.addEventListener('DOMContentLoaded', this, false);
  },

  uninit: function() {
    window.removeEventListener('DOMContentLoaded', this, false);
  },

  handleEvent: function(aEvent) {
    this.uninit();
    this.setupTabs();
  },

  setupTabs: function() {
    Array.forEach(gBrowser.tabs, function(tab) {
      // a boot startup tab (e.g. homepage)
      if (!mTab.data(tab, 'open')) {
        mTabOpener.set(tab, 'StartupTab');
      }

      if (tab.selected) {
        // update |select|, and set |read| if first selected
        mTabSelector.update(tab);
      } else {
        // immediately stop the loading of a background tab
        mTabSuspender.stop(tab);
      }
    }, this);
  }
};

/**
 * Tab event handler
 */
var mTabEvent = {
  init: function() {
    var tc = gBrowser.tabContainer;

    addEvent([tc, 'UcjsTabExTabOpen', this, false]);
    addEvent([tc, 'TabSelect', this, false]);
    addEvent([tc, 'TabClose', this, false]);
    addEvent([tc, 'SSTabRestored', this, false]);
  },

  handleEvent: function(aEvent) {
    var tab = aEvent.originalTarget;

    switch (aEvent.type) {
      case 'UcjsTabExTabOpen':
        this.onTabOpen(tab);
        break;
      case 'TabSelect':
        this.onTabSelect(tab);
        break;
      case 'TabClose':
        this.onTabClose(tab);
        break;
      case 'SSTabRestored':
        this.onSSTabRestored(tab);
        break;
    }
  },

  onTabOpen: function(aTab) {
    mTabOpener.set(aTab, 'NewTab');

    if (kPref.SUSPEND_LOADING) {
      mTabSuspender.set(aTab, kPref.SUSPEND_DELAY);
    }

    var openPos = mReferrer.isRelatedToCurrent(aTab) ?
      kPref.OPENPOS_LINKED : kPref.OPENPOS_UNLINKED;

    moveTabTo(aTab, openPos);
  },

  onTabSelect: function(aTab) {
    // handle a duplicated/undo-closed tab in |onSSTabRestored|
    // pass a startup restored tab
    if (mTab.state.restoring(aTab)) {
      return;
    }

    mTabSelector.set(aTab);

    if (kPref.SUSPEND_LOADING) {
      mTabSuspender.reload(aTab);
    }
    if (kPref.SUSPEND_NEXTTAB_RELOAD) {
      let nextTab = getAdjacentTab(aTab, +1);
      if (nextTab) {
        mTabSuspender.reload(nextTab);
      }
    }
  },

  onTabClose: function(aTab) {
    if (kPref.SUSPEND_LOADING) {
      mTabSuspender.clear(aTab);
    }

    if (aTab.selected) {
      let selectPos = aTab.pinned ?
        kPref.SELECTPOS_PINNEDTABCLOSE : kPref.SELECTPOS_TABCLOSE;

      selectTabAt(aTab, selectPos);
    }
  },

  onSSTabRestored: function(aTab) {
    // handle a duplicated/undo-closed tab
    // do not pass a startup restored tab
    if (!mTab.state.restoring(aTab)) {
      return;
    }

    mTab.state.restoring(aTab, false);

    var openPos, baseTab;

    var originalTab = getOriginalTabOfDuplicated(aTab);
    if (originalTab) {
      // @note A duplicated tab has the same data as its original tab and we
      // update some data to be as a new opened tab.

      // update |open| and |ancestors|
      mTabOpener.set(aTab, 'DuplicatedTab');

      if (aTab.selected) {
        // force to update |read|
        mTabSelector.update(aTab, {read: true});
      } else {
        // remove |select| and |read|
        mTabSelector.update(aTab, {reset: true});
      }

      openPos = kPref.OPENPOS_DUPLICATE;
      baseTab = originalTab;
    } else {
      // @note A undoclosed tab has the restored data.
      // @note |window.undoCloseTab| opens a tab and forcibly selects it.

      // update |select|, and set |read| if first selected
      mTabSelector.update(aTab);

      openPos = kPref.OPENPOS_UNDOCLOSE;
      // sets the previous selected tab to the base tab for moving this tab.
      // the previous selected tab surely exists because it was selected then
      // this undoclosed tab has been opened and selected.
      baseTab = getPrevSelectedTab();
    }

    moveTabTo(aTab, openPos, baseTab);
  }
};


//********** Tab handling functions

function getOriginalTabOfDuplicated(aTab) {
  var openTime = mTab.data(aTab, 'open');

  var tabs = gBrowser.tabs;

  for (let i = 0, l = tabs.length, tab; i < l; i++) {
    tab = tabs[i];
    if (tab !== aTab &&
        mTab.data(tab, 'open') === openTime) {
      return tab;
    }
  }
  return null;
}

function moveTabTo(aTab, aPosType, aBaseTab) {
  var baseTab = aBaseTab || gBrowser.selectedTab;

  // excluding pinned tabs
  var tabs = getTabs('active');
  var tabsNum = tabs.length;

  // returns -1 for a pinned or closing tab
  var basePos = getTabPos(tabs, baseTab);
  var tabPos = getTabPos(tabs, aTab);
  var pos = -1;

  switch (aPosType) {
    case kPosType.DEFAULT:
      break;
    case kPosType.FIRST_END:
      pos = 0;
      break;
    case kPosType.LAST_END:
      pos = tabsNum - 1;
      break;
    case kPosType.PREV_ADJACENT:
      pos = (0 < basePos) ?
        ((tabPos < basePos) ? basePos - 1 : basePos) :
        0;
      break;
    case kPosType.NEXT_ADJACENT:
      pos = (basePos < tabsNum - 1) ? basePos + 1 : tabsNum - 1;
      break;
    case kPosType.NEXT_INCREMENT_DESCENDANT:
      pos = getTabPos(tabs, getFamilyTab(baseTab,
        'next farthest descendant'));
      pos = (-1 < pos) ?
        ((pos < tabsNum - 1) ? pos + 1 : tabsNum - 1) :
        basePos + 1;
      break;
    default:
      throw 'unknown kPosType for OPENPOS';
  }

  if (-1 < pos && pos !== tabPos) {
    gBrowser.moveTabTo(aTab,
      getTabPos(gBrowser.tabs, tabs[pos]));
  }
}

function selectTabAt(aBaseTab, aPosTypes) {
  aPosTypes.some(function(posType) {
    switch (posType) {
      case kPosType.DEFAULT:
        return true;
      case kPosType.FIRST_END:
        gBrowser.selectTabAtIndex(0)
        return true;
      case kPosType.LAST_END:
        gBrowser.selectTabAtIndex(-1)
        return true;
      case kPosType.PREV_ADJACENT:
        return !!selectTab(getAdjacentTab(aBaseTab, -1));
      case kPosType.NEXT_ADJACENT:
        return !!selectTab(getAdjacentTab(aBaseTab, +1));
      case kPosType.PREV_ADJACENT_ANCESTOR:
        return !!selectTab(getFamilyTab(aBaseTab,
          'prev adjacent ancestor'));
      case kPosType.NEXT_ADJACENT_EXTENDED_DESCENDANT:
        return !!selectTab(getFamilyTab(aBaseTab,
          'next adjacent extended descendant'));
      case kPosType.ANYWHERE_OPENER:
        return !!selectOpenerTab(aBaseTab);
      case kPosType.ANYWHERE_PREV_SELECTED:
        return !!selectPrevSelectedTab(aBaseTab, {traceBack: true});
      case kPosType.ANYWHERE_OLDEST_UNREAD:
        return !!selectOldestUnreadTab();
      default:
        throw 'unknown kPosType for SELECTPOS';
    }
    // never reached, but avoid warning
    return true;
  });
}

/**
 * Retrieves a family tab of the base tab in the active tabs
 * @param aBaseTab {Element}
 * @param aStatement {string} keywords divided by ' '
 * @return {Element}
 */
function getFamilyTab(aBaseTab, aStatement) {
  const supportedStatements = [
    'prev adjacent ancestor',
    'next adjacent extended descendant',
    'next farthest descendant'
  ];

  var statement = StatementParser(aStatement, ' ', supportedStatements);

  var direction = statement.matchKey(['prev', 'next']),
      position = statement.matchKey(['adjacent', 'farthest']),
      extended = !!statement.matchKey(['extended']),
      family = statement.matchKey(['ancestor', 'descendant']);

  var activeTabs, startPos, baseId, baseAncs, isRelated, relatedPos;

  /**
   * Finds the tab that meets the statement
   */
  // excluding pinned tabs, including the base tab
  activeTabs = getTabs('active', aBaseTab);

  /**
   * Sets the starting position to examine
   */
  // returns -1 when the base tab is pinned or closing
  startPos = getTabPos(activeTabs, aBaseTab);

  // useless when no adjacent tab is in the direction
  // @note startPos is always 0 when the base tab is pinned and the state has
  // 'next'.
  if ((direction === 'prev' && --startPos < 0) ||
      (direction === 'next' && ++startPos > activeTabs.length - 1)) {
    return null;
  }

  /**
   * Sets the comparator function
   */
  baseId = mTab.data(aBaseTab, 'open');
  baseAncs = mTab.data(aBaseTab, 'ancestors');

  if (family === 'ancestor') {
    // useless when no ancestors is examined
    if (!baseAncs) {
      return null;
    }

    isRelated = function(tab) {
      let id = mTab.data(tab, 'open');
      // 1.this tab is an ancestor of the base tab
      return baseAncs.indexOf(id) > -1;
    };
  } else /* family === 'descendant' */ {
    isRelated = function(tab) {
      let ancs = mTab.data(tab, 'ancestors');
      // this tab that has no ancestors does not related with the base tab
      if (!ancs) {
        return false;
      }

      // 1.this tab is a descendant of the base tab
      // 2.the parent of the base tab is an ancestor of this tab(sibling or
      // its descendant)
      return ancs.indexOf(baseId) > -1 ||
        (extended && baseAncs && ancs.indexOf(baseAncs[0]) > -1);
    };
  }

  /**
   * Ready to examine
   */
  relatedPos = -1;
  if (position === 'adjacent') {
    // get the adjacent one
    if (isRelated(activeTabs[startPos])) {
      relatedPos = startPos;
    }
  } else /* position === 'farthest' */ {
    // get the farthest one of a sequence of tabs
    // @note No implementation for the unsupported 'prev farthest'.
    for (let i = startPos, l = activeTabs.length; i < l; i++) {
      if (!isRelated(activeTabs[i])) {
        break;
      }
      relatedPos = i;
    }
  }

  if (-1 < relatedPos) {
    return activeTabs[relatedPos];
  }
  return null;
}

function selectOpenerTab(aBaseTab, aOption) {
  return selectTab(getOpenerTab(aBaseTab, aOption));
}

function getOpenerTab(aBaseTab, aOption) {
  var {undoClose} = aOption || {};

  var baseTab = aBaseTab || gBrowser.selectedTab;

  var ancs = mTab.data(baseTab, 'ancestors');
  // no ancestor then no parent
  if (!ancs) {
    if (undoClose) {
      // has referrer (e.g. opened from bookmark)
      // @note A tab that has no opener tab is independent. So its referred URL
      // should be newly opened even if it exists in the current tabs.
      let referrerURL = mReferrer.getURL(baseTab);
      if (referrerURL) {
        // TODO: opens in foreground or background?
        return openTab(referrerURL);
      }
    }
    return null;
  }

  // the parent exists
  var parent = ancs[0];

  // including the base tab
  var tabs = getTabs('active, pinned', baseTab);

  // search in the current tabs
  for (let i = 0, l = tabs.length; i < l; i++) {
    if (mTab.data(tabs[i], 'open') === parent) {
      return tabs[i];
    }
  }

  // search in the closed tabs
  if (undoClose) {
    let undoList = mSessionStore.getClosedTabList();
    if (undoList) {
      for (let i = 0, l = undoList.length; i < l; i++) {
        if (mTab.SSdata(undoList[i], 'open') === parent) {
          // @see chrome://browser/content/browser.js::undoCloseTab
          // @note |undoCloseTab| opens a tab and forcibly selects it.
          return window.undoCloseTab(i);
        }
      }
    }
  }

  // not found
  return null;
}

function selectPrevSelectedTab(aBaseTab, aOption) {
  return selectTab(getPrevSelectedTab(aBaseTab, aOption));
}

function getPrevSelectedTab(aBaseTab, aOption) {
  var {traceBack, undoClose} = aOption || {};

  var baseTab = aBaseTab || gBrowser.selectedTab;
  // including the base tab
  var tabs = getTabs('active, pinned', baseTab);

  var time, recentTime = 0;
  var prevSelectedTime = mTabSelector.prevSelectedTime;
  var pos = -1;

  for (let i = 0, l = tabs.length, tab; i < l; i++) {
    tab = tabs[i];
    if (tab === baseTab) {
      continue;
    }
    time = mTab.data(tab, 'select');
    if (time && time > recentTime) {
      recentTime = time;
      pos = i;
    }
  }

  if (-1 < pos) {
    // found regardless of the selected time
    if (traceBack ||
        recentTime === prevSelectedTime) {
      return tabs[pos];
    }
  }

  // reopen a previous selected tab
  if (undoClose) {
    let undoList = mSessionStore.getClosedTabList();
    if (undoList) {
      for (let i = 0, l = undoList.length; i < l; i++) {
        if (mTab.SSdata(undoList[i], 'select') === prevSelectedTime) {
          // @see chrome://browser/content/browser.js::undoCloseTab
          // @note |undoCloseTab| opens a tab and forcibly selects it.
          return window.undoCloseTab(i);
        }
      }
    }
  }

  // not found
  return null;
}

function selectOldestUnreadTab(aOption) {
  return selectTab(getOldestUnreadTab(aOption));
}

function getOldestUnreadTab(aOption) {
  let {includePinned} = aOption || {};

  let tabs = getTabs(includePinned ? 'active, pinned' : 'active');

  let time, oldTime = getTime();
  let pos = -1;

  for (let i = 0, l = tabs.length, tab; i < l; i++) {
    tab = tabs[i];
    if (mTab.state.read(tab)) {
      continue;
    }
    time = mTab.data(tab, 'open');
    if (time && time < oldTime) {
      oldTime = time;
      pos = i;
    }
  }

  if (-1 < pos) {
    return tabs[pos];
  }
  return null;
}

function getAdjacentTab(aBaseTab, aDirection) {
  if (aDirection !== -1 && aDirection !== +1) {
    throw new TypeError('aDirection should be -1 or +1');
  }

  // including the base tab
  var tabs = getTabs('active, pinned', aBaseTab);

  var basePos = getTabPos(tabs, aBaseTab);
  // no tabs in the direction
  if ((aDirection === -1 && basePos === 0) ||
      (aDirection === +1 && basePos === tabs.length - 1)) {
    return null;
  }
  return tabs[pos + aDirection];
}

function closeLeftTabs(aBaseTab) {
  closeTabsFromAdjacentToEnd(aBaseTab, -1);
}

function closeRightTabs(aBaseTab) {
  closeTabsFromAdjacentToEnd(aBaseTab, +1);
}

function closeTabsFromAdjacentToEnd(aBaseTab, aDirection) {
  if (aDirection !== -1 && aDirection !== +1) {
    throw new TypeError('aDirection should be -1 or +1');
  }

  var baseTab = aBaseTab || gBrowser.selectedTab;
  // excluding pinned tabs
  var tabs = getTabs('active');

  var basePos = getTabPos(tabs, baseTab);
  // 1.the base tab is not active
  // 2.no tabs in the direction
  if (basePos < 0 ||
      (aDirection === -1 && basePos === 0) ||
      (aDirection === +1 && basePos === tabs.length - 1)) {
    return;
  }

  var top, last;
  // closing from the last tab
  if (aDirection === -1) {
    top = 0;
    last = basePos - 1;
  } else {
    top = basePos + 1;
    last = tabs.length - 1;
  }

  for (let i = last; i >= top ; i--) {
    removeTab(tabs[i], {safeBlock: true});
  }
}

function closeReadTabs() {
  // excluding pinned tabs
  var tabs = getTabs('active');

  // closing from the last tab
  for (let i = tabs.length - 1, tab; i >= 0 ; i--) {
    tab = tabs[i];
    if (mTab.state.read(tab)) {
      removeTab(tab, {safeBlock: true});
    }
  }
}

/**
 * Gets an array of tabs
 * @param aStatement {string} keywords divided by ',' to include
 *   'pinned': pinned tabs
 *   'active': tabs of the current active group (exclude pinned tabs)
 * @param aForcedTab {Element} [optional]
 *   forces to include this tab regardless of aStatement
 * @return {Array}
 *
 * TODO: |aForcedTab| is used only for a closing tab on |TabClose| event.
 * Make a smart handling.
 */
function getTabs(aStatement, aForcedTab) {
  var statement = StatementParser(aStatement, ',');
  var pinned = !!statement.matchKey(['pinned']),
      active = !!statement.matchKey(['active']);

  return Array.filter(gBrowser.tabs, function(tab) {
    if (tab === aForcedTab) {
      return true;
    }
    if (tab.closing) {
      return false;
    }
    return (pinned && tab.pinned)  ||
           (active && !tab.pinned && !tab.hidden);
  });
}

function getTabPos(aTabs, aTab) {
  return Array.indexOf(aTabs, aTab);
}

function selectTab(aTab) {
  if (aTab) {
    if (!aTab.selected) {
      gBrowser.selectedTab = aTab;
    }
    return aTab;
  }
  return null;
}


//********** Utilities

/**
 * Makes an unique value with the current time
 * @return {integer}
 */
var getTime = (function() {
  var time = 0;

  return function() {
    var now = Date.now();
    return time = (time === now ? ++now : now);
  };
})();

function htmlEscape(aString) {
  return aString.
    replace(/&/g, '&amp;'). // must escape at first
    replace(/>/g, '&gt;').
    replace(/</g, '&lt;').
    replace(/"/g, '&quot;').
    replace(/'/g, '&apos;');
}

function htmlUnescape(aString) {
  return aString.
    replace(/&amp;/g, '&').
    replace(/&gt;/g, '>').
    replace(/&lt;/g, '<').
    replace(/&quot;/g, '"').
    replace(/&apos;/g, "'");
}

function getPageTitle(aURL) {
  var title;
  try {
    // @see resource:///modules/PlacesUtils.jsm
    title = window.PlacesUtils.history.getPageTitle(makeURI(aURL));
  } catch (ex) {}

  return title || aURL;
}

function makeURI(aURL) {
  try{
    // @see chrome://global/content/contentAreaUtils.js::makeURI
    return window.makeURI(aURL);
  } catch (ex) {}
  return null;
}

function scanHistoryDatabase(aSQL, aParams, aColumnName) {
  const {Cc, Ci} = window;

  var statement =
    Cc['@mozilla.org/browser/nav-history-service;1'].
    getService(Ci.nsPIPlacesDatabase).
    DBConnection.
    createStatement(aSQL);

  for (let key in aParams) {
    statement.params[key] = aParams[key];
  }

  try {
    if (statement.executeStep()) {
      return statement.row[aColumnName];
    }
  } finally {
    statement.reset();
    statement.finalize();
  }
  return null;
}

/**
 * Creates a statement parser
 * @param aStatement {string}
 * @param aDelimiter {string}
 * @param aSupportedStatements {array} [optional]
 * @return {hash}
 *   @member matchKey {function}
 *
 * @note used in getFamilyTab(), getTabs()
 */
function StatementParser(aStatement, aDelimiter, aSupportedStatements) {
  var mKeys;

  init();

  function init() {
    var delimiterRE = (aDelimiter === ' ') ?
      RegExp('\\s+', 'g') :
      RegExp('\\s*\\' + aDelimiter + '\\s*', 'g');

    var statement = aStatement.trim().replace(delimiterRE, aDelimiter);

    if (aSupportedStatements &&
        aSupportedStatements.indexOf(statement) < 0) {
      throw new TypeError('unsupported aStatement');
    }

    mKeys = statement.split(aDelimiter);
  }

  function matchKey(aSortOfKeys) {
    for (let i = 0; i < aSortOfKeys.length; i++) {
      if (mKeys.indexOf(aSortOfKeys[i]) > -1) {
        return aSortOfKeys[i];
      }
    }
    return null;
  }

  return {
    matchKey: matchKey
  };
}


//********** Entry point

/**
 * Patches for the system default
 */
function modifySystemSetting() {
  const prefs = [
    // @pref Disable the custom positioning and focusing of tabs.
    {key: 'browser.tabs.insertRelatedAfterCurrent', value: false},
    {key: 'browser.tabs.selectOwnerOnClose', value: false},
    // @pref Disable loading of the background tabs in restoring startup.
    {key: 'browser.sessionstore.restore_on_demand', value: true},
    {key: 'browser.sessionstore.restore_pinned_tabs_on_demand', value: true}
  ];

  prefs.forEach(function(pref) {
    var value = getPref(pref.key);
    if (value !== pref.value) {
      setPref(pref.key, pref.value);
    }
  });
}

/**
 * Customizes the tab tooltip
 */
function customizeTabTooltip() {
  // @see chrome://browser/content/tabbrowser.xml::createTooltip
  addEvent([
    window.document.getElementById('tabbrowser-tab-tooltip'),
    'popupshowing',
    onPopup,
    false
  ]);

  function onPopup(aEvent) {
    aEvent.stopPropagation();
    let tooltip = aEvent.target;
    let tab = window.document.tooltipNode;
    if (tab.localName !== 'tab' || tab.mOverCloseButton) {
      return;
    }

    // WORKAROUND: The tooltip is delayed-shown after a tab with a cursor is
    // removed (e.g. clicking the middle button of mouse). Then, the tooltip
    // is useless.
    if (!tab.linkedBrowser) {
      return;
    }

    // add the information of the parent tab to a tab which is newly opened
    if (!tab.linkedBrowser.canGoBack && mReferrer.exists(tab)) {
      // |createTooltip| would set the title of the tab by default
      let label = tooltip.label;
      label += '\n\nFrom: ' + mReferrer.getTitle(tab);
      tooltip.setAttribute('label', label);
    }
  }
}

function TabEx_init() {
  modifySystemSetting();
  customizeTabTooltip();

  mTabEvent.init();
  mSessionStore.init();
  mTabOpener.init();
  mStartup.init();
}

TabEx_init();


//********** Export

return {
  tabState: mTab.stateTest,
  referrer: mReferrer,
  selectOpenerTab: selectOpenerTab,
  selectPrevSelectedTab: selectPrevSelectedTab,
  closeLeftTabs: closeLeftTabs,
  closeRightTabs: closeRightTabs,
  closeReadTabs: closeReadTabs
};


})(this);
