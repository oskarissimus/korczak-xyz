import React, { useCallback } from 'react';
import { useGoogleReCaptcha } from 'react-google-recaptcha-v3';
import { Button, EmailField, GotchaField, MessageField, NameField } from './ContactFormFields';
import { getFormFromEvent, getDataFromForm, enrichDataWithToken, sendForm } from './ContactFormHelpers';

export default function ContactForm() {
    const { executeRecaptcha } = useGoogleReCaptcha();

    const obtainToken = useCallback(async () => {
        if (!executeRecaptcha) {
            console.log('Execute recaptcha not yet available');
            throw new Error('Execute recaptcha not yet available');
        }
        const token = await executeRecaptcha('yourAction');
        return token;
    }, [executeRecaptcha])

    const handleSubmit = useCallback(async event => {
        event.preventDefault();
        const token = await obtainToken();
        const form = getFormFromEvent(event);
        const data = getDataFromForm(form);
        const dataWithToken = enrichDataWithToken(data, token);
        sendForm(dataWithToken);
    }, [obtainToken]);

    return (
        <form
            accept-charset="UTF-8"
            className="flex flex-col gap-4"
        >
            <NameField />
            <EmailField />
            <MessageField />
            <GotchaField />
            <Button onClick={handleSubmit} />
        </form>

    )
}



