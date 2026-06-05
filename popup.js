const DEFAULT_SETTINGS = {
  lang: "",
  voiceURI: "",
  favoriteVoicePresets: [],
  rate: 1,
  pitch: 1,
  volume: 1
};
const SELECTION_WATCH_INTERVAL_MS = 700;

const elements = {
  status: document.getElementById("status"),
  manualText: document.getElementById("manualText"),
  readButton: document.getElementById("readButton"),
  openWindowButton: document.getElementById("openWindowButton"),
  pauseButton: document.getElementById("pauseButton"),
  stopButton: document.getElementById("stopButton"),
  toggleFavoriteButton: document.getElementById("toggleFavoriteButton"),
  favoriteLanguages: document.getElementById("favoriteLanguages"),
  languageSelect: document.getElementById("languageSelect"),
  voiceSelect: document.getElementById("voiceSelect"),
  rateInput: document.getElementById("rateInput"),
  pitchInput: document.getElementById("pitchInput"),
  volumeInput: document.getElementById("volumeInput"),
  rateValue: document.getElementById("rateValue"),
  pitchValue: document.getElementById("pitchValue"),
  volumeValue: document.getElementById("volumeValue")
};

let voices = [];
let settings = { ...DEFAULT_SETTINGS };
let sourceTabId = getSourceTabId();
let isPaused = false;
let isReading = false;
let voiceLoadTimer = null;
let voiceLoadAttempts = 0;
let draggedFavoriteLang = "";
let isDetachedPopup = new URLSearchParams(location.search).has("detached");
let selectionWatchTimer = null;
let isCheckingSelection = false;
let lastLoadedSelectionText = "";

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

async function init() {
  updateDetachedView();
  settings = await loadSettings();
  applySettingsToInputs();
  bindEvents();
  populateVoiceControls();
  await syncSpeechState();
  lastLoadedSelectionText = await loadSelectedText({ silent: true });
  startDetachedSelectionWatcher();

  if ("speechSynthesis" in window) {
    speechSynthesis.onvoiceschanged = () => {
      voiceLoadAttempts = 0;
      populateVoiceControls();
    };
  }
}

function bindEvents() {
  elements.readButton.addEventListener("click", readCurrentText);
  elements.openWindowButton.addEventListener("click", openDetachedControls);
  elements.pauseButton.addEventListener("click", togglePauseReading);
  elements.stopButton.addEventListener("click", stopReading);
  elements.toggleFavoriteButton.addEventListener("click", toggleCurrentFavorite);
  elements.favoriteLanguages.addEventListener("dragover", handleFavoriteListDragOver);
  elements.favoriteLanguages.addEventListener("drop", handleFavoriteListDrop);

  elements.languageSelect.addEventListener("change", () => {
    applyLanguageSelection(elements.languageSelect.value);
    saveSettings();
    populateVoiceControls();
  });

  elements.voiceSelect.addEventListener("change", () => {
    applyVoiceSelection(elements.voiceSelect.value);
    saveSettings();
    populateVoiceControls();
  });

  for (const key of ["rate", "pitch"]) {
    elements[`${key}Input`].addEventListener("input", () => {
      settings[key] = Number(elements[`${key}Input`].value);
      elements[`${key}Value`].textContent = settings[key].toFixed(1);
      saveSettings();
    });
  }

  elements.volumeInput.addEventListener("input", () => {
    const percentage = Number(elements.volumeInput.value);
    settings.volume = percentage / 100;
    elements.volumeValue.textContent = formatVolumePercentage(settings.volume);
    saveSettings();
  });
}

function updateDetachedView() {
  if (isDetachedPopup) {
    document.body.classList.add("detached");
    elements.openWindowButton.hidden = true;
  }
}

async function openDetachedControls() {
  const tab = await getActiveTab();
  const params = new URLSearchParams({ detached: "1" });
  if (tab?.id) params.set("tabId", String(tab.id));

  const url = chrome.runtime.getURL(`popup.html?${params.toString()}`);

  chrome.windows.create(
    {
      url,
      type: "popup",
      width: 720,
      height: 680,
      focused: true
    },
    () => {
      if (!chrome.runtime.lastError) return;

      chrome.tabs.create({ url });
    }
  );
}

