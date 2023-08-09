import { graphql, useStaticQuery } from 'gatsby';
import { IGatsbyImageData } from 'gatsby-plugin-image';
import React from 'react';

function useCommonNavData() {
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);

  const data = useStaticQuery(graphql`
    query LogoQuery {
      file(relativePath: { eq: "logo.png" }) {
        childImageSharp {
          gatsbyImageData(width: 30)
        }
      }
    }
  `);

  const imageData = data?.file?.childImageSharp?.gatsbyImageData as
    | IGatsbyImageData
    | undefined;

  return { isMenuOpen, setIsMenuOpen, imageData };
}

export default useCommonNavData;
