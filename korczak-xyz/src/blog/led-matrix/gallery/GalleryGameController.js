import React from "react";
import { StaticImage } from "gatsby-plugin-image";
import { ImageContainer } from "./ImageContainer";

const staticImageProps = {
    aspectRatio: 1,
    style: { display: "block" },
    width: 300,
};

export default function GalleryGameController() {
    return (
        <div style={{ display: "flex", gap: 20 }}>
            <ImageContainer>
                <StaticImage
                    src="../../../images/blog/led-matrix/controller-wiring.jpg"
                    alt="controller wiring"
                    {...staticImageProps}
                />
                controller wiring
            </ImageContainer>
            <ImageContainer>
                <StaticImage
                    src="../../../images/blog/led-matrix/controller-wiring-with-laptop.jpg"
                    alt="controller wiring with laptop"
                    {...staticImageProps}
                />
                controller wiring with laptop
            </ImageContainer>
            <ImageContainer style={{ flexGrow: 1 }}>
                <StaticImage
                    src="../../../images/blog/led-matrix/controller-in-all-its-glory.jpg"
                    alt="controller in all its glory"
                    {...staticImageProps}
                />
                controller in all its glory
            </ImageContainer>
        </div>

    )


}