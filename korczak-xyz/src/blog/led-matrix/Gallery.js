import React from "react";
import { StaticImage } from "gatsby-plugin-image";

const staticImageProps = {
    aspectRatio: 3 / 2,
    style: { display: "block" },
}

const ImageContainer = ({ children }) => (
    <div style={{ flexGrow: 1 }}>
        {children}
    </div>
)

export default function Gallery() {
    return (
        <div style={{ display: "flex", gap: 20 }}>
            <ImageContainer>
                <StaticImage
                    src="../../images/blog/led-matrix/nes-controller.jpg"
                    alt="NES controller"
                    {...staticImageProps}
                />
                NES controller
            </ImageContainer>
            <ImageContainer>
                <StaticImage
                    src="../../images/blog/led-matrix/nespi.png"
                    alt="NESPi case"
                    {...staticImageProps}
                />
                NESPi case
            </ImageContainer>
            <ImageContainer>
                <StaticImage
                    src="../../images/blog/led-matrix/raspberry-pi.jpg"
                    alt="Raspberry Pi"
                    {...staticImageProps}
                />
                Raspberry Pi
            </ImageContainer>
        </div>

    )


}