import React from "react";
import { useTranslation } from 'gatsby-plugin-react-i18next';

function FormField({ label, children }) {
    const { t } = useTranslation();
    return <label className="block">
        <span className="font-bold">
            {t(label)}
        </span>
        {children}
    </label>;
}

function TextField({ name, label, type, placeholder }) {
    const { t } = useTranslation();
    return <FormField label={label}>
        <input
            type={type}
            name={name}
            className="block w-1/2 mt-1 dark:bg-[#1c1c1c] dark:border-[#444444]"
            placeholder={t(placeholder)}
            required="required"
        />
    </FormField>;
}

function TextareaField({ name, label, placeholder }) {
    const { t } = useTranslation();
    return <FormField label={label}>
        <textarea
            name={name}
            className="block w-full mt-1 dark:bg-[#1c1c1c] dark:border-[#444444]"
            required="required"
            placeholder={t(placeholder)}
            rows="5"
        >

        </textarea>
    </FormField>;
}

function MessageField() {
    const { t } = useTranslation();
    return <TextareaField name="message" label={t("Message")} placeholder={t("Enter message")} />
}

function NameField() {
    const { t } = useTranslation();
    return <TextField name="name" label={t("Name")} type="text" placeholder={t("Enter name")} />
}

function EmailField() {
    const { t } = useTranslation();
    return <TextField name="email" label={t("Email")} type="email" placeholder={t("Enter email")} />
}

function GotchaField() {
    return <input type="hidden" name="_gotcha" style={{ display: "none" }} />
}

function Button({ onClick }) {
    const { t } = useTranslation();
    return <button
        type="submit"
        className="px-6 py-4 text-xl dark:bg-[#1c1c1c] hover:opacity-80 bg-[#eee] hover:opacity-80"
        onClick={onClick}
    >
        {t("Submit")}
    </button>;
}

export { Button, EmailField, GotchaField, MessageField, NameField }