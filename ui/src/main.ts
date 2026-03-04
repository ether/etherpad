import './style.css'
import {MapArrayType} from "ep_etherpad-lite/node/types/MapType.ts";

const searchParams = new URLSearchParams(window.location.search);


document.getElementById('client')!.innerText = searchParams.get('client_id')!;

const form = document.querySelector('form')!;
form.addEventListener('submit', function (event) {
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
        redirect: 'follow',
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
});

const hidePassword = document.querySelector('.toggle-password-visibility')! as HTMLElement
const showPassword = document.getElementById('eye-hide')! as HTMLElement
const togglePasswordVisibility = () => {
    const passwordInput = document.getElementsByName('password')[0] as HTMLInputElement;
    if (passwordInput.type === 'password') {
        showPassword.style.display = 'block';
        hidePassword.style.display = 'none';
        passwordInput.type = 'text';
    } else {
        showPassword.style.display = 'none';
        hidePassword.style.display = 'block';
        passwordInput.type = 'password';
    }
}


hidePassword.addEventListener('click', togglePasswordVisibility);
showPassword.addEventListener('click', togglePasswordVisibility);


