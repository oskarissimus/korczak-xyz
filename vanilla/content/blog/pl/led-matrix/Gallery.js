import React from "react";
import { useStaticQuery, graphql } from "gatsby";
import GalleryTemplate, { getImagesByName, mapQueryResultToImages } from "../../components/GalleryTemplate";


export default function Gallery({ names }) {
    const data = useStaticQuery(graphql`
    query {
        allFile(
            filter: {relativeDirectory: {eq: "blog/led-matrix"}}
            ) {
            nodes {
                childImageSharp {
                    gatsbyImageData(
                        width: 768
                        layout: CONSTRAINED
                        placeholder: BLURRED
                        aspectRatio: 1.5
                    )
                }
                name
            }
        }
    }
    `);

    const allImages = mapQueryResultToImages(data)
    const images = getImagesByName(allImages, names)
    return <GalleryTemplate images={images} />
}
