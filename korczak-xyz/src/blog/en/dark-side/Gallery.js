import React from "react";
import { getImage } from "gatsby-plugin-image";
import { useStaticQuery, graphql } from "gatsby";
import GalleryTemplate, { getImagesByName, mapQueryResultToImages } from "../../components/GalleryTemplate";


export default function Gallery({ names }) {
    const data = useStaticQuery(graphql`
    query {
        allFile(
            filter: {relativeDirectory: {eq: "blog/dark-side"}, name: {ne: "dark-side-of-the-piss"}}
            ) {
            nodes {
                childImageSharp {
                    gatsbyImageData(
                        width: 768
                        layout: CONSTRAINED
                        placeholder: BLURRED
                    )
                }
                name
            }
        }
        file(
            relativeDirectory: {eq: "blog/dark-side"}, name: {eq: "dark-side-of-the-piss"}
            ) {
            childImageSharp {
                gatsbyImageData(
                    width: 768
                    layout: CONSTRAINED
                    placeholder: BLURRED
                    aspectRatio: 0.6
                )
            }
        }
    }
    `);

    const allImages = mapQueryResultToImages(data)
    allImages.push({
        image: getImage(data.file.childImageSharp),
        name: "dark-side-of-the-piss",
        alt: "Dark side of the piss",
    })
    const images = getImagesByName(allImages, names)
    return <GalleryTemplate images={images} />
}
