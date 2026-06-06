<p align="center">
  <img src="logo.png" alt="Voxtilly logo" width="180">
</p>

<h1 align="center">Voxtilly</h1>

<p align="center">
  <strong>A clean Chrome text-to-speech extension for selected text, custom text, and browser voices.</strong>
</p>

<p align="center">
  <a href="https://github.com/NATroutter/Voxtilly/releases">
    <img alt="Latest release" src="https://img.shields.io/github/v/release/NATroutter/Voxtilly?style=for-the-badge&label=release&color=2578ff">
  </a>
  <img alt="Manifest V3" src="https://img.shields.io/badge/manifest-v3-11b981?style=for-the-badge">
  <img alt="Chrome Extension" src="https://img.shields.io/badge/chrome-extension-4285f4?style=for-the-badge&logo=googlechrome&logoColor=white">
  <img alt="No Tracking" src="https://img.shields.io/badge/privacy-no%20tracking-0f766e?style=for-the-badge">
</p>

Voxtilly turns selected webpage text into speech with a focused popup UI, separated language and voice controls, favorite voice preset cards, and playback controls that stay out of your way. It uses Chrome's built-in browser speech support, so there is no account, no custom cloud API, and no analytics pipeline hiding behind the curtain.

It is designed for quick reading, proofreading, accessibility support, language checks, and those times when listening is simply easier than staring at a page.

## Highlights

- Automatic selected-text loading when the toolbar popup opens.
- Detached control window that keeps watching the original tab for new selections.
- Separate `Language` and `Voice` dropdowns.
- Favorite voice preset cards with custom display names and drag-and-drop ordering.
- Multiple favorites per language, each with its own voice model.
- Right-click context menu that follows your favorite preset order.
- Pause, resume, and stop controls.
- Rate, pitch, and volume sliders.
- Manifest V3 with narrow, user-triggered permissions.
- No analytics, no remote scripts, and no custom server processing.

## Installation

### Chrome Web Store

Voxtilly is packaged for Chrome Web Store publishing.

<a href="[center](https://chromewebstore.google.com/detail/voxtilly/ghcbdiijlmbecephdomagfjngefloenc)">
  <img src="available_chrome.png" alt="Available Chrome Web Store" width="180">
</a>

### Local Install

1. Download or clone this repository.
2. Open Chrome.
3. Go to `chrome://extensions`.
4. Enable `Developer mode`.
5. Click `Load unpacked`.
6. Select the Voxtilly project folder.
7. Pin Voxtilly from the Chrome extensions menu.

## Usage

### Read Selected Text

1. Select text on a webpage.
2. Click the Voxtilly extension icon.
3. The selected text appears in the popup automatically.
4. Click `Read Aloud`.

### Keep Controls Open

1. Open Voxtilly.
2. Click the detached window button.
3. Select new text on the original page.
4. The detached popup updates with the new selection.

Voxtilly will not overwrite the text box while you are actively typing in it.

### Read Custom Text

1. Open Voxtilly.
2. Type or paste text into the text box.
3. Choose a language and voice if needed.
4. Click `Read Aloud`.

### Use The Context Menu

1. Select text on a webpage.
2. Right-click the selection.
3. Choose `Read selected text`.

If you add multiple favorite voice presets, the context menu shows them in the same order as your draggable favorite cards.

## Voice Controls

Voxtilly keeps language and voice selection separate:

| Control | What it does |
| --- | --- |
| `Language` | Sets the target speech language. |
| `Voice` | Shows browser voices matching the selected language. |

Available voices depend on Chrome, your operating system, installed speech packages, and browser speech services.

## Favorite Voice Presets

Favorites appear as compact cards in the popup and store both the language and selected voice model. When you add a favorite, Voxtilly asks for a display name so the UI and context menu can stay clean without guessing, rewriting, or parsing browser voice names. You can keep multiple favorites for the same language with different voice models.

- Add the currently selected language and voice pair.
- Name each favorite when it is added.
- Remove a preset with the card's X button.
- Drag cards to rearrange the order.
- Use that same order in the right-click context menu.

## Privacy

Voxtilly is intentionally simple about privacy:

- It does not collect analytics.
- It does not require an account.
- It does not send selected text to a custom server.
- It does not use remote JavaScript.
- It does not read password field selections.
- It injects its content script only when you invoke the extension.

Text-to-speech output is handled through the browser's speech APIs. Some system or browser voices may be network-backed depending on your environment.

## Permissions

| Permission | Why it is used |
| --- | --- |
| `activeTab` | Access the current tab after you invoke Voxtilly. |
| `scripting` | Inject the content script on demand. |
| `storage` | Save language, voice, favorites, and slider settings. |
| `contextMenus` | Add the right-click read action. |

Voxtilly intentionally avoids broad host permissions.

## Project Structure

```text
Voxtilly/
|-- background.js   # Context menu and on-demand content script messaging
|-- content.js      # Page selection and speech synthesis controller
|-- manifest.json   # Chrome Manifest V3 configuration
|-- popup.css       # Popup styling
|-- popup.html      # Popup interface
|-- popup.js        # Popup state, controls, settings, and messaging
|-- icons/          # Extension icons
|-- logo.png        # Project logo
`-- dist/           # Generated release ZIP
```

## Build A Release ZIP

On Windows PowerShell:

```powershell
Compress-Archive -Path manifest.json,popup.html,popup.css,popup.js,background.js,content.js,icons -DestinationPath dist\voxtilly-1.0.0.zip -Force
```

The generated ZIP can be uploaded to the Chrome Web Store Developer Dashboard.

## Development Checks

Run JavaScript syntax checks:

```powershell
node --check popup.js
node --check content.js
node --check background.js
```

Validate the manifest:

```powershell
Get-Content -Raw manifest.json | ConvertFrom-Json | Out-Null
```

## Known Notes

- Chrome does not allow extension script injection on pages such as `chrome://` URLs.
- Available voices vary by platform.
- Browser voices can load asynchronously, so Voxtilly retries voice discovery shortly after the popup opens.
- Chrome will not redraw a context menu that is already open. Close and reopen it after rearranging favorites.
