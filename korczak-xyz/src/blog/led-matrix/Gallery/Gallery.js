import React from "react";
import { StaticImage } from "gatsby-plugin-image";
import { ImageContainer } from "./ImageContainer";

const staticImageProps = {
    aspectRatio: 3 / 2,
    style: { display: "block" },
};

export default function Gallery() {
    return (
        <div style={{ display: "flex", gap: 20 }}>
            <ImageContainer>
                <StaticImage
                    src="../../../images/blog/led-matrix/nes-controller.jpg"
                    alt="NES controller"
                    {...staticImageProps}
                />
                NES controller
            </ImageContainer>
            <ImageContainer>
                <StaticImage
                    src="../../../images/blog/led-matrix/nespi.png"
                    alt="NESPi case"
                    {...staticImageProps}
                />
                NESPi case
            </ImageContainer>
            <ImageContainer>
                <StaticImage
                    src="../../../images/blog/led-matrix/raspberry-pi.jpg"
                    alt="Raspberry Pi"
                    {...staticImageProps}
                />
                Raspberry Pi
            </ImageContainer>
        </div>

    )


}