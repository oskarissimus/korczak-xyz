const sendForm = async (data: FormData): Promise<void> => {
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

const getFormFromEvent = (event: Event): HTMLFormElement | null => {
    const form = event.target as HTMLFormElement;
    return form.form;
}

const getDataFromForm = (form: HTMLFormElement): FormData => {
    const data = new FormData(form);
    return data;
}

const enrichDataWithToken = (data: FormData, token: string): FormData => {
    data.append("g-recaptcha-response", token);
    return data;
}

const clearForm = (form: HTMLFormElement): void => {
    form.reset();
}

export { sendForm, getFormFromEvent, getDataFromForm, enrichDataWithToken, clearForm };
