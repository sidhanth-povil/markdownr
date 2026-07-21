const MENU_ID = "markdownr-quick-copy"

chrome.runtime.onInstalled.addListener(() => {
  // removeAll first: onInstalled also fires on update, and create() throws on a duplicate id
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Copy page as Markdown",
      contexts: ["page", "selection"]
    })
  })
})

function notify(message: string) {
  const icons = chrome.runtime.getManifest().icons ?? {}
  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL(icons["128"] ?? icons["48"] ?? ""),
    title: "Markdownr",
    message
  })
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return
  // Right-clicking a selection means "convert this", not "convert the whole page" —
  // the menu is registered for the selection context, so honour it over the saved mode.
  const hasSelection = !!info.selectionText
  chrome.tabs.sendMessage(tab.id, { type: "QUICK_COPY", hasSelection }, (res) => {
    if (chrome.runtime.lastError || !res) {
      notify("Can't run on this page.")
    } else if (res.ok) {
      notify("Markdown copied to clipboard.")
    } else {
      notify(res.error || "Conversion failed.")
    }
  })
})
