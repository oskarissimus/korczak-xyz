import React from "react";
import { StaticImage } from "gatsby-plugin-image";
import { ImageContainer } from "../../components/ImageContainer";


const staticImageProps = {
    aspectRatio: 1,
    style: { display: "block" },
    width: 300,
};

export default function GalleryMountedPart() {
    return (
        <div style={{ display: "flex", gap: 20 }}>
            <ImageContainer>
                <StaticImage
                    src="../../../images/blog/display-stand-upgrade/mounted-close.jpg"
                    alt="Close-up on mounted part"
                    {...staticImageProps}
                />
                Close-up on mounted part
            </ImageContainer>
            <ImageContainer>
                <StaticImage
                    src="../../../images/blog/display-stand-upgrade/mounted-far.jpg"
                    alt="Mounted part from far"
                    {...staticImageProps}
                />
                Mounted part from far
            </ImageContainer>
            <ImageContainer style={{ flexGrow: 1 }}>
                <StaticImage
                    src="../../../images/blog/display-stand-upgrade/mounted-view-from-behind.jpg"
                    alt="Mounted part from behind"
                    {...staticImageProps}
                />
                Mounted part from behind
            </ImageContainer>
        </div>

    )


}