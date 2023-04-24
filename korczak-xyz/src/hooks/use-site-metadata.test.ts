import { renderHook } from '@testing-library/react'
import { useStaticQuery } from "gatsby";
import { useSiteMetadata } from "./use-site-metadata";

// Mock data for the test
const mockData = {
    site: {
        siteMetadata: {
            title: "Test Title",
            description: "Test Description",
            image: "http://test-image.com",
            siteUrl: "http://test-url.com",
            lang: "en",
        },
    },
};

// Mock the useStaticQuery function from gatsby
jest.mock("gatsby", () => {
    const originalModule = jest.requireActual("gatsby");

    return {
        ...originalModule,
        useStaticQuery: jest.fn(),
        graphql: jest.fn(),
    };
});

describe("useSiteMetadata", () => {
    beforeEach(() => {
        (useStaticQuery as jest.Mock).mockImplementation(() => mockData);
    });

    it("should return the site metadata", () => {
        const { result } = renderHook(() => useSiteMetadata());

        expect(result.current).toEqual(mockData.site.siteMetadata);
    });
});