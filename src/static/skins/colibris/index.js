'use strict';

window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      window.customStart();
    } else {
      window.addEventListener('DOMContentLoaded', window.customStart, {once: true});
    }
  }
});

window.customStart = () => {
  const recentPadList = document.getElementById('recent-pads');
  if (recentPadList) {
    recentPadList.replaceChildren();
  }
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


  const recentPadListHeading = document.querySelector('[data-l10n-id="index.recentPads"]');
  const recentPadsFromLocalStorage = localStorage.getItem('recentPads');
  let recentPadListData = [];
  if (recentPadsFromLocalStorage != null) {
    recentPadListData = JSON.parse(recentPadsFromLocalStorage);
  }

  // Remove duplicates based on pad name and sort by timestamp
  recentPadListData = recentPadListData.filter(
      (pad, index, self) => index === self.findIndex((p) => p.name === pad.name)
  ).sort((a, b) => new Date(a.timestamp) > new Date(b.timestamp) ? -1 : 1);

  if (recentPadList && recentPadListData.length === 0) {
    const parentStyle = recentPadList.parentElement.style;
    recentPadListHeading.setAttribute('data-l10n-id', 'index.recentPadsEmpty');
    parentStyle.display = 'flex';
    parentStyle.justifyContent = 'center';
    parentStyle.alignItems = 'center';
    parentStyle.maxHeight = '100%';
    recentPadList.remove();
  } else if (recentPadList) {
    /**
     * @typedef {Object} Pad
     * @property {string} name
     */

    /**
     * @param {Pad} pad
     */

    const arrowIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right w-4 h-4 text-gray-400"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>';
    const clockIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-clock w-3 h-3"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';
    const personalIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-users w-3 h-3"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>';
    recentPadListData.forEach((pad) => {
      const li = document.createElement('li');


      li.style.cursor = 'pointer';

      li.className = 'recent-pad';
      const padPath = `${window.location.href}p/${pad.name}`;
      const link = document.createElement('a');
      link.style.textDecoration = 'none';

      link.href = padPath;
      link.innerText = pad.name;
      li.appendChild(link);


      const arrowIconElement = document.createElement('span');
      arrowIconElement.className = 'recent-pad-arrow';
      arrowIconElement.innerHTML = arrowIcon;
      li.appendChild(arrowIconElement);

      const nextRow = document.createElement('div');

      nextRow.style.display = 'flex';
      nextRow.style.gap = '10px';
      nextRow.style.marginTop = '10px';

      const clockIconElement = document.createElement('span');
      clockIconElement.className = 'recent-pad-clock';
      clockIconElement.innerHTML = clockIcon;

      nextRow.appendChild(clockIconElement);

      const time = new Date(pad.timestamp);
      const userLocale = navigator.language || 'en-US';

      const formattedTime = time.toLocaleDateString(userLocale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      const timeElement = document.createElement('span');
      timeElement.className = 'recent-pad-time';
      timeElement.innerText = formattedTime;

      nextRow.appendChild(timeElement);

      const personalIconElement = document.createElement('span');
      personalIconElement.className = 'recent-pad-personal';
      personalIconElement.innerHTML = personalIcon;

      personalIconElement.style.marginLeft = '5px';

      const members = document.createElement('span');
      members.className = 'recent-pad-members';
      members.innerText = pad.members;


      nextRow.appendChild(personalIconElement);
      nextRow.appendChild(members);
      li.appendChild(nextRow);

      li.addEventListener('click', () => {
        window.location.href = padPath;
      });

      // https://v0.dev/chat/etherpad-design-clone-qZnwOrVRXxH
      recentPadList.appendChild(li);
    });
  }
};
