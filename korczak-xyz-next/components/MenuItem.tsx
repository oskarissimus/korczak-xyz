import Link from "next/link";
import React from "react";

interface MenuItemProps {
  className?: string;
  name: string;
  to: string;
}

const MenuItem: React.FC<MenuItemProps> = ({ className = "", name, to }) => {
  return (
    <Link href={to} className={className} data-testid="menu-item">
      {name}
    </Link>
  );
};

export default MenuItem;
export type { MenuItemProps };
