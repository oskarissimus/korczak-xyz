import React from "react";

export const staticImageProps = {
    aspectRatio: 3 / 2,
    style: { display: "block" },
};
export const ImageContainer = ({ children }) => (
    <div style={{ flexGrow: 1 }}>
        {children}
    </div>
);
