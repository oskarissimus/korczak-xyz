import React from "react";
import { GatsbyImage, getImage } from "gatsby-plugin-image";
import { useStaticQuery, graphql } from "gatsby";


function nameToAlt(name) {
    const replaced = name.replace(/-/g, ' ')
    return replaced.charAt(0).toUpperCase() + replaced.slice(1)
}


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

    const allImages = data.allFile.nodes.map(({ childImageSharp, name }) => ({
        image: getImage(childImageSharp),
        name: name,
        alt: nameToAlt(name),
    }))
    allImages.push({
        image: getImage(data.file.childImageSharp),
        name: "dark-side-of-the-piss",
        alt: "Dark side of the piss",
    })
    const getImagesByNameUnstable = (names) => allImages.filter(({ name }) => names.includes(name))

    const getImagesByName = (names) => {
        const images = getImagesByNameUnstable(names)
        const imagesByName = {}
        images.forEach(({ name, ...rest }) => {
            imagesByName[name] = rest
        })
        return names.map(name => imagesByName[name])
    }

    const images = getImagesByName(names)

    return (
        <div style={{ display: "flex", gap: 20 }}>
            {images.map(({ image, alt }) => {
                return (
                    <div key={alt} style={{ flexGrow: 1 }}>
                        <GatsbyImage
                            image={getImage(image)}
                            style={{ display: "block" }}
                            width={300}
                            alt={alt}
                        />
                        {alt}
                    </div>
                );
            })}
        </div>
    );
}