function getSourceTabId() {
  const value = Number(new URLSearchParams(location.search).get("tabId"));
  return Number.isInteger(value) && value > 0 ? value : null;
}

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ ttsSettings: DEFAULT_SETTINGS }, ({ ttsSettings }) => {
      resolve(normalizeSettings({ ...DEFAULT_SETTINGS, ...ttsSettings }));
    });
  });
}

function saveSettings({ rebuildContextMenus = false } = {}) {
  settings = normalizeSettings(settings);
  chrome.storage.sync.set({ ttsSettings: settings }, () => {
    if (rebuildContextMenus) {
      requestContextMenuRebuild();
    }
  });
}

async function requestContextMenuRebuild() {
  try {
    await chrome.runtime.sendMessage({ type: "VOXTILLY_REBUILD_CONTEXT_MENUS" });
  } catch (_error) {
    // The storage listener in the background worker is still a fallback.
  }
}

function normalizeSettings(value) {
  const data = { ...DEFAULT_SETTINGS, ...(value || {}) };
  const favoriteVoicePresets = normalizeFavoriteVoicePresets(data.favoriteVoicePresets);

  return {
    ...DEFAULT_SETTINGS,
    lang: typeof data.lang === "string" ? data.lang : "",
    voiceURI: typeof data.voiceURI === "string" ? data.voiceURI : "",
    favoriteVoicePresets,
    rate: clampNumber(data.rate, 0.5, 2, DEFAULT_SETTINGS.rate),
    pitch: clampNumber(data.pitch, 0, 2, DEFAULT_SETTINGS.pitch),
    volume: clampNumber(data.volume, 0, 1, DEFAULT_SETTINGS.volume)
  };
}

function normalizeFavoriteVoicePresets(value) {
  const presets = [];
  const seenKeys = new Set();
  const sourceItems = Array.isArray(value) ? value : [];

  for (const item of sourceItems) {
    const preset = normalizeFavoriteVoicePreset(item);
    if (!preset) continue;

    const key = getFavoritePresetKey(preset);
    if (seenKeys.has(key)) continue;

    seenKeys.add(key);
    presets.push(preset);
  }

  return presets;
}

function normalizeFavoriteVoicePreset(value) {
  if (!value || typeof value !== "object") return null;

  const lang = typeof value.lang === "string" ? value.lang : "";
  if (!lang) return null;

  return {
    lang,
    voiceURI: typeof value.voiceURI === "string" ? value.voiceURI : "",
    voiceName: typeof value.voiceName === "string" ? value.voiceName : ""
  };
}

