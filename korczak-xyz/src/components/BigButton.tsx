import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import React, { ReactElement } from 'react';
import { Link } from 'gatsby';

interface BigButtonProps {
    icon: any;
    text: string;
    backgroundColor: string;
    to: string;
}

export default function BigButton({ icon, text, backgroundColor, to }: BigButtonProps): ReactElement {
    return (
        <Link
            className={`
        ${backgroundColor}
        text-2xl
        md:text-4xl
        w-full
        text-white
        md:leading-loose
        leading-loose
        flex
        flex-row
        justify-center
        gap-4
        hover:opacity-75
        pb-1
        font-light
        `}
            to={to}
        >
            <p>
                <FontAwesomeIcon icon={icon} data-testid="bigbutton-icon"/>
            </p>
            <p>
                {text}
            </p>
        </Link>
    );
}