
import React from 'react';
import { render } from '@testing-library/react';
import { FormField, TextField, Button, EmailField, GotchaField, MessageField, NameField, TextareaField } from './ContactFormFields';

describe('FormField', () => {
    it('renders without crashing', () => {
        render(<FormField label="Test Label">Child Component</FormField>);
    });
});

describe('TextField', () => {
    it('renders without crashing', () => {
        render(<TextField name="testName" label="Test Label" type="text" placeholder="Test Placeholder" />);
    });

    it('displays the correct placeholder', () => {
        const { getByPlaceholderText } = render(<TextField name="testName" label="Test Label" type="text" placeholder="Test Placeholder" />);
        expect(getByPlaceholderText('Test Placeholder')).toBeInTheDocument();
    });
});

describe('Button', () => {
    it('renders without crashing', () => {
        render(<Button onClick={() => { }} />);
    });

    it('triggers onClick event', () => {
        const handleClick = jest.fn();
        const { getByText } = render(<Button onClick={handleClick} />);
        const button = getByText('Submit');  // Assuming "Submit" is the default label for the button
        button.click();
        expect(handleClick).toHaveBeenCalledTimes(1);
    });
});

describe('EmailField', () => {
    it('renders without crashing', () => {
        render(<EmailField />);
    });
});

describe('GotchaField', () => {
    it('renders without crashing', () => {
        render(<GotchaField />);
    });
});

describe('MessageField', () => {
    it('renders without crashing', () => {
        render(<MessageField />);
    });
});

describe('NameField', () => {
    it('renders without crashing', () => {
        render(<NameField />);
    });
});

describe('TextareaField', () => {
    it('renders without crashing', () => {
        render(<TextareaField name="testName" label="Test Label" placeholder="Test Placeholder" />);
    });

    it('displays the correct placeholder', () => {
        const { getByPlaceholderText } = render(<TextareaField name="testName" label="Test Label" placeholder="Test Placeholder" />);
        expect(getByPlaceholderText('Test Placeholder')).toBeInTheDocument();
    });
});