function getFavoriteLanguagesFromPresets(presets) {
  return [...new Set(presets.map((preset) => preset.lang).filter(Boolean))];
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function applySettingsToInputs() {
  elements.rateInput.value = settings.rate;
  elements.pitchInput.value = settings.pitch;
  elements.volumeInput.value = Math.round(Number(settings.volume) * 100);
  elements.rateValue.textContent = Number(settings.rate).toFixed(1);
  elements.pitchValue.textContent = Number(settings.pitch).toFixed(1);
  elements.volumeValue.textContent = formatVolumePercentage(settings.volume);
}

function formatVolumePercentage(volume) {
  return `${Math.round(Number(volume) * 100)}%`;
}

function populateVoiceControls() {
  voices = "speechSynthesis" in window ? speechSynthesis.getVoices() : [];
  scheduleVoiceReloadIfNeeded();

  const selectedVoice = voices.find((voice) => voice.voiceURI === settings.voiceURI);
  const selectedLanguage = settings.lang || selectedVoice?.lang || "";
  const languages = [...new Set([selectedLanguage, ...voices.map((voice) => voice.lang)].filter(Boolean))].sort();
  const favoriteLanguages = getFavoriteLanguagesFromPresets(settings.favoriteVoicePresets);
  const favoriteSet = new Set(favoriteLanguages);
  const orderedLanguages = [
    ...favoriteLanguages,
    ...languages.filter((lang) => !favoriteSet.has(lang))
  ];

  const languageOptions = [{ value: "", label: "Browser default" }];

  for (const lang of orderedLanguages) {
    const favoriteMarker = favoriteSet.has(lang) ? " *" : "";

    languageOptions.push({
      value: lang,
      label: `${getLanguageLabel(lang)} (${lang})${favoriteMarker}`
    });
  }

  fillSelect(elements.languageSelect, languageOptions);
  elements.languageSelect.value = languageOptions.some((option) => option.value === selectedLanguage)
    ? selectedLanguage
    : "";

  const matchingVoices = selectedLanguage
    ? voices.filter((voice) => voice.lang === selectedLanguage)
    : voices;
  const voiceOptions = [
    {
      value: "",
      label: selectedLanguage ? `Browser default for ${getLanguageLabel(selectedLanguage)}` : "Browser default"
    },
    ...matchingVoices.map((voice) => ({
      value: voice.voiceURI,
      label: selectedLanguage
        ? `${voice.name}${voice.localService ? "" : " (network)"}`
        : `${getLanguageLabel(voice.lang)} (${voice.lang}) - ${voice.name}${voice.localService ? "" : " (network)"}`
    }))
  ];

  if (!matchingVoices.length && voices.length) {
    voiceOptions.push({ value: "none", label: "No voices for this language", disabled: true });
  } else if (!voices.length) {
    voiceOptions.push({ value: "loading", label: "Loading voices...", disabled: true });
  }

  fillSelect(elements.voiceSelect, voiceOptions);

  const selectedValue = getSelectedVoiceValue(selectedLanguage);
  if (voiceOptions.some((option) => option.value === selectedValue)) {
    elements.voiceSelect.value = selectedValue;
  } else if (voices.length && settings.voiceURI) {
    elements.voiceSelect.value = "";
    settings.voiceURI = "";
    saveSettings();
  } else {
    elements.voiceSelect.value = selectedValue;
  }

  renderFavoriteLanguages();
  updateFavoriteButton();
}

function scheduleVoiceReloadIfNeeded() {
  if (voices.length || !("speechSynthesis" in window) || voiceLoadAttempts >= 20) {
    if (voiceLoadTimer) {
      clearTimeout(voiceLoadTimer);
      voiceLoadTimer = null;
    }
    return;
  }

  if (voiceLoadTimer) return;

  voiceLoadAttempts += 1;
  voiceLoadTimer = setTimeout(() => {
    voiceLoadTimer = null;
    populateVoiceControls();
  }, 150);
}

function toggleCurrentFavorite() {
  const preset = getCurrentFavoritePreset();
  if (!preset.lang) {
    setStatus("Choose a language or voice before adding a favorite.");
    return;
  }

  if (isFavoritePresetSaved(preset)) {
    settings.favoriteVoicePresets = settings.favoriteVoicePresets.filter((item) => {
      return getFavoritePresetKey(item) !== getFavoritePresetKey(preset);
    });
    setStatus(`${getFavoritePresetLabel(preset)} removed from favorites.`);
  } else {
    settings.favoriteVoicePresets = [...settings.favoriteVoicePresets, preset];
    setStatus(`${getFavoritePresetLabel(preset)} added to favorites.`);
  }

  saveSettings({ rebuildContextMenus: true });
  populateVoiceControls();
}

function removeFavoritePreset(preset) {
  settings.favoriteVoicePresets = settings.favoriteVoicePresets.filter((item) => {
    return getFavoritePresetKey(item) !== getFavoritePresetKey(preset);
  });
  saveSettings({ rebuildContextMenus: true });
  populateVoiceControls();
  setStatus(`${getFavoritePresetLabel(preset)} removed from favorites.`);
}

function getCurrentFavoritePreset() {
  const lang = getSelectedLanguage();
  const selectedVoice = voices.find((voice) => voice.voiceURI === settings.voiceURI);
  const voiceURI = selectedVoice?.lang === lang ? selectedVoice.voiceURI : "";
  const voiceName = voiceURI ? selectedVoice.name : "";

  return { lang, voiceURI, voiceName };
}

function isFavoritePresetSaved(preset) {
  const key = getFavoritePresetKey(preset);
  return settings.favoriteVoicePresets.some((item) => getFavoritePresetKey(item) === key);
}

function getFavoritePresetKey(preset) {
  return `${preset.lang}\n${preset.voiceURI || ""}`;
}

function getFavoritePresetLabel(preset) {
  if (!preset.voiceURI) return `${preset.lang} (Browser default)`;

  const voice = voices.find((item) => item.voiceURI === preset.voiceURI);
  return `${preset.lang} (${voice?.name || preset.voiceName || preset.voiceURI})`;
}

function getFavoriteChipTitle(preset) {
  const voice = voices.find((item) => item.voiceURI === preset.voiceURI);

  return voice
    ? `Voice: ${voice.name}. Drag to reorder.`
    : "Browser default voice. Drag to reorder.";
}

function renderFavoriteLanguages() {
  if (!settings.favoriteVoicePresets.length) {
    elements.favoriteLanguages.textContent = "No favorite voice presets yet.";
    return;
  }

  elements.favoriteLanguages.replaceChildren(
    ...settings.favoriteVoicePresets.map((preset) => {
      const presetKey = getFavoritePresetKey(preset);
      const chip = document.createElement("span");
      chip.className = "favorite-chip";
      chip.draggable = true;
      chip.dataset.favoriteKey = presetKey;
      chip.title = getFavoriteChipTitle(preset);
      chip.addEventListener("dragstart", (event) => handleFavoriteDragStart(event, presetKey));
      chip.addEventListener("dragover", handleFavoriteDragOver);
      chip.addEventListener("dragleave", handleFavoriteDragLeave);
      chip.addEventListener("drop", (event) => handleFavoriteDrop(event, presetKey));
      chip.addEventListener("dragend", handleFavoriteDragEnd);

      const label = document.createElement("span");
      label.className = "favorite-chip-label";
      label.textContent = getFavoritePresetLabel(preset);

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "favorite-chip-remove";
      removeButton.setAttribute("aria-label", `Remove ${getFavoritePresetLabel(preset)} from favorites`);
      removeButton.title = `Remove ${getFavoritePresetLabel(preset)}`;
      removeButton.textContent = "x";
      removeButton.addEventListener("click", () => removeFavoritePreset(preset));

      chip.append(label, removeButton);
      return chip;
    })
  );
}

function handleFavoriteDragStart(event, presetKey) {
  draggedFavoriteLang = presetKey;
  event.currentTarget.classList.add("is-dragging");

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", presetKey);
  }
}

