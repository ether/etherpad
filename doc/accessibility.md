# Accessibility

Etherpad aims to be usable by everyone, including people who rely on a
keyboard, a screen reader, or other assistive technology. The editor follows
common conventions so that selecting, formatting, and navigating text works the
way you would expect in other applications, and the toolbar can be reached and
operated without a mouse.

If you find a feature that is not accessible, please let us know by opening an
issue so it can be improved.

## Keyboard shortcuts

The following shortcuts are built into the editor. On macOS use the Command
(`Cmd`) key wherever `Ctrl` is listed.

::: tip
Most shortcuts can be individually enabled or disabled through the
`padShortcutEnabled` settings, so a deployment may have customised which of
these are active.
:::

### Editor

| Action | Shortcut |
| --- | --- |
| Bold | `Ctrl` + `B` |
| Italic | `Ctrl` + `I` |
| Underline | `Ctrl` + `U` |
| Strikethrough | `Ctrl` + `5` |
| Ordered (numbered) list | `Ctrl` + `Shift` + `N` or `Ctrl` + `Shift` + `1` |
| Unordered (bulleted) list | `Ctrl` + `Shift` + `L` |
| Indent line or selection | `Tab` |
| Outdent line or selection | `Shift` + `Tab` |
| Undo | `Ctrl` + `Z` |
| Redo | `Ctrl` + `Y` or `Ctrl` + `Shift` + `Z` |
| Save a named revision | `Ctrl` + `S` |
| Duplicate the current line(s) | `Ctrl` + `Shift` + `D` |
| Delete the current line(s) | `Ctrl` + `Shift` + `K` |
| Clear authorship colors on the pad or selection | `Ctrl` + `Shift` + `C` |
| Show the authors of the current line | `Ctrl` + `Shift` + `2` |
| Focus the toolbar (see below) | `Alt` + `F9` |
| Focus the chat input | `Alt` + `C` |

Text selection, cut (`Ctrl` + `X`), copy (`Ctrl` + `C`), paste
(`Ctrl` + `V`), and the arrow keys behave as they do in any standard text
editor.

### Timeslider

The timeslider (revision history) provides its own shortcuts:

| Action | Shortcut |
| --- | --- |
| Play / pause history playback | `Space` |
| Step back one revision | `Left Arrow` |
| Step forward one revision | `Right Arrow` |
| Jump back to the previous starred revision | `Shift` + `Left Arrow` |
| Jump forward to the next starred revision | `Shift` + `Right Arrow` |

## Toolbar navigation

The toolbar holds the formatting controls (bold, italic, lists, and so on) and
can be reached and operated entirely from the keyboard:

* Press `Alt` + `F9` from the editor to move focus to the first button in the
  toolbar.
* Use the `Left Arrow` and `Right Arrow` keys to move between buttons. `Tab`
  also moves to the next focusable control.
* Press `Enter` to activate the focused button.
* Press `Alt` + `F9` again, or `Escape`, to return focus to the pad.

Pressing `Escape` while a toolbar dropdown (such as the settings or color
picker) is open closes that dropdown first.

## Screen readers

Etherpad provides as much screen reader support as possible. Support quality
varies between platforms and browsers, so the following combinations are
recommended:

* On Windows, Firefox with [NVDA](https://www.nvaccess.org/) currently gives the
  best experience.

To reduce verbose feedback while typing collaboratively in NVDA, open the
keyboard settings (`NVDA` + `Ctrl` + `K`) and turn off **Speak typed characters**
and **Speak typed words**.

Support in other screen readers and browsers (for example Orca on Linux, or
Chrome) is more limited. Contributions to improve coverage on these platforms
are very welcome.
