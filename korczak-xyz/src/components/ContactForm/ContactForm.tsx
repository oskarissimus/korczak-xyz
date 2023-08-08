import React, { useCallback } from 'react';
import { useGoogleReCaptcha } from 'react-google-recaptcha-v3';
import { Button, EmailField, GotchaField, MessageField, NameField } from './ContactFormFields';
import { getDataFromForm, enrichDataWithToken, sendForm, clearForm } from './ContactFormHelpers';

const ContactForm: React.FC = () => {
    const { executeRecaptcha } = useGoogleReCaptcha();

    const obtainToken = useCallback(async () => {
        if (!executeRecaptcha) {
            console.log('Execute recaptcha not yet available');
            throw new Error('Execute recaptcha not yet available');
        }
        const token = await executeRecaptcha('yourAction');
        return token;
    }, [executeRecaptcha])

    const handleSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const token = await obtainToken();
        const form = event.currentTarget;
        if (!form) return;
        const data = getDataFromForm(form);
        const dataWithToken = enrichDataWithToken(data, token);
        sendForm(dataWithToken);
        clearForm(form);
    }, [obtainToken]);

    return (
        <form
            acceptCharset="UTF-8"
            className="flex flex-col gap-4"
        >
            <NameField />
            <EmailField />
            <MessageField />
            <GotchaField />
            <Button onClick={handleSubmit as any} />
        </form>

    )
}




export default ContactForm;