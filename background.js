const DEFAULT_SETTINGS = {
  lang: "",
  voiceURI: "",
  favoriteVoicePresets: [],
  rate: 1,
  pitch: 1,
  volume: 1
};

const MENU_ROOT_ID = "read-selection";
const FAVORITE_MENU_PREFIX = "read-selection-favorite:";

let isRebuildingMenus = false;
let shouldRebuildMenusAgain = false;

chrome.runtime.onInstalled.addListener(queueContextMenuRebuild);
chrome.runtime.onStartup.addListener(queueContextMenuRebuild);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && favoritesChanged(changes.ttsSettings)) {
    queueContextMenuRebuild();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "VOXTILLY_REBUILD_CONTEXT_MENUS") {
    return false;
  }

  queueContextMenuRebuild();
  sendResponse({ ok: true });
  return false;
});

function queueContextMenuRebuild() {
  if (isRebuildingMenus) {
    shouldRebuildMenusAgain = true;
    return;
  }

  isRebuildingMenus = true;
  rebuildContextMenus(() => {
    isRebuildingMenus = false;

    if (shouldRebuildMenusAgain) {
      shouldRebuildMenusAgain = false;
      queueContextMenuRebuild();
    }
  });
}

function rebuildContextMenus(done) {
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) {
      done();
      return;
    }

    chrome.storage.sync.get({ ttsSettings: DEFAULT_SETTINGS }, ({ ttsSettings }) => {
      const settings = { ...DEFAULT_SETTINGS, ...ttsSettings };
      const favorites = normalizeFavoriteVoicePresets(settings.favoriteVoicePresets);
      const items = [];

      if (favorites.length) {
        items.push({
          id: MENU_ROOT_ID,
          title: "Read selected text",
          contexts: ["selection"]
        });

        for (const favorite of favorites) {
          items.push({
            id: `${FAVORITE_MENU_PREFIX}${favorite.id}`,
            parentId: MENU_ROOT_ID,
            title: getFavoriteMenuTitle(favorite),
            contexts: ["selection"]
          });
        }

        createContextMenuItems(items, done);
        return;
      }

      items.push({
        id: MENU_ROOT_ID,
        title: "Read selected text",
        contexts: ["selection"]
      });

      createContextMenuItems(items, done);
    });
  });
}

function createContextMenuItems(items, done) {
  const [item, ...remainingItems] = items;

  if (!item) {
    done();
    return;
  }

  chrome.contextMenus.create(item, () => {
    void chrome.runtime.lastError;
    createContextMenuItems(remainingItems, done);
  });
}

function normalizeFavoriteVoicePresets(value) {
  if (!Array.isArray(value)) return [];

  const presets = [];
  const seenKeys = new Set();

  for (const item of value) {
    if (!item || typeof item !== "object") continue;

    const lang = typeof item.lang === "string" ? item.lang : "";
    if (!lang) continue;

    const voiceURI = typeof item.voiceURI === "string" ? item.voiceURI : "";
    if (!voiceURI) continue;

    const preset = {
      lang,
      voiceURI,
      voiceName: typeof item.voiceName === "string" ? item.voiceName : "",
      label: typeof item.label === "string" ? item.label.trim() : "",
      id: typeof item.id === "string" && item.id ? item.id : createFavoritePresetId(lang, voiceURI)
    };
    const key = getFavoritePresetKey(preset);
    if (seenKeys.has(key)) continue;

    seenKeys.add(key);
    presets.push(preset);
  }

  return presets;
}

function getFavoritePresetKey(preset) {
  return `${preset.lang}\n${preset.voiceURI || ""}`;
}

function createFavoritePresetId(lang, voiceURI) {
  return `fav-${hashString(getFavoritePresetKey({ lang, voiceURI }))}`;
}

function hashString(value) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function getFavoriteMenuTitle(preset) {
  return `${getReadableLanguageName(preset.lang)} (${getFavoriteVoiceLabel(preset)})`;
}

function getFavoriteVoiceLabel(preset) {
  const customLabel = String(preset.label || "").trim();
  if (customLabel) return customLabel;

  return getVoiceDisplayName(preset.voiceName || preset.voiceURI);
}

function getVoiceDisplayName(value) {
  return String(value || "").trim() || "Voice";
}

function getReadableLanguageName(lang) {
  const languageName = getDisplayName(lang, "language");
  const locale = getParsedLocale(lang);
  if (!locale) return languageName || lang;

  const baseLocale = getParsedLocale(locale.language);
  const shouldUseBaseLanguage = locale.region && baseLocale?.maximize().region === locale.maximize().region;

  if (shouldUseBaseLanguage) {
    return getDisplayName(locale.language, "language") || languageName || lang;
  }

  return languageName || lang;
}

function getParsedLocale(value) {
  try {
    return new Intl.Locale(value);
  } catch (_error) {
    return null;
  }
}

function getDisplayName(value, type) {
  if (!value) return "";

  try {
    const displayNames = new Intl.DisplayNames([chrome.i18n?.getUILanguage?.() || "en"], { type });
    return displayNames.of(value) || value;
  } catch (_error) {
    return value;
  }
}

function favoritesChanged(change) {
  if (!change) return false;

  const oldFavorites = normalizeFavoriteVoicePresets(change.oldValue?.favoriteVoicePresets)
    .map(getFavoriteMenuSignature)
    .join("\n");
  const newFavorites = normalizeFavoriteVoicePresets(change.newValue?.favoriteVoicePresets)
    .map(getFavoriteMenuSignature)
    .join("\n");
  return oldFavorites !== newFavorites;
}

function getFavoriteMenuSignature(preset) {
  return [
    getFavoritePresetKey(preset),
    preset.voiceName || "",
    preset.label || "",
    preset.id || ""
  ].join("\n");
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id || !info.selectionText) {
    return;
  }

  const favoriteId = getFavoriteIdFromMenuId(info.menuItemId);
  const settings = favoriteId === ""
    ? await getSingleFavoriteOverride()
    : await getFavoriteOverride(favoriteId);
  await sendTabMessage(tab.id, {
    type: "VOXTILLY_CORE_SPEAK_TEXT",
    text: info.selectionText,
    settings
  });
});

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
    // Some pages, such as chrome:// pages, do not allow extension script injection.
    return null;
  }
}

function getFavoriteIdFromMenuId(menuItemId) {
  if (typeof menuItemId !== "string" || !menuItemId.startsWith(FAVORITE_MENU_PREFIX)) {
    return "";
  }

  return menuItemId.slice(FAVORITE_MENU_PREFIX.length);
}

function getSingleFavoriteOverride() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ ttsSettings: DEFAULT_SETTINGS }, ({ ttsSettings }) => {
      const settings = { ...DEFAULT_SETTINGS, ...ttsSettings };
      const favorites = normalizeFavoriteVoicePresets(settings.favoriteVoicePresets);

      resolve(favorites.length === 1 ? getFavoriteSettings(favorites[0]) : {});
    });
  });
}

function getFavoriteOverride(id) {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ ttsSettings: DEFAULT_SETTINGS }, ({ ttsSettings }) => {
      const settings = { ...DEFAULT_SETTINGS, ...ttsSettings };
      const favorites = normalizeFavoriteVoicePresets(settings.favoriteVoicePresets);
      const favorite = favorites.find((item) => item.id === id);

      resolve(favorite ? getFavoriteSettings(favorite) : {});
    });
  });
}

function getFavoriteSettings(favorite) {
  return {
    lang: favorite.lang,
    voiceURI: favorite.voiceURI || ""
  };
}

