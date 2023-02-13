import React from 'react'
import { GoogleReCaptchaProvider } from 'react-google-recaptcha-v3'
import ContactForm from './ContactForm'
export default function ContactFormWrapper() {
    return (
        <GoogleReCaptchaProvider reCaptchaKey="6Lf-apkaAAAAAHYePzpdMhbG_u7njBLSVE5rOON5">
            <ContactForm />
        </GoogleReCaptchaProvider>
    )
}
