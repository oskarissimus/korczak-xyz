import React from "react";

// import DarkModeSwitch from "../DarkModeSwitch";
import Logo from "./Logo";
import MenuButton from "./MenuButton";

interface MobileNavHeaderProps {
  setIsMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const MobileNavHeader: React.FC<MobileNavHeaderProps> = ({ setIsMenuOpen }) => {
  return (
    <div className="flex items-center justify-end ml-4">
      <Logo className="md:hidden" />
      <div className="grow md:hidden" />
      {/* <DarkModeSwitch className="block md:hidden" /> */}
      <MenuButton setIsMenuOpen={setIsMenuOpen} />
    </div>
  );
};

export default MobileNavHeader;