function handleFavoriteDragOver(event) {
  if (!draggedFavoriteLang) return;

  event.preventDefault();
  clearFavoriteDropTargets();
  event.currentTarget.classList.add("is-drop-target");

  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
}

function handleFavoriteDragLeave(event) {
  event.currentTarget.classList.remove("is-drop-target");
}

function handleFavoriteDrop(event, targetKey) {
  event.preventDefault();
  event.stopPropagation();
  const draggedKey = event.dataTransfer?.getData("text/plain") || draggedFavoriteLang;
  clearFavoriteDragState();

  if (!draggedKey || draggedKey === targetKey) return;

  const draggedPreset = settings.favoriteVoicePresets.find((preset) => getFavoritePresetKey(preset) === draggedKey);
  if (!draggedPreset) return;

  const nextFavorites = settings.favoriteVoicePresets.filter((preset) => getFavoritePresetKey(preset) !== draggedKey);
  const targetIndex = nextFavorites.findIndex((preset) => getFavoritePresetKey(preset) === targetKey);
  if (targetIndex === -1) return;

  nextFavorites.splice(targetIndex, 0, draggedPreset);
  settings.favoriteVoicePresets = nextFavorites;
  saveSettings({ rebuildContextMenus: true });
  populateVoiceControls();
  setStatus(`${getFavoritePresetLabel(draggedPreset)} moved.`);
}

