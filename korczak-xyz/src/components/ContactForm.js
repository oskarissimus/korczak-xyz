import React from "react";

export default function ContactForm() {
    function handleSubmit(event) {
        event.preventDefault();
        const form = event.target.form;
        const data = new FormData(form);
        const url = "https://getform.io/f/da77d728-d0c5-4090-9a77-799464d888ff";
        fetch(url, {
            method: "POST",
            body: data,
            headers: {
                'Accept': 'application/json'
            }
        }).then(response => {
            alert("Thank you for your message!");
            form.reset()
        }).catch(error => {
            alert("Something went wrong!");
        });
    }
    return (
        <form
            accept-charset="UTF-8"
            className="flex flex-col gap-4"
        >

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


            <input type="hidden" id="captchaResponse" name="g-recaptcha-response" />
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

