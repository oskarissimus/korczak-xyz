import React from "react";

export const ImageContainer = ({ style, children }) => (
    <div style={{ flexGrow: 1, ...style }}>
        {children}
    </div>
)
