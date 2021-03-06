// ==UserScript==
// @name        PrettyPrint.uc.js
// @description Prettify a code text (JS/CSS) in the Scratchpad
// @include     main
// ==/UserScript==

// @require Util.uc.js, UI.uc.js
// @usage creates a menuitem in the context menu of a plain text page of JS/CSS


(function(window, undefined) {


"use strict";


/**
 * Imports
 */
const {
  XPCOM: {
    getModule
  },
  createNode: $E,
  getNodeById: $ID,
  addEvent
} = window.ucjsUtil;

// for debug
function log(aMsg) {
  return window.ucjsUtil.logMessage('PrettyPrint.uc.js', aMsg);
}

const {
  ContentArea: {
    contextMenu: contentAreaContextMenu
  }
} = window.ucjsUI;

/**
 * Text type constants
 *
 * @note used to set a beautifier method and set the syntax highlight mode for
 * the Scratchpad editor
 */
const kTextType = (function() {
  // @see resource://app/modules/devtools/sourceeditor/editor.js
  const Editor = getModule('devtools/sourceeditor/editor');

  return {
    js:  Editor.modes.js,
    css: Editor.modes.css
  };
})();

/**
 * Optional settings for beautifying
 *
 * @note the default values are used if absent
 * @see |Beautifier::kOptionList|
 */
const kBeautifierOptions = {};

/**
 * Menu handler
 */
const MenuHandler = (function() {
  const kUI = {
    prettifySourcePage: {
      id: 'ucjs_prettyprint_prettifySourcePage_menuitem',
      label: '表示コードを整形',
      accesskey: 'P'
    }
  };

  let getViewSourceItem = () => $ID('context-viewsource');

  function init() {
    let context = contentAreaContextMenu;

    addEvent(context, 'popupshowing', showContextMenu, false);

    let prettifySourcePageItem = $E('menuitem', {
      id: kUI.prettifySourcePage.id,
      label: kUI.prettifySourcePage.label,
      accesskey: kUI.prettifySourcePage.accesskey
    });

    addEvent(prettifySourcePageItem, 'command', onCommand, false);

    context.insertBefore(prettifySourcePageItem, getViewSourceItem());
  }

  function showContextMenu(aEvent) {
    let contextMenu = aEvent.target;

    if (contextMenu !== contentAreaContextMenu) {
      return;
    }

    let contentDocument = gBrowser.contentDocument;
    let shouldShow =
      !getViewSourceItem().hidden &&
      getTextType(contentDocument) &&
      getTextContainer(contentDocument);

    // @see chrome://browser/content/nsContextMenu.js::showItem
    window.gContextMenu.showItem(kUI.prettifySourcePage.id, shouldShow);
  }

  function onCommand(aEvent) {
    let menuitem = aEvent.target;

    if (menuitem.id === kUI.prettifySourcePage.id) {
      let contentDocument = gBrowser.contentDocument;
      let state = {
        filename: contentDocument.URL,
        type: getTextType(contentDocument),
        text: getTextContent(contentDocument),
        beautifierOptions: kBeautifierOptions
      };

      Scratchpad.prettify(state);
    }
  }

  /**
   * Export
   */
  return {
    init: init
  };
})();

/**
 * Scratchpad handler
 */
const Scratchpad = (function() {
  /**
   * Show a prettified text in the Scratchpad
   *
   * @param {hash} aState
   *   filename {string}
   *   type {kTextType}
   *   text {string}
   *   beautifierOptions {hash} [optional]
   *     @see |Beautifier::kOptionList|
   *
   * TODO: a better check of parameters
   */
  function prettify(aState) {
    let {filename, type, text, beautifierOptions} = aState || {};

    if (!type) {
      prompt('Error: unsupported text type');
      return;
    }

    if (!text) {
      prompt('Error: no content');
      return;
    }

    if (text.length > 100000) {
      let warning =
        'It may take longer time for a large text.\n' +
        'Do you want to continue?';

      if (!prompt(warning, {doConfirm: true})) {
        return;
      }
    }

    let state = {
      filename: filename,
      type: type,
      text: Beautifier.execute(type, text, beautifierOptions)
    };

    if (!open(state)) {
      prompt('Error: cannot open Scratchpad');
      return;
    }
  }

  /**
   * Open the Scratchpad window and set a source text and the editor mode
   *
   * @param {hash} aState
   *   filename {string}
   *   type {kTextType}
   *   text {string}
   * @return {DOMWindow}
   *   the new window object that holds Scratchpad
   */
  function open(aState) {
    const {ScratchpadManager} =
      getModule('resource://app/modules/devtools/scratchpad-manager.jsm');

    let scratchpadWindow = ScratchpadManager.openScratchpad();

    if (!scratchpadWindow) {
      return null;
    }

    let onLoad = () => {
      scratchpadWindow.removeEventListener('load', onLoad, false);

      scratchpadWindow.Scratchpad.addObserver({
        onReady: function(aScratchpad) {
          aScratchpad.removeObserver(this);

          aScratchpad.setFilename(aState.filename);
          aScratchpad.setText(aState.text);
          aScratchpad.editor.setMode(aState.type);
        }
      });
    };

    scratchpadWindow.addEventListener('load', onLoad, false);

    return scratchpadWindow;
  }

  /**
   * Export
   */
  return {
    prettify: prettify
  };
})();

/**
 * Beautifier handler
 */
const Beautifier = (function() {
  /**
   * Optional value setting
   */
  const kOptionList = {
    /**
     * Indentation size
     */
    indentSize: {
      type: 'number',
      defaultValue: 2,
      validate: function(aValue) {
        return (aValue <= 0) ? this.defaultValue : aValue;
      }
    },

    /**
     * Indentation character [one character]
     */
    indentChar: {
      type: 'string',
      defaultValue: ' ',
      validate: function(aValue) {
        return (aValue === '') ? this.defaultValue : aValue.charAt(0);
      }
    },

    /**
     * Maximum characters per line
     *
     * @note wraps lines at next opportunity after this length without breaking
     * the code
     * @see |wrapLines()|
     */
    wrapLineLength: {
      type: 'number',
      defaultValue: 80,
      validate: function(aValue) {
        return (aValue < 0) ? 0 : aValue;
      }
    },

    /**
     * Forcibly wrap lines over the |wrapLineLength| value
     *
     * @note a syntax error may occur when you run a prettified output
     */
    forceWrap: {
      type: 'boolean',
      defaultValue: true
    },

    /**
     * Add an extra line after a block end
     *
     * @see |addExtraLine()|
     */
    extraLine: {
      type: 'boolean',
      defaultValue: true
    },

    /**
     * Complement a semicolon after the last statement in a block
     *
     * @see |complementLastSemicolon()|
     */
    lastSemicolon: {
      type: 'boolean',
      defaultValue: true
    }
  };

  /**
   * Fix up options
   *
   * @param aOptions {hash}
   *   @see |kOptionList|
   * @return {hash}
   */
  function fixupOptions(aOptions) {
    aOptions = aOptions || {};

    let options = {};

    for (let [key, setting] in Iterator(kOptionList)) {
      let value = aOptions[key];

      if (value === undefined) {
        value = setting.defaultValue;
      }
      else {
        switch (setting.type) {
          case 'number':
            value = parseInt(value, 10);

            if (isNaN(value)) {
              value = setting.defaultValue;
            }
            break;
          case 'string':
            value = value + '';
            break;
          case 'boolean':
            value = !!value;
            break;
        }
      }

      if (setting.validate) {
        value = setting.validate(value);
      }

      options[key] = value;
    }

    return options;
  }

  /**
   * Beautify a code text
   *
   * @param aTextType {kTextType}
   * @param aText {string}
   * @param aOptions {hash}
   *   @see |kOptionList|
   * @return {string}
   */
  function execute(aTextType, aText, aOptions) {
    let beautify;

    switch (aTextType) {
      case kTextType.js:
        beautify = JSBeautify;
        break;
      case kTextType.css:
        beautify = CSSBeautify;
        break;
      default:
        throw Error('unsupported text type');
    }

    aOptions = fixupOptions(aOptions);

    let result = beautify(normalizeText(aText), aOptions);

    if (aOptions.wrapLineLength > 0) {
      result = wrapLines(result, aTextType, aOptions.wrapLineLength, aOptions);
    }

    if (aOptions.extraLine) {
      result = addExtraLine(result);
    }

    if (aOptions.lastSemicolon) {
      result = complementLastSemicolon(result);
    }

    return result;
  }

  /**
   * Remove original indents and empty lines, and fix the newline code
   *
   * @param aText {string}
   * return {string}
   */
  function normalizeText(aText) {
    return aText.replace(/^\s+/gm, '').replace(/[\n\r]+/g, '\n');
  }

  /**
   * Add an extra line after '}' or '},' or '};' being not the last one in a
   * nesting block
   *
   * @param aText {string}
   * return {string}
   */
  function addExtraLine(aText) {
    return aText.replace(/(}[,;]?\n)(?!\s*})/g, '$1\n');
  }

  /**
   * Complement a semicolon after the last statement before '}' of a block end
   *
   * @param aText {string}
   * return {string}
   */
  function complementLastSemicolon(aText) {
    return aText.replace(/[^;}\s](?=\n\s*\})/g, '$&;');
  }

  /**
   * Wrap lines
   *
   * @param aText {string}
   * @param aTextType {kTextType}
   * @param aWrapLineLength {number}
   * @param aOptions {hash}
   *   forceWrap {boolean}:
   *     true: the long line without punctuation is forcibly wrapped
   * return {string}
   */
  function wrapLines(aText, aTextType, aWrapLineLength, aOptions) {
    let {
      forceWrap
    } = aOptions || {};

    // a character, such as can wrap a line in the code syntax immediately
    // behind
    let punctuation;

    switch (aTextType) {
      case kTextType.js:
        punctuation = /[,+-=<>&|?:]/;
        break;
      case kTextType.css:
        punctuation = /[,>+~]/;
        break;
    }

    let longLines = RegExp('^.{' + (aWrapLineLength + 1) + ',}$', 'gm');

    return aText.replace(longLines, (text) => {
      let lines = [];
      let index = aWrapLineLength - 1;
      let indent = /^\s*/.exec(text)[0];
      let shouldWrap = false;

      while (text.length > aWrapLineLength) {
        if (punctuation.test(text[index]) && text[index - 1] !== '\\') {
          // join the following repetition after the tail
          if (index === aWrapLineLength - 1) {
            index +=
              RegExp('^[' + text[index] + ']*').
              exec(text.slice(index + 1))[0].length;
          }

          shouldWrap = true;
        }
        else if (--index <= 0) {
          if (forceWrap) {
            // force to wrap in max length
            index = aWrapLineLength - 1;
            shouldWrap = true;
          }
          else {
            // terminate without wrapping
            break;
          }
        }

        if (shouldWrap) {
          // retrieve the wrapped line
          lines.push(text.slice(0, index + 1));

          // update text for the next line
          text = indent + text.slice(index + 1).trim();

          index = aWrapLineLength - 1;
          shouldWrap = false;
        }
      }

      // the rest of text
      lines.push(text);

      return lines.join('\n');
    });
  }

  /**
   * JS beautifier
   *
   * @note calls the built-in function based on 'JS Beautifier'
   * @note this built-in version does not support |wrap_line_length|
   * @see https://github.com/einars/js-beautify/blob/master/js/lib/beautify.js
   */
  function JSBeautify(aText, aOptions) {
    let options = {
      indent_size: aOptions.indentSize,
      indent_char: aOptions.indentChar
    };

    const {js_beautify} =
      getModule('resource://app/modules/devtools/Jsbeautify.jsm');

    return js_beautify(aText, options);
  }

  /**
   * CSS beautifier
   */
  function CSSBeautify(aText, aOptions) {
    let options = {
      indent_size: aOptions.indentSize,
      indent_char: aOptions.indentChar
    };

    return css_beautify(aText, options);
  }

  /**
   * 'JS Beautifier' beautify-css.js [Apr 28, 2013]
   *
   * TODO: the newer version [Nov 22, 2013] seems to be incompatible with this
   * user script, so, stop updating until I find what wrong
   *
   * @see https://github.com/einars/js-beautify/blob/master/js/lib/beautify-css.js
   *
   * The MIT License (MIT)
   *
   * Copyright (c) 2007-2013 Einar Lielmanis and contributors.
   *
   * Permission is hereby granted, free of charge, to any person
   * obtaining a copy of this software and associated documentation files
   * (the "Software"), to deal in the Software without restriction,
   * including without limitation the rights to use, copy, modify, merge,
   * publish, distribute, sublicense, and/or sell copies of the Software,
   * and to permit persons to whom the Software is furnished to do so,
   * subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be
   * included in all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
   * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
   * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
   * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS
   * BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
   * ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
   * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
   * SOFTWARE.
   */
  function css_beautify(source_text,options){options=options||{};var indentSize=options.indent_size||4;var indentCharacter=options.indent_char||" ";if(typeof indentSize==="string")indentSize=parseInt(indentSize,10);var whiteRe=/^\s+$/;var wordRe=/[\w$\-_]/;var pos=-1,ch;function next(){ch=source_text.charAt(++pos);return ch}function peek(){return source_text.charAt(pos+1)}function eatString(comma){var start=pos;while(next())if(ch==="\\"){next();next()}else if(ch===comma)break;else if(ch==="\n")break;return source_text.substring(start,pos+1)}function eatWhitespace(){var start=pos;while(whiteRe.test(peek()))pos++;return pos!==start}function skipWhitespace(){var start=pos;do;while(whiteRe.test(next()));return pos!==start+1}function eatComment(){var start=pos;next();while(next())if(ch==="*"&&peek()==="/"){pos++;break}return source_text.substring(start,pos+1)}function lookBack(str){return source_text.substring(pos-str.length,pos).toLowerCase()===str}var indentString=source_text.match(/^[\r\n]*[\t ]*/)[0];var singleIndent=Array(indentSize+1).join(indentCharacter);var indentLevel=0;function indent(){indentLevel++;indentString+=singleIndent}function outdent(){indentLevel--;indentString=indentString.slice(0,-indentSize)}var print={};print["{"]=function(ch){print.singleSpace();output.push(ch);print.newLine()};print["}"]=function(ch){print.newLine();output.push(ch);print.newLine()};print.newLine=function(keepWhitespace){if(!keepWhitespace)while(whiteRe.test(output[output.length-1]))output.pop();if(output.length)output.push("\n");if(indentString)output.push(indentString)};print.singleSpace=function(){if(output.length&&!whiteRe.test(output[output.length-1]))output.push(" ")};var output=[];if(indentString)output.push(indentString);while(true){var isAfterSpace=skipWhitespace();if(!ch)break;if(ch==="{"){indent();print["{"](ch)}else if(ch==="}"){outdent();print["}"](ch)}else if(ch==='"'||ch==="'")output.push(eatString(ch));else if(ch===";")output.push(ch,"\n",indentString);else if(ch==="/"&&peek()==="*"){print.newLine();output.push(eatComment(),"\n",indentString)}else if(ch==="(")if(lookBack("url")){output.push(ch);eatWhitespace();if(next())if(ch!==")"&&ch!=='"'&&ch!=="'")output.push(eatString(")"));else pos--}else{if(isAfterSpace)print.singleSpace();output.push(ch);eatWhitespace()}else if(ch===")")output.push(ch);else if(ch===","){eatWhitespace();output.push(ch);print.singleSpace()}else if(ch==="]")output.push(ch);else if(ch==="["||ch==="="){eatWhitespace();output.push(ch)}else{if(isAfterSpace)print.singleSpace();output.push(ch)}}var sweetCode=output.join("").replace(/[\n ]+$/,"");return sweetCode}

  /**
   * Export
   */
  return {
    execute: execute
  };
})();

