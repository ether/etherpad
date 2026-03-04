'use strict';

window.customStart = () => {
  // define your javascript here
  // jquery is available - except index.js
  // you can load extra scripts with $.getScript http://api.jquery.com/jQuery.getScript/
  const divHoldingPlaceHolderLabel = document
      .querySelector('[data-l10n-id="index.placeholderPadEnter"]');

  const observer = new MutationObserver(() => {
    document.querySelector('#go2Name input')
        .setAttribute('placeholder', divHoldingPlaceHolderLabel.textContent);
  });

  observer
      .observe(divHoldingPlaceHolderLabel, {childList: true, subtree: true, characterData: true});
};
