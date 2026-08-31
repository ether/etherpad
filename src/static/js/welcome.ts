import html10n from './vendors/html10n';

const checkmark = '<svg width="28" height="28" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="3" stroke="currentColor"><path vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>';

function getCookie(name: string) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) { // @ts-ignore
    return parts.pop().split(';').shift();
  }
}


const cp = (window as any).clientVars?.cookiePrefix || '';

const sessionTransferErrorFallback = () =>
  html10n.get('index.sessionTransferError') || 'Unable to transfer the session. Please try again.';

const safeJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const responseErrorMessage = (responseData: unknown): string => {
  const data = responseData as Record<string, unknown>;
  if (
    responseData &&
    typeof responseData === 'object' &&
    'error' in responseData &&
    typeof data.error === 'string' &&
    data.error.trim() !== ''
  ) {
    return data.error;
  }
  return sessionTransferErrorFallback();
};

const showSessionTransferError = (element: HTMLElement | null, message: string) => {
  if (!element) return;
  element.textContent = message;
  element.style.display = 'block';
};

const hideSessionTransferError = (element: HTMLElement | null) => {
  if (!element) return;
  element.textContent = '';
  element.style.display = 'none';
};

function handleTransferOfSession() {
  const transferNowButton = document.querySelector('[data-l10n-id="index.transferSessionNow"]')! as HTMLButtonElement;

  transferNowButton.addEventListener('click', async () => {
    const originalButtonContent = transferNowButton.innerHTML;
    const copyLinkSection = document.getElementById('copy-link-section');
    const errorElement = document.getElementById('transfer-session-error');
    hideSessionTransferError(errorElement);
    if (copyLinkSection) copyLinkSection.style.display = 'none';
    transferNowButton.style.display = 'inline-flex';
    transferNowButton.style.alignItems = 'center';
    transferNowButton.style.justifyContent = 'center';
    transferNowButton.disabled = true;

    try {
      // The author token is HttpOnly (ether/etherpad#6701 PR3) so we cannot
      // read it via document.cookie. Send only the JS-readable prefsHttp; the
      // server reads the token off the request's own cookie jar.
      const responseWithId = await fetch("./tokenTransfer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          prefsHttp: getCookie(`${cp}prefsHttp`) || getCookie('prefsHttp'),
        })
      });

      const responseData = await safeJson(responseWithId);
      if (!responseWithId.ok) {
        throw new Error(responseErrorMessage(responseData));
      }
      const transferData = responseData as Record<string, unknown>;
      if (!responseData || typeof responseData !== 'object' ||
          !('id' in responseData) || typeof transferData.id !== 'string' ||
          transferData.id.trim() === '') {
        throw new Error(sessionTransferErrorFallback());
      }

      if (!copyLinkSection) throw new Error(sessionTransferErrorFallback());
      copyLinkSection.style.display = 'block';

      const copyButton = document.querySelector('#copy-link-section .btn-secondary') as HTMLButtonElement;
      copyButton.disabled = false;
      copyButton.onclick = async () => {
        await navigator.clipboard.writeText(transferData.id as string);
        copyButton.style.display = 'inline-flex';
        copyButton.style.alignItems = 'center';
        copyButton.style.justifyContent = 'center';
        copyButton.innerHTML = `${checkmark}`;
        copyButton.disabled = true;
      };
      transferNowButton.innerHTML = `${checkmark}`;
    } catch (err) {
      if (copyLinkSection) copyLinkSection.style.display = 'none';
      transferNowButton.innerHTML = originalButtonContent;
      transferNowButton.disabled = false;
      showSessionTransferError(
          errorElement,
          err instanceof Error && err.message ? err.message : sessionTransferErrorFallback());
    }
  });
}

const isValidTransferCode = (code: string) => code.length === 36;

async function redeemTransferCode(
    code: string,
    transferSessionButton: HTMLButtonElement,
    errorElement: HTMLElement | null) {
  hideSessionTransferError(errorElement);
  transferSessionButton.disabled = true;

  try {
    const response = await fetch("./tokenTransfer/"+code, {
      method: 'GET'
    });
    const responseData = await safeJson(response);
    if (!response.ok) {
      throw new Error(responseErrorMessage(responseData));
    }
    const transferData = responseData as Record<string, unknown>;
    if (!responseData || typeof responseData !== 'object' ||
        !('ok' in responseData) || transferData.ok !== true) {
      throw new Error(sessionTransferErrorFallback());
    }
    window.location.reload()
  } catch (err) {
    transferSessionButton.disabled = !isValidTransferCode(code);
    showSessionTransferError(
        errorElement,
        err instanceof Error && err.message ? err.message : sessionTransferErrorFallback());
  }
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

  const transferSessionButton = document.getElementById('transferSessionButton') as HTMLButtonElement | null;
  const codeInputField = document.getElementById('codeInput') as HTMLInputElement
  if (transferSessionButton) {
    transferSessionButton.addEventListener('click', ()=>{
      const code = codeInputField.value;
      redeemTransferCode(
          code,
          transferSessionButton,
          document.getElementById('receive-session-error'));
    });
  }

  if (codeInputField) {
    codeInputField.addEventListener('input', (e)=>{
      hideSessionTransferError(document.getElementById('receive-session-error'));
      if (isValidTransferCode((e.target as HTMLInputElement).value)) {
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
