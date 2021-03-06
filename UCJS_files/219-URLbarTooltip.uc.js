// ==UserScript==
// @name        URLbarTooltip.uc.js
// @description Shows suggestion hints on a tooltip of the URL bar
// @include     main
// ==/UserScript==

// @require Util.uc.js
// @usage a tooltip panel will popup with 'Ctrl + Alt + MouseMove' on the URL
// bar


(function(window, undefined) {


"use strict";


/**
 * Imports
 */
const {
  Prefs: {
    get: getPref
  },
  createNode: $E,
  getNodeById: $ID,
  addEvent,
  scanPlacesDB
} = window.ucjsUtil;

// for debug
function log(aMsg) {
  return window.ucjsUtil.logMessage('URLbarTooltip.uc.js', aMsg);
}

/**
 * Identifiers
 */
const kID = {
  panel: 'ucjs_URLbarTooltip_panel'
};

/**
 * CSS for items of panel
 */
const kStyle = {
  header: [
    'font-weight:bold',
    'font-size:110%',
    'text-align:center',
    'margin:0'
  ],

  // match the style with the border of <groupbox>
  //
  // @see chrome://global/skin/groupbox.css
  separator: [
    'border-top:1px solid ThreeDShadow',
    'border-bottom:1px solid ThreeDHighlight',
    'height:0',
    'margin:0.2em 3px 0.1em'
  ]
};

/**
 * UI strings
 */
const kUI = {
  title: 'Location bar suggestion hints',
  restrictGroup: 'Restrict',
  shortcutGroup: 'Shortcut'
};

function getURLbar() {
  return $ID('urlbar');
}

function getPanel() {
  return $ID(kID.panel);
}

function URLbarTooltip_init() {
  initPanel();
}

function initPanel() {
  $ID('mainPopupSet').appendChild($E('panel', {
    id: kID.panel,
    backdrag: true
  }));

  addEvent(getURLbar(), 'mousemove', showPanel, false);
}

function showPanel(aEvent) {
  if (aEvent.ctrlKey &&
      aEvent.altKey &&
      getPanel().state === 'closed') {
    buildContent();

    // close the default tooltip
    // @see chrome://browser/content/urlbarBindings.xml::_hideURLTooltip
    getURLbar()._hideURLTooltip();

    getPanel().openPopupAtScreen(aEvent.screenX, aEvent.screenY, false);
  }
}

function buildContent() {
  let panel = getPanel();

  // remove existing content
  if (panel.firstChild) {
    panel.removeChild(panel.firstChild);
  }

  let box = $E('vbox');

  box.appendChild($E('label', {
    value: kUI.title,
    style: makeCSS(kStyle.header)
  }));
  box.appendChild(makeGroup(getRestrictData(), kUI.restrictGroup));
  box.appendChild(makeGroup(getShortcutData(), kUI.shortcutGroup));
  panel.appendChild(box);
}

function makeGroup(aData, aGroupName) {
  let groupbox, grid, columns, rows, row;

  groupbox = $E('groupbox');

  groupbox.appendChild($E('caption', {label: aGroupName}));

  grid = groupbox.appendChild($E('grid'));

  columns = grid.appendChild($E('columns'));

  columns.appendChild($E('column'));
  columns.appendChild($E('column'));

  rows = grid.appendChild($E('rows'));

  aData.forEach((item) => {
    if (item === 'separator') {
      row = $E('separator', {
        style: makeCSS(kStyle.separator)
      });
    }
    else {
      row = $E('row');
      row.appendChild($E('label', {
        value: item.keyword
      }));
      row.appendChild($E('label', {
        value: item.name
      }));
    }

    rows.appendChild(row);
  });

  return groupbox;
}

function getRestrictData() {
  // @see http://kb.mozillazine.org/Location_Bar_search
  const kRestrictKeys = {
    'browser.urlbar.restrict.history': 'History',
    'browser.urlbar.restrict.bookmark': 'Bookmarks',
    'browser.urlbar.restrict.tag': 'Tagged',
    'browser.urlbar.restrict.openpage': 'In open tabs',
    'browser.urlbar.restrict.typed': 'User typed',
    'browser.urlbar.match.title': 'Page titles',
    'browser.urlbar.match.url': 'Page urls'
  };

  let data = [];

  for (let key in kRestrictKeys) {
    let keyword = getPref(key);

    if (keyword) {
      data.push({
        keyword: keyword,
        name: kRestrictKeys[key]
      });
    }
  }

  return data;
}

function getShortcutData() {
  let searchEnginesData = [],
      bookmarksData = [];

  // get search engine keywords
  Services.search.getEngines().forEach((item) => {
    if (item.alias) {
      searchEnginesData.push({
        keyword: item.alias,
        name: item.description || item.name
      });
    }
  });

  // get bookmark keywords
  let SQLExp = [
    'SELECT b.title, k.keyword, p.url',
    'FROM moz_bookmarks b',
    'JOIN moz_keywords k ON k.id = b.keyword_id',
    'JOIN moz_places p ON p.id = b.fk'
  ].join(' ');

  let resultRows = scanPlacesDB({
    expression: SQLExp,
    columns: ['title', 'keyword', 'url']
  });

  if (resultRows) {
    resultRows.forEach((row) => {
      bookmarksData.push({
        keyword: row.keyword,
        name: row.title || getPrePath(row.url)
      });
    });
  }

  return [
    searchEnginesData,
    bookmarksData
  ].
  reduce((previous, current) => {
    if (current.length) {
      current.sort((a, b) => a.keyword.localeCompare(b.keyword));

      if (previous.length) {
        current.unshift('separator');
      }

      return previous.concat(current);
    }
    return previous;
  }, []);
}

function makeCSS(aData) {
  return aData.map((data) => data + '!important;').join('');
}

function getPrePath(aURL) {
  const kMaxLen = 40;

  let prePath = aURL.replace(/^(\w+:[/]*[^/]+).*$/, '$1');

  if (prePath.length > kMaxLen) {
    prePath = prePath.substr(0, kMaxLen) + '...';
  }

  return prePath;
}

/**
 * Entry point
 */
URLbarTooltip_init();


})(this);
