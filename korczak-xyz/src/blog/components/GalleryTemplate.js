import React from 'react'
import { getImage, GatsbyImage } from 'gatsby-plugin-image'
function nameToAlt(name) {
    const replaced = name.replace(/-/g, ' ')
    return replaced.charAt(0).toUpperCase() + replaced.slice(1)
}

function getImagesByNameUnstable(allImages, names) {
    return allImages.filter(({ name }) => names.includes(name))
}

export function getImagesByName(allImages, names) {
    const images = getImagesByNameUnstable(allImages, names)
    const imagesByName = {}
    images.forEach(({ name, ...rest }) => {
        imagesByName[name] = rest
    })
    return names.map(name => imagesByName[name])
}

export function mapQueryResultToImages(data) {
    return (
        data.allFile.nodes.map(({ childImageSharp, name }) => ({
            image: getImage(childImageSharp),
            name: name,
            alt: nameToAlt(name),
        }))
    )
}



export default function GalleryTemplate({ images }) {
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
