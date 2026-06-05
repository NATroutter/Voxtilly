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

      if (favorites.length > 1) {
        items.push({
          id: MENU_ROOT_ID,
          title: "Read selected text",
          contexts: ["selection"]
        });

        for (const [index, favorite] of favorites.entries()) {
          items.push({
            id: `${FAVORITE_MENU_PREFIX}${index}`,
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
        title: favorites.length ? `Read selected text (${getFavoriteMenuTitle(favorites[0])})` : "Read selected text",
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

    const preset = {
      lang,
      voiceURI: typeof item.voiceURI === "string" ? item.voiceURI : "",
      voiceName: typeof item.voiceName === "string" ? item.voiceName : ""
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

function getFavoriteMenuTitle(preset) {
  return preset.voiceURI
    ? `${preset.lang} (${preset.voiceName || preset.voiceURI})`
    : `${preset.lang} (Browser default)`;
}

function favoritesChanged(change) {
  if (!change) return false;

  const oldFavorites = normalizeFavoriteVoicePresets(change.oldValue?.favoriteVoicePresets)
    .map(getFavoritePresetKey)
    .join("\n");
  const newFavorites = normalizeFavoriteVoicePresets(change.newValue?.favoriteVoicePresets)
    .map(getFavoritePresetKey)
    .join("\n");
  return oldFavorites !== newFavorites;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id || !info.selectionText) {
    return;
  }

  const favoriteIndex = getFavoriteIndexFromMenuId(info.menuItemId);
  const settings = favoriteIndex === null
    ? await getSingleFavoriteOverride()
    : await getFavoriteOverride(favoriteIndex);
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

function getFavoriteIndexFromMenuId(menuItemId) {
  if (typeof menuItemId !== "string" || !menuItemId.startsWith(FAVORITE_MENU_PREFIX)) {
    return null;
  }

  const value = Number(menuItemId.slice(FAVORITE_MENU_PREFIX.length));
  return Number.isInteger(value) && value >= 0 ? value : null;
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

function getFavoriteOverride(index) {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ ttsSettings: DEFAULT_SETTINGS }, ({ ttsSettings }) => {
      const settings = { ...DEFAULT_SETTINGS, ...ttsSettings };
      const favorites = normalizeFavoriteVoicePresets(settings.favoriteVoicePresets);
      const favorite = favorites[index];

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

