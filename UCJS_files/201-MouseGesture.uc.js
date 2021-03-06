// ==UserScript==
// @name        MouseGesture.uc.js
// @description Mouse gesture functions
// @include     main
// ==/UserScript==

// @require Util.uc.js, UI.uc.js
// @require [optional][for commands] Util.uc.js, UI.uc.js, NaviLink.uc.js,
// TabEx.uc.js, WebService.uc.js

/**
 * @usage
 * -Normal mode: gestures or wheel rotations holding down the right mouse
 *  button
 * -Drag&Drop mode: gestures dragging a selected text or a link or an image
 * -'Shift' key and 'Ctrl' key are supported
 *
 * @note
 * -The gestures is only available within the inner frame of the content area,
 *  and the default width of the frame is 16px
 *  @see |inGestureArea()|
 * -The max number of signs(directions and wheel rotations) per gesture is 10
 *  @see |GestureManager()|
 */


(function(window, undefined) {


"use strict";


/**
 * Imports
 */
const {
  getNodeById: $ID,
  addEvent,
  getSelectionAtCursor,
  openTab
} = window.ucjsUtil;

// for debug
function log(aMsg) {
  return window.ucjsUtil.logMessage('MouseGesture.uc.js', aMsg);
}

const {
  ContentArea: {
    contextMenu: contentAreaContextMenu
  },
  StatusField: {
    setOverLink,
    message: updateStatusText
  }
} = window.ucjsUI;

/**
 * Gesture signs for |kGestureSet|
 */
const kGestureSign = {
  // Modifier keys
  shift: 'S&', ctrl: 'C&',
  // Directions
  left: 'L', right: 'R', up: 'U', down: 'D',
  // Mouse wheel for the normal mode
  wheelUp: 'W+', wheelDown: 'W-',
  // Target types for the D&D mode
  text: 'TEXT#', link: 'LINK#', image: 'IMAGE#',
  // Do action immediately without mouseup when gesture matches
  quickShot: '!'
};

/**
 * Gestures setting
 *
 * @key gestures {string[]} combination of |kGestureSign|
 * @key name {string}
 * @key command {function}
 *   @param {hash}
 *     @key event {MouseEvent} mouse event at when the gesture ends
 *     @key gesture {string} built gesture signs
 *     @key dragData {string} drag data on the D&D mode
 * @key disabled {boolean} [optional]
 */
const kGestureSet = [
  /**
   * Navigations
   */
  {
    gestures: ['L'],
    name: '戻る',
    command: function() {
      doCmd('Browser:Back');
    }
  },
  {
    gestures: ['S&L'],
    name: '前のページへ',
    command: function() {
      window.ucjsUtil.loadPage(window.ucjsNaviLink.getPrev());
    }
  },
  {
    gestures: ['R'],
    name: '進む',
    command: function() {
      doCmd('Browser:Forward');
    }
  },
  {
    gestures: ['S&R'],
    name: '次のページへ',
    command: function() {
      window.ucjsUtil.loadPage(window.ucjsNaviLink.getNext());
    }
  },
  {
    gestures: ['!LW-', '!RW-'],
    name: 'ページの履歴',
    command: function({event}) {
      $ID('backForwardMenu').
      openPopupAtScreen(event.screenX + 5, event.screenY + 5, false);
    }
  },
  {
    gestures: ['U'],
    name: 'ページ先頭へ',
    command: function() {
      doCmd('cmd_scrollTop');
    }
  },
  {
    gestures: ['D'],
    name: 'ページ末尾へ',
    command: function() {
      doCmd('cmd_scrollBottom');
    }
  },
  {
    gestures: ['UD'],
    name: '更新/中止',
    command: function() {
      doCmd(window.XULBrowserWindow.isBusy ?
        'Browser:Stop' : 'Browser:Reload');
    }
  },
  {
    gestures: ['UDU'],
    name: 'キャッシュも更新',
    command: function() {
      doCmd('Browser:ReloadSkipCache');
    }
  },

  /**
   * Tabs
   */
  {
    gestures: ['DL'],
    name: 'タブを複製',
    command: function() {
      // @see chrome://browser/content/browser.js::duplicateTabIn
      window.duplicateTabIn(gBrowser.selectedTab, 'tab');
    }
  },
  {
    gestures: ['LU'],
    name: '閉じたタブを復元',
    command: function() {
      doCmd('History:UndoCloseTab');
    }
  },
  {
    gestures: ['DR'],
    name: 'タブを閉じる',
    command: function() {
      window.ucjsUtil.removeTab(gBrowser.selectedTab, {safeBlock: true});
    }
  },
  {
    gestures: ['S&C&DR'],
    name: '強制的にタブを閉じる',
    command: function() {
      window.ucjsUtil.removeTab(gBrowser.selectedTab);
    }
  },
  {
    gestures: ['S&DRL', 'DRLW+', 'DRLW-'],
    name: '既読のタブを閉じる',
    command: function() {
      window.ucjsTabEx.closeReadTabs();
    }
  },
  {
    gestures: ['S&DRDL', 'DRDLW+', 'DRDLW-'],
    name: '左側のタブを閉じる',
    command: function() {
      window.ucjsTabEx.closeLeftTabs();
    }
  },
  {
    gestures: ['S&DRDR', 'DRDRW+', 'DRDRW-'],
    name: '右側のタブを閉じる',
    command: function() {
      window.ucjsTabEx.closeRightTabs();
    }
  },
  {
    gestures: ['S&DRU', 'DRUW+', 'DRUW-'],
    name: '他のタブを閉じる',
    command: function() {
      window.ucjsUtil.removeAllTabsBut(gBrowser.selectedTab);
    }
  },
  {
    gestures: ['S&DURD', 'DURDW+', 'DURDW-'], // shape of 'h'
    name: 'ホームだけにする',
    command: function() {
      window.ucjsUtil.openHomePages({doReplace: true});
    }
  },
  {
    gestures: ['DURD'], // shape of 'h'
    name: 'ホームを開く',
    command: function() {
      window.ucjsUtil.openHomePages();
    }
  },

  /**
   * UI
   */
  {
    gestures: ['RD'],
    name: '履歴を開閉',
    command: function() {
      // @see chrome://browser/content/browser.js::toggleSidebar
      window.toggleSidebar('viewHistorySidebar');
    }
  },
  {
    gestures: ['LD'],
    name: 'ブックマークを開閉',
    command: function() {
      // @see chrome://browser/content/browser.js::toggleSidebar
      window.toggleSidebar('viewBookmarksSidebar');
    }
  },
  {
    gestures: ['!W+'],
    name: '前のタブへ',
    command: function() {
      doCmd('Browser:PrevTab');
    }
  },
  {
    gestures: ['!W-'],
    name: '次のタブへ',
    command: function() {
      doCmd('Browser:NextTab');
    }
  },

  /**
   * For D&D mode
   */
  {
    gestures: ['TEXT#L'],
    name: 'Weblio',
    command: function({dragData}) {
      window.ucjsWebService.open({name: 'Weblio', data: dragData});
    }
  },
  {
    gestures: ['S&TEXT#L'],
    name: 'Google翻訳',
    command: function({dragData}) {
      window.ucjsWebService.open({name: 'GoogleTranslation', data: dragData});
    }
  },
  {
    gestures: ['TEXT#R'],
    name: 'Google検索',
    command: function({dragData}) {
      window.ucjsWebService.open({name: 'GoogleSearch', data: dragData});
    }
  },
  {
    gestures: ['S&TEXT#R'],
    name: 'Google検索 site:',
    command: function({dragData}) {
      let data = dragData + ' site:' + gBrowser.currentURI.spec;

      window.ucjsWebService.open({name: 'GoogleSearch', data: data});
    }
  },
  {
    gestures: ['TEXT#D'],
    name: 'ページ内検索',
    command: function({dragData}) {
      window.ucjsUI.FindBar.findWith(dragData, {
        doHighlight: true
      });
    }
  },
  {
    gestures: ['TEXT#UR'],
    name: '加えて再検索 (Focus)',
    command: function({dragData}) {
      window.ucjsWebService.updateFormInput(dragData, {
        moreData: true,
        doFocus: true
      });
    }
  },
  {
    gestures: ['S&TEXT#UR'],
    name: '加えて再検索 (Submit)',
    command: function({dragData}) {
      window.ucjsWebService.updateFormInput(dragData, {
        moreData: true,
        doSubmit: true
      });
    }
  },
  {
    gestures: ['TEXT#DR'],
    name: '除いて再検索 (Focus)',
    command: function({dragData}) {
      window.ucjsWebService.updateFormInput(dragData, {
        lessData: true,
        doFocus: true
      });
    }
  },
  {
    gestures: ['S&TEXT#DR'],
    name: '除いて再検索 (Submit)',
    command: function({dragData}) {
      window.ucjsWebService.updateFormInput(dragData, {
        lessData: true,
        doSubmit: true
      });
    }
  },
  {
    gestures: ['LINK#U', 'IMAGE#U'],
    name: '新タブに開く',
    command: function({dragData}) {
      openTab(dragData, {
        inBackground: false,
        relatedToCurrent: true,
        allowImageData: true
      });
    }
  },
  {
    gestures: ['LINK#D', 'IMAGE#D'],
    name: '裏タブで開く',
    command: function({dragData}) {
      openTab(dragData, {
        inBackground: true,
        relatedToCurrent: true,
        allowImageData: true
      });
    }
  }
];

/**
 * Handlers
 *
 * TODO: cancel the gesture when enters into a window (always on top) that is
 * overwrapped on the gesture area
 */
function MouseGesture() {
  const kState = {READY: 0, GESTURE: 1, DRAG: 2};

  let mState = kState.READY;
  let mMouse = MouseManager();
  let mGesture = GestureManager();

  registerEvents();

  function registerEvents() {
    let pc = gBrowser.mPanelContainer;

    addEvent(pc, 'mousedown', onMouseDown, false);
    addEvent(pc, 'mousemove', onMouseMove, false);
    addEvent(pc, 'mouseup', onMouseUp, false);
    addEvent(pc, 'wheel', onMouseWheel, false);
    addEvent(pc, 'keydown', onKeyDown, false);
    addEvent(pc, 'keyup', onKeyUp, false);
    addEvent(pc, 'contextmenu', onContextMenu, false);
    addEvent(pc, 'click', onClick, false);

    addEvent(pc, 'dragstart', onDragStart, false);
    addEvent(pc, 'dragend', onDragEnd, false);
    // @note use 'dragover' (not 'dragenter') to check the coordinate
    addEvent(pc, 'dragover', onDragOver, false);
    // WORKAROUND: use capture mode to detect a drop event that is trapped by
    // content script (e.g. gist.github.com)
    // TODO: need to check the mode of the other events
    addEvent(pc, 'drop', onDrop, true);

    // WORKAROUND: observe a XUL popup in the content area for cancelling the
    // gestures on it
    addEvent(window, 'mouseup', onGlobalMouseUp, false);
  }

  /**
   * Events
   */
  function onMouseDown(aEvent) {
    let canStart = mMouse.update(aEvent);

    if (canStart) {
      if (mState === kState.READY) {
        if (inGestureArea(aEvent)) {
          startGesture(aEvent);
        }
      }
      else {
        cancelGesture();
      }
    }
    else {
      if (mState !== kState.READY) {
        cancelGesture();
      }
    }
  }

  function onMouseMove(aEvent) {
    mMouse.update(aEvent);

    if (mState === kState.GESTURE) {
      if (inGestureArea(aEvent)) {
        progress(aEvent);
      }
      else {
        cancelGesture();
      }
    }
  }

  function onMouseUp(aEvent) {
    let canStop = mMouse.update(aEvent);

    if (canStop) {
      if (mState === kState.GESTURE) {
        stopGesture(aEvent);
      }
    }
  }

  // WORKAROUND: cancel the gestures on a XUL popup
  function onGlobalMouseUp(aEvent) {
    if (mState === kState.GESTURE &&
        isPopupNode(aEvent.target)) {
      cancelGesture();
    }
  }

  function isPopupNode(aNode) {
    if (aNode instanceof XULElement) {
      while (aNode) {
        if (aNode.popupBoxObject &&
            aNode.popupBoxObject.popupState === 'open') {
          return true;
        }
        aNode = aNode.parentNode;
      }
    }
    return false;
  }

  function onMouseWheel(aEvent) {
    mMouse.update(aEvent);

    if (mState === kState.GESTURE) {
      suppressDefault(aEvent);
      progress(aEvent);
    }
  }

  function onKeyDown(aEvent) {
    if (mState !== kState.READY) {
      progress(aEvent);
    }
  }

  function onKeyUp(aEvent) {
    if (mState !== kState.READY) {
      progress(aEvent);
    }
  }

  function onContextMenu(aEvent) {
    mMouse.update(aEvent);
  }

  function onClick(aEvent) {
    mMouse.update(aEvent);
  }

  function onDragStart(aEvent) {
    if (mState === kState.READY) {
      if (inGestureArea(aEvent)) {
        startDrag(aEvent);
      }
    }
  }

  function onDragEnd(aEvent) {
    mMouse.update(aEvent);

    // the drag operation is terminated;
    // 1.cancelled by pressing ESC
    // 2.dropped in a disallowed area
    if (mState === kState.DRAG) {
      cancelGesture();
    }
  }

  function onDragOver(aEvent) {
    if (mState !== kState.DRAG) {
      return;
    }

    // cancel the gesture drag and the default drag works
    // @note the default drag is also cancelled by pressing the ESC key
    let forceCancel = aEvent.shiftKey && aEvent.altKey;

    if (forceCancel) {
      cancelGesture();
      return;
    }

    if (inGestureArea(aEvent)) {
      if (!inEditable(aEvent)) {
        suppressDefault(aEvent);
        progress(aEvent);
      }
    }
    else {
      cancelGesture();
    }
  }

  // TODO: prevent the drop event when a right mouse button is pressed down
  // while dragging. the drop event fires at present
  function onDrop(aEvent) {
    if (mState !== kState.DRAG) {
      return;
    }

    if (inEditable(aEvent)) {
      cancelGesture();
    }
    else {
      suppressDefault(aEvent);
      stopGesture(aEvent);
    }
  }

  function suppressDefault(aEvent) {
    aEvent.preventDefault();
    aEvent.stopPropagation();
  }

  /**
   * Helpers
   */
  function startGesture(aEvent) {
    mState = kState.GESTURE;
    start(aEvent);
  }

  function startDrag(aEvent) {
    if (start(aEvent)) {
      mState = kState.DRAG;
    }
  }

  function start(aEvent) {
    return mGesture.init(aEvent);
  }

  function progress(aEvent) {
    mGesture.update(aEvent);
  }

  function stopGesture(aEvent) {
    mGesture.evaluate(aEvent);
    clear();
  }

  function cancelGesture() {
    clear();
  }

  function clear() {
    mState = kState.READY;
    mGesture.clear();
  }
}

/**
 * Observes the mouse events
 * Manages to suppress the contextmenu popup and the click event
 * @return {hash}
 *   @member update {function}
 *
 * TODO: prevent contextmenu popups when a right mouse button is clicked while
 * dragging
 */
function MouseManager() {
  let mRightDown, mElseDown;
  let mSuppressMenu, mSuppressClick;

  clear();

  function clear() {
    mRightDown = false;
    mElseDown = false;
    mSuppressMenu = false;
    mSuppressClick = false;
  }

  /**
   * Updates the state
   * @param aEvent {MouseEvent}
   * @return {boolean|undefined}
   *   'mousedown' {boolean} ready or not that a normal mode gesture can start
   *   'mouseup' {boolean} ready or not that a normal mode gesture can stop
   *   otherwise {undefined} unused usually
   */
  function update(aEvent) {
    const {type, button} = aEvent;

    let allowAction;

    switch (type) {
      case 'mousedown':
        if (button === 2) {
          // allow the gesture starts
          allowAction = !mElseDown;

          // ready the contextmenu
          enableContextMenu(true);
          mSuppressMenu = false;

          mRightDown = true;

          if (mElseDown) {
            mSuppressMenu = true;
          }
        }
        else {
          // ready the default click event
          mSuppressClick = false;

          mElseDown = true;

          if (mRightDown) {
            mSuppressMenu = true;
            mSuppressClick = true;
          }
        }
        break;
      case 'mouseup':
        if (button === 2) {
          // allow the gesture stops
          allowAction = !mElseDown;

          mRightDown = false;
        }
        else {
          mElseDown = false;
        }
        break;
      case 'dragend':
        // @note always button===0
        mElseDown = false;
        break;
      case 'mousemove':
      case 'wheel':
        // a gesture is in progress
        if (mRightDown) {
          mSuppressMenu = true;
        }
        break;
      case 'contextmenu':
        enableContextMenu(!mSuppressMenu);

        if (mSuppressMenu) {
          mSuppressMenu = false;
        }
        break;
      case 'click':
        if (button === 2) {
          // force to reset all states
          if (aEvent.altKey) {
            clear();
          }
        }
        else {
          // @see chrome://browser/content/browser.js::contentAreaClick()
          if (mSuppressClick) {
            aEvent.preventDefault();
            mSuppressClick = false;
          }
        }
        break;
    }

    return allowAction;
  }

  function enableContextMenu(aEnable) {
    contentAreaContextMenu.hidden = !aEnable;
  }

  return {
    update: update
  };
}

/**
 * Builds the mouse gestures and performs its command
 *
 * @return {hash}
 *   @member clear {function}
 *   @member init {function}
 *   @member update {function}
 *   @member evaluate {function}
 *
 * TODO: show some clear sign to the user that a quickshot has fired
 */
function GestureManager() {
  /**
   * Max length of the chain of a gesture
   * @value {integer}
   * @note the chain consists of directions and wheel rotations
   */
  const kMaxChainLength = 10;

  let mTracer = GestureTracer();
  let mKey, mChain;
  let mDragType, mDragData;
  let mMatchItem, mQuickShot;
  let mError;

  clear();

  function clear() {
    clearStatusText();
    clearGesture();
    mTracer.clear();
    setOverLink(true);
  }

  function clearGesture() {
    mKey = [];
    mChain = [];
    mDragType = '';
    mDragData = '';
    mMatchItem = null;
    mQuickShot = false;
    mError = null;
  }

  function init(aEvent) {
    setOverLink(false);
    mTracer.init(aEvent);

    if (aEvent.type === 'dragstart') {
      let info = getDragInfo(aEvent);

      if (!info.type || !info.data) {
        return false;
      }

      mDragType = info.type;
      mDragData = info.data;
    }
    return true;
  }

  function getDragInfo(aEvent) {
    let node = aEvent.target;
    let type = '', data = '';

    // 1.selected text
    if (!type) {
      let text = getSelectionAtCursor({event: aEvent});

      if (text) {
        type = kGestureSign.text;
        data = text;
      }
    }

    // 2.link
    if (!type) {
      let link = getLinkURL(node);

      if (link) {
        type = kGestureSign.link;
        data = link;
      }
    }

    // 3.image
    if (!type) {
      let image = getImageURL(node);

      if (image) {
        type = kGestureSign.image;
        data = image;
      }
    }

    return {
      type: type,
      data: data
    };
  }

  function update(aEvent) {
    if (mError) {
      return;
    }

    if (mQuickShot) {
      clearGesture();
    }

    if (updateChain(aEvent) || updateKey(aEvent)) {
      [mMatchItem, mQuickShot] = matchGestureSet();

      showStatusText();

      if (mQuickShot) {
        doAction(aEvent);
      }
    }
  }

  function updateChain(aEvent) {
    const {type, deltaY} = aEvent;

    let sign = '';

    if (type === 'mousemove' || type === 'dragover') {
      let {x, y} = mTracer.update(aEvent);

      if (x !== 0) {
        sign = (x < 0) ? 'left' : 'right';
      }
      else if (y !== 0) {
        sign = (y < 0) ? 'up' : 'down';
      }
    }
    else if (type === 'wheel') {
      sign = (deltaY < 0) ? 'wheelUp' : 'wheelDown';
    }

    if (sign) {
      // add a new link of chain when the last gesture is not this one
      let gesture = kGestureSign[sign];
      let length = mChain.length;

      if (!length || mChain[length - 1] !== gesture) {
        mChain.push(gesture);

        if (length + 1 > kMaxChainLength) {
          mError = 'Too long';
        }
        return true;
      }
    }
    return false;
  }

  function updateKey(aEvent) {
    const {shift, ctrl} = kGestureSign;
    const {
      type,
      keyCode,
      shiftKey, ctrlKey,
      DOM_VK_SHIFT, DOM_VK_CONTROL
    } = aEvent;

    let key = '';
    let pressed = false;

    let has = (aKey) => mKey.indexOf(aKey) > -1;

    if (type === 'keydown') {
      if (keyCode === DOM_VK_SHIFT && !has(shift)) {
        key = shift;
        pressed = true;
      }
      else if (keyCode === DOM_VK_CONTROL && !has(ctrl)) {
        key = ctrl;
        pressed = true;
      }
    }
    else if (type === 'keyup') {
      if (keyCode === DOM_VK_SHIFT && has(shift)) {
        key = shift;
        pressed = false;
      }
      else if (keyCode === DOM_VK_CONTROL && has(ctrl)) {
        key = ctrl;
        pressed = false;
      }
    }
    else if (type === 'dragover') {
      if (shiftKey !== has(shift)) {
        key = shift;
        pressed = shiftKey;
      }
      else if (ctrlKey !== has(ctrl)) {
        key = ctrl;
        pressed = ctrlKey;
      }
    }

    if (key) {
      if (pressed) {
        mKey.push(key);
      }
      else {
        mKey.splice(mKey.indexOf(key), 1);
      }
      return true;
    }
    return false;
  }

  function matchGestureSet() {
    let matchItem = null;
    let quickShot = false;

    let currentGesture = mChain.length && buildGesture();

    if (currentGesture) {
      kGestureSet.some((item) => {
        if (item.disabled) {
          return false;
        }

        return item.gestures.some((gesture) => {
          let isQuickShot = gesture.indexOf(kGestureSign.quickShot) > -1;

          if (isQuickShot) {
            gesture = gesture.replace(kGestureSign.quickShot, '');
          }

          if (currentGesture === gesture) {
            matchItem = item;
            quickShot = isQuickShot;
            return true;
          }
          return false;
        });
      });
    }

    return [matchItem, quickShot];
  }

  function evaluate(aEvent) {
    if (!mQuickShot && mChain.length) {
      doAction(aEvent);
    }
  }

  function doAction(aEvent) {
    if (mMatchItem) {
      try {
        mMatchItem.command({
          event: aEvent,
          gesture: buildGesture(),
          dragData: mDragData
        });
      }
      catch (ex) {
        mError = 'Command error';
        log(showStatusText() + '\n' + ex);
      }
    }
  }

  function buildGesture() {
    let gesture = mKey.join('') + mDragType + mChain.join('');

    if (mQuickShot) {
      gesture = kGestureSign.quickShot + gesture;
    }

    return gesture;
  }

  function showStatusText() {
    let text = toString();

    if (mError) {
      // HACK: display the status after its values have been cleared
      setTimeout((aText) => updateStatusText(aText), 0, text);
    }
    else {
      updateStatusText(text);
    }

    return text;
  }

  function clearStatusText() {
    updateStatusText('');
  }

  /**
   * Creates a display string
   */
  function toString() {
    const kFormat = ['Gesture: %GESTURE%', ' (%NAME%)', ' [%ERROR%!]'];

    let value = kFormat[0].replace('%GESTURE%', buildGesture());

    if (mMatchItem) {
      value += kFormat[1].replace('%NAME%', mMatchItem.name);
    }

    if (mError) {
      value += kFormat[2].replace('%ERROR%', mError);
    }

    return value;
  }

  return {
    clear: clear,
    init: init,
    update: update,
    evaluate: evaluate
  };
}

/**
 * Traces the coordinates of a mouse pointer
 *
 * @return {hash}
 *   @member clear {function}
 *   @member init {function}
 *   @member update {function}
 */
function GestureTracer() {
  // The minimum distance of movement for the gesture is detected
  // @value {integer} [pixels > 0]
  const kTolerance = 10;

  let mLastX, mLastY;

  clear();

  function clear() {
    mLastX = -1;
    mLastY = -1;
  }

  function init(aEvent) {
    mLastX = aEvent.screenX;
    mLastY = aEvent.screenY;
  }

  function update(aEvent) {
    let [x, y] = [aEvent.screenX, aEvent.screenY];
    let [dx, dy] = [Math.abs(x - mLastX), Math.abs(y - mLastY)];

    let toward = {x: 0, y: 0};

    if (kTolerance < dx || kTolerance < dy) {
      if (dy < dx) {
        toward.x = (x < mLastX) ? -1 : 1;
      }
      else {
        toward.y = (y < mLastY) ? -1 : 1;
      }

      mLastX = x;
      mLastY = y;
    }

    return toward;
  }

  return {
    clear: clear,
    init: init,
    update: update
  };
}

function inGestureArea(aEvent) {
  // The margin of cancelling a gesture
  // @value {integer} [pixels > 0]
  // @note including the width of a scrollbar
  // @note 16 pixels is the scrollbar width of my Fx
  const kMargin = 16;

  // get the coordinates of the event relative to the content area
  // @note |aEvent.clientX/Y| returns the coordinate within the window or
  // frame, so that we can not retrieve the client coordinates over frames
  let {screenX: x, screenY: y} = aEvent;
  let {screenX: left, screenY: top, width, height} =
    gBrowser.selectedBrowser.boxObject;

  // convert the screen coordinates of a cursor to the client ones
  x -= left;
  y -= top;

  return kMargin < x && x < (width - kMargin) &&
         kMargin < y && y < (height - kMargin);
}

function inEditable(aEvent) {
  let node = aEvent.target;

  return (
    node instanceof HTMLTextAreaElement ||
    node instanceof HTMLInputElement ||
    node.isContentEditable ||
    node.contentEditable === 'true' ||
    node.ownerDocument.designMode === 'on'
  );
}

function getLinkURL(aNode) {
  let node = aNode;

  for (/* */; node; node = node.parentNode) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node instanceof HTMLAnchorElement ||
          node instanceof HTMLAreaElement ||
          node instanceof HTMLLinkElement ||
          node instanceof SVGAElement) {
        break;
      }
    }
  }

  if (node) {
    if (node instanceof SVGAElement) {
      try {
        // @see chrome://browser/content/utilityOverlay.js::makeURLAbsolute()
        return window.makeURLAbsolute(node.baseURI, node.href.baseVal);
      }
      catch (ex) {}
    }
    else {
      return node.href;
    }
  }
  return null;
}

function getImageURL(aNode) {
  if (aNode instanceof SVGImageElement) {
    try {
      // @see chrome://browser/content/utilityOverlay.js::makeURLAbsolute()
      return window.makeURLAbsolute(aNode.baseURI, aNode.href.baseVal);
    }
    catch (ex) {}
  }
  else if (aNode instanceof HTMLImageElement) {
    return aNode.src;
  }
  return null;
}

function doCmd(aCommand) {
  let command = $ID(aCommand);

  if (command) {
    command.doCommand();
  }
  else {
    // @see chrome://global/content/globalOverlay.js::goDoCommand
    window.goDoCommand(aCommand);
  }
}

/**
 * Entry point
 */
function MouseGesture_init() {
  MouseGesture();
}

MouseGesture_init();


})(this);
