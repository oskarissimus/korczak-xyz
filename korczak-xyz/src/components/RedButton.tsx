import { Link } from 'gatsby';
import React, { FC } from 'react';

interface RedButtonProps {
  text: string;
  link: string;
}

export const RedButton: FC<RedButtonProps> = ({ text, link }) => {
  return (
    <Link
      className='bg-red-500 hover:bg-red-400 text-white py-4 px-6'
      to={link}
    >
      {text}
    </Link>
  );
};