function handleFavoriteDragEnd() {
  clearFavoriteDragState();
}

function handleFavoriteListDragOver(event) {
  if (!draggedFavoriteLang || event.target !== elements.favoriteLanguages) return;

  event.preventDefault();

  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
}

function handleFavoriteListDrop(event) {
  if (event.target !== elements.favoriteLanguages) return;

  event.preventDefault();
  const draggedKey = event.dataTransfer?.getData("text/plain") || draggedFavoriteLang;
  clearFavoriteDragState();

  if (!draggedKey) return;

  const draggedPreset = settings.favoriteVoicePresets.find((preset) => getFavoritePresetKey(preset) === draggedKey);
  if (!draggedPreset) return;

  const nextFavorites = settings.favoriteVoicePresets.filter((preset) => getFavoritePresetKey(preset) !== draggedKey);
  nextFavorites.push(draggedPreset);
  settings.favoriteVoicePresets = nextFavorites;
  saveSettings({ rebuildContextMenus: true });
  populateVoiceControls();
  setStatus(`${getFavoritePresetLabel(draggedPreset)} moved to the end.`);
}

function clearFavoriteDragState() {
  draggedFavoriteLang = "";
  clearFavoriteDropTargets();
  for (const chip of elements.favoriteLanguages.querySelectorAll(".favorite-chip")) {
    chip.classList.remove("is-dragging");
  }
}

function clearFavoriteDropTargets() {
  for (const chip of elements.favoriteLanguages.querySelectorAll(".favorite-chip")) {
    chip.classList.remove("is-drop-target");
  }
}

function updateFavoriteButton() {
  const preset = getCurrentFavoritePreset();
  elements.toggleFavoriteButton.disabled = !preset.lang;
  elements.toggleFavoriteButton.textContent = isFavoritePresetSaved(preset)
    ? "Remove Favorite"
    : "Favorite Voice";
}

function applyLanguageSelection(lang) {
  settings.lang = lang;
  settings.voiceURI = "";
}

function applyVoiceSelection(voiceURI) {
  if (!voiceURI) {
    settings.voiceURI = "";
    return;
  }

  const selectedVoice = voices.find((voice) => voice.voiceURI === voiceURI);
  if (!selectedVoice) return;

  settings.voiceURI = voiceURI;
  settings.lang = selectedVoice.lang || settings.lang;
}

function getSelectedVoiceValue(selectedLanguage = settings.lang) {
  if (!settings.voiceURI) return "";

  const selectedVoice = voices.find((voice) => voice.voiceURI === settings.voiceURI);
  if (!selectedLanguage || !selectedVoice || selectedVoice.lang === selectedLanguage) {
    return settings.voiceURI;
  }

  return "";
}

function getSelectedLanguage() {
  const languageValue = elements.languageSelect.value;
  if (languageValue) return languageValue;

  const voiceURI = elements.voiceSelect.value;
  return voices.find((voice) => voice.voiceURI === voiceURI)?.lang || settings.lang || "";
}

function getLanguageLabel(lang) {
  if (!lang) return "Unknown language";

  try {
    const displayNames = new Intl.DisplayNames([navigator.language || "en"], { type: "language" });
    return displayNames.of(lang) || lang;
  } catch (_error) {
    return lang;
  }
}

function fillSelect(select, options) {
  const currentValue = select.value;
  select.replaceChildren(
    ...options.map((option) => {
      const node = document.createElement("option");
      node.value = option.value;
      node.textContent = option.label;
      node.disabled = Boolean(option.disabled);
      return node;
    })
  );

  if (options.some((option) => option.value === currentValue)) {
    select.value = currentValue;
  }
}

function startDetachedSelectionWatcher() {
  if (!isDetachedPopup || selectionWatchTimer) return;

  selectionWatchTimer = setInterval(refreshDetachedSelection, SELECTION_WATCH_INTERVAL_MS);
  window.addEventListener("beforeunload", () => clearInterval(selectionWatchTimer), { once: true });
}

