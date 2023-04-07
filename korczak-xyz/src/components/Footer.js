import React from "react";
import MenuItem from "./MenuItem";

export default function Footer() {
    return (
        <footer className='flex gap-8 m-8'>
            <MenuItem name='korczak.xyz' to='/' />
        </footer>
    )
}
