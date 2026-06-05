(() => {
  const CONTENT_SCRIPT_VERSION = "voxtilly-core-speech-2";
  const READABLE_INPUT_TYPES = new Set(["text", "search", "url", "tel", "email"]);

  if (globalThis.__voxtillyContentScriptVersion === CONTENT_SCRIPT_VERSION) {
    return;
  }

  globalThis.__voxtillyContentScriptVersion = CONTENT_SCRIPT_VERSION;

  const DEFAULT_SETTINGS = {
    lang: "",
    voiceURI: "",
    rate: 1,
    pitch: 1,
    volume: 1
  };

  let currentUtterance = null;
  let speechStatus = "idle";

  function getSelectionText() {
    const active = document.activeElement;

    if (active?.tagName === "INPUT" && active.type === "password") {
      return "";
    }

    if (
      active &&
      (active.tagName === "TEXTAREA" ||
        (active.tagName === "INPUT" && READABLE_INPUT_TYPES.has(active.type)))
    ) {
      const start = active.selectionStart ?? 0;
      const end = active.selectionEnd ?? 0;
      return active.value.slice(start, end).trim();
    }

    return window.getSelection().toString().trim();
  }

  function getStoredSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get({ ttsSettings: DEFAULT_SETTINGS }, ({ ttsSettings }) => {
        resolve(normalizeSpeechSettings({ ...DEFAULT_SETTINGS, ...ttsSettings }));
      });
    });
  }

  function pickVoice(settings, voices) {
    if (settings.voiceURI) {
      const exactVoice = voices.find((voice) => voice.voiceURI === settings.voiceURI);
      if (exactVoice) return exactVoice;
    }

    if (settings.lang) {
      return voices.find((voice) => voice.lang === settings.lang) || null;
    }

    return null;
  }

  function waitForVoices() {
    const loadedVoices = speechSynthesis.getVoices();
    if (loadedVoices.length) return Promise.resolve(loadedVoices);

    return new Promise((resolve) => {
      let attempts = 0;
      let timer = null;
      let settled = false;

      const cleanup = () => {
        settled = true;
        if (timer) clearTimeout(timer);
        if (typeof speechSynthesis.removeEventListener === "function") {
          speechSynthesis.removeEventListener("voiceschanged", handleVoicesChanged);
        }
      };

      const finish = (voices) => {
        if (settled) return;
        cleanup();
        resolve(voices);
      };

      const check = () => {
        const voices = speechSynthesis.getVoices();
        if (voices.length || attempts >= 20) {
          finish(voices);
          return;
        }

        attempts += 1;
        timer = setTimeout(check, 100);
      };

      function handleVoicesChanged() {
        const voices = speechSynthesis.getVoices();
        if (voices.length) finish(voices);
      }

      if (typeof speechSynthesis.addEventListener === "function") {
        speechSynthesis.addEventListener("voiceschanged", handleVoicesChanged);
      }

      check();
    });
  }

  function normalizeSpeechSettings(value = {}) {
    return {
      lang: typeof value.lang === "string" ? value.lang : "",
      voiceURI: typeof value.voiceURI === "string" ? value.voiceURI : "",
      rate: clampNumber(value.rate, 0.5, 2, DEFAULT_SETTINGS.rate),
      pitch: clampNumber(value.pitch, 0, 2, DEFAULT_SETTINGS.pitch),
      volume: clampNumber(value.volume, 0, 1, DEFAULT_SETTINGS.volume)
    };
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  async function speakText(text, overrideSettings = {}) {
    const value = (text || "").trim();
    if (!value) return { ok: false, error: "No text to read.", state: getSpeechState() };

    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      return { ok: false, error: "Text-to-speech is not available on this page.", state: getSpeechState() };
    }

    const settings = normalizeSpeechSettings({ ...(await getStoredSettings()), ...overrideSettings });
    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(value);
    currentUtterance = utterance;
    utterance.rate = settings.rate;
    utterance.pitch = settings.pitch;
    utterance.volume = settings.volume;

    const voice = settings.voiceURI || settings.lang
      ? pickVoice(settings, await waitForVoices())
      : null;
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else if (settings.lang) {
      utterance.lang = settings.lang;
    }

    utterance.onstart = () => {
      if (currentUtterance !== utterance) return;
      speechStatus = "reading";
    };

    utterance.onpause = () => {
      if (currentUtterance !== utterance) return;
      speechStatus = "paused";
    };

    utterance.onresume = () => {
      if (currentUtterance !== utterance) return;
      speechStatus = "reading";
    };

    utterance.onend = () => {
      if (currentUtterance !== utterance) return;
      currentUtterance = null;
      speechStatus = "idle";
    };

    utterance.onerror = () => {
      if (currentUtterance !== utterance) return;
      currentUtterance = null;
      speechStatus = "idle";
    };

    speechStatus = "reading";
    speechSynthesis.speak(utterance);
    return { ok: true, state: getSpeechState() };
  }

  function stopSpeech() {
    if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
    }

    currentUtterance = null;
    speechStatus = "idle";
    return { ok: true, state: getSpeechState() };
  }

  function pauseSpeech() {
    if (!("speechSynthesis" in window) || speechStatus !== "reading") {
      return { ok: false, error: "Nothing is reading.", state: getSpeechState() };
    }

    speechSynthesis.pause();
    speechStatus = "paused";
    return { ok: true, state: getSpeechState() };
  }

  function resumeSpeech() {
    if (!("speechSynthesis" in window) || speechStatus !== "paused") {
      return { ok: false, error: "Speech is not paused.", state: getSpeechState() };
    }

    speechSynthesis.resume();
    speechStatus = "reading";
    return { ok: true, state: getSpeechState() };
  }

  function getSpeechState() {
    return {
      status: speechStatus,
      reading: speechStatus === "reading" || speechStatus === "paused",
      paused: speechStatus === "paused"
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "VOXTILLY_CORE_GET_SELECTED_TEXT") {
      sendResponse({ ok: true, text: getSelectionText() });
      return false;
    }

    if (message?.type === "VOXTILLY_CORE_SPEAK_TEXT") {
      speakText(message.text, message.settings).then(sendResponse);
      return true;
    }

    if (message?.type === "VOXTILLY_CORE_STOP_SPEECH") {
      sendResponse(stopSpeech());
      return false;
    }

    if (message?.type === "VOXTILLY_CORE_PAUSE_SPEECH") {
      sendResponse(pauseSpeech());
      return false;
    }

    if (message?.type === "VOXTILLY_CORE_RESUME_SPEECH") {
      sendResponse(resumeSpeech());
      return false;
    }

    if (message?.type === "VOXTILLY_CORE_GET_SPEECH_STATE") {
      sendResponse({ ok: true, state: getSpeechState() });
      return false;
    }

    return false;
  });
})();
