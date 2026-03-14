import { EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { openSearchPanel, closeSearchPanel, search, searchKeymap } from "@codemirror/search";
import { getCodeMirrorPhrases } from "./i18n.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function createEditorAdapter(host, { onUpdate } = {}) {
  const domListeners = new Map();
  let view = null;

  const toggleSearchPanel = (v) => {
    if (v.dom.querySelector(".cm-search")) {
      closeSearchPanel(v);
    } else {
      openSearchPanel(v);
    }
    return true;
  };

  const openReplacePanel = (v) => {
    openSearchPanel(v);
    requestAnimationFrame(() => {
      v.dom.querySelector('.cm-search input[name="replace"]')?.focus();
    });
    return true;
  };

  function dispatchDomEvent(type, event) {
    const listeners = domListeners.get(type);
    if (!listeners || listeners.size === 0) return false;
    for (const listener of listeners) {
      listener.call(view?.contentDOM ?? host, event);
    }
    return event.defaultPrevented;
  }

  const domBridge = EditorView.domEventHandlers({
    keydown(event) {
      return dispatchDomEvent("keydown", event);
    },
    beforeinput(event) {
      return dispatchDomEvent("beforeinput", event);
    },
    input(event) {
      return dispatchDomEvent("input", event);
    },
    focus(event) {
      dispatchDomEvent("focus", event);
      return false;
    },
    blur(event) {
      dispatchDomEvent("blur", event);
      return false;
    },
    pointerdown(event) {
      dispatchDomEvent("pointerdown", event);
      return false;
    },
    wheel(event) {
      dispatchDomEvent("wheel", event);
      return false;
    },
  });

  view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: "",
      extensions: [
        markdown(),
        EditorState.phrases.of(getCodeMirrorPhrases()),
        lineNumbers(),
        EditorView.lineWrapping,
        search({ top: true }),
        keymap.of([
          { key: "Mod-f", run: toggleSearchPanel },
          { key: "Mod-h", run: openReplacePanel },
          ...searchKeymap,
        ]),
        domBridge,
        EditorView.updateListener.of((update) => {
          if (typeof onUpdate === "function") {
            onUpdate(update);
          }
        }),
      ],
    }),
  });

  const adapter = {
    view,
    dom: view.dom,
    scrollDOM: view.scrollDOM,
    contentDOM: view.contentDOM,
    focus() {
      view.focus();
    },
    openSearch() {
      toggleSearchPanel(view);
    },
    addEventListener(type, listener, options) {
      if (type === "scroll") {
        view.scrollDOM.addEventListener(type, listener, options);
        return;
      }
      if (!domListeners.has(type)) {
        domListeners.set(type, new Set());
      }
      domListeners.get(type).add(listener);
    },
    removeEventListener(type, listener, options) {
      if (type === "scroll") {
        view.scrollDOM.removeEventListener(type, listener, options);
        return;
      }
      domListeners.get(type)?.delete(listener);
    },
    setSelectionRange(start, end = start) {
      const docLength = view.state.doc.length;
      view.dispatch({
        selection: {
          anchor: clamp(start, 0, docLength),
          head: clamp(end, 0, docLength),
        },
        annotations: Transaction.addToHistory.of(false),
      });
    },
    replaceAll(text, { addToHistory = false, selection } = {}) {
      const nextText = typeof text === "string" ? text : "";
      const docLength = view.state.doc.length;
      const head = selection?.head ?? selection?.anchor ?? Math.min(docLength, nextText.length);
      const anchor = selection?.anchor ?? head;
      const preserveScroll = view.scrollSnapshot();
      view.dispatch({
        changes: { from: 0, to: docLength, insert: nextText },
        selection: {
          anchor: clamp(anchor, 0, nextText.length),
          head: clamp(head, 0, nextText.length),
        },
        effects: preserveScroll,
        annotations: Transaction.addToHistory.of(addToHistory),
        scrollIntoView: false,
      });
    },
    posToY(pos, side = 1) {
      const safePos = clamp(pos, 0, view.state.doc.length);
      const coords = view.coordsAtPos(safePos, side) ?? view.coordsAtPos(safePos, side === 1 ? -1 : 1);
      if (!coords) return null;
      const rect = view.scrollDOM.getBoundingClientRect();
      return coords.top - rect.top + view.scrollDOM.scrollTop;
    },
    posAtViewportY(viewportY) {
      const rect = view.scrollDOM.getBoundingClientRect();
      const probeX = rect.left + Math.min(80, Math.max(12, rect.width * 0.2));
      const probeY = rect.top + clamp(viewportY, 0, rect.height);
      const pos = view.posAtCoords({ x: probeX, y: probeY });
      return pos ?? view.state.selection.main.head;
    },
    isPosVisible(pos) {
      const safePos = clamp(pos, 0, view.state.doc.length);
      const coords = view.coordsAtPos(safePos, 1) ?? view.coordsAtPos(safePos, -1);
      if (!coords) return false;
      const rect = view.scrollDOM.getBoundingClientRect();
      return coords.top >= rect.top && coords.bottom <= rect.bottom;
    },
    scrollToAbsoluteY(docY, viewportOffset = 0) {
      const nextTop = Math.max(0, docY - viewportOffset);
      view.scrollDOM.scrollTop = nextTop;
    },
    getLineCount() {
      return view.state.doc.lines;
    },
  };

  Object.defineProperties(adapter, {
    value: {
      get() {
        return view.state.doc.toString();
      },
      set(text) {
        adapter.replaceAll(text, { addToHistory: false, selection: { anchor: 0, head: 0 } });
      },
    },
    selectionStart: {
      get() {
        return view.state.selection.main.from;
      },
      set(pos) {
        adapter.setSelectionRange(pos, view.state.selection.main.to);
      },
    },
    selectionEnd: {
      get() {
        return view.state.selection.main.to;
      },
      set(pos) {
        adapter.setSelectionRange(view.state.selection.main.from, pos);
      },
    },
    scrollTop: {
      get() {
        return view.scrollDOM.scrollTop;
      },
      set(value) {
        view.scrollDOM.scrollTop = value;
      },
    },
    scrollHeight: {
      get() {
        return view.scrollDOM.scrollHeight;
      },
    },
    clientHeight: {
      get() {
        return view.scrollDOM.clientHeight;
      },
    },
  });

  return adapter;
}
