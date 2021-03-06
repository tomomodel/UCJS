// ==UserScript==
// @name SendTo.uc.js
// @description Opens (page, link, image, selected text) with the web service
// @include main
// ==/UserScript==

// @require Util.uc.js, UI.uc.js
// @require [optional][for preset] WebService.uc.js
// @usage access to items in the main context menu


(function(window, undefined) {


"use strict";


/**
 * Imports
 */
const {
  getNodeById: $ID,
  addEvent,
  getSelectionAtCursor
} = window.ucjsUtil;

function $E(aTagOrNode, aAttribute) {
  return window.ucjsUtil.createNode(aTagOrNode, aAttribute, handleAttribute);
}

// for debug
function log(aMsg) {
  return window.ucjsUtil.logMessage('SendTo.uc.js', aMsg);
}

const {
  ContentArea: {
    contextMenu: contentAreaContextMenu
  }
} = window.ucjsUI;

/**
 * Identifiers
 */
const kID = {
  startSeparator: 'ucjs_sendTo_startsep',
  endSeparator: 'ucjs_sendTo_endsep'
};

/**
 * UI strings
 */
const kString = {
  /**
   * for the label text of a menuitem
   *
   * @note keep in sync with |kPreset[item].types|
   */
  types: {
    'PAGE': 'ページ',
    'LINK': 'リンク',
    'IMAGE': '画像',
    'TEXT': 'テキスト'
  },

  /**
   * the tooltip text of a menuitem
   *
   * %DATA% : the passed data
   * %URL% : the opened URL
   */
  tooltip: '%DATA%\n\n%URL%'
};

/**
 * Preset list
 *
 * @value {hash[]}
 *   @key label {string} a display name for menuitem
 *     %TYPE% is replaced into |kString.types|
 *   @key types {string[]}
 *     the passed data and case of showing the menuitem
 *     'PAGE': the page URL not on the following cases
 *     'LINK': the link URL on a link
 *     'IMAGE': the image URL on an image
 *     'TEXT': the selected text on a selection
 *     @note keep in sync with |kString.types|
 *   @key URL {string} a URL that opens
 *     pass the data by alias
 *     @see |AliasFixup|
 *   @key URL {function} for the custom formattings
 *     @param aData {string} the raw data
 *   @key extensions {string[]} [optional]
 *     specify the file extensions for 'LINK' type
 *   @key command {function} [optional] a command that is executed at showing
 *   the menuitem
 *     @param aParams {hash}
 *       @key menuitem {Element}
 *       @key data {string}
 *   @key disabled {boolean} [optional]
 */
const kPreset = [
  {
    // @require WebService.uc.js
    disabled: !window.ucjsWebService,
    types: ['PAGE'],
    label: '%TYPE%の はてなブックマーク (-)',

    URL: function(aData) {
      let entryURL = 'http://b.hatena.ne.jp/entry/';

      if (/^https:/.test(aData)) {
        entryURL += 's/';
      }

      return entryURL + '%SCHEMELESS%';
    },

    command: function(aParams) {
      let {menuitem, data} = aParams;

      function updateLabel(text) {
        if (menuitem) {
          let label = menuitem.getAttribute('label');

          $E(menuitem, {
            label: label.replace('(-)', '(' + text + ')')
          });
        }
      }

      // do not request a URL with parameters for security
      if (/[?#].*$/.test(data)) {
        updateLabel('注意：パラメータ付 URL');
        return;
      }

      window.ucjsWebService.get({
        name: 'HatenaBookmarkCount',
        data: data,
        callback: function(aResponse) {
          if (aResponse !== null) {
            updateLabel(aResponse);
          }
        }
      });
    }
  },
  {
    URL: 'http://www.aguse.jp/?m=w&url=%ENC%',
    types: ['LINK'],
    label: '%TYPE%を aguse で調査'
  },
  {
    URL: 'https://docs.google.com/viewer?url=%ENC%',
    types: ['LINK'],
    // @see https://docs.google.com/support/bin/answer.py?answer=1189935
    extensions: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf'],
    label: '%TYPE%を Google Docs Viewer で表示'
  },
  {
    URL: 'https://www.google.com/searchbyimage?image_url=%ENC%',
    types: ['IMAGE'],
    label: '%TYPE%を Google Image で検索'
  },
  {
    URL: 'https://www.pixlr.com/editor/?image=%ENC%',
    types: ['LINK', 'IMAGE'],
    extensions: ['bmp', 'gif', 'jpg', 'jpeg', 'png', 'psd', 'pxd'],
    label: '%TYPE%を Pixlr Editor で編集'
  },
  {
    URL: 'http://dic.search.yahoo.co.jp/search?ei=UTF-8&fr=dic&p=%ENC%',
    types: ['TEXT'],
    label: '%TYPE%を Yahoo!辞書 で引く'
  }
];

/**
 * Handler of fixing up a alias with the data
 *
 * @return {hash}
 *   @member create {function}
 *
 * [aliases]
 * %RAW% : data itself
 * %ENC% : with URI encoded
 * %SCHEMELESS%, %sl% : without the URL scheme
 * %PARAMLESS%, %pl% : without the URL parameter
 *
 * @note aliases can be combined by '|';
 * e.g. %SCHEMELESS|ENC% : a data that is trimmed the scheme and then URI
 * encoded (the multiple aliases is applied in the order of settings)
 */
const AliasFixup = (function() {
  const kAliasSplitter = '|';
  const kAliasPattern = RegExp('%([a-z_' + kAliasSplitter + ']+)%', 'ig');

  function create(aText, aData) {
    return aText.replace(kAliasPattern, (match, alias) => {
      let data = aData;

      alias.split(kAliasSplitter).forEach((modifier) => {
        data = fixupModifier(data, modifier);
      });

      return data;
    });
  }

  function fixupModifier(aData, aModifier) {
    switch (aModifier) {
      case 'SCHEMELESS':
      case 'sl':
        return aData.replace(/^https?:\/\//, '');
      case 'PARAMLESS':
      case 'pl':
        return aData.replace(/[?#].*$/, '');
      case 'ENC':
        return encodeURIComponent(aData);
      case 'RAW':
        return aData;
    }
    return '';
  }

  return {
    create: create
  };
})();

function SendTo_init() {
  initMenu();
}

function initMenu() {
  let contextMenu = contentAreaContextMenu;

  setSeparators(contextMenu, contextMenu.firstChild);

  addEvent(contextMenu, 'popupshowing', showContextMenu, false);
}

function showContextMenu(aEvent) {
  let contextMenu = aEvent.target;

  if (contextMenu !== contentAreaContextMenu) {
    return;
  }

  let [sSep, eSep] = getSeparators();

  // remove existing items
  for (let item; (item = sSep.nextSibling) !== eSep; /**/) {
    contextMenu.removeChild(item);
  }

  getAvailableItems().forEach((item) => {
    contextMenu.insertBefore(item, eSep);
  });
}

function getAvailableItems() {
  let items = [];

  // @see chrome://browser/content/nsContextMenu.js
  let {onLink, onImage, onTextInput, linkURL, mediaURL} =
    window.gContextMenu;
  let pageURL = gBrowser.currentURI.spec;
  let selection = getSelectionAtCursor();
  let onPlainTextLink = selection && !onLink && linkURL;

  kPreset.forEach((service) => {
    let {disabled, types, extensions} = service;

    if (disabled) {
      return;
    }

    if (!onLink && !onImage && !onTextInput &&
        types.indexOf('PAGE') > -1 &&
        /^https?:/.test(pageURL)) {
      items.push(makeItem('PAGE', pageURL, service));
    }

    if ((onLink || onPlainTextLink) &&
        types.indexOf('LINK') > -1 &&
        /^https?:/.test(linkURL) &&
        (!extensions || testExtension(extensions, linkURL))) {
      items.push(makeItem('LINK', linkURL, service));
    }

    if (onImage &&
        types.indexOf('IMAGE') > -1 &&
        /^https?:/.test(mediaURL)) {
      items.push(makeItem('IMAGE', mediaURL, service));
    }

    if (selection &&
        types.indexOf('TEXT') > -1) {
      items.push(makeItem('TEXT', selection, service));
    }
  });

  return items;
}

function makeItem(aType, aData, aService) {
  let URL = 
    (typeof aService.URL === 'function') ?
    aService.URL(aData) :
    aService.URL;

  URL = AliasFixup.create(URL, aData);

  let label = aService.label.
    replace('%TYPE%', kString.types[aType]);

  let tooltip = kString.tooltip.
    replace('%URL%', URL).
    replace('%DATA%', aData);

  let item = $E('menuitem', {
    label: label,
    tooltiptext: tooltip,
    open: URL
  });

  if (aService.command) {
    aService.command({menuitem: item, data: aData});
  }

  return item;
}

function testExtension(aExtensions, aURL) {
  if (!aURL) {
    return false;
  }

  let targets = [];
  let pattern = /[\w\-]+\.([a-z]{2,5})(?=[?#]|$)/ig, match;

  while ((match = pattern.exec(aURL))) {
    targets.unshift(match[1]);
  }

  // Case: http://www.example.com/path/file1.ext?key=file2.ext
  // Examines file2.ext, and then file1.ext
  return targets.some((item) => aExtensions.indexOf(item) > -1);
}

// @note |ucjsUI::manageContextMenuSeparators()| manages the visibility of
// separators
function setSeparators(aContextMenu, aReferenceNode) {
  if (aReferenceNode === undefined) {
    aReferenceNode = null;
  }

  [
    kID.startSeparator,
    kID.endSeparator
  ].
  forEach((id) => {
    aContextMenu.insertBefore(
      $E('menuseparator', {id: id}), aReferenceNode);
  });
}

function getSeparators() {
  return [
    $ID(kID.startSeparator),
    $ID(kID.endSeparator)
  ];
}

function handleAttribute(aNode, aName, aValue) {
  if (aName === 'open') {
    aNode.setAttribute('oncommand', commandForOpenURL(aValue));
    // @see chrome://browser/content/utilityOverlay.js::checkForMiddleClick
    aNode.setAttribute('onclick', 'checkForMiddleClick(this,event);');
    return true;
  }
  return false;
}

function commandForOpenURL(aURL) {
  let command = 'ucjsUtil.openTab("%URL%",' +
    '{inBackground:event.button===1,relatedToCurrent:true});';

  return command.replace('%URL%', aURL);
}

/**
 * Entry point
 */
SendTo_init();


})(this);
