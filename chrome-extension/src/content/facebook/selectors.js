(function () {
  globalThis.DealerPilotFacebookSelectors = {
    buttons: 'div[role="button"], button, [role="button"]',
    checkbox: '[role="checkbox"], input[type="checkbox"], [aria-checked]',
    combobox: '[role="combobox"]',
    contentEditableMessage:
      '[contenteditable="true"][role="textbox"], [contenteditable="true"][aria-label*="Message" i], [contenteditable="true"]',
    marketplaceItemLink: 'a[href*="/marketplace/item/"]',
    photoInput: 'input[type="file"][accept*="image"], input[type="file"][multiple], input[type="file"]',
    textbox: 'input, textarea, [role="textbox"], [contenteditable="true"]',
  };
})();
