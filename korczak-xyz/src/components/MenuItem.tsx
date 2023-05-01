import React from 'react'
import PropTypes from 'prop-types'
import { Link } from 'gatsby'

interface MenuItemProps {
    className?: string;
    name: string;
    to: string;
}

const MenuItem: React.FC<MenuItemProps> = ({ className = '', name, to }) => {
    return (
        <Link key={name} to={to} className={`${className}`}> {name} </Link>
    )
}

MenuItem.propTypes = {
    className: PropTypes.string,
    name: PropTypes.string.isRequired,
    to: PropTypes.string.isRequired,
}

MenuItem.defaultProps = {
    className: '',
}

export default MenuItem;