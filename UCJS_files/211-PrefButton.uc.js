// ==UserScript==
// @name        PrefButton.uc.js
// @description Adds buttons for setting the preferences.
// @include     main
// ==/UserScript==

// @require Util.uc.js
// @usage Access to items on the navigation toolbar.
// @note The buttons is styled as the height of a toolbar is 24pt. see
// |setStyleSheet()|
// @note Some about:config preferences are changed. see @pref


(function(window, undefined) {


"use strict";


/**
 * Identifiers
 */
const kID = {
  // Default
  NAVIGATION_TOOLBAR: 'nav-bar',
  // Custom
  CONTAINER_ID:   'ucjs_prefbutton_container',
  ITEM_CLASS_KEY: 'ucjs_prefbutton_item',
  ITEM_ID_PREFIX: 'ucjs_prefbutton_'
};

/**
 * Type of <button>
 */
const kItemType = {
  button:   'button',
  checkbox: 'checkbox'
};

/**
 * Preset items
 * @note <key> name must consist of 1-byte character [A-Za-z0-9_] only.
 * @param disabled {boolean} [optional]
 *   true: this item is ignored
 * @param tabMode {boolean} [optional]
 *   true: each tab is observed
 * @param type {kItemType} a type of <button>
 * @param label {string} button label
 * @param image {URL string} [instead of <label>] button image
 * @param description {string} tooltip text
 * @param checked {boolean} [for type <checkbox>] checkbox state
 * @param command {function} button command
 */
var mPreset = {
  'ToggleCSS_Tab': {
    tabMode: true,
    type: kItemType.checkbox,
    label: 'CSS',
    description: 'Toggle CSS (Tab)',

    // gets the content viewer for the current content document
    // @see chrome://browser/content/tabbrowser.xml::
    // markupDocumentViewer
    get documentViewer() {
      return gBrowser.markupDocumentViewer;
    },

    get checked() {
      return !this.documentViewer.authorStyleDisabled;
    },

    command: function() {
      this.documentViewer.authorStyleDisabled = this.checked;
    }
  },

  'ToggleReferrer': {
    type: kItemType.checkbox,
    label: 'Ref.',
    description: 'Toggle Referrer',

    // @pref see http://kb.mozillazine.org/Network.http.sendRefererHeader
    // 0: never send the referrer header
    // 1: send when clicking on a link
    // 2: send when clicking on a link or loading an image (Default)
    pref: 'network.http.sendRefererHeader',

    get checked() {
      return getPref(this.pref, 2) !== 0;
    },

    command: function() {
      setPref(this.pref, this.checked ? 0 : 2);
    }
  },

  'ToggleJava': {
    type: kItemType.checkbox,
    label: 'Java',
    description: 'Toggle Java',

    get disabled() {
      return this.plugin === null;
    },

    get plugin() {
      const {Cc, Ci} = window;

      var plugins =
        Cc['@mozilla.org/plugin/host;1'].
        getService(Ci.nsIPluginHost).
        getPluginTags({});

      var plugin = null;

      for (let i = 0; i < plugins.length; i++) {
        if (plugins[i].name.indexOf('Java(TM)') > -1) {
          plugin = plugins[i];
          break;
        }
      }

      delete this.plugin;
      return this.plugin = plugin;
    },

    get checked() {
      return !(this.plugin.disabled || this.plugin.blocklisted);
    },

    command: function() {
      if (!this.plugin.blocklisted) {
        this.plugin.disabled = !this.plugin.disabled;
      }
    }
  },

  'ClearCache': {
    type: kItemType.button,
    label: 'CLR',
    description: 'Clear cache',
    image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAAe1BMVEUAAAC6urpmZmZvb2+qqqpmZjOZZjMzMzOZmZmZZmbMzGbMmTOZmTOZmWbMzJnFxcXMmWb//5n/zGZmMzPS0tL//8z/zJlaW1szM2bMmZlaZGd7e3szZmbi4uKHh4fMzMzv7+/IyMhecnqZmcxmZswzM5mZZpmZzMxmZpkJF2RIAAAAKXRSTlMA/////////////////////////////////////////////////////0LHzqgAAACJSURBVHhefc7JEsIgEARQYkZFMIPEsCiSqLjk/7/QEU1JLvbtdddQMPY3KamSz5TGcQIAqEe63f3kOET+M4oBzpcYrtkKEY1BiD24/r2SKBoDD/WJig4tUdv2cAzOd7nRxloUonG+yk+qHepWCLndf8xY1dAu5Zp/Tb/Y0F6YmuVqZrpa1DMXeQFq7Aju0wjcLAAAAABJRU5ErkJggg==',

    command: function() {
      $ID('Tools:Sanitize').doCommand();
    }
  }//,
};


//********** Functions


/**
 * Progress listener
 */
var mBrowserProgressListener = {
  onStateChange: function(aWebProgress, aRequest, aStateFlags, aStatus) {
    if (aStateFlags & window.Ci.nsIWebProgressListener.STATE_STOP) {
      updateState();
    }
  },

  onLocationChange: function() {},
  onProgressChange: function() {},
  onStatusChange: function() {},
  onSecurityChange: function() {}
};

function PrefButton_init() {
  setStyleSheet();
  makeButtons();

  addEvent([gBrowser, 'select', function() {
    updateState(true);
  }, false]);

  gBrowser.addProgressListener(mBrowserProgressListener);
  addEvent([window, 'unload', function() {
    gBrowser.removeProgressListener(mBrowserProgressListener);
  }, false]);
}

function updateState(aTabMode) {
  for (let [, item] in Iterator(mPreset)) {
    if (item.disabled || (aTabMode && !item.tabMode)) {
      continue;
    }

    let button = $ID(item.id);
    switch (item.type) {
      case kItemType.button:
        // do nothing
        break;
      case kItemType.checkbox:
        if (button.checked !== item.checked) {
          button.checked = item.checked;
        }
        break;
    }
  }
}

function doCommand(aEvent) {
  var id = aEvent.target.id;

  for (let [, item] in Iterator(mPreset)) {
    if (id === item.id) {
      item.command();
    }
  }
}

function makeButtons() {
  var toolbar = $ID(kID.NAVIGATION_TOOLBAR);

  var hbox = $E('hbox');
  hbox.id = kID.CONTAINER_ID;

  for (let [name, item] in Iterator(mPreset)) {
    if (item.disabled) {
      continue;
    }

    let button = $E('button');

    button.id = item.id =
      kID.ITEM_ID_PREFIX + name.replace(/[^A-Za-z0-9_]/g, '_');
    button.className = kID.ITEM_CLASS_KEY;
    button.setAttribute('type', item.type);
    button.setAttribute('tooltiptext', item.description);

    if (item.image) {
      button.setAttribute('image', item.image);
    } else {
      button.setAttribute('label', item.label);
    }

    addEvent([button, 'command', doCommand, false]);

    hbox.appendChild(button);
  }

  toolbar.appendChild(hbox);
}

function setStyleSheet() {
  // @note Suppose the height of the toolbar-menubar is 24pt.
  var css = '\
    #%%kID.CONTAINER_ID%%{\
      margin:3px 0 3px 2px;\
    }\
    .%%kID.ITEM_CLASS_KEY%%,\
    .%%kID.ITEM_CLASS_KEY%%:focus{\
      -moz-appearance:none;\
      width:20px;\
      min-width:20px;\
      height:16px;\
      margin:0 2px 0 0;\
      padding:0;\
      border:1px solid #999;\
      -moz-border-top-colors:none;\
      -moz-border-right-colors:none;\
      -moz-border-bottom-colors:none;\
      -moz-border-left-colors:none;\
      background:transparent none center center no-repeat;\
      font:8px "Arial";\
    }\
    .%%kID.ITEM_CLASS_KEY%%:active,\
    .%%kID.ITEM_CLASS_KEY%%[checked=true]{\
      border:1px inset #ccc;\
      background-color:#ffcccc;\
    }\
    .%%kID.ITEM_CLASS_KEY%%:hover{\
      cursor:pointer;\
      opacity:0.6;\
    }\
    .%%kID.ITEM_CLASS_KEY%%>hbox{\
      border:none;\
      padding:0;\
    }\
  ';

  setCSS(css.replace(/%%(.+?)%%/g, function($0, $1) eval($1)));
}


//********** Utilities

function $ID(aId) {
  return window.document.getElementById(aId);
}

function $E(aTag) {
  return window.document.createElement(aTag);
}


//********** Imports

function addEvent(aData) {
  window.ucjsUtil.setEventListener(aData);
}

function setCSS(aCSS) {
  window.ucjsUtil.setChromeStyleSheet(aCSS);
}

function getPref(aKey, aDefaultValue) {
  return window.ucjsUtil.getPref(aKey, aDefaultValue);
}

function setPref(aKey, aValue) {
  window.ucjsUtil.setPref(aKey, aValue);
}

function log(aMsg) {
  return window.ucjsUtil.logMessage('PrefButton.uc.js', aMsg);
}


//********** Entry point

PrefButton_init();


})(this);
