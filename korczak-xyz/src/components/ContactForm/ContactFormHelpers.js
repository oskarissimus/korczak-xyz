const sendForm = async (data) => {
    const url = "https://getform.io/f/da77d728-d0c5-4090-9a77-799464d888ff";
    try {
        await fetch(url, {
            method: "POST",
            body: data,
            headers: {
                'Accept': 'application/json'
            }
        });
        alert("Thank you for your message!");
    } catch (error) {
        console.log(error);
    }
}

const getFormFromEvent = event => {
    const form = event.target.form;
    return form;
}

const getDataFromForm = form => {
    const data = new FormData(form);
    return data;
}

const enrichDataWithToken = (data, token) => {
    data.append("g-recaptcha-response", token);
    return data;
}

const clearForm = form => {
    form.reset();
}

export { sendForm, getFormFromEvent, getDataFromForm, enrichDataWithToken, clearForm };