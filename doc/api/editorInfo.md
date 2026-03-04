# EditorInfo

Location: `src/static/js/ace2_inner.js`

## editorInfo.ace_replaceRange(start, end, text)
This function replaces a range (from `start` to `end`) with `text`.

## editorInfo.ace_getRep()

Returns the `rep` object. The rep object consists of the following properties:

- `lines`: Implemented as a skip list
- `selStart`: The start of the selection
- `selEnd`: The end of the selection
- `selFocusAtStart`: Whether the selection is focused at the start
- `alltext`: The entire text of the document
- `alines`: The entire text of the document, split into lines
- `apool`: The pool of attributes

## editorInfo.ace_getAuthor()

Returns the authors of the pad. If the pad has no authors, it returns an empty object.


## editorInfo.ace_inCallStack()

Returns true if the editor is in the call stack.

## editorInfo.ace_inCallStackIfNecessary(?)

Executes the function if the editor is in the call stack.

## editorInfo.ace_focus(?)

Focuses the editor.

## editorInfo.ace_importText(?)

Imports text into the editor.

## editorInfo.ace_importAText(?)

Imports text and attributes into the editor.

## editorInfo.ace_exportText(?)

Exports the text from the editor.

## editorInfo.ace_editorChangedSize(?)

Changes the size of the editor.

## editorInfo.ace_setOnKeyPress(?)

Sets the key press event.

## editorInfo.ace_setOnKeyDown(?)

Sets the key down event.

## editorInfo.ace_setNotifyDirty(?)

Sets the dirty notification.

## editorInfo.ace_dispose(?)

Disposes the editor.

## editorInfo.ace_setEditable(bool)

Sets the editor to be editable or not.

## editorInfo.ace_execCommand(?)

Executes a command.

## editorInfo.ace_callWithAce(fn, callStack, normalize)

Calls a function with the ace instance.

## editorInfo.ace_setProperty(key, value)

Sets a property.

## editorInfo.ace_setBaseText(txt)

Sets the base text.

## editorInfo.ace_setBaseAttributedText(atxt, apoolJsonObj)

Sets the base attributed text.

## editorInfo.ace_applyChangesToBase(c, optAuthor, apoolJsonObj)

Applies changes to the base.

## editorInfo.ace_prepareUserChangeset()

Prepares the user changeset.

## editorInfo.ace_applyPreparedChangesetToBase()

Applies the prepared changeset to the base.

## editorInfo.ace_setUserChangeNotificationCallback(f)

Sets the user change notification callback.

## editorInfo.ace_setAuthorInfo(author, info)

Sets the author info.

## editorInfo.ace_fastIncorp(?)

Incorporates changes quickly.

## editorInfo.ace_isCaret(?)

Returns true if the caret is at the specified position.

## editorInfo.ace_getLineAndCharForPoint(?)

Returns the line and character for a point.

## editorInfo.ace_performDocumentApplyAttributesToCharRange(?)

Applies attributes to a character range.

## editorInfo.ace_setAttributeOnSelection(attribute, enabled)

Sets an attribute on current range.
Example: `call.editorInfo.ace_setAttributeOnSelection("turkey::balls", true); // turkey is the attribute here, balls is the value
Notes: to remove the attribute pass enabled as false

## editorInfo.ace_toggleAttributeOnSelection(?)

Toggles an attribute on the current range.

## editorInfo.ace_getAttributeOnSelection(attribute, prevChar)
Returns a boolean if an attribute exists on a selected range.
prevChar value should be true if you want to get the previous Character attribute instead of the current selection for example
if the caret is at position 0,1 (after first character) it's probable you want the attributes on the character at 0,0
The attribute should be the string name of the attribute applied to the selection IE subscript
Example usage: Apply the activeButton Class to a button if an attribute is on a highlighted/selected caret position or range.
Example `var isItThere = documentAttributeManager.getAttributeOnSelection("turkey::balls", true);`

See the ep_subscript plugin for an example of this function in action.
Notes: Does not work on first or last character of a line.  Suffers from a race condition if called with aceEditEvent.

## editorInfo.ace_performSelectionChange(?)

Performs a selection change.

## editorInfo.ace_doIndentOutdent(?)

Indents or outdents the selection.

## editorInfo.ace_doUndoRedo(?)

Undoes or redoes the last action.

## editorInfo.ace_doInsertUnorderedList(?)

Inserts an unordered list.

## editorInfo.ace_doInsertOrderedList(?)

Inserts an ordered list.

## editorInfo.ace_performDocumentApplyAttributesToRange()

Applies attributes to a range.

## editorInfo.ace_getAuthorInfos()
Returns an info object about the author. Object key = author_id and info includes author's bg color value.
Use to define your own authorship.

## editorInfo.ace_performDocumentReplaceRange(start, end, newText)
This function replaces a range (from [x1,y1] to [x2,y2]) with `newText`.

## editorInfo.ace_performDocumentReplaceCharRange(startChar, endChar, newText)
This function replaces a range (from y1 to y2) with `newText`.

## editorInfo.ace_renumberList(lineNum)
If you delete a line, calling this method will fix the line numbering.

## editorInfo.ace_doReturnKey()
Forces a return key at the current caret position.

## editorInfo.ace_isBlockElement(element)
Returns true if your passed element is registered as a block element.

## editorInfo.ace_getLineListType(lineNum)
Returns the line's html list type.

## editorInfo.ace_caretLine()
Returns X position of the caret.

## editorInfo.ace_caretColumn()
Returns Y position of the caret.

## editorInfo.ace_caretDocChar()

Returns the Y offset starting from [x=0,y=0]

## editorInfo.ace_isWordChar(?)

Returns true if the character is a word character.
