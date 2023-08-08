
import React, { ReactNode } from "react";
import { useTranslation } from 'gatsby-plugin-react-i18next';

interface FormFieldProps {
    label: string;
    children: ReactNode;
}

const FormField: React.FC<FormFieldProps> = ({ label, children }) => {
    const { t } = useTranslation();
    return (
        <label className="block">
            <span className="font-bold">
                {t(label)}
            </span>
            {children}
        </label>
    );
};

interface TextFieldProps {
    name: string;
    label: string;
    type: string;
    placeholder: string;
}

const TextField: React.FC<TextFieldProps> = ({ name, label, type, placeholder }) => {
    const { t } = useTranslation();
    return (
        <FormField label={label}>
            <input
                type={type}
                name={name}
                className="block w-1/2 mt-1 dark:bg-[#1c1c1c] dark:border-[#444444]"
                placeholder={t(placeholder) as string}
                required
            />
        </FormField>
    );
};

interface TextareaFieldProps {
    name: string;
    label: string;
    placeholder: string;
}

const TextareaField: React.FC<TextareaFieldProps> = ({ name, label, placeholder }) => {
    const { t } = useTranslation();
    return (
        <FormField label={label}>
            <textarea
                name={name}
                className="block w-full mt-1 dark:bg-[#1c1c1c] dark:border-[#444444]"
                required
                placeholder={t(placeholder) as string}
            />
        </FormField>
    );
};

const MessageField: React.FC = () => {
    const { t } = useTranslation();
    return <TextareaField name="message" label={t("Message")} placeholder={t("Enter message")} />;
}

const NameField: React.FC = () => {
    const { t } = useTranslation();
    return <TextField name="name" label={t("Name")} type="text" placeholder={t("Enter name")} />;
}

const EmailField: React.FC = () => {
    const { t } = useTranslation();
    return <TextField name="email" label={t("Email")} type="email" placeholder={t("Enter email")} />;
}

const GotchaField: React.FC = () => {
    return <input type="hidden" name="_gotcha" style={{ display: "none" }} />;
}

interface ButtonProps {
    onClick: () => void;
}

const Button: React.FC<ButtonProps> = ({ onClick }) => {
    const { t } = useTranslation();
    return (
        <button
            type="submit"
            className="px-6 py-4 text-xl dark:bg-[#1c1c1c] hover:opacity-80 bg-[#eee] hover:opacity-80"
            onClick={onClick}
        >
            {t("Submit")}
        </button>
    );
}

export {
    Button,
    EmailField,
    GotchaField,
    MessageField,
    NameField,
    FormField,
    TextField,
    TextareaField
};
