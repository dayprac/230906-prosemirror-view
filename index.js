const {Map} = require("../util/map")
const {elt, ensureCSSAdded, contains} = require("../util/dom")
const Keymap = require("browserkeymap")

const {scrollPosIntoView, posAtCoords, coordsAtPos} = require("./dompos")
const {draw, redraw, DIRTY_REDRAW, DIRTY_RESCAN} = require("./draw")
const {initInput, finishUpdateFromDOM} = require("./input")
const {SelectionReader, selectionToDOM} = require("./selection")
const {captureKeys} = require("./capturekeys")

require("./css")

class EditorView {
  constructor(place, state, props) {
    ensureCSSAdded()

    this.props = props
    this.state = state

    // :: DOMNode
    // The editable DOM node containing the document.
    this.content = elt("div", {class: "ProseMirror-content", "pm-container": true})
    if (!props.spellCheck) this.content.spellcheck = false
    if (props.label) this.content.setAttribute("aria-label", props.label)
    // :: DOMNode
    // The outer DOM element of the editor.
    this.wrapper = elt("div", {class: "ProseMirror"}, this.content)

    if (place && place.appendChild) place.appendChild(this.wrapper)
    else if (place) place(this.wrapper)

    draw(this, state.doc)
    this.content.contentEditable = true
    this.dirtyNodes = new Map // Maps node object to 1 (re-scan content) or 2 (redraw entirely)

    this.lastSelectedNode = null
    this.selectionReader = new SelectionReader(this)
    initInput(this)
  }

  update(state, newProps) {
    let prevState = this.state
    this.state = state
    if (newProps) this.props = newProps

    if (this.inDOMChange) {
      if (state.view.inDOMChange != this.inDOMChange.id)
        setTimeout(() => finishUpdateFromDOM(this), 0)
      return
    } else if (state.view.inDOMChange != null) {
      setTimeout(() => this.props.onChange(this.state.update({view: state.view.endDOMChange()})), 0)
      return
    }

    let redrawn = false
    let docChange = !state.doc.eq(prevState.doc)

    if (docChange || this.dirtyNodes.size) {
      redraw(this, prevState, state)
      this.dirtyNodes.clear()
      redrawn = true
    }

    if (redrawn || !state.selection.eq(prevState.selection))
      selectionToDOM(this, state.selection)

    // FIXME somehow schedule this relative to ui/update so that it
    // doesn't cause extra layout
    if (state.view.scrollToSelection)
      scrollPosIntoView(this, state.selection.head == null ? state.selection.from : state.selection.from)

    // Make sure we don't use an outdated range on drop event
    if (this.dragging && docChange) this.dragging.move = false
  }

  // :: () → bool
  // Query whether the view has focus.
  hasFocus() {
    if (document.activeElement != this.content) return false
    let sel = window.getSelection()
    return sel.rangeCount && contains(this.content, sel.anchorNode)
  }

  focus() {
    this.content.focus()
  }

  markRangeDirty(from, to, doc) {
    let dirty = this.dirtyNodes
    let $from = doc.resolve(from), $to = doc.resolve(to)
    let same = $from.sameDepth($to)
    for (let depth = 0; depth <= same; depth++) {
      let child = $from.node(depth)
      if (!dirty.has(child)) dirty.set(child, DIRTY_RESCAN)
    }
    let start = $from.index(same), end = $to.indexAfter(same)
    let parent = $from.node(same)
    for (let i = start; i < end; i++)
      dirty.set(parent.child(i), DIRTY_REDRAW)
  }

  applyKey(keyName) {
    let keymaps = this.props.keymaps || []
    for (let i = 0; i <= keymaps.length; i++) {
      let map = i == keymaps.length ? captureKeys : keymaps[i]
      let bound = map.lookup(keyName, this)

      if (bound === false) {
        return null
      } else if (bound == Keymap.unfinished) {
        this.keyPrefix = keyName
        return this.state
      } else if (bound) {
        return bound(map == captureKeys ? this : this.state)
      }
    }
  }

  insertText(text, from, to) {
    if (from == null) {
      ;({from, to} = this.state.selection)
    }
    if (this.props.handleTextInput) {
      let handled = this.props.applyTextInput.call(this.state, from, to, text)
      if (handled) return handled
    }
    let marks = this.state.storedMarks || this.state.doc.marksAt(from)
    let tr = this.state.tr.replaceWith(from, to, text ? this.state.schema.text(text, marks) : null)
    return tr.applyAndScroll()
  }

  markAllDirty() {
    this.dirtyNodes.set(this.doc, DIRTY_REDRAW)
  }

  posAtCoords(coords) { return posAtCoords(this, coords) }
  coordsAtPos(pos) { return coordsAtPos(this, pos) }
}
exports.EditorView = EditorView