/**
 * Get the text content in a plain text document
 *
 * @param {HTMLDocument} aDocument
 * @return {string|null}
 */
function getTextContent(aDocument) {
  let container = getTextContainer(aDocument);

  return container ? container.textContent : null;
}

/**
 * Get a <PRE> element that contains the text content in a plain text document
 *
 * @param {HTMLDocument} aDocument
 * @return {HTMLPreElement|null}
 */
function getTextContainer(aDocument) {
  let body = aDocument.body

  let pre =
    body &&
    body.childNodes.length === 1 &&
    body.firstChild instanceof HTMLPreElement &&
    body.firstChild;

  let textLength =
    pre &&
    pre.childNodes.length === 1 &&
    pre.firstChild instanceof Text &&
    pre.firstChild.length;

  return !!textLength ? pre : null;
}

/**
 * Get a text type for the document
 *
 * @param {HTMLDocument} aDocument
 * @return {kTextType|null}
 */
function getTextType(aDocument) {
  switch (aDocument.contentType) {
    case 'text/javascript':
    case 'application/javascript':
    case 'application/x-javascript':
      return kTextType.js;
    case 'text/css':
      return kTextType.css;
  }
  return null;
}

function prompt(aMessage, aOption) {
  let {
    doConfirm
  } = aOption || {};

  const {confirm, alert} = Services.prompt;

  let prompt = doConfirm ? confirm : alert;

  return prompt(null, 'PrettyPrint.uc.js', aMessage);
}

/**
 * Entry point
 */
function PrettyPrint_init() {
  MenuHandler.init();
}

PrettyPrint_init()


})(this);
