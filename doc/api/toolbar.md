# Toolbar controller
src/node/utils/toolbar.js

## button(opts)
* {Object} `opts`
    * `command` - this command fill be fired on the editbar on click
    * `localizationId` - will be set as `data-l10-id`
    * `class` - here you can add additional classes to the button

Returns: {Button}

Example:
```
var orderedlist = toolbar.button({
  command: "insertorderedlist",
  localizationId: "pad.toolbar.ol.title",
  class: "buttonicon buttonicon-insertorderedlist"
})
```

You can also create buttons with text:

```
var myButton = toolbar.button({
  command: "myButton",
  localizationId: "myPlugin.toolbar.myButton",
  class: "buttontext"
})
```

## selectButton(opts)
* {Object} `opts`
    * `id` - id of the menu item
    * `selectId` - id of the select element
    * `command` - this command fill be fired on the editbar on change

Returns: {SelectButton}

## SelectButton.addOption(value, text, attributes)
* {String} value - The value of this option
* {String} text - the label text used for this option
* {Object} attributes - any additional html attributes go here (e.g. `data-l10n-id`)

## registerButton(name, item)
* {String} name - used to reference the item in the toolbar config in settings.json
* {Button|SelectButton} item - the button to add
