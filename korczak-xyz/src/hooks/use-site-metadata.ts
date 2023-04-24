import { graphql, useStaticQuery } from "gatsby";

interface SiteMetadata {
  title: string;
  description: string;
  image: string;
  siteUrl: string;
  lang: string;
}

interface SiteData {
  site: {
    siteMetadata: SiteMetadata;
  };
}

export const useSiteMetadata = (): SiteMetadata => {
  const data: SiteData = useStaticQuery(graphql`
    query {
      site {
        siteMetadata {
          title
          description
          image
          siteUrl
          lang
        }
      }
    }
  `);

  return data.site.siteMetadata;
};
