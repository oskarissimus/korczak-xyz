import React, { useEffect, useCallback } from 'react';
import {
    GoogleReCaptchaProvider,
    useGoogleReCaptcha
} from 'react-google-recaptcha-v3';


const YourReCaptchaComponent = ({ setToken }) => {
    const { executeRecaptcha } = useGoogleReCaptcha();

    // Create an event handler so you can call the verification on button click event or form submit
    const handleReCaptchaVerify = useCallback(async () => {
        if (!executeRecaptcha) {
            console.log('Execute recaptcha not yet available');
            return;
        }

        const token = await executeRecaptcha('yourAction');
        setToken(token);
        // Do whatever you want with the token
    }, [executeRecaptcha, setToken]);

    // You can use useEffect to trigger the verification as soon as the component being loaded
    useEffect(() => {
        handleReCaptchaVerify();
    }, [handleReCaptchaVerify]);

    return <></>;
};


export default function ContactForm() {


    const [token, setToken] = React.useState(null);

    async function handleSubmit(event) {
        event.preventDefault();
        const form = event.target.form;
        const data = new FormData(form);
        data.append("g-recaptcha-response", token);
        console.log(token);
        console.log(data);
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
            form.reset()
        } catch (error) {
            console.log(error);
        }
    }

    return (
        <form
            accept-charset="UTF-8"
            className="flex flex-col gap-4"
        >
            <GoogleReCaptchaProvider reCaptchaKey="6Lf-apkaAAAAAHYePzpdMhbG_u7njBLSVE5rOON5">
                <YourReCaptchaComponent setToken={setToken} />
            </GoogleReCaptchaProvider>
            <label className="block">
                <span className="font-bold">
                    Name
                </span>
                <input type="text" name="name" className="block w-1/2 mt-1" placeholder="Enter your name" required="required" />
            </label>

            <label className="block">
                <span className="font-bold">
                    Email
                </span>
                <input type="email" name="email" className="block w-1/2 mt-1" placeholder="Enter email" required="required" />
            </label>

            <label className="block">
                <span className="font-bold">
                    Message
                </span>
                <textarea name="message" className="block w-full mt-1" required="required" placeholder="Enter your message" rows="5">

                </textarea>
            </label>


            <input type="hidden" name="_gotcha" style={{ display: "none" }} />
            <button
                type="submit"
                className="bg-[#eee] px-6 py-4 text-xl"
                onClick={handleSubmit}
            >
                Submit
            </button>
        </form>

    )
}

