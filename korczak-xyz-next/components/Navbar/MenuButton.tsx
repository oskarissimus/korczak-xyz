import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBurger } from "@fortawesome/free-solid-svg-icons";
import React from "react";

interface MenuButtonProps {
  setIsMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const MenuButton: React.FC<MenuButtonProps> = ({ setIsMenuOpen }) => {
  return (
    <button
      className="flex md:hidden"
      onClick={() => setIsMenuOpen((prev) => !prev)}
      aria-label="Menu"
      data-testid="menu-button"
    >
      <FontAwesomeIcon
        icon={faBurger}
        className="block md:hidden cursor-pointer text-3xl my-6 mx-4"
      />
    </button>
  );
};

export default MenuButton;
