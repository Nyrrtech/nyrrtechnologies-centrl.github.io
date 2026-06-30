// background.js — News Sentiment Radar Extension
// Opens the dashboard in a new tab when the extension icon is clicked.

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});
