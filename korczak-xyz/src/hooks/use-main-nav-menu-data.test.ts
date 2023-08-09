import { renderHook } from '@testing-library/react-hooks';
import { useI18next, useTranslation } from 'gatsby-plugin-react-i18next';

import useMainNavMenuData from './use-main-nav-menu-data';

const mockedUseI18next = useI18next as jest.Mock;
const mockedUseTranslation = useTranslation as jest.Mock;

jest.mock('gatsby-plugin-react-i18next');

describe('useMainNavMenuData', () => {
  beforeEach(() => {
    mockedUseI18next.mockReset();
    mockedUseTranslation.mockReset();
  });

  it('returns navigation data with translations', () => {
    mockedUseI18next.mockReturnValue({
      languages: ['en', 'es'],
      originalPath: '/original-path',
      i18n: {}, // Mock other required properties
      t: jest.fn(),
      ready: true,
      // Add other required properties with mock values...
    });

    mockedUseTranslation.mockReturnValue({
      t: (key: string) => {
        const translations: { [key: string]: string } = {
          Home: 'Home',
          About: 'About',
          Mentoring: 'Mentoring',
          Courses: 'Courses',
          Blog: 'Blog',
        };
        return translations[key] || key;
      },
      // Mock other required properties...
    });

    const { result } = renderHook(() => useMainNavMenuData());

    expect(result.current.languages).toEqual(['en', 'es']);
    expect(result.current.originalPath).toBe('/original-path');
    expect(result.current.navigation).toEqual([
      { name: 'Home', to: '/' },
      { name: 'About', to: '/about' },
      { name: 'Mentoring', to: '/mentoring' },
      { name: 'Courses', to: '/courses' },
      { name: 'Blog', to: '/blog' },
    ]);
  });
});
