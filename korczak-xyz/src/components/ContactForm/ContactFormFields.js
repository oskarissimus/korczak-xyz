import React from "react";

function FormField({ label, children }) {
    return <label className="block">
        <span className="font-bold">
            {label}
        </span>
        {children}
    </label>;
}

function TextField({ name, label, type, placeholder }) {
    return <FormField label={label}>
        <input
            type={type}
            name={name}
            className="block w-1/2 mt-1 dark:bg-[#1c1c1c] dark:border-[#444444]"
            placeholder={placeholder}
            required="required"
        />
    </FormField>;
}

function TextareaField({ name, label, placeholder }) {
    return <FormField label={label}>
        <textarea
            name={name}
            className="block w-full mt-1 dark:bg-[#1c1c1c] dark:border-[#444444]"
            required="required"
            placeholder={placeholder}
            rows="5"
        >

        </textarea>
    </FormField>;
}

function MessageField() {
    return <TextareaField name="message" label="Message" placeholder="Enter message" />
}

function NameField() {
    return <TextField name="name" label="Name" type="text" placeholder="Enter name" />
}

function EmailField() {
    return <TextField name="email" label="Email" type="email" placeholder="Enter email" />
}

function GotchaField() {
    return <input type="hidden" name="_gotcha" style={{ display: "none" }} />
}

function Button({ onClick }) {
    return <button
        type="submit"
        className="px-6 py-4 text-xl dark:bg-[#1c1c1c] hover:opacity-80 bg-[#eee] hover:opacity-80"
        onClick={onClick}
    >
        Submit
    </button>;
}

export { Button, EmailField, GotchaField, MessageField, NameField }