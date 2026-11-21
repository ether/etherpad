import "./style.css"
import {interactionPath} from './interaction';
//import {MapArrayType} from "ep_etherpad-lite/node/types/MapType";

const form = document.querySelector('form')!;
const target = interactionPath(new URLSearchParams(window.location.search).get('state'));

if (target != null) {
    form.action = target;
} else {
    // Without a valid interaction uid there is nothing to consent to.
    document.getElementById('error')!.innerText = "Error signing in";
    form.addEventListener('submit', (event) => event.preventDefault());
    form.querySelectorAll('input[type=submit]')
        .forEach((el) => (el as HTMLInputElement).disabled = true);
}

/*form.addEventListener('submit', function (event) {
    event.preventDefault();
    const formData = new FormData(form);
    const data: MapArrayType<any> = {};
    formData.forEach((value, key) => {
        data[key] = value;
    });
    const sessionId = new URLSearchParams(window.location.search).get('state');

    fetch('/interaction/' + sessionId, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
    }).then(response => {
        if (response.ok) {
            if (response.redirected) {
                window.location.href = response.url;
            }
        } else {
            document.getElementById('error')!.innerText = "Error signing in";
        }
    }).catch(error => {
        document.getElementById('error')!.innerText = "Error signing in" + error;
    })
});*/
