module.exports = {
    useI18next: jest.fn(() => ({
        languages: ['en', 'pl'],
    })),
    useTranslation: jest.fn(() => ({
        t: jest.fn().mockImplementation((key) => key),
    })),
    Link: jest.fn().mockImplementation(({ children }) => children),
}