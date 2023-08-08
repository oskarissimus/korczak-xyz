
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';
import ContactForm from './ContactForm';
import { useGoogleReCaptcha } from 'react-google-recaptcha-v3';

// Mock the react-google-recaptcha-v3 hook
jest.mock('react-google-recaptcha-v3', () => ({
    useGoogleReCaptcha: jest.fn()
}));

describe('<ContactForm />', () => {
    it('renders without crashing', () => {
        useGoogleReCaptcha.mockReturnValue({ executeRecaptcha: jest.fn() });
        render(<ContactForm />);
    });

    it('contains the expected fields', () => {
        useGoogleReCaptcha.mockReturnValue({ executeRecaptcha: jest.fn() });
        const { getByPlaceholderText } = render(<ContactForm />);
        expect(getByPlaceholderText(/name/i)).toBeInTheDocument();
        expect(getByPlaceholderText(/email/i)).toBeInTheDocument();
        expect(getByPlaceholderText(/message/i)).toBeInTheDocument();
    });

    it('handles form submission', async () => {
        const executeRecaptchaMock = jest.fn().mockResolvedValue('test_token');
        useGoogleReCaptcha.mockReturnValue({ executeRecaptcha: executeRecaptchaMock });

        const { getByText, getByPlaceholderText } = render(<ContactForm />);
        fireEvent.change(getByPlaceholderText(/name/i), { target: { value: 'Test Name' } });
        fireEvent.change(getByPlaceholderText(/email/i), { target: { value: 'test@example.com' } });
        fireEvent.change(getByPlaceholderText(/message/i), { target: { value: 'Test message' } });

        fireEvent.click(getByText(/submit/i));

        await waitFor(() => {
            expect(executeRecaptchaMock).toHaveBeenCalledTimes(1);
        });
    });
});
