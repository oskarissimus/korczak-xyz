import React from 'react';
import { Link } from 'gatsby';

interface Props {
    className: string;
    name: string;
    to: string;
}

const MenuItem: React.FC<Props> = ({ className, name, to }) => {
    return (
        <Link key={name} to={to} className={className}>
            {name}
        </Link>
    );
};

export default MenuItem;
