const checkmark = '<svg width="28" height="28" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="3" stroke="currentColor"><path vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>';

function getCookie(name: string) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) { // @ts-ignore
    return parts.pop().split(';').shift();
  }
}


function handleTransferOfSession() {
  const transferNowButton = document.querySelector('[data-l10n-id="index.transferSessionNow"]')! as HTMLButtonElement;

  transferNowButton.addEventListener('click', async () => {
    transferNowButton.style.display = 'inline-flex';
    transferNowButton.style.alignItems = 'center';
    transferNowButton.style.justifyContent = 'center';
    transferNowButton.innerHTML = `${checkmark}`;
    transferNowButton.disabled = true;

    const responseWithId = await fetch("./tokenTransfer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prefsHttp: getCookie('prefsHttp'),
        token: getCookie('token'),
      })
    })

    const copyLinkSection = document.getElementById('copy-link-section')
    if (!copyLinkSection) return;
    copyLinkSection.style.display = 'block';

    const copyButton = document.querySelector('#copy-link-section .btn-secondary') as HTMLButtonElement
    const responseData = await responseWithId.json();
    copyButton.addEventListener('click', async ()=>{
      await navigator.clipboard.writeText(responseData.id);
      copyButton.style.display = 'inline-flex';
      copyButton.style.alignItems = 'center';
      copyButton.style.justifyContent = 'center';
      copyButton.innerHTML = `${checkmark}`;
      copyButton.disabled = true;
    })
  });
}


const handleSettingsButtonClick = () => {
  const settingsButton = document.querySelector('.settings-button')!;
  const settingsDialog = document.getElementById('settings-dialog') as HTMLDialogElement;
  let initialSettingsHtml: string;

  settingsDialog.addEventListener('click', (e) => {
    if (e.target === settingsDialog) {
      settingsDialog.close();
      settingsDialog.innerHTML = initialSettingsHtml;
      handleMenuBarClicked();
      handleTransferOfSession();
    }
  });

  settingsButton.addEventListener('click', () => {
    initialSettingsHtml = settingsDialog.innerHTML;
    settingsDialog.showModal();
  });
};


const handleMenuBarClicked = () => {
  const menuBar = document.getElementById('button-bar')!;
  menuBar.querySelectorAll('button').forEach((button, index)=>{
    button.addEventListener('click', ()=>{
      menuBar.querySelectorAll('button').forEach((btn)=>btn.classList.remove('active-btn'));
      button.classList.add('active-btn');

      const sections: NodeListOf<HTMLDivElement> = document.querySelectorAll('#settings-dialog > div');
      sections.forEach((section, index)=>index >= 1 && (section.style.display = 'none'));
      (sections[index +1] as HTMLElement).style.display = 'block';
    });
  })

  const transferSessionButton = document.getElementById('transferSessionButton')
  const codeInputField = document.getElementById('codeInput') as HTMLInputElement
  if (transferSessionButton) {
    transferSessionButton.addEventListener('click', ()=>{
      const code = codeInputField.value
      fetch("./tokenTransfer/"+code, {
        method: 'GET'
      })
        .then(res => res.json())
        .then(()=>{
          window.location.reload()
        })
    });
  }

  if (codeInputField) {
    codeInputField.addEventListener('input', (e)=>{
      if ((e.target as HTMLInputElement).value?.length === 36) {
          transferSessionButton?.removeAttribute('disabled');
      } else {
          transferSessionButton?.setAttribute('disabled', 'true');
      }
    })
  }

}

window.addEventListener('load', () => {
  handleSettingsButtonClick();
  handleMenuBarClicked();
  handleTransferOfSession();
});
