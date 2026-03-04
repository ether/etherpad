# Editbar

Located in `src/static/js/pad_editbar.js`

## isEnabled()

If the editorbar contains the class `enabledtoolbar`, it is enabled.


## disable()

Disables the editorbar. This is done by adding the class `disabledtoolbar` and removing the enabledtoolbar

## toggleDropDown(dropdown)

Shows the dropdown `div.popup` whose `id` equals `dropdown`.

## registerCommand(cmd, callback)

Register a handler for a specific command. Commands are fired if the corresponding button is clicked or the corresponding select is changed.

## registerAceCommand(cmd, callback)
Creates an ace callstack and calls the callback with an ace instance (and a toolbar item, if applicable): `callback(cmd, ace, item)`.

Example:
```
toolbar.registerAceCommand("insertorderedlist", function (cmd, ace) {
  ace.ace_doInsertOrderedList();
});
```

## registerDropdownCommand(cmd, dropdown)
Ties a `div.popup` where `id` equals `dropdown` to a `command` fired by clicking a button.

## triggerCommand(cmd[, item])
Triggers a command (optionally with some internal representation of the toolbar item that triggered it).
