// Shared storage helpers for the typing test site.
(function () {
  const SETTINGS_KEY = 'typing.settings.v1';

  const DEFAULT_SETTINGS = {
    theme: 'gruvbox',
    fontSize: 1.6,
    caretStyle: 'default',
    sound: false,
    punctuation: true,
    numbers: false,
    mode: 'time',
    timeLimit: 30,
    wordCount: 25
  };

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        return Object.assign({}, DEFAULT_SETTINGS, obj || {});
      }
    } catch (e) {}
    return Object.assign({}, DEFAULT_SETTINGS);
  }

  function saveSettings(s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  }

  window.TypingStorage = {
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    loadSettings: loadSettings,
    saveSettings: saveSettings
  };
})();
