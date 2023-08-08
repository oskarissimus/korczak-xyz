import { sendForm, getFormFromEvent, getDataFromForm, enrichDataWithToken, clearForm } from './ContactFormHelpers';

// Mocking the fetch function for sendForm tests
global.fetch = jest.fn((input: RequestInfo, init?: RequestInit) => Promise.resolve(new Response())) as jest.MockedFunction<typeof fetch>;

describe('sendForm', () => {
    it('calls fetch with the correct URL and data', async () => {
        const data = new FormData();
        data.append('test', 'value');
        await sendForm(data);
        expect(fetch).toHaveBeenCalledWith("https://getform.io/f/da77d728-d0c5-4090-9a77-799464d888ff", expect.objectContaining({
            method: "POST",
            body: data
        }));
    });
});

describe('getFormFromEvent', () => {
    it('returns the form from the event target', () => {
        const mockForm = document.createElement('form');
        const mockInput = document.createElement('input');
        mockForm.appendChild(mockInput);
        const mockEvent = { target: mockInput } as unknown as Event;
        expect(getFormFromEvent(mockEvent)).toBe(mockForm);
    });
});

describe('getDataFromForm', () => {
    it('returns FormData from the given form', () => {
        const mockForm = document.createElement('form');
        const data = getDataFromForm(mockForm);
        expect(data).toBeInstanceOf(FormData);
    });
});

describe('enrichDataWithToken', () => {
    it('appends the token to the given FormData', () => {
        const data = new FormData();
        const token = 'test-token';
        enrichDataWithToken(data, token);
        expect(data.get("g-recaptcha-response")).toBe(token);
    });
});

describe('clearForm', () => {
    it('resets the form', () => {
        const mockForm = document.createElement('form');
        mockForm.reset = jest.fn();
        clearForm(mockForm);
        expect(mockForm.reset).toHaveBeenCalled();
    });
});
