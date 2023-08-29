import { renderHook } from '@testing-library/react';
import { useStaticQuery } from 'gatsby';

import useCommonNavData from './use-common-nav-data';

jest.mock('gatsby', () => ({
  graphql: jest.fn(),
  useStaticQuery: jest.fn(),
}));

describe('useCommonNavData', () => {
  beforeEach(() => {
    (useStaticQuery as jest.Mock).mockReset();
  });

  it('returns common navigation data', () => {
    (useStaticQuery as jest.Mock).mockReturnValue({
      file: {
        childImageSharp: {
          gatsbyImageData: {
            width: 30,
          },
        },
      },
    });

    const { result } = renderHook(() => useCommonNavData());

    expect(result.current.isMenuOpen).toBe(false);
    expect(result.current.imageData).toEqual({ width: 30 });
  });
});
