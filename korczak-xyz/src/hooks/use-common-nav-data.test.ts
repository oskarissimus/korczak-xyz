import { renderHook } from '@testing-library/react-hooks';
import { useStaticQuery } from 'gatsby';

import useCommonNavData from './use-common-nav-data';

// Update with the path to your hook

jest.mock('gatsby', () => ({
  graphql: jest.fn(),
  useStaticQuery: jest.fn(),
}));

describe('useCommonNavData', () => {
  beforeEach(() => {
    // Reset the mocks before each test
    (useStaticQuery as jest.Mock).mockReset();
  });

  it('returns common navigation data', () => {
    (useStaticQuery as jest.Mock).mockReturnValue({
      file: {
        childImageSharp: {
          gatsbyImageData: {
            width: 30,
            // Mock other properties if needed...
          },
        },
      },
    });

    const { result } = renderHook(() => useCommonNavData());

    expect(result.current.isMenuOpen).toBe(false);
    expect(result.current.imageData).toEqual({ width: 30 });
    // You can add more assertions based on the behavior you expect...

    // You can also test the behavior of setIsMenuOpen if needed...
  });
});