async function refreshDetachedSelection() {
  if (isCheckingSelection || document.activeElement === elements.manualText) return;

  isCheckingSelection = true;

  try {
    const selectedText = await getSelectedTextFromSourceTab();
    if (
      selectedText &&
      (selectedText !== lastLoadedSelectionText || elements.manualText.value !== selectedText)
    ) {
      lastLoadedSelectionText = selectedText;
      elements.manualText.value = selectedText;
      setStatus("Selection updated.");
    }
  } finally {
    isCheckingSelection = false;
  }
}

async function loadSelectedText({ silent = false, announce = true } = {}) {
  const selectedText = await getSelectedTextFromSourceTab();
  if (!selectedText) {
    if (!silent) setStatus("No selected text found on this page.");
    return "";
  }

  lastLoadedSelectionText = selectedText;
  elements.manualText.value = selectedText;
  if (announce) setStatus("Selection loaded.");
  return selectedText;
}

async function getSelectedTextFromSourceTab() {
  const tab = await getActiveTab();
  if (!tab?.id) {
    return "";
  }

  const response = await sendTabMessage(tab.id, { type: "VOXTILLY_CORE_GET_SELECTED_TEXT" });
  return response?.ok && response.text ? response.text : "";
}

async function readCurrentText() {
  const text = elements.manualText.value.trim();
  if (!text) {
    setStatus("Enter text or select page text before opening Voxtilly.");
    return;
  }

  const tab = await getActiveTab();
  if (tab?.id) {
    const response = await sendTabMessage(tab.id, { type: "VOXTILLY_CORE_SPEAK_TEXT", text, settings });
    if (response?.ok) {
      setReadingState(response.state || { reading: true, paused: false });
      setStatus("Reading aloud.");
      return;
    }

    if (response?.error) {
      setStatus(response.error);
      return;
    }
  }

  setStatus("Speech is unavailable on this page.");
}

async function stopReading() {
  const tab = await getActiveTab();
  if (tab?.id) {
    const response = await sendTabMessage(tab.id, { type: "VOXTILLY_CORE_STOP_SPEECH" });
    if (!response?.ok) {
      setStatus("Speech control failed on this page.");
      await syncSpeechState();
      return;
    }
  }

  setReadingState({ reading: false, paused: false });
  setStatus("Stopped.");
}

async function togglePauseReading() {
  const shouldResume = isPaused;
  const messageType = shouldResume ? "VOXTILLY_CORE_RESUME_SPEECH" : "VOXTILLY_CORE_PAUSE_SPEECH";
  const tab = await getActiveTab();

  if (!tab?.id) {
    setStatus("No active tab found.");
    return;
  }

  const response = await sendTabMessage(tab.id, { type: messageType });
  if (!response?.ok) {
    setStatus(response?.error || "Speech control failed.");
    await syncSpeechState();
    return;
  }

  setReadingState(response.state || { reading: true, paused: !shouldResume });
  setStatus(shouldResume ? "Reading aloud." : "Paused.");
}

async function syncSpeechState() {
  const tab = await getActiveTab();
  if (!tab?.id) return;

  const response = await sendTabMessage(tab.id, { type: "VOXTILLY_CORE_GET_SPEECH_STATE" });
  if (response?.ok && response.state) {
    setReadingState(response.state);
  }
}

function setReadingState({ reading, paused }) {
  isReading = Boolean(reading);
  isPaused = Boolean(paused);
  elements.pauseButton.disabled = !isReading;
  elements.pauseButton.classList.toggle("is-paused", isPaused);
  elements.pauseButton.setAttribute("aria-label", isPaused ? "Resume reading" : "Pause reading");
  elements.pauseButton.title = isPaused ? "Resume" : "Pause";
}

function getActiveTab() {
  if (sourceTabId) {
    return chrome.tabs.get(sourceTabId).catch(() => {
      sourceTabId = null;
      return getActiveTab();
    });
  }

  return chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => tab);
}

async function sendTabMessage(tabId, message) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, message);
    if (response !== undefined) return response;
  } catch (_error) {
    // Fall through to injection below.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (_injectionError) {
    return null;
  }
}

function setStatus(message) {
  elements.status.textContent = message;
}